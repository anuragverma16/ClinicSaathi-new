import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const consultationSchema = new db.Schema({
  appointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  symptoms: String,
  vitals: {
    heightCm: Number, weightKg: Number, bpSystolic: Number, bpDiastolic: Number,
    pulse: Number, tempC: Number, spo2: Number, bloodSugar: Number,
  },
  diagnosis: String,
  clinicalNotes: String,
  treatmentPlan: String,
  followUpDate: Date,
  followUpInstructions: String,
  status: { type: String, enum: ['DRAFT', 'IN_PROGRESS', 'COMPLETED'], default: 'DRAFT', index: true },
  completedAt: Date,
  // Clinical records are append-only in spirit: keep an edit trail
  revisions: [{ at: Date, byUserId: db.Schema.Types.ObjectId, summary: String }],
  // Completed notes are never edited; corrections are appended as addenda.
  addenda: [{ at: { type: Date, default: Date.now }, byUserId: db.Schema.Types.ObjectId, text: String }],
}, { timestamps: true });

consultationSchema.plugin(tenantScope);
// One consultation per appointment.
consultationSchema.index({ clinicId: 1, appointmentId: 1 }, { unique: true });
export const Consultation = db.model('Consultation', consultationSchema);
