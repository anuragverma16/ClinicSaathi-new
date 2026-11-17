import { User } from '../models/index.js';
import { ROLES } from '../config/constants.js';
import { env } from '../config/env.js';

/**
 * There is no public sign-up: the platform runs from one predefined super
 * admin whose credentials live in .env (SUPER_ADMIN_EMAIL / _PASSWORD).
 * Created on first boot; an existing account is never overwritten, so a
 * password changed from the app survives restarts.
 */
export async function ensureSuperAdmin() {
  const { email, password, name } = env.superAdmin;
  if (!email || !password) {
    console.warn('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping super admin bootstrap.');
    return;
  }
  if (await User.exists({ role: ROLES.SUPER_ADMIN, email })) return;

  const user = new User({ name, email, role: ROLES.SUPER_ADMIN });
  await user.setPassword(password);
  await user.save();
  console.log(`Super admin created: ${email}`);
}
