import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import db from '../../db/index.js';
import { Clinic, Subscription, User, AuditLog, Doctor, Patient, Appointment, Payment, Communication, Branch, AIConversation, SupportTicket, SystemSetting, JobEvent, WebhookEvent } from '../../models/index.js';
import { getPlans, invalidatePlans } from '../../services/plans.service.js';
import { invalidateClinicStatus } from '../../middleware/auth.js';
import { redisStatus } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { validate } from '../../middleware/validate.js';
import { PLANS, ROLES, ALL_FEATURES } from '../../config/constants.js';
import { recordAudit } from '../../middleware/audit.js';
import { normalisePhone } from '../../services/otp.service.js';

const router = Router();

// ---------------------------------------------------------------- Overview

/** Platform-wide KPIs for the super admin landing page. */
router.get('/overview', catchAsync(async (req, res) => {
  const since = dayjs().subtract(30, 'day').startOf('day').toDate();

  const [totalClinics, activeClinics, totalUsers, totalDoctors, totalPatients, totalAppointments, subsByStatus, activePlans, signups, usage, communications] = await Promise.all([
    Clinic.countDocuments(),
    Clinic.countDocuments({ isActive: true }),
    User.countDocuments(),
    Doctor.countDocuments().setOptions({ crossTenant: true }),
    Patient.countDocuments().setOptions({ crossTenant: true }),
    Appointment.countDocuments().setOptions({ crossTenant: true }),
    Subscription.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Subscription.aggregate([{ $match: { status: 'ACTIVE' } }, { $group: { _id: '$plan', count: { $sum: 1 } } }]),
    Clinic.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Subscription.aggregate([{ $group: { _id: null, aiTokens: { $sum: '$usage.aiTokens' }, whatsappMessages: { $sum: '$usage.whatsappMessages' } } }]),
    Communication.aggregate([
      { $match: { status: { $in: ['SENT', 'DELIVERED', 'READ'] } } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]).option({ crossTenant: true }),
  ]);

  const byStatus = Object.fromEntries(subsByStatus.map((s) => [s._id, s.count]));
  const mrr = activePlans.reduce((sum, p) => sum + (PLANS[p._id]?.price || 0) * p.count, 0);
  const communicationByChannel = Object.fromEntries(communications.map((item) => [item._id, item.count]));

  ok(res, {
    kpis: {
      totalClinics,
      activeClinics,
      trialingClinics: byStatus.TRIALING || 0,
      pastDueClinics: byStatus.PAST_DUE || 0,
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAppointments,
      mrr,
      monthlyRevenue: mrr,
      inactiveClinics: totalClinics - activeClinics,
      activeSubscriptions: byStatus.ACTIVE || 0,
      aiUsage: usage[0]?.aiTokens || 0,
      whatsappUsage: usage[0]?.whatsappMessages || communicationByChannel.WHATSAPP || 0,
      smsUsage: communicationByChannel.SMS || 0,
      emailUsage: communicationByChannel.EMAIL || 0,
    },
    charts: {
      signupsByDay: signups.map((s) => ({ date: s._id, count: s.count })),
      planBreakdown: activePlans.map((p) => ({ plan: p._id, count: p.count })),
    },
  });
}));

const loginPassword = z.string().min(8, 'Use at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number');

const createClinicSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().min(10).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional(),
  plan: z.enum(['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE']).default('STARTER'),
  status: z.enum(['TRIALING', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED']).default('TRIALING'),
  // The clinic owner's login — there is no public sign-up, so this is how owners get in.
  owner: z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    phone: z.string().trim().min(10).max(15),
    password: loginPassword,
  }),
});

