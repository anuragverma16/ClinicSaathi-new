import { newId } from './objectId.js';
import {
  applyDefaults, castValue, validateFields, hiddenPaths, ValidationError, isPlainObject, clone,
} from './schema.js';
import { matches, compare, applyUpdate, evalExpr, getPath, setPath, norm, equal } from './matcher.js';
import {
  registry, byCollection, rawQuery, buildWhere, buildOrderBy, getPool, mapError, q,
} from './sql.js';

/**
 * Models over MySQL tables with the query API the routes already use:
 *   Model.find(filter).select().sort().skip().limit().populate().lean().setOptions()
 *   Model.findOneAndUpdate(filter, { $set, $inc, $push, ... }, { new, upsert })
 *   Model.aggregate([...]) for reports
 * Every query becomes parameterised SQL; conditions SQL can't express are
 * checked in memory over the rows SQL returned.
 */

const snake = (name) => name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase();
const plural = (w) => (/(ch|sh|s|x|z)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);

// ---------------------------------------------------------------- helpers

function parseSort(sort) {
  if (!sort) return [];
  if (typeof sort === 'string') {
    return sort.split(/\s+/).filter(Boolean).map((f) => (f.startsWith('-') ? [f.slice(1), -1] : [f.replace(/^\+/, ''), 1]));
  }
  if (Array.isArray(sort)) return sort;
  return Object.entries(sort).map(([f, d]) => [f, d === -1 || d === 'desc' || d === 'descending' ? -1 : 1]);
}

function sortRows(rows, sort) {
  return rows.sort((a, b) => {
    for (const [f, d] of sort) {
      const c = compare(getPath(a, f), getPath(b, f));
      if (c) return c * d;
    }
    return 0;
  });
}

function parseSelect(sel) {
  const out = { include: [], exclude: [], force: [] };
  if (!sel) return out;
  const entries = typeof sel === 'string' ? sel.split(/\s+/).filter(Boolean).map((f) => (f.startsWith('-') ? [f.slice(1), 0] : f.startsWith('+') ? [f.slice(1), '+'] : [f, 1])) : Object.entries(sel);
  for (const [f, v] of entries) {
    if (v === '+') out.force.push(f);
    else if (v === 0 || v === false) out.exclude.push(f);
    else out.include.push(f);
  }
  return out;
}

function deletePath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) { cur = cur?.[parts[i]]; if (!cur || typeof cur !== 'object') return; }
  if (cur) delete cur[parts.at(-1)];
}

function project(Model, obj, selects) {
  const sel = parseSelect(selects);
  const hidden = Model.hidden.filter((h) => !sel.force.includes(h) && !sel.include.includes(h));
  let out = obj;
  if (sel.include.length) {
    out = { _id: obj._id };
    for (const f of sel.include) {
      if (f === '_id') continue;
      const v = getPath(obj, f);
      if (v !== undefined) setPath(out, f, v);
    }
    if (sel.exclude.includes('_id')) delete out._id;
  } else {
    for (const f of sel.exclude) deletePath(out, f);
  }
  for (const h of hidden) deletePath(out, h);
  return out;
}

/** Normalises ids/dates inside a filter to the schema's types so SQL and memory agree. */
function castFilter(schema, filter) {
  if (!isPlainObject(filter)) return filter;
  const out = {};
  for (const [k, cond] of Object.entries(filter)) {
    if (k === '$and' || k === '$or' || k === '$nor') { out[k] = cond.map((f) => castFilter(schema, f)); continue; }
    if (k.startsWith('$')) { out[k] = cond; continue; }
    const spec = schema.pathSpec(k);
    const leaf = spec?.kind === 'array' ? spec.of : spec;
    const cast = (v) => {
      if (v === null || v === undefined || v instanceof RegExp || !leaf || leaf.kind !== 'scalar') return norm(v);
      if (isPlainObject(v) && v._id === undefined) return v;
      return castValue(leaf, v, k);
    };
    if (isPlainObject(cond) && Object.keys(cond).length && Object.keys(cond).every((x) => x.startsWith('$'))) {
      out[k] = Object.fromEntries(Object.entries(cond).map(([op, v]) => {
        if (['$in', '$nin', '$all'].includes(op)) return [op, (v || []).map(cast)];
        if (['$exists', '$type', '$size', '$options', '$regex', '$not', '$elemMatch'].includes(op)) return [op, v];
        return [op, cast(v)];
      }));
    } else if (Array.isArray(cond) && spec?.kind !== 'array') {
      out[k] = cond.map(cast);
    } else {
      out[k] = cast(cond);
    }
  }
  return out;
}

