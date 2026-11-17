import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { Appointment, Doctor, Service, Patient, Clinic } from '../models/index.js';
import { slotKeyFor } from '../utils/slots.js';
import { APPOINTMENT_STATUS, CHANGEABLE_STATUSES } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { emit, EVENTS } from './events.js';
import { isScheduledSlot, releaseExpiredHolds, blockingOverlapFilter } from './availability.service.js';

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newBookingRef = () =>
  `CS-${Array.from(crypto.randomBytes(6), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;

const slotTaken = () => ApiError.conflict('That slot was just taken. Pick another time.', 'SLOT_UNAVAILABLE');

/**
 * Inserts an appointment that holds a slot, then verifies nothing overlaps it.
 *
 * Concurrency: there's no check-then-insert. The unique (doctor, slotKey)
 * index rejects two bookings at the same start; for bookings of different
 * lengths that merely overlap, each writer re-reads after inserting and
 * withdraws its own row if it sees a rival. Two simultaneous writers may both
 * withdraw (the patient just retries) but both can never succeed.
 */
async function insertHoldingSlot(doc) {
  let appointment;
  try {
    appointment = await Appointment.create(doc);
  } catch (e) {
    if (e.code === 11000 && e.keyPattern?.slotKey) throw slotTaken();
    throw e;
  }
  const rival = await Appointment.findOne(blockingOverlapFilter({
    doctorId: doc.doctorId, startAt: doc.startAt, endAt: doc.endAt, excludeId: appointment._id,
  })).setOptions({ clinicId: doc.clinicId }).lean();
  if (rival) {
    await Appointment.deleteOne({ _id: appointment._id }).setOptions({ clinicId: doc.clinicId });
    throw slotTaken();
  }
  return appointment;
}

async function loadBookingContext({ clinicId, doctorId, serviceId, patientId }) {
  const [doctor, service, patient] = await Promise.all([
    Doctor.findOne({ _id: doctorId }).setOptions({ clinicId }),
    serviceId ? Service.findOne({ _id: serviceId, isActive: true }).setOptions({ clinicId }) : null,
    Patient.findOne({ _id: patientId }).setOptions({ clinicId }),
  ]);
  if (!doctor || !doctor.isActive) throw ApiError.notFound('Doctor not found', 'DOCTOR_NOT_FOUND');
  if (!patient) throw ApiError.notFound('Patient not found', 'PATIENT_NOT_FOUND');
  if (serviceId && !service) throw ApiError.notFound('Service not found', 'SERVICE_NOT_FOUND');
  return { doctor, service, patient };
}

/** Rejects times outside the doctor's working pattern, leave, holidays or the booking window. */
async function assertBookableTime({ clinicId, doctor, start, durationMins, maxAdvanceDays }) {
  if (!start.isValid()) throw ApiError.badRequest('Choose a valid time', 'INVALID_TIME');
  if (start.isBefore(dayjs())) throw ApiError.badRequest('That time has already passed', 'SLOT_IN_PAST');
  if (maxAdvanceDays && start.isAfter(dayjs().add(maxAdvanceDays, 'day'))) {
    throw ApiError.badRequest(`Bookings open ${maxAdvanceDays} days ahead`, 'TOO_FAR_AHEAD');
  }
  const { ok, reason } = await isScheduledSlot({ clinicId, doctor, start: start.toDate(), durationMins });
  if (!ok) throw ApiError.badRequest(reason || 'That time is outside the doctor\'s schedule', 'OUTSIDE_SCHEDULE');
}

/**
 * Book a slot. `holdMinutes` creates a REQUESTED (pending confirmation) hold
 * that a verified payment confirms; without it the booking is CONFIRMED.
 */
export async function bookAppointment({
  clinicId, branchId, patientId, doctorId, serviceId,
  startAt, mode = 'OFFLINE', source = 'WEBSITE', reason, createdByUserId,
  holdMinutes, enforceAdvanceWindow = false,
}) {
  const { doctor, service } = await loadBookingContext({ clinicId, doctorId, serviceId, patientId });
  const clinic = await Clinic.findById(clinicId).select('bookingPolicy').lean();

  const start = dayjs(startAt).second(0).millisecond(0);
  const durationMins = service?.durationMins || doctor.slotDurationMins || 15;
  await assertBookableTime({
    clinicId, doctor, start, durationMins,
    maxAdvanceDays: enforceAdvanceWindow ? clinic?.bookingPolicy?.maxAdvanceDays : null,
  });
  await releaseExpiredHolds({ clinicId, doctorId });

  const fee = service?.fee ?? doctor.consultationFee ?? 0;
  const isHold = Boolean(holdMinutes) && fee > 0;

  const appointment = await insertHoldingSlot({
    clinicId,
    branchId: branchId || doctor.branchId,
    patientId, doctorId, serviceId,
    bookingRef: newBookingRef(),
    startAt: start.toDate(),
    endAt: start.add(durationMins, 'minute').toDate(),
    durationMins,
    slotKey: slotKeyFor(start.toDate()),   // the lock
    status: isHold ? APPOINTMENT_STATUS.REQUESTED : APPOINTMENT_STATUS.CONFIRMED,
    paymentRequired: isHold,
    holdExpiresAt: isHold ? dayjs().add(holdMinutes, 'minute').toDate() : undefined,
    mode, source, reason, fee,
    createdByUserId,
  });

  emit(EVENTS.APPOINTMENT_CREATED, { appointment });
  if (appointment.status === APPOINTMENT_STATUS.CONFIRMED) emit(EVENTS.APPOINTMENT_CONFIRMED, { appointment });
  return appointment;
}

/**
 * Walk-ins are seen in queue order, not in a slot, so they don't hold the
 * doctor's schedule (slotKey stays null) and can't collide with bookings.
 */
export async function createWalkIn({ clinicId, branchId, patientId, doctorId, serviceId, reason, createdByUserId, isEmergency = false }) {
  const { doctor, service } = await loadBookingContext({ clinicId, doctorId, serviceId, patientId });
  const now = dayjs().second(0).millisecond(0);
  const durationMins = service?.durationMins || doctor.slotDurationMins || 15;
  const appointment = await Appointment.create({
    clinicId, branchId: branchId || doctor.branchId, patientId, doctorId, serviceId,
    bookingRef: newBookingRef(),
    startAt: now.toDate(), endAt: now.add(durationMins, 'minute').toDate(), durationMins,
    slotKey: null, status: APPOINTMENT_STATUS.CONFIRMED, source: 'WALK_IN', reason, isEmergency,
    fee: service?.fee ?? doctor.consultationFee ?? 0, createdByUserId,
  });
  emit(EVENTS.APPOINTMENT_CREATED, { appointment });
  return appointment;
}

/** REQUESTED → CONFIRMED (staff confirmation or a verified prepayment). */
export async function confirmAppointment({ clinicId, appointmentId, viaPayment = false }) {
  const appointment = await Appointment.findOneAndUpdate(
    { _id: appointmentId, status: APPOINTMENT_STATUS.REQUESTED },
    { status: APPOINTMENT_STATUS.CONFIRMED, $unset: { holdExpiresAt: 1 }, ...(viaPayment ? { paymentStatus: 'PAID' } : {}) },
    { new: true }
  ).setOptions({ clinicId });
  if (!appointment) throw ApiError.badRequest('Only a pending appointment can be confirmed', 'NOT_PENDING');
  emit(EVENTS.APPOINTMENT_CONFIRMED, { appointment });
  return appointment;
}

/** Cancelling releases the slot by nulling slotKey, so the index frees it. */
export async function cancelAppointment({ clinicId, appointmentId, reason, actorUserId, cancelledBy = 'CLINIC', patientId }) {
  const filter = { _id: appointmentId, status: { $in: CHANGEABLE_STATUSES } };
  if (patientId) filter.patientId = patientId;   // ownership check for patient-initiated cancels
  const appointment = await Appointment.findOneAndUpdate(
    filter,
    { status: APPOINTMENT_STATUS.CANCELLED, slotKey: null, cancelledAt: new Date(), cancelReason: reason, cancelledBy },
    { new: true }
  ).setOptions({ clinicId });

  if (!appointment) throw ApiError.badRequest('This appointment can no longer be cancelled', 'CANCEL_NOT_ALLOWED');
  emit(EVENTS.APPOINTMENT_CANCELLED, { appointment, actorUserId });
  return appointment;
}

/**
 * Reschedule = claim the new slot, then release the old one.
 *
 * Claiming first means a failed claim (slot taken, outside schedule) leaves
 * the original booking untouched, and it works on any database with no
 * transactions. If releasing the old row fails, the new claim is rolled back.
 */
export async function rescheduleAppointment({ clinicId, appointmentId, newStartAt, newDoctorId, actorUserId, patientId }) {
  const filter = { _id: appointmentId };
  if (patientId) filter.patientId = patientId;
  const old = await Appointment.findOne(filter).setOptions({ clinicId });
  if (!old) throw ApiError.notFound('Appointment not found');
  if (!CHANGEABLE_STATUSES.includes(old.status)) {
    throw ApiError.badRequest('This appointment can no longer be rescheduled', 'RESCHEDULE_NOT_ALLOWED');
  }

  const doctorId = newDoctorId || old.doctorId;
  const { doctor } = await loadBookingContext({ clinicId, doctorId, serviceId: old.serviceId, patientId: old.patientId });
  const start = dayjs(newStartAt).second(0).millisecond(0);
  if (String(doctorId) === String(old.doctorId) && slotKeyFor(start.toDate()) === old.slotKey) {
    throw ApiError.badRequest('That is the current time of this appointment', 'SAME_SLOT');
  }
  const durationMins = old.durationMins || doctor.slotDurationMins || 15;
  await assertBookableTime({ clinicId, doctor, start, durationMins });
  await releaseExpiredHolds({ clinicId, doctorId });

  const fresh = await insertHoldingSlot({
    clinicId,
    branchId: doctor.branchId || old.branchId,
    patientId: old.patientId, doctorId, serviceId: old.serviceId,
    bookingRef: old.bookingRef || newBookingRef(),
    startAt: start.toDate(), endAt: start.add(durationMins, 'minute').toDate(), durationMins,
    slotKey: slotKeyFor(start.toDate()),
    status: old.status, paymentRequired: old.paymentRequired, holdExpiresAt: old.holdExpiresAt,
    paymentStatus: old.paymentStatus, invoiceId: old.invoiceId,
    mode: old.mode, source: old.source, reason: old.reason, fee: old.fee,
    rescheduledFrom: old._id, createdByUserId: actorUserId,
  });

  const released = await Appointment.findOneAndUpdate(
    { _id: old._id, status: old.status },
    { status: APPOINTMENT_STATUS.RESCHEDULED, slotKey: null, rescheduledTo: fresh._id },
    { new: true }
  ).setOptions({ clinicId });
  if (!released) {
    await Appointment.deleteOne({ _id: fresh._id }).setOptions({ clinicId });
    throw ApiError.conflict('The appointment changed while rescheduling. Refresh and try again.', 'CONCURRENT_UPDATE');
  }

  emit(EVENTS.APPOINTMENT_RESCHEDULED, { appointment: fresh, previous: released, actorUserId });
  return fresh;
}
