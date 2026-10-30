import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { env } from '../../config/env.js';

const router = Router();

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

export default router;
