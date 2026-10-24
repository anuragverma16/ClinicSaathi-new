import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const queueTokenSchema = new db.Schema({
  appointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment', required: true },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  tokenNumber: { type: String, required: true },   // "A24"
  sequence: { type: Number, required: true },
  queueDate: { type: String, required: true, index: true },  // "2026-09-14"
  status: {
    type: String,
    enum: ['WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED'],
    default: 'WAITING',
    index: true,
  },
  priority: { type: Number, default: 0 },   // higher = called sooner (emergency)
  calledAt: Date,
  consultationStartedAt: Date,
  skippedAt: Date,
  completedAt: Date,
  checkedInAt: { type: Date, default: Date.now },
}, { timestamps: true });

queueTokenSchema.plugin(tenantScope);
queueTokenSchema.index({ clinicId: 1, doctorId: 1, queueDate: 1, sequence: 1 }, { unique: true });
// One token per appointment: a second check-in click can't mint a duplicate.
queueTokenSchema.index({ clinicId: 1, appointmentId: 1 }, { unique: true });

export const QueueToken = db.model('QueueToken', queueTokenSchema);
