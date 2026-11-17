import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { recordStub } from './stubOutbox.js';

const API = 'https://graph.facebook.com/v20.0';

/**
 * Meta WhatsApp Cloud API sender.
 *
 * Template vs free-form: a free-form `body` is only deliverable inside the
 * 24-hour customer service window opened by the patient's last inbound message.
 * Everything the clinic initiates must use an approved `templateName`.
 */
/** True when the selected provider has the settings it needs to send. */
export function whatsappReady() {
  if (env.whatsapp.provider === 'nexsahay') {
    const n = env.whatsapp.nexsahay;
    return Boolean(n.apiBase && n.apiKey && n.sessionId);
  }
  return env.whatsapp.enabled;
}

/**
 * Nexsahay gateway (docs: POST {base}/messages/send, header x-api-key, body
 * { sessionId, to, message }). Plain text only, so `body` is required.
 */
async function sendViaNexsahay({ to, body }) {
  if (!whatsappReady()) {
    throw new Error('Nexsahay is missing NEXSAHAY_API_BASE, NEXSAHAY_API_KEY or NEXSAHAY_SESSION_ID');
  }
  if (!body) throw new Error('Nexsahay sends plain text: a message body is required');

  const { apiBase, apiKey, sessionId } = env.whatsapp.nexsahay;
  const res = await fetch(`${apiBase}/messages/send`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    // Bare number with country code, no "+".
    body: JSON.stringify({ sessionId, to: String(to).replace(/\D/g, ''), message: body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`Nexsahay send failed (${res.status}): ${json.message || 'no details returned'}`);
  }
  return { messageId: json.data?.waMessageId || json.data?.messageId, sent: json.data?.sent === true };
}

export async function sendWhatsApp({ to, templateName, variables = {}, body, languageCode = 'en' }) {
  // Only the selected provider sends; Meta is never used as a fallback.
  if (env.nodeEnv !== 'test' && env.whatsapp.provider === 'nexsahay') return sendViaNexsahay({ to, body });

  if (env.nodeEnv === 'test' || !env.whatsapp.enabled) {
    const text = body || `[template ${templateName}] ${Object.values(variables).join(' ')}`;
    console.log(`[whatsapp:stub] -> ${to} :: ${text}`);
    recordStub({ channel: 'WHATSAPP', to, templateName, variables, body: text });
    return { messageId: `stub_${Date.now()}`, stub: true };
  }

  // Cloud API wants digits only, country code first (no "+").
  const recipient = String(to).replace(/\D/g, '');
  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [{
            type: 'body',
            parameters: Object.values(variables).map((v) => ({ type: 'text', text: String(v) })),
          }],
        },
      }
    : { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body } };

  const res = await fetch(`${API}/${env.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { messageId: data.messages?.[0]?.id };
}

export function verifyWebhook(req) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  return Boolean(env.whatsapp.verifyToken) && mode === 'subscribe' && token === env.whatsapp.verifyToken;
}

/**
 * Meta signs each delivery with HMAC-SHA256 of the raw body using the app
 * secret (X-Hub-Signature-256: sha256=<hex>). Without a configured secret the
 * webhook is only accepted outside production, so dev testing still works.
 */
export function verifyWhatsAppSignature(rawBody, header) {
  if (!env.whatsapp.appSecret) return env.nodeEnv !== 'production';
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsapp.appSecret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header || ''));
  } catch {
    return false;
  }
}
