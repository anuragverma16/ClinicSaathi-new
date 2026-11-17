import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import dayjs from 'dayjs';
import { LabOrder, Consultation } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { nextSequence } from '../../models/Counter.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { emit, EVENTS } from '../../services/events.js';
import { requireDoctorProfile } from '../../services/access.service.js';
import { uploadFile, assertAllowedFile, MAX_UPLOAD_BYTES } from '../../integrations/storage.js';
import { LAB_STATUS, ROLES } from '../../config/constants.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const S = LAB_STATUS;

// Lab staff get the minimum needed to collect and label a sample.
const LAB_PATIENT_FIELDS = 'name gender dob';
const isLab = (req) => req.user.role === ROLES.LAB_TECHNICIAN;

function scopeFor(req) {
  if (req.user.role === ROLES.DOCTOR) return { doctorId: req.user.doctorId || null };
  return {};
}

async function findOrder(req, id, extra = {}) {
  const order = await scoped(LabOrder, req).findOne({ _id: id, ...scopeFor(req), ...extra });
  if (!order) throw ApiError.notFound('Lab order not found');
  return order;
}

/** Technicians see orders without the doctor's free-text history beyond the lab note. */
function present(order, req) {
  const o = order.toObject ? order.toObject() : order;
  if (isLab(req)) delete o.doctorRemarks;
  return o;
}

