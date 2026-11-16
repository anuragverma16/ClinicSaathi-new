import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Private object storage for lab reports and patient documents.
 *
 * Files are written under STORAGE_DIR, which is never mounted as a static
 * route. The only way to read one is GET /api/files/download with a signed,
 * short-lived token that the API issues after an authorisation check. Swap
 * these two functions for S3 PutObject/GetObject to move to a bucket — the
 * signed-link flow above them stays the same.
 */
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function assertAllowedFile(file) {
  if (!file) return;
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw ApiError.badRequest('Upload a PDF, PNG, JPEG or WebP file', 'FILE_TYPE_NOT_ALLOWED');
  }
}

function resolveKey(key) {
  // Keys are generated server-side, but refuse traversal anyway.
  const full = path.resolve(env.storageDir, key);
  if (!full.startsWith(env.storageDir + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function uploadFile({ clinicId, folder, buffer, originalName }) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const key = path.posix.join(String(clinicId), folder, `${crypto.randomUUID()}${ext}`);
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return { key, size: buffer.length };
}

export async function readFile(key) {
  return fs.readFile(resolveKey(key));
}

// ------------------------------------------------------------- Signed links

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', env.fileUrlSecret).update(payload).digest('base64url');

/**
 * A download token names exactly one resource in one clinic and expires in
 * minutes. It is created only after the caller passed the access check.
 */
export function createDownloadToken({ clinicId, kind, id, userId, ttlSeconds = 300 }) {
  const payload = b64(JSON.stringify({ c: String(clinicId), k: kind, i: String(id), u: String(userId), e: Date.now() + ttlSeconds * 1000 }));
  return `${payload}.${sign(payload)}`;
}

export function verifyDownloadToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.e < Date.now()) return null;
  return { clinicId: data.c, kind: data.k, id: data.i, userId: data.u };
}
