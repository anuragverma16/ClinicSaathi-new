import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../config/constants.js';

/**
 * Role gate. requireRole(ROLES.DOCTOR, ROLES.CLINIC_OWNER)
 * Super admins pass role gates, but tenant routes are closed to them by
 * requireTenant — platform staff don't browse clinical records by default.
 */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  const allowed = roles.flat();
  if (req.user.role === ROLES.SUPER_ADMIN) return next();
  if (!allowed.includes(req.user.role)) {
    return next(ApiError.forbidden('Your role does not have access to this'));
  }
  next();
};

/**
 * Every clinic route sits behind a resolved tenant from the user's own record.
 * There is no override: a super admin has no clinic and uses /platform.
 */
export const requireTenant = (req, _res, next) => {
  if (!req.tenant?.clinicId) return next(ApiError.forbidden('No clinic context on this account', 'NO_TENANT'));
  if (req.user.role === ROLES.BRANCH_MANAGER && !req.tenant.branchId) {
    return next(ApiError.forbidden('No branch is assigned to your account yet', 'NO_BRANCH'));
  }
  next();
};

/** Patients only reach the /portal routes; staff routes are closed to them. */
export const requireStaff = (req, _res, next) => {
  if (req.user?.role === ROLES.PATIENT) return next(ApiError.forbidden('Use the patient portal'));
  next();
};

const PERMISSIONS = {
  [ROLES.CLINIC_OWNER]: ['*'],
  [ROLES.BRANCH_MANAGER]: [
    'appointment:*', 'patient:read', 'patient:create', 'patient:update', 'queue:*', 'doctor:read', 'doctor:update',
    'service:read', 'staff:read', 'analytics:read', 'invoice:read', 'payment:read', 'branch:read', 'branch:update',
  ],
  [ROLES.DOCTOR]: [
    'appointment:read', 'appointment:update', 'doctor:read', 'service:read', 'patient:read', 'clinical:read',
    'consultation:*', 'prescription:*', 'lab:read', 'lab:create', 'lab:verify', 'certificate:*', 'document:*',
    'followup:*', 'queue:read', 'queue:update',
  ],
  [ROLES.RECEPTIONIST]: [
    'appointment:*', 'patient:read', 'patient:create', 'patient:update', 'queue:*', 'doctor:read', 'service:read',
    'invoice:read', 'payment:read', 'communication:read', 'communication:create',
  ],
  [ROLES.ACCOUNTANT]: [
    'billing:*', 'payment:*', 'invoice:*', 'refund:*', 'analytics:read', 'patient:read', 'service:read', 'doctor:read',
  ],
  // Lab technicians see only the minimum patient detail embedded in their orders.
  [ROLES.LAB_TECHNICIAN]: ['lab:read', 'lab:process'],
  [ROLES.PATIENT]: ['self:*'],
};

export function can(role, permission) {
  if (role === ROLES.SUPER_ADMIN) return true;
  const grants = PERMISSIONS[role] || [];
  if (grants.includes('*')) return true;
  const [resource] = permission.split(':');
  return grants.includes(permission) || grants.includes(`${resource}:*`);
}

export const requirePermission = (permission) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!can(req.user.role, permission)) {
    return next(ApiError.forbidden(`Your role can't do this (${permission})`, 'PERMISSION_DENIED'));
  }
  next();
};

/**
 * Staff assigned to a branch (other than the clinic owner) only see that
 * branch's operational data. Returns a filter fragment to merge into queries.
 */
export function branchFilter(req) {
  if (req.user?.role === ROLES.CLINIC_OWNER) return {};
  return req.tenant?.branchId ? { branchId: req.tenant.branchId } : {};
}
