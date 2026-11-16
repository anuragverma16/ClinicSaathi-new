import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { Doctor, Branch } from '../../models/index.js';
import { scoped } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission, branchFilter } from '../../middleware/rbac.js';
import { assertWithinLimit } from '../../middleware/planGate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { getAvailability } from '../../services/availability.service.js';
import { requireDoctorProfile } from '../../services/access.service.js';
import { ROLES, DEFAULT_AVAILABILITY } from '../../config/constants.js';
import { TZ } from '../../utils/slots.js';
import { feedToken } from '../../services/calendarFeed.service.js';
import { emit, EVENTS } from '../../services/events.js';
import { env } from '../../config/env.js';

const router = Router();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const window = z.object({ dayOfWeek: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm })
  .refine((r) => r.startTime < r.endTime, { message: 'End time must be after start time' });

const doctorSchema = z.object({
  name: z.string().trim().min(2).max(80),
  qualification: z.string().max(120).optional(),
  specialization: z.string().max(80).optional(),
  registrationNumber: z.string().max(40).optional(),
  experienceYears: z.number().min(0).max(70).optional(),
  consultationFee: z.number().min(0).max(100000).optional(),
  slotDurationMins: z.number().int().min(5).max(120).optional(),
  availability: z.array(window).max(42).optional(),
  breaks: z.array(window).max(42).optional(),
  serviceIds: z.array(objectId).max(50).optional(),
  supportsOnline: z.boolean().optional(),
  photoUrl: z.string().url().optional().or(z.literal('')),
  branchId: objectId.optional().nullable(),
  isActive: z.boolean().optional(),
});
const leaveSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(120).optional(),
}).refine((l) => l.to >= l.from, { message: 'Leave must end on or after it starts' });

/** How far ahead a doctor may set their own hours. Covers "the next month" with room to spare. */
const SCHEDULE_HORIZON_DAYS = 62;
const scheduleWindow = z.object({ startTime: hhmm, endTime: hhmm })
  .refine((w) => w.startTime < w.endTime, { message: 'End time must be after start time' });
const scheduleSchema = z.object({
  overrides: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    windows: z.array(scheduleWindow).max(4),
    note: z.string().max(120).optional(),
  })).max(SCHEDULE_HORIZON_DAYS + 1),
});

const listScope = (req) => (req.user.role === ROLES.CLINIC_OWNER ? {} : branchFilter(req));

router.get('/', requirePermission('doctor:read'), catchAsync(async (req, res) => {
  const filter = { ...listScope(req) };
  if (req.query.active !== 'all') filter.isActive = true;
  if (req.query.q) filter.$or = [{ name: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { specialization: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const items = await scoped(Doctor, req).find(filter).sort('name');
  ok(res, items, { total: items.length });
}));

router.get('/me', catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  ok(res, await scoped(Doctor, req).findById(doctorId));
}));

/** Calendar-sync URL for a doctor: their own, or any doctor's for the owner / branch manager. */
router.get('/:id/calendar-feed', catchAsync(async (req, res) => {
  const own = req.user.doctorId && String(req.user.doctorId) === req.params.id;
  if (!own && ![ROLES.CLINIC_OWNER, ROLES.BRANCH_MANAGER].includes(req.user.role)) throw ApiError.forbidden('You can only sync your own calendar');
  const doctor = await scoped(Doctor, req).findOne({ _id: req.params.id, ...listScope(req) });
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const base = (env.publicApiUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  ok(res, { url: `${base}/api/public/calendar/${feedToken(req.tenant.clinicId, doctor._id)}.ics` });
}));

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weeklySchema = z.object({ availability: z.array(window).max(21) });

/**
 * The doctor sets the weekly days and hours they work. Scoped to their own
 * profile, so it never becomes a way to edit a colleague's fees or details.
 */
router.put('/me/availability', validate(weeklySchema), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const doctor = await scoped(Doctor, req).findById(doctorId);
  if (!doctor) throw ApiError.notFound('Doctor not found');

  for (let dow = 0; dow < 7; dow += 1) {
    const sorted = req.body.availability.filter((w) => w.dayOfWeek === dow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        throw ApiError.badRequest(`Overlapping hours on ${DAY_NAMES[dow]}`, 'OVERLAPPING_WINDOWS');
      }
    }
  }

  const updated = await scoped(Doctor, req).findOneAndUpdate(
    { _id: doctorId }, { availability: req.body.availability }, { new: true, runValidators: true },
  );
  recordAudit(req, { action: 'DOCTOR_AVAILABILITY_UPDATED', entityType: 'Doctor', entityId: doctorId });
  emit(EVENTS.DOCTOR_SCHEDULE_UPDATED, { clinicId: req.tenant.clinicId, doctorId, doctorName: doctor.name, weekly: true });
  ok(res, { availability: updated.availability });
}));

