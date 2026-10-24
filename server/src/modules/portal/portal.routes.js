import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import {
  Patient, Appointment, Prescription, LabOrder, MedicalCertificate, MedicalDocument, Invoice, Payment, Doctor, Service,
  Clinic, QueueToken, AIConversation,
} from '../../models/index.js';
import { tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { ROLES } from '../../config/constants.js';
import { portalPatientIds, resolvePortalPatient } from '../../services/access.service.js';
import { bookAppointment, cancelAppointment, rescheduleAppointment } from '../../services/appointment.service.js';
import { getAvailability } from '../../services/availability.service.js';
import { getQueue } from '../../services/queue.service.js';
import { handleMessage } from '../../ai/receptionist.js';
import { createOrder, publicKeyId, gatewayEnabled } from '../../integrations/razorpay.js';
import { verifyCheckout, startPrepayment } from '../billing/billing.routes.js';
import { dateKey, TZ } from '../../utils/slots.js';

const router = Router();
router.use(requireRole(ROLES.PATIENT));

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const opts = (req) => ({ clinicId: req.tenant.clinicId });
const family = async (req) => ({ $in: await portalPatientIds(req) });

router.get('/me', catchAsync(async (req, res) => {
  const ids = await portalPatientIds(req);
  const [self, dependents, clinic] = await Promise.all([
    Patient.findOne({ _id: ids[0] }).select('name phone email gender dob bloodGroup allergies address communicationPrefs consent').setOptions(opts(req)),
    Patient.find({ _id: { $in: ids.slice(1) } }).select('name gender dob relationToGuardian').setOptions(opts(req)),
    Clinic.findById(req.tenant.clinicId).select('name slug phone address timings bookingPolicy').lean(),
  ]);
  ok(res, { patient: self, dependents, clinic });
}));

router.patch('/me', validate(z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dob: z.string(),
  address: z.object({ line1: z.string().max(200), city: z.string().max(80), state: z.string().max(80), pincode: z.string().max(10) }).partial(),
  communicationPrefs: z.object({ whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean(), optOutAll: z.boolean() }).partial(),
  marketingConsent: z.boolean(),
}).partial()), catchAsync(async (req, res) => {
  const { marketingConsent, communicationPrefs, ...rest } = req.body;
  const set = { ...rest };
  if (set.email === '') delete set.email;
  if (communicationPrefs) {
    for (const [k, v] of Object.entries(communicationPrefs)) set[`communicationPrefs.${k}`] = v;
    if (communicationPrefs.optOutAll) set['communicationPrefs.optedOutAt'] = new Date();
  }
  if (marketingConsent !== undefined) set['consent.marketing'] = { granted: marketingConsent, grantedAt: new Date() };
  const patient = await Patient.findOneAndUpdate({ _id: req.tenant.patientId }, { $set: set }, { new: true }).setOptions(opts(req));
  recordAudit(req, { action: 'PATIENT_PROFILE_UPDATED', entityType: 'Patient', entityId: patient._id, after: { fields: Object.keys(req.body) } });
  ok(res, patient);
}));

router.post('/dependents', validate(z.object({
  name: z.string().trim().min(2).max(80), gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dob: z.string().optional(), relationToGuardian: z.string().trim().min(2).max(30),
})), catchAsync(async (req, res) => {
  const self = await Patient.findOne({ _id: req.tenant.patientId }).setOptions(opts(req));
  const count = await Patient.countDocuments({ guardianPatientId: self._id }).setOptions(opts(req));
  if (count >= 10) throw ApiError.badRequest('You can add up to 10 family members');
  const dep = await Patient.create({
    ...req.body, clinicId: req.tenant.clinicId, phone: self.phone, guardianPatientId: self._id,
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'portal-guardian-v1' }, marketing: { granted: false } },
  });
  recordAudit(req, { action: 'DEPENDENT_ADDED', entityType: 'Patient', entityId: dep._id });
  created(res, dep);
}));

// ------------------------------------------------------------------ Booking

router.get('/doctors', catchAsync(async (req, res) => {
  const [doctors, services] = await Promise.all([
    Doctor.find({ isActive: true }).select('name specialization qualification consultationFee slotDurationMins photoUrl').setOptions(opts(req)),
    Service.find({ isActive: true }).select('name description fee durationMins').setOptions(opts(req)),
  ]);
  ok(res, { doctors, services });
}));

router.get('/availability', catchAsync(async (req, res) => {
  if (!req.query.doctorId) throw ApiError.badRequest('Pick a doctor first');
  let duration;
  if (req.query.serviceId) duration = (await Service.findOne({ _id: req.query.serviceId }).setOptions(opts(req)))?.durationMins;
  ok(res, await getAvailability({ clinicId: req.tenant.clinicId, doctorId: req.query.doctorId, date: req.query.date || dayjs().tz(TZ).format('YYYY-MM-DD'), serviceDurationMins: duration }));
}));

