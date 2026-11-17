/**
 * Tenant isolation at the schema layer.
 *
 * Controllers must never be trusted to remember `clinicId` in a filter — one
 * forgotten `where` is a cross-clinic data breach. This plugin adds the field,
 * indexes it, and hard-fails any query that runs without a tenant filter
 * unless it is explicitly marked cross-tenant (super admin / platform jobs).
 *
 * Usage in a query:  Model.find({ ... }).setOptions({ clinicId })
 * Or via the helper: scoped(Model, req).find({ ... })
 */
const READ_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'count', 'countDocuments', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
];

export function tenantScope(schema, { branchScoped = true } = {}) {
  schema.add({
    clinicId: { type: 'ObjectId', ref: 'Clinic', required: true, index: true },
  });
  if (branchScoped) {
    schema.add({ branchId: { type: 'ObjectId', ref: 'Branch', index: true } });
  }

  schema.pre(READ_OPS, function enforceTenant() {
    const opts = this.getOptions ? this.getOptions() : {};
    if (opts.crossTenant === true) return;

    const clinicId = opts.clinicId;
    if (!clinicId) {
      throw new Error(
        `Tenant filter missing on ${this.model.modelName}.${this.op}(). ` +
        `Use scoped(Model, req) or pass .setOptions({ crossTenant: true }) deliberately.`
      );
    }
    this.where({ clinicId });
    if (opts.branchId) this.where({ branchId: opts.branchId });
  });

  schema.pre('aggregate', function enforceTenantAgg() {
    const opts = this.options || {};
    if (opts.crossTenant === true) return;
    if (!opts.clinicId) {
      throw new Error(`Tenant filter missing on ${this.model().modelName}.aggregate()`);
    }
    this.pipeline().unshift({ $match: { clinicId: opts.clinicId } });
  });
}

/**
 * Build a populate spec that carries the tenant filter into the sub-query
 * the data layer runs for that path. `.populate()` never inherits the parent
 * query's `.setOptions({ clinicId })`, so without this every populate of a
 * tenant-scoped ref (Patient/Doctor/Service/...) trips the pre-hook above
 * and throws as soon as the referenced document actually exists.
 */
export function tenantPopulate(clinicId, path, select) {
  const spec = typeof path === 'string' ? { path, select } : { ...path };
  spec.options = { ...(spec.options || {}), clinicId };
  return spec;
}

/** Bind a model to the current request's tenant. */
export function scoped(Model, req) {
  const clinicId = req.tenant?.clinicId;
  if (!clinicId) throw new Error('No tenant on request');
  return {
    find: (f = {}) => Model.find(f).setOptions({ clinicId }),
    findOne: (f = {}) => Model.findOne(f).setOptions({ clinicId }),
    findById: (id) => Model.findOne({ _id: id }).setOptions({ clinicId }),
    countDocuments: (f = {}) => Model.countDocuments(f).setOptions({ clinicId }),
    updateOne: (f, u, o = {}) => Model.updateOne(f, u).setOptions({ clinicId, ...o }),
    findOneAndUpdate: (f, u, o = {}) => Model.findOneAndUpdate(f, u, o).setOptions({ clinicId, ...o }),
    deleteOne: (f) => Model.deleteOne(f).setOptions({ clinicId }),
    aggregate: (p) => Model.aggregate(p).option({ clinicId }),
    create: (doc) => Model.create({ ...doc, clinicId }),
    model: Model,
    clinicId,
  };
}
