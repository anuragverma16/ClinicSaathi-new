import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { LeaveRequest, Doctor, Appointment } from '../../models/index.js';
import { LEAVE_TYPES } from '../../models/LeaveRequest.js';
import { scoped } from '../../models/plugins/tenantScope.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/rbac.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { notifyStaff } from '../../services/notify.service.js';
import { ROLES, STAFF_ROLES, BLOCKING_STATUSES } from '../../config/constants.js';
import { TZ } from '../../utils/slots.js';

/**
 * Leave for everyone on staff. Branch managers, doctors, receptionists,
 * accountants and lab technicians request it; only the clinic owner decides.
 */
const router = Router();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const requestSchema = z.object({
  type: z.enum(LEAVE_TYPES).default('CASUAL'),
  from: ymd,
  to: ymd,
  reason: z.string().trim().min(3, 'Add a short reason').max(300),
}).refine((l) => l.to >= l.from, { message: 'Leave must end on or after it starts', path: ['to'] });

const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).optional(),
});

const OPEN = ['PENDING', 'APPROVED'];
const MY_LEAVE_PATH = {
  BRANCH_MANAGER: '/clinic/branch/leave', DOCTOR: '/clinic/doctor/leave', RECEPTIONIST: '/clinic/reception/leave',
  ACCOUNTANT: '/clinic/accounts/leave', LAB_TECHNICIAN: '/clinic/lab/leave',
};
const today = () => dayjs().tz(TZ).format('YYYY-MM-DD');
const dayCount = (from, to) => dayjs(to).diff(dayjs(from), 'day') + 1;
const fmt = (d) => dayjs(d).format('D MMM');
const span = (l) => (l.from === l.to ? fmt(l.from) : `${fmt(l.from)} – ${fmt(l.to)}`);
const fieldError = (field, message) => ApiError.badRequest(message, 'VALIDATION_ERROR', [{ field, message }]);

const requester = requireRole(...STAFF_ROLES);
const owner = requireRole(ROLES.CLINIC_OWNER);

/** Bookings that still hold a slot with this doctor during the leave. */
async function bookingsDuring(req, leave) {
  if (!leave.doctorId) return 0;
  return scoped(Appointment, req).countDocuments({
    doctorId: leave.doctorId,
    status: { $in: BLOCKING_STATUSES },
    startAt: { $gte: dayjs.tz(leave.from, TZ).toDate(), $lt: dayjs.tz(leave.to, TZ).add(1, 'day').toDate() },
  });
}

/** Closes (or reopens) an approved doctor leave on the booking calendar. */
async function syncDoctorLeave(req, leave, add) {
  if (!leave.doctorId) return;
  const update = add
    ? { $push: { leaves: { from: dayjs.tz(leave.from, TZ).toDate(), to: dayjs.tz(leave.to, TZ).toDate(), reason: leave.reason, leaveRequestId: leave._id } } }
    : { $pull: { leaves: { leaveRequestId: leave._id } } };
  await scoped(Doctor, req).updateOne({ _id: leave.doctorId }, update);
}

// ---- Staff: their own leave ----

router.get('/mine', requester, catchAsync(async (req, res) => {
  const items = await scoped(LeaveRequest, req).find({ userId: req.user._id }).sort({ from: -1 }).limit(100).lean();
  const year = today().slice(0, 4);
  ok(res, {
    items,
    summary: {
      pending: items.filter((l) => l.status === 'PENDING').length,
      approvedDays: items.filter((l) => l.status === 'APPROVED' && l.from.startsWith(year)).reduce((n, l) => n + l.days, 0),
      upcoming: items.filter((l) => l.status === 'APPROVED' && l.to >= today()).length,
      rejected: items.filter((l) => l.status === 'REJECTED').length,
    },
  });
}));

