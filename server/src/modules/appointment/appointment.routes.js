import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Appointment, Patient } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, branchFilter } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import {
  bookAppointment, cancelAppointment, rescheduleAppointment, confirmAppointment, createWalkIn,
} from '../../services/appointment.service.js';
import { getAvailability } from '../../services/availability.service.js';
import { checkIn } from '../../services/queue.service.js';
import { getEntitlements } from '../../services/plans.service.js';
import { APPOINTMENT_STATUS, CHANGEABLE_STATUSES, ROLES } from '../../config/constants.js';
import { TZ } from '../../utils/slots.js';
import { normalisePhone } from '../../services/otp.service.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const newPatientSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(15),
  email: z.string().email().optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dob: z.string().optional(),
});

const bookSchema = z.object({
  patientId: objectId.optional(),
  // Let reception create the patient inline rather than in two steps.
  newPatient: newPatientSchema.optional(),
  doctorId: objectId,
  serviceId: objectId.optional(),
  startAt: z.string().min(10),
  mode: z.enum(['OFFLINE', 'ONLINE']).optional(),
  source: z.enum(['RECEPTION', 'PHONE', 'WALK_IN', 'WEBSITE', 'WHATSAPP']).optional(),
  reason: z.string().max(500).optional(),
}).refine((d) => d.patientId || d.newPatient, { message: 'Choose a patient or enter new patient details' });

const walkInSchema = z.object({
  patientId: objectId.optional(),
  newPatient: newPatientSchema.optional(),
  doctorId: objectId,
  serviceId: objectId.optional(),
  reason: z.string().max(500).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  emergency: z.boolean().optional(),
}).refine((d) => d.patientId || d.newPatient, { message: 'Choose a patient or enter new patient details' });

/** Finds an existing self-record by phone or creates one — no duplicates per clinic. */
async function resolvePatient(req, { patientId, newPatient }) {
  if (patientId) {
    const p = await scoped(Patient, req).findById(patientId);
    if (!p) throw ApiError.notFound('Patient not found');
    return p._id;
  }
  const phone = normalisePhone(newPatient.phone);
  const existing = await scoped(Patient, req).findOne({ phone, guardianPatientId: { $exists: false } });
  if (existing) return existing._id;
  const p = await scoped(Patient, req).create({
    ...newPatient, phone, email: newPatient.email || undefined, dob: newPatient.dob || undefined,
    branchId: req.tenant.branchId || undefined,
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'desk-v1' }, marketing: { granted: false } },
  });
  recordAudit(req, { action: 'PATIENT_CREATED', entityType: 'Patient', entityId: p._id });
  return p._id;
}

/** Doctors only ever see their own appointments; branch staff only their branch. */
function scopeFilter(req) {
  const f = { ...branchFilter(req) };
  if (req.user.role === ROLES.DOCTOR) f.doctorId = req.user.doctorId || null;
  return f;
}

async function findScoped(req, id) {
  const appt = await scoped(Appointment, req).findOne({ _id: id, ...scopeFilter(req) });
  if (!appt) throw ApiError.notFound('Appointment not found');
  return appt;
}

router.get('/availability', requirePermission('appointment:read'), catchAsync(async (req, res) => {
  const { doctorId, date, serviceDurationMins } = req.query;
  if (!doctorId) throw ApiError.badRequest('doctorId is required');
  ok(res, await getAvailability({
    clinicId: req.tenant.clinicId,
    doctorId,
    date: date || dayjs().tz(TZ).format('YYYY-MM-DD'),
    serviceDurationMins: serviceDurationMins ? Number(serviceDurationMins) : undefined,
  }));
}));

router.get('/', requirePermission('appointment:read'), catchAsync(async (req, res) => {
  const { date, from, to, status, doctorId, patientId, serviceId, q, upcoming } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const filter = {};
  const dayStart = (d) => dayjs.tz(d, TZ).startOf('day').toDate();
  const dayEnd = (d) => dayjs.tz(d, TZ).endOf('day').toDate();
  if (date) {
    filter.startAt = { $gte: dayStart(date), $lte: dayEnd(date) };
  } else if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = dayStart(from);
    if (to) filter.startAt.$lte = dayEnd(to);
  } else if (upcoming === 'true') {
    filter.startAt = { $gte: new Date() };
  }
  if (status) filter.status = { $in: String(status).split(',') };
  if (doctorId) filter.doctorId = doctorId;
  if (patientId) filter.patientId = patientId;
  if (serviceId) filter.serviceId = serviceId;
  if (req.query.source) filter.source = { $in: String(req.query.source).split(',') };
  if (req.query.emergency === 'true') filter.isEmergency = true;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const patients = await scoped(Patient, req).find({ $or: [{ name: rx }, { phone: rx }] }).select('_id').limit(200);
    filter.$or = [{ patientId: { $in: patients.map((p) => p._id) } }, { bookingRef: rx }];
  }
  Object.assign(filter, scopeFilter(req));

  const clinicId = req.tenant.clinicId;
  const db = scoped(Appointment, req);
  const [items, total] = await Promise.all([
    db.find(filter).sort(upcoming === 'true' || date ? 'startAt' : '-startAt').skip((page - 1) * limit).limit(limit)
      .populate(tenantPopulate(clinicId, 'patientId', 'name phone gender dob'))
      .populate(tenantPopulate(clinicId, 'doctorId', 'name specialization'))
      .populate(tenantPopulate(clinicId, 'serviceId', 'name fee')),
    db.countDocuments(filter),
  ]);
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
}));

