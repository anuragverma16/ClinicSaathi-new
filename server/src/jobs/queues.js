// Import the Queue class from BullMQ.
// BullMQ is a Node.js queue management library used to handle background jobs.
// It allows the application to schedule, process, retry and manage asynchronous
// tasks without blocking the main application or HTTP request lifecycle.
import { Queue } from 'bullmq';

// Import Redis connection utilities.
// getRedis() provides the Redis connection instance used by BullMQ.
// isRedisReady() checks whether the Redis connection is currently available
// and ready to accept queue-related operations.
import { getRedis, isRedisReady } from '../config/redis.js';

// Import the JobEvent model.
// This model is used to record important background-job events,
// particularly when a job cannot be added to its respective queue.
// These records can later be used for monitoring and system health reporting.
import { JobEvent } from '../models/index.js';


// DEFAULT JOB OPTIONS
//
// These options define the default execution and lifecycle behaviour
// for jobs added to the BullMQ queues.
//
// Individual jobs can still provide their own options when calling enqueue(),
// but these settings act as the common defaults for all queue instances.
const defaultJobOptions = {

  // Maximum number of attempts allowed for a job.
  // If a job fails during processing, BullMQ can retry it automatically.
  // In this configuration, a job can be attempted up to three times.
  attempts: 3,

  // Configure the retry delay strategy.
  // Exponential backoff increases the waiting time between retry attempts.
  // The initial delay is 5000 milliseconds (5 seconds).
  // This helps avoid repeatedly retrying failed jobs too quickly.
  backoff: { type: 'exponential', delay: 5000 },

  // Number of successfully completed jobs to retain in Redis.
  // Older completed jobs are automatically removed when the retained
  // completed-job count exceeds the configured limit.
  // Keeping a limited history helps control Redis storage usage.
  removeOnComplete: 1000,

  // Number of failed jobs to retain in Redis.
  // Failed jobs are useful for debugging and investigating processing errors.
  // This setting preserves up to 5000 failed jobs before older entries
  // are automatically removed.
  removeOnFail: 5000,
};


// QUEUE NAME CONFIGURATION
//
// This object maintains the mapping between application-level queue keys
// and their actual BullMQ queue names.
//
// The application uses short, readable keys such as appointmentReminder
// and followUp when accessing queues.
//
// BullMQ uses the corresponding string values as the actual queue names
// stored and managed through Redis.
//
// Keeping queue names centralized helps maintain consistency throughout
// the application and avoids repeatedly hardcoding queue names.
const NAMES = {

  // Queue responsible for handling appointment reminder notifications.
  // These jobs can be scheduled to notify patients before their appointments.
  appointmentReminder: 'appointmentReminderQueue',

  // Queue responsible for processing patient follow-up tasks.
  // It can be used to schedule follow-up messages after consultations.
  followUp: 'followUpQueue',

  // Queue responsible for recall-related tasks.
  // Recall jobs can be used to remind patients about future visits
  // or other clinic-defined recall activities.
  recall: 'recallQueue',

  // Queue responsible for processing post-appointment review requests.
  // It can schedule requests asking patients to provide feedback
  // after completing their clinic visits.
  review: 'reviewQueue',

  // Queue responsible for payment reminder notifications.
  // It can handle reminders related to pending or outstanding payments.
  paymentReminder: 'paymentReminderQueue',

  // Queue responsible for campaign-related background tasks.
  // These jobs can be used for clinic announcements and campaign messages.
  campaign: 'campaignQueue',

  // Queue responsible for birthday-related notifications.
  // It can process scheduled birthday greetings for patients.
  birthday: 'birthdayQueue',

  // Queue responsible for medicine reminder notifications.
  // It can handle reminders intended to help patients remember
  // their prescribed medication schedules.
  medicineReminder: 'medicineReminderQueue',

  // General-purpose notification queue.
  // It can process notification tasks that do not belong to
  // one of the more specialized queue categories.
  notification: 'notificationQueue',
};


// LAZY QUEUE INITIALIZATION
//
// Queues are intentionally created only when they are first accessed.
//
// Creating a BullMQ Queue instance can initialize Redis-related activity.
// Lazy initialization prevents unnecessary queue creation when this module
// is imported by tests, scripts or application components that do not
// actually need to schedule or process background jobs.
//
// This also helps keep the application lightweight during startup.
//
// The instances object stores already-created queue instances.
// Once a queue has been initialized, its instance can be reused
// instead of creating a new Queue object every time.
const instances = {};


