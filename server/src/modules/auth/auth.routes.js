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

// Brute-force guards on the credential endpoints only.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 * env.rateLimitMultiplier, standardHeaders: true });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 * env.rateLimitMultiplier, standardHeaders: true });

// No public sign-up: clinics and their logins are provisioned by the super admin.
router.post('/login', authLimiter, validate(ctrl.loginSchema), ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', authenticate, ctrl.logout);
router.post('/forgot-password', authLimiter, validate(ctrl.forgotSchema), ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validate(ctrl.resetSchema), ctrl.resetPassword);
router.post('/change-password', authenticate, validate(ctrl.changePasswordSchema), ctrl.changePassword);

router.post('/patient/request-otp', otpLimiter, validate(ctrl.otpRequestSchema), ctrl.patientRequestOtp);
router.post('/patient/verify-otp', otpLimiter, validate(ctrl.otpVerifySchema), ctrl.patientVerifyOtp);
router.post('/patient/register', otpLimiter, validate(ctrl.patientRegisterSchema), ctrl.patientRegister);

router.get('/me', authenticate, ctrl.me);
router.put('/me/avatar', authenticate, avatarUpload.single('photo'), ctrl.uploadAvatar);
router.delete('/me/avatar', authenticate, ctrl.removeAvatar);

export default router;
