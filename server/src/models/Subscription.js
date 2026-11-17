import db from '../db/index.js';

const subscriptionSchema = new db.Schema({
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', required: true, unique: true },
  plan: { type: String, enum: ['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'], default: 'STARTER' },
  status: { type: String, enum: ['TRIALING', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED'], default: 'TRIALING' },
  trialEndsAt: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  // Metered usage against the flat monthly price. Enforce these or a busy PRO
  // clinic can cost more in WhatsApp + AI spend than it pays.
  usage: {
    periodKey: String,          // "2026-09"
    whatsappMessages: { type: Number, default: 0 },
    whatsappIncluded: { type: Number, default: 1000 },
    aiTokens: { type: Number, default: 0 },
    aiTokensIncluded: { type: Number, default: 500000 },
  },
  overagePolicy: { type: String, enum: ['BLOCK', 'BILL', 'WARN'], default: 'WARN' },
}, { timestamps: true });

export const Subscription = db.model('Subscription', subscriptionSchema);