router.get('/appointments', catchAsync(async (req, res) => {
  const items = await Appointment.find({ patientId: await family(req), status: { $ne: 'RESCHEDULED' } }).sort('-startAt').limit(100)
    .populate(tenantPopulate(req.tenant.clinicId, 'doctorId', 'name specialization'))
    .populate(tenantPopulate(req.tenant.clinicId, 'serviceId', 'name'))
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name'))
    .select('-slotKey -notes -createdByUserId').setOptions(opts(req));
  ok(res, items);
}));

router.post('/appointments', validate(z.object({
  doctorId: objectId, serviceId: objectId.optional(), startAt: z.string().min(10), reason: z.string().max(300).optional(),
  patientId: objectId.optional(),
})), catchAsync(async (req, res) => {
  const patientId = await resolvePortalPatient(req, req.body.patientId);
  const clinic = await Clinic.findById(req.tenant.clinicId).select('bookingPolicy').lean();
  if (clinic?.bookingPolicy?.allowOnlineBooking === false) throw ApiError.forbidden('This clinic takes bookings by phone only', 'ONLINE_BOOKING_OFF');
  const prepay = clinic?.bookingPolicy?.requirePrepayment && gatewayEnabled();
  const appointment = await bookAppointment({
    clinicId: req.tenant.clinicId, patientId, doctorId: req.body.doctorId, serviceId: req.body.serviceId,
    startAt: req.body.startAt, reason: req.body.reason, source: 'PORTAL', createdByUserId: req.user._id,
    holdMinutes: prepay ? clinic.bookingPolicy.holdMinutes || 15 : undefined, enforceAdvanceWindow: true,
  });
  const payment = appointment.paymentRequired ? await startPrepayment(req, appointment) : null;
  recordAudit(req, { action: 'APPOINTMENT_BOOKED_BY_PATIENT', entityType: 'Appointment', entityId: appointment._id });
  created(res, { appointment, payment });
}));

/** Patients may change a booking only up to the clinic's cutoff before it starts. */
async function assertWithinPolicy(req, appointmentId, kind) {
  const appt = await Appointment.findOne({ _id: appointmentId, patientId: await family(req) }).setOptions(opts(req));
  if (!appt) throw ApiError.notFound('Appointment not found');
  const clinic = await Clinic.findById(req.tenant.clinicId).select('bookingPolicy phone').lean();
  const cutoff = kind === 'cancel' ? clinic?.bookingPolicy?.cancelCutoffHours ?? 2 : clinic?.bookingPolicy?.rescheduleCutoffHours ?? 2;
  if (dayjs(appt.startAt).diff(dayjs(), 'minute') < cutoff * 60) {
    throw ApiError.badRequest(`Changes are allowed up to ${cutoff} hours before the appointment. Please call the clinic${clinic?.phone ? ` on ${clinic.phone}` : ''}.`, 'POLICY_CUTOFF');
  }
  return appt;
}

router.post('/appointments/:id/cancel', validate(z.object({ reason: z.string().max(300).optional() })), catchAsync(async (req, res) => {
  const appt = await assertWithinPolicy(req, req.params.id, 'cancel');
  const updated = await cancelAppointment({
    clinicId: req.tenant.clinicId, appointmentId: appt._id, reason: req.body.reason || 'Cancelled by patient',
    cancelledBy: 'PATIENT', patientId: appt.patientId, actorUserId: req.user._id,
  });
  recordAudit(req, { action: 'APPOINTMENT_CANCELLED_BY_PATIENT', entityType: 'Appointment', entityId: appt._id });
  ok(res, updated);
}));

router.post('/appointments/:id/reschedule', validate(z.object({ startAt: z.string().min(10) })), catchAsync(async (req, res) => {
  const appt = await assertWithinPolicy(req, req.params.id, 'reschedule');
  const fresh = await rescheduleAppointment({
    clinicId: req.tenant.clinicId, appointmentId: appt._id, newStartAt: req.body.startAt, patientId: appt.patientId, actorUserId: req.user._id,
  });
  recordAudit(req, { action: 'APPOINTMENT_RESCHEDULED_BY_PATIENT', entityType: 'Appointment', entityId: fresh._id });
  ok(res, fresh);
}));

/** Live queue position for the patient's checked-in visit today, if any. */
router.get('/queue', catchAsync(async (req, res) => {
  const ids = await portalPatientIds(req);
  const mine = await QueueToken.find({ patientId: { $in: ids }, queueDate: dateKey(new Date()), status: { $in: ['WAITING', 'CALLED', 'IN_CONSULTATION'] } })
    .select('doctorId tokenNumber').setOptions(opts(req)).lean();
  const out = [];
  for (const t of mine) {
    const queue = await getQueue({ clinicId: req.tenant.clinicId, doctorId: t.doctorId });
    const me = queue.find((q) => String(q._id) === String(t._id));
    if (me) out.push({ tokenNumber: me.tokenNumber, status: me.status, patientsAhead: me.patientsAhead, estimatedWaitMins: me.estimatedWaitMins, doctor: me.doctorId?.name });
  }
  ok(res, out);
}));

