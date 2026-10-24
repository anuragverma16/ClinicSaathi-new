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
export async function sendWhatsApp({ to, templateName, variables = {}, body, languageCode = 'en' }) {
  if (!env.whatsapp.enabled) {
    console.log(`[whatsapp:stub] -> ${to} :: ${templateName || body}`);
    recordStub({ channel: 'WHATSAPP', to, templateName, variables, body });
    return { messageId: `stub_${Date.now()}`, stub: true };
  }

  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to,
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
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body } };

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
