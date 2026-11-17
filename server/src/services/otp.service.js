import crypto from 'node:crypto';
import { OtpCode, User } from '../models/index.js';
import { ROLES } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { sha256 } from '../utils/tokens.js';
import { sendWhatsApp, whatsappReady } from '../integrations/whatsapp.js';
import { env } from '../config/env.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 30 * 1000;
const MAX_PER_HOUR = 5;

export const normalisePhone = (p) => String(p || '').replace(/[^\d+]/g, '');

/**
 * Every shape an Indian mobile number may have been saved in: reception saves
 * "9876543210", the patient portal sends "+919876543210". Matching all of them
 * means a registered patient is recognised whichever form their record uses.
 */
export function phoneVariants(p) {
  const last10 = String(p || '').replace(/\D/g, '').slice(-10);
  if (last10.length !== 10) return [normalisePhone(p)];
  return [`+91${last10}`, `91${last10}`, last10];
}

/** True when a clinic staff or admin login uses this number. Those numbers never get patient access. */
export async function isStaffNumber(phone) {
  return Boolean(await User.exists({ phone: { $in: phoneVariants(phone) }, role: { $ne: ROLES.PATIENT } }));
}

/** Issues a 6-digit code and delivers it. Returns nothing about the code itself. */
export async function issueOtp({ clinicId, clinicName, phone, purpose }) {
  const recent = await OtpCode.find({ clinicId, phone, purpose, createdAt: { $gte: new Date(Date.now() - 3600_000) } })
    .sort({ createdAt: -1 }).lean();
  if (recent[0] && recent[0].createdAt > new Date(Date.now() - RESEND_GAP_MS)) {
    throw new ApiError(429, 'Please wait 30 seconds before requesting another code', 'OTP_TOO_SOON');
  }
  if (recent.length >= MAX_PER_HOUR) {
    throw new ApiError(429, 'Too many codes requested. Try again in an hour.', 'OTP_RATE_LIMITED');
  }

  // Without a WhatsApp sender the stub would print the code and report success,
  // so the patient would wait for a message that never comes. Fail loudly instead.
  if (!whatsappReady() && env.nodeEnv !== 'test') {
    console.error(`OTP not sent: WhatsApp provider "${env.whatsapp.provider}" is not configured.`);
    throw new ApiError(503, 'Login codes are not available right now. Please contact the clinic.', 'OTP_NOT_CONFIGURED');
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const otp = await OtpCode.create({
    clinicId, phone, purpose,
    codeHash: sha256(`${phone}:${purpose}:${code}`),
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  // Codes go out only on WhatsApp, through an approved Authentication template.
  try {
    await sendWhatsApp({
      to: phone,
      // Meta sends the approved template; Nexsahay sends this plain text.
      templateName: env.whatsapp.otpTemplate,
      languageCode: env.whatsapp.otpLanguage,
      variables: { code },
      body: `${code} is your ${clinicName || 'clinic'} verification code. It expires in 5 minutes. Do not share it.`,
    });
  } catch (e) {
    // Nothing reached the patient, so the code must not stay valid or block a retry.
    await OtpCode.deleteOne({ _id: otp._id }).setOptions({ clinicId });
    console.error('OTP WhatsApp send failed:', e.message);
    throw new ApiError(502, 'We could not send the code on WhatsApp. Please try again.', 'OTP_SEND_FAILED');
  }
}

/** Consumes a valid code or throws. Wrong codes count against the attempt cap. */
export async function verifyOtp({ clinicId, phone, purpose, code }) {
  const otp = await OtpCode.findOne({
    clinicId, phone, purpose, consumedAt: null, expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  if (!otp) throw ApiError.badRequest('That code has expired. Request a new one.', 'OTP_EXPIRED');
  if (otp.attempts >= MAX_ATTEMPTS) throw ApiError.badRequest('Too many wrong attempts. Request a new code.', 'OTP_LOCKED');

  const ok = otp.codeHash === sha256(`${phone}:${purpose}:${String(code).trim()}`);
  if (!ok) {
    await OtpCode.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw ApiError.badRequest('That code is not correct', 'OTP_INVALID');
  }
  // Atomic consume so the same code can't be used twice in parallel.
  const consumed = await OtpCode.findOneAndUpdate(
    { _id: otp._id, consumedAt: null }, { consumedAt: new Date() }, { new: true }
  );
  if (!consumed) throw ApiError.badRequest('That code was already used', 'OTP_USED');
  return true;
}
