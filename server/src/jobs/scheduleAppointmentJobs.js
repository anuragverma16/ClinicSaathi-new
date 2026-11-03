// Import the Day.js library to work with dates and times.
// It is used here to calculate the exact time remaining before an appointment
// and to determine when reminder and review-request jobs should be executed.
import dayjs from 'dayjs';

// Import queue utility functions.
// enqueue() is responsible for adding a new scheduled job to the queue.
// removeJob() is responsible for removing an already scheduled job.
// These functions allow appointment-related notifications to be managed
// without executing them immediately.
import { enqueue, removeJob } from './queues.js';

// Import the Clinic model to retrieve clinic-specific notification settings.
// Different clinics may have different reminder schedules and notification preferences.
import { Clinic } from '../models/index.js';

/**
 * SCHEDULE APPOINTMENT REMINDERS
 *
 * This function schedules all notification-related background jobs
 * associated with a confirmed appointment.
 *
 * Whenever an appointment is successfully confirmed, this function can be called
 * to automatically create scheduled jobs for:
 *
 * 1. Appointment reminder notifications.
 * 2. Post-appointment review request notifications.
 *
 * The actual notifications are not sent directly by this function.
 * Instead, jobs are added to the background queue and processed later
 * by the corresponding worker.
 *
 * IMPORTANT:
 * Job IDs are generated deterministically using the appointment ID.
 * This makes it possible to identify and remove the scheduled jobs later
 * when an appointment is cancelled or rescheduled.
 *
 * @param {Object} appointment - The confirmed appointment document.
 * @returns {Promise<void>} Resolves after the applicable jobs are scheduled.
 */
export async function scheduleAppointmentReminders(appointment) {

  // Convert the appointment MongoDB ObjectId into a string.
  // A string representation is convenient for generating queue job IDs
  // and passing appointment identifiers to background workers.
  const id = appointment._id.toString();

  // Convert the appointment's start date and time into a Day.js object.
  // This allows us to perform date calculations such as subtracting
  // reminder hours or adding a review-request delay.
  const start = dayjs(appointment.startAt);

  // Retrieve the clinic associated with this appointment.
  // Only notificationSettings are selected because the function does not
  // require the remaining clinic document fields.
  //
  // lean() returns a plain JavaScript object instead of a full Mongoose
  // document, which is useful when we only need to read configuration data.
  const clinic = await Clinic.findById(appointment.clinicId)
    .select('notificationSettings')
    .lean();

  // Read the notification settings configured for this clinic.
  // If the clinic does not exist or notificationSettings are unavailable,
  // use an empty object to avoid accessing properties on undefined.
  const settings = clinic?.notificationSettings || {};

  // Determine how many hours before the appointment reminders should be sent.
  //
  // If the clinic has configured a non-empty reminderHours array,
  // use the configured values.
  //
  // Otherwise, use the default reminder schedule:
  // - 24 hours before the appointment.
  // - 2 hours before the appointment.
  //
  // This allows clinics to customize reminder timing without requiring
  // changes to the scheduling implementation.
  const hours = settings.reminderHours?.length
    ? settings.reminderHours
    : [24, 2];

  // Check whether appointment reminder notifications are enabled.
  //
  // The reminder event is considered enabled by default.
  // It is disabled only when the configuration explicitly contains false.
  //
  // This ensures that clinics which have not configured this setting
  // can still use the default appointment reminder functionality.
  if (settings.events?.reminder !== false) {

    // Iterate through every configured reminder offset.
    // Each value represents the number of hours before the appointment
    // at which a reminder notification should be scheduled.
    for (const h of hours) {

      // Calculate the remaining time until the reminder should be sent.
      //
      // First, subtract the configured number of hours from the appointment
      // start time. Then calculate the difference between that reminder time
      // and the current date and time.
      //
      // The resulting value is the delay in milliseconds required by the queue.
      const delay = start.subtract(h, 'hour').diff(dayjs());

      // Do not schedule reminders whose calculated execution time
      // is already in the past or is equal to the current time.
      //
      // This prevents unnecessary background jobs from being created
      // for reminders that can no longer be sent at their intended time.
      if (delay <= 0) continue;

      // Add an appointment reminder job to the background queue.
      //
      // Parameters:
      // 1. 'appointmentReminder' - The queue responsible for reminder jobs.
      // 2. 'remind' - The job type that the worker should execute.
      // 3. Job data - Information required by the worker to identify
      //    the appointment, clinic, patient and notification template.
      // 4. Job options - Scheduling delay and a unique deterministic job ID.
      //
      // The template name is generated dynamically based on the reminder offset.
      // For example:
      // appointment_reminder_24h
      // appointment_reminder_2h
      //
      // The delay ensures that the worker processes the job at the
      // calculated reminder time rather than immediately.
      await enqueue(
        'appointmentReminder',
        'remind',
        {
          // Unique identifier of the appointment for which the reminder
          // notification needs to be generated.
          appointmentId: id,

          // Clinic identifier used by the worker to retrieve clinic-specific
          // information and notification configuration.
          clinicId: appointment.clinicId.toString(),

          // Patient identifier used to determine the recipient of the reminder.
          patientId: appointment.patientId.toString(),

          // Dynamically generated notification template name.
          // The number of hours is included so that different reminder
          // intervals can use their respective message templates.
          templateName: `appointment_reminder_${h}h`,
        },
        {
          // Number of milliseconds to wait before executing this job.
          delay,

          // Generate a predictable and unique job ID for this appointment
          // and reminder interval.
          //
          // Example:
          // reminder:APPOINTMENT_ID:24h
          //
          // Deterministic IDs make it easier to locate and remove
          // individual reminder jobs during cancellation or rescheduling.
          jobId: `reminder:${id}:${h}h`,
        }
      );
    }
  }

  // REVIEW REQUEST SCHEDULING
  //
  // A review request is intended to be sent after the patient's appointment.
  // It gives the patient an opportunity to share feedback about their visit.
  //
  // The actual sending of the review request is handled by a background worker.
  // The worker is responsible for checking whether the appointment was
  // completed successfully and whether the clinic has configured a review URL.
  //
  // Review requests are scheduled only when the clinic explicitly enables
  // the corresponding notification event.
  if (settings.events?.reviewRequest) {

    // Calculate the delay for the review request.
    //
    // The configured reviewDelayHours value determines how many hours
    // after the appointment start time the review request should be sent.
    //
    // If no custom delay is configured, a default delay of 3 hours is used.
    //
    // The difference is calculated in milliseconds because the queue
    // scheduling system accepts delay values in milliseconds.
    const delay = start
      .add(settings.reviewDelayHours || 3, 'hour')
      .diff(dayjs());

    // Schedule the review request only if its execution time is still
    // in the future.
    //
    // This prevents the creation of review jobs that are already overdue.
    if (delay > 0) {

      // Add a review-request job to the background queue.
      //
      // The job contains the appointment and clinic identifiers.
      // The review worker can use these identifiers to retrieve the relevant
      // appointment details and verify the clinic's review configuration.
      await enqueue(
        'review',
        'request',
        {
          // Appointment identifier used to retrieve appointment details
          // and verify whether the visit was completed.
          appointmentId: id,

          // Clinic identifier used to retrieve the clinic's review URL
          // and other relevant notification settings.
          clinicId: appointment.clinicId.toString(),
        },
        {
          // Schedule the review request for the calculated future time.
          delay,

          // Generate a deterministic job ID for the review request.
          // This allows the review job to be located and removed
          // if the appointment is cancelled or rescheduled.
          jobId: `review:${id}`,
        }
      );
    }
  }
}

