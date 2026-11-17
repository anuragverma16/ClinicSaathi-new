import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Prescription, Consultation, Doctor, MedicalCertificate } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { nextSequence } from '../../models/Counter.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { emit, EVENTS } from '../../services/events.js';
import { requireDoctorProfile, assertClinicalAccess } from '../../services/access.service.js';
import { ROLES } from '../../config/constants.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const medicine = z.object({
  name: z.string().trim().min(1).max(120),
  dosage: z.string().max(60).optional(),
  frequency: z.string().max(40).optional(),
  durationDays: z.number().int().min(1).max(365).optional(),
  timing: z.enum(['BEFORE_FOOD', 'AFTER_FOOD', 'ANY']).optional(),
  instructions: z.string().max(300).optional(),
});
const rxSchema = z.object({ medicines: z.array(medicine).max(30), advice: z.string().max(2000).optional() });

async function signingDoctor(req) {
  const doctorId = requireDoctorProfile(req);
  const doctor = await scoped(Doctor, req).findById(doctorId);
  if (!doctor?.registrationNumber) {
    throw ApiError.badRequest('Add your medical registration number in your profile before signing', 'REGISTRATION_NUMBER_MISSING');
  }
  return doctor;
}

const readScope = (req) => (req.user.role === ROLES.CLINIC_OWNER ? {} : { doctorId: req.user.doctorId || null });

// ---------------------------------------------------------------- Prescriptions
export const prescriptionRouter = Router();

prescriptionRouter.get('/', requirePermission('prescription:read'), catchAsync(async (req, res) => {
  const filter = { ...readScope(req) };
  for (const k of ['patientId', 'consultationId', 'status']) if (req.query[k]) filter[k] = req.query[k];
  const clinicId = req.tenant.clinicId;
  ok(res, await scoped(Prescription, req).find(filter).sort('-createdAt').limit(Math.min(200, Number(req.query.limit) || 100))
    .populate(tenantPopulate(clinicId, 'patientId', 'name phone'))
    .populate(tenantPopulate(clinicId, 'doctorId', 'name')));
}));

/** Creates a DRAFT on an open or completed consultation of the doctor's own. */
prescriptionRouter.post('/', requirePermission('prescription:create'), validate(rxSchema.extend({ consultationId: objectId })),
  catchAsync(async (req, res) => {
    const doctorId = requireDoctorProfile(req);
    const consultation = await scoped(Consultation, req).findOne({ _id: req.body.consultationId, doctorId });
    if (!consultation) throw ApiError.notFound('Consultation not found');
    const year = new Date().getFullYear();
    const seq = await nextSequence(`rx:${req.tenant.clinicId}:${year}`);
    const rx = await scoped(Prescription, req).create({
      consultationId: consultation._id, appointmentId: consultation.appointmentId,
      patientId: consultation.patientId, doctorId, branchId: consultation.branchId,
      rxNumber: `RX-${year}-${String(seq).padStart(5, '0')}`,
      medicines: req.body.medicines, advice: req.body.advice, status: 'DRAFT',
    });
    recordAudit(req, { action: 'PRESCRIPTION_DRAFTED', entityType: 'Prescription', entityId: rx._id });
    created(res, rx);
  }));

prescriptionRouter.patch('/:id', requirePermission('prescription:update'), validate(rxSchema.partial()), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const rx = await scoped(Prescription, req).findOneAndUpdate(
    { _id: req.params.id, doctorId, status: 'DRAFT' }, req.body, { new: true }
  );
  if (!rx) throw ApiError.badRequest('Only your own draft prescriptions can be edited', 'RX_LOCKED');
  recordAudit(req, { action: 'PRESCRIPTION_EDITED', entityType: 'Prescription', entityId: rx._id });
  ok(res, rx);
}));