/** Onboards a clinic: tenant, subscription and the owner's login in one go. */
router.post('/clinics', validate(createClinicSchema), catchAsync(async (req, res) => {
  const { name, plan, status, owner, city } = req.body;
  const email = req.body.email || owner.email;
  const phone = normalisePhone(req.body.phone || owner.phone);

  const baseSlug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clinic';
  let slug = baseSlug;
  if (await Clinic.exists({ slug })) slug = `${baseSlug}-${Date.now().toString(36).slice(-5)}`;

  const trialDays = Number((await SystemSetting.findOne({ key: 'defaultTrialDays' }).lean())?.value) || 14;
  const clinic = await Clinic.create({ name, email, phone, slug, ...(city ? { address: { city } } : {}) });
  try {
    const subscription = await Subscription.create({
      clinicId: clinic._id, plan, status,
      trialEndsAt: status === 'TRIALING' ? new Date(Date.now() + trialDays * 864e5) : undefined,
      usage: { periodKey: new Date().toISOString().slice(0, 7) },
    });
    const user = new User({
      name: owner.name, email: owner.email.toLowerCase(), phone: normalisePhone(owner.phone),
      role: ROLES.CLINIC_OWNER, clinicId: clinic._id, invitedByUserId: req.user._id,
    });
    await user.setPassword(owner.password);
    await user.save();

    recordAudit(req, { action: 'PLATFORM_CLINIC_CREATED', entityType: 'Clinic', entityId: clinic._id, after: { name: clinic.name, plan: subscription.plan, owner: user.email }, clinicId: clinic._id });
    created(res, { ...clinic.toObject(), subscription, owner: user.toSafeJSON() });
  } catch (e) {
    // Don't leave a half-onboarded tenant behind.
    await Promise.all([Clinic.deleteOne({ _id: clinic._id }), Subscription.deleteOne({ clinicId: clinic._id }), User.deleteMany({ clinicId: clinic._id })]);
    throw e;
  }
}));

// ----------------------------------------------------------------- Clinics

/** Every tenant, with subscription and headcount, for the clinics table. */
router.get('/clinics', catchAsync(async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;
  const filter = q ? { name: { $regex: q, $options: 'i' } } : {};

  const [clinics, total] = await Promise.all([
    Clinic.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
    Clinic.countDocuments(filter),
  ]);

  const clinicIds = clinics.map((c) => c._id);
  const [subs, userCounts] = await Promise.all([
    Subscription.find({ clinicId: { $in: clinicIds } }).lean(),
    User.aggregate([
      { $match: { clinicId: { $in: clinicIds } } },
      { $group: { _id: '$clinicId', count: { $sum: 1 } } },
    ]),
  ]);
  const subByClinic = Object.fromEntries(subs.map((s) => [String(s.clinicId), s]));
  const usersByClinic = Object.fromEntries(userCounts.map((u) => [String(u._id), u.count]));

  ok(res, clinics.map((c) => ({
    ...c,
    subscription: subByClinic[String(c._id)] || null,
    userCount: usersByClinic[String(c._id)] || 0,
  })), { total, page: Number(page), limit: Number(limit) });
}));

/** One clinic's full picture: profile, subscription and its staff. */
router.get('/clinics/:id', catchAsync(async (req, res) => {
  const clinic = await Clinic.findById(req.params.id).lean();
  if (!clinic) throw ApiError.notFound('Clinic not found');

  const [subscription, users] = await Promise.all([
    Subscription.findOne({ clinicId: clinic._id }).lean(),
    User.find({ clinicId: clinic._id }).select('-passwordHash -refreshTokenHash').sort({ createdAt: 1 }).lean(),
  ]);

  ok(res, { ...clinic, subscription, users });
}));

/** Suspend or reinstate a clinic's access to the platform. */
router.patch('/clinics/:id/status', catchAsync(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') throw ApiError.badRequest('isActive must be a boolean');

  const clinic = await Clinic.findByIdAndUpdate(req.params.id, { isActive }, { new: true });
  invalidateClinicStatus(req.params.id);
  if (!clinic) throw ApiError.notFound('Clinic not found');

  recordAudit(req, { action: isActive ? 'CLINIC_REACTIVATED' : 'CLINIC_SUSPENDED', entityType: 'Clinic', entityId: clinic._id, clinicId: clinic._id });
  ok(res, clinic);
}));

router.patch('/clinics/:id', validate(z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), phone: z.string().min(10).optional(), isActive: z.boolean().optional() })), catchAsync(async (req, res) => {
  const clinic = await Clinic.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!clinic) throw ApiError.notFound('Clinic not found');
  invalidateClinicStatus(clinic._id);
  recordAudit(req, { action: 'PLATFORM_CLINIC_UPDATED', entityType: 'Clinic', entityId: clinic._id, after: req.body, clinicId: clinic._id });
  ok(res, clinic);
}));

const subscriptionUpdateSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE']).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED']).optional(),
}).refine((d) => d.plan || d.status, { message: 'Provide a plan or a status to update' });

/** Comp a plan, correct a status after an offline payment, etc. */
router.patch('/clinics/:id/subscription', validate(subscriptionUpdateSchema), catchAsync(async (req, res) => {
  const subscription = await Subscription.findOneAndUpdate(
    { clinicId: req.params.id }, req.body, { new: true }
  );
  if (!subscription) throw ApiError.notFound('This clinic has no subscription record');

  recordAudit(req, { action: 'PLATFORM_SUBSCRIPTION_UPDATED', entityType: 'Subscription', entityId: subscription._id, after: req.body, clinicId: subscription.clinicId });
  ok(res, subscription);
}));

// ------------------------------------------------------------------- Users

/** Every user on the platform, across every clinic. */
router.get('/users', catchAsync(async (req, res) => {
  const { q, role, clinicId, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (q) filter.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }];
  if (role) filter.role = role;
  if (clinicId) filter.clinicId = clinicId;

  const [users, total] = await Promise.all([
    // Branch is tenant-scoped; this platform-wide listing opts out deliberately.
    User.find(filter).select('-passwordHash -refreshTokenHash').populate('clinicId', 'name slug')
      .populate({ path: 'branchId', select: 'name code', options: { crossTenant: true } })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
    User.countDocuments(filter),
  ]);

  ok(res, users, { total, page: Number(page), limit: Number(limit) });
}));

// Super admins are provisioned via the seed script, not this endpoint — every
// role it can create belongs to a clinic, so clinicId is always required.
const CREATABLE_ROLES = Object.values(ROLES).filter((r) => r !== ROLES.SUPER_ADMIN);

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(10),
  password: loginPassword,
  role: z.enum(CREATABLE_ROLES.filter((r) => r !== ROLES.PATIENT)),
  clinicId: z.string().min(1, 'Choose a clinic for this role'),
  branchId: z.string().optional().or(z.literal('')),
  // Doctors get a clinical profile created and linked so their panel works immediately.
  specialization: z.string().trim().max(80).optional(),
  consultationFee: z.coerce.number().min(0).optional(),
});

/** Super admin provisioning any clinic panel login directly. */
router.post('/users', validate(createUserSchema), catchAsync(async (req, res) => {
  const { name, password, role, clinicId, specialization, consultationFee } = req.body;
  const email = req.body.email.toLowerCase();
  const phone = normalisePhone(req.body.phone);
  const branchId = req.body.branchId || undefined;

  if (!db.isValidObjectId(clinicId) || !(await Clinic.exists({ _id: clinicId }))) {
    throw ApiError.badRequest('That clinic does not exist', 'CLINIC_NOT_FOUND');
  }
  if (role === ROLES.BRANCH_MANAGER && !branchId) throw ApiError.badRequest('Assign a branch to a branch manager', 'BRANCH_REQUIRED');
  if (branchId && !(await Branch.exists({ _id: branchId }).setOptions({ clinicId }))) {
    throw ApiError.badRequest('That branch does not belong to this clinic', 'BRANCH_NOT_FOUND');
  }
  if (await User.exists({ clinicId, email })) throw ApiError.conflict('Someone in this clinic already uses that email', 'EMAIL_IN_USE');

  const user = new User({ name, email, phone, role, clinicId, branchId, invitedByUserId: req.user._id });
  await user.setPassword(password);

  let doctor = null;
  if (role === ROLES.DOCTOR) {
    doctor = await Doctor.create({ clinicId, branchId, name, specialization, consultationFee: consultationFee ?? 0, userId: user._id });
    user.doctorId = doctor._id;
  }
  try {
    await user.save();
  } catch (e) {
    if (doctor) await Doctor.deleteOne({ _id: doctor._id }).setOptions({ clinicId });
    throw e;
  }

  recordAudit(req, { action: 'PLATFORM_USER_CREATED', entityType: 'User', entityId: user._id, after: { email, role, clinicId }, clinicId: user.clinicId });
  created(res, user.toSafeJSON());
}));

