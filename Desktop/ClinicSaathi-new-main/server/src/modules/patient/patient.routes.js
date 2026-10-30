import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import {
  Patient, Appointment, Consultation, Prescription, Invoice, Payment, LabOrder, MedicalCertificate,
  MedicalDocument, Communication, FollowUp,
} from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { ROLES } from '../../config/constants.js';
import { canSeeClinical, hasCareRelationship, assertClinicalAccess, requireDoctorProfile } from '../../services/access.service.js';
import { normalisePhone } from '../../services/otp.service.js';
import { uploadFile, assertAllowedFile, MAX_UPLOAD_BYTES } from '../../integrations/storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const patientSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(15),
  email: z.string().trim().email().optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dob: z.string().optional().or(z.literal('')),
  bloodGroup: z.string().max(5).optional(),
  allergies: z.array(z.string().trim().max(60)).max(30).optional(),
  chronicConditions: z.array(z.string().trim().max(60)).max(30).optional(),
  notes: z.string().max(1000).optional(),
  address: z.object({
    line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional(),
  }).optional(),
  guardianPatientId: objectId.optional(),
  relationToGuardian: z.string().max(30).optional(),
  consent: z.object({
    dataProcessing: z.object({ granted: z.boolean() }).optional(),
    marketing: z.object({ granted: z.boolean() }).optional(),
  }).optional(),
  communicationPrefs: z.object({
    whatsapp: z.boolean().optional(), sms: z.boolean().optional(), email: z.boolean().optional(), optOutAll: z.boolean().optional(),
  }).optional(),
});

// Fields only clinicians may change (allergies drive prescribing safety).
const CLINICAL_FIELDS = ['allergies', 'chronicConditions', 'bloodGroup'];
const LIST_FIELDS = 'name phone email gender dob visitCount lastVisitAt createdAt guardianPatientId isActive';

function stampConsent(body) {
  const out = { ...body };
  if (out.consent?.dataProcessing) out.consent.dataProcessing = { ...out.consent.dataProcessing, grantedAt: new Date(), version: 'desk-v1' };
  if (out.consent?.marketing) out.consent.marketing = { ...out.consent.marketing, grantedAt: new Date() };
  if (out.communicationPrefs?.optOutAll) out.communicationPrefs.optedOutAt = new Date();
  if (out.dob === '') delete out.dob;
  if (out.email === '') delete out.email;
  return out;
}

/**
 * Doctors browse only patients they have treated or are booked to see; other
 * staff search the whole clinic's demographics.
 */
async function listScope(req) {
  if (req.user.role !== ROLES.DOCTOR) return {};
  const ids = await Appointment.distinct('patientId', { doctorId: req.user.doctorId || null }).setOptions({ clinicId: req.tenant.clinicId });
  return { _id: { $in: ids } };
}

router.get('/', requirePermission('patient:read'), catchAsync(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const filter = { ...(await listScope(req)) };
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  if (req.query.type === 'new') filter.visitCount = { $lte: 1 };
  if (req.query.type === 'returning') filter.visitCount = { $gt: 1 };
  const sortMap = { name: 'name', '-name': '-name', lastVisit: '-lastVisitAt', created: '-createdAt' };
  const db = scoped(Patient, req);
  const [items, total] = await Promise.all([
    db.find(filter).select(LIST_FIELDS).sort(sortMap[req.query.sort] || '-createdAt').skip((page - 1) * limit).limit(limit),
    db.countDocuments(filter),
  ]);
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
}));

/** Pre-registration duplicate check the desk can call while typing. */
router.get('/check-duplicate', requirePermission('patient:create'), catchAsync(async (req, res) => {
  const phone = normalisePhone(req.query.phone);
  if (phone.length < 10) return ok(res, { matches: [] });
  const matches = await scoped(Patient, req).find({ phone }).select('name phone dob gender guardianPatientId').limit(10);
  ok(res, { matches });
}));