/**
 * CANCEL APPOINTMENT JOBS
 *
 * This function removes all scheduled background jobs associated
 * with a particular appointment.
 *
 * It is especially useful when:
 *
 * 1. A patient cancels an existing appointment.
 * 2. An appointment is rescheduled to a different date or time.
 * 3. Previously scheduled notifications are no longer valid.
 *
 * Removing these jobs prevents outdated reminders and review requests
 * from being processed for an appointment that is no longer valid
 * in its original form.
 *
 * The function uses deterministic job IDs generated during scheduling
 * to identify the corresponding background jobs.
 *
 * @param {string|Object} appointmentId - The appointment's unique identifier.
 * @returns {Promise<void>} Resolves after all removal operations complete.
 */
export async function cancelAppointmentJobs(appointmentId) {

  // Convert the supplied appointment identifier into a string.
  // This ensures that the generated job IDs match the format
  // used by scheduleAppointmentReminders().
  const id = appointmentId.toString();

  // Define the reminder offsets that may have been used by a clinic.
  //
  // These values cover common reminder intervals:
  // - 1 hour before the appointment.
  // - 2 hours before the appointment.
  // - 3 hours before the appointment.
  // - 4 hours before the appointment.
  // - 6 hours before the appointment.
  // - 12 hours before the appointment.
  // - 24 hours before the appointment.
  // - 48 hours before the appointment.
  // - 72 hours before the appointment.
  //
  // Checking multiple possible offsets helps remove reminder jobs
  // even when a clinic has customized its reminder configuration.
  const offsets = [1, 2, 3, 4, 6, 12, 24, 48, 72];

  // Remove all reminder jobs and the associated review-request job.
  //
  // Promise.all() executes the removal operations concurrently rather
  // than waiting for each individual operation to finish sequentially.
  //
  // Reminder jobs are identified using their appointment ID and
  // corresponding hour offset.
  //
  // Review requests use a separate queue and their own deterministic ID.
  //
  // Once these operations complete, the previously scheduled jobs
  // associated with the appointment have been requested for removal.
  await Promise.all([

    // Generate a removal operation for every supported reminder offset.
    //
    // The generated job ID must match the ID used when the reminder
    // was originally added to the appointmentReminder queue.
    ...offsets.map((h) =>
      removeJob(
        'appointmentReminder',
        `reminder:${id}:${h}h`
      )
    ),

    // Remove the review-request job associated with this appointment.
    //
    // This uses the same deterministic job ID that was generated
    // when the review request was scheduled.
    removeJob(
      'review',
      `review:${id}`
    ),
  ]);
}





















































































































































// Remove the review-request job associated with this appointment.









































































































































































































































































































// Remove the review-request job associated with this appointment.


































































































































































// Remove the review-request job associated with this appointment.
// Remove the review-request job associated with this appointment.
// Remove the review-request job associated with this appointment.























































// Remove the review-request job associated with this appointment.





















































// Remove the review-request job associated with this appointment.











































































// Remove the review-request job associated with this appointment.

