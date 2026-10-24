import { scoped, tenantPopulate } from '../models/plugins/tenantScope.js';
import { catchAsync } from '../utils/catchAsync.js';
import { ApiError } from '../utils/ApiError.js';
import { ok, created } from '../utils/respond.js';
import { validate } from '../middleware/validate.js';
import { recordAudit } from '../middleware/audit.js';

/**
 * Builds list/get/create/update/remove handlers for a tenant-scoped model.
 * Every handler goes through scoped(), so the clinic filter is never optional.
 */
export function crudHandlers(Model, {
  searchFields = [],
  populate = '',
  defaultSort = '-createdAt',
  entityName = Model.modelName,
} = {}) {
  return {
    list: catchAsync(async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Number(req.query.limit) || 20);
      const filter = {};

      if (req.query.q && searchFields.length) {
        // Escaped: a raw user string as a regex is an injection / ReDoS vector.
        const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = searchFields.map((f) => ({ [f]: rx }));
      }
      for (const key of ['status', 'doctorId', 'patientId', 'branchId', 'isActive']) {
        if (typeof req.query[key] === 'string') filter[key] = req.query[key];
      }

      const db = scoped(Model, req);
      const [items, total] = await Promise.all([
        db.find(filter).sort(defaultSort).skip((page - 1) * limit).limit(limit)
          .populate(populate ? tenantPopulate(req.tenant.clinicId, populate) : ''),
        db.countDocuments(filter),
      ]);
      ok(res, items, { page, limit, total, pages: Math.ceil(total / limit) });
    }),

    get: catchAsync(async (req, res) => {
      const item = await scoped(Model, req).findById(req.params.id)
        .populate(populate ? tenantPopulate(req.tenant.clinicId, populate) : '');
      if (!item) throw ApiError.notFound(`${entityName} not found`);
      ok(res, item);
    }),

    create: catchAsync(async (req, res) => {
      const item = await scoped(Model, req).create({
        ...req.body,
        branchId: req.body.branchId || req.tenant.branchId,
      });
      recordAudit(req, { action: `${entityName.toUpperCase()}_CREATED`, entityType: entityName, entityId: item._id, after: item.toObject() });
      created(res, item);
    }),

    update: catchAsync(async (req, res) => {
      const before = await scoped(Model, req).findById(req.params.id);
      if (!before) throw ApiError.notFound(`${entityName} not found`);
      const item = await scoped(Model, req).findOneAndUpdate(
        { _id: req.params.id }, req.body, { new: true, runValidators: true }
      );
      recordAudit(req, { action: `${entityName.toUpperCase()}_UPDATED`, entityType: entityName, entityId: item._id, before: before.toObject(), after: item.toObject() });
      ok(res, item);
    }),

    remove: catchAsync(async (req, res) => {
      // Soft delete: clinical and financial records must never vanish.
      const item = await scoped(Model, req).findOneAndUpdate(
        { _id: req.params.id }, { isActive: false }, { new: true }
      );
      if (!item) throw ApiError.notFound(`${entityName} not found`);
      recordAudit(req, { action: `${entityName.toUpperCase()}_DEACTIVATED`, entityType: entityName, entityId: item._id });
      ok(res, item);
    }),
  };
}

export { validate };