router.post('/', requirePermission('patient:create'), validate(patientSchema), catchAsync(async (req, res) => {
  const body = stampConsent({ ...req.body, phone: normalisePhone(req.body.phone) });
  if (!canSeeClinical(req.user)) CLINICAL_FIELDS.forEach((f) => delete body[f]);
  if (body.guardianPatientId) {
    const guardian = await scoped(Patient, req).findById(body.guardianPatientId);
    if (!guardian) throw ApiError.badRequest('Guardian not found', 'GUARDIAN_NOT_FOUND');
  } else {
    const dup = await scoped(Patient, req).findOne({ phone: body.phone, guardianPatientId: { $exists: false } }).select('name phone');
    if (dup) throw new ApiError(409, `${dup.name} is already registered with this number`, 'PATIENT_EXISTS', { patientId: dup._id });
  }
  const patient = await scoped(Patient, req).create({
    ...body,
    branchId: req.tenant.branchId || undefined,
    consent: body.consent || { dataProcessing: { granted: true, grantedAt: new Date(), version: 'desk-v1' }, marketing: { granted: false } },
  });
  recordAudit(req, { action: 'PATIENT_CREATED', entityType: 'Patient', entityId: patient._id });
  created(res, patient);
}));

async function loadPatient(req) {
  const patient = await scoped(Patient, req).findOne({ _id: req.params.id, ...(await listScope(req)) });
  if (!patient) throw ApiError.notFound('Patient not found');
  return patient;
}

router.get('/:id', requirePermission('patient:read'), catchAsync(async (req, res) => {
  const patient = await loadPatient(req);
  const obj = { ...patient.toObject(), patientType: patient.patientType };
  // Accounts only needs billing identity; front desk needs contact + allergies are hidden.
  if (!canSeeClinical(req.user)) { CLINICAL_FIELDS.forEach((f) => delete obj[f]); delete obj.notes; }
  const dependents = await scoped(Patient, req).find({ guardianPatientId: patient._id }).select('name dob gender relationToGuardian');
  ok(res, { ...obj, dependents });
}));

router.patch('/:id', requirePermission('patient:update'), validate(patientSchema.partial()), catchAsync(async (req, res) => {
  const before = await loadPatient(req);
  const body = stampConsent(req.body);
  if (body.phone) body.phone = normalisePhone(body.phone);
  if (!canSeeClinical(req.user)) CLINICAL_FIELDS.forEach((f) => delete body[f]);
  else if (CLINICAL_FIELDS.some((f) => f in body) && !(await hasCareRelationship(req, before._id))) {
    throw ApiError.forbidden('Only a treating doctor can change clinical details', 'NO_CLINICAL_ACCESS');
  }
  const patient = await scoped(Patient, req).findOneAndUpdate({ _id: before._id }, body, { new: true, runValidators: true });
  recordAudit(req, { action: 'PATIENT_UPDATED', entityType: 'Patient', entityId: patient._id, after: { fields: Object.keys(body) } });
  ok(res, patient);
}));

/**
 * Unified record. Every role gets the sections it is entitled to and nothing
 * else — clinical sections require a care relationship.
 */
