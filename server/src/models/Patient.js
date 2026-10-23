import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const patientSchema = new db.Schema({
  name: { type: String, required: true, index: true },
  phone: { type: String, required: true, index: true },
  email: { type: String, lowercase: true },
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
  dob: Date,
  bloodGroup: String,
  address: { line1: String, city: String, state: String, pincode: String },
  allergies: [String],
  chronicConditions: [String],
  notes: String,
  abhaNumber: String,           // ABDM health ID, if the clinic uses it
  consent: {
    // DPDP Act 2023 + Telemedicine Guidelines: record what was agreed and when
    dataProcessing: { granted: Boolean, grantedAt: Date, version: String },
    marketing: { granted: { type: Boolean, default: false }, grantedAt: Date },
  },
  // Channel preferences. optOutAll stops everything except the reply to a
  // message the patient sent first.
  communicationPrefs: {
    whatsapp: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    optOutAll: { type: Boolean, default: false },
    optedOutAt: Date,
  },
  // A dependent (child, elderly parent) is managed from the guardian's portal.
  // Dependents may share the guardian's phone, so they're keyed separately.
  guardianPatientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', index: true },
  relationToGuardian: String,
  firstVisitAt: Date,
  lastVisitAt: { type: Date, index: true },
  visitCount: { type: Number, default: 0 },
  userId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

patientSchema.plugin(tenantScope);
// One self-record per phone per clinic. Dependents share their guardian's
// number, so each carries its own dependentKey; self-records leave it null,
// which keeps (clinic, phone, null) unique exactly as before.
patientSchema.add({ dependentKey: { type: String, default: null } });
patientSchema.pre('validate', function setDependentKey() {
  if (this.guardianPatientId && !this.dependentKey) this.dependentKey = String(this._id);
});
patientSchema.index({ clinicId: 1, phone: 1, dependentKey: 1 }, { unique: true });
patientSchema.index({ clinicId: 1, name: 'text', phone: 'text' });

patientSchema.virtual('patientType').get(function () {
  if (!this.lastVisitAt) return 'NEW';
  const months = (Date.now() - this.lastVisitAt) / (1000 * 60 * 60 * 24 * 30);
  if (months > 6) return 'INACTIVE';
  return this.visitCount > 1 ? 'RETURNING' : 'NEW';
});

export const Patient = db.model('Patient', patientSchema);