router.get('/:id', requirePermission('appointment:read'), catchAsync(async (req, res) => {
  const appt = await findScoped(req, req.params.id);
  const clinicId = req.tenant.clinicId;
  await appt.populate([
    tenantPopulate(clinicId, 'patientId', 'name phone email gender dob'),
    tenantPopulate(clinicId, 'doctorId', 'name specialization'),
    tenantPopulate(clinicId, 'serviceId', 'name fee durationMins'),
  ]);
  ok(res, appt);
}));

router.post('/', requirePermission('appointment:create'), validate(bookSchema), catchAsync(async (req, res) => {
  const patientId = await resolvePatient(req, req.body);
  const appointment = await bookAppointment({
    clinicId: req.tenant.clinicId,
    branchId: req.tenant.branchId,
    patientId,
    doctorId: req.body.doctorId,
    serviceId: req.body.serviceId,
    startAt: req.body.startAt,
    mode: req.body.mode,
    source: req.body.source || 'RECEPTION',
    reason: req.body.reason,
    createdByUserId: req.user._id,
  });
  recordAudit(req, { action: 'APPOINTMENT_CREATED', entityType: 'Appointment', entityId: appointment._id });
  created(res, appointment);
}));

/** Walk-in: register (or find) the patient, open a visit now and issue a token. */
router.post('/walk-in', requirePermission('appointment:create'), validate(walkInSchema), catchAsync(async (req, res) => {
  const patientId = await resolvePatient(req, req.body);
  const appointment = await createWalkIn({
    clinicId: req.tenant.clinicId, branchId: req.tenant.branchId, patientId,
    doctorId: req.body.doctorId, serviceId: req.body.serviceId, reason: req.body.reason, createdByUserId: req.user._id,
    isEmergency: Boolean(req.body.emergency),
  });
  let token = null;
  const ent = await getEntitlements(req.tenant.clinicId);
  if (ent.has('queue')) token = await checkIn({ clinicId: req.tenant.clinicId, appointmentId: appointment._id, priority: req.body.emergency ? 10 : (req.body.priority || 0) });
  recordAudit(req, { action: req.body.emergency ? 'EMERGENCY_WALK_IN' : 'WALK_IN_REGISTERED', entityType: 'Appointment', entityId: appointment._id });
  created(res, { appointment, token });
}));

router.post('/:id/confirm', requirePermission('appointment:update'), catchAsync(async (req, res) => {
  await findScoped(req, req.params.id);
  const appointment = await confirmAppointment({ clinicId: req.tenant.clinicId, appointmentId: req.params.id });
  recordAudit(req, { action: 'APPOINTMENT_CONFIRMED', entityType: 'Appointment', entityId: appointment._id });
  ok(res, appointment);
}));

router.post('/:id/cancel', requirePermission('appointment:update'),
  validate(z.object({ reason: z.string().max(300).optional() })), catchAsync(async (req, res) => {
    await findScoped(req, req.params.id);
    const appointment = await cancelAppointment({
      clinicId: req.tenant.clinicId, appointmentId: req.params.id,
      reason: req.body.reason || 'Cancelled by clinic', actorUserId: req.user._id, cancelledBy: 'CLINIC',
    });
    recordAudit(req, { action: 'APPOINTMENT_CANCELLED', entityType: 'Appointment', entityId: appointment._id, after: { reason: req.body.reason } });
    ok(res, appointment);
  }));

router.post('/:id/reschedule', requirePermission('appointment:update'),
  validate(z.object({ startAt: z.string().min(10), doctorId: objectId.optional() })), catchAsync(async (req, res) => {
    await findScoped(req, req.params.id);
    const appointment = await rescheduleAppointment({
      clinicId: req.tenant.clinicId, appointmentId: req.params.id,
      newStartAt: req.body.startAt, newDoctorId: req.body.doctorId, actorUserId: req.user._id,
    });
    recordAudit(req, { action: 'APPOINTMENT_RESCHEDULED', entityType: 'Appointment', entityId: appointment._id, after: { from: req.params.id } });
    ok(res, appointment);
  }));

router.post('/:id/no-show', requirePermission('appointment:update'), catchAsync(async (req, res) => {
  const appt = await findScoped(req, req.params.id);
  if (!CHANGEABLE_STATUSES.includes(appt.status)) throw ApiError.badRequest('Only an upcoming appointment can be marked no-show', 'INVALID_STATUS');
  if (appt.startAt > new Date()) throw ApiError.badRequest('The appointment time has not arrived yet', 'TOO_EARLY');
  const appointment = await scoped(Appointment, req).findOneAndUpdate(
    { _id: appt._id, status: appt.status }, { status: APPOINTMENT_STATUS.NO_SHOW, slotKey: null }, { new: true }
  );
  recordAudit(req, { action: 'APPOINTMENT_NO_SHOW', entityType: 'Appointment', entityId: appt._id });
  ok(res, appointment);
}));

export default router;
