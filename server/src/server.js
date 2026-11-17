import http from 'node:http';
import { Server as SocketServer } from 'socket.io';

import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { registerListeners } from './services/listeners.js';
import { verifyAccess } from './utils/tokens.js';
import { User } from './models/index.js';
import db from './db/index.js';
import { ensureSuperAdmin } from './seed/ensureSuperAdmin.js';

const app = createApp();
const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: { origin: env.clientUrl, credentials: true },
});

/**
 * Sockets carry live queue data, so they authenticate the same way the REST
 * API does. Room membership comes from the user record, never the client.
 * Patients only join their own room — they never receive clinic-wide events.
 */
io.use(async (socket, next) => {
  try {
    const payload = verifyAccess(socket.handshake.auth?.token);
    const user = await User.findById(payload.sub).select('role clinicId doctorId isActive').lean();
    if (!user?.isActive) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const { _id, role, clinicId, doctorId } = socket.data.user;
  socket.join(`user:${_id}`);
  if (role !== 'PATIENT' && clinicId) socket.join(`clinic:${clinicId}`);
  if (doctorId) socket.join(`doctor:${doctorId}`);
});

registerListeners({ io });

await connectDb();
await ensureSuperAdmin();
// MySQL has no TTL indexes: clear expired OTPs and old job/webhook logs hourly.
const purge = () => db.purgeExpired().catch((e) => console.error('Purge failed:', e.message));
purge();
setInterval(purge, 60 * 60 * 1000).unref();
server.listen(env.port, () => {
  console.log(`ClinicSaathi API on http://localhost:${env.port} (${env.nodeEnv})`);
});

const shutdown = async () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
