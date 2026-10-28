import db from '../db/index.js';
import '../models/index.js';   // registers every table before they are created
import { env } from './env.js';

/** Connects to MySQL, creating the database and any missing tables/columns. */
export async function connectDb() {
  try {
    await db.connect(env.mysql);
  } catch (err) {
    // mysql2 often throws with an empty message, so name the target and the fix explicitly.
    const target = `${env.mysql.user}@${env.mysql.host}:${env.mysql.port}/${env.mysql.database}`;
    throw new Error(`Could not connect to MySQL at ${target} (${err.code || err.message || 'no error message'}). `
      + 'Set MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE in your host\'s environment settings.', { cause: err });
  }
  if (env.nodeEnv !== 'test') console.log(`MySQL connected (${env.mysql.user}@${env.mysql.host}:${env.mysql.port}/${env.mysql.database})`);
  return db.connection;
}

export const disconnectDb = () => db.disconnect();
