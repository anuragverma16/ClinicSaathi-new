import { Router } from 'express';
import db from '../../db/index.js';
import dayjs from 'dayjs';
import { Appointment, Invoice, Patient, Payment, QueueToken, Doctor, FollowUp, Communication, Recall } from '../../models/index.js';
import { requirePermission, branchFilter } from '../../middleware/rbac.js';
import { requireFeature } from '../../middleware/planGate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok } from '../../utils/respond.js';
import { ROLES } from '../../config/constants.js';
import { generateSlots, TZ } from '../../utils/slots.js';

const router = Router();
const oid = (v) => (v && db.isValidObjectId(v) ? new db.Types.ObjectId(String(v)) : undefined);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function parseFilters(req) {
  const from = dayjs.tz(req.query.from || dayjs().tz(TZ).subtract(29, 'day').format('YYYY-MM-DD'), TZ).startOf('day');
  const to = dayjs.tz(req.query.to || dayjs().tz(TZ).format('YYYY-MM-DD'), TZ).endOf('day');
  const scope = { ...branchFilter(req) };
  // Branch staff can't widen their scope by passing someone else's branch.
  if (!scope.branchId && oid(req.query.branchId)) scope.branchId = oid(req.query.branchId);
  else if (scope.branchId) scope.branchId = oid(scope.branchId);
  const apptScope = { ...scope };
  if (oid(req.query.doctorId)) apptScope.doctorId = oid(req.query.doctorId);
  if (oid(req.query.serviceId)) apptScope.serviceId = oid(req.query.serviceId);
  return { from, to, range: { $gte: from.toDate(), $lte: to.toDate() }, scope, apptScope };
}

/**
 * Clinic analytics. Every number is an aggregate over real records in range;
 * an empty clinic gets zeros and empty series, never sample data.
 * Accountants get financial sections only.
 */
