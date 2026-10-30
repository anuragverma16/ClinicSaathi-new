import { Router } from 'express';
import { z } from 'zod';
import { Service } from '../../models/index.js';
import { crudHandlers } from '../crudFactory.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/rbac.js';

const router = Router();
const h = crudHandlers(Service, { searchFields: ['name'], entityName: 'Service', defaultSort: 'name' });

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(500).optional(),
  durationMins: z.number().int().min(5).max(240).optional(),
  fee: z.number().min(0).max(1_000_000).optional(),
  gstPercent: z.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'GST must be 0, 5, 12, 18 or 28%').optional(),
  mode: z.enum(['OFFLINE', 'ONLINE', 'BOTH']).optional(),
  recallIntervalDays: z.number().int().min(0).max(1095).optional(),
  isActive: z.boolean().optional(),
});

router.get('/', requirePermission('service:read'), h.list);
router.post('/', requirePermission('service:create'), validate(serviceSchema), h.create);
router.get('/:id', requirePermission('service:read'), h.get);
router.patch('/:id', requirePermission('service:update'), validate(serviceSchema.partial()), h.update);
router.delete('/:id', requirePermission('service:delete'), h.remove);

export default router;
