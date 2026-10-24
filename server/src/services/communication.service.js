import { Communication, Patient, Clinic } from '../models/index.js';
import { sendWhatsApp } from '../integrations/whatsapp.js';
import { sendEmail } from '../integrations/email.js';
import { sendSms } from '../integrations/sms.js';
import { checkQuota, recordUsage } from '../middleware/planGate.js';

/** Messages that need marketing consent on top of the transactional basis. */
const MARKETING_EVENTS = ['CAMPAIGN', 'REVIEW_REQUEST', 'RECALL', 'BIRTHDAY_WISH', 'FESTIVAL_GREETING'];

/** Event → the clinic setting that switches it on or off. */
const EVENT_SETTING = {
  APPOINTMENT_CONFIRMED: 'confirmation',
  APPOINTMENT_REMINDER: 'reminder',
  APPOINTMENT_CANCELLED: 'cancellation',
  APPOINTMENT_RESCHEDULED: 'reschedule',
  QUEUE_CALLED: 'queueCalled',
  FOLLOWUP: 'followUp',
  PAYMENT_REMINDER: 'paymentReminder',
  REVIEW_REQUEST: 'reviewRequest',
  BIRTHDAY_WISH: 'birthday',
  FESTIVAL_GREETING: 'festival',
  MEDICINE_REMINDER: 'medicineReminder',
  DOCUMENT_READY: 'documentReady',
};

const CHANNEL_PREF = { WHATSAPP: 'whatsapp', SMS: 'sms', EMAIL: 'email' };

async function skipped(base, reason) {
  return Communication.create({ ...base, status: 'FAILED', error: reason });
}

/**
 * Single entry point for every outbound patient message.
 *
 * WhatsApp rule that shapes this API: outside the 24-hour service window you
 * may only send a pre-approved template. Reminders, recall, campaigns and
 * review requests are all outbound, so they all need `templateName`. Clinics
 * may map an event to their own approved template name in Settings.
 *
 * Messages never carry clinical detail — documents are announced with a
 * pointer to the secure portal, not attached.
 */
export async function send({
  clinicId, patientId, channel, event, templateName, variables = {}, body, to, inReplyToPatient = false, campaignId,
}) {
  const [patient, clinic] = await Promise.all([
    patientId ? Patient.findOne({ _id: patientId }).setOptions({ clinicId }) : null,
    Clinic.findById(clinicId).select('notificationSettings name').lean(),
  ]);

  const destination = to || (channel === 'EMAIL' ? patient?.email : patient?.phone);
  const base = { clinicId, patientId, channel, event, to: destination, templateName, payload: variables, body };

  const settingKey = EVENT_SETTING[event];
  if (settingKey && clinic?.notificationSettings?.events?.[settingKey] === false) {
    return skipped(base, 'Disabled in clinic notification settings');
  }
  if (!destination) return skipped(base, `No ${channel === 'EMAIL' ? 'email' : 'phone'} on file`);

  // A reply to a message the patient just sent is always allowed; everything
  // else respects their opt-out and per-channel preferences.
  if (patient && !inReplyToPatient) {
    const prefs = patient.communicationPrefs || {};
    if (prefs.optOutAll) return skipped(base, 'Patient opted out of messages');
    if (prefs[CHANNEL_PREF[channel]] === false) return skipped(base, `Patient turned off ${channel.toLowerCase()} messages`);
    if (MARKETING_EVENTS.includes(event) && !patient.consent?.marketing?.granted) {
      return skipped(base, 'No marketing consent on file');
    }
  }

  const mapped = clinic?.notificationSettings?.templates?.[event];
  const finalTemplate = mapped || templateName;

  if (channel === 'WHATSAPP') {
    const quota = await checkQuota(clinicId, 'whatsapp');
    if (!quota.allowed) return skipped(base, 'WhatsApp quota exhausted for this billing period');
  }

  const record = await Communication.create({ ...base, templateName: finalTemplate, status: 'PENDING', ...(campaignId ? { campaignId } : {}) });

  try {
    let result;
    if (channel === 'WHATSAPP') result = await sendWhatsApp({ to: destination, templateName: finalTemplate, variables, body });
    else if (channel === 'EMAIL') result = await sendEmail({ to: destination, subject: `${clinic?.name || 'Clinic'}: ${event.replace(/_/g, ' ').toLowerCase()}`, body: body || Object.values(variables).join(' ') });
    else result = await sendSms({ to: destination, body: body || Object.values(variables).join(' ') });

    record.status = 'SENT';
    record.sentAt = new Date();
    record.providerMessageId = result?.messageId;
    await record.save();

    if (channel === 'WHATSAPP' && !result?.stub) await recordUsage(clinicId, 'whatsapp', 1);
  } catch (err) {
    record.status = 'FAILED';
    record.error = err.message.slice(0, 500);
    await record.save();
  }
  return record;
}
