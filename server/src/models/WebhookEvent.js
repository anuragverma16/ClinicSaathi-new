import db from '../db/index.js';

/**
 * Gateways retry webhooks. Recording each event id under a unique index means
 * a redelivered event is detected by the database, not by a racy lookup.
 */
const webhookEventSchema = new db.Schema({
  provider: { type: String, enum: ['RAZORPAY', 'WHATSAPP'], required: true },
  eventId: { type: String, required: true },
  eventType: String,
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic' },
  processedAt: Date,
  error: String,
}, { timestamps: true });

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const WebhookEvent = db.model('WebhookEvent', webhookEventSchema);