/** Deactivate a compromised or offboarded account, or bring one back. */
router.patch('/users/:id/status', catchAsync(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') throw ApiError.badRequest('isActive must be a boolean');
  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  const user = await User.findByIdAndUpdate(req.params.id, { isActive }, { new: true })
    .select('-passwordHash -refreshTokenHash');
  if (!user) throw ApiError.notFound('User not found');

  recordAudit(req, { action: isActive ? 'PLATFORM_USER_REACTIVATED' : 'PLATFORM_USER_DEACTIVATED', entityType: 'User', entityId: user._id, clinicId: user.clinicId });
  ok(res, user);
}));

// Super admin is never assignable through the API — only the provisioning script creates one.
const userUpdateSchema = z.object({ name: z.string().min(2).optional(), phone: z.string().min(10).optional(), role: z.enum(CREATABLE_ROLES).optional(), branchId: z.string().nullable().optional() }).refine((data) => Object.keys(data).length > 0);
router.patch('/users/:id', validate(userUpdateSchema), catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === ROLES.SUPER_ADMIN && req.body.role) throw ApiError.badRequest('Super admin roles cannot be changed here');
  const update = { ...req.body };
  if (update.role && update.role !== target.role) update.refreshTokenHash = undefined;
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-passwordHash -refreshTokenHash');
  recordAudit(req, { action: 'PLATFORM_USER_UPDATED', entityType: 'User', entityId: user._id, after: req.body, clinicId: user.clinicId });
  ok(res, user);
}));

router.post('/users/:id/reset-access', validate(z.object({ password: z.string().min(8, 'Use at least 8 characters') })), catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  await user.setPassword(req.body.password);
  user.refreshTokenHash = undefined;
  await user.save();
  recordAudit(req, { action: 'PLATFORM_USER_ACCESS_RESET', entityType: 'User', entityId: user._id, clinicId: user.clinicId });
  ok(res, { message: 'Access reset successfully' });
}));

// ----------------------------------------------------------- Operations
router.get('/subscriptions', catchAsync(async (_req, res) => {
  const items = await Subscription.find().populate('clinicId', 'name slug isActive').sort({ updatedAt: -1 }).lean();
  ok(res, items);
}));

router.get('/usage', catchAsync(async (_req, res) => {
  const items = await Subscription.find().populate('clinicId', 'name').sort({ updatedAt: -1 }).lean();
  ok(res, items.map((item) => ({ clinic: item.clinicId, plan: item.plan, status: item.status, usage: item.usage || {} })));
}));

router.get('/ai-usage', catchAsync(async (_req, res) => {
  const conversations = await AIConversation.aggregate([
    { $group: { _id: '$clinicId', conversations: { $sum: 1 }, tokens: { $sum: '$tokensUsed' } } },
    { $lookup: { from: 'clinics', localField: '_id', foreignField: '_id', as: 'clinic' } },
    { $project: { conversations: 1, tokens: 1, clinic: { $first: '$clinic.name' } } },
  ]).option({ crossTenant: true });
  ok(res, conversations.map((item) => ({ clinicId: item._id, clinic: item.clinic || 'Deleted clinic', conversations: item.conversations, tokens: item.tokens })));
}));

router.get('/communication-usage', catchAsync(async (_req, res) => {
  const usage = await Communication.aggregate([
    { $group: { _id: { clinicId: '$clinicId', channel: '$channel' }, count: { $sum: 1 }, costPaise: { $sum: '$costPaise' } } },
    { $lookup: { from: 'clinics', localField: '_id.clinicId', foreignField: '_id', as: 'clinic' } },
    { $project: { channel: '$_id.channel', count: 1, costPaise: 1, clinic: { $first: '$clinic.name' } } },
    { $sort: { clinic: 1, channel: 1 } },
  ]).option({ crossTenant: true });
  ok(res, usage);
}));

router.get('/payments', catchAsync(async (_req, res) => {
  const payments = await Payment.find().setOptions({ crossTenant: true }).sort({ createdAt: -1 }).limit(100).lean();
  ok(res, payments);
}));

