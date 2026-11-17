import { verifyAccess } from '../utils/tokens.js';
import { ApiError } from '../utils/ApiError.js';
import { User, Clinic } from '../models/index.js';
import { catchAsync } from '../utils/catchAsync.js';
import { ROLES } from '../config/constants.js';

// A suspended clinic must lose access within seconds, not when tokens expire,
// but checking the database on every request is wasteful. A short cache splits the difference.
const clinicStatusCache = new Map();
const CLINIC_CACHE_MS = 15_000;

async function isClinicActive(clinicId) {
  const key = String(clinicId);
  const hit = clinicStatusCache.get(key);
  if (hit && hit.at > Date.now() - CLINIC_CACHE_MS) return hit.active;
  const clinic = await Clinic.findById(clinicId).select('isActive').lean();
  const active = Boolean(clinic?.isActive);
  clinicStatusCache.set(key, { active, at: Date.now() });
  return active;
}

export const invalidateClinicStatus = (clinicId) => clinicStatusCache.delete(String(clinicId));

/**
 * Verifies the access token and attaches req.user + req.tenant. Identity,
 * role, clinic and branch all come from the database record — never from
 * anything the client sends.
 */
export const authenticate = catchAsync(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = verifyAccess(token);
  } catch {
    throw ApiError.unauthorized('Your session expired. Sign in again.', 'TOKEN_EXPIRED');
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive', 'ACCOUNT_INACTIVE');

  if (user.role !== ROLES.SUPER_ADMIN) {
    if (!user.clinicId) throw ApiError.forbidden('No clinic context on this account');
    if (!(await isClinicActive(user.clinicId))) {
      throw ApiError.forbidden('This clinic account is suspended. Contact ClinicSaathi support.', 'CLINIC_SUSPENDED');
    }
  }

  req.user = user;
  // The tenant comes from the user record, never from a header, query or body param.
  req.tenant = {
    clinicId: user.clinicId || null,
    branchId: user.branchId || null,
    patientId: user.role === ROLES.PATIENT ? user.patientId : null,
  };
  next();
});
