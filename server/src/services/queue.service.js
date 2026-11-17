import { QueueToken, Appointment, Doctor } from '../models/index.js';
import { tenantPopulate } from '../models/plugins/tenantScope.js';
import { APPOINTMENT_STATUS } from '../config/constants.js';
import { dateKey } from '../utils/slots.js';
import { ApiError } from '../utils/ApiError.js';
import { emit, EVENTS } from './events.js';
import { nextSequence } from '../models/Counter.js';

/** 1 → A, 26 → Z, 27 → AA */
function letters(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** Each doctor gets a stable, clinic-unique token letter on first check-in. */
async function tokenPrefixFor(clinicId, doctorId) {
  const doctor = await Doctor.findOne({ _id: doctorId }).select('tokenPrefix').setOptions({ clinicId });
  if (doctor?.tokenPrefix) return doctor.tokenPrefix;
  const prefix = letters(await nextSequence(`doctorprefix:${clinicId}`));
  const updated = await Doctor.findOneAndUpdate(
    { _id: doctorId, tokenPrefix: { $exists: false } }, { tokenPrefix: prefix }, { new: true }
  ).setOptions({ clinicId });
  // Lost a race with another check-in: use whatever prefix won.
  return updated?.tokenPrefix || (await Doctor.findOne({ _id: doctorId }).setOptions({ clinicId })).tokenPrefix;
}

/** Allowed token transitions. Anything else is rejected. */
const TRANSITIONS = {
  WAITING: ['CALLED', 'SKIPPED'],
  CALLED: ['IN_CONSULTATION', 'SKIPPED', 'WAITING'],
  IN_CONSULTATION: ['COMPLETED'],
  SKIPPED: ['WAITING'],
  COMPLETED: [],
};

/**
 * Check a patient in and issue the next token for that doctor today.
 * The appointment flips CONFIRMED → WAITING atomically first, so a double
 * click can never mint two tokens; the unique appointment index backs it up.
 */
export async function checkIn({ clinicId, appointmentId, priority = 0, branchId }) {
  const filter = { _id: appointmentId };
  if (branchId) filter.branchId = branchId;
  const appointment = await Appointment.findOne(filter).setOptions({ clinicId });
  if (!appointment) throw ApiError.notFound('Appointment not found');
  const queueDate = dateKey(new Date());
  if (dateKey(appointment.startAt) !== queueDate) {
    throw ApiError.badRequest('Only today\'s appointments can be checked in', 'NOT_TODAY');
  }

  const claimed = await Appointment.findOneAndUpdate(
    { _id: appointment._id, status: APPOINTMENT_STATUS.CONFIRMED },
    { status: APPOINTMENT_STATUS.WAITING, checkedInAt: new Date() },
    { new: true }
  ).setOptions({ clinicId });
  if (!claimed) {
    const msg = appointment.status === APPOINTMENT_STATUS.REQUESTED
      ? 'Confirm this appointment (or collect the prepayment) before check-in'
      : 'This patient is already checked in or the visit is closed';
    throw ApiError.conflict(msg, 'CHECK_IN_NOT_ALLOWED');
  }

  try {
    const prefix = await tokenPrefixFor(clinicId, claimed.doctorId);
    const sequence = await nextSequence(`queue:${clinicId}:${claimed.doctorId}:${queueDate}`);
    const token = await QueueToken.create({
      clinicId,
      branchId: claimed.branchId,
      appointmentId: claimed._id,
      patientId: claimed.patientId,
      doctorId: claimed.doctorId,
      tokenNumber: `${prefix}${sequence}`,
      sequence,
      queueDate,
      priority,
    });
    emit(EVENTS.PATIENT_CHECKED_IN, { appointment: claimed, token });
    emit(EVENTS.QUEUE_UPDATED, { clinicId, doctorId: claimed.doctorId, queueDate });
    return token;
  } catch (e) {
    // Undo the status flip so the desk can retry.
    await Appointment.updateOne({ _id: claimed._id }, { status: APPOINTMENT_STATUS.CONFIRMED, $unset: { checkedInAt: 1 } })
      .setOptions({ clinicId });
    if (e.code === 11000) throw ApiError.conflict('This patient already has a token', 'ALREADY_CHECKED_IN');
    throw e;
  }
}

export async function getQueue({ clinicId, doctorId, branchId, queueDate = dateKey(new Date()), includeDone = false }) {
  const filter = { queueDate };
  if (!includeDone) filter.status = { $in: ['WAITING', 'CALLED', 'IN_CONSULTATION', 'SKIPPED'] };
  if (doctorId) filter.doctorId = doctorId;
  if (branchId) filter.branchId = branchId;
  const tokens = await QueueToken.find(filter)
    .sort({ priority: -1, sequence: 1 })
    .populate(tenantPopulate(clinicId, 'patientId', 'name phone gender dob'))
    .populate(tenantPopulate(clinicId, 'doctorId', 'name specialization'))
    .setOptions({ clinicId });

  // Wait estimate from today's real consultation durations, per doctor.
  const done = await QueueToken.find({ queueDate, status: 'COMPLETED', consultationStartedAt: { $ne: null } })
    .select('doctorId consultationStartedAt completedAt').setOptions({ clinicId }).lean();
  const avgByDoctor = {};
  for (const t of done) {
    const key = String(t.doctorId);
    const mins = (t.completedAt - t.consultationStartedAt) / 60000;
    if (mins > 0 && mins < 180) (avgByDoctor[key] ||= []).push(mins);
  }
  const ahead = {};
  return tokens.map((t) => {
    const key = String(t.doctorId?._id || t.doctorId);
    const samples = avgByDoctor[key];
    const avg = samples?.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 12;
    const position = t.status === 'WAITING' ? (ahead[key] = (ahead[key] || 0) + 1) - 1 : 0;
    return {
      ...t.toObject(),
      patientsAhead: position,
      estimatedWaitMins: t.status === 'WAITING' ? Math.round(position * avg) : 0,
    };
  });
}

/** Calls the next eligible patient. A doctor can only have one patient called at a time. */
export async function callNext({ clinicId, doctorId }) {
  if (!doctorId) throw ApiError.badRequest('Choose a doctor', 'DOCTOR_REQUIRED');
  const queueDate = dateKey(new Date());
  const busy = await QueueToken.exists({ doctorId, queueDate, status: { $in: ['CALLED', 'IN_CONSULTATION'] } }).setOptions({ clinicId });
  if (busy) throw ApiError.conflict('Finish or skip the current patient before calling the next', 'DOCTOR_BUSY');

  const next = await QueueToken.findOneAndUpdate(
    { doctorId, queueDate, status: 'WAITING' },
    { status: 'CALLED', calledAt: new Date() },
    { new: true, sort: { priority: -1, sequence: 1 } }
  ).setOptions({ clinicId }).populate(tenantPopulate(clinicId, 'patientId', 'name phone'));

  if (!next) throw ApiError.notFound('No one is waiting', 'QUEUE_EMPTY');
  emit(EVENTS.QUEUE_CALLED, { clinicId, token: next });
  emit(EVENTS.QUEUE_UPDATED, { clinicId, doctorId, queueDate });
  return next;
}

const APPOINTMENT_FOR_TOKEN = {
  CALLED: APPOINTMENT_STATUS.WAITING,
  IN_CONSULTATION: APPOINTMENT_STATUS.IN_CONSULTATION,
  COMPLETED: APPOINTMENT_STATUS.COMPLETED,
  SKIPPED: APPOINTMENT_STATUS.CHECKED_IN,
  WAITING: APPOINTMENT_STATUS.WAITING,
};

export async function updateTokenStatus({ clinicId, tokenId, status, doctorId, branchId }) {
  if (!TRANSITIONS[status] && status !== 'WAITING') throw ApiError.badRequest('Unknown queue status', 'INVALID_STATUS');
  const filter = { _id: tokenId };
  if (doctorId) filter.doctorId = doctorId;
  if (branchId) filter.branchId = branchId;
  const current = await QueueToken.findOne(filter).setOptions({ clinicId });
  if (!current) throw ApiError.notFound('Token not found');
  if (!TRANSITIONS[current.status]?.includes(status)) {
    throw ApiError.badRequest(`A ${current.status.toLowerCase().replace('_', ' ')} token can't move to ${status.toLowerCase().replace('_', ' ')}`, 'INVALID_TRANSITION');
  }

  const now = new Date();
  const stamp = {
    IN_CONSULTATION: { consultationStartedAt: now },
    COMPLETED: { completedAt: now },
    SKIPPED: { skippedAt: now },
    WAITING: { calledAt: null },
  }[status] || {};
  // Conditional on the status we read, so two clicks can't both apply.
  const token = await QueueToken.findOneAndUpdate(
    { _id: current._id, status: current.status }, { status, ...stamp }, { new: true }
  ).setOptions({ clinicId });
  if (!token) throw ApiError.conflict('The queue changed. Refresh and try again.', 'CONCURRENT_UPDATE');

  const apptUpdate = { status: APPOINTMENT_FOR_TOKEN[status] };
  if (status === 'IN_CONSULTATION') apptUpdate.consultationStartedAt = now;
  if (status === 'COMPLETED') apptUpdate.completedAt = now;
  await Appointment.updateOne({ _id: token.appointmentId }, apptUpdate).setOptions({ clinicId });
  if (status === 'COMPLETED') {
    const appointment = await Appointment.findOne({ _id: token.appointmentId }).setOptions({ clinicId });
    emit(EVENTS.APPOINTMENT_COMPLETED, { appointment });
  }

  emit(EVENTS.QUEUE_UPDATED, { clinicId, doctorId: token.doctorId, queueDate: token.queueDate });
  return token;
}

/** Ends the visit from the consultation side; keeps token and appointment in step. */
export async function completeVisitForAppointment({ clinicId, appointmentId }) {
  const token = await QueueToken.findOne({ appointmentId, status: { $in: ['CALLED', 'IN_CONSULTATION'] } }).setOptions({ clinicId });
  if (token) {
    if (token.status === 'CALLED') await QueueToken.updateOne({ _id: token._id }, { status: 'IN_CONSULTATION', consultationStartedAt: new Date() }).setOptions({ clinicId });
    return updateTokenStatus({ clinicId, tokenId: token._id, status: 'COMPLETED' });
  }
  const appointment = await Appointment.findOneAndUpdate(
    { _id: appointmentId, status: { $nin: [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.CANCELLED, APPOINTMENT_STATUS.RESCHEDULED] } },
    { status: APPOINTMENT_STATUS.COMPLETED, completedAt: new Date() },
    { new: true }
  ).setOptions({ clinicId });
  if (appointment) emit(EVENTS.APPOINTMENT_COMPLETED, { appointment });
  return null;
}
