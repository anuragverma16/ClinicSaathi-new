import { Router } from 'express';
import { Clinic, Patient, AIConversation, Communication, WebhookEvent } from '../../models/index.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { verifyWebhook, verifyWhatsAppSignature, sendWhatsApp } from '../../integrations/whatsapp.js';
import { verifyWebhookSignature } from '../../integrations/razorpay.js';
import { handleMessage } from '../../ai/receptionist.js';
import { emit, EVENTS } from '../../services/events.js';
import { settleGatewayPayment, markGatewayPaymentFailed, settleGatewayRefund } from '../../services/payment.service.js';
import { env } from '../../config/env.js';
import { sha256 } from '../../utils/tokens.js';

const router = Router();

/** Records an event id once. Returns false if this delivery was already seen. */
async function firstDelivery(provider, eventId, eventType) {
  try {
    await WebhookEvent.create({ provider, eventId, eventType });
    return true;
  } catch (e) {
    if (e.code === 11000) return false;
    throw e;
  }
}

// ------------------------------------------------------------------ WhatsApp

/** Meta calls this once to verify the callback URL. */
router.get('/whatsapp', (req, res) => {
  if (verifyWebhook(req)) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];
const STATUS_MAP = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };

async function clinicForNumber(phoneNumberId) {
  const clinic = await Clinic.findOne({ 'integrations.whatsappPhoneNumberId': phoneNumberId, isActive: true });
  if (clinic) return clinic;
  // Explicit dev mapping only — an unknown number never falls through to some other clinic.
  if (env.nodeEnv !== 'production' && env.whatsapp.devClinicSlug) {
    return Clinic.findOne({ slug: env.whatsapp.devClinicSlug, isActive: true });
  }
  return null;
}

router.post('/whatsapp', catchAsync(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyWhatsAppSignature(raw, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
  // Acknowledge immediately — Meta retries anything slower than a few seconds.
  res.sendStatus(200);

  let body;
  try { body = JSON.parse(raw.toString()); } catch { return; }
  const value = body.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;

  // Delivery receipts update the matching outbound message.
  for (const s of value.statuses || []) {
    const status = STATUS_MAP[s.status];
    if (!status || !s.id) continue;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    await Communication.updateOne(
      { providerMessageId: s.id },
      { status, ...(status === 'DELIVERED' ? { deliveredAt: at } : {}), ...(status === 'READ' ? { readAt: at } : {}),
        ...(status === 'FAILED' ? { error: s.errors?.[0]?.title || 'Delivery failed' } : {}) }
    ).setOptions({ crossTenant: true });
  }

  const message = value.messages?.[0];
  if (!message) return;
  if (!(await firstDelivery('WHATSAPP', message.id, 'message'))) return;

  const clinic = await clinicForNumber(value.metadata?.phone_number_id);
  if (!clinic) return;
  const clinicId = clinic._id;
  const from = message.from;
  const text = message.text?.body || message.interactive?.button_reply?.title || '';
  const phoneVariants = [from, `+${from}`, from.replace(/^91/, '')];
  const patient = await Patient.findOne({ phone: { $in: phoneVariants }, guardianPatientId: { $exists: false } }).setOptions({ clinicId });

  await Communication.create({ clinicId, patientId: patient?._id, channel: 'WHATSAPP', event: 'INBOUND', direction: 'INBOUND', to: from, body: text, status: 'RECEIVED' });

  if (STOP_WORDS.includes(text.trim().toLowerCase())) {
    if (patient) {
      await Patient.updateOne({ _id: patient._id }, { 'communicationPrefs.optOutAll': true, 'communicationPrefs.optedOutAt': new Date() }).setOptions({ clinicId });
    }
    await sendWhatsApp({ to: from, body: `You won't receive further messages from ${clinic.name}. Reply START to opt back in.` });
    return;
  }
  if (text.trim().toLowerCase() === 'start' && patient) {
    await Patient.updateOne({ _id: patient._id }, { 'communicationPrefs.optOutAll': false }).setOptions({ clinicId });
  }

  let convo = await AIConversation.findOne({ externalId: sha256(`${clinicId}:${from}`) }).setOptions({ clinicId });
  if (!convo) {
    convo = await AIConversation.create({ clinicId, externalId: sha256(`${clinicId}:${from}`), channel: 'WHATSAPP', patientId: patient?._id, messages: [] });
  }

  try {
    const { reply, escalate, reason } = await handleMessage({
      clinicId, clinicName: clinic.name, conversationId: convo._id,
      patientId: patient?._id, phone: patient ? undefined : `+${from.replace(/^\+/, '')}`, text, channel: 'WHATSAPP',
    });
    // Inbound message opened the 24h window, so a free-form reply is allowed here.
    await sendWhatsApp({ to: from, body: reply });
    if (escalate) emit(EVENTS.AI_ESCALATED, { clinicId, reason });
  } catch (err) {
    console.error('WhatsApp handler failed:', err.message);
    await sendWhatsApp({ to: from, body: 'Sorry, something went wrong. Our staff will get back to you shortly.' });
    emit(EVENTS.AI_ESCALATED, { clinicId, reason: 'ERROR' });
  }
}));

// ------------------------------------------------------------------ Razorpay

/**
 * Razorpay webhook. Signature is checked against the exact raw bytes, each
 * event id is processed once, and settlement itself is conditional — so
 * retries and duplicate deliveries can never credit a payment twice.
 */
router.post('/razorpay', catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ success: false, message: 'Invalid signature', code: 'BAD_SIGNATURE' });
  }
  const event = JSON.parse(req.body.toString());
  const eventId = req.headers['x-razorpay-event-id'] || sha256(req.body);
  if (!(await firstDelivery('RAZORPAY', eventId, event.event))) {
    return res.status(200).json({ success: true, duplicate: true });
  }

  const payEntity = event.payload?.payment?.entity;
  try {
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      if (payEntity?.order_id) {
        await settleGatewayPayment({ orderId: payEntity.order_id, gatewayPaymentId: payEntity.id, via: 'WEBHOOK', raw: payEntity });
      }
    } else if (event.event === 'payment.failed' && payEntity?.order_id) {
      await markGatewayPaymentFailed({ orderId: payEntity.order_id, reason: payEntity.error_description });
    } else if (event.event?.startsWith('refund.')) {
      const refund = event.payload?.refund?.entity;
      if (refund?.id) await settleGatewayRefund({ gatewayRefundId: refund.id, status: refund.status });
    }
  } catch (e) {
    // Forget the delivery so Razorpay's retry is processed; settlement itself is idempotent.
    await WebhookEvent.deleteOne({ provider: 'RAZORPAY', eventId });
    throw e;
  }
  await WebhookEvent.updateOne({ provider: 'RAZORPAY', eventId }, { processedAt: new Date() });
  res.status(200).json({ success: true });
}));

export default router;