// ------------------------------------------------------------------ Records (released only)

router.get('/records', catchAsync(async (req, res) => {
  const patientId = await family(req);
  const c = req.tenant.clinicId;
  const [prescriptions, labReports, certificates, documents] = await Promise.all([
    Prescription.find({ patientId, status: 'FINAL' }).sort('-finalizedAt').select('rxNumber medicines advice finalizedAt doctorId patientId')
      .populate(tenantPopulate(c, 'doctorId', 'name')).populate(tenantPopulate(c, 'patientId', 'name')).setOptions(opts(req)),
    LabOrder.find({ patientId, status: 'VERIFIED' }).sort('-verifiedAt').select('orderNumber tests results verifiedAt doctorId patientId report.fileName')
      .populate(tenantPopulate(c, 'doctorId', 'name')).populate(tenantPopulate(c, 'patientId', 'name')).setOptions(opts(req)),
    MedicalCertificate.find({ patientId, status: 'ISSUED' }).sort('-issuedAt').select('certificateNumber type fromDate toDate issuedAt patientId')
      .populate(tenantPopulate(c, 'patientId', 'name')).setOptions(opts(req)),
    MedicalDocument.find({ patientId, sharedWithPatient: true }).sort('-createdAt').select('title category fileName createdAt patientId')
      .populate(tenantPopulate(c, 'patientId', 'name')).setOptions(opts(req)),
  ]);
  ok(res, { prescriptions, labReports, certificates, documents });
}));

router.get('/billing', catchAsync(async (req, res) => {
  const patientId = await family(req);
  const [invoices, payments] = await Promise.all([
    Invoice.find({ patientId, status: { $nin: ['DRAFT', 'VOID'] } }).sort('-createdAt').limit(100).setOptions(opts(req)),
    Payment.find({ patientId, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }).sort('-verifiedAt').limit(100)
      .select('amount method receiptNumber verifiedAt status refundedAmount invoiceId').setOptions(opts(req)),
  ]);
  ok(res, { invoices, payments, onlinePayments: gatewayEnabled() });
}));

router.post('/invoices/:id/pay', catchAsync(async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, patientId: await family(req), status: { $in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }).setOptions(opts(req));
  if (!invoice) throw ApiError.notFound('Invoice not found');
  const due = Math.round((invoice.total - invoice.amountPaid) * 100) / 100;
  const order = await createOrder({ amountPaise: Math.round(due * 100), receipt: invoice.invoiceNumber, notes: { clinicId: String(req.tenant.clinicId), invoiceId: String(invoice._id) } });
  await Payment.create({ clinicId: req.tenant.clinicId, branchId: invoice.branchId, invoiceId: invoice._id, patientId: invoice.patientId, amount: due, method: 'ONLINE', gateway: 'RAZORPAY', gatewayOrderId: order.id, status: 'CREATED' });
  ok(res, { order: { id: order.id, amount: order.amount, currency: order.currency }, keyId: publicKeyId() });
}));

router.post('/payments/verify', validate(z.object({
  razorpay_order_id: z.string().min(5), razorpay_payment_id: z.string().min(5), razorpay_signature: z.string().min(10),
})), catchAsync(async (req, res) => {
  const pay = await Payment.findOne({ gatewayOrderId: req.body.razorpay_order_id, patientId: await family(req) }).setOptions(opts(req));
  if (!pay) throw ApiError.notFound('Payment not found');
  const result = await verifyCheckout(req.body, req.tenant.clinicId);
  ok(res, { status: result.pending ? 'PENDING' : 'SUCCESS' });
}));

// ------------------------------------------------------------------ Assistant

router.post('/assistant', validate(z.object({ message: z.string().trim().min(1).max(1000) })), catchAsync(async (req, res) => {
  const clinic = await Clinic.findById(req.tenant.clinicId).select('name').lean();
  const externalId = `portal:${req.user._id}`;
  let convo = await AIConversation.findOne({ externalId }).setOptions(opts(req));
  if (!convo) convo = await AIConversation.create({ clinicId: req.tenant.clinicId, externalId, channel: 'WEB', patientId: req.tenant.patientId, messages: [] });
  const out = await handleMessage({
    clinicId: req.tenant.clinicId, clinicName: clinic.name, conversationId: convo._id, patientId: req.tenant.patientId, text: req.body.message, channel: 'WEB',
  });
  ok(res, { reply: out.reply, suggestions: out.suggestions || [], emergency: Boolean(out.emergency), booked: out.booked || null });
}));

export default router;
