import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { isPlainObject, clone } from './schema.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * In-memory evaluation of query filters, update operators and report
 * expressions. SQL does the heavy filtering (see sql.js); this layer checks
 * the conditions SQL can't express (JSON paths, regex, array membership) and
 * runs the analytics pipelines over the rows SQL returned.
 */

export const norm = (v) => (v instanceof String ? v.valueOf() : v);
const isOpObject = (c) => isPlainObject(c) && Object.keys(c).length > 0 && Object.keys(c).every((k) => k.startsWith('$'));

/** All values at a dotted path, walking through arrays the way the filters expect. */
export function resolve(v, parts, i = 0) {
  if (i === parts.length) return [v];
  if (v === null || v === undefined) return [undefined];
  const key = parts[i];
  if (Array.isArray(v)) {
    if (/^\d+$/.test(key)) return resolve(v[Number(key)], parts, i + 1);
    const out = [];
    for (const el of v) out.push(...resolve(el, parts, i));
    return out.length ? out : [undefined];
  }
  if (typeof v !== 'object' || v instanceof Date) return [undefined];
  return resolve(v[key], parts, i + 1);
}

export function getPath(obj, path) {
  const vals = resolve(obj, path.split('.'));
  return vals.length === 1 ? vals[0] : vals;
}

