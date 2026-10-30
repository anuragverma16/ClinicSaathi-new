import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const paymentSchema = new db.Schema({
  invoiceId: { type: db.Schema.Types.ObjectId, ref: 'Invoice', index: true },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient' },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['UPI', 'CARD', 'NETBANKING', 'CASH', 'WALLET', 'ONLINE'], required: true },
  gateway: { type: String, enum: ['RAZORPAY', 'STRIPE', 'OFFLINE'], default: 'OFFLINE' },
  gatewayOrderId: { type: String, index: true },
  gatewayPaymentId: { type: String, index: true },
  // Never set by the client. Only a verified webhook, a verified checkout
  // signature, or a staff-recorded desk payment flips this.
  status: {
    type: String,
    enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    default: 'CREATED',
    index: true,
  },
  failureReason: String,
  verifiedAt: Date,
  verifiedVia: { type: String, enum: ['WEBHOOK', 'CHECKOUT_SIGNATURE', 'STAFF'] },
  rawWebhookPayload: db.Schema.Types.Mixed,
  receiptNumber: String,
  reference: String,   // UTR / card slip for desk payments
  recordedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  refundedAmount: { type: Number, default: 0 },
  refunds: [{
    amount: Number,
    reason: String,
    gatewayRefundId: String,
    status: { type: String, enum: ['PENDING', 'PROCESSED', 'FAILED'], default: 'PENDING' },
    at: { type: Date, default: Date.now },
    byUserId: db.Schema.Types.ObjectId,
  }],
}, { timestamps: true });

paymentSchema.plugin(tenantScope);
paymentSchema.index(
  { clinicId: 1, receiptNumber: 1 },
  { unique: true, partialFilterExpression: { receiptNumber: { $type: 'string' } } }
);
export const Payment = db.model('Payment', paymentSchema);