router.get('/analytics', catchAsync(async (_req, res) => {
  const [appointmentsByStatus, clinicGrowth] = await Promise.all([
    Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).option({ crossTenant: true }),
    Clinic.aggregate([{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  ok(res, { appointmentsByStatus: appointmentsByStatus.map((item) => ({ status: item._id, count: item.count })), clinicGrowth: clinicGrowth.map((item) => ({ month: item._id, count: item.count })) });
}));

/**
 * Operational picture of one clinic. Platform staff get counts, not patient
 * records — clinical and personal data stays inside the tenant.
 */
router.get('/clinic-details/:id', catchAsync(async (req, res) => {
  const clinicId = req.params.id;
  const [branches, doctors, patientCount, appointmentsByStatus] = await Promise.all([
    Branch.find().select('name code isActive').setOptions({ clinicId }).lean(),
    Doctor.find().select('name specialization isActive').setOptions({ clinicId }).lean(),
    Patient.countDocuments().setOptions({ clinicId }),
    Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).option({ clinicId: new db.Types.ObjectId(String(clinicId)) }),
  ]);
  ok(res, {
    branches, doctors, patientCount,
    appointmentCount: appointmentsByStatus.reduce((s, a) => s + a.count, 0),
    appointmentsByStatus: appointmentsByStatus.map((a) => ({ status: a._id, count: a.count })),
  });
}));

// ----------------------------------------------------------------- Branches (all tenants)
router.get('/branches', catchAsync(async (_req, res) => {
  const rows = await Branch.aggregate([
    { $lookup: { from: 'clinics', localField: 'clinicId', foreignField: '_id', as: 'clinic' } },
    { $project: { name: 1, code: 1, isActive: 1, 'address.city': 1, createdAt: 1, clinic: { $first: '$clinic.name' }, clinicId: 1 } },
    { $sort: { clinic: 1, name: 1 } },
  ]).option({ crossTenant: true });
  ok(res, rows);
}));

// ----------------------------------------------------------------- Platform revenue
router.get('/revenue', catchAsync(async (_req, res) => {
  const plans = await getPlans();
  const subs = await Subscription.find().populate('clinicId', 'name isActive').lean();
  const active = subs.filter((s) => s.status === 'ACTIVE' && s.clinicId?.isActive);
  const byPlan = {};
  for (const s of active) {
    const price = plans[s.plan]?.price || 0;
    byPlan[s.plan] ||= { plan: s.plan, clinics: 0, mrr: 0 };
    byPlan[s.plan].clinics += 1;
    byPlan[s.plan].mrr += price;
  }
  const trialsEnding = subs.filter((s) => s.status === 'TRIALING' && s.trialEndsAt && dayjs(s.trialEndsAt).isBefore(dayjs().add(7, 'day')))
    .map((s) => ({ clinic: s.clinicId?.name, trialEndsAt: s.trialEndsAt, plan: s.plan }));
  ok(res, {
    mrr: Object.values(byPlan).reduce((a, p) => a + p.mrr, 0),
    byPlan: Object.values(byPlan),
    statusCounts: subs.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {}),
    pastDue: subs.filter((s) => s.status === 'PAST_DUE').map((s) => ({ clinic: s.clinicId?.name, plan: s.plan, since: s.updatedAt })),
    trialsEnding,
    note: 'Subscription billing is recorded by plan status. Collecting subscription fees through a gateway is not wired yet.',
  });
}));

// ----------------------------------------------------------------- Integrations & health
router.get('/integrations', catchAsync(async (_req, res) => {
  // Booleans only — no secret, key fragment or token is ever returned.
  const since = dayjs().subtract(24, 'hour').toDate();
  const failures = await Communication.aggregate([
    { $match: { createdAt: { $gte: since }, status: 'FAILED' } }, { $group: { _id: '$channel', count: { $sum: 1 } } },
  ]).option({ crossTenant: true });
  const failed = Object.fromEntries(failures.map((f) => [f._id, f.count]));
  ok(res, [
    { key: 'whatsapp', name: 'WhatsApp Cloud API', configured: env.whatsapp.enabled, webhookSigned: Boolean(env.whatsapp.appSecret), failures24h: failed.WHATSAPP || 0 },
    { key: 'razorpay', name: 'Razorpay', configured: env.razorpay.enabled, webhookSigned: Boolean(env.razorpay.webhookSecret) },
    { key: 'email', name: 'Email (Resend)', configured: env.email.enabled, failures24h: failed.EMAIL || 0 },
    { key: 'sms', name: 'SMS', configured: false, failures24h: failed.SMS || 0, note: 'No SMS provider wired — messages are logged only' },
    { key: 'openai', name: 'AI assistant (OpenAI)', configured: Boolean(env.openaiKey), note: env.openaiKey ? undefined : 'Rule-based booking assistant in use' },
    { key: 'storage', name: 'Private file storage', configured: true, note: env.storage?.s3Bucket ? 'AWS S3' : 'Local private disk (STORAGE_DIR)' },
    { key: 'stripe', name: 'Stripe', configured: Boolean(process.env.STRIPE_SECRET_KEY), note: process.env.STRIPE_SECRET_KEY ? undefined : 'Add Stripe credentials on the server to accept international cards' },
    { key: 'google_calendar', name: 'Google Calendar', configured: true, note: 'Per-doctor private ICS feed — subscribe from Google Calendar' },
    { key: 'outlook_calendar', name: 'Outlook Calendar', configured: true, note: 'Same ICS feed — "Add calendar → From internet" in Outlook' },
    { key: 'google_maps', name: 'Google Maps', configured: true, note: 'Clinic map link shared by the WhatsApp assistant' },
    { key: 'google_business', name: 'Google Business Profile', configured: true, note: 'Booking link + review link set per clinic' },
    { key: 'teleconsult', name: 'Teleconsultation (video)', configured: true, note: 'Private Jitsi Meet room per online visit; Zoom / Google Meet links can be pasted per visit' },
    { key: 'lab_api', name: 'Lab APIs', configured: false, note: 'Planned' },
    { key: 'pharmacy_api', name: 'Pharmacy APIs', configured: false, note: 'Planned' },
  ]);
}));

router.get('/health', catchAsync(async (_req, res) => {
  const since = dayjs().subtract(24, 'hour').toDate();
  const t0 = Date.now();
  await db.connection.db.admin().ping();
  const dbLatencyMs = Date.now() - t0;
  const [jobEvents, recentJobFailures, comms, webhooks] = await Promise.all([
    JobEvent.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { queue: '$queue', status: '$status' }, count: { $sum: 1 } } }]),
    JobEvent.find({ status: { $ne: 'COMPLETED' } }).sort({ createdAt: -1 }).limit(25).populate('clinicId', 'name').lean(),
    Communication.aggregate([{ $match: { createdAt: { $gte: since }, direction: { $ne: 'INBOUND' } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).option({ crossTenant: true }),
    WebhookEvent.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$provider', count: { $sum: 1 }, unprocessed: { $sum: { $cond: [{ $ifNull: ['$processedAt', false] }, 0, 1] } } } }]),
  ]);
  ok(res, {
    api: { uptimeSeconds: Math.round(process.uptime()), node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1e6) },
    database: { ok: true, latencyMs: dbLatencyMs },
    queue: { redis: redisStatus() },
    jobs: jobEvents.map((j) => ({ queue: j._id.queue, status: j._id.status, count: j.count })),
    recentJobFailures,
    messages24h: Object.fromEntries(comms.map((c) => [c._id, c.count])),
    webhooks24h: webhooks.map((w) => ({ provider: w._id, count: w.count, unprocessed: w.unprocessed })),
  });
}));

