import dayjs from 'dayjs';
import { enqueue, removeJob } from './queues.js';
import { Clinic } from '../models/index.js';

/**
 * One confirmed appointment fans out into several scheduled jobs.
 * Job IDs are deterministic so cancelling or rescheduling can remove them.
 */
export async function scheduleAppointmentReminders(appointment) {
  const id = appointment._id.toString();
  const start = dayjs(appointment.startAt);
  const clinic = await Clinic.findById(appointment.clinicId).select('notificationSettings').lean();
  const settings = clinic?.notificationSettings || {};
  const hours = settings.reminderHours?.length ? settings.reminderHours : [24, 2];

  if (settings.events?.reminder !== false) {
    for (const h of hours) {
      const delay = start.subtract(h, 'hour').diff(dayjs());
      if (delay <= 0) continue;
      await enqueue('appointmentReminder', 'remind', {
        appointmentId: id,
        clinicId: appointment.clinicId.toString(),
        patientId: appointment.patientId.toString(),
        templateName: `appointment_reminder_${h}h`,
      }, { delay, jobId: `reminder:${id}:${h}h` });
    }
  }

  // Review request goes out a few hours after the visit; the worker only sends
  // it if the visit actually completed and the clinic has a review URL.
  if (settings.events?.reviewRequest) {
    const delay = start.add(settings.reviewDelayHours || 3, 'hour').diff(dayjs());
    if (delay > 0) {
      await enqueue('review', 'request', { appointmentId: id, clinicId: appointment.clinicId.toString() },
        { delay, jobId: `review:${id}` });
    }
  }
}

/** Removes every job for an appointment. Covers any reminder offset a clinic may have used. */
export async function cancelAppointmentJobs(appointmentId) {
  const id = appointmentId.toString();
  const offsets = [1, 2, 3, 4, 6, 12, 24, 48, 72];
  await Promise.all([
    ...offsets.map((h) => removeJob('appointmentReminder', `reminder:${id}:${h}h`)),
    removeJob('review', `review:${id}`),
  ]);
}
