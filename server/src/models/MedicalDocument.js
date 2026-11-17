import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

/**
 * A file attached to a patient's record (previous reports, scans, referral
 * letters). The bytes live in private storage under `storageKey`; nothing
 * here is ever served from a public URL.
 */
const medicalDocumentSchema = new db.Schema({
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  title: { type: String, required: true },
  category: { type: String, enum: ['REPORT', 'SCAN', 'REFERRAL', 'DISCHARGE', 'OTHER'], default: 'OTHER' },
  storageKey: { type: String, required: true },
  fileName: String,
  mimeType: String,
  size: Number,
  // Only documents the doctor marks shareable appear in the patient portal.
  sharedWithPatient: { type: Boolean, default: false },
  uploadedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  lastAccessedAt: Date,
  accessCount: { type: Number, default: 0 },
}, { timestamps: true });

medicalDocumentSchema.plugin(tenantScope);
export const MedicalDocument = db.model('MedicalDocument', medicalDocumentSchema);
