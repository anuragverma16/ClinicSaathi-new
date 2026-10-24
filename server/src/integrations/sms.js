import { recordStub } from './stubOutbox.js';

export const smsEnabled = false;

export async function sendSms({ to, body }) {
  // Indian SMS needs a DLT-registered template + sender ID. Wire your provider here.
  console.log(`[sms:stub] -> ${to} :: ${body}`);
  recordStub({ channel: 'SMS', to, body });
  return { messageId: `stub_${Date.now()}`, stub: true };
}