router.get('/:id/timeline', requirePermission('patient:read'), catchAsync(async (req, res) => {
  const patient = await loadPatient(req);
  const clinicId = req.tenant.clinicId;
  const pid = patient._id;
  const role = req.user.role;
  const clinical = canSeeClinical(req.user) && (await hasCareRelationship(req, pid));
  const billing = [ROLES.CLINIC_OWNER, ROLES.ACCOUNTANT, ROLES.RECEPTIONIST, ROLES.BRANCH_MANAGER].includes(role);

  const q = (Model, sort = '-createdAt') => scoped(Model, req).find({ patientId: pid }).sort(sort).limit(50);
  const [appointments, consultations, prescriptions, labOrders, certificates, documents, invoices, payments, communications, followUps] = await Promise.all([
    q(Appointment, '-startAt').populate(tenantPopulate(clinicId, 'doctorId', 'name')).populate(tenantPopulate(clinicId, 'serviceId', 'name')),
    clinical ? q(Consultation).populate(tenantPopulate(clinicId, 'doctorId', 'name')) : null,
    clinical ? q(Prescription).populate(tenantPopulate(clinicId, 'doctorId', 'name')) : null,
    clinical ? q(LabOrder).populate(tenantPopulate(clinicId, 'doctorId', 'name')) : null,
    clinical ? q(MedicalCertificate) : null,
    clinical ? q(MedicalDocument) : null,
    billing ? q(Invoice) : null,
    billing ? q(Payment) : null,
    role !== ROLES.ACCOUNTANT ? q(Communication).select('channel event status createdAt templateName error') : null,
    clinical ? q(FollowUp, '-dueDate') : null,
  ]);

  const obj = { ...patient.toObject(), patientType: patient.patientType };
  if (!clinical) { CLINICAL_FIELDS.forEach((f) => delete obj[f]); delete obj.notes; }
  const outstanding = (invoices || [])
    .filter((i) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status))
    .reduce((sum, i) => sum + (i.total - i.amountPaid), 0);

  if (clinical) recordAudit(req, { action: 'PATIENT_RECORD_VIEWED', entityType: 'Patient', entityId: pid });
  ok(res, {
    patient: obj,
    access: { clinical, billing },
    appointments, consultations, prescriptions, labOrders, certificates, documents,
    invoices, payments, communications, followUps,
    outstanding: billing ? outstanding : null,
  });
}));

router.get('/:id/documents', requirePermission('patient:read'), catchAsync(async (req, res) => {
  const patient = await loadPatient(req);
  await assertClinicalAccess(req, patient._id);
  ok(res, await scoped(MedicalDocument, req).find({ patientId: patient._id }).sort('-createdAt'));
}));

router.post('/:id/documents', requirePermission('document:create'), upload.single('file'), catchAsync(async (req, res) => {
  const patient = await loadPatient(req);
  await assertClinicalAccess(req, patient._id);
  requireDoctorProfile(req);
  if (!req.file) throw ApiError.badRequest('Attach a file', 'FILE_REQUIRED');
  assertAllowedFile(req.file);
  const parsed = z.object({
    title: z.string().trim().min(2).max(120),
    category: z.enum(['REPORT', 'SCAN', 'REFERRAL', 'DISCHARGE', 'OTHER']).optional(),
    sharedWithPatient: z.enum(['true', 'false']).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Give the document a title', 'VALIDATION_ERROR');
  const stored = await uploadFile({ clinicId: req.tenant.clinicId, folder: 'documents', buffer: req.file.buffer, originalName: req.file.originalname });
  const doc = await scoped(MedicalDocument, req).create({
    patientId: patient._id, title: parsed.data.title, category: parsed.data.category || 'OTHER',
    storageKey: stored.key, fileName: req.file.originalname.slice(0, 200), mimeType: req.file.mimetype, size: stored.size,
    sharedWithPatient: parsed.data.sharedWithPatient === 'true', uploadedByUserId: req.user._id,
  });
  recordAudit(req, { action: 'DOCUMENT_UPLOADED', entityType: 'MedicalDocument', entityId: doc._id });
  created(res, doc);
}));

router.patch('/:id/documents/:docId', requirePermission('document:update'),
  validate(z.object({ sharedWithPatient: z.boolean() })), catchAsync(async (req, res) => {
    const patient = await loadPatient(req);
    await assertClinicalAccess(req, patient._id);
    const doc = await scoped(MedicalDocument, req).findOneAndUpdate(
      { _id: req.params.docId, patientId: patient._id }, { sharedWithPatient: req.body.sharedWithPatient }, { new: true }
    );
    if (!doc) throw ApiError.notFound('Document not found');
    recordAudit(req, { action: req.body.sharedWithPatient ? 'DOCUMENT_SHARED' : 'DOCUMENT_UNSHARED', entityType: 'MedicalDocument', entityId: doc._id });
    ok(res, doc);
  }));

export default router;
