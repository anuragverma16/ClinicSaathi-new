import crypto from 'node:crypto';
import { OtpCode } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { sha256 } from '../utils/tokens.js';
import { sendSms } from '../integrations/sms.js';
import { sendWhatsApp } from '../integrations/whatsapp.js';
import { env } from '../config/env.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 30 * 1000;
const MAX_PER_HOUR = 5;

export const normalisePhone = (p) => String(p || '').replace(/[^\d+]/g, '');

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

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await OtpCode.create({
    clinicId, phone, purpose,
    codeHash: sha256(`${phone}:${purpose}:${code}`),
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  const body = `${code} is your ${clinicName} verification code. It expires in 5 minutes. Do not share it.`;
  // OTPs go by WhatsApp (authentication template) when configured, SMS otherwise.
  if (env.whatsapp.enabled) {
    await sendWhatsApp({ to: phone, templateName: 'otp_code', variables: { code } });
  } else {
    await sendSms({ to: phone, body });
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
