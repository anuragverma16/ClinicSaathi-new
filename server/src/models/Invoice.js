import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const lineItemSchema = new db.Schema({
  description: { type: String, required: true },
  serviceId: { type: db.Schema.Types.ObjectId, ref: 'Service' },
  quantity: { type: Number, default: 1 },
  unitPrice: { type: Number, required: true },
  gstPercent: { type: Number, default: 0 },
  amount: Number,
}, { _id: false });

const invoiceSchema = new db.Schema({
  invoiceNumber: { type: String, required: true },   // uniqueness enforced by the compound index below
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor' },
  appointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  lineItems: [lineItemSchema],
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  gstAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  refundedAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED', 'VOID'], default: 'UNPAID', index: true },
  dueDate: Date,
  notes: String,
  gstin: String,          // clinic GSTIN snapshot at issue time
  pdfUrl: String,
  createdByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

invoiceSchema.plugin(tenantScope);
invoiceSchema.index({ clinicId: 1, invoiceNumber: 1 }, { unique: true });
export const Invoice = db.model('Invoice', invoiceSchema);
