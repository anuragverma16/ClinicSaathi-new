import db from '../db/index.js';

const systemSettingSchema = new db.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  value: { type: db.Schema.Types.Mixed, required: true },
  description: String,
  updatedByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const SystemSetting = db.model('SystemSetting', systemSettingSchema);