// ----------------------------------------------------------------- Plans
router.get('/plans', catchAsync(async (_req, res) => {
  const plans = await getPlans();
  ok(res, { plans: Object.values(plans).map((p) => ({ ...p, maxDoctors: Number.isFinite(p.maxDoctors) ? p.maxDoctors : null, maxBranches: Number.isFinite(p.maxBranches) ? p.maxBranches : null })), allFeatures: ALL_FEATURES });
}));

router.put('/plans/:name', validate(z.object({
  price: z.number().min(0).nullable().optional(),
  maxDoctors: z.number().int().min(1).nullable().optional(),
  maxBranches: z.number().int().min(1).nullable().optional(),
  features: z.array(z.enum([...ALL_FEATURES, '*'])).optional(),
})), catchAsync(async (req, res) => {
  const name = req.params.name.toUpperCase();
  if (!PLANS[name]) throw ApiError.notFound('Unknown plan');
  const current = (await SystemSetting.findOne({ key: 'planOverrides' }).lean())?.value || {};
  const next = { ...current, [name]: { ...(current[name] || {}), ...req.body } };
  await SystemSetting.findOneAndUpdate({ key: 'planOverrides' },
    { value: next, description: 'Super admin overrides to plan prices, limits and features', updatedByUserId: req.user._id },
    { upsert: true, new: true });
  invalidatePlans();
  recordAudit(req, { action: 'PLAN_UPDATED', entityType: 'Plan', after: { name, ...req.body } });
  ok(res, (await getPlans())[name]);
}));

