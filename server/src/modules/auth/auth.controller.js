import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { User, Clinic, Subscription, Patient, Doctor } from '../../models/index.js';
import {
  signAccessToken, signRefreshToken, verifyRefresh, sha256, safeEqualHex, randomToken,
} from '../../utils/tokens.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ApiError } from '../../utils/ApiError.js';
import { ok, created } from '../../utils/respond.js';
import { ROLES } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { recordAudit } from '../../middleware/audit.js';
import { getEntitlements } from '../../services/plans.service.js';
import { issueOtp, verifyOtp, normalisePhone, phoneVariants } from '../../services/otp.service.js';
import { sendEmail } from '../../integrations/email.js';
import { cloudinaryEnabled, uploadAvatarImage, deleteAvatarImage } from '../../integrations/cloudinary.js';

const password = z.string().min(8, 'Use at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number');

// `email` is accepted for older clients; `identifier` may be an email or phone.
export const loginSchema = z.object({
  identifier: z.string().trim().min(3).optional(),
  email: z.string().trim().optional(),
  password: z.string().min(1).max(128),
}).refine((d) => d.identifier || d.email, { message: 'Enter your email or phone number' });

export const forgotSchema = z.object({ email: z.string().trim().email() });
export const resetSchema = z.object({ uid: z.string().min(1), token: z.string().min(20), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const otpRequestSchema = z.object({ clinicSlug: z.string().min(1), phone: z.string().min(10).max(15) });
export const otpVerifySchema = otpRequestSchema.extend({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const patientRegisterSchema = z.object({
  registrationToken: z.string().min(10),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().optional().or(z.literal('')),
  consentGiven: z.literal(true, { errorMap: () => ({ message: 'Please accept the privacy notice' }) }),
});

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

// The refresh token lives in an httpOnly cookie, so page scripts never see it.
// Its path is limited to /api/auth, so it is only sent to the auth endpoints.
const REFRESH_COOKIE = 'cs_refresh';
const refreshCookieBase = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'lax',
  path: '/api/auth',
});
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE, refreshCookieBase());

/**
 * Issue a session: pin the refresh token's hash to the user, set it as a cookie,
 * and return only the short-lived access token for the response body.
 */
async function issueSession(user, res) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await User.updateOne({ _id: user._id }, { refreshTokenHash: sha256(refreshToken), lastLoginAt: new Date() });
  const { exp } = jwt.decode(refreshToken);
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshCookieBase(), expires: new Date(exp * 1000) });
  return { accessToken };
}

