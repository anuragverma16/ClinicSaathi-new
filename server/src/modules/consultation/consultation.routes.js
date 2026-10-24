import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Consultation, Appointment, Patient } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { emit, EVENTS } from '../../services/events.js';
import { completeVisitForAppointment } from '../../services/queue.service.js';
import { requireDoctorProfile } from '../../services/access.service.js';
import { ROLES } from '../../config/constants.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const vitals = z.object({
  heightCm: z.number().min(20).max(260), weightKg: z.number().min(0.5).max(400),
  bpSystolic: z.number().min(40).max(300), bpDiastolic: z.number().min(20).max(200),
  pulse: z.number().min(20).max(250), tempC: z.number().min(30).max(45),
  spo2: z.number().min(40).max(100), bloodSugar: z.number().min(10).max(1000),
}).partial();

// The only fields a doctor may write. status, doctorId and patientId are never client-controlled.
const notesSchema = z.object({
  symptoms: z.string().max(4000).optional(),
  vitals: vitals.optional(),
  diagnosis: z.string().max(1000).optional(),
  clinicalNotes: z.string().max(8000).optional(),
  treatmentPlan: z.string().max(4000).optional(),
  followUpDays: z.number().int().min(1).max(365).optional(),
  followUpInstructions: z.string().max(1000).optional(),
});

/** Consultations are visible to the clinic owner and the treating doctor only. */
function readScope(req) {
  if (req.user.role === ROLES.CLINIC_OWNER) return {};
  return { doctorId: req.user.doctorId || null };
}

async function ownConsultation(req, id) {
  const doctorId = requireDoctorProfile(req);
  const c = await scoped(Consultation, req).findOne({ _id: id, doctorId });
  if (!c) throw ApiError.notFound('Consultation not found');
  return c;
}

router.get('/', requirePermission('consultation:read'), catchAsync(async (req, res) => {
  const filter = { ...readScope(req) };
  for (const k of ['patientId', 'appointmentId', 'status']) if (req.query[k]) filter[k] = req.query[k];
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ diagnosis: rx }, { symptoms: rx }];
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const clinicId = req.tenant.clinicId;
  const db = scoped(Consultation, req);
  const [items, total] = await Promise.all([
    db.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit)
      .populate(tenantPopulate(clinicId, 'patientId', 'name phone gender dob'))
      .populate(tenantPopulate(clinicId, 'doctorId', 'name')),
    db.countDocuments(filter),
  ]);
  if (filter.patientId) recordAudit(req, { action: 'CONSULTATIONS_VIEWED', entityType: 'Patient', entityId: filter.patientId });
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
}));

router.get('/:id', requirePermission('consultation:read'), catchAsync(async (req, res) => {
  const c = await scoped(Consultation, req).findOne({ _id: req.params.id, ...readScope(req) })
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone gender dob allergies chronicConditions'));
  if (!c) throw ApiError.notFound('Consultation not found');
  recordAudit(req, { action: 'CONSULTATION_VIEWED', entityType: 'Consultation', entityId: c._id });
  ok(res, c);
}));

/** Opens (or resumes) the consultation for an appointment the doctor is seeing. */
router.post('/', requirePermission('consultation:create'), validate(notesSchema.extend({ appointmentId: objectId })),
  catchAsync(async (req, res) => {
    const doctorId = requireDoctorProfile(req);
    const appt = await scoped(Appointment, req).findOne({ _id: req.body.appointmentId, doctorId });
    if (!appt) throw ApiError.notFound('Appointment not found in your schedule');
    if (['CANCELLED', 'RESCHEDULED', 'NO_SHOW'].includes(appt.status)) {
      throw ApiError.badRequest('This appointment is not active', 'APPOINTMENT_INACTIVE');
    }
    const existing = await scoped(Consultation, req).findOne({ appointmentId: appt._id });
    if (existing) return ok(res, existing);

    const { followUpDays, appointmentId, ...body } = req.body;
    let consultation;
    try {
      consultation = await scoped(Consultation, req).create({
        ...body,
        appointmentId: appt._id,
        patientId: appt.patientId,          // from the appointment, never from the client
        doctorId,
        branchId: appt.branchId,
        status: 'IN_PROGRESS',
        followUpDate: followUpDays ? dayjs().add(followUpDays, 'day').toDate() : undefined,
      });
    } catch (e) {
      // Two opens raced; the unique (clinic, appointment) index kept one. Resume it.
      if (e.code === 11000) return ok(res, await scoped(Consultation, req).findOne({ appointmentId: appt._id }));
      throw e;
    }
    recordAudit(req, { action: 'CONSULTATION_CREATED', entityType: 'Consultation', entityId: consultation._id });
    created(res, consultation);
  }));

