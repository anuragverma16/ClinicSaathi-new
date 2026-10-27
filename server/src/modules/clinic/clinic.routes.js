import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import {
  Clinic, Branch, Appointment, Patient, QueueToken, Invoice, FollowUp, Recall, Communication, User, Doctor, SupportTicket,
  Subscription, Payment, Notification,
} from '../../models/index.js';
import { scoped } from '../../models/plugins/tenantScope.js';
import { requireRole, requirePermission, branchFilter } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { assertWithinLimit } from '../../middleware/planGate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { ROLES, STAFF_ROLES, DEFAULT_AVAILABILITY } from '../../config/constants.js';
import { recordAudit } from '../../middleware/audit.js';
import { getEntitlements } from '../../services/plans.service.js';
import { normalisePhone } from '../../services/otp.service.js';
import { TZ, dateKey } from '../../utils/slots.js';

const router = Router();
const owner = requireRole(ROLES.CLINIC_OWNER);
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');

// ------------------------------------------------------------------ Overview

/** Today's operational numbers. Branch staff see only their branch. */
router.get('/overview', requirePermission('analytics:read'), catchAsync(async (req, res) => {
  const clinicId = req.tenant.clinicId;
  const bf = branchFilter(req);
  const today = { $gte: dayjs().tz(TZ).startOf('day').toDate(), $lte: dayjs().tz(TZ).endOf('day').toDate() };
  const month = { $gte: dayjs().tz(TZ).startOf('month').toDate(), $lte: dayjs().tz(TZ).endOf('month').toDate() };
  const paidMatch = (range) => ({ ...bf, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, verifiedAt: range });

  const [appointmentCounts, waitingPatients, newPatients, returningPatients, todayRevenue, monthlyRevenue, pendingInvoices, followUpsDue, recallDue, reviewRequests, upcoming] = await Promise.all([
    Appointment.aggregate([{ $match: { ...bf, startAt: today } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).option({ clinicId }),
    QueueToken.countDocuments({ ...bf, queueDate: dateKey(new Date()), status: { $in: ['WAITING', 'CALLED'] } }).setOptions({ clinicId }),
    Patient.countDocuments({ createdAt: today }).setOptions({ clinicId }),
    Patient.countDocuments({ visitCount: { $gt: 1 } }).setOptions({ clinicId }),
    Payment.aggregate([{ $match: paidMatch(today) }, { $group: { _id: null, total: { $sum: '$amount' } } }]).option({ clinicId }),
    Payment.aggregate([{ $match: paidMatch(month) }, { $group: { _id: null, total: { $sum: '$amount' } } }]).option({ clinicId }),
    Invoice.aggregate([{ $match: { ...bf, status: { $in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } },
      { $group: { _id: null, count: { $sum: 1 }, due: { $sum: { $subtract: ['$total', '$amountPaid'] } } } }]).option({ clinicId }),
    FollowUp.countDocuments({ dueDate: { $lte: today.$lte }, status: { $in: ['SCHEDULED', 'ESCALATED', 'RESPONDED'] } }).setOptions({ clinicId }),
    Recall.countDocuments({ dueDate: { $lte: today.$lte }, status: 'DUE' }).setOptions({ clinicId }),
    Communication.countDocuments({ createdAt: month, event: 'REVIEW_REQUEST', status: { $in: ['SENT', 'DELIVERED', 'READ'] } }).setOptions({ clinicId }),
    Appointment.countDocuments({ ...bf, startAt: { $gt: today.$lte }, status: { $in: ['REQUESTED', 'CONFIRMED'] } }).setOptions({ clinicId }),
  ]);
  const counts = Object.fromEntries(appointmentCounts.map((i) => [i._id, i.count]));
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  ok(res, {
    todayAppointments: total,
    completedAppointments: counts.COMPLETED || 0,
    pendingAppointments: (counts.CONFIRMED || 0) + (counts.REQUESTED || 0),
    inClinic: (counts.WAITING || 0) + (counts.CHECKED_IN || 0) + (counts.IN_CONSULTATION || 0),
    noShows: counts.NO_SHOW || 0,
    cancelled: counts.CANCELLED || 0,
    upcomingAppointments: upcoming,
    waitingPatients, newPatients, returningPatients,
    todayRevenue: todayRevenue[0]?.total || 0,
    monthlyRevenue: monthlyRevenue[0]?.total || 0,
    pendingPayments: pendingInvoices[0]?.count || 0,
    outstandingAmount: pendingInvoices[0]?.due || 0,
    followUpsDue, recallDue, reviewRequests,
  });
}));

// ------------------------------------------------------------------ Profile & settings

router.get('/me', catchAsync(async (req, res) => {
  const clinic = await Clinic.findById(req.tenant.clinicId).lean();
  // Only owners see integration identifiers.
  if (req.user.role !== ROLES.CLINIC_OWNER) delete clinic.integrations;
  ok(res, clinic);
}));

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: z.string().max(160),
  about: z.string().max(2000),
  logoUrl: z.string().url().or(z.literal('')),
  email: z.string().email().or(z.literal('')),
  phone: z.string().max(20),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/, 'GSTIN is 15 characters').or(z.literal('')),
  address: z.object({ line1: z.string().max(200), line2: z.string().max(200), city: z.string().max(80), state: z.string().max(80), pincode: z.string().max(10) }).partial(),
  timings: z.object({ workingDays: z.array(z.number().int().min(0).max(6)), openTime: hhmm, closeTime: hhmm }).partial(),
  bookingPolicy: z.object({
    requirePrepayment: z.boolean(), holdMinutes: z.number().int().min(5).max(120),
    cancelCutoffHours: z.number().min(0).max(168), rescheduleCutoffHours: z.number().min(0).max(168),
    maxAdvanceDays: z.number().int().min(1).max(365), requirePhoneVerification: z.boolean(), allowOnlineBooking: z.boolean(),
  }).partial(),
  notificationSettings: z.object({
    reminderHours: z.array(z.number().int().refine((h) => [1, 2, 3, 4, 6, 12, 24, 48, 72].includes(h), 'Unsupported reminder offset')).max(3),
    events: z.record(z.boolean()),
    templates: z.record(z.string().regex(/^[a-z0-9_]{1,512}$/, 'Template names are lowercase letters, digits and _')),
    reviewDelayHours: z.number().min(1).max(72),
  }).partial(),
  reviewUrl: z.string().url().or(z.literal('')),
  patientInfo: z.object({
    insurance: z.string().max(500), parking: z.string().max(300), emergencyContact: z.string().max(120), mapUrl: z.string().url().or(z.literal('')),
  }).partial(),
  channels: z.object({
    websiteUrl: z.string().url().or(z.literal('')), googleBusinessUrl: z.string().url().or(z.literal('')),
    facebookUrl: z.string().url().or(z.literal('')), instagramUrl: z.string().url().or(z.literal('')),
  }).partial(),
  festivals: z.array(z.object({ name: z.string().trim().min(2).max(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), message: z.string().max(500).optional() })).max(40),
  integrations: z.object({ whatsappPhoneNumberId: z.string().regex(/^\d{5,25}$/).or(z.literal('')) }).partial(),
  onboarding: z.object({ completed: z.boolean(), currentStep: z.number().int().min(1).max(10) }).partial(),
}).partial();