/** Fields fixed by equality in a filter — the base of an upserted record. */
function equalityFields(filter, out = {}) {
  for (const [k, v] of Object.entries(filter || {})) {
    if (k === '$and') { v.forEach((f) => equalityFields(f, out)); continue; }
    if (k.startsWith('$')) continue;
    if (isPlainObject(v) && Object.keys(v).some((x) => x.startsWith('$'))) {
      if (v.$eq !== undefined) setPath(out, k, v.$eq);
      continue;
    }
    if (v instanceof RegExp) continue;
    setPath(out, k, v);
  }
  return out;
}

/**
 * Index of the array element a filter matched, for positional updates such
 * as { $set: { 'refunds.$.status': 'PROCESSED' } }.
 */
function positionalIndex(doc, filter, arrayField) {
  const arr = getPath(doc, arrayField);
  if (!Array.isArray(arr)) return -1;
  const conds = [];
  const collect = (f) => {
    for (const [k, v] of Object.entries(f || {})) {
      if (k === '$and') v.forEach(collect);
      else if (k === arrayField && isPlainObject(v) && v.$elemMatch) conds.push((el) => matches(el, v.$elemMatch));
      else if (k.startsWith(`${arrayField}.`)) conds.push((el) => matches(el, { [k.slice(arrayField.length + 1)]: v }));
    }
  };
  collect(filter);
  return arr.findIndex((el) => conds.every((c) => c(el)));
}

function resolvePositional(update, doc, filter) {
  const fix = (path) => {
    const i = path.indexOf('.$');
    if (i < 0 || (path[i + 2] !== undefined && path[i + 2] !== '.')) return path;
    const idx = positionalIndex(doc, filter, path.slice(0, i));
    if (idx < 0) throw new Error(`The positional operator did not find the match needed from the query (${path})`);
    return `${path.slice(0, i)}.${idx}${path.slice(i + 2)}`;
  };
  return Object.fromEntries(Object.entries(update || {}).map(([op, v]) => (
    op.startsWith('$') && isPlainObject(v) ? [op, Object.fromEntries(Object.entries(v).map(([p, x]) => [fix(p), x]))] : [fix(op), v]
  )));
}

