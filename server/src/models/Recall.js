import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const recallSchema = new db.Schema({
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  serviceId: { type: db.Schema.Types.ObjectId, ref: 'Service' },
  recallType: String,                      // DENTAL_CLEANING, DIABETES_REVIEW, ...
  dueDate: { type: Date, required: true, index: true },
  lastServiceDate: Date,
  status: { type: String, enum: ['DUE', 'NOTIFIED', 'BOOKED', 'DISMISSED'], default: 'DUE', index: true },
  notifiedAt: Date,
  bookedAppointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  sourceAppointmentId: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
}, { timestamps: true });

recallSchema.plugin(tenantScope);
// At most one open recall per patient per service — no duplicate nudges.
recallSchema.index(
  { clinicId: 1, patientId: 1, serviceId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['DUE', 'NOTIFIED'] } } }
);
export const Recall = db.model('Recall', recallSchema);