// QUEUE ACCESS PROXY
//
// A JavaScript Proxy is used to provide dynamic access to queue instances.
//
// Instead of manually creating and exporting every queue separately,
// this Proxy intercepts property access and initializes the requested
// queue only when it is actually needed.
//
// Example:
// queues.appointmentReminder
// queues.followUp
// queues.review
//
// When one of these properties is accessed, the get() handler checks
// whether the requested key exists in the NAMES configuration.
export const queues = new Proxy({}, {

  // The get trap executes whenever a property is accessed on the Proxy.
  //
  // _t represents the original target object.
  // key represents the property or queue key being requested.
  get(_t, key) {

    // Verify that the requested queue key exists in the NAMES object.
    //
    // If the key is not configured, return undefined.
    // This prevents accidental creation of queues with invalid names.
    if (!NAMES[key]) return undefined;

    // Initialize the requested queue only if it does not already exist.
    //
    // The ||= operator assigns a new Queue instance when the corresponding
    // entry in instances is empty or undefined.
    //
    // If an instance already exists, it is reused.
    //
    // Queue constructor parameters:
    // 1. NAMES[key] - Actual BullMQ queue name.
    // 2. connection - Redis connection returned by getRedis().
    // 3. defaultJobOptions - Common execution and retry settings.
    //
    // This approach ensures that each configured queue has one reusable
    // instance within this module.
    instances[key] ||= new Queue(
      NAMES[key],
      {
        connection: getRedis(),
        defaultJobOptions
      }
    );

    // Return the initialized or previously existing queue instance.
    // The calling function can now use BullMQ methods such as add()
    // and getJob() on this queue.
    return instances[key];
  },
});


// EXPORT QUEUE NAME CONFIGURATION
//
// Export the queue-name mapping so that other modules can access
// the same centralized queue-name configuration.
//
// This avoids maintaining separate queue-name definitions
// in different parts of the application.
export const QUEUE_NAMES = NAMES;


/**
 * ENQUEUE BACKGROUND JOB
 *
 * This function adds a new background job to the requested BullMQ queue.
 *
 * It also handles Redis availability and queue insertion failures
 * so that background-job scheduling does not unnecessarily block
 * the application's normal request-handling flow.
 *
 * Main responsibilities:
 *
 * 1. Initialize or retrieve the Redis connection.
 * 2. Verify whether Redis is ready.
 * 3. Record a failure event if Redis is unavailable.
 * 4. Add the requested job to the appropriate BullMQ queue.
 * 5. Record an event if the queue insertion operation fails.
 *
 * The JobEvent collection provides a record of failed enqueue operations.
 * This information can be used by the System Health module to help
 * the platform team investigate background-processing issues.
 *
 * @param {string} queueKey - Application-level queue identifier.
 * @param {string} name - Name of the background job.
 * @param {Object} data - Payload containing the information required by the worker.
 * @param {Object} opts - Optional BullMQ job configuration.
 *
 * @returns {Promise<Object|null>}
 * Returns the created BullMQ job when successful.
 * Returns null when Redis is unavailable or job insertion fails.
 */