function sortKey(v) {
  v = norm(v);
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** Ordering used by $sort and comparisons: missing/null first, then by value. */
export function compare(a, b) {
  a = sortKey(a); b = sortKey(b);
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function equal(a, b) {
  a = norm(a); b = norm(b);
  if (b instanceof RegExp) return typeof a === 'string' && b.test(a);
  if (b === null || b === undefined) return a === null || a === undefined;
  if (a === null || a === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : typeof a === 'string' || typeof a === 'number' ? new Date(a).getTime() : NaN;
    const tb = b instanceof Date ? b.getTime() : typeof b === 'string' || typeof b === 'number' ? new Date(b).getTime() : NaN;
    return ta === tb;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

const expand = (leaves) => leaves.flatMap((l) => (Array.isArray(l) ? [l, ...l] : [l]));
const eqAny = (leaves, cond) => (cond === null || cond === undefined
  ? leaves.some((l) => l === null || l === undefined)
  : expand(leaves).some((l) => equal(l, cond)));

function typeMatches(v, t) {
  v = norm(v);
  switch (t) {
    case 'string': case 2: return typeof v === 'string';
    case 'date': case 9: return v instanceof Date;
    case 'number': case 'double': case 'int': case 'long': case 1: case 16: return typeof v === 'number';
    case 'bool': case 8: return typeof v === 'boolean';
    case 'array': case 4: return Array.isArray(v);
    case 'object': case 3: return isPlainObject(v);
    case 'objectId': case 7: return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
    case 'null': case 10: return v === null;
    default: return false;
  }
}

function matchOp(leaves, op, val, cond) {
  const vals = expand(leaves).filter((l) => l !== undefined && l !== null);
  switch (op) {
    case '$eq': return eqAny(leaves, val);
    case '$ne': return !eqAny(leaves, val);
    case '$gt': return val !== null && vals.some((l) => compare(l, val) > 0);
    case '$gte': return val !== null && vals.some((l) => compare(l, val) >= 0);
    case '$lt': return val !== null && vals.some((l) => compare(l, val) < 0);
    case '$lte': return val !== null && vals.some((l) => compare(l, val) <= 0);
    case '$in': return (val || []).some((v) => (v instanceof RegExp ? vals.some((l) => typeof l === 'string' && v.test(l)) : eqAny(leaves, v)));
    case '$nin': return !(val || []).some((v) => (v instanceof RegExp ? vals.some((l) => typeof l === 'string' && v.test(l)) : eqAny(leaves, v)));
    case '$exists': return val ? leaves.some((l) => l !== undefined && l !== null) : leaves.every((l) => l === undefined || l === null);
    case '$regex': {
      const rx = val instanceof RegExp ? val : new RegExp(val, cond.$options || '');
      return vals.some((l) => typeof l === 'string' && rx.test(l));
    }
    case '$options': return true;
    case '$type': return [].concat(val).some((t) => leaves.some((l) => typeMatches(l, t)));
    case '$size': return leaves.some((l) => Array.isArray(l) && l.length === val);
    case '$all': return leaves.some((l) => Array.isArray(l) && val.every((v) => l.some((x) => equal(x, v))));
    case '$not': return !matchField(leaves, val);
    case '$elemMatch':
      return leaves.some((l) => Array.isArray(l) && l.some((el) => (isOpObject(val) ? matchField([el], val) : matches(el, val))));
    default:
      throw new Error(`Unsupported query operator ${op}`);
  }
}

function matchField(leaves, cond) {
  if (cond instanceof RegExp) return expand(leaves).some((l) => typeof l === 'string' && cond.test(l));
  if (isOpObject(cond)) return Object.entries(cond).every(([op, val]) => matchOp(leaves, op, val, cond));
  return eqAny(leaves, cond);
}

/** Does a record satisfy a filter? */
export function matches(doc, filter = {}) {
  for (const [k, cond] of Object.entries(filter || {})) {
    if (k === '$and') { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    if (k === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (k === '$nor') { if (cond.some((f) => matches(doc, f))) return false; continue; }
    if (k === '$expr') { if (!truthy(evalExpr(cond, doc))) return false; continue; }
    if (k === '$comment') continue;
    if (!matchField(resolve(doc, k.split('.')), cond)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ updates

export function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const key = Array.isArray(cur) && /^\d+$/.test(p) ? Number(p) : p;
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[key];
  }
  const last = parts.at(-1);
  cur[Array.isArray(cur) && /^\d+$/.test(last) ? Number(last) : last] = value;
}

function unsetPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur?.[parts[i]];
    if (cur === undefined || cur === null) return;
  }
  if (cur && typeof cur === 'object') delete cur[parts.at(-1)];
}

const readPath = (obj, path) => path.split('.').reduce((o, p) => (o === undefined || o === null ? undefined : o[p]), obj);

/**
 * Applies an update ({ $set, $unset, $inc, $push, $pull, $addToSet,
 * $setOnInsert, $min, $max } plus bare fields, which mean $set) to a record
 * in place. Returns the top-level fields it touched.
 */
export function applyUpdate(obj, update, { isInsert = false } = {}) {
  const touched = new Set();
  const top = (p) => touched.add(p.split('.')[0]);
  for (const [key, val] of Object.entries(update || {})) {
    if (!key.startsWith('$')) { setPath(obj, key, clone(val)); top(key); continue; }
    for (const [path, v] of Object.entries(val || {})) {
      switch (key) {
        case '$set': setPath(obj, path, clone(v)); break;
        case '$setOnInsert': if (isInsert) setPath(obj, path, clone(v)); break;
        case '$unset': unsetPath(obj, path); setPath(obj, path, undefined); break;
        case '$inc': setPath(obj, path, (Number(readPath(obj, path)) || 0) + Number(v)); break;
        case '$min': { const cur = readPath(obj, path); if (cur === undefined || compare(v, cur) < 0) setPath(obj, path, v); break; }
        case '$max': { const cur = readPath(obj, path); if (cur === undefined || compare(v, cur) > 0) setPath(obj, path, v); break; }
        case '$push': {
          const arr = Array.isArray(readPath(obj, path)) ? readPath(obj, path) : [];
          if (isPlainObject(v) && Array.isArray(v.$each)) arr.push(...v.$each.map(clone)); else arr.push(clone(v));
          if (isPlainObject(v) && typeof v.$slice === 'number') arr.splice(0, Math.max(0, arr.length - Math.abs(v.$slice)));
          setPath(obj, path, arr);
          break;
        }
        case '$addToSet': {
          const arr = Array.isArray(readPath(obj, path)) ? readPath(obj, path) : [];
          const items = isPlainObject(v) && Array.isArray(v.$each) ? v.$each : [v];
          for (const it of items) if (!arr.some((x) => equal(x, it))) arr.push(clone(it));
          setPath(obj, path, arr);
          break;
        }
        case '$pull': {
          const arr = readPath(obj, path);
          if (Array.isArray(arr)) {
            setPath(obj, path, arr.filter((el) => !(isPlainObject(v) && !(v instanceof Date)
              ? (isOpObject(v) ? matchField([el], v) : matches(el, v))
              : equal(el, v))));
          }
          break;
        }
        default:
          throw new Error(`Unsupported update operator ${key}`);
      }
      top(path);
    }
  }
  return touched;
}

// -------------------------------------------------------------- expressions

const truthy = (v) => !(v === false || v === null || v === undefined || v === 0);
const toDate = (v) => (v instanceof Date ? v : v === null || v === undefined ? null : new Date(v));
const num = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : v === null || v === undefined ? null : Number(v));

const FORMAT = { '%Y': 'YYYY', '%m': 'MM', '%d': 'DD', '%H': 'HH', '%M': 'mm', '%S': 'ss', '%L': 'SSS', '%j': 'DDDD', '%%': '%' };
function dateToString({ format = '%Y-%m-%dT%H:%M:%S.%LZ', date, timezone: tz }) {
  if (!date) return null;
  const d = tz ? dayjs(date).tz(tz) : dayjs(date).utc();
  let out = '';
  for (let i = 0; i < format.length; i += 1) {
    const token = FORMAT[format.slice(i, i + 2)];
    if (format[i] === '%' && token) { out += token === '%' ? '%' : d.format(token); i += 1; } else out += format[i];
  }
  return out;
}

/** Evaluates a report expression ("$field", { $sum: ... }, { $cond: ... }) against a record. */
export function evalExpr(expr, doc) {
  if (typeof expr === 'string' && expr.startsWith('$$')) return expr === '$$ROOT' ? doc : undefined;
  if (typeof expr === 'string' && expr.startsWith('$')) return getPath(doc, expr.slice(1));
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(e, doc));
  if (!isPlainObject(expr)) return expr;
  const keys = Object.keys(expr);
  if (keys.length !== 1 || !keys[0].startsWith('$')) {
    return Object.fromEntries(keys.map((k) => [k, evalExpr(expr[k], doc)]));
  }
  const [op] = keys;
  const raw = expr[op];
  const args = () => (Array.isArray(raw) ? raw.map((a) => evalExpr(a, doc)) : [evalExpr(raw, doc)]);
  switch (op) {
    case '$literal': return raw;
    case '$add': {
      const a = args();
      const dateArg = a.find((x) => x instanceof Date);
      const total = a.reduce((s, x) => s + (num(x) ?? 0), 0);
      return a.some((x) => x === null || x === undefined) ? null : dateArg ? new Date(total) : total;
    }
    case '$subtract': {
      const [a, b] = args();
      if (a === null || a === undefined || b === null || b === undefined) return null;
      const r = num(a) - num(b);
      return a instanceof Date && !(b instanceof Date) ? new Date(r) : r;
    }
    case '$multiply': { const a = args(); return a.some((x) => x == null) ? null : a.reduce((s, x) => s * num(x), 1); }
    case '$divide': { const [a, b] = args(); return a == null || b == null ? null : num(a) / num(b); }
    case '$mod': { const [a, b] = args(); return num(a) % num(b); }
    case '$round': { const [a, places = 0] = args(); if (a == null) return null; const f = 10 ** places; return Math.round(num(a) * f) / f; }
    case '$abs': { const [a] = args(); return a == null ? null : Math.abs(num(a)); }
    case '$eq': { const [a, b] = args(); return equal(a ?? null, b ?? null); }
    case '$ne': { const [a, b] = args(); return !equal(a ?? null, b ?? null); }
    case '$gt': { const [a, b] = args(); return compare(a, b) > 0; }
    case '$gte': { const [a, b] = args(); return compare(a, b) >= 0; }
    case '$lt': { const [a, b] = args(); return compare(a, b) < 0; }
    case '$lte': { const [a, b] = args(); return compare(a, b) <= 0; }
    case '$and': return args().every(truthy);
    case '$or': return args().some(truthy);
    case '$not': return !truthy(args()[0]);
    case '$cond': {
      const c = Array.isArray(raw) ? { if: raw[0], then: raw[1], else: raw[2] } : raw;
      return truthy(evalExpr(c.if, doc)) ? evalExpr(c.then, doc) : evalExpr(c.else, doc);
    }
    case '$ifNull': { const a = args(); return a.find((x) => x !== null && x !== undefined) ?? null; }
    case '$in': { const [v, arr] = args(); return (arr || []).some((x) => equal(x, v)); }
    case '$first': { const [a] = args(); return Array.isArray(a) ? (a.length ? a[0] : undefined) : a; }
    case '$last': { const [a] = args(); return Array.isArray(a) ? a.at(-1) : a; }
    case '$size': { const [a] = args(); return Array.isArray(a) ? a.length : 0; }
    case '$arrayElemAt': { const [a, i] = args(); return Array.isArray(a) ? a.at(i) : undefined; }
    case '$sum': { const a = args(); const list = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; return list.reduce((s, x) => s + (typeof x === 'number' ? x : 0), 0); }
    case '$avg': { const a = args(); const list = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).filter((x) => typeof x === 'number'); return list.length ? list.reduce((s, x) => s + x, 0) / list.length : null; }
    case '$max': { const a = args(); const list = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).filter((x) => x != null); return list.length ? list.reduce((m, x) => (compare(x, m) > 0 ? x : m)) : null; }
    case '$min': { const a = args(); const list = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).filter((x) => x != null); return list.length ? list.reduce((m, x) => (compare(x, m) < 0 ? x : m)) : null; }
    case '$toString': { const [a] = args(); return a == null ? null : a instanceof Date ? a.toISOString() : String(a); }
    case '$toLower': { const [a] = args(); return a == null ? '' : String(a).toLowerCase(); }
    case '$toUpper': { const [a] = args(); return a == null ? '' : String(a).toUpperCase(); }
    case '$concat': { const a = args(); return a.some((x) => x == null) ? null : a.join(''); }
    case '$type': { const [a] = args(); return a === undefined ? 'missing' : a === null ? 'null' : a instanceof Date ? 'date' : Array.isArray(a) ? 'array' : typeof a === 'number' ? 'double' : typeof a === 'boolean' ? 'bool' : typeof a === 'string' ? 'string' : 'object'; }
    case '$dateToString': {
      const o = isPlainObject(raw) ? raw : {};
      return dateToString({ format: o.format, date: toDate(evalExpr(o.date, doc)), timezone: o.timezone && evalExpr(o.timezone, doc) });
    }
    case '$year': case '$month': case '$dayOfMonth': case '$hour': case '$dayOfWeek': {
      const o = isPlainObject(raw) && raw.date !== undefined ? raw : { date: raw };
      const dv = toDate(evalExpr(o.date, doc));
      if (!dv) return null;
      const d = o.timezone ? dayjs(dv).tz(evalExpr(o.timezone, doc)) : dayjs(dv).utc();
      return { $year: d.year(), $month: d.month() + 1, $dayOfMonth: d.date(), $hour: d.hour(), $dayOfWeek: d.day() + 1 }[op];
    }
    default:
      throw new Error(`Unsupported expression operator ${op}`);
  }
}

export { truthy };
