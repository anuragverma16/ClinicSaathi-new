import dayjs from 'dayjs';
import { Doctor, Appointment, Clinic } from '../models/index.js';
import { generateSlots, slotKeyFor, isOnLeave, TZ } from '../utils/slots.js';
import { BLOCKING_STATUSES, APPOINTMENT_STATUS } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';

/** Normalise a 'YYYY-MM-DD' string or Date to the clinic-local calendar date. */
export function toYmd(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return dayjs(date).tz(TZ).format('YYYY-MM-DD');
}

/**
 * Unpaid prepayment holds stop blocking once they expire. Releasing them
 * (status → CANCELLED, slotKey → null) frees the unique slot index too.
 */
export async function releaseExpiredHolds({ clinicId, doctorId }) {
  const filter = { status: APPOINTMENT_STATUS.REQUESTED, holdExpiresAt: { $lt: new Date() } };
  if (doctorId) filter.doctorId = doctorId;
  const expired = await Appointment.find(filter).select('_id').setOptions({ clinicId }).lean();
  if (!expired.length) return 0;
  await Appointment.updateMany(
    { _id: { $in: expired.map((a) => a._id) }, status: APPOINTMENT_STATUS.REQUESTED },
    { status: APPOINTMENT_STATUS.CANCELLED, slotKey: null, cancelledAt: new Date(), cancelledBy: 'SYSTEM', cancelReason: 'Payment not completed in time' }
  ).setOptions({ clinicId });
  return expired.length;
}

/** Appointments that occupy a doctor's time between two instants. */
export function blockingOverlapFilter({ doctorId, startAt, endAt, excludeId }) {
  const f = {
    doctorId,
    status: { $in: BLOCKING_STATUSES },
    slotKey: { $type: 'string' },     // walk-ins don't hold schedule slots
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (excludeId) f._id = { $ne: excludeId };
  return f;
}

function holidayOn(clinic, ymd) {
  return (clinic?.holidays || []).find((h) => dayjs(h.date).tz(TZ).format('YYYY-MM-DD') === ymd);
}

/**
 * Candidate slots for one doctor on one date from their rules, minus breaks,
 * leave and clinic holidays. Does not look at existing bookings.
 */
export async function candidateSlots({ clinicId, doctor, date, durationMins }) {
  const ymd = toYmd(date);
  const clinic = await Clinic.findById(clinicId).select('holidays').lean();
  const holiday = holidayOn(clinic, ymd);
  if (holiday) return { slots: [], reason: `Clinic closed${holiday.reason ? ` — ${holiday.reason}` : ''}` };
  if (!doctor.isActive) return { slots: [], reason: 'Doctor is not taking appointments' };
  if (isOnLeave(doctor.leaves, ymd)) return { slots: [], reason: 'Doctor is on leave that day' };
  return {
    slots: generateSlots({ date: ymd, rules: doctor.availability, breaks: doctor.breaks, slotDurationMins: durationMins, tz: TZ }),
  };
}

/**
 * Free slots for one doctor on one date: generated slots minus any that
 * overlap an appointment already holding the doctor's time.
 */
export async function getAvailability({ clinicId, doctorId, date, serviceDurationMins }) {
  const doctor = await Doctor.findOne({ _id: doctorId }).setOptions({ clinicId });
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const ymd = toYmd(date);
  const day = dayjs.tz(ymd, TZ);
  const duration = serviceDurationMins || doctor.slotDurationMins || 15;

  const { slots: candidates, reason } = await candidateSlots({ clinicId, doctor, date: ymd, durationMins: duration });
  const base = { doctor: doctor.name, doctorId, date: ymd, durationMins: duration };
  if (!candidates.length) return { ...base, slots: [], reason: reason || 'No working hours that day' };

  await releaseExpiredHolds({ clinicId, doctorId });
  const taken = await Appointment.find(blockingOverlapFilter({
    doctorId, startAt: day.startOf('day').toDate(), endAt: day.endOf('day').toDate(),
  })).select('startAt endAt').setOptions({ clinicId }).lean();

  const now = new Date();
  const slots = candidates
    .filter((s) => s.startAt > now)
    .filter((s) => !taken.some((t) => s.startAt < t.endAt && s.endAt > t.startAt))
    .map((s) => ({ startAt: s.startAt, endAt: s.endAt, slotKey: slotKeyFor(s.startAt), available: true }));

  return { ...base, slots, ...(slots.length ? {} : { reason: 'Fully booked that day. Try another date.' }) };
}

/** True if `start` is one of the doctor's real slot starts for that day. */
export async function isScheduledSlot({ clinicId, doctor, start, durationMins }) {
  const { slots, reason } = await candidateSlots({ clinicId, doctor, date: start, durationMins });
  const key = slotKeyFor(start);
  return { ok: slots.some((s) => slotKeyFor(s.startAt) === key), reason };
}

/** Multi-day search, used by the AI assistant for "Friday after 5pm". */
export async function findNextAvailable({ clinicId, doctorId, fromDate, days = 14, afterHour, beforeHour }) {
  const start = dayjs.tz(toYmd(fromDate), TZ);
  for (let i = 0; i < days; i += 1) {
    const date = start.add(i, 'day').format('YYYY-MM-DD');
    const { slots } = await getAvailability({ clinicId, doctorId, date });
    const filtered = slots.filter((s) => {
      const h = dayjs(s.startAt).tz(TZ).hour();
      if (afterHour != null && h < afterHour) return false;
      if (beforeHour != null && h >= beforeHour) return false;
      return true;
    });
    if (filtered.length) return { date, slots: filtered };
  }
  return { date: null, slots: [] };
}