export async function enqueue(queueKey, name, data, opts = {}) {

  // Retrieve the Redis connection.
  //
  // Calling getRedis() ensures that the Redis connection is initialized
  // or made available before checking its readiness.
  getRedis();

  // Check whether the Redis connection is currently ready.
  //
  // Background jobs require Redis because BullMQ uses it to store
  // queue information and manage job execution.
  //
  // If Redis is not ready, the job cannot be safely added to the queue.
  if (!isRedisReady()) {

    // Record the failed enqueue operation in the JobEvent collection.
    //
    // This provides visibility into scheduling failures instead of
    // silently ignoring them.
    //
    // The stored information includes:
    //
    // queue:
    // Actual BullMQ queue name associated with the requested queue key.
    //
    // jobName:
    // Name of the background job that was supposed to be scheduled.
    //
    // jobId:
    // Optional custom job identifier provided through opts.
    //
    // clinicId:
    // Clinic identifier extracted from the job payload when available.
    //
    // status:
    // ENQUEUE_FAILED indicates that the job could not be added.
    //
    // error:
    // Explains that Redis was not connected at the time of the operation.
    await JobEvent.create({

      // Resolve the actual queue name from the centralized mapping.
      queue: NAMES[queueKey],

      // Store the requested job name.
      jobName: name,

      // Store the custom job ID when one has been provided.
      jobId: opts.jobId,

      // Associate the failure event with the relevant clinic, if available.
      clinicId: data?.clinicId,

      // Mark this event as a failed enqueue operation.
      status: 'ENQUEUE_FAILED',

      // Store the reason why the job could not be scheduled.
      error: 'Redis not connected',

    }).catch(() => {});

    // Return null because no BullMQ job was created.
    //
    // The function exits here without attempting to add a job
    // to a queue that cannot currently communicate with Redis.
    return null;
  }

  // Attempt to add the background job to the requested BullMQ queue.
  //
  // The try/catch block handles errors that may occur during queue insertion.
  try {

    // Access the requested queue through the Proxy.
    // If this is the first time the queue is accessed, the Proxy
    // initializes its BullMQ Queue instance automatically.
    //
    // add() creates a new job using:
    // 1. name - Job name used by the worker.
    // 2. data - Payload required for job processing.
    // 3. opts - Additional job configuration, such as delay or jobId.
    //
    // await ensures that the function waits for the queue insertion
    // operation to complete before returning the result.
    return await queues[queueKey].add(name, data, opts);

  } catch (e) {

    // This block executes when an error occurs while adding the job.
    //
    // Possible reasons may include:
    // - Redis connection problems.
    // - Invalid queue configuration.
    // - BullMQ insertion errors.
    // - Invalid job options.
    //
    // Recording the error helps identify and investigate
    // background-job scheduling failures.

    // Save the failed operation in the JobEvent collection.
    //
    // This follows the same event structure used when Redis
    // is unavailable, while storing the actual error message.
    await JobEvent.create({

      // Actual BullMQ queue name associated with the operation.
      queue: NAMES[queueKey],

      // Name of the job that could not be added.
      jobName: name,

      // Custom job identifier, if provided.
      jobId: opts.jobId,

      // Clinic associated with the job payload, if available.
      clinicId: data?.clinicId,

      // Indicate that the enqueue operation was unsuccessful.
      status: 'ENQUEUE_FAILED',

      // Store the error message generated during queue insertion.
      error: e.message,

    }).catch(() => {});

    // Return null to indicate that the background job
    // was not successfully added to the queue.
    return null;
  }
}


/**
 * REMOVE SCHEDULED JOB
 *
 * This function removes a previously scheduled background job
 * from its corresponding BullMQ queue using its deterministic job ID.
 *
 * It is useful when an existing scheduled task becomes unnecessary.
 *
 * Common examples include:
 *
 * 1. Removing an appointment reminder after cancellation.
 * 2. Removing outdated reminder jobs after rescheduling.
 * 3. Removing a pending notification that is no longer required.
 *
 * The function first checks whether Redis is available.
 * If Redis is unavailable, it safely returns false without attempting
 * to perform queue operations.
 *
 * @param {string} queueKey - Application-level queue identifier.
 * @param {string} jobId - Unique identifier of the job to remove.
 *
 * @returns {Promise<boolean>}
 * Returns true when an existing job is successfully removed.
 * Returns false when Redis is unavailable, the job does not exist,
 * or the job cannot be removed.
 */
export async function removeJob(queueKey, jobId) {

  // Check whether the Redis connection is ready.
  //
  // BullMQ requires Redis to retrieve and remove jobs.
  // If Redis is unavailable, there is no point in attempting
  // to access the queue.
  //
  // Returning false ensures that the caller receives a clear
  // indication that the removal operation was not completed.
  if (!isRedisReady()) return false;

  // Attempt to retrieve and remove the requested background job.
  // Errors are handled in the catch block to keep this operation safe.
  try {

    // Access the requested queue through the queues Proxy.
    //
    // getJob(jobId) searches the queue for a job with the specified ID.
    // The job ID must match the ID used when the job was originally added.
    //
    // If the queue has not been initialized yet, the Proxy creates
    // its Queue instance before returning it.
    const job = await queues[queueKey].getJob(jobId);

    // Check whether the requested job actually exists.
    //
    // A job may not be found if it has already completed,
    // failed and been removed, or was never added successfully.
    if (job) {

      // Remove the retrieved job from the queue.
      //
      // This prevents the scheduled job from being processed later,
      // provided that BullMQ allows its current state to be removed.
      await job.remove();

      // Return true to indicate that the job was successfully removed.
      return true;
    }

  } catch {

    // Ignore removal errors.
    //
    // A job may already be running or may have been removed
    // before this function attempted to delete it.
    //
    // In such cases, the removal operation cannot be completed
    // through this function, so execution continues to the final return.
  }

  // Return false when:
  // - Redis is unavailable.
  // - The requested job does not exist.
  // - An error prevents the job from being removed.
  //
  // This gives the calling function a boolean result
  // without allowing removal-related errors to interrupt its flow.
  return false;
}