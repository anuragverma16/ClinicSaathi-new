import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Invoice, Payment, Appointment, Service, Doctor, Clinic, Patient } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, branchFilter } from '../../middleware/rbac.js';
import { requireFeature } from '../../middleware/planGate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { createOrder, publicKeyId, verifyCheckoutSignature, fetchPayment, gatewayEnabled } from '../../integrations/razorpay.js';
import { nextSequence } from '../../models/Counter.js';
import { emit, EVENTS } from '../../services/events.js';
import { settleGatewayPayment, recordDeskPayment, refundPayment } from '../../services/payment.service.js';
import { TZ } from '../../utils/slots.js';

const router = Router();
router.use(requireFeature('billing'));
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const round2 = (n) => Math.round(n * 100) / 100;

const lineItem = z.object({
  description: z.string().trim().min(1).max(200),
  serviceId: objectId.optional(),
  quantity: z.number().int().min(1).max(100).default(1),
  unitPrice: z.number().min(0).max(1_000_000),
  gstPercent: z.number().min(0).max(28).default(0),
});
const invoiceSchema = z.object({
  patientId: objectId.optional(),
  appointmentId: objectId.optional(),
  doctorId: objectId.optional(),
  lineItems: z.array(lineItem).max(50).optional(),
  discount: z.number().min(0).default(0),
  notes: z.string().max(500).optional(),
  dueDate: z.string().optional(),
}).refine((d) => d.appointmentId || (d.patientId && d.lineItems?.length), { message: 'Pick an appointment, or a patient and at least one item' });

export function computeTotals(lineItems, discount = 0) {
  let subtotal = 0;
  let gstAmount = 0;
  const items = lineItems.map((li) => {
    const amount = round2(li.unitPrice * li.quantity);
    subtotal += amount;
    gstAmount += (amount * (li.gstPercent || 0)) / 100;
    return { ...li, amount };
  });
  if (discount > subtotal) throw ApiError.badRequest('Discount cannot exceed the subtotal', 'DISCOUNT_TOO_LARGE');
  // Discount reduces the taxable value proportionally.
  const gstAfterDiscount = subtotal ? gstAmount * ((subtotal - discount) / subtotal) : 0;
  const total = Math.max(0, subtotal - discount + gstAfterDiscount);
  return { items, subtotal: round2(subtotal), gstAmount: round2(gstAfterDiscount), total: round2(total) };
}

/** Invoice line built from the visit's service (or the doctor's consultation fee). */
async function linesForAppointment(req, appt) {
  if (appt.serviceId) {
    const s = await scoped(Service, req).findById(appt.serviceId);
    if (s) return [{ description: s.name, serviceId: s._id, quantity: 1, unitPrice: appt.fee ?? s.fee, gstPercent: s.gstPercent || 0 }];
  }
  const d = await scoped(Doctor, req).findById(appt.doctorId);
  return [{ description: `Consultation${d ? ` — ${d.name}` : ''}`, quantity: 1, unitPrice: appt.fee ?? d?.consultationFee ?? 0, gstPercent: 0 }];
}

export async function createInvoiceRecord(req, body) {
  let { patientId, doctorId, lineItems } = body;
  let appt = null;
  if (body.appointmentId) {
    appt = await scoped(Appointment, req).findById(body.appointmentId);
    if (!appt) throw ApiError.notFound('Appointment not found');
    const existing = await scoped(Invoice, req).findOne({ appointmentId: appt._id, status: { $ne: 'VOID' } });
    if (existing) throw new ApiError(409, `Invoice ${existing.invoiceNumber} already exists for this visit`, 'INVOICE_EXISTS', { invoiceId: existing._id });
    patientId = appt.patientId; doctorId = appt.doctorId;
    if (!lineItems?.length) lineItems = await linesForAppointment(req, appt);
  }
  if (!(await scoped(Patient, req).findById(patientId))) throw ApiError.notFound('Patient not found');

  const { items, subtotal, gstAmount, total } = computeTotals(lineItems, body.discount);
  const year = new Date().getFullYear();
  const seq = await nextSequence(`invoice:${req.tenant.clinicId}:${year}`);
  const clinic = await Clinic.findById(req.tenant.clinicId).select('gstin').lean();
  const invoice = await scoped(Invoice, req).create({
    patientId, doctorId, appointmentId: appt?._id, branchId: appt?.branchId || req.tenant.branchId || undefined,
    lineItems: items, subtotal, discount: body.discount || 0, gstAmount, total,
    invoiceNumber: `INV-${year}-${String(seq).padStart(5, '0')}`,
    status: total > 0 ? 'UNPAID' : 'PAID', notes: body.notes, dueDate: body.dueDate || undefined,
    gstin: gstAmount > 0 ? clinic?.gstin : undefined, createdByUserId: req.user?._id,
  });
  if (appt) await scoped(Appointment, req).updateOne({ _id: appt._id }, { invoiceId: invoice._id });
  emit(EVENTS.INVOICE_CREATED, { invoice });
  return invoice;
}