export const login = catchAsync(async (req, res) => {
  const identifier = (req.body.identifier || req.body.email).trim();
  const isEmail = identifier.includes('@');
  const query = isEmail ? { email: identifier.toLowerCase() } : { phone: normalisePhone(identifier) };
  // Patients sign in with a one-time code, so they never match a password login.
  const candidates = await User.find({ ...query, role: { $ne: ROLES.PATIENT } })
    .select('+passwordHash +failedLogins +lockedUntil').limit(5);

  const invalid = () => ApiError.unauthorized('Email/phone or password is incorrect', 'INVALID_CREDENTIALS');
  if (!candidates.length) throw invalid();

  let user = null;
  for (const c of candidates) {
    if (c.lockedUntil && c.lockedUntil > new Date()) continue;
    if (await c.verifyPassword(req.body.password)) { user = c; break; }
  }

  if (!user) {
    // Count the failure against every matching account and lock after repeated misses.
    await Promise.all(candidates.map(async (c) => {
      const failed = (c.failedLogins || 0) + 1;
      await User.updateOne({ _id: c._id }, failed >= LOCK_AFTER
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLogins: failed });
    }));
    if (candidates.every((c) => c.lockedUntil && c.lockedUntil > new Date())) {
      throw new ApiError(423, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`, 'ACCOUNT_LOCKED');
    }
    throw invalid();
  }

  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated. Contact your clinic admin.', 'ACCOUNT_INACTIVE');
  if (user.role !== ROLES.SUPER_ADMIN) {
    const clinic = await Clinic.findById(user.clinicId).select('isActive').lean();
    if (!clinic?.isActive) throw ApiError.forbidden('This clinic account is suspended. Contact ClinicSaathi support.', 'CLINIC_SUSPENDED');
  }
  await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null });

  req.tenant = { clinicId: user.clinicId };
  req.user = user;
  recordAudit(req, { action: 'USER_LOGIN', entityType: 'User', entityId: user._id });

  ok(res, { user: user.toSafeJSON(), ...(await issueSession(user, res)) });
});

/**
 * Rotating refresh, read from the cookie. The presented token must match the
 * hash pinned at the last issue; a mismatch means an old token was replayed,
 * so the session is revoked outright.
 */
export const refresh = catchAsync(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw ApiError.unauthorized('No active session', 'NO_SESSION');
  let payload;
  try { payload = verifyRefresh(presented); }
  catch { clearRefreshCookie(res); throw ApiError.unauthorized('Session expired. Sign in again.', 'REFRESH_EXPIRED'); }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.isActive) { clearRefreshCookie(res); throw ApiError.unauthorized('Session expired. Sign in again.', 'REFRESH_EXPIRED'); }
  if (!safeEqualHex(user.refreshTokenHash, sha256(presented))) {
    await User.updateOne({ _id: user._id }, { $unset: { refreshTokenHash: 1 } });
    clearRefreshCookie(res);
    throw ApiError.unauthorized('Session expired. Sign in again.', 'REFRESH_REUSED');
  }
  ok(res, await issueSession(user, res));
});

/**
 * Ends the session behind the refresh cookie. Works even when the access token
 * has already expired, so a stale tab can still sign out cleanly.
 */
export const logout = catchAsync(async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  let payload = null;
  try { payload = presented ? verifyRefresh(presented) : null; } catch { /* expired: nothing left to revoke */ }

  if (payload) {
    const user = await User.findOneAndUpdate(
      { _id: payload.sub, refreshTokenHash: sha256(presented) },
      { $unset: { refreshTokenHash: 1 } },
    ).select('clinicId role');
    if (user) {
      req.user = user; req.tenant = { clinicId: user.clinicId };
      recordAudit(req, { action: 'USER_LOGOUT', entityType: 'User', entityId: user._id });
    }
  }
  clearRefreshCookie(res);
  ok(res, { loggedOut: true });
});

/** Always answers the same way so it can't be used to discover accounts. */
export const forgotPassword = catchAsync(async (req, res) => {
  const users = await User.find({ email: req.body.email.toLowerCase(), role: { $ne: ROLES.PATIENT }, isActive: true }).limit(5);
  for (const user of users) {
    const token = randomToken(32);
    await User.updateOne({ _id: user._id }, {
      'passwordReset.tokenHash': sha256(token),
      'passwordReset.expiresAt': new Date(Date.now() + 30 * 60_000),
    });
    const link = `${env.clientUrl}/reset-password?uid=${user._id}&token=${token}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset your ClinicSaathi password',
      body: `Hi ${user.name},\n\nUse this link within 30 minutes to set a new password:\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    }).catch((e) => console.error('Reset email failed:', e.message));
  }
  ok(res, { message: 'If that email belongs to an account, a reset link is on its way.' });
});

export const resetPassword = catchAsync(async (req, res) => {
  const user = await User.findById(req.body.uid).select('+passwordReset.tokenHash +passwordReset.expiresAt').catch(() => null);
  const valid = user?.passwordReset?.tokenHash
    && user.passwordReset.expiresAt > new Date()
    && safeEqualHex(user.passwordReset.tokenHash, sha256(req.body.token));
  if (!valid) throw ApiError.badRequest('This reset link is invalid or has expired', 'RESET_INVALID');

  await user.setPassword(req.body.password);
  user.passwordReset = undefined;
  user.refreshTokenHash = undefined;    // sign out every other session
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  req.user = user; req.tenant = { clinicId: user.clinicId };
  recordAudit(req, { action: 'PASSWORD_RESET', entityType: 'User', entityId: user._id });
  ok(res, { message: 'Password updated. Sign in with your new password.' });
});

export const changePassword = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.verifyPassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Your current password is not correct', 'WRONG_PASSWORD');
  }
  await user.setPassword(req.body.newPassword);
  await user.save();
  recordAudit(req, { action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user._id });
  ok(res, await issueSession(user, res));
});

// ------------------------------------------------------------ Profile photo

/** Every login except the platform super admin has a profile photo. */
function assertHasProfilePhoto(user) {
  if (user.role === ROLES.SUPER_ADMIN) throw ApiError.forbidden('Platform admin accounts have no profile photo');
}

export const uploadAvatar = catchAsync(async (req, res) => {
  assertHasProfilePhoto(req.user);
  if (!req.file) throw ApiError.badRequest('Choose a photo to upload', 'NO_FILE');
  if (!cloudinaryEnabled) throw new ApiError(503, 'Photo uploads are not set up on this server yet', 'UPLOAD_NOT_CONFIGURED');

  // One public id per user, so a new upload overwrites the old image in place.
  const image = await uploadAvatarImage(req.file.buffer, `user_${req.user._id}`);
  const user = await User.findByIdAndUpdate(req.user._id, { avatarUrl: image.secure_url, avatarPublicId: image.public_id }, { new: true });
  recordAudit(req, { action: 'AVATAR_UPDATED', entityType: 'User', entityId: user._id });
  ok(res, user.toSafeJSON());
});

export const removeAvatar = catchAsync(async (req, res) => {
  assertHasProfilePhoto(req.user);
  const current = await User.findById(req.user._id).select('+avatarPublicId');
  await deleteAvatarImage(current?.avatarPublicId);
  const user = await User.findByIdAndUpdate(req.user._id, { $unset: { avatarUrl: 1, avatarPublicId: 1 } }, { new: true });
  recordAudit(req, { action: 'AVATAR_REMOVED', entityType: 'User', entityId: user._id });
  ok(res, user.toSafeJSON());
});

// ------------------------------------------------------------ Patient OTP

async function clinicBySlug(slug) {
  const clinic = await Clinic.findOne({ slug: String(slug).toLowerCase(), isActive: true });
  if (!clinic) throw ApiError.notFound('Clinic not found', 'CLINIC_NOT_FOUND');
  return clinic;
}

/** A number that signs in as clinic staff or admin is reserved and never gets a patient code. */
async function assertNotStaffNumber(phone) {
  const staff = await User.exists({ phone: { $in: phoneVariants(phone) }, role: { $ne: ROLES.PATIENT } });
  if (staff) throw new ApiError(403, 'This mobile number is reserved and cannot be used for patient login.', 'STAFF_NUMBER');
}

/**
 * A code is sent only to a number already registered as a patient at this clinic.
 * Unknown numbers get no code and are told to register at the clinic first.
 */
export const patientRequestOtp = catchAsync(async (req, res) => {
  const clinic = await clinicBySlug(req.body.clinicSlug);
  const phone = normalisePhone(req.body.phone);
  await assertNotStaffNumber(phone);
  const registered = await Patient.findOne({ phone: { $in: phoneVariants(phone) }, guardianPatientId: { $exists: false } })
    .setOptions({ clinicId: clinic._id })
    .select('_id');
  if (!registered) {
    throw new ApiError(404, 'This mobile number is not registered with this clinic. Please register at the clinic first.', 'NOT_REGISTERED');
  }
  await issueOtp({ clinicId: clinic._id, clinicName: clinic.name, phone, purpose: 'PATIENT_LOGIN' });
  ok(res, { message: 'We sent a 6-digit code to that number.' });
});

async function patientUserFor(clinic, patient) {
  let user = await User.findOne({ clinicId: clinic._id, role: ROLES.PATIENT, patientId: patient._id });
  if (!user) {
    user = await User.create({
      name: patient.name, phone: patient.phone, email: patient.email || undefined,
      role: ROLES.PATIENT, clinicId: clinic._id, patientId: patient._id,
    }).catch(async (e) => {
      // Email may already belong to a staff account in this clinic; keep the patient login without it.
      if (e.code === 11000) {
        return User.create({ name: patient.name, phone: patient.phone, role: ROLES.PATIENT, clinicId: clinic._id, patientId: patient._id });
      }
      throw e;
    });
    await Patient.updateOne({ _id: patient._id }, { userId: user._id }).setOptions({ clinicId: clinic._id });
  }
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated. Contact the clinic.', 'ACCOUNT_INACTIVE');
  return user;
}

export const patientVerifyOtp = catchAsync(async (req, res) => {
  const clinic = await clinicBySlug(req.body.clinicSlug);
  const phone = normalisePhone(req.body.phone);
  await assertNotStaffNumber(phone);
  await verifyOtp({ clinicId: clinic._id, phone, purpose: 'PATIENT_LOGIN', code: req.body.code });

  const patient = await Patient.findOne({ phone: { $in: phoneVariants(phone) }, guardianPatientId: { $exists: false } })
    .setOptions({ clinicId: clinic._id });
  if (!patient) {
    // Phone proven; we still need a name and consent before creating a record.
    const registrationToken = jwt.sign({ phone, clinicId: String(clinic._id), purpose: 'patient-register' },
      env.jwt.accessSecret, { expiresIn: '15m' });
    return ok(res, { needsRegistration: true, registrationToken });
  }

  const user = await patientUserFor(clinic, patient);
  req.user = user; req.tenant = { clinicId: clinic._id };
  recordAudit(req, { action: 'PATIENT_LOGIN', entityType: 'User', entityId: user._id });
  ok(res, { user: user.toSafeJSON(), ...(await issueSession(user, res)) });
});

export const patientRegister = catchAsync(async (req, res) => {
  let claims;
  try { claims = jwt.verify(req.body.registrationToken, env.jwt.accessSecret); }
  catch { throw ApiError.badRequest('Verification expired. Request a new code.', 'REGISTRATION_EXPIRED'); }
  if (claims.purpose !== 'patient-register') throw ApiError.badRequest('Invalid registration token');

  const clinic = await Clinic.findById(claims.clinicId);
  if (!clinic?.isActive) throw ApiError.notFound('Clinic not found');
  const clinicId = clinic._id;

  // Re-check the record: the patient may have been saved since the code was sent.
  let patient = await Patient.findOne({ phone: { $in: phoneVariants(claims.phone) }, guardianPatientId: { $exists: false } })
    .setOptions({ clinicId });
  if (!patient) {
    patient = await Patient.create({
      clinicId, name: req.body.name, phone: claims.phone, email: req.body.email || undefined,
      consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' }, marketing: { granted: false } },
    });
  }
  const user = await patientUserFor(clinic, patient);
  req.user = user; req.tenant = { clinicId };
  recordAudit(req, { action: 'PATIENT_REGISTERED', entityType: 'Patient', entityId: patient._id });
  created(res, { user: user.toSafeJSON(), ...(await issueSession(user, res)) });
});

// -------------------------------------------------------------------- Me

const HOME_FOR_ROLE = {
  SUPER_ADMIN: '/super-admin/dashboard',
  CLINIC_OWNER: '/clinic/dashboard',
  BRANCH_MANAGER: '/clinic/branch/dashboard',
  DOCTOR: '/clinic/doctor/dashboard',
  RECEPTIONIST: '/clinic/reception/dashboard',
  ACCOUNTANT: '/clinic/accounts/dashboard',
  LAB_TECHNICIAN: '/clinic/lab/dashboard',
  PATIENT: '/patient/dashboard',
};

export const me = catchAsync(async (req, res) => {
  const u = req.user;
  const clinicId = u.clinicId;
  const [clinic, subscription, entitlements, doctor, patient] = await Promise.all([
    clinicId ? Clinic.findById(clinicId).select('name slug logoUrl phone email address timings bookingPolicy onboarding isActive').lean() : null,
    clinicId && u.role !== ROLES.PATIENT ? Subscription.findOne({ clinicId }).select('plan status trialEndsAt currentPeriodEnd').lean() : null,
    clinicId ? getEntitlements(clinicId) : null,
    u.doctorId ? Doctor.findOne({ _id: u.doctorId }).setOptions({ clinicId }).select('name specialization registrationNumber').lean() : null,
    u.patientId ? Patient.findOne({ _id: u.patientId }).setOptions({ clinicId }).select('name phone email').lean() : null,
  ]);
  ok(res, {
    user: u.toSafeJSON(),
    clinic,
    subscription,
    entitlements: entitlements && { plan: entitlements.plan, live: entitlements.live, features: entitlements.features, limits: entitlements.limits },
    doctor,
    patient,
    homePath: HOME_FOR_ROLE[u.role],
  });
});
