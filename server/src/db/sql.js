import mysql from 'mysql2/promise';
import { isPlainObject } from './schema.js';
import { norm } from './matcher.js';

/**
 * MySQL connection, table definitions and filter → WHERE translation.
 *
 * Every model is one table: `id` CHAR(24) primary key, one column per
 * top-level field (VARCHAR/TEXT, DOUBLE, TINYINT(1), DATETIME(3), CHAR(24)),
 * JSON columns for nested objects/arrays, and the model's indexes.
 */

let pool = null;
let config = null;
export const registry = new Map();          // modelName -> Model
export const byCollection = new Map();       // "doctors" / "doctors" table -> Model
const uniqueIndexFields = new Map();         // index name -> [fields]

export const q = (name) => `\`${String(name).replace(/`/g, '``')}\``;

export function getPool() {
  if (!pool) throw new Error('MySQL is not connected. Call connectDb() first.');
  return pool;
}
export const isConnected = () => Boolean(pool);

/** TINYINT(1) → boolean; everything else uses mysql2's defaults (JSON parsed, DATETIME → Date). */
function typeCast(field, next) {
  if (field.type === 'TINY' && field.length === 1) {
    const v = field.string();
    return v === null ? null : v === '1';
  }
  return next();
}

export async function connect(cfg) {
  config = cfg;
  const admin = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
  // Managed hosts create the database for you and often withhold CREATE privileges,
  // so only try to create it when it's actually missing.
  const [existing] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [cfg.database]);
  if (!existing.length) await admin.query(`CREATE DATABASE ${q(cfg.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await admin.end();
  pool = mysql.createPool({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    connectionLimit: cfg.connectionLimit || 10, timezone: 'Z', dateStrings: false, typeCast, charset: 'utf8mb4_bin',
  });
  await ensureTables();
  return pool;
}

export async function disconnect() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

export async function rawQuery(sql, params = [], conn = null) {
  try {
    const [rows] = await (conn || getPool()).query(sql, params);
    return rows;
  } catch (e) {
    throw mapError(e);
  }
}

/** Duplicate-key errors keep the shape the app already handles (code 11000 + keyPattern). */
export function mapError(e) {
  if (e?.errno === 1062 || e?.code === 'ER_DUP_ENTRY') {
    const key = /for key '([^']+)'/.exec(e.message)?.[1]?.split('.').pop();
    const fields = uniqueIndexFields.get(key) || [key];
    const err = new Error(`Duplicate key: ${e.message}`);
    err.code = 11000;
    err.keyPattern = Object.fromEntries(fields.map((f) => [f, 1]));
    err.keyValue = {};
    err.sqlMessage = e.message;
    return err;
  }
  return e;
}

// ------------------------------------------------------------------- DDL

function columnType(spec, indexed) {
  if (spec.kind !== 'scalar') return 'JSON';
  switch (spec.type) {
    case 'String': return indexed ? 'VARCHAR(191)' : 'TEXT';
    case 'Number': return 'DOUBLE';
    case 'Boolean': return 'TINYINT(1)';
    case 'Date': return 'DATETIME(3)';
    case 'ObjectId': return 'CHAR(24)';
    default: return 'JSON';
  }
}

function indexedFields(schema) {
  const set = new Set();
  for (const [k, spec] of Object.entries(schema.fields)) if (spec.opts?.index || spec.opts?.unique) set.add(k);
  for (const { fields } of schema.indexList) for (const [k, v] of Object.entries(fields)) if (v !== 'text') set.add(k);
  return set;
}

const isIndexable = (spec) => spec && spec.kind === 'scalar' && spec.type !== 'Mixed';

function partialCondition(expr) {
  if (!expr) return 'TRUE';
  return Object.entries(expr).map(([f, c]) => {
    if (isPlainObject(c) && c.$type !== undefined) return `${q(f)} IS NOT NULL`;
    if (isPlainObject(c) && c.$exists !== undefined) return c.$exists ? `${q(f)} IS NOT NULL` : `${q(f)} IS NULL`;
    if (isPlainObject(c) && Array.isArray(c.$in)) return `${q(f)} IN (${c.$in.map((v) => mysql.escape(v)).join(', ')})`;
    if (isPlainObject(c) && c.$gt !== undefined) return `${q(f)} > ${mysql.escape(c.$gt)}`;
    return `${q(f)} <=> ${mysql.escape(c)}`;
  }).join(' AND ');
}

function keyExpr(field, spec) {
  if (spec?.type === 'Date') return `IFNULL(DATE_FORMAT(${q(field)}, '%Y-%m-%d %H:%i:%s.%f'), '~')`;
  if (spec?.type === 'Number' || spec?.type === 'Boolean') return `IFNULL(CAST(${q(field)} AS CHAR), '~')`;
  return `IFNULL(${q(field)}, '~')`;
}

/** CREATE TABLE statement for a model (also used to write database/schema.sql). */
export function tableDDL(Model) {
  const { schema, table } = Model;
  const indexed = indexedFields(schema);
  const lines = ['  `id` CHAR(24) NOT NULL'];
  const keys = ['  PRIMARY KEY (`id`)'];

  for (const [name, spec] of Object.entries(schema.fields)) {
    if (name === '_id') continue;
    lines.push(`  ${q(name)} ${columnType(spec, indexed.has(name))} NULL`);
    if (!isIndexable(spec)) continue;
    if (spec.opts?.unique) {
      const ix = `uq_${table}_${name}`;
      uniqueIndexFields.set(ix, [name]);
      keys.push(`  UNIQUE KEY ${q(ix)} (${q(name)})`);
    } else if (spec.opts?.index) {
      keys.push(`  KEY ${q(`ix_${table}_${name}`)} (${q(name)})`);
    }
  }

  schema.indexList.forEach(({ fields, opts }, i) => {
    const names = Object.keys(fields).filter((f) => fields[f] !== 'text' && (f === 'clinicId' || isIndexable(schema.fields[f])));
    if (!names.length) return;
    const cols = names.map((f) => (f === '_id' ? 'id' : f));
    if (opts.unique) {
      // Unique (and partial-unique) indexes go through a generated key column so a
      // missing value still counts and conditional uniqueness works in MySQL.
      const gen = `uq_key_${i}`;
      const ix = `uq_${table}_${i}`;
      uniqueIndexFields.set(ix, cols);
      const concat = `CONCAT_WS('|', ${cols.map((c) => keyExpr(c, schema.fields[c])).join(', ')})`;
      lines.push(`  ${q(gen)} VARCHAR(600) GENERATED ALWAYS AS (IF(${partialCondition(opts.partialFilterExpression)}, ${concat}, NULL)) STORED`);
      keys.push(`  UNIQUE KEY ${q(ix)} (${q(gen)})`);
    } else if (!opts.expireAfterSeconds) {
      keys.push(`  KEY ${q(`ix_${table}_${i}`)} (${cols.map(q).join(', ')})`);
    }
  });

  return `CREATE TABLE IF NOT EXISTS ${q(table)} (\n${[...lines, ...keys].join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`;
}

/** Creates missing tables and adds columns for fields added to a model since. */
export async function ensureTables() {
  for (const Model of registry.values()) {
    await rawQuery(tableDDL(Model));
    const existing = new Set((await rawQuery(
      'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [config.database, Model.table],
    )).map((r) => r.c));
    const indexed = indexedFields(Model.schema);
    for (const [name, spec] of Object.entries(Model.schema.fields)) {
      if (!existing.has(name)) await rawQuery(`ALTER TABLE ${q(Model.table)} ADD COLUMN ${q(name)} ${columnType(spec, indexed.has(name))} NULL`);
    }
  }
}

/**
 * Deletes rows past their expiry for models that declare
 * index({ field: 1 }, { expireAfterSeconds }) — OTP codes, job and webhook logs.
 */
export async function purgeExpired() {
  let removed = 0;
  for (const Model of registry.values()) {
    for (const { fields, opts } of Model.schema.indexList) {
      if (!opts.expireAfterSeconds) continue;
      const [field] = Object.keys(fields);
      if (!Model.schema.fields[field]) continue;
      const r = await rawQuery(`DELETE FROM ${q(Model.table)} WHERE ${q(field)} < (UTC_TIMESTAMP(3) - INTERVAL ? SECOND)`, [opts.expireAfterSeconds]);
      removed += r.affectedRows || 0;
    }
  }
  return removed;
}

/** Empties every table (tests use this between runs). */
export async function clearAll() {
  await rawQuery('SET FOREIGN_KEY_CHECKS = 0');
  for (const Model of registry.values()) await rawQuery(`TRUNCATE TABLE ${q(Model.table)}`);
  await rawQuery('SET FOREIGN_KEY_CHECKS = 1');
}

// ------------------------------------------------------ filter → WHERE

function param(v, type) {
  v = norm(v);
  if (v && typeof v === 'object' && !(v instanceof Date) && v._id !== undefined) v = String(v._id);
  if (type === 'Boolean') return v ? 1 : 0;
  return v;
}

const isOpObject = (c) => isPlainObject(c) && Object.keys(c).length > 0 && Object.keys(c).every((k) => k.startsWith('$'));

function scalarCondition(col, type, cond) {
  const c = q(col);
  if (cond instanceof RegExp) return null;
  if (!isOpObject(cond)) {
    if (cond === null || cond === undefined) return { sql: `${c} IS NULL`, params: [] };
    if (Array.isArray(cond) || (isPlainObject(cond) && cond._id === undefined)) return null;
    return { sql: `${c} = ?`, params: [param(cond, type)] };
  }
  const parts = [];
  const params = [];
  for (const [op, v] of Object.entries(cond)) {
    switch (op) {
      case '$eq':
        if (v === null) parts.push(`${c} IS NULL`);
        else if (v instanceof RegExp || Array.isArray(v) || isPlainObject(v)) return null;
        else { parts.push(`${c} = ?`); params.push(param(v, type)); }
        break;
      case '$ne':
        if (v === null) parts.push(`${c} IS NOT NULL`);
        else if (v instanceof RegExp || Array.isArray(v) || isPlainObject(v)) return null;
        else { parts.push(`(${c} <> ? OR ${c} IS NULL)`); params.push(param(v, type)); }
        break;
      case '$gt': case '$gte': case '$lt': case '$lte': {
        if (v === null || v === undefined) { parts.push('FALSE'); break; }
        if (isPlainObject(v) || Array.isArray(v)) return null;
        parts.push(`${c} ${{ $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[op]} ?`);
        params.push(param(v, type));
        break;
      }
      case '$in': case '$nin': {
        if (!Array.isArray(v) || v.some((x) => x instanceof RegExp || isPlainObject(x))) return null;
        const vals = v.filter((x) => x !== null && x !== undefined);
        const hasNull = vals.length !== v.length;
        if (op === '$in') {
          const inSql = vals.length ? `${c} IN (${vals.map(() => '?').join(', ')})` : 'FALSE';
          parts.push(hasNull ? `(${inSql} OR ${c} IS NULL)` : inSql);
        } else {
          const ninSql = vals.length ? `${c} NOT IN (${vals.map(() => '?').join(', ')})` : 'TRUE';
          parts.push(hasNull ? `(${ninSql} AND ${c} IS NOT NULL)` : `(${ninSql} OR ${c} IS NULL)`);
        }
        params.push(...vals.map((x) => param(x, type)));
        break;
      }
      case '$exists': parts.push(v ? `${c} IS NOT NULL` : `${c} IS NULL`); break;
      case '$type': parts.push(v === 'null' ? `${c} IS NULL` : `${c} IS NOT NULL`); break;
      default: return null;
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params };
}

/**
 * Translates as much of a filter as SQL can express. `exact` is false when
 * part of it (JSON paths, regex, array matching) must still be checked in
 * memory by matcher.matches().
 */
export function buildWhere(schema, filter = {}) {
  const parts = [];
  const params = [];
  let exact = true;
  for (const [k, cond] of Object.entries(filter || {})) {
    if (k === '$and') {
      for (const f of cond) {
        const r = buildWhere(schema, f);
        if (r.sql) { parts.push(`(${r.sql})`); params.push(...r.params); }
        exact = exact && r.exact;
      }
      continue;
    }
    if (k === '$or') {
      const rs = cond.map((f) => buildWhere(schema, f));
      if (rs.length && rs.every((r) => r.exact)) {
        parts.push(`(${rs.map((r) => (r.sql ? `(${r.sql})` : 'TRUE')).join(' OR ')})`);
        rs.forEach((r) => params.push(...r.params));
      } else exact = false;
      continue;
    }
    if (k.startsWith('$') || k.includes('.')) { exact = false; continue; }
    const spec = k === '_id' ? { kind: 'scalar', type: 'ObjectId' } : schema.fields[k];
    if (!spec || spec.kind !== 'scalar') { exact = false; continue; }
    const r = scalarCondition(k === '_id' ? 'id' : k, spec.type, cond);
    if (!r) { exact = false; continue; }
    parts.push(r.sql);
    params.push(...r.params);
  }
  return { sql: parts.join(' AND '), params, exact };
}

/** ORDER BY clause, or null when a sort key lives inside JSON (sorted in memory instead). */
export function buildOrderBy(schema, sort) {
  if (!sort?.length) return '`id` ASC';
  const parts = [];
  for (const [field, dir] of sort) {
    const spec = field === '_id' ? { kind: 'scalar' } : schema.fields[field];
    if (field.includes('.') || !spec || spec.kind !== 'scalar') return null;
    parts.push(`${q(field === '_id' ? 'id' : field)} ${dir < 0 ? 'DESC' : 'ASC'}`);
  }
  if (!sort.some(([f]) => f === '_id')) parts.push('`id` ASC');
  return parts.join(', ');
}