async function runHooks(schema, op, ctx) {
  for (const h of schema.hooks) {
    if (h.op !== op) continue;
    if (h.fn.length > 0) {
      // Callback-style hook: function (next) { ... next(); }
      await new Promise((resolve, reject) => {
        try {
          const r = h.fn.call(ctx, (err) => (err ? reject(err) : resolve()));
          if (r && typeof r.then === 'function') r.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    } else {
      await h.fn.call(ctx);
    }
  }
}

// ---------------------------------------------------------------- reads

/** Row from MySQL → plain record with schema types, defaults applied. */
function hydrate(Model, row) {
  const obj = { _id: row.id };
  for (const [name, spec] of Object.entries(Model.schema.fields)) {
    let v = row[name];
    if (v === null || v === undefined) continue;
    if (spec.kind !== 'scalar' && typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep */ } }
    obj[name] = castValue(spec, v, name);
  }
  return applyDefaults(Model.schema.fields, obj);
}

/** Record → column values for INSERT/UPDATE. */
function toRow(Model, obj, only = null) {
  const row = {};
  for (const [name, spec] of Object.entries(Model.schema.fields)) {
    if (only && !only.has(name)) continue;
    let v = castValue(spec, obj[name], name, true);
    if (v === undefined) v = null;
    if (v !== null && spec.kind !== 'scalar') v = JSON.stringify(v);
    else if (spec.kind === 'scalar' && spec.type === 'Boolean' && v !== null) v = v ? 1 : 0;
    else if (v !== null && spec.kind === 'scalar' && spec.type === 'Mixed') v = JSON.stringify(v);
    row[name] = v;
  }
  return row;
}

/** Fetches records matching a filter (SQL first, memory for the rest). */
async function fetchRows(Model, filter, { sort = [], skip = 0, limit = 0, conn = null, forUpdate = false } = {}) {
  const casted = castFilter(Model.schema, filter);
  const where = buildWhere(Model.schema, casted);
  const orderBy = buildOrderBy(Model.schema, sort);
  let sql = `SELECT * FROM ${q(Model.table)}${where.sql ? ` WHERE ${where.sql}` : ''}`;
  const sqlPaging = where.exact && orderBy !== null;
  if (orderBy) sql += ` ORDER BY ${orderBy}`;
  if (sqlPaging && limit) sql += ` LIMIT ${Number(limit)}`;
  if (sqlPaging && skip) sql += `${limit ? '' : ' LIMIT 18446744073709551615'} OFFSET ${Number(skip)}`;
  if (forUpdate) sql += ' FOR UPDATE';
  const rows = await rawQuery(sql, where.params, conn);
  let docs = rows.map((r) => hydrate(Model, r));
  if (!where.exact) docs = docs.filter((d) => matches(d, casted));
  if (orderBy === null) sortRows(docs, sort);
  if (!sqlPaging) docs = docs.slice(skip || 0, limit ? (skip || 0) + Number(limit) : undefined);
  return docs;
}

function normalisePopulate(arg, select) {
  if (Array.isArray(arg)) return arg.flatMap((a) => normalisePopulate(a));
  if (typeof arg === 'string') return arg.split(/\s+/).filter(Boolean).map((path) => ({ path, select }));
  return [arg];
}

async function populateDocs(Model, docs, specs) {
  for (const spec of specs) {
    const fieldSpec = Model.schema.pathSpec(spec.path);
    const refName = spec.model?.modelName || spec.model || fieldSpec?.opts?.ref || fieldSpec?.of?.opts?.ref;
    const Ref = registry.get(refName);
    if (!Ref) continue;
    const ids = new Set();
    for (const d of docs) {
      const v = getPath(d, spec.path);
      for (const id of [].concat(v ?? [])) if (id != null && typeof id !== 'object') ids.add(String(id));
    }
    let found = [];
    if (ids.size) {
      const query = Ref.find({ _id: { $in: [...ids] } }).setOptions(spec.options || {});
      if (spec.select) query.select(spec.select);
      if (spec.populate) query.populate(spec.populate);
      found = await query.lean();
    }
    const byId = new Map(found.map((f) => [String(f._id), f]));
    for (const d of docs) {
      const v = getPath(d, spec.path);
      if (Array.isArray(v)) setPath(d, spec.path, v.map((id) => byId.get(String(id))).filter(Boolean));
      else if (v != null && typeof v !== 'object') setPath(d, spec.path, byId.get(String(v)) ?? null);
    }
  }
}

// ---------------------------------------------------------------- Query

class Query {
  constructor(Model, op, filter = {}, update = null, options = {}) {
    this.model = Model;
    this.op = op;
    this._filter = filter || {};
    this._wheres = [];
    this._update = update;
    this._options = { ...options };
    this._select = options.projection || null;
    this._sort = options.sort || null;
    this._skip = 0;
    this._limit = 0;
    this._lean = false;
    this._populate = [];
  }

  getOptions() { return this._options; }
  setOptions(o = {}) { Object.assign(this._options, o); if (o.sort) this._sort = o.sort; return this; }
  getFilter() { return this._conditions(); }
  getQuery() { return this._conditions(); }
  where(cond) { if (isPlainObject(cond)) this._wheres.push(cond); return this; }
  select(s) { this._select = this._select && typeof s === 'string' && typeof this._select === 'string' ? `${this._select} ${s}` : s; return this; }
  sort(s) { this._sort = s; return this; }
  skip(n) { this._skip = Number(n) || 0; return this; }
  limit(n) { this._limit = Number(n) || 0; return this; }
  lean(v = true) { this._lean = v !== false; return this; }
  populate(arg, select) { this._populate.push(...normalisePopulate(arg, select)); return this; }
  session() { return this; }
  hint() { return this; }
  collation() { return this; }
  exec() { return this._exec(); }
  then(res, rej) { return this._exec().then(res, rej); }
  catch(rej) { return this._exec().catch(rej); }
  finally(fn) { return this._exec().finally(fn); }

  _conditions() {
    const all = [this._filter, ...this._wheres].filter((f) => f && Object.keys(f).length);
    return all.length <= 1 ? (all[0] || {}) : { $and: all };
  }

  async _exec() {
    if (this._running) return this._running;
    this._running = (async () => {
      await runHooks(this.model.schema, this.op, this);
      if (this._options.clinicId && this.op === 'distinct') this.where({ clinicId: this._options.clinicId });
      switch (this.op) {
        case 'find': return this._finish(await fetchRows(this.model, this._conditions(), { sort: parseSort(this._sort), skip: this._skip, limit: this._limit }));
        case 'findOne': {
          const rows = await fetchRows(this.model, this._conditions(), { sort: parseSort(this._sort), skip: this._skip, limit: 1 });
          return rows.length ? (await this._finish(rows))[0] : null;
        }
        case 'countDocuments': case 'count': {
          const casted = castFilter(this.model.schema, this._conditions());
          const where = buildWhere(this.model.schema, casted);
          if (where.exact) {
            const [r] = await rawQuery(`SELECT COUNT(*) AS n FROM ${q(this.model.table)}${where.sql ? ` WHERE ${where.sql}` : ''}`, where.params);
            return Number(r.n);
          }
          return (await fetchRows(this.model, this._conditions())).length;
        }
        case 'distinct': {
          const rows = await fetchRows(this.model, this._conditions());
          const seen = [];
          for (const r of rows) for (const v of [].concat(getPath(r, this._distinctField) ?? [])) if (v != null && !seen.some((s) => equal(s, v))) seen.push(v);
          return seen;
        }
        default:
          try { return await this._mutate(); } catch (e) {
            if (e.code === 11000 && this._options.upsert) return this._mutate();   // lost an upsert race: the row exists now
            throw e;
          }
      }
    })();
    return this._running;
  }

  async _finish(rows) {
    let out = rows.map((r) => project(this.model, r, this._select));
    if (this._populate.length) await populateDocs(this.model, out, this._populate);
    if (!this._lean) out = out.map((r) => this.model.hydrateDoc(r));
    return out;
  }

  async _mutate() {
    const Model = this.model;
    const single = ['updateOne', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne'].includes(this.op);
    const isDelete = ['deleteOne', 'deleteMany', 'findOneAndDelete'].includes(this.op);
    const opts = this._options;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const filter = this._conditions();
      const targets = await fetchRows(Model, filter, { sort: parseSort(this._sort || opts.sort), limit: single ? 1 : 0, conn, forUpdate: true });

      if (isDelete) {
        if (targets.length) await rawQuery(`DELETE FROM ${q(Model.table)} WHERE id IN (${targets.map(() => '?').join(', ')})`, targets.map((t) => t._id), conn);
        await conn.commit();
        if (this.op === 'findOneAndDelete') return targets[0] ? this._shape(targets[0]) : null;
        return { acknowledged: true, deletedCount: targets.length };
      }

      const now = new Date();
      const ts = Model.timestamps;
      if (!targets.length && opts.upsert) {
        const obj = equalityFields(castFilter(Model.schema, filter));
        obj._id = obj._id ? String(obj._id) : newId();
        applyUpdate(obj, this._update, { isInsert: true });
        applyDefaults(Model.schema.fields, obj);
        if (ts?.createdAt) obj[ts.createdAt] ??= now;
        if (ts?.updatedAt) obj[ts.updatedAt] = now;
        const row = toRow(Model, obj);
        const cols = Object.keys(row);
        await rawQuery(`INSERT INTO ${q(Model.table)} (\`id\`, ${cols.map(q).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [obj._id, ...cols.map((c) => row[c])], conn);
        await conn.commit();
        if (this.op === 'findOneAndUpdate') return opts.new || opts.returnDocument === 'after' ? this._shape(hydrate(Model, { id: obj._id, ...row })) : null;
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: obj._id };
      }

      const results = [];
      for (const target of targets) {
        const before = clone(target);
        const touched = applyUpdate(target, resolvePositional(this._update, target, castFilter(Model.schema, filter)));
        if (ts?.updatedAt && !touched.has(ts.updatedAt)) { target[ts.updatedAt] = now; touched.add(ts.updatedAt); }
        if (opts.runValidators) {
          const errors = validateFields(Object.fromEntries([...touched].filter((k) => Model.schema.fields[k]).map((k) => [k, Model.schema.fields[k]])), target);
          if (Object.keys(errors).length) throw new ValidationError(errors);
        }
        const row = toRow(Model, target, new Set([...touched].filter((k) => Model.schema.fields[k])));
        const cols = Object.keys(row);
        if (cols.length) await rawQuery(`UPDATE ${q(Model.table)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c]), target._id], conn);
        results.push({ before, after: hydrate(Model, { id: target._id, ...toRow(Model, target) }) });
      }
      await conn.commit();
      if (this.op === 'findOneAndUpdate') {
        if (!results.length) return null;
        return this._shape(opts.new || opts.returnDocument === 'after' ? results[0].after : results[0].before);
      }
      return { acknowledged: true, matchedCount: targets.length, modifiedCount: targets.length, upsertedCount: 0 };
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw mapError(e);
    } finally {
      conn.release();
    }
  }

  async _shape(row) {
    const [out] = await this._finish([row]);
    return out;
  }
}

