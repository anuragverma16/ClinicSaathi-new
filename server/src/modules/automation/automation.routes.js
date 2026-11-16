import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Communication, FollowUp, Recall, Campaign, Patient, Appointment, JobEvent, AIConversation } from '../../models/index.js';
import { scoped, tenantPopulate } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, requireRole } from '../../middleware/rbac.js';
import { requireFeature } from '../../middleware/planGate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { send } from '../../services/communication.service.js';
import { enqueue } from '../../jobs/queues.js';
import { ROLES, CAMPAIGN_KINDS } from '../../config/constants.js';
import { redisStatus } from '../../config/redis.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const owner = requireRole(ROLES.CLINIC_OWNER);

// ------------------------------------------------------------------ Communication log

router.get('/communications', requirePermission('communication:read'), catchAsync(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const f = {};
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.event) f.event = String(req.query.event);
  if (req.query.patientId) f.patientId = req.query.patientId;
  if (req.query.direction) f.direction = String(req.query.direction);
  const db = scoped(Communication, req);
  const [items, total, stats] = await Promise.all([
    db.find(f).sort('-createdAt').skip((page - 1) * limit).limit(limit).select('-payload')
      .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone')),
    db.countDocuments(f),
    db.aggregate([{ $match: { createdAt: { $gte: dayjs().subtract(30, 'day').toDate() } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  ok(res, items, { page, limit, total, pages: Math.ceil(total / limit), last30Days: Object.fromEntries(stats.map((s) => [s._id, s.count])) });
}));

/**
 * Staff message to a patient. Free text is only deliverable on WhatsApp inside
 * the 24h window, so outside it the clinic's approved template is used.
 * Clinical details must not be sent this way — the UI says so.
 */
router.post('/communications', requirePermission('communication:create'), validate(z.object({
  patientId: objectId,
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']),
  body: z.string().trim().min(2).max(1000),
})), catchAsync(async (req, res) => {
  const patient = await scoped(Patient, req).findById(req.body.patientId);
  if (!patient) throw ApiError.notFound('Patient not found');
  let inWindow = false;
  if (req.body.channel === 'WHATSAPP') {
    const convo = await scoped(AIConversation, req).findOne({ patientId: patient._id }).sort('-lastInboundAt');
    inWindow = Boolean(convo?.lastInboundAt && dayjs().diff(convo.lastInboundAt, 'hour') < 24);
  }
  const record = await send({
    clinicId: req.tenant.clinicId, patientId: patient._id, channel: req.body.channel, event: 'STAFF_MESSAGE',
    body: req.body.body, templateName: req.body.channel === 'WHATSAPP' && !inWindow ? 'staff_message' : undefined,
    variables: req.body.channel === 'WHATSAPP' && !inWindow ? { message: req.body.body } : {},
    inReplyToPatient: inWindow,
  });
  recordAudit(req, { action: 'PATIENT_MESSAGED', entityType: 'Patient', entityId: patient._id, after: { channel: req.body.channel, status: record.status } });
  created(res, record);
}));

// ------------------------------------------------------------------ Follow-ups

router.get('/followups', requireFeature('followups'), requirePermission('followup:read'), catchAsync(async (req, res) => {
  const f = {};
  if (req.user.role === ROLES.DOCTOR) f.doctorId = req.user.doctorId || null;
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  if (req.query.due === 'true') f.dueDate = { $lte: dayjs().endOf('day').toDate() };
  ok(res, await scoped(FollowUp, req).find(f).sort('dueDate').limit(200)
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone'))
    .populate(tenantPopulate(req.tenant.clinicId, 'doctorId', 'name')));
}));

router.patch('/followups/:id', requireFeature('followups'), requirePermission('followup:update'), validate(z.object({
  status: z.enum(['CLOSED', 'ESCALATED', 'SCHEDULED']).optional(),
  dueDate: z.string().optional(),
  instructions: z.string().max(1000).optional(),
})), catchAsync(async (req, res) => {
  const f = { _id: req.params.id };
  if (req.user.role === ROLES.DOCTOR) f.doctorId = req.user.doctorId || null;
  const update = { ...req.body };
  if (update.dueDate) update.dueDate = new Date(update.dueDate);
  if (req.user.role === ROLES.DOCTOR) update.reviewedByDoctorAt = new Date();
  const fu = await scoped(FollowUp, req).findOneAndUpdate(f, update, { new: true });
  if (!fu) throw ApiError.notFound('Follow-up not found');
  if (update.dueDate && fu.status === 'SCHEDULED') {
    const delay = dayjs(fu.dueDate).diff(dayjs());
    if (delay > 0) await enqueue('followUp', 'checkin', { followUpId: String(fu._id), clinicId: String(req.tenant.clinicId) }, { delay, jobId: `followup:${fu._id}:${fu.dueDate.getTime()}` });
  }
  recordAudit(req, { action: 'FOLLOWUP_UPDATED', entityType: 'FollowUp', entityId: fu._id, after: req.body });
  ok(res, fu);
}));

// ------------------------------------------------------------------ Recall

router.get('/recalls', requireFeature('ai_recall'), owner, catchAsync(async (req, res) => {
  const f = {};
  if (req.query.status) f.status = { $in: String(req.query.status).split(',') };
  ok(res, await scoped(Recall, req).find(f).sort('dueDate').limit(300)
    .populate(tenantPopulate(req.tenant.clinicId, 'patientId', 'name phone'))
    .populate(tenantPopulate(req.tenant.clinicId, 'serviceId', 'name')));
}));

router.post('/recalls/:id/dismiss', requireFeature('ai_recall'), owner, catchAsync(async (req, res) => {
  const r = await scoped(Recall, req).findOneAndUpdate({ _id: req.params.id, status: { $in: ['DUE', 'NOTIFIED'] } }, { status: 'DISMISSED' }, { new: true });
  if (!r) throw ApiError.notFound('Open recall not found');
  recordAudit(req, { action: 'RECALL_DISMISSED', entityType: 'Recall', entityId: r._id });
  ok(res, r);
}));

/** Send a due recall now instead of waiting for its scheduled job. */
router.post('/recalls/:id/send', requireFeature('ai_recall'), owner, catchAsync(async (req, res) => {
  const r = await scoped(Recall, req).findOne({ _id: req.params.id, status: 'DUE' }).populate(tenantPopulate(req.tenant.clinicId, 'serviceId', 'name'));
  if (!r) throw ApiError.notFound('Due recall not found');
  const record = await send({ clinicId: req.tenant.clinicId, patientId: r.patientId, channel: 'WHATSAPP', event: 'RECALL', templateName: 'recall_due', variables: { service: r.recallType || r.serviceId?.name || 'your check-up' } });
  if (record.status !== 'FAILED') await scoped(Recall, req).updateOne({ _id: r._id, status: 'DUE' }, { status: 'NOTIFIED', notifiedAt: new Date() });
  recordAudit(req, { action: 'RECALL_SENT', entityType: 'Recall', entityId: r._id, after: { status: record.status } });
  ok(res, { recall: r._id, message: record });
}));

// ------------------------------------------------------------------ Campaigns

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  kind: z.enum(CAMPAIGN_KINDS).optional(),
  templateName: z.string().regex(/^[a-z0-9_]{1,512}$/, 'Use the exact approved WhatsApp template name'),
  messagePreview: z.string().max(1000).optional(),
  audience: z.object({
    lastVisitBeforeDays: z.number().int().min(1).max(3650).optional(), serviceId: objectId.optional(), doctorId: objectId.optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(), minAge: z.number().int().min(0).max(120).optional(), maxAge: z.number().int().min(0).max(120).optional(),
  }).optional(),
});

/** Eligible = marketing consent, not opted out, matching the audience filter. */
async function campaignAudience(req, audience = {}) {
  const pf = { isActive: true };
  if (audience.lastVisitBeforeDays) pf.lastVisitAt = { $lte: dayjs().subtract(audience.lastVisitBeforeDays, 'day').toDate() };
  if (audience.gender) pf.gender = audience.gender;
  // Age band → date-of-birth window (patients without a DOB fall outside any age filter).
  if (audience.minAge != null || audience.maxAge != null) {
    pf.dob = {};
    if (audience.minAge != null) pf.dob.$lte = dayjs().subtract(audience.minAge, 'year').toDate();
    if (audience.maxAge != null) pf.dob.$gt = dayjs().subtract(audience.maxAge + 1, 'year').toDate();
  }
  if (audience.serviceId || audience.doctorId) {
    const af = { status: 'COMPLETED' };
    if (audience.serviceId) af.serviceId = audience.serviceId;
    if (audience.doctorId) af.doctorId = audience.doctorId;
    pf._id = { $in: await Appointment.distinct('patientId', af).setOptions({ clinicId: req.tenant.clinicId }) };
  }
  const all = await scoped(Patient, req).find(pf).select('_id consent communicationPrefs').lean();
  const eligible = all.filter((p) => p.consent?.marketing?.granted && !p.communicationPrefs?.optOutAll && p.communicationPrefs?.whatsapp !== false);
  return { targeted: all.length, eligible };
}

router.get('/campaigns', requireFeature('campaigns'), owner, catchAsync(async (req, res) => {
  ok(res, await scoped(Campaign, req).find({}).sort('-createdAt').limit(100));
}));

router.post('/campaigns/preview', requireFeature('campaigns'), owner, validate(campaignSchema.pick({ audience: true })), catchAsync(async (req, res) => {
  const { targeted, eligible } = await campaignAudience(req, req.body.audience);
  ok(res, { targeted, eligible: eligible.length, excluded: targeted - eligible.length });
}));

router.post('/campaigns', requireFeature('campaigns'), owner, validate(campaignSchema), catchAsync(async (req, res) => {
  const c = await scoped(Campaign, req).create({ ...req.body, createdByUserId: req.user._id });
  recordAudit(req, { action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: c._id });
  created(res, c);
}));

router.post('/campaigns/:id/approve', requireFeature('campaigns'), owner, catchAsync(async (req, res) => {
  const c = await scoped(Campaign, req).findOneAndUpdate({ _id: req.params.id, status: 'DRAFT' },
    { status: 'APPROVED', approvedByUserId: req.user._id, approvedAt: new Date() }, { new: true });
  if (!c) throw ApiError.badRequest('Only a draft can be approved', 'INVALID_STATUS');
  recordAudit(req, { action: 'CAMPAIGN_APPROVED', entityType: 'Campaign', entityId: c._id });
  ok(res, c);
}));

/** Queues one job per eligible patient with a deterministic id — re-sending can't double-message. */
router.post('/campaigns/:id/send', requireFeature('campaigns'), owner, catchAsync(async (req, res) => {
  const c = await scoped(Campaign, req).findOneAndUpdate({ _id: req.params.id, status: 'APPROVED' }, { status: 'SENDING' }, { new: true });
  if (!c) throw ApiError.badRequest('Approve the campaign before sending; a campaign is sent once', 'INVALID_STATUS');
  const { targeted, eligible } = await campaignAudience(req, c.audience);
  let queued = 0;
  for (const p of eligible) {
    const job = await enqueue('campaign', 'send', { campaignId: String(c._id), clinicId: String(req.tenant.clinicId), patientId: String(p._id) },
      { jobId: `campaign:${c._id}:${p._id}` });
    if (job) queued += 1;
  }
  const status = queued || !eligible.length ? 'SENT' : 'APPROVED';   // nothing queued (Redis down) → can retry
  const saved = await scoped(Campaign, req).findOneAndUpdate({ _id: c._id },
    { status, sentAt: status === 'SENT' ? new Date() : undefined, stats: { targeted, queued, excluded: targeted - eligible.length, booked: 0 } }, { new: true });
  recordAudit(req, { action: 'CAMPAIGN_SENT', entityType: 'Campaign', entityId: c._id, after: { queued, eligible: eligible.length } });
  if (!queued && eligible.length) throw new ApiError(503, 'The message queue is offline, so nothing was sent. Try again once background jobs are running.', 'QUEUE_OFFLINE');
  ok(res, saved);
}));

router.post('/campaigns/:id/cancel', requireFeature('campaigns'), owner, catchAsync(async (req, res) => {
  const c = await scoped(Campaign, req).findOneAndUpdate({ _id: req.params.id, status: { $in: ['DRAFT', 'APPROVED'] } }, { status: 'CANCELLED' }, { new: true });
  if (!c) throw ApiError.badRequest('This campaign can no longer be cancelled', 'INVALID_STATUS');
  ok(res, c);
}));

// ------------------------------------------------------------------ Health

router.get('/health', owner, catchAsync(async (req, res) => {
  const since = dayjs().subtract(7, 'day').toDate();
  const [jobFailures, recentFailures] = await Promise.all([
    JobEvent.countDocuments({ clinicId: req.tenant.clinicId, createdAt: { $gte: since } }),
    JobEvent.find({ clinicId: req.tenant.clinicId }).sort('-createdAt').limit(20).lean(),
  ]);
  ok(res, { queue: redisStatus(), jobFailures, recentFailures });
}));

export default router;
