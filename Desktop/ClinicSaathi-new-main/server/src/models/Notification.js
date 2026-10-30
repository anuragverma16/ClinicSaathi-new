import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const notificationSchema = new db.Schema({
  userId: { type: db.Schema.Types.ObjectId, ref: 'User', index: true },
  role: String,                       // broadcast to a role when userId is absent
  type: { type: String, required: true },
  title: String,
  body: String,
  link: String,
  isRead: { type: Boolean, default: false, index: true },
}, { timestamps: true });

notificationSchema.plugin(tenantScope);
export const Notification = db.model('Notification', notificationSchema);
