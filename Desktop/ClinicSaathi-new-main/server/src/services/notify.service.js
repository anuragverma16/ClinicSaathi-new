import { Notification } from '../models/index.js';

let io = null;
export const setNotifyIo = (server) => { io = server; };

/**
 * In-app notification for staff (the bell in the top bar). Pass `userId` for
 * one person or `role` to reach everyone in that role at the clinic. Bodies
 * stay generic — no diagnoses or results in notification text.
 */
export async function notifyStaff({ clinicId, userId, role, type, title, body, link }) {
  try {
    const n = await Notification.create({ clinicId, userId, role, type, title, body, link });
    if (userId) io?.to(`user:${userId}`).emit('notification', { id: n._id, title });
    else io?.to(`clinic:${clinicId}`).emit('notification', { id: n._id, title, role });
    return n;
  } catch (e) {
    console.error('notifyStaff failed:', e.message);
    return null;
  }
}
