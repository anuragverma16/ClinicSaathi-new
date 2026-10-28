import db from '../db/index.js';
import bcrypt from 'bcryptjs';
import { ROLES } from '../config/constants.js';

const userSchema = new db.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, index: true },
  // Patient accounts sign in by OTP and never set a password.
  passwordHash: { type: String, select: false },
  role: { type: String, enum: Object.values(ROLES), required: true },
  // SUPER_ADMIN has no clinic. Everyone else must have one.
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', index: true },
  branchId: { type: db.Schema.Types.ObjectId, ref: 'Branch', index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor' },
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient' },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  // Cloudinary profile photo. The public id is kept so a replaced or removed photo can be deleted.
  avatarUrl: String,
  avatarPublicId: { type: String, select: false },

  // Hash of the one refresh token currently valid for this user. Rotated on
  // every refresh and cleared on logout, so a stolen token stops working.
  refreshTokenHash: { type: String, select: false },
  passwordReset: {
    tokenHash: { type: String, select: false },
    expiresAt: { type: Date, select: false },
  },
  failedLogins: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, select: false },
  invitedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Partial, not sparse: a sparse compound index still indexes users that only
// have clinicId, so two email-less patient accounts in one clinic would collide.
userSchema.index({ email: 1, clinicId: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1, clinicId: 1 }, { sparse: true });

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};
userSchema.methods.verifyPassword = function (plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};
userSchema.methods.toSafeJSON = function () {
  const {
    passwordHash, refreshTokenHash, passwordReset, failedLogins, lockedUntil, __v, ...rest
  } = this.toObject();
  return rest;
};

export const User = db.model('User', userSchema);
