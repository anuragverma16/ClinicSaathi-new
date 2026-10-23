import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const medicineSchema = new db.Schema({
  name: { type: String, required: true },
  dosage: String,        // "500mg"
  frequency: String,     // "1-0-1"
  durationDays: Number,
  timing: { type: String, enum: ['BEFORE_FOOD', 'AFTER_FOOD', 'ANY'], default: 'ANY' },
  instructions: String,
}, { _id: false });

const prescriptionSchema = new db.Schema({
  consultationId: { type: db.Schema.Types.ObjectId, ref: 'Consultation', index: true },
  appointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  rxNumber: { type: String, index: true },
  medicines: [medicineSchema],
  advice: String,
  // DRAFT can be edited by the prescribing doctor. FINAL is signed, immutable
  // and the only state a patient ever sees.
  status: { type: String, enum: ['DRAFT', 'FINAL'], default: 'DRAFT', index: true },
  finalizedAt: Date,
  // A prescription is a legal document. Record who signed it and with what credential.
  signature: {
    doctorName: String,
    registrationNumber: String,
    signedAt: Date,
    signatureImageUrl: String,
  },
  pdfUrl: String,
  sentToPatientAt: Date,
}, { timestamps: true });

prescriptionSchema.plugin(tenantScope);
export const Prescription = db.model('Prescription', prescriptionSchema);
