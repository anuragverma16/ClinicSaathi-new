import db from '../db/index.js';

/**
 * One-time codes for patient sign-in and phone verification at booking.
 * Only a hash is stored, attempts are capped, and the hourly purge (db.purgeExpired) deletes
 * the row shortly after it expires.
 */
const otpCodeSchema = new db.Schema({
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  phone: { type: String, required: true },
  purpose: { type: String, enum: ['PATIENT_LOGIN', 'BOOKING'], required: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

otpCodeSchema.index({ clinicId: 1, phone: 1, purpose: 1, createdAt: -1 });
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OtpCode = db.model('OtpCode', otpCodeSchema);