/** Flattens nested objects into dotted $set paths so partial updates don't wipe siblings. */
function toSet(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !['templates', 'events'].includes(k)) toSet(v, key, out);
    else if (k === 'events' || k === 'templates') for (const [ek, ev] of Object.entries(v)) out[`${key}.${ek}`] = ev;
    else out[key] = v;
  }
  return out;
}

router.patch('/me', owner, validate(settingsSchema), catchAsync(async (req, res) => {
  const set = toSet(req.body);
  if (set['integrations.whatsappPhoneNumberId']) {
    const taken = await Clinic.exists({ 'integrations.whatsappPhoneNumberId': set['integrations.whatsappPhoneNumberId'], _id: { $ne: req.tenant.clinicId } });
    if (taken) throw ApiError.conflict('That WhatsApp number is linked to another clinic', 'WHATSAPP_NUMBER_TAKEN');
  }
  const clinic = await Clinic.findByIdAndUpdate(req.tenant.clinicId, { $set: set }, { new: true, runValidators: true });
  recordAudit(req, { action: 'CLINIC_SETTINGS_UPDATED', entityType: 'Clinic', entityId: clinic._id, after: { fields: Object.keys(set) } });
  ok(res, clinic);
}));

router.post('/me/holidays', owner, validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(120).optional() })),
  catchAsync(async (req, res) => {
    const date = dayjs.tz(req.body.date, TZ).toDate();
    const clinic = await Clinic.findByIdAndUpdate(req.tenant.clinicId, { $push: { holidays: { date, reason: req.body.reason } } }, { new: true });
    recordAudit(req, { action: 'HOLIDAY_ADDED', entityType: 'Clinic', entityId: clinic._id, after: req.body });
    ok(res, clinic.holidays);
  }));