// --------------------------------------------------------------- Support
router.get('/support', catchAsync(async (_req, res) => {
  const tickets = await SupportTicket.find().populate('clinicId', 'name').populate('createdByUserId', 'name email').sort({ createdAt: -1 }).lean();
  ok(res, tickets);
}));

router.post('/support', validate(z.object({ clinicId: z.string().optional(), subject: z.string().min(3), description: z.string().min(3), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional() })), catchAsync(async (req, res) => {
  const ticket = await SupportTicket.create({ ...req.body, createdByUserId: req.user._id });
  recordAudit(req, { action: 'SUPPORT_TICKET_CREATED', entityType: 'SupportTicket', entityId: ticket._id, clinicId: ticket.clinicId });
  created(res, ticket);
}));

router.patch('/support/:id', validate(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional() }).refine((value) => Object.keys(value).length > 0)), catchAsync(async (req, res) => {
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  recordAudit(req, { action: 'SUPPORT_TICKET_UPDATED', entityType: 'SupportTicket', entityId: ticket._id, after: req.body, clinicId: ticket.clinicId });
  ok(res, ticket);
}));

// -------------------------------------------------------- System settings
router.get('/settings', catchAsync(async (_req, res) => {
  const defaults = [
    { key: 'platformName', value: 'ClinicSaathi', description: 'Name shown in platform communications' },
    { key: 'maintenanceMode', value: false, description: 'Temporarily restrict non-admin access' },
    { key: 'publicRegistrationEnabled', value: true, description: 'Allow clinics to create accounts from the public registration page' },
    { key: 'whatsappEnabled', value: true, description: 'Enable WhatsApp communications platform-wide' },
    { key: 'smsEnabled', value: true, description: 'Enable SMS communications platform-wide' },
    { key: 'emailEnabled', value: true, description: 'Enable email communications platform-wide' },
    { key: 'defaultTrialDays', value: 14, description: 'Default free-trial duration for new clinics' },
  ];
  const stored = await SystemSetting.find().sort({ key: 1 }).lean();
  const byKey = new Map(stored.map((setting) => [setting.key, setting]));
  ok(res, defaults.map((setting) => byKey.get(setting.key) || setting).concat(stored.filter((setting) => !defaults.some((fallback) => fallback.key === setting.key))));
}));

router.put('/settings/:key', validate(z.object({ value: z.any(), description: z.string().max(300).optional() })), catchAsync(async (req, res) => {
  const setting = await SystemSetting.findOneAndUpdate({ key: req.params.key }, { ...req.body, updatedByUserId: req.user._id }, { new: true, upsert: true, setDefaultsOnInsert: true });
  recordAudit(req, { action: 'SYSTEM_SETTING_UPDATED', entityType: 'SystemSetting', entityId: setting._id, after: { key: setting.key }, clinicId: undefined });
  ok(res, setting);
}));

// -------------------------------------------------------------- Audit log

/** Every recorded platform and clinic action, newest first. */
router.get('/audit-logs', catchAsync(async (req, res) => {
  const { clinicId, action, page = 1, limit = 30 } = req.query;
  const filter = {};
  if (clinicId) filter.clinicId = clinicId;
  if (action) filter.action = action;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actorUserId', 'name role')
      .populate('clinicId', 'name')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
    AuditLog.countDocuments(filter),
  ]);

  ok(res, logs, { total, page: Number(page), limit: Number(limit) });
}));

export default router;
