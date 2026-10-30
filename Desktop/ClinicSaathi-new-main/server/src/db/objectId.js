import crypto from 'node:crypto';

/**
 * Record ids: 24 hex characters (4-byte time + 5 random + 3-byte counter),
 * the same shape the API and frontend have always used. Time-prefixed, so
 * ordering by id is ordering by insertion.
 */
const PROCESS_RANDOM = crypto.randomBytes(5).toString('hex');
let counter = crypto.randomInt(0xffffff);

export const ID_RE = /^[a-f0-9]{24}$/i;

export function newId() {
  counter = (counter + 1) % 0xffffff;
  const time = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  return `${time}${PROCESS_RANDOM}${counter.toString(16).padStart(6, '0')}`;
}

export const isValidObjectId = (v) => v != null && ID_RE.test(String(v?._id ?? v));

/**
 * `new ObjectId(x)` support for older call sites. Instances are String
 * objects, so String(id), template literals and JSON all see the hex string.
 */
export class ObjectId extends String {
  constructor(v) {
    super(v === undefined ? newId() : String(v).toLowerCase());
  }

  equals(other) { return String(this) === String(other); }

  static isValid(v) { return isValidObjectId(v); }
}