// ---------------------------------------------------------------- Aggregate

class Aggregate {
  constructor(Model, pipeline = []) {
    this._model = Model;
    this._pipeline = [...pipeline];
    this.options = {};
  }

  option(o = {}) { Object.assign(this.options, o); return this; }
  pipeline() { return this._pipeline; }
  model() { return this._model; }
  allowDiskUse() { return this; }
  exec() { return this._exec(); }
  then(res, rej) { return this._exec().then(res, rej); }
  catch(rej) { return this._exec().catch(rej); }

  async _exec() {
    await runHooks(this._model.schema, 'aggregate', this);
    let stages = [...this._pipeline];
    // Leading $match stages are pushed into SQL.
    const leading = [];
    while (stages[0]?.$match) leading.push(stages.shift().$match);
    let docs = await fetchRows(this._model, leading.length > 1 ? { $and: leading } : (leading[0] || {}));
    for (const stage of stages) docs = await runStage(stage, docs);
    return docs;
  }
}

function groupKey(v) {
  v = norm(v);
  return JSON.stringify(v instanceof Date ? { $d: v.getTime() } : v ?? null);
}

async function runStage(stage, docs) {
  const [op] = Object.keys(stage);
  const spec = stage[op];
  switch (op) {
    case '$match': return docs.filter((d) => matches(d, spec));
    case '$sort': return sortRows([...docs], parseSort(spec));
    case '$limit': return docs.slice(0, spec);
    case '$skip': return docs.slice(spec);
    case '$count': return [{ [spec]: docs.length }];
    case '$project': case '$addFields': case '$set': {
      const entries = Object.entries(spec);
      const inclusive = op === '$project' && entries.some(([k, v]) => k !== '_id' && (v === 1 || v === true));
      const computedOnly = op === '$project' && entries.some(([, v]) => v !== 0 && v !== false && v !== 1 && v !== true);
      return docs.map((d) => {
        let out;
        if (op !== '$project') out = { ...d };
        else if (inclusive || computedOnly) out = spec._id === 0 || spec._id === false ? {} : { _id: d._id };
        else out = { ...d };
        for (const [k, v] of entries) {
          if (v === 0 || v === false) { deletePath(out, k); continue; }
          if (v === 1 || v === true) { const val = getPath(d, k); if (val !== undefined) setPath(out, k, val); continue; }
          setPath(out, k, evalExpr(v, d));
        }
        return out;
      });
    }
    case '$unwind': {
      const path = (typeof spec === 'string' ? spec : spec.path).slice(1);
      const keep = typeof spec === 'object' && spec.preserveNullAndEmptyArrays;
      const out = [];
      for (const d of docs) {
        const arr = getPath(d, path);
        if (Array.isArray(arr) && arr.length) {
          for (const el of arr) { const copy = { ...d }; setPath(copy, path, el); out.push(copy); }
        } else if (keep) out.push(d);
        else if (arr !== undefined && arr !== null && !Array.isArray(arr)) out.push(d);
      }
      return out;
    }
    case '$group': {
      const groups = new Map();
      for (const d of docs) {
        const id = evalExpr(spec._id, d) ?? null;
        const key = groupKey(id);
        if (!groups.has(key)) groups.set(key, { _id: id, __acc: {} });
        const g = groups.get(key);
        for (const [field, acc] of Object.entries(spec)) {
          if (field === '_id') continue;
          const [accOp] = Object.keys(acc);
          const val = evalExpr(acc[accOp], d);
          const st = g.__acc[field] ??= { n: 0, sum: 0, list: [], first: undefined, has: false, best: undefined };
          switch (accOp) {
            case '$sum': if (typeof val === 'number') st.sum += val; break;
            case '$avg': if (typeof val === 'number') { st.sum += val; st.n += 1; } break;
            case '$min': if (val != null && (st.best === undefined || compare(val, st.best) < 0)) st.best = val; break;
            case '$max': if (val != null && (st.best === undefined || compare(val, st.best) > 0)) st.best = val; break;
            case '$first': if (!st.has) { st.first = val; st.has = true; } break;
            case '$last': st.first = val; st.has = true; break;
            case '$push': st.list.push(val); break;
            case '$addToSet': if (!st.list.some((x) => equal(x, val))) st.list.push(val); break;
            case '$count': st.sum += 1; break;
            default: throw new Error(`Unsupported accumulator ${accOp}`);
          }
          st.op = accOp;
        }
      }
      return [...groups.values()].map(({ _id, __acc }) => {
        const out = { _id };
        for (const [field, st] of Object.entries(__acc)) {
          out[field] = { $sum: st.sum, $count: st.sum, $avg: st.n ? st.sum / st.n : null, $min: st.best ?? null, $max: st.best ?? null, $first: st.first ?? null, $last: st.first ?? null, $push: st.list, $addToSet: st.list }[st.op];
        }
        for (const field of Object.keys(spec)) if (field !== '_id' && !(field in out)) out[field] = Object.keys(spec[field])[0] === '$sum' ? 0 : null;
        return out;
      });
    }
    case '$lookup': {
      const Foreign = byCollection.get(spec.from);
      if (!Foreign) throw new Error(`$lookup: unknown collection ${spec.from}`);
      const values = new Set();
      for (const d of docs) for (const v of [].concat(getPath(d, spec.localField) ?? [])) if (v != null) values.add(String(norm(v)));
      const foreign = values.size ? await fetchRows(Foreign, { [spec.foreignField]: { $in: [...values] } }) : [];
      return docs.map((d) => {
        const local = [].concat(getPath(d, spec.localField) ?? []).map((v) => String(norm(v)));
        return { ...d, [spec.as]: foreign.filter((f) => [].concat(getPath(f, spec.foreignField) ?? []).some((v) => local.includes(String(norm(v))))) };
      });
    }
    default:
      throw new Error(`Unsupported aggregation stage ${op}`);
  }
}

