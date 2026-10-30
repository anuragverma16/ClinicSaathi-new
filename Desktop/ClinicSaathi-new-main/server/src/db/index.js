import { Schema, ValidationError, CastError } from './schema.js';
import { model } from './model.js';
import { ObjectId, isValidObjectId } from './objectId.js';
import { connect, disconnect, clearAll, rawQuery, isConnected, registry, tableDDL, purgeExpired } from './sql.js';

/**
 * The app's database API, backed by MySQL. Models are declared with
 * `new db.Schema({...})` and `db.model(name, schema)`; `db.query(sql, params)`
 * runs hand-written SQL directly.
 */
const db = {
  Schema,
  model,
  Types: { ObjectId },
  isValidObjectId,
  Error: { ValidationError, CastError },
  connect,
  disconnect,
  query: rawQuery,
  models: registry,
  tableDDL,
  purgeExpired,
  set() { return db; },
  connection: {
    get readyState() { return isConnected() ? 1 : 0; },
    db: {
      /** Empties every table (used by the test suite). */
      dropDatabase: () => clearAll(),
      admin: () => ({ ping: () => rawQuery('SELECT 1') }),
    },
  },
};

export default db;
export { Schema, model, ObjectId, isValidObjectId, ValidationError, CastError, rawQuery as query };