router.delete('/me/holidays/:holidayId', owner, catchAsync(async (req, res) => {
  const clinic = await Clinic.findByIdAndUpdate(req.tenant.clinicId, { $pull: { holidays: { _id: req.params.holidayId } } }, { new: true });
  recordAudit(req, { action: 'HOLIDAY_REMOVED', entityType: 'Clinic', entityId: clinic._id });
  ok(res, clinic.holidays);
}));

router.get('/subscription', owner, catchAsync(async (req, res) => {
  const clinicId = req.tenant.clinicId;
  const [sub, ent, doctors, branches, staff] = await Promise.all([
    Subscription.findOne({ clinicId }).lean(), getEntitlements(clinicId),
    Doctor.countDocuments({ isActive: true }).setOptions({ clinicId }),
    Branch.countDocuments({ isActive: true }).setOptions({ clinicId }),
    User.countDocuments({ clinicId, role: { $ne: ROLES.PATIENT } }),
  ]);
  ok(res, { subscription: sub, entitlements: { plan: ent.plan, live: ent.live, features: ent.features, limits: ent.limits }, usage: { doctors, branches, staff, ...(sub?.usage || {}) } });
}));

// ------------------------------------------------------------------ Staff

const staffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  phone: z.string().trim().min(10).max(15),
  role: z.enum(STAFF_ROLES),
  branchId: objectId.optional().nullable(),
  doctorId: objectId.optional().nullable(),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/, 'Include a number'),
});

async function checkLinks(req, { branchId, doctorId, role }, userId) {
  if (branchId && !(await scoped(Branch, req).findById(branchId))) throw ApiError.badRequest('Branch not found', 'BRANCH_NOT_FOUND');
  if (role === ROLES.BRANCH_MANAGER && !branchId) throw ApiError.badRequest('Assign a branch to a branch manager', 'BRANCH_REQUIRED');
  if (doctorId) {
    const doctor = await scoped(Doctor, req).findById(doctorId);
    if (!doctor) throw ApiError.badRequest('Doctor profile not found', 'DOCTOR_NOT_FOUND');
    if (doctor.userId && String(doctor.userId) !== String(userId || '')) {
      throw ApiError.conflict('That doctor profile is already linked to another login', 'DOCTOR_ALREADY_LINKED');
    }
  }
}

router.get('/staff', requirePermission('staff:read'), catchAsync(async (req, res) => {
  const filter = { clinicId: req.tenant.clinicId, role: { $nin: [ROLES.PATIENT] } };
  if (req.user.role === ROLES.BRANCH_MANAGER) filter.branchId = req.tenant.branchId;
  const users = await User.find(filter).select('name email phone role branchId doctorId isActive lastLoginAt createdAt')
    .populate({ path: 'branchId', select: 'name', options: { clinicId: req.tenant.clinicId } })
    .populate({ path: 'doctorId', select: 'name specialization', options: { clinicId: req.tenant.clinicId } })
    .sort({ createdAt: -1 });
  ok(res, users);
}));

// A doctor login can bring its own new profile, so the owner adds a doctor in one step.
const createStaffSchema = staffSchema.extend({
  newDoctor: z.object({
    specialization: z.string().trim().max(80).optional(),
    qualification: z.string().trim().max(120).optional(),
    registrationNumber: z.string().trim().max(40).optional(),
    consultationFee: z.number().min(0).max(100000).optional(),
  }).optional(),
});

router.post('/staff', owner, validate(createStaffSchema), catchAsync(async (req, res) => {
  const { newDoctor, ...body } = req.body;
  const makeProfile = body.role === ROLES.DOCTOR && !body.doctorId && Boolean(newDoctor);
  await checkLinks(req, body);
  const email = body.email.toLowerCase();
  if (await User.exists({ clinicId: req.tenant.clinicId, email })) throw ApiError.conflict('Someone in your clinic already uses that email', 'EMAIL_IN_USE');
  if (makeProfile) await assertWithinLimit(req.tenant.clinicId, 'doctors', await scoped(Doctor, req).countDocuments({ isActive: true }));

  const user = new User({
    name: body.name, email, phone: normalisePhone(body.phone), role: body.role,
    clinicId: req.tenant.clinicId, branchId: body.branchId || undefined,
    doctorId: body.doctorId || undefined, invitedByUserId: req.user._id,
  });
  await user.setPassword(body.password);

  let doctor = null;
  if (makeProfile) {
    doctor = await scoped(Doctor, req).create({
      ...newDoctor, name: body.name, availability: DEFAULT_AVAILABILITY,
      branchId: body.branchId || undefined, userId: user._id,
    });
    user.doctorId = doctor._id;
  }
  try {
    await user.save();
  } catch (e) {
    if (doctor) await scoped(Doctor, req).deleteOne({ _id: doctor._id });
    throw e;
  }
  if (body.doctorId) await scoped(Doctor, req).updateOne({ _id: body.doctorId }, { userId: user._id });
  recordAudit(req, { action: 'STAFF_CREATED', entityType: 'User', entityId: user._id, after: { email, role: user.role, doctorProfileCreated: Boolean(doctor) } });
  created(res, user.toSafeJSON());
}));