/**
 * Prepaid booking: invoice the held appointment and open a gateway order.
 * If the order can't be created the hold is released so the slot isn't stuck.
 */
export async function startPrepayment(req, appointment) {
  try {
    const invoice = await createInvoiceRecord(req, { appointmentId: String(appointment._id), discount: 0 });
    const due = round2(invoice.total - invoice.amountPaid);
    const order = await createOrder({
      amountPaise: Math.round(due * 100), receipt: invoice.invoiceNumber,
      notes: { clinicId: String(req.tenant.clinicId), invoiceId: String(invoice._id), appointmentId: String(appointment._id) },
    });
    await Payment.create({
      clinicId: req.tenant.clinicId, branchId: invoice.branchId, invoiceId: invoice._id, patientId: invoice.patientId,
      amount: due, method: 'ONLINE', gateway: 'RAZORPAY', gatewayOrderId: order.id, status: 'CREATED',
    });
    return { invoiceId: invoice._id, amount: due, order: { id: order.id, amount: order.amount, currency: order.currency }, keyId: publicKeyId(), holdExpiresAt: appointment.holdExpiresAt };
  } catch (e) {
    await Appointment.updateOne({ _id: appointment._id, status: 'REQUESTED' },
      { status: 'CANCELLED', slotKey: null, cancelledAt: new Date(), cancelledBy: 'SYSTEM', cancelReason: 'Payment could not be started' })
      .setOptions({ clinicId: req.tenant.clinicId });
    throw e;
  }
}

const listFilter = (req) => {
  const f = { ...branchFilter(req) };
  const { status, patientId, from, to, q } = req.query;
  if (status) f.status = { $in: String(status).split(',') };
  if (patientId) f.patientId = patientId;
  if (from || to) {
    f.createdAt = {};
    if (from) f.createdAt.$gte = dayjs.tz(from, TZ).startOf('day').toDate();
    if (to) f.createdAt.$lte = dayjs.tz(to, TZ).endOf('day').toDate();
  }
  if (q) f.invoiceNumber = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return f;
};

// ------------------------------------------------------------------ Invoices

router.get('/invoices', requirePermission('invoice:read'), catchAsync(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 25);
  const filter = listFilter(req);
  if (req.query.gst === 'true') filter.gstAmount = { $gt: 0 };
  const db = scoped(Invoice, req);
  const [items, total] = await Promise.all([
    db.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit)
      .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone')),
    db.countDocuments(filter),
  ]);
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
}));

/**
 * Visits not yet invoiced, for the billing desk. Accounts can't browse the
 * appointment book, so this exposes only what an invoice needs.
 */
router.get('/billable-visits', requirePermission('invoice:create'), catchAsync(async (req, res) => {
  if (!req.query.patientId) throw ApiError.badRequest('patientId is required');
  const clinicId = req.tenant.clinicId;
  const visits = await scoped(Appointment, req).find({
    ...branchFilter(req), patientId: req.query.patientId, invoiceId: { $exists: false },
    status: { $in: ['CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'] },
  }).sort('-startAt').limit(20).select('startAt fee status doctorId serviceId')
    .populate(tenantPopulate(clinicId, 'doctorId', 'name'))
    .populate(tenantPopulate(clinicId, 'serviceId', 'name'));
  ok(res, visits);
}));

router.get('/invoices/:id', requirePermission('invoice:read'), catchAsync(async (req, res) => {
  const invoice = await scoped(Invoice, req).findOne({ _id: req.params.id, ...branchFilter(req) })
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone email'));
  if (!invoice) throw ApiError.notFound('Invoice not found');
  const payments = await scoped(Payment, req).find({ invoiceId: invoice._id }).sort('-createdAt');
  ok(res, { ...invoice.toObject(), payments, balance: round2(invoice.total - invoice.amountPaid) });
}));

router.post('/invoices', requirePermission('invoice:create'), validate(invoiceSchema), catchAsync(async (req, res) => {
  const invoice = await createInvoiceRecord(req, req.body);
  recordAudit(req, { action: 'INVOICE_CREATED', entityType: 'Invoice', entityId: invoice._id, after: { total: invoice.total } });
  created(res, invoice);
}));

router.post('/invoices/:id/void', requirePermission('invoice:update'),
  validate(z.object({ reason: z.string().trim().min(3).max(300) })), catchAsync(async (req, res) => {
    const invoice = await scoped(Invoice, req).findOneAndUpdate(
      { _id: req.params.id, amountPaid: 0, status: { $in: ['UNPAID', 'OVERDUE', 'DRAFT'] } },
      { status: 'VOID', notes: `VOID: ${req.body.reason}` }, { new: true }
    );
    if (!invoice) throw ApiError.badRequest('Only an unpaid invoice can be voided — refund payments first', 'VOID_NOT_ALLOWED');
    recordAudit(req, { action: 'INVOICE_VOIDED', entityType: 'Invoice', entityId: invoice._id, after: { reason: req.body.reason } });
    ok(res, invoice);
  }));

/** Creates a gateway order. Does NOT mark anything paid — a verified signature or webhook does. */
router.post('/invoices/:id/payment-order', requirePermission('payment:create'), catchAsync(async (req, res) => {
  const invoice = await scoped(Invoice, req).findById(req.params.id);
  if (!invoice || invoice.status === 'VOID') throw ApiError.notFound('Invoice not found');
  const due = round2(invoice.total - invoice.amountPaid);
  if (due <= 0) throw ApiError.badRequest('This invoice is already settled', 'ALREADY_PAID');
  const order = await createOrder({
    amountPaise: Math.round(due * 100), receipt: invoice.invoiceNumber,
    notes: { clinicId: String(req.tenant.clinicId), invoiceId: String(invoice._id) },
  });
  const payment = await scoped(Payment, req).create({
    invoiceId: invoice._id, patientId: invoice.patientId, branchId: invoice.branchId, amount: due,
    method: 'ONLINE', gateway: 'RAZORPAY', gatewayOrderId: order.id, status: 'CREATED',
  });
  ok(res, { order: { id: order.id, amount: order.amount, currency: order.currency }, keyId: publicKeyId(), paymentId: payment._id });
}));

const checkoutSchema = z.object({
  razorpay_order_id: z.string().min(5), razorpay_payment_id: z.string().min(5), razorpay_signature: z.string().min(10),
});

/**
 * Checkout callback. The browser's word is not enough: the HMAC signature is
 * checked with the key secret, and the payment is re-fetched from Razorpay to
 * confirm it was captured for this order before anything settles.
 */
export async function verifyCheckout(body, clinicId) {
  if (!gatewayEnabled()) throw new ApiError(503, 'Online payments are not configured', 'GATEWAY_NOT_CONFIGURED');
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) throw ApiError.badRequest('Payment signature is invalid', 'BAD_SIGNATURE');
  const local = await Payment.findOne({ gatewayOrderId: orderId }).setOptions({ clinicId });
  if (!local) throw ApiError.notFound('Payment not found');
  const remote = await fetchPayment(paymentId);
  if (remote.order_id !== orderId || !['captured', 'authorized'].includes(remote.status)) {
    throw ApiError.badRequest('The gateway has not confirmed this payment yet', 'PAYMENT_NOT_CAPTURED');
  }
  if (remote.status === 'authorized') return { pending: true, payment: local };
  return settleGatewayPayment({ orderId, gatewayPaymentId: paymentId, via: 'CHECKOUT_SIGNATURE' });
}

router.post('/payments/verify', requirePermission('payment:create'), validate(checkoutSchema), catchAsync(async (req, res) => {
  ok(res, await verifyCheckout(req.body, req.tenant.clinicId));
}));

/** Cash / card machine / UPI QR at the desk, recorded by authorised staff. */
router.post('/invoices/:id/record-payment', requirePermission('payment:create'), validate(z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(['CASH', 'UPI', 'CARD', 'NETBANKING', 'WALLET']).default('CASH'),
  reference: z.string().max(80).optional(),
})), catchAsync(async (req, res) => {
  const invoice = await scoped(Invoice, req).findById(req.params.id);
  if (!invoice || invoice.status === 'VOID') throw ApiError.notFound('Invoice not found');
  const result = await recordDeskPayment({
    clinicId: req.tenant.clinicId, invoice, amount: round2(req.body.amount), method: req.body.method,
    reference: req.body.reference, userId: req.user._id,
  });
  recordAudit(req, { action: 'PAYMENT_RECORDED', entityType: 'Payment', entityId: result.payment._id, after: { amount: result.payment.amount, method: result.payment.method } });
  created(res, result);
}));

// ------------------------------------------------------------------ Payments

router.get('/payments', requirePermission('payment:read'), catchAsync(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 25);
  const f = { ...branchFilter(req) };
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.method) f.method = req.query.method;
  if (req.query.gateway) f.gateway = req.query.gateway;
  if (req.query.refunds === 'true') f['refunds.0'] = { $exists: true };
  if (req.query.from || req.query.to) {
    f.createdAt = {};
    if (req.query.from) f.createdAt.$gte = dayjs.tz(req.query.from, TZ).startOf('day').toDate();
    if (req.query.to) f.createdAt.$lte = dayjs.tz(req.query.to, TZ).endOf('day').toDate();
  }
  const db = scoped(Payment, req);
  const [items, total] = await Promise.all([
    db.find(f).sort('-createdAt').skip((page - 1) * limit).limit(limit)
      .select('-rawWebhookPayload')
      .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone'))
      .populate(tenantPopulate(req.tenant.clinicId, 'invoiceId', 'invoiceNumber total')),
    db.countDocuments(f),
  ]);
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
}));

router.post('/payments/:id/refund', requirePermission('refund:create'), validate(z.object({
  amount: z.number().positive(), reason: z.string().trim().min(3).max(300),
})), catchAsync(async (req, res) => {
  const payment = await refundPayment({
    clinicId: req.tenant.clinicId, paymentId: req.params.id, amount: round2(req.body.amount), reason: req.body.reason, userId: req.user._id,
  });
  recordAudit(req, { action: 'REFUND_ISSUED', entityType: 'Payment', entityId: payment._id, after: { amount: req.body.amount, reason: req.body.reason } });
  ok(res, payment);
}));

// ------------------------------------------------------------------ Reports

router.get('/outstanding', requirePermission('invoice:read'), catchAsync(async (req, res) => {
  const items = await scoped(Invoice, req).find({ ...branchFilter(req), status: { $in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } })
    .sort('createdAt').limit(500).populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone'));
  const rows = items.map((i) => ({ ...i.toObject(), balance: round2(i.total - i.amountPaid), ageDays: dayjs().diff(i.createdAt, 'day') }));
  ok(res, { total: round2(rows.reduce((s, r) => s + r.balance, 0)), count: rows.length, items: rows });
}));

/** Collections by day, method and service over a date range (default: this month). */
router.get('/reports/summary', requirePermission('billing:read'), catchAsync(async (req, res) => {
  const from = dayjs.tz(req.query.from || dayjs().tz(TZ).startOf('month').format('YYYY-MM-DD'), TZ).startOf('day');
  const to = dayjs.tz(req.query.to || dayjs().tz(TZ).format('YYYY-MM-DD'), TZ).endOf('day');
  const range = { $gte: from.toDate(), $lte: to.toDate() };
  const match = { ...branchFilter(req), status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, verifiedAt: range };
  const db = scoped(Payment, req);
  const [byDay, byMethod, refunds, byService, invoiced] = await Promise.all([
    db.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$verifiedAt', timezone: TZ } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    db.aggregate([{ $match: match }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    db.aggregate([{ $match: { ...branchFilter(req), 'refunds.0': { $exists: true } } }, { $unwind: '$refunds' },
      { $match: { 'refunds.status': 'PROCESSED', 'refunds.at': range } }, { $group: { _id: null, amount: { $sum: '$refunds.amount' }, count: { $sum: 1 } } }]),
    scoped(Invoice, req).aggregate([{ $match: { ...branchFilter(req), createdAt: range, status: { $nin: ['VOID', 'DRAFT'] } } }, { $unwind: '$lineItems' },
      { $group: { _id: '$lineItems.description', amount: { $sum: '$lineItems.amount' }, count: { $sum: '$lineItems.quantity' } } }, { $sort: { amount: -1 } }, { $limit: 20 }]),
    scoped(Invoice, req).aggregate([{ $match: { ...branchFilter(req), createdAt: range, status: { $nin: ['VOID', 'DRAFT'] } } },
      { $group: { _id: null, total: { $sum: '$total' }, gst: { $sum: '$gstAmount' }, paid: { $sum: '$amountPaid' }, count: { $sum: 1 } } }]),
  ]);
  const collected = byDay.reduce((s, d) => s + d.amount, 0);
  ok(res, {
    range: { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') },
    collected: round2(collected),
    refunded: round2(refunds[0]?.amount || 0),
    net: round2(collected - (refunds[0]?.amount || 0)),
    invoiced: round2(invoiced[0]?.total || 0),
    gstCollected: round2(invoiced[0]?.gst || 0),
    invoiceCount: invoiced[0]?.count || 0,
    byDay: byDay.map((d) => ({ date: d._id, amount: round2(d.amount), count: d.count })),
    byMethod: byMethod.map((m) => ({ method: m._id, amount: round2(m.amount), count: m.count })),
    byService: byService.map((s) => ({ service: s._id, amount: round2(s.amount), count: s.count })),
  });
}));

