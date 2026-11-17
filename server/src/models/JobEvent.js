import db from '../db/index.js';

/**
 * Background job outcomes the platform needs to see: enqueue failures (Redis
 * down) and worker failures after retries. Feeds System Health. Kept 30 days.
 */
const jobEventSchema = new db.Schema({
  queue: { type: String, required: true, index: true },
  jobName: String,
  jobId: String,
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', index: true },
  status: { type: String, enum: ['ENQUEUE_FAILED', 'FAILED', 'COMPLETED'], required: true, index: true },
  error: String,
  attemptsMade: Number,
}, { timestamps: { createdAt: true, updatedAt: false } });

jobEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
export const JobEvent = db.model('JobEvent', jobEventSchema);