router.patch('/staff/:id', owner, validate(staffSchema.omit({ password: true, email: true }).partial().extend({ isActive: z.boolean().optional() })),
  catchAsync(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, clinicId: req.tenant.clinicId });
    if (!user || user.role === ROLES.PATIENT) throw ApiError.notFound('Staff member not found');
    if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('Use your profile settings to change your own account');
    if (user.role === ROLES.CLINIC_OWNER) throw ApiError.forbidden('Owner accounts are managed by ClinicSaathi support');
    const next = { role: req.body.role ?? user.role, branchId: 'branchId' in req.body ? req.body.branchId : user.branchId };
    await checkLinks(req, { ...next, doctorId: req.body.doctorId }, user._id);

    const update = { ...req.body };
    if (update.phone) update.phone = normalisePhone(update.phone);
    if ('branchId' in update && !update.branchId) { delete update.branchId; update.$unset = { branchId: 1 }; }
    if ('doctorId' in update) {
      if (user.doctorId) await scoped(Doctor, req).updateOne({ _id: user.doctorId, userId: user._id }, { $unset: { userId: 1 } });
      if (update.doctorId) await scoped(Doctor, req).updateOne({ _id: update.doctorId }, { userId: user._id });
      else { delete update.doctorId; update.$unset = { ...(update.$unset || {}), doctorId: 1 }; }
    }
    // Deactivation or a role change ends existing sessions.
    if (update.isActive === false || (update.role && update.role !== user.role)) update.$unset = { ...(update.$unset || {}), refreshTokenHash: 1 };
    const saved = await User.findByIdAndUpdate(user._id, update, { new: true });
    recordAudit(req, { action: 'STAFF_UPDATED', entityType: 'User', entityId: user._id, after: { fields: Object.keys(req.body) } });
    ok(res, saved.toSafeJSON());
  }));

router.post('/staff/:id/reset-password', owner,
  validate(z.object({ password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/, 'Include a number') })),
  catchAsync(async (req, res) => {
    const user = await User.findOne({ _id: req.params.id, clinicId: req.tenant.clinicId, role: { $in: STAFF_ROLES } });
    if (!user) throw ApiError.notFound('Staff member not found');
    await user.setPassword(req.body.password);
    user.refreshTokenHash = undefined;
    await user.save();
    recordAudit(req, { action: 'STAFF_PASSWORD_RESET', entityType: 'User', entityId: user._id });
    ok(res, { message: 'Password reset. Share it with them securely.' });
  }));

// ------------------------------------------------------------------ Branches

const branchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().max(12).optional(),
  phone: z.string().max(20).optional(),
  address: z.object({ line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional() }).optional(),
  timings: z.object({ workingDays: z.array(z.number().int().min(0).max(6)), openTime: hhmm, closeTime: hhmm }).partial().optional(),
  isActive: z.boolean().optional(),
});

router.get('/branches', catchAsync(async (req, res) => {
  const filter = { ...(req.query.all === 'true' && req.user.role === ROLES.CLINIC_OWNER ? {} : { isActive: true }) };
  if (req.user.role !== ROLES.CLINIC_OWNER && req.tenant.branchId) filter._id = req.tenant.branchId;
  ok(res, await scoped(Branch, req).find(filter).sort('name'));
}));

router.post('/branches', owner, validate(branchSchema), catchAsync(async (req, res) => {
  const count = await scoped(Branch, req).countDocuments({ isActive: true });
  await assertWithinLimit(req.tenant.clinicId, 'branches', count);
  const branch = await scoped(Branch, req).create(req.body);
  recordAudit(req, { action: 'BRANCH_CREATED', entityType: 'Branch', entityId: branch._id });
  created(res, branch);
}));