/**
 * A doctor's own hours for the dates ahead, alongside the clinic's weekly
 * pattern so the UI can show what each untouched date falls back to.
 */
router.get('/me/schedule', catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const doctor = await scoped(Doctor, req).findById(doctorId);
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const today = dayjs().tz(TZ).format('YYYY-MM-DD');
  ok(res, {
    today,
    horizonDays: SCHEDULE_HORIZON_DAYS,
    slotDurationMins: doctor.slotDurationMins || 15,
    availability: doctor.availability || [],
    leaves: doctor.leaves || [],
    overrides: (doctor.scheduleOverrides || []).filter((o) => o.date >= today),
  });
}));

/**
 * The doctor sets their own working days and hours per date. Takes effect for
 * booking immediately; the clinic and front desk are told what changed.
 */
router.put('/me/schedule', validate(scheduleSchema), catchAsync(async (req, res) => {
  const doctorId = requireDoctorProfile(req);
  const doctor = await scoped(Doctor, req).findById(doctorId);
  if (!doctor) throw ApiError.notFound('Doctor not found');

  const today = dayjs().tz(TZ).format('YYYY-MM-DD');
  const lastDate = dayjs().tz(TZ).add(SCHEDULE_HORIZON_DAYS, 'day').format('YYYY-MM-DD');
  const seen = new Set();
  for (const o of req.body.overrides) {
    if (o.date < today) throw ApiError.badRequest(`${o.date} has already passed`, 'DATE_IN_PAST');
    if (o.date > lastDate) throw ApiError.badRequest(`${o.date} is further ahead than you can set`, 'DATE_TOO_FAR');
    if (seen.has(o.date)) throw ApiError.badRequest(`${o.date} is listed twice`, 'DUPLICATE_DATE');
    seen.add(o.date);
    const sorted = [...o.windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startTime < sorted[i - 1].endTime) throw ApiError.badRequest(`Overlapping hours on ${o.date}`, 'OVERLAPPING_WINDOWS');
    }
  }

  // Dates already past stay as a record of what was worked; today forward is replaced.
  const past = (doctor.scheduleOverrides || []).filter((o) => o.date < today);
  const updated = await scoped(Doctor, req).findOneAndUpdate(
    { _id: doctorId }, { scheduleOverrides: [...past, ...req.body.overrides] }, { new: true },
  );
  const dates = [...seen].sort();
  recordAudit(req, { action: 'DOCTOR_SCHEDULE_UPDATED', entityType: 'Doctor', entityId: doctorId, after: { dates } });
  emit(EVENTS.DOCTOR_SCHEDULE_UPDATED, { clinicId: req.tenant.clinicId, doctorId, doctorName: doctor.name, dates });
  ok(res, { overrides: (updated.scheduleOverrides || []).filter((o) => o.date >= today) });
}));

/** Doctors record their own leave as well; the weekly pattern stays with the clinic. */
// A doctor's own leave goes through /leaves for the clinic owner's approval.

