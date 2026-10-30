import { env } from '../config/env.js';
import { recordStub } from './stubOutbox.js';

/** Sends through Resend when RESEND_API_KEY + EMAIL_FROM are set; logs otherwise. */
export async function sendEmail({ to, subject, body }) {
  if (!env.email.enabled) {
    console.log(`[email:stub] -> ${to} :: ${subject}`);
    recordStub({ channel: 'EMAIL', to, subject, body });
    return { messageId: `stub_${Date.now()}`, stub: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.email.from, to, subject, text: body }),
  });
  if (!res.ok) throw new Error(`Email send failed (${res.status})`);
  const data = await res.json();
  return { messageId: data.id };
}