/** The doctor's approval: signs with their registration number and locks the prescription. */
prescriptionRouter.post('/:id/finalize', requirePermission('prescription:update'), catchAsync(async (req, res) => {
  const doctor = await signingDoctor(req);
  const draft = await scoped(Prescription, req).findOne({ _id: req.params.id, doctorId: doctor._id, status: 'DRAFT' });
  if (!draft) throw ApiError.badRequest('Only your own draft prescriptions can be signed', 'RX_LOCKED');
  if (!draft.medicines.length && !draft.advice) throw ApiError.badRequest('Add at least one medicine or advice', 'RX_EMPTY');
  const now = new Date();
  const rx = await scoped(Prescription, req).findOneAndUpdate(
    { _id: draft._id, status: 'DRAFT' },
    { status: 'FINAL', finalizedAt: now, signature: { doctorName: doctor.name, registrationNumber: doctor.registrationNumber, signedAt: now } },
    { new: true }
  );
  if (!rx) throw ApiError.conflict('Already signed', 'RX_LOCKED');
  emit(EVENTS.PRESCRIPTION_ISSUED, { prescription: rx });
  recordAudit(req, { action: 'PRESCRIPTION_ISSUED', entityType: 'Prescription', entityId: rx._id });
  ok(res, rx);
}));

prescriptionRouter.delete('/:id', requirePermission('prescription:update'), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const r = await scoped(Prescription, req).deleteOne({ _id: req.params.id, doctorId, status: 'DRAFT' });
  if (!r.deletedCount) throw ApiError.badRequest('Signed prescriptions cannot be deleted', 'RX_LOCKED');
  recordAudit(req, { action: 'PRESCRIPTION_DRAFT_DELETED', entityType: 'Prescription', entityId: req.params.id });
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------- Certificates
export const certificateRouter = Router();

const certSchema = z.object({
  patientId: objectId,
  consultationId: objectId.optional(),
  type: z.enum(['SICK_LEAVE', 'FITNESS', 'GENERAL']),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  remarks: z.string().max(1000).optional(),
}).refine((d) => !d.fromDate || !d.toDate || dayjs(d.toDate) >= dayjs(d.fromDate), { message: 'End date must be after start date', path: ['toDate'] });

certificateRouter.get('/', requirePermission('certificate:read'), catchAsync(async (req, res) => {
  const filter = { ...readScope(req) };
  if (req.query.patientId) filter.patientId = req.query.patientId;
  ok(res, await scoped(MedicalCertificate, req).find(filter).sort('-createdAt').limit(200)
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone')));
}));

certificateRouter.post('/', requirePermission('certificate:create'), validate(certSchema), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  await assertClinicalAccess(req, req.body.patientId);
  const year = new Date().getFullYear();
  const seq = await nextSequence(`cert:${req.tenant.clinicId}:${year}`);
  const cert = await scoped(MedicalCertificate, req).create({
    ...req.body, doctorId, certificateNumber: `MC-${year}-${String(seq).padStart(5, '0')}`, status: 'DRAFT',
  });
  recordAudit(req, { action: 'CERTIFICATE_DRAFTED', entityType: 'MedicalCertificate', entityId: cert._id });
  created(res, cert);
}));

certificateRouter.post('/:id/issue', requirePermission('certificate:update'), catchAsync(async (req, res) => {
  const doctor = await signingDoctor(req);
  const now = new Date();
  const cert = await scoped(MedicalCertificate, req).findOneAndUpdate(
    { _id: req.params.id, doctorId: doctor._id, status: 'DRAFT' },
    { status: 'ISSUED', issuedAt: now, signature: { doctorName: doctor.name, registrationNumber: doctor.registrationNumber, signedAt: now } },
    { new: true }
  );
  if (!cert) throw ApiError.badRequest('Only your own draft certificates can be issued', 'CERT_LOCKED');
  recordAudit(req, { action: 'CERTIFICATE_ISSUED', entityType: 'MedicalCertificate', entityId: cert._id });
  ok(res, cert);
}));

certificateRouter.post('/:id/revoke', requirePermission('certificate:update'),
  validate(z.object({ reason: z.string().trim().min(3).max(300) })), catchAsync(async (req, res) => {
    const doctorId = requireDoctorProfile(req);
    const cert = await scoped(MedicalCertificate, req).findOneAndUpdate(
      { _id: req.params.id, doctorId, status: 'ISSUED' }, { status: 'REVOKED', revokedReason: req.body.reason }, { new: true }
    );
    if (!cert) throw ApiError.notFound('Issued certificate not found');
    recordAudit(req, { action: 'CERTIFICATE_REVOKED', entityType: 'MedicalCertificate', entityId: cert._id });
    ok(res, cert);
  }));