// ---------------------------------------------------------------- Document + model()

export function model(name, schema) {
  if (registry.has(name)) return registry.get(name);
  // timestamps: true | { createdAt: true|false|'name', updatedAt: true|false|'name' }
  let ts = null;
  if (schema.options.timestamps) {
    const t = schema.options.timestamps === true ? {} : schema.options.timestamps;
    const pick = (v, def) => (v === false ? null : typeof v === 'string' ? v : def);
    ts = { createdAt: pick(t.createdAt, 'createdAt'), updatedAt: pick(t.updatedAt, 'updatedAt') };
    for (const f of [ts.createdAt, ts.updatedAt]) if (f) schema.add({ [f]: Date });
  }
  const table = plural(snake(name));
  const hidden = hiddenPaths(schema.fields);

  class Doc {
    constructor(data = {}, isNew = true) {
      Object.defineProperty(this, '$isNew', { value: isNew, writable: true, enumerable: false });
      const obj = isNew ? applyDefaults(schema.fields, { ...clone(data) }) : data;
      if (isNew) obj._id = obj._id ? String(obj._id) : newId();
      Object.assign(this, obj);
    }

    get isNew() { return this.$isNew; }
    get id() { return this._id == null ? this._id : String(this._id); }

    toObject() {
      const plain = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' && typeof v.toObject === 'function' ? v.toObject() : isPlainObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
      return Object.fromEntries(Object.entries(this).map(([k, v]) => [k, plain(v)]));
    }

    toJSON() { return this.toObject(); }
    get(path) { return getPath(this, path); }
    set(path, value) { if (isPlainObject(path)) Object.assign(this, path); else setPath(this, path, value); return this; }
    markModified() { return this; }
    isModified() { return true; }
    equals(other) { return String(this._id) === String(other?._id ?? other); }

    async validate() {
      await runHooks(schema, 'validate', this);
      const errors = validateFields(schema.fields, this);
      if (Object.keys(errors).length) throw new ValidationError(errors);
    }

    async save() {
      applyDefaults(schema.fields, this);
      await this.validate();
      await runHooks(schema, 'save', this);
      const now = new Date();
      if (ts?.createdAt && this.$isNew) this[ts.createdAt] ??= now;
      if (ts?.updatedAt) this[ts.updatedAt] = now;
      const plainData = this.toObject();
      const row = toRow(Model, plainData);
      const cols = Object.keys(row);
      if (this.$isNew) {
        await rawQuery(`INSERT INTO ${q(table)} (\`id\`, ${cols.map(q).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`, [this._id, ...cols.map((c) => row[c])]);
        this.$isNew = false;
      } else {
        await rawQuery(`UPDATE ${q(table)} SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => row[c]), this._id]);
      }
      // Reflect the stored (cast) values back onto the document.
      const stored = hydrate(Model, { id: this._id, ...row });
      for (const [k, v] of Object.entries(stored)) {
        if (isPlainObject(this[k]) && this[k]._id !== undefined && schema.fields[k]?.type === 'ObjectId') continue;   // keep populated refs
        this[k] = v;
      }
      return this;
    }

    async populate(arg, select) {
      await populateDocs(Model, [this], normalisePopulate(arg, select));
      return this;
    }

    async deleteOne() {
      await rawQuery(`DELETE FROM ${q(table)} WHERE id = ?`, [this._id]);
      return { deletedCount: 1 };
    }
  }

  for (const [k, fn] of Object.entries(schema.methods)) Doc.prototype[k] = fn;
  for (const [k, fn] of Object.entries(schema.virtuals)) Object.defineProperty(Doc.prototype, k, { get: fn, configurable: true });

  const Model = Doc;
  Object.assign(Model, {
    modelName: name, schema, table, hidden, timestamps: ts,
    collection: { name: plural(name.toLowerCase()), collectionName: plural(name.toLowerCase()) },
    hydrateDoc(obj) { return new Doc(obj, false); },
    find(filter = {}, projection = null, options = {}) { return new Query(Model, 'find', filter, null, { ...options, ...(projection ? { projection } : {}) }); },
    findOne(filter = {}, projection = null) { return new Query(Model, 'findOne', filter, null, projection ? { projection } : {}); },
    findById(id, projection = null) { return new Query(Model, 'findOne', { _id: id ?? null }, null, projection ? { projection } : {}); },
    findOneAndUpdate(filter, update, options = {}) { return new Query(Model, 'findOneAndUpdate', filter, update, options); },
    findByIdAndUpdate(id, update, options = {}) { return new Query(Model, 'findOneAndUpdate', { _id: id ?? null }, update, options); },
    findOneAndDelete(filter, options = {}) { return new Query(Model, 'findOneAndDelete', filter, null, options); },
    findByIdAndDelete(id) { return new Query(Model, 'findOneAndDelete', { _id: id ?? null }); },
    updateOne(filter, update, options = {}) { return new Query(Model, 'updateOne', filter, update, options); },
    updateMany(filter, update, options = {}) { return new Query(Model, 'updateMany', filter, update, options); },
    deleteOne(filter = {}) { return new Query(Model, 'deleteOne', filter); },
    deleteMany(filter = {}) { return new Query(Model, 'deleteMany', filter); },
    countDocuments(filter = {}) { return new Query(Model, 'countDocuments', filter); },
    count(filter = {}) { return new Query(Model, 'count', filter); },
    estimatedDocumentCount() { return new Query(Model, 'countDocuments', {}).setOptions({ crossTenant: true }); },
    exists(filter = {}) {
      const query = new Query(Model, 'findOne', filter).select('_id').lean();
      const run = query._exec.bind(query);
      query._exec = async () => { const r = await run(); return r ? { _id: r._id } : null; };
      return query;
    },
    distinct(field, filter = {}) { const query = new Query(Model, 'distinct', filter); query._distinctField = field; return query; },
    aggregate(pipeline = []) { return new Aggregate(Model, pipeline); },
    async create(docs, ...rest) {
      if (Array.isArray(docs)) return Promise.all(docs.map((d) => new Doc(d).save()));
      if (rest.length && isPlainObject(rest[0])) return Promise.all([docs, ...rest].map((d) => new Doc(d).save()));
      return new Doc(docs).save();
    },
    async insertMany(docs) { return Promise.all(docs.map((d) => new Doc(d).save())); },
    async init() { return Model; },
    async syncIndexes() { return []; },
  });
  Object.defineProperty(Model, 'name', { value: name });

  registry.set(name, Model);
  byCollection.set(Model.collection.name, Model);
  byCollection.set(table, Model);
  return Model;
}