router.patch('/branches/:id', requirePermission('branch:update'), validate(branchSchema.partial()), catchAsync(async (req, res) => {
  // Branch managers may adjust their own branch's contact and hours, not create or retire branches.
  if (req.user.role === ROLES.BRANCH_MANAGER) {
    if (String(req.params.id) !== String(req.tenant.branchId)) throw ApiError.forbidden('You can only edit your own branch');
    delete req.body.isActive; delete req.body.name;
  }
  if (req.body.isActive === true) {
    const count = await scoped(Branch, req).countDocuments({ isActive: true, _id: { $ne: req.params.id } });
    await assertWithinLimit(req.tenant.clinicId, 'branches', count);
  }
  const branch = await scoped(Branch, req).findOneAndUpdate({ _id: req.params.id }, req.body, { new: true });
  if (!branch) throw ApiError.notFound('Branch not found');
  recordAudit(req, { action: 'BRANCH_UPDATED', entityType: 'Branch', entityId: branch._id, after: { fields: Object.keys(req.body) } });
  ok(res, branch);
}));

/** Per-branch operational report for owners (all branches) and managers (their own). */
router.get('/branches/report', requirePermission('analytics:read'), catchAsync(async (req, res) => {
  const clinicId = req.tenant.clinicId;
  const from = dayjs.tz(req.query.from || dayjs().tz(TZ).subtract(29, 'day').format('YYYY-MM-DD'), TZ).startOf('day').toDate();
  const to = dayjs.tz(req.query.to || dayjs().tz(TZ).format('YYYY-MM-DD'), TZ).endOf('day').toDate();
  const bf = branchFilter(req);
  const [branches, appts, collections] = await Promise.all([
    scoped(Branch, req).find(bf.branchId ? { _id: bf.branchId } : {}).lean(),
    Appointment.aggregate([{ $match: { ...bf, startAt: { $gte: from, $lte: to } } },
      { $group: { _id: { branch: '$branchId', status: '$status' }, count: { $sum: 1 } } }]).option({ clinicId }),
    Payment.aggregate([{ $match: { ...bf, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, verifiedAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$branchId', amount: { $sum: '$amount' } } }]).option({ clinicId }),
  ]);
  const rows = [...branches.map((b) => ({ _id: b._id, name: b.name })), ...(bf.branchId ? [] : [{ _id: null, name: 'Unassigned' }])].map((b) => {
    const mine = appts.filter((a) => String(a._id.branch ?? null) === String(b._id ?? null));
    const by = Object.fromEntries(mine.map((a) => [a._id.status, a.count]));
    const total = mine.reduce((s, a) => s + a.count, 0);
    return {
      branchId: b._id, name: b.name, appointments: total, completed: by.COMPLETED || 0, cancelled: by.CANCELLED || 0, noShows: by.NO_SHOW || 0,
      collections: collections.find((c) => String(c._id ?? null) === String(b._id ?? null))?.amount || 0,
    };
  }).filter((r) => r.branchId || r.appointments || r.collections);
  ok(res, { from, to, branches: rows });
}));

// ------------------------------------------------------------------ Notifications (bell)

router.get('/notifications', catchAsync(async (req, res) => {
  const filter = { $or: [{ userId: req.user._id }, { role: req.user.role, userId: null }] };
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort('-createdAt').limit(30).setOptions({ clinicId: req.tenant.clinicId }),
    Notification.countDocuments({ ...filter, isRead: false }).setOptions({ clinicId: req.tenant.clinicId }),
  ]);
  ok(res, { items, unread });
}));

router.post('/notifications/read', catchAsync(async (req, res) => {
  await Notification.updateMany({ $or: [{ userId: req.user._id }, { role: req.user.role, userId: null }], isRead: false }, { isRead: true })
    .setOptions({ clinicId: req.tenant.clinicId });
  ok(res, { ok: true });
}));

// ------------------------------------------------------------------ Support tickets (clinic → platform)

router.get('/support', owner, catchAsync(async (req, res) => {
  ok(res, await SupportTicket.find({ clinicId: req.tenant.clinicId }).sort('-createdAt').limit(100));
}));

router.post('/support', owner, validate(z.object({
  subject: z.string().trim().min(3).max(150), description: z.string().trim().min(3).max(4000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
})), catchAsync(async (req, res) => {
  const ticket = await SupportTicket.create({ ...req.body, clinicId: req.tenant.clinicId, createdByUserId: req.user._id });
  recordAudit(req, { action: 'SUPPORT_TICKET_CREATED', entityType: 'SupportTicket', entityId: ticket._id });
  created(res, ticket);
}));

export default router;
