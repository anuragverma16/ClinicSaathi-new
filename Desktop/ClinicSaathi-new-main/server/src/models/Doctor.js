import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const availabilityRuleSchema = new db.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  startTime: { type: String, required: true },  // "09:00"
  endTime: { type: String, required: true },    // "13:00"
}, { _id: false });

const doctorSchema = new db.Schema({
  name: { type: String, required: true },
  photoUrl: String,
  qualification: String,
  specialization: { type: String, index: true },
  registrationNumber: String,   // NMC/state council no. — required on prescriptions
  experienceYears: Number,
  consultationFee: { type: Number, default: 0 },
  slotDurationMins: { type: Number, default: 15 },
  availability: [availabilityRuleSchema],
  breaks: [{ dayOfWeek: Number, startTime: String, endTime: String }],
  leaves: [{ from: Date, to: Date, reason: String }],
  serviceIds: [{ type: db.Schema.Types.ObjectId, ref: 'Service' }],
  supportsOnline: { type: Boolean, default: false },
  // Queue token letter (A, B, ... AA). Assigned once so two doctors never share one.
  tokenPrefix: String,
  userId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

doctorSchema.plugin(tenantScope);
export const Doctor = db.model('Doctor', doctorSchema);
