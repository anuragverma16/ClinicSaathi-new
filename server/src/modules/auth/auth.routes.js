import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import * as ctrl from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

const router = Router();

// Profile photos are small: a 2 MB cap and only web image formats.
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  // multer drops a file unless the callback says true, so accept it explicitly.
  fileFilter: (_req, file, cb) => (AVATAR_TYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(ApiError.badRequest('Upload a JPG, PNG or WebP image', 'UNSUPPORTED_IMAGE'))),
});

// Brute-force guards on the credential endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 * env.rateLimitMultiplier, standardHeaders: true });

// Every sign-in endpoint allows 5 requests per 15 minutes per IP. Each route gets
// its own counter, so a patient's OTP steps don't use up the staff login budget.
const SIGN_IN_WINDOW_MIN = 15;
const signInLimiter = (skip) => rateLimit({
  windowMs: SIGN_IN_WINDOW_MIN * 60 * 1000,
  max: 5 * env.rateLimitMultiplier,
  standardHeaders: true,
  skip,
  message: { success: false, message: `Too many sign-in attempts. Try again in ${SIGN_IN_WINDOW_MIN} minutes.`, code: 'RATE_LIMITED' },
});

// Super admin sign-in is not rate limited. The account still locks after repeated
// wrong passwords (see auth.controller.js).
const isSuperAdminLogin = (req) => String(req.body?.identifier || req.body?.email || '').trim().toLowerCase() === env.superAdmin.email;

// No public sign-up: clinics and their logins are provisioned by the super admin.
router.post('/login', signInLimiter(isSuperAdminLogin), validate(ctrl.loginSchema), ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.post('/forgot-password', authLimiter, validate(ctrl.forgotSchema), ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validate(ctrl.resetSchema), ctrl.resetPassword);
router.post('/change-password', authenticate, validate(ctrl.changePasswordSchema), ctrl.changePassword);

// Patient OTP routes have no route-level rate limit. The OTP service still caps
// codes per number (30 s gap, per-hour cap) and wrong attempts per code.
router.post('/patient/request-otp', validate(ctrl.otpRequestSchema), ctrl.patientRequestOtp);
router.post('/patient/verify-otp', validate(ctrl.otpVerifySchema), ctrl.patientVerifyOtp);
router.post('/patient/register', validate(ctrl.patientRegisterSchema), ctrl.patientRegister);

router.get('/me', authenticate, ctrl.me);
router.put('/me/avatar', authenticate, avatarUpload.single('photo'), ctrl.uploadAvatar);
router.delete('/me/avatar', authenticate, ctrl.removeAvatar);

export default router;
