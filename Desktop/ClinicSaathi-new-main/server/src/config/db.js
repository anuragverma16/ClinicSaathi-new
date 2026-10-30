import db from '../db/index.js';
import '../models/index.js';   // registers every table before they are created
import { env } from './env.js';

/** Connects to MySQL, creating the database and any missing tables/columns. */
export async function connectDb(retries = 5, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await db.connect(env.mysql);
      if (env.nodeEnv !== 'test') console.log(`MySQL connected (${env.mysql.user}@${env.mysql.host}:${env.mysql.port}/${env.mysql.database})`);
      return db.connection;
    } catch (error) {
      if (attempt === retries) throw error;
      console.log(`MySQL connection failed (attempt ${attempt}/${retries}): ${error.message}. Retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export const disconnectDb = () => db.disconnect();
