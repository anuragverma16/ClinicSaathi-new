import db from '../db/index.js';

const auditLogSchema = new db.Schema({
  clinicId: { type: db.Schema.Types.ObjectId, ref: 'Clinic', index: true },
  branchId: db.Schema.Types.ObjectId,
  actorUserId: { type: db.Schema.Types.ObjectId, ref: 'User', index: true },
  actorRole: String,
  action: { type: String, required: true, index: true },   // APPOINTMENT_CANCELLED
  entityType: String,
  entityId: db.Schema.Types.ObjectId,
  before: db.Schema.Types.Mixed,
  after: db.Schema.Types.Mixed,
  ip: String,
  userAgent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ clinicId: 1, createdAt: -1 });
export const AuditLog = db.model('AuditLog', auditLogSchema);
