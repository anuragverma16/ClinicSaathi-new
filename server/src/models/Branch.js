import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const branchSchema = new db.Schema({
  name: { type: String, required: true },
  code: String,
  phone: String,
  address: { line1: String, city: String, state: String, pincode: String, lat: Number, lng: Number },
  timings: { workingDays: [Number], openTime: String, closeTime: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

branchSchema.plugin(tenantScope, { branchScoped: false });
export const Branch = db.model('Branch', branchSchema);