router.post('/', requester, validate(requestSchema), catchAsync(async (req, res) => {
  const { type, from, to, reason } = req.body;
  if (from < today()) throw fieldError('from', 'Leave cannot start in the past');
  if (dayCount(from, to) > 60) throw fieldError('to', 'Leave can be at most 60 days at a time');

  const clash = await scoped(LeaveRequest, req).findOne({
    userId: req.user._id, status: { $in: OPEN }, from: { $lte: to }, to: { $gte: from },
  }).lean();
  if (clash) throw ApiError.conflict(`You already have ${clash.status.toLowerCase()} leave on ${span(clash)}`);

  const leave = await scoped(LeaveRequest, req).create({
    userId: req.user._id,
    userName: req.user.name,
    role: req.user.role,
    doctorId: req.user.role === ROLES.DOCTOR ? req.user.doctorId : undefined,
    branchId: req.user.branchId || undefined,
    type, from, to, reason,
    days: dayCount(from, to),
  });
  recordAudit(req, { action: 'LEAVE_REQUESTED', entityType: 'LeaveRequest', entityId: leave._id, after: req.body });
  notifyStaff({
    clinicId: req.tenant.clinicId, role: ROLES.CLINIC_OWNER, type: 'LEAVE_REQUESTED',
    title: `${req.user.name} requested leave`, body: `${span(leave)} · ${leave.days} day${leave.days > 1 ? 's' : ''}`,
    link: '/clinic/leave-requests',
  });
  created(res, leave);
}));

/** Withdraw a pending request, or cancel approved leave that hasn't started yet. */
router.post('/:id/cancel', requester, catchAsync(async (req, res) => {
  const leave = await scoped(LeaveRequest, req).findOne({ _id: req.params.id, userId: req.user._id });
  if (!leave) throw ApiError.notFound('Leave request not found');
  if (!OPEN.includes(leave.status)) throw ApiError.badRequest('This request is already closed');
  if (leave.status === 'APPROVED' && leave.from <= today()) throw ApiError.badRequest('Leave that has started cannot be cancelled. Ask the clinic owner.');

  const wasApproved = leave.status === 'APPROVED';
  leave.status = 'CANCELLED';
  await leave.save();
  if (wasApproved) await syncDoctorLeave(req, leave, false);
  recordAudit(req, { action: 'LEAVE_CANCELLED', entityType: 'LeaveRequest', entityId: leave._id });
  notifyStaff({
    clinicId: req.tenant.clinicId, role: ROLES.CLINIC_OWNER, type: 'LEAVE_CANCELLED',
    title: `${leave.userName} withdrew a leave request`, body: span(leave), link: '/clinic/leave-requests',
  });
  ok(res, leave);
}));

// ---- Clinic owner: every request at the clinic ----

router.get('/', owner, catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status && req.query.status !== 'ALL') filter.status = String(req.query.status);
  if (req.query.role && req.query.role !== 'ALL') filter.role = String(req.query.role);
  const [items, grouped, onLeaveToday] = await Promise.all([
    scoped(LeaveRequest, req).find(filter).sort({ from: 1 }).limit(300).lean(),
    scoped(LeaveRequest, req).aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    scoped(LeaveRequest, req).countDocuments({ status: 'APPROVED', from: { $lte: today() }, to: { $gte: today() } }),
  ]);

  // Pending doctor leave shows how many patients are already booked in.
  await Promise.all(items.map(async (l) => {
    if (l.status === 'PENDING' && l.doctorId) l.bookings = await bookingsDuring(req, l);
  }));
  ok(res, { items, counts: { ...Object.fromEntries(grouped.map((g) => [g._id, g.n])), onLeaveToday } });
}));

router.post('/:id/review', owner, validate(reviewSchema), catchAsync(async (req, res) => {
  const leave = await scoped(LeaveRequest, req).findOne({ _id: req.params.id });
  if (!leave) throw ApiError.notFound('Leave request not found');
  if (leave.status !== 'PENDING') throw ApiError.badRequest(`This request is already ${leave.status.toLowerCase()}`);

  const { decision, note } = req.body;
  Object.assign(leave, {
    status: decision, reviewNote: note, reviewedBy: req.user._id, reviewedByName: req.user.name, reviewedAt: new Date(),
  });
  await leave.save();
  if (decision === 'APPROVED') await syncDoctorLeave(req, leave, true);

  recordAudit(req, { action: `LEAVE_${decision}`, entityType: 'LeaveRequest', entityId: leave._id, after: req.body });
  notifyStaff({
    clinicId: req.tenant.clinicId, userId: leave.userId, type: `LEAVE_${decision}`,
    title: `Your leave was ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: note ? `${span(leave)} · ${note}` : span(leave),
    link: MY_LEAVE_PATH[leave.role],
  });
  ok(res, { leave, bookings: decision === 'APPROVED' ? await bookingsDuring(req, leave) : 0 });
}));

export default router;
