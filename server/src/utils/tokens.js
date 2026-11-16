import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      clinicId: user.clinicId ? user.clinicId.toString() : null,
      branchId: user.branchId ? user.branchId.toString() : null,
      doctorId: user.doctorId ? user.doctorId.toString() : null,
      patientId: user.patientId ? user.patientId.toString() : null,
    },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessTtl }
  );
}

/** Each refresh token carries a random jti so its hash can be pinned to the user. */
export function signRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString(), jti: crypto.randomUUID() }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

export const verifyAccess = (t) => jwt.verify(t, env.jwt.accessSecret);
export const verifyRefresh = (t) => jwt.verify(t, env.jwt.refreshSecret);

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
