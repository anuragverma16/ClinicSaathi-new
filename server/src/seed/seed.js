import crypto from 'node:crypto';
import db from '../db/index.js';
import { connectDb } from '../config/db.js';
import { User } from '../models/index.js';
import { ROLES } from '../config/constants.js';

/**
 * Provisions the platform super admin — the only way one is ever created.
 *
 *   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='...' npm run seed
 *
 * Without SEED_ADMIN_PASSWORD a strong random password is generated and
 * printed once. Re-running never overwrites an existing super admin.
 */
await connectDb();

const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
if (!email) {
  console.error('Set SEED_ADMIN_EMAIL (and optionally SEED_ADMIN_PASSWORD) to provision the super admin.');
  process.exit(1);
}

const existing = await User.findOne({ role: ROLES.SUPER_ADMIN, email });
if (existing) {
  console.log(`Super admin ${email} already exists. Nothing changed.`);
} else {
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const password = process.env.SEED_ADMIN_PASSWORD || `${crypto.randomBytes(12).toString('base64url')}9a`;
  if (password.length < 12) {
    console.error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
  const u = new User({ name: process.env.SEED_ADMIN_NAME || 'Platform Admin', email, role: ROLES.SUPER_ADMIN });
  await u.setPassword(password);
  await u.save();
  console.log(`\nSuper admin created: ${email}`);
  if (generated) console.log(`One-time password: ${password}\nStore it in a password manager and change it after first sign-in.\n`);
}

await db.disconnect();
process.exit(0);