router.get('/overview', requireFeature('reports'), requirePermission('analytics:read'), catchAsync(async (req, res) => {
  const clinicId = req.tenant.clinicId;
  const { from, to, range, scope, apptScope } = parseFilters(req);
  const financialOnly = req.user.role === ROLES.ACCOUNTANT;
  const agg = (Model, pipeline) => Model.aggregate(pipeline).option({ clinicId });
  const paid = { ...scope, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, verifiedAt: range };

  const yearAgo = dayjs().tz(TZ).subtract(11, 'month').startOf('month').toDate();
  const [revenueByDay, revenueByService, outstanding, refunds, revenueByMonth] = await Promise.all([
    agg(Payment, [{ $match: paid }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$verifiedAt', timezone: TZ } }, revenue: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
    agg(Invoice, [{ $match: { ...scope, createdAt: range, status: { $nin: ['VOID', 'DRAFT'] } } }, { $unwind: '$lineItems' },
      { $group: { _id: { $ifNull: ['$lineItems.serviceId', '$lineItems.description'] }, name: { $first: '$lineItems.description' }, revenue: { $sum: '$lineItems.amount' }, count: { $sum: '$lineItems.quantity' } } },
      { $sort: { revenue: -1 } }, { $limit: 10 }]),
    agg(Invoice, [{ $match: { ...scope, status: { $in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } }, { $group: { _id: null, amount: { $sum: { $subtract: ['$total', '$amountPaid'] } }, count: { $sum: 1 } } }]),
    agg(Payment, [{ $match: { ...scope, 'refunds.0': { $exists: true } } }, { $unwind: '$refunds' }, { $match: { 'refunds.status': 'PROCESSED', 'refunds.at': range } }, { $group: { _id: null, amount: { $sum: '$refunds.amount' } } }]),
    // Monthly revenue always covers the last 12 months, whatever range is picked.
    agg(Payment, [{ $match: { ...scope, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, verifiedAt: { $gte: yearAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$verifiedAt', timezone: TZ } }, revenue: { $sum: '$amount' } } }, { $sort: { _id: 1 } }]),
  ]);
  const revenue = revenueByDay.reduce((a, d) => a + d.revenue, 0);
  const finance = {
    revenue, refunds: refunds[0]?.amount || 0, outstanding: outstanding[0]?.amount || 0, outstandingInvoices: outstanding[0]?.count || 0,
  };
  const financeCharts = {
    revenueByDay: revenueByDay.map((d) => ({ date: d._id, revenue: d.revenue })),
    revenueByService: revenueByService.map((s) => ({ service: s.name, revenue: s.revenue, count: s.count })),
    revenueByMonth: revenueByMonth.map((m) => ({ month: m._id, revenue: m.revenue })),
  };
  if (financialOnly) return ok(res, { range: { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') }, kpis: finance, charts: financeCharts });

  const prevRange = { $gte: from.subtract(to.diff(from, 'day') + 1, 'day').toDate(), $lt: range.$gte };
  const [statusBreakdown, apptsByDay, topDoctors, patientStats, waits, upcoming, followUps, comms, recalls, visitCounts, prevPatients, bySource, reviewsByMonth] = await Promise.all([
    agg(Appointment, [{ $match: { ...apptScope, startAt: range } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    agg(Appointment, [{ $match: { ...apptScope, startAt: range } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startAt', timezone: TZ } }, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } }, noShow: { $sum: { $cond: [{ $eq: ['$status', 'NO_SHOW'] }, 1, 0] } } } },
      { $sort: { _id: 1 } }]),
    agg(Appointment, [{ $match: { ...apptScope, startAt: range, status: 'COMPLETED' } },
      { $group: { _id: '$doctorId', consultations: { $sum: 1 }, bookedMins: { $sum: '$durationMins' } } },
      { $sort: { consultations: -1 } }, { $limit: 10 },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
      { $project: { consultations: 1, bookedMins: 1, name: { $first: '$doctor.name' } } }]),
    agg(Appointment, [{ $match: { ...apptScope, startAt: range, status: 'COMPLETED' } },
      { $group: { _id: '$patientId', first: { $min: '$startAt' } } },
      { $lookup: { from: 'patients', localField: '_id', foreignField: '_id', as: 'p' } },
      { $project: { isNew: { $gte: [{ $ifNull: [{ $first: '$p.firstVisitAt' }, '$first'] }, range.$gte] } } },
      { $group: { _id: '$isNew', count: { $sum: 1 } } }]),
    agg(QueueToken, [{ $match: { ...scope, checkedInAt: range, calledAt: { $ne: null } } },
      { $project: { wait: { $divide: [{ $subtract: ['$calledAt', '$checkedInAt'] }, 60000] } } },
      { $match: { wait: { $gte: 0, $lt: 600 } } }, { $group: { _id: null, avg: { $avg: '$wait' }, n: { $sum: 1 } } }]),
    Appointment.countDocuments({ ...apptScope, startAt: { $gt: new Date() }, status: { $in: ['REQUESTED', 'CONFIRMED'] } }).setOptions({ clinicId }),
    agg(FollowUp, [{ $match: { createdAt: range } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    agg(Communication, [{ $match: { createdAt: range, direction: { $ne: 'INBOUND' } } }, { $group: { _id: { event: '$event', status: '$status' }, count: { $sum: 1 } } }]),
    agg(Recall, [{ $match: { createdAt: range } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    // Repeat rate: of patients seen in range, how many came more than once.
    agg(Appointment, [{ $match: { ...apptScope, startAt: range, status: 'COMPLETED' } }, { $group: { _id: '$patientId', visits: { $sum: 1 } } },
      { $group: { _id: null, patients: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$visits', 1] }, 1, 0] } } } }]),
    // Retention: patients seen in the previous equal-length period…
    agg(Appointment, [{ $match: { ...apptScope, startAt: prevRange, status: 'COMPLETED' } }, { $group: { _id: '$patientId' } }]),
    agg(Appointment, [{ $match: { ...apptScope, startAt: range } }, { $group: { _id: '$source', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    agg(Communication, [{ $match: { event: 'REVIEW_REQUEST', status: { $in: ['SENT', 'DELIVERED', 'READ'] }, createdAt: { $gte: yearAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: TZ } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  // …who came back in this one.
  const retained = prevPatients.length
    ? (await agg(Appointment, [{ $match: { ...apptScope, startAt: range, status: 'COMPLETED', patientId: { $in: prevPatients.map((p) => p._id) } } }, { $group: { _id: '$patientId' } }])).length
    : 0;

  const byStatus = Object.fromEntries(statusBreakdown.map((s) => [s._id, s.count]));
  const totalAppointments = statusBreakdown.reduce((a, s) => a + s.count, 0);
  const newVsReturning = Object.fromEntries(patientStats.map((p) => [p._id ? 'new' : 'returning', p.count]));

  // Utilisation: completed consultation minutes / scheduled working minutes in range.
  const doctorFilter = { isActive: true, ...(scope.branchId ? { branchId: scope.branchId } : {}), ...(apptScope.doctorId ? { _id: apptScope.doctorId } : {}) };
  const doctors = await Doctor.find(doctorFilter).select('name availability breaks slotDurationMins').setOptions({ clinicId }).lean();
  const days = Math.min(92, to.diff(from, 'day') + 1);
  const utilisation = doctors.map((d) => {
    let available = 0;
    for (let i = 0; i < days; i += 1) {
      available += generateSlots({ date: from.add(i, 'day').format('YYYY-MM-DD'), rules: d.availability || [], breaks: d.breaks || [], slotDurationMins: d.slotDurationMins || 15 }).length * (d.slotDurationMins || 15);
    }
    const booked = topDoctors.find((t) => String(t._id) === String(d._id))?.bookedMins || 0;
    return { doctorId: d._id, name: d.name, availableMins: available, bookedMins: booked, utilisation: pct(booked, available) };
  });

  const fu = Object.fromEntries(followUps.map((f) => [f._id, f.count]));
  const fuTotal = followUps.reduce((s, f) => s + f.count, 0);
  const commStats = { sent: 0, failed: 0, delivered: 0, reviewRequests: 0 };
  for (const c of comms) {
    if (['SENT', 'DELIVERED', 'READ'].includes(c._id.status)) commStats.sent += c.count;
    if (['DELIVERED', 'READ'].includes(c._id.status)) commStats.delivered += c.count;
    if (c._id.status === 'FAILED') commStats.failed += c.count;
    if (c._id.event === 'REVIEW_REQUEST' && c._id.status !== 'FAILED') commStats.reviewRequests += c.count;
  }
  const rc = Object.fromEntries(recalls.map((r) => [r._id, r.count]));

  ok(res, {
    range: { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') },
    kpis: {
      ...finance,
      totalAppointments,
      completed: byStatus.COMPLETED || 0,
      cancelled: byStatus.CANCELLED || 0,
      noShows: byStatus.NO_SHOW || 0,
      noShowRate: pct(byStatus.NO_SHOW || 0, totalAppointments),
      cancellationRate: pct(byStatus.CANCELLED || 0, totalAppointments),
      upcoming,
      newPatients: newVsReturning.new || 0,
      returningPatients: newVsReturning.returning || 0,
      totalPatients: await Patient.countDocuments({}).setOptions({ clinicId }),
      avgWaitMins: waits[0] ? Math.round(waits[0].avg) : null,
      followUpConversion: pct(fu.BOOKED || 0, fuTotal),
      followUps: fuTotal,
      recallConversion: pct(rc.BOOKED || 0, (rc.NOTIFIED || 0) + (rc.BOOKED || 0)),
      messagesSent: commStats.sent,
      messageFailureRate: pct(commStats.failed, commStats.sent + commStats.failed),
      messageDeliveryRate: pct(commStats.delivered, commStats.sent),
      reviewRequests: commStats.reviewRequests,
      repeatPatientRate: pct(visitCounts[0]?.repeat || 0, visitCounts[0]?.patients || 0),
      retentionRate: prevPatients.length ? pct(retained, prevPatients.length) : null,
      retainedPatients: retained,
    },
    charts: {
      ...financeCharts,
      appointmentsByDay: apptsByDay.map((d) => ({ date: d._id, total: d.total, completed: d.completed, noShow: d.noShow })),
      appointmentsByStatus: statusBreakdown.map((s) => ({ status: s._id, count: s.count })),
      topDoctors: topDoctors.map((t) => ({ name: t.name, consultations: t.consultations })),
      utilisation,
      bookingsBySource: bySource.map((b) => ({ source: b._id || 'UNKNOWN', count: b.count })),
      reviewRequestsByMonth: reviewsByMonth.map((r) => ({ month: r._id, count: r.count })),
    },
  });
}));

export default router;
