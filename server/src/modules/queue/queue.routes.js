import { Router } from 'express';
import { z } from 'zod';
import { requirePermission, branchFilter } from '../../middleware/rbac.js';
import { requireFeature } from '../../middleware/planGate.js';
import { validate } from '../../middleware/validate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { recordAudit } from '../../middleware/audit.js';
import { checkIn, getQueue, callNext, updateTokenStatus } from '../../services/queue.service.js';
import { ROLES } from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';

const router = Router();
router.use(requireFeature('queue'));

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
// Doctors act only on their own queue, whatever doctorId the client sends.
const doctorScope = (req, requested) => {
  if (req.user.role !== ROLES.DOCTOR) return requested;
  if (!req.user.doctorId) throw ApiError.forbidden('Your account is not linked to a doctor profile', 'NO_DOCTOR_PROFILE');
  return req.user.doctorId;
};

router.get('/', requirePermission('queue:read'), catchAsync(async (req, res) => {
  ok(res, await getQueue({
    clinicId: req.tenant.clinicId,
    doctorId: doctorScope(req, req.query.doctorId),
    branchId: branchFilter(req).branchId,
    queueDate: req.query.date,
    includeDone: req.query.includeDone === 'true',
  }));
}));

router.post('/check-in', requirePermission('queue:update'),
  validate(z.object({ appointmentId: objectId, priority: z.number().int().min(0).max(10).optional() })),
  catchAsync(async (req, res) => {
    const token = await checkIn({
      clinicId: req.tenant.clinicId, appointmentId: req.body.appointmentId,
      priority: req.body.priority || 0, branchId: branchFilter(req).branchId,
    });
    recordAudit(req, { action: 'PATIENT_CHECKED_IN', entityType: 'QueueToken', entityId: token._id });
    created(res, token);
  }));

router.post('/call-next', requirePermission('queue:update'), validate(z.object({ doctorId: objectId.optional() })),
  catchAsync(async (req, res) => {
    ok(res, await callNext({ clinicId: req.tenant.clinicId, doctorId: doctorScope(req, req.body.doctorId) }));
  }));

router.patch('/:tokenId', requirePermission('queue:update'),
  validate(z.object({ status: z.enum(['WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED']) })),
  catchAsync(async (req, res) => {
    ok(res, await updateTokenStatus({
      clinicId: req.tenant.clinicId,
      tokenId: req.params.tokenId,
      status: req.body.status,
      doctorId: req.user.role === ROLES.DOCTOR ? req.user.doctorId : undefined,
      branchId: branchFilter(req).branchId,
    }));
  }));

export default router;
