import db from '../db/index.js';
import '../models/index.js';   // registers every table before they are created
import { env } from './env.js';

/** Connects to MySQL, creating the database and any missing tables/columns. */
export async function connectDb() {
  await db.connect(env.mysql);
  if (env.nodeEnv !== 'test') console.log(`MySQL connected (${env.mysql.user}@${env.mysql.host}:${env.mysql.port}/${env.mysql.database})`);
  return db.connection;
}

export const disconnectDb = () => db.disconnect();
