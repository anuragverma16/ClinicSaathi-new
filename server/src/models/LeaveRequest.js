import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

export const LEAVE_TYPES = ['CASUAL', 'SICK', 'EARNED', 'UNPAID', 'OTHER'];
export const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/**
 * A staff member's leave request. The clinic owner approves or rejects it;
 * only an approved doctor's leave closes their days for booking.
 * Dates are clinic-local YYYY-MM-DD strings, inclusive at both ends.
 */
const leaveRequestSchema = new db.Schema({
  userId: { type: db.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userName: { type: String, required: true },
  role: { type: String, required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor' },
  type: { type: String, enum: LEAVE_TYPES, default: 'CASUAL' },
  from: { type: String, required: true },
  to: { type: String, required: true },
  days: { type: Number, required: true },
  reason: { type: String, trim: true },
  status: { type: String, enum: LEAVE_STATUS, default: 'PENDING', index: true },
  reviewedBy: { type: db.Schema.Types.ObjectId, ref: 'User' },
  reviewedByName: String,
  reviewedAt: Date,
  reviewNote: { type: String, trim: true },
}, { timestamps: true });

leaveRequestSchema.plugin(tenantScope);
leaveRequestSchema.index({ clinicId: 1, status: 1, from: 1 });

export const LeaveRequest = db.model('LeaveRequest', leaveRequestSchema);
