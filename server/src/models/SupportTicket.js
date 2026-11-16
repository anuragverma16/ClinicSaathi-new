import db from '../db/index.js';

const supportTicketSchema = new db.Schema({
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', index: true },
  subject: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], default: 'OPEN', index: true },
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
  createdByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
  assignedToUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const SupportTicket = db.model('SupportTicket', supportTicketSchema);
