import db from '../db/index.js';
import { CAMPAIGN_KINDS } from '../config/constants.js';
import { tenantScope } from './plugins/tenantScope.js';

/**
 * An owner-approved bulk message. Only patients with marketing consent who
 * haven't opted out are ever messaged, and each patient is sent at most once
 * per campaign (deterministic job ids).
 */
const campaignSchema = new db.Schema({
  name: { type: String, required: true },
  kind: { type: String, enum: CAMPAIGN_KINDS, default: 'RECALL' },
  templateName: { type: String, required: true },
  messagePreview: String,
  audience: {
    lastVisitBeforeDays: Number,    // "haven't visited in N days"
    serviceId: { type: db.Schema.Types.ObjectId, ref: 'Service' },
    doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor' },
    gender: String,
    minAge: Number,
    maxAge: Number,
  },
  status: { type: String, enum: ['DRAFT', 'APPROVED', 'SENDING', 'SENT', 'CANCELLED'], default: 'DRAFT', index: true },
  approvedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  sentAt: Date,
  stats: {
    targeted: { type: Number, default: 0 },
    queued: { type: Number, default: 0 },
    excluded: { type: Number, default: 0 },
    booked: { type: Number, default: 0 },
  },
  createdByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

campaignSchema.plugin(tenantScope, { branchScoped: false });
export const Campaign = db.model('Campaign', campaignSchema);
