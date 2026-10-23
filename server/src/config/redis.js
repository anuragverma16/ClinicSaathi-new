import IORedis from 'ioredis';
import { env } from './env.js';

let client = null;
let warned = false;

/** Returns a shared Redis client. Use isRedisReady() before relying on it. */
export function getRedis() {
  if (client) return client;
  // REDIS_URL=disabled runs the API with background jobs switched off (tests, minimal dev).
  if (env.redisUrl === 'disabled') return null;
  client = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
    // Keep retrying slowly forever so Redis coming up later is picked up.
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  client.on('error', (e) => {
    if (!warned) { console.warn(`Redis unavailable (${e.message}). Background jobs are paused.`); warned = true; }
  });
  client.on('ready', () => { warned = false; console.log('Redis connected'); });
  return client;
}

export const isRedisReady = () => client?.status === 'ready';
export const redisStatus = () => (env.redisUrl === 'disabled' ? 'disabled' : client?.status || 'not-initialised');
