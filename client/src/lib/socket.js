import { io } from 'socket.io-client';
import { getAccessToken } from './api.js';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  // auth as a function: every reconnect sends the current (possibly refreshed) token.
  socket = io('/', { auth: (cb) => cb({ token: getAccessToken() }), transports: ['websocket'] });
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to one or more socket events for the life of a component. */
export function onSocket(events, handler) {
  const s = getSocket();
  if (!s) return () => {};
  const list = Array.isArray(events) ? events : [events];
  list.forEach((e) => s.on(e, handler));
  return () => list.forEach((e) => s.off(e, handler));
}
