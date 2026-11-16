import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';

const aiConversationSchema = new db.Schema({
  channel: { type: String, enum: ['WHATSAPP', 'WEB'], default: 'WHATSAPP' },
  externalId: { type: String, index: true },      // hash of clinic + WhatsApp wa_id, or portal user id
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient' },
  // Free-form replies are only allowed inside WhatsApp's 24h service window.
  lastInboundAt: Date,
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'tool', 'system'] },
    content: String,
    toolName: String,
    toolArgs: db.Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  }],
  state: { type: String, default: 'IDLE' },
  // Slots offered in the last turn, so "2" or "yes" can be resolved without guessing.
  pending: db.Schema.Types.Mixed,
  tokensUsed: { type: Number, default: 0 },
}, { timestamps: true });

aiConversationSchema.plugin(tenantScope);
export const AIConversation = db.model('AIConversation', aiConversationSchema);
