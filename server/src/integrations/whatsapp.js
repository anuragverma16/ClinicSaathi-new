import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { recordStub } from './stubOutbox.js';

const META_API = 'https://graph.facebook.com/v20.0';

function nexsahayRecipient(to) {
  const recipient = String(to || '').trim();
  // Preserve group/contact JIDs (e.g. 919876543210@s.whatsapp.net or @g.us)
  if (recipient.includes('@')) return recipient;

  // Strip all non-digits (spaces, +, -, etc.)
  const digits = recipient.replace(/\D/g, '');
  if (!digits) return '';

  // Auto-prepend India country code '91' if a standard 10-digit mobile number is passed
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

async function sendViaNexSahay({ to, body }) {
  if (!body || !String(body).trim()) {
    throw new Error('NexSahay supports plain-text messages. A message body is required.');
  }

  const { apiBase, apiKey, sessionId } = env.whatsapp.nexsahay;
  if (!apiBase || !apiKey || !sessionId) {
    throw new Error('NexSahay is selected but NEXSAHAY_API_BASE, NEXSAHAY_API_KEY, or NEXSAHAY_SESSION_ID is missing.');
  }

  const recipient = nexsahayRecipient(to);
  if (!recipient) throw new Error('A valid WhatsApp recipient number is required.');

  const response = await fetch(`${apiBase}/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      sessionId,
      to: recipient,
      message: String(body).trim(),
    }),
  });

  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`NexSahay returned an invalid JSON response (HTTP ${response.status}).`);
  }

  if (!response.ok || result.success !== true || result.data?.sent !== true) {
    const reason = result.message || result.error || `HTTP ${response.status}`;
    throw new Error(`NexSahay WhatsApp send failed: ${String(reason).slice(0, 300)}`);
  }

  return {
    messageId: result.data.waMessageId || result.data.messageId,
    providerMessageId: result.data.messageId,
    provider: 'nexsahay',
  };
}

/**
 * Sends a WhatsApp message through the configured provider.
 * NexSahay supports plain-text messages; Meta Cloud API supports both approved
 * templates and free-form text (subject to Meta's 24-hour service-window rules).
 */
export async function sendWhatsApp({ to, templateName, variables = {}, body, languageCode = 'en' }) {
  if (!env.whatsapp.enabled) {
    console.log(`[whatsapp:stub] -> ${to} :: ${templateName || body}`);
    recordStub({ channel: 'WHATSAPP', to, templateName, variables, body });
    return { messageId: `stub_${Date.now()}`, stub: true };
  }

  if (env.whatsapp.provider === 'nexsahay') {
    const resolvedBody = body || (templateName ? `${templateName}: ${Object.values(variables).join(', ')}` : '');
    return sendViaNexSahay({ to, body: resolvedBody });
  }

  if (env.whatsapp.provider !== 'meta') {
    throw new Error(`Unsupported WHATSAPP_PROVIDER: ${env.whatsapp.provider}`);
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

  const res = await fetch(`${META_API}/${env.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { messageId: data.messages?.[0]?.id, provider: 'meta' };
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