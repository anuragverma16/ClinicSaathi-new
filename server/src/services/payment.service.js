import { Payment, Invoice, Appointment } from '../models/index.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { emit, EVENTS } from './events.js';
import { notifyStaff } from './notify.service.js';
import { createRefund, gatewayEnabled } from '../integrations/razorpay.js';
import { slotKeyFor } from '../utils/slots.js';
import { blockingOverlapFilter } from './availability.service.js';

const round2 = (n) => Math.round(n * 100) / 100;

export async function nextReceiptNumber(clinicId) {
  const year = new Date().getFullYear();
  const seq = await nextSequence(`receipt:${clinicId}:${year}`);
  return `RCP-${year}-${String(seq).padStart(5, '0')}`;
}

/**
 * A refund returns money; it doesn't make the bill owed again. So "paid" is
 * judged on amountPaid, and an invoice is REFUNDED only once everything
 * collected on it has gone back.
 */
export function invoiceStatusFor(inv) {
  if (inv.status === 'VOID') return 'VOID';
  if (inv.amountPaid > 0 && (inv.refundedAmount || 0) >= inv.amountPaid - 0.005) return 'REFUNDED';
  if (inv.amountPaid >= inv.total - 0.005) return 'PAID';
  if (inv.amountPaid > 0) return 'PARTIAL';
  return 'UNPAID';
}

/**
 * Credits a payment to its invoice exactly once. The amount is added with an
 * atomic $inc, guarded so it can never push the invoice past its total.
 */
async function creditInvoice(clinicId, invoiceId, amount) {
  const invoice = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: { $ne: 'VOID' }, $expr: { $lte: [{ $add: ['$amountPaid', amount] }, { $add: ['$total', 0.01] }] } },
    { $inc: { amountPaid: amount } },
    { new: true }
  ).setOptions({ clinicId });
  if (!invoice) return null;
  invoice.status = invoiceStatusFor(invoice);
  await Invoice.updateOne({ _id: invoice._id }, { status: invoice.status }).setOptions({ clinicId });
  if (invoice.appointmentId) {
    await Appointment.updateOne({ _id: invoice.appointmentId }, { paymentStatus: invoice.status === 'PAID' ? 'PAID' : 'PARTIAL' })
      .setOptions({ clinicId });
  }
  return invoice;
}

/**
 * A prepaid booking's hold may have lapsed before the money arrived. Confirm
 * it if the slot is still free; otherwise flag it so staff refund or rebook.
 */
async function confirmPrepaidAppointment(clinicId, appointmentId) {
  const appt = await Appointment.findOne({ _id: appointmentId }).setOptions({ clinicId });
  if (!appt) return;
  if (appt.status === 'REQUESTED') {
    const confirmed = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: 'REQUESTED' },
      { status: 'CONFIRMED', paymentStatus: 'PAID', $unset: { holdExpiresAt: 1 } }, { new: true }
    ).setOptions({ clinicId });
    if (confirmed) emit(EVENTS.APPOINTMENT_CONFIRMED, { appointment: confirmed });
    return;
  }
  if (appt.status === 'CANCELLED' && appt.cancelledBy === 'SYSTEM') {
    const clash = await Appointment.exists(blockingOverlapFilter({ doctorId: appt.doctorId, startAt: appt.startAt, endAt: appt.endAt, excludeId: appt._id }))
      .setOptions({ clinicId });
    if (!clash && appt.startAt > new Date()) {
      try {
        const revived = await Appointment.findOneAndUpdate(
          { _id: appt._id, status: 'CANCELLED' },
          { status: 'CONFIRMED', paymentStatus: 'PAID', slotKey: slotKeyFor(appt.startAt), $unset: { cancelledAt: 1, cancelReason: 1, cancelledBy: 1, holdExpiresAt: 1 } },
          { new: true }
        ).setOptions({ clinicId });
        if (revived) { emit(EVENTS.APPOINTMENT_CONFIRMED, { appointment: revived }); return; }
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    await notifyStaff({
      clinicId, role: 'ACCOUNTANT', type: 'PAYMENT_ORPHANED',
      title: 'Payment received after the booking hold expired — refund or rebook the patient',
      link: '/clinic/accounts/payments',
    });
  }
}

/**
 * The only path to a SUCCESS online payment. Called by the verified webhook
 * and by the verified checkout callback; whichever arrives second is a no-op
 * because the status flip is conditional.
 */
export async function settleGatewayPayment({ orderId, gatewayPaymentId, via, raw }) {
  const payment = await Payment.findOneAndUpdate(
    { gatewayOrderId: orderId, status: { $in: ['CREATED', 'PENDING', 'FAILED'] } },
    { status: 'SUCCESS', gatewayPaymentId, verifiedAt: new Date(), verifiedVia: via, ...(raw ? { rawWebhookPayload: raw } : {}) },
    { new: true }
  ).setOptions({ crossTenant: true });
  if (!payment) {
    const existing = await Payment.findOne({ gatewayOrderId: orderId }).setOptions({ crossTenant: true });
    return { payment: existing, alreadySettled: existing?.status === 'SUCCESS' };
  }
  const clinicId = payment.clinicId;
  payment.receiptNumber = await nextReceiptNumber(clinicId);
  await Payment.updateOne({ _id: payment._id }, { receiptNumber: payment.receiptNumber }).setOptions({ clinicId });

  const invoice = payment.invoiceId ? await creditInvoice(clinicId, payment.invoiceId, payment.amount) : null;
  if (payment.invoiceId && !invoice) {
    await notifyStaff({ clinicId, role: 'ACCOUNTANT', type: 'PAYMENT_MISMATCH', title: `Payment ${payment.receiptNumber} exceeds the invoice balance — review it`, link: '/clinic/accounts/reconciliation' });
  }
  if (invoice?.appointmentId && invoice.status === 'PAID') await confirmPrepaidAppointment(clinicId, invoice.appointmentId);

  emit(EVENTS.PAYMENT_SUCCEEDED, { payment, clinicId });
  return { payment, invoice };
}

export async function markGatewayPaymentFailed({ orderId, reason }) {
  return Payment.findOneAndUpdate(
    { gatewayOrderId: orderId, status: { $in: ['CREATED', 'PENDING'] } },
    { status: 'FAILED', failureReason: String(reason || 'Payment failed').slice(0, 300) },
    { new: true }
  ).setOptions({ crossTenant: true });
}

/** Staff-recorded desk payment (cash, card machine, UPI QR). Settles immediately. */
export async function recordDeskPayment({ clinicId, invoice, amount, method, reference, userId }) {
  const due = round2(invoice.total - invoice.amountPaid);
  if (amount > due + 0.005) throw ApiError.badRequest(`Only ₹${due} is due on this invoice`, 'AMOUNT_EXCEEDS_DUE');
  const updated = await creditInvoice(clinicId, invoice._id, amount);
  if (!updated) throw ApiError.conflict('The invoice changed. Refresh and try again.', 'CONCURRENT_UPDATE');
  const payment = await Payment.create({
    clinicId, branchId: invoice.branchId, invoiceId: invoice._id, patientId: invoice.patientId, amount, method,
    gateway: 'OFFLINE', status: 'SUCCESS', verifiedAt: new Date(), verifiedVia: 'STAFF',
    receiptNumber: await nextReceiptNumber(clinicId), reference, recordedByUserId: userId,
  });
  if (updated.appointmentId && updated.status === 'PAID') await confirmPrepaidAppointment(clinicId, updated.appointmentId);
  emit(EVENTS.PAYMENT_SUCCEEDED, { payment, clinicId });
  return { payment, invoice: updated };
}

/**
 * Refunds. Cash refunds are recorded as processed by the staff member; gateway
 * refunds are requested from Razorpay and stay PENDING until its webhook.
 */
export async function refundPayment({ clinicId, paymentId, amount, reason, userId }) {
  const payment = await Payment.findOne({ _id: paymentId }).setOptions({ clinicId });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw ApiError.badRequest('Only a successful payment can be refunded', 'NOT_REFUNDABLE');
  const pendingOrDone = payment.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amount, 0);
  const refundable = round2(payment.amount - pendingOrDone);
  if (amount <= 0 || amount > refundable + 0.005) throw ApiError.badRequest(`You can refund up to ₹${refundable}`, 'REFUND_TOO_LARGE');

  const entry = { amount, reason, byUserId: userId, status: 'PENDING' };
  if (payment.gateway === 'RAZORPAY') {
    if (!gatewayEnabled()) throw new ApiError(503, 'The payment gateway is not configured', 'GATEWAY_NOT_CONFIGURED');
    const refund = await createRefund({ paymentId: payment.gatewayPaymentId, amountPaise: Math.round(amount * 100), notes: { reason } });
    entry.gatewayRefundId = refund.id;
    if (refund.status === 'processed') entry.status = 'PROCESSED';
  } else {
    entry.status = 'PROCESSED';
  }
  payment.refunds.push(entry);
  await payment.save();
  if (entry.status === 'PROCESSED') await applyProcessedRefund(clinicId, payment, amount);
  return Payment.findOne({ _id: payment._id }).setOptions({ clinicId });
}

export async function applyProcessedRefund(clinicId, payment, amount) {
  const refunded = round2((payment.refundedAmount || 0) + amount);
  await Payment.updateOne({ _id: payment._id }, {
    refundedAmount: refunded, status: refunded >= payment.amount - 0.005 ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
  }).setOptions({ clinicId });
  if (payment.invoiceId) {
    const inv = await Invoice.findOneAndUpdate({ _id: payment.invoiceId }, { $inc: { refundedAmount: amount } }, { new: true }).setOptions({ clinicId });
    if (inv) {
      const status = invoiceStatusFor(inv);
      await Invoice.updateOne({ _id: inv._id }, { status }).setOptions({ clinicId });
      if (inv.appointmentId && status === 'REFUNDED') await Appointment.updateOne({ _id: inv.appointmentId }, { paymentStatus: 'REFUNDED' }).setOptions({ clinicId });
    }
  }
}

/** Razorpay refund webhook: mark the matching refund entry processed exactly once. */
export async function settleGatewayRefund({ gatewayRefundId, status }) {
  const payment = await Payment.findOne({ 'refunds.gatewayRefundId': gatewayRefundId }).setOptions({ crossTenant: true });
  if (!payment) return null;
  const target = status === 'processed' ? 'PROCESSED' : 'FAILED';
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, refunds: { $elemMatch: { gatewayRefundId, status: 'PENDING' } } },
    { $set: { 'refunds.$.status': target } }, { new: true }
  ).setOptions({ clinicId: payment.clinicId });
  if (!updated) return payment;   // duplicate delivery
  const entry = updated.refunds.find((r) => r.gatewayRefundId === gatewayRefundId);
  if (target === 'PROCESSED') await applyProcessedRefund(payment.clinicId, updated, entry.amount);
  return updated;
}
