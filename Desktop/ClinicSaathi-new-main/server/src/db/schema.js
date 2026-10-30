import { newId, ID_RE } from './objectId.js';

/**
 * Schema definitions for the MySQL data layer.
 *
 * Models keep their familiar definition syntax ({ type: String, enum, default,
 * ref, required, select }). Each top-level scalar becomes a real MySQL column;
 * nested objects and arrays (timetables, line items, settings) are stored in
 * JSON columns and re-typed (Dates, ids) whenever they are read.
 */

export class ValidationError extends Error {
  constructor(errors) {
    super(`Validation failed: ${Object.values(errors).map((e) => e.message).join(', ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class CastError extends Error {
  constructor(kind, value, path) {
    super(`Cast to ${kind} failed for value "${typeof value === 'object' ? JSON.stringify(value) : value}" at path "${path}"`);
    this.name = 'CastError';
    this.kind = kind;
    this.value = value;
    this.path = path;
  }
}

const TYPES = new Map([[String, 'String'], [Number, 'Number'], [Boolean, 'Boolean'], [Date, 'Date'], [Object, 'Mixed'], [Map, 'Map']]);
const NAMED = new Set(['String', 'Number', 'Boolean', 'Date', 'ObjectId', 'Mixed', 'Map']);

function typeName(t) {
  if (TYPES.has(t)) return TYPES.get(t);
  if (typeof t === 'string' && NAMED.has(t)) return t;
  return null;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof String) && !(v instanceof RegExp);
const isLeafSpec = (v) => isPlainObject(v) && Object.prototype.hasOwnProperty.call(v, 'type')
  && (typeName(v.type) || Array.isArray(v.type) || v.type instanceof Schema);

/**
 * Field spec shapes:
 *   { kind: 'scalar', type, opts } | { kind: 'array', of, opts }
 *   { kind: 'object', fields, withId, opts } | { kind: 'map', of, opts } | { kind: 'mixed', opts }
 */
function parseArray(items, opts = {}) {
  const of = items.length ? parseField(items[0]) : { kind: 'mixed', opts: {} };
  if (of.kind === 'object' && of.withId === undefined) of.withId = true;   // array subdocuments get their own _id
  return { kind: 'array', of, opts };
}

export function parseField(v) {
  if (v instanceof Schema) return { kind: 'object', fields: v.fields, withId: v.options._id !== false, opts: {} };
  if (Array.isArray(v)) return parseArray(v);
  const t = typeName(v);
  if (t) return t === 'Mixed' ? { kind: 'mixed', opts: {} } : t === 'Map' ? { kind: 'map', of: { kind: 'mixed', opts: {} }, opts: {} } : { kind: 'scalar', type: t, opts: {} };
  if (isLeafSpec(v)) {
    const { type, ...opts } = v;
    if (Array.isArray(type)) return parseArray(type, opts);
    if (type instanceof Schema) return { ...parseField(type), opts };
    const tn = typeName(type);
    if (tn === 'Map') return { kind: 'map', of: opts.of ? parseField(opts.of) : { kind: 'mixed', opts: {} }, opts };
    if (tn === 'Mixed') return { kind: 'mixed', opts };
    return { kind: 'scalar', type: tn, opts };
  }
  if (isPlainObject(v)) {
    return { kind: 'object', fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, parseField(x)])), withId: undefined, opts: {} };
  }
  return { kind: 'mixed', opts: {} };
}

export class Schema {
  constructor(definition = {}, options = {}) {
    this.options = options;
    this.fields = {};
    this.methods = {};
    this.virtuals = {};
    this.indexList = [];
    this.hooks = [];
    this.add(definition);
  }

  add(definition) {
    for (const [k, v] of Object.entries(definition)) this.fields[k] = parseField(v);
    return this;
  }

  index(fields, opts = {}) { this.indexList.push({ fields, opts }); return this; }

  /** [[fields, options], ...] including single-field index/unique declarations. */
  indexes() {
    const single = Object.entries(this.fields)
      .filter(([, s]) => s.opts?.index || s.opts?.unique)
      .map(([k, s]) => [{ [k]: 1 }, s.opts.unique ? { unique: true } : {}]);
    return [...single, ...this.indexList.map(({ fields, opts }) => [fields, opts])];
  }

  path(name) { return this.pathSpec(name) || undefined; }

  pre(ops, fn) {
    for (const op of [].concat(ops)) this.hooks.push({ op, fn });
    return this;
  }

  post() { return this; }

  plugin(fn, opts) { fn(this, opts); return this; }

  set() { return this; }

  virtual(name) {
    const schema = this;
    return { get(fn) { schema.virtuals[name] = fn; return this; } };
  }

  /** Spec at a dotted path, walking into nested objects and arrays. */
  pathSpec(path) {
    if (path === '_id') return { kind: 'scalar', type: 'ObjectId', opts: {} };
    let fields = this.fields;
    let spec = null;
    for (const part of path.split('.')) {
      if (spec?.kind === 'array') { spec = spec.of; if (/^\d+$/.test(part)) continue; fields = spec.fields; }
      if (spec?.kind === 'map' || spec?.kind === 'mixed') return { kind: 'mixed', opts: {} };
      if (part === '_id' && spec) return { kind: 'scalar', type: 'ObjectId', opts: {} };
      spec = fields?.[part];
      if (!spec) return null;
      if (spec.kind === 'object') fields = spec.fields;
    }
    return spec;
  }
}

Schema.Types = { ObjectId: 'ObjectId', Mixed: 'Mixed', String, Number, Boolean, Date, Map };

// ------------------------------------------------------------------- casting

export function castScalar(type, v, path) {
  if (v === undefined || v === null) return v;
  if (v instanceof String) v = v.valueOf();
  switch (type) {
    case 'String':
      if (isPlainObject(v) && v._id !== undefined) return String(v._id);
      return String(v);
    case 'Number': {
      if (v === '') return null;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(n)) throw new CastError('Number', v, path);
      return n;
    }
    case 'Boolean':
      if (typeof v === 'string') return v === 'true' || v === '1';
      return Boolean(v);
    case 'Date': {
      if (v instanceof Date) return v;
      const d = new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
      if (Number.isNaN(d.getTime())) throw new CastError('Date', v, path);
      return d;
    }
    case 'ObjectId': {
      if (isPlainObject(v) && v._id !== undefined) v = v._id;
      const s = String(v);
      if (!ID_RE.test(s)) throw new CastError('ObjectId', v, path);
      return s.toLowerCase();
    }
    default:
      return v;
  }
}

/** Casts a value to its spec. `write` applies lowercase/trim and assigns subdocument ids. */
export function castValue(spec, v, path, write = false) {
  if (v === undefined || v === null || !spec) return v;
  switch (spec.kind) {
    case 'scalar': {
      let out = castScalar(spec.type, v, path);
      if (write && typeof out === 'string') {
        if (spec.opts.trim) out = out.trim();
        if (spec.opts.lowercase) out = out.toLowerCase();
        if (spec.opts.uppercase) out = out.toUpperCase();
      }
      return out;
    }
    case 'array': {
      const arr = Array.isArray(v) ? v : [v];
      return arr.map((el, i) => {
        const c = castValue(spec.of, el, `${path}.${i}`, write);
        if (spec.of.kind === 'object' && spec.of.withId && c && typeof c === 'object' && c._id == null) c._id = newId();
        return c;
      });
    }
    case 'object': {
      if (!isPlainObject(v)) return v;
      const out = {};
      if (v._id != null) out._id = String(v._id);
      for (const [k, sub] of Object.entries(spec.fields)) {
        if (v[k] !== undefined) out[k] = castValue(sub, v[k], `${path}.${k}`, write);
      }
      return out;
    }
    case 'map': {
      const obj = v instanceof Map ? Object.fromEntries(v) : v;
      if (!isPlainObject(obj)) return obj;
      return Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, castValue(spec.of, x, `${path}.${k}`, write)]));
    }
    default:
      return v instanceof Map ? Object.fromEntries(v) : v;
  }
}

// ------------------------------------------------------------------ defaults

const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone) : isPlainObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);

function hasDefaults(fields) {
  return Object.values(fields).some((s) => s.opts?.default !== undefined || (s.kind === 'object' && hasDefaults(s.fields)));
}

/** Fills in missing defaults (in place), including inside nested objects and array subdocuments. */
export function applyDefaults(fields, obj) {
  for (const [k, spec] of Object.entries(fields)) {
    if (obj[k] === undefined) {
      if (spec.opts?.default !== undefined) {
        const d = spec.opts.default;
        obj[k] = typeof d === 'function' ? d() : clone(d);
      } else if (spec.kind === 'array') {
        obj[k] = [];
      } else if (spec.kind === 'object' && hasDefaults(spec.fields)) {
        obj[k] = {};
      }
    }
    const v = obj[k];
    if (spec.kind === 'object' && isPlainObject(v)) applyDefaults(spec.fields, v);
    if (spec.kind === 'array' && Array.isArray(v) && spec.of.kind === 'object') {
      for (const el of v) if (isPlainObject(el)) applyDefaults(spec.of.fields, el);
    }
  }
  return obj;
}

// ---------------------------------------------------------------- validation

export function validateFields(fields, obj, prefix = '', errors = {}) {
  for (const [k, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj?.[k];
    const req = spec.opts?.required;
    const required = typeof req === 'function' ? req.call(obj) : Array.isArray(req) ? req[0] : req;
    if (required && (v === undefined || v === null || (spec.type === 'String' && v === ''))) {
      errors[path] = { path, kind: 'required', message: `Path \`${path}\` is required.` };
      continue;
    }
    if (v === undefined || v === null) continue;
    if (spec.kind === 'scalar') {
      const en = spec.opts?.enum;
      const values = Array.isArray(en) ? en : en?.values;
      if (values && !values.includes(v)) errors[path] = { path, kind: 'enum', message: `\`${v}\` is not a valid enum value for path \`${path}\`.` };
      if (typeof v === 'number') {
        const min = Array.isArray(spec.opts?.min) ? spec.opts.min[0] : spec.opts?.min;
        const max = Array.isArray(spec.opts?.max) ? spec.opts.max[0] : spec.opts?.max;
        if (min != null && v < min) errors[path] = { path, kind: 'min', message: `Path \`${path}\` (${v}) is less than minimum allowed value (${min}).` };
        if (max != null && v > max) errors[path] = { path, kind: 'max', message: `Path \`${path}\` (${v}) is more than maximum allowed value (${max}).` };
      }
    } else if (spec.kind === 'object' && isPlainObject(v)) {
      validateFields(spec.fields, v, path, errors);
    } else if (spec.kind === 'array' && Array.isArray(v) && spec.of.kind === 'object') {
      v.forEach((el, i) => validateFields(spec.of.fields, el, `${path}.${i}`, errors));
    } else if (spec.kind === 'array' && Array.isArray(v) && spec.of.kind === 'scalar' && spec.of.opts?.enum) {
      const values = Array.isArray(spec.of.opts.enum) ? spec.of.opts.enum : spec.of.opts.enum.values;
      v.forEach((el, i) => { if (!values.includes(el)) errors[`${path}.${i}`] = { path: `${path}.${i}`, kind: 'enum', message: `\`${el}\` is not a valid enum value for path \`${path}\`.` }; });
    }
  }
  return errors;
}

/** Dotted paths declared `select: false` (hidden unless asked for with "+path"). */
export function hiddenPaths(fields, prefix = '') {
  const out = [];
  for (const [k, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (spec.opts?.select === false) out.push(path);
    else if (spec.kind === 'object') out.push(...hiddenPaths(spec.fields, path));
  }
  return out;
}

export { isPlainObject, clone };
