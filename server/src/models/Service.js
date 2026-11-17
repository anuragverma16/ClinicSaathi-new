import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const serviceSchema = new db.Schema({
  name: { type: String, required: true },
  description: String,
  durationMins: { type: Number, default: 15 },
  fee: { type: Number, default: 0 },
  gstPercent: { type: Number, default: 0 },
  mode: { type: String, enum: ['OFFLINE', 'ONLINE', 'BOTH'], default: 'OFFLINE' },
  recallIntervalDays: Number,   // drives the recall engine, e.g. 180 for dental cleaning
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

serviceSchema.plugin(tenantScope);
export const Service = db.model('Service', serviceSchema);
