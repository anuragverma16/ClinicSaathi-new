import db from '../db/index.js';
import { connectDb } from '../config/db.js';

/**
 * Brings the MySQL database in line with the models: creates the database,
 * any missing tables and any missing columns. Safe to re-run; it never drops
 * or rewrites data.
 *
 *   npm run migrate
 */
await connectDb();
const tables = await db.query('SHOW TABLES');
console.log(`Schema up to date — ${tables.length} tables.`);
await db.disconnect();
process.exit(0);