/**
 * Reconciliation: gateway payments whose state needs a human — started but
 * never confirmed, failed, or refunds still pending at the gateway.
 */
router.get('/reconciliation', requirePermission('billing:read'), catchAsync(async (req, res) => {
  const stale = dayjs().subtract(30, 'minute').toDate();
  const [unconfirmed, failed, pendingRefunds] = await Promise.all([
    scoped(Payment, req).find({ gateway: 'RAZORPAY', status: { $in: ['CREATED', 'PENDING'] }, createdAt: { $lt: stale } }).sort('-createdAt').limit(100)
      .populate(tenantPopulate(req.tenant.clinicId, 'invoiceId', 'invoiceNumber')),
    scoped(Payment, req).find({ status: 'FAILED' }).sort('-createdAt').limit(100).populate(tenantPopulate(req.tenant.clinicId, 'invoiceId', 'invoiceNumber')),
    scoped(Payment, req).find({ 'refunds.status': 'PENDING' }).sort('-updatedAt').limit(100),
  ]);
  ok(res, { gatewayConfigured: gatewayEnabled(), unconfirmed, failed, pendingRefunds });
}));

/** CSV export of payments or invoices for the accountant's books. */
router.get('/export/:kind.csv', requirePermission('billing:read'), catchAsync(async (req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let header; let rows;
  if (req.params.kind === 'payments') {
    const items = await scoped(Payment, req).find({ ...branchFilter(req), status: { $ne: 'CREATED' } }).sort('-createdAt').limit(5000)
      .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name')).populate(tenantPopulate(req.tenant.clinicId, 'invoiceId', 'invoiceNumber'));
    header = ['Date', 'Receipt', 'Invoice', 'Patient', 'Method', 'Gateway', 'Status', 'Amount', 'Refunded'];
    rows = items.map((p) => [dayjs(p.verifiedAt || p.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm'), p.receiptNumber, p.invoiceId?.invoiceNumber, p.patientId?.name, p.method, p.gateway, p.status, p.amount, p.refundedAmount || 0]);
  } else if (req.params.kind === 'invoices') {
    const items = await scoped(Invoice, req).find(listFilter(req)).sort('-createdAt').limit(5000).populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name'));
    header = ['Date', 'Invoice', 'Patient', 'Subtotal', 'Discount', 'GST', 'Total', 'Paid', 'Refunded', 'Status', 'GSTIN'];
    rows = items.map((i) => [dayjs(i.createdAt).tz(TZ).format('YYYY-MM-DD'), i.invoiceNumber, i.patientId?.name, i.subtotal, i.discount, i.gstAmount, i.total, i.amountPaid, i.refundedAmount || 0, i.status, i.gstin]);
  } else {
    throw ApiError.notFound('Unknown export');
  }
  recordAudit(req, { action: 'FINANCE_EXPORTED', entityType: req.params.kind });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.kind}-${dayjs().format('YYYYMMDD')}.csv"`);
  res.send([header, ...rows].map((r) => r.map(esc).join(',')).join('\n'));
}));

export default router;