router.get('/overview', requirePermission('lab:read'), catchAsync(async (req, res) => {
  const counts = await scoped(LabOrder, req).aggregate([
    { $match: scopeFor(req) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const today = await scoped(LabOrder, req).countDocuments({ ...scopeFor(req), submittedAt: { $gte: dayjs().startOf('day').toDate() } });
  const urgent = await scoped(LabOrder, req).countDocuments({ ...scopeFor(req), priority: 'URGENT', status: { $in: [S.ORDERED, S.SAMPLE_COLLECTED, S.PROCESSING] } });
  ok(res, {
    ordered: by[S.ORDERED] || 0, collected: by[S.SAMPLE_COLLECTED] || 0, processing: by[S.PROCESSING] || 0,
    awaitingVerification: by[S.RESULT_SUBMITTED] || 0, verified: by[S.VERIFIED] || 0, submittedToday: today, urgentOpen: urgent,
  });
}));

router.get('/orders', requirePermission('lab:read'), catchAsync(async (req, res) => {
  const filter = { ...scopeFor(req) };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.patientId && !isLab(req)) filter.patientId = req.query.patientId;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const clinicId = req.tenant.clinicId;
  const db = scoped(LabOrder, req);
  const [items, total] = await Promise.all([
    db.find(filter).sort({ priority: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate(tenantPopulate(clinicId, 'patientId', isLab(req) ? LAB_PATIENT_FIELDS : 'name phone gender dob'))
      .populate(tenantPopulate(clinicId, 'doctorId', 'name')),
    db.countDocuments(filter),
  ]);
  ok(res, items.map((o) => present(o, req)), { page, limit, total, pages: Math.ceil(total / limit) });
}));

router.get('/orders/:id', requirePermission('lab:read'), catchAsync(async (req, res) => {
  const order = await findOrder(req, req.params.id);
  await order.populate([
    tenantPopulate(req.tenant.clinicId, 'patientId', isLab(req) ? LAB_PATIENT_FIELDS : 'name phone gender dob'),
    tenantPopulate(req.tenant.clinicId, 'doctorId', 'name'),
  ]);
  ok(res, present(order, req));
}));

/** Ordered by the treating doctor, usually from inside a consultation. */
router.post('/orders', requirePermission('lab:create'), validate(z.object({
  consultationId: objectId,
  tests: z.array(z.object({ name: z.string().trim().min(2).max(120), code: z.string().max(30).optional() })).min(1).max(30),
  priority: z.enum(['ROUTINE', 'URGENT']).optional(),
  clinicalNotes: z.string().max(1000).optional(),
})), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const consultation = await scoped(Consultation, req).findOne({ _id: req.body.consultationId, doctorId });
  if (!consultation) throw ApiError.notFound('Consultation not found');
  const year = new Date().getFullYear();
  const seq = await nextSequence(`lab:${req.tenant.clinicId}:${year}`);
  const order = await scoped(LabOrder, req).create({
    orderNumber: `LAB-${year}-${String(seq).padStart(5, '0')}`,
    patientId: consultation.patientId, doctorId, appointmentId: consultation.appointmentId,
    consultationId: consultation._id, branchId: consultation.branchId,
    tests: req.body.tests, priority: req.body.priority || 'ROUTINE', clinicalNotes: req.body.clinicalNotes,
    orderedByUserId: req.user._id,
  });
  emit(EVENTS.LAB_ORDERED, { order });
  recordAudit(req, { action: 'LAB_ORDERED', entityType: 'LabOrder', entityId: order._id });
  created(res, order);
}));

/** Technician workflow: one conditional transition per call, so double clicks are harmless. */
const TECH_STEPS = {
  collect: { from: [S.ORDERED], to: S.SAMPLE_COLLECTED, stamp: 'collectedAt', audit: 'LAB_SAMPLE_COLLECTED' },
  process: { from: [S.SAMPLE_COLLECTED], to: S.PROCESSING, stamp: 'processingAt', audit: 'LAB_PROCESSING' },
};
for (const [step, cfg] of Object.entries(TECH_STEPS)) {
  router.post(`/orders/:id/${step}`, requirePermission('lab:process'), catchAsync(async (req, res) => {
    const order = await scoped(LabOrder, req).findOneAndUpdate(
      { _id: req.params.id, status: { $in: cfg.from } },
      { status: cfg.to, [cfg.stamp]: new Date(), assignedToUserId: req.user._id },
      { new: true }
    );
    if (!order) throw ApiError.badRequest(`This order is not ready for that step`, 'INVALID_TRANSITION');
    recordAudit(req, { action: cfg.audit, entityType: 'LabOrder', entityId: order._id });
    ok(res, present(order, req));
  }));
}

/**
 * Results upload: structured values and/or a report file. Submitting sends
 * the order to the ordering doctor for verification — the technician records
 * values and never adds interpretation.
 */
router.post('/orders/:id/results', requirePermission('lab:process'), upload.single('report'), catchAsync(async (req, res) => {
  const order = await scoped(LabOrder, req).findOne({ _id: req.params.id, status: { $in: [S.SAMPLE_COLLECTED, S.PROCESSING] } });
  if (!order) throw ApiError.badRequest('Collect and process the sample before submitting results', 'INVALID_TRANSITION');

  let results = [];
  if (req.body.results) {
    let raw;
    try { raw = typeof req.body.results === 'string' ? JSON.parse(req.body.results) : req.body.results; }
    catch { throw ApiError.badRequest('Results are not valid JSON', 'VALIDATION_ERROR'); }
    const parsed = z.array(z.object({
      test: z.string().trim().min(1).max(120), value: z.string().max(60).optional(), unit: z.string().max(30).optional(),
      referenceRange: z.string().max(60).optional(), flag: z.enum(['NORMAL', 'LOW', 'HIGH', 'CRITICAL', '']).optional(),
    })).max(100).safeParse(raw);
    if (!parsed.success) throw ApiError.badRequest('Check the result rows', 'VALIDATION_ERROR');
    results = parsed.data;
  }
  if (!results.length && !req.file) throw ApiError.badRequest('Enter result values or attach the report file', 'RESULTS_REQUIRED');

  const update = {
    status: S.RESULT_SUBMITTED, submittedAt: new Date(), submittedByUserId: req.user._id,
    results, technicianNotes: String(req.body.technicianNotes || '').slice(0, 1000),
  };
  if (req.file) {
    assertAllowedFile(req.file);
    const stored = await uploadFile({ clinicId: req.tenant.clinicId, folder: 'lab-reports', buffer: req.file.buffer, originalName: req.file.originalname });
    update.report = { storageKey: stored.key, fileName: req.file.originalname.slice(0, 200), mimeType: req.file.mimetype, size: stored.size };
  }
  const saved = await scoped(LabOrder, req).findOneAndUpdate({ _id: order._id, status: order.status }, update, { new: true });
  if (!saved) throw ApiError.conflict('The order changed. Refresh and try again.', 'CONCURRENT_UPDATE');
  emit(EVENTS.LAB_RESULT_SUBMITTED, { order: saved });
  recordAudit(req, { action: 'LAB_RESULTS_SUBMITTED', entityType: 'LabOrder', entityId: saved._id });
  ok(res, present(saved, req));
}));

/** Ordering doctor verifies (or sends back for re-test). Only verified results reach the patient. */
router.post('/orders/:id/verify', requirePermission('lab:verify'),
  validate(z.object({ approve: z.boolean(), remarks: z.string().max(1000).optional() })), catchAsync(async (req, res) => {
    const doctorId = requireDoctorProfile(req);
    const update = req.body.approve
      ? { status: S.VERIFIED, verifiedAt: new Date(), verifiedByUserId: req.user._id, doctorRemarks: req.body.remarks }
      : { status: S.PROCESSING, doctorRemarks: req.body.remarks };
    const order = await scoped(LabOrder, req).findOneAndUpdate(
      { _id: req.params.id, doctorId, status: S.RESULT_SUBMITTED }, update, { new: true }
    );
    if (!order) throw ApiError.badRequest('Only submitted results for your own orders can be verified', 'INVALID_TRANSITION');
    if (req.body.approve) emit(EVENTS.LAB_REPORT_READY, { order });
    recordAudit(req, { action: req.body.approve ? 'LAB_RESULTS_VERIFIED' : 'LAB_RESULTS_RETURNED', entityType: 'LabOrder', entityId: order._id });
    ok(res, order);
  }));

router.post('/orders/:id/cancel', requirePermission('lab:create'),
  validate(z.object({ reason: z.string().trim().min(3).max(300) })), catchAsync(async (req, res) => {
    const doctorId = requireDoctorProfile(req);
    const order = await scoped(LabOrder, req).findOneAndUpdate(
      { _id: req.params.id, doctorId, status: { $in: [S.ORDERED, S.SAMPLE_COLLECTED] } },
      { status: S.CANCELLED, cancelledReason: req.body.reason }, { new: true }
    );
    if (!order) throw ApiError.badRequest('This order can no longer be cancelled', 'INVALID_TRANSITION');
    recordAudit(req, { action: 'LAB_ORDER_CANCELLED', entityType: 'LabOrder', entityId: order._id });
    ok(res, order);
  }));


export default router;
