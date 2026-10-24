import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const medicalCertificateSchema = new db.Schema({
  certificateNumber: { type: String, required: true },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  consultationId: { type: db.Schema.Types.ObjectId, ref: 'Consultation' },
  type: { type: String, enum: ['SICK_LEAVE', 'FITNESS', 'GENERAL'], required: true },
  fromDate: Date,
  toDate: Date,
  remarks: String,
  status: { type: String, enum: ['DRAFT', 'ISSUED', 'REVOKED'], default: 'DRAFT', index: true },
  issuedAt: Date,
  signature: { doctorName: String, registrationNumber: String, signedAt: Date },
  revokedReason: String,
}, { timestamps: true });

medicalCertificateSchema.plugin(tenantScope);
medicalCertificateSchema.index({ clinicId: 1, certificateNumber: 1 }, { unique: true });
export const MedicalCertificate = db.model('MedicalCertificate', medicalCertificateSchema);
