import db from '../db/index.js';

/**
 * Atomic per-clinic sequence generator.
 *
 * Deriving an invoice number from countDocuments() is a race: two invoices
 * created in the same millisecond both read N and both write N+1, and the
 * unique index then 500s one of them. findOneAndUpdate with $inc is atomic,
 * so each caller gets a distinct number.
 */
const counterSchema = new db.Schema({
  key: { type: String, required: true, unique: true },   // "invoice:<clinicId>:2026"
  seq: { type: Number, default: 0 },
});

const Counter = db.model('Counter', counterSchema);

export async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
}

export { Counter };