router.patch('/:id', requirePermission('consultation:update'), validate(notesSchema), catchAsync(async (req, res) => {
  const before = await ownConsultation(req, req.params.id);
  if (before.status === 'COMPLETED') {
    throw ApiError.badRequest('This consultation is closed. Add an addendum instead.', 'CONSULTATION_LOCKED');
  }
  const { followUpDays, ...body } = req.body;
  if (followUpDays) body.followUpDate = dayjs().add(followUpDays, 'day').toDate();
  const consultation = await scoped(Consultation, req).findOneAndUpdate(
    { _id: before._id, status: { $ne: 'COMPLETED' } },
    { ...body, $push: { revisions: { at: new Date(), byUserId: req.user._id, summary: `Edited: ${Object.keys(body).join(', ')}` } } },
    { new: true }
  );
  if (!consultation) throw ApiError.conflict('This consultation was just closed', 'CONSULTATION_LOCKED');
  recordAudit(req, { action: 'CONSULTATION_UPDATED', entityType: 'Consultation', entityId: consultation._id, after: { fields: Object.keys(body) } });
  ok(res, consultation);
}));

/** Closes the clinical record, ends the visit and the queue token, and schedules any follow-up. */
router.post('/:id/complete', requirePermission('consultation:update'), catchAsync(async (req, res) => {
  const current = await ownConsultation(req, req.params.id);
  if (!current.diagnosis && !current.clinicalNotes) {
    throw ApiError.badRequest('Record a diagnosis or clinical note before completing', 'NOTES_REQUIRED');
  }
  const consultation = await scoped(Consultation, req).findOneAndUpdate(
    { _id: current._id, status: { $ne: 'COMPLETED' } },
    { status: 'COMPLETED', completedAt: new Date() },
    { new: true }
  );
  if (!consultation) throw ApiError.badRequest('Already completed', 'ALREADY_COMPLETED');

  await completeVisitForAppointment({ clinicId: req.tenant.clinicId, appointmentId: consultation.appointmentId });
  emit(EVENTS.CONSULTATION_COMPLETED, { consultation });
  recordAudit(req, { action: 'CONSULTATION_COMPLETED', entityType: 'Consultation', entityId: consultation._id });
  ok(res, consultation);
}));

/** Corrections to a closed record are appended, never overwritten. */
router.post('/:id/addendum', requirePermission('consultation:update'),
  validate(z.object({ text: z.string().trim().min(3).max(4000) })), catchAsync(async (req, res) => {
    const current = await ownConsultation(req, req.params.id);
    if (current.status !== 'COMPLETED') throw ApiError.badRequest('Edit the notes directly while the consultation is open');
    const consultation = await scoped(Consultation, req).findOneAndUpdate(
      { _id: current._id }, { $push: { addenda: { at: new Date(), byUserId: req.user._id, text: req.body.text } } }, { new: true }
    );
    recordAudit(req, { action: 'CONSULTATION_ADDENDUM', entityType: 'Consultation', entityId: consultation._id });
    ok(res, consultation);
  }));

/** Allergies the doctor confirms during the visit go straight onto the patient record. */
router.post('/:id/allergies', requirePermission('consultation:update'),
  validate(z.object({ allergies: z.array(z.string().trim().min(1).max(60)).max(30) })), catchAsync(async (req, res) => {
    const c = await ownConsultation(req, req.params.id);
    const patient = await scoped(Patient, req).findOneAndUpdate({ _id: c.patientId }, { allergies: req.body.allergies }, { new: true });
    recordAudit(req, { action: 'ALLERGIES_UPDATED', entityType: 'Patient', entityId: c.patientId });
    ok(res, { allergies: patient.allergies });
  }));

export default router;