router.post('/', requirePermission('doctor:create'), validate(doctorSchema), catchAsync(async (req, res) => {
  const count = await scoped(Doctor, req).countDocuments({ isActive: true });
  await assertWithinLimit(req.tenant.clinicId, 'doctors', count);
  if (req.body.branchId && !(await scoped(Branch, req).findById(req.body.branchId))) throw ApiError.badRequest('Branch not found');
  const doctor = await scoped(Doctor, req).create({
    ...req.body,
    availability: req.body.availability?.length ? req.body.availability : DEFAULT_AVAILABILITY,
    branchId: req.body.branchId || undefined,
  });
  recordAudit(req, { action: 'DOCTOR_CREATED', entityType: 'Doctor', entityId: doctor._id });
  created(res, doctor);
}));

router.get('/:id', requirePermission('doctor:read'), catchAsync(async (req, res) => {
  const doctor = await scoped(Doctor, req).findOne({ _id: req.params.id, ...listScope(req) });
  if (!doctor) throw ApiError.notFound('Doctor not found');
  ok(res, doctor);
}));

router.patch('/:id', requirePermission('doctor:update'), validate(doctorSchema.partial()), catchAsync(async (req, res) => {
  const before = await scoped(Doctor, req).findOne({ _id: req.params.id, ...listScope(req) });
  if (!before) throw ApiError.notFound('Doctor not found');
  const body = { ...req.body };
  if (req.user.role === ROLES.BRANCH_MANAGER) {
    // Managers handle their branch's schedules, not fees, credentials or transfers.
    for (const k of ['consultationFee', 'registrationNumber', 'branchId', 'isActive', 'qualification']) delete body[k];
  }
  if (body.isActive === true && !before.isActive) {
    await assertWithinLimit(req.tenant.clinicId, 'doctors', await scoped(Doctor, req).countDocuments({ isActive: true }));
  }
  if (body.branchId === null) { delete body.branchId; body.$unset = { branchId: 1 }; }
  const doctor = await scoped(Doctor, req).findOneAndUpdate({ _id: before._id }, body, { new: true, runValidators: true });
  recordAudit(req, { action: 'DOCTOR_UPDATED', entityType: 'Doctor', entityId: doctor._id, after: { fields: Object.keys(req.body) } });
  ok(res, doctor);
}));

router.post('/:id/leaves', requirePermission('doctor:update'), validate(leaveSchema), catchAsync(async (req, res) => {
  const doctor = await scoped(Doctor, req).findOneAndUpdate(
    { _id: req.params.id, ...listScope(req) },
    { $push: { leaves: { from: dayjs.tz(req.body.from, TZ).toDate(), to: dayjs.tz(req.body.to, TZ).toDate(), reason: req.body.reason } } },
    { new: true }
  );
  if (!doctor) throw ApiError.notFound('Doctor not found');
  recordAudit(req, { action: 'DOCTOR_LEAVE_ADDED', entityType: 'Doctor', entityId: doctor._id, after: req.body });
  ok(res, doctor);
}));

router.delete('/:id/leaves/:leaveId', requirePermission('doctor:update'), catchAsync(async (req, res) => {
  const doctor = await scoped(Doctor, req).findOneAndUpdate(
    { _id: req.params.id, ...listScope(req) }, { $pull: { leaves: { _id: req.params.leaveId } } }, { new: true }
  );
  if (!doctor) throw ApiError.notFound('Doctor not found');
  recordAudit(req, { action: 'DOCTOR_LEAVE_REMOVED', entityType: 'Doctor', entityId: doctor._id });
  ok(res, doctor);
}));

router.delete('/:id', requirePermission('doctor:delete'), catchAsync(async (req, res) => {
  // Soft delete: clinical records must keep pointing at the doctor.
  const doctor = await scoped(Doctor, req).findOneAndUpdate({ _id: req.params.id }, { isActive: false }, { new: true });
  if (!doctor) throw ApiError.notFound('Doctor not found');
  recordAudit(req, { action: 'DOCTOR_DEACTIVATED', entityType: 'Doctor', entityId: doctor._id });
  ok(res, doctor);
}));

router.get('/:id/availability', requirePermission('doctor:read'), catchAsync(async (req, res) => {
  ok(res, await getAvailability({
    clinicId: req.tenant.clinicId, doctorId: req.params.id, date: req.query.date || dayjs().tz(TZ).format('YYYY-MM-DD'),
  }));
}));

export default router;
