import { AuditLog } from '../models/index.js';

/** Fire-and-forget audit write. Clinical and billing actions must be traceable. */
export function recordAudit(req, { action, entityType, entityId, before, after, clinicId }) {
  AuditLog.create({
    clinicId: clinicId || req.tenant?.clinicId,
    branchId: req.tenant?.branchId,
    actorUserId: req.user?._id,
    actorRole: req.user?.role,
    action, entityType, entityId, before, after,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch((e) => console.error('Audit write failed:', e.message));
}
