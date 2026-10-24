import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const followUpSchema = new db.Schema({
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor' },
  consultationId: { type: db.Schema.Types.ObjectId, ref: 'Consultation' },
  dueDate: { type: Date, required: true, index: true },
  reason: String,
  // Doctor-approved wording. The only clinical content a follow-up message may carry.
  instructions: String,
  status: { type: String, enum: ['SCHEDULED', 'SENT', 'RESPONDED', 'BOOKED', 'ESCALATED', 'CLOSED'], default: 'SCHEDULED', index: true },
  patientResponse: String,
  // AI classifies the reply; it never diagnoses or decides clinically.
  aiClassification: { type: String, enum: ['POSITIVE', 'NEUTRAL', 'CONCERN', 'URGENT'] },
  escalatedToUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  reviewedByDoctorAt: Date,
  bookedAppointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  jobId: String,
}, { timestamps: true });

followUpSchema.plugin(tenantScope);
export const FollowUp = db.model('FollowUp', followUpSchema);
