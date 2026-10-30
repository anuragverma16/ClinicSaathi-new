import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';
import { LAB_STATUS } from '../config/constants.js';

const resultSchema = new db.Schema({
  test: { type: String, required: true },
  value: String,
  unit: String,
  referenceRange: String,
  flag: { type: String, enum: ['NORMAL', 'LOW', 'HIGH', 'CRITICAL', ''], default: '' },
}, { _id: false });

/**
 * A doctor orders tests; a technician collects, processes and submits results;
 * the ordering doctor verifies. Only VERIFIED results reach the patient.
 * Technicians record values — they never interpret or diagnose.
 */
const labOrderSchema = new db.Schema({
  orderNumber: { type: String, required: true },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  appointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  consultationId: { type: db.Schema.Types.ObjectId, ref: 'Consultation' },
  tests: [{ name: { type: String, required: true }, code: String, _id: false }],
  priority: { type: String, enum: ['ROUTINE', 'URGENT'], default: 'ROUTINE' },
  clinicalNotes: String,      // doctor → lab, e.g. "fasting sample"
  status: { type: String, enum: Object.values(LAB_STATUS), default: LAB_STATUS.ORDERED, index: true },
  results: [resultSchema],
  technicianNotes: String,
  report: {
    storageKey: String,
    fileName: String,
    mimeType: String,
    size: Number,
  },
  orderedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  assignedToUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  collectedAt: Date,
  processingAt: Date,
  submittedAt: Date,
  submittedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date,
  verifiedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  doctorRemarks: String,
  cancelledReason: String,
}, { timestamps: true });

labOrderSchema.plugin(tenantScope);
labOrderSchema.index({ clinicId: 1, orderNumber: 1 }, { unique: true });
labOrderSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

export const LabOrder = db.model('LabOrder', labOrderSchema);
