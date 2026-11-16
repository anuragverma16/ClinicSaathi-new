import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const communicationSchema = new db.Schema({
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', index: true },
  channel: { type: String, enum: ['WHATSAPP', 'SMS', 'EMAIL'], required: true },
  event: { type: String, required: true, index: true },  // APPOINTMENT_CONFIRMED, REMINDER_24H, ...
  direction: { type: String, enum: ['OUTBOUND', 'INBOUND'], default: 'OUTBOUND' },
  to: String,
  templateName: String,     // WhatsApp requires a pre-approved template outside the 24h window
  payload: db.Schema.Types.Mixed,
  body: String,
  status: { type: String, enum: ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'], default: 'PENDING', index: true },
  providerMessageId: { type: String, index: true },
  campaignId: { type: db.Schema.Types.ObjectId, ref: 'Campaign', index: true },
  error: String,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  costPaise: Number,        // for per-clinic usage metering
}, { timestamps: true });

communicationSchema.plugin(tenantScope);
communicationSchema.index({ clinicId: 1, createdAt: -1 });
export const Communication = db.model('Communication', communicationSchema);
