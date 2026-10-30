import { Queue } from 'bullmq';
import { getRedis, isRedisReady } from '../config/redis.js';
import { JobEvent } from '../models/index.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

const NAMES = {
  appointmentReminder: 'appointmentReminderQueue',
  followUp: 'followUpQueue',
  recall: 'recallQueue',
  review: 'reviewQueue',
  paymentReminder: 'paymentReminderQueue',
  campaign: 'campaignQueue',
  birthday: 'birthdayQueue',
  medicineReminder: 'medicineReminderQueue',
  notification: 'notificationQueue',
};

// Queues are created lazily so importing this module never opens a Redis
// connection (tests and scripts that don't schedule jobs stay offline).
const instances = {};
export const queues = new Proxy({}, {
  get(_t, key) {
    if (!NAMES[key]) return undefined;
    instances[key] ||= new Queue(NAMES[key], { connection: getRedis(), defaultJobOptions });
    return instances[key];
  },
});

export const QUEUE_NAMES = NAMES;

/**
 * Enqueue without ever hanging an HTTP request. If Redis isn't connected the
 * job is not silently dropped: the failure is written to JobEvent, which
 * System Health surfaces to the platform team.
 */
export async function enqueue(queueKey, name, data, opts = {}) {
  getRedis();
  if (!isRedisReady()) {
    await JobEvent.create({
      queue: NAMES[queueKey], jobName: name, jobId: opts.jobId, clinicId: data?.clinicId,
      status: 'ENQUEUE_FAILED', error: 'Redis not connected',
    }).catch(() => {});
    return null;
  }
  try {
    return await queues[queueKey].add(name, data, opts);
  } catch (e) {
    await JobEvent.create({
      queue: NAMES[queueKey], jobName: name, jobId: opts.jobId, clinicId: data?.clinicId,
      status: 'ENQUEUE_FAILED', error: e.message,
    }).catch(() => {});
    return null;
  }
}

/** Remove a scheduled job by its deterministic id. No-op when Redis is down. */
export async function removeJob(queueKey, jobId) {
  if (!isRedisReady()) return false;
  try {
    const job = await queues[queueKey].getJob(jobId);
    if (job) { await job.remove(); return true; }
  } catch { /* already running or gone */ }
  return false;
}
