import { Worker } from 'bullmq';
import db from '../db/index.js';
import dayjs from 'dayjs';
import { env } from '../config/env.js';
import { connectDb } from '../config/db.js';
import { getRedis } from '../config/redis.js';
import { QUEUE_NAMES, queues } from '../jobs/queues.js';
import { runGreetings, runMedicineReminders } from '../services/dailyAutomation.service.js';
import { send } from '../services/communication.service.js';
import { Appointment, FollowUp, Recall, Invoice, Clinic, Campaign, JobEvent, Service } from '../models/index.js';
import { TZ } from '../utils/slots.js';

await connectDb();
const connection = getRedis();
if (!connection) {
  console.error('REDIS_URL is disabled — the worker needs Redis. Exiting.');
  process.exit(1);
}
const opts = { connection, concurrency: 5 };
const when = (d) => dayjs(d).tz(TZ).format('DD MMM, h:mm A');

/**
 * A send that was refused (opt-out, no consent, disabled) is a normal outcome
 * and is already recorded on the Communication row. Only provider errors
 * throw, so BullMQ retries them with backoff.
 */
function throwIfProviderFailed(record) {
  if (record?.status === 'FAILED' && /send failed|ECONN|timeout|fetch failed/i.test(record.error || '')) {
    throw new Error(record.error);
  }
}

const workers = [];
const on = (queue, handler) => {
  const w = new Worker(queue, handler, opts);
  w.on('failed', (job, err) => {
    // Recorded once retries are exhausted, for System Health.
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      JobEvent.create({ queue, jobName: job.name, jobId: job.id, clinicId: job.data?.clinicId, status: 'FAILED', error: err.message?.slice(0, 500), attemptsMade: job.attemptsMade })
        .catch(() => {});
    }
  });
  workers.push(w);
};

on(QUEUE_NAMES.appointmentReminder, async (job) => {
  const { appointmentId, clinicId, patientId, templateName } = job.data;
  const appt = await Appointment.findOne({ _id: appointmentId }).setOptions({ clinicId });
  // Don't remind someone about an appointment that moved or was cancelled.
  if (!appt || appt.status !== 'CONFIRMED') return;
  throwIfProviderFailed(await send({
    clinicId, patientId, channel: 'WHATSAPP', event: 'APPOINTMENT_REMINDER',
    templateName, variables: { date: when(appt.startAt), ref: appt.bookingRef || '' },
  }));
});

on(QUEUE_NAMES.followUp, async (job) => {
  const { followUpId, clinicId } = job.data;
  const fu = await FollowUp.findOne({ _id: followUpId }).setOptions({ clinicId });
  if (!fu || fu.status !== 'SCHEDULED') return;
  // Only the doctor-approved instructions travel in the message; nothing else clinical.
  const record = await send({
    clinicId, patientId: fu.patientId, channel: 'WHATSAPP', event: 'FOLLOWUP',
    templateName: 'followup_checkin', variables: { note: fu.instructions || 'your follow-up visit' },
  });
  throwIfProviderFailed(record);
  if (record.status === 'SENT') { fu.status = 'SENT'; await fu.save(); }
});

on(QUEUE_NAMES.recall, async (job) => {
  const { recallId, clinicId } = job.data;
  const recall = await Recall.findOne({ _id: recallId }).setOptions({ clinicId });
  if (!recall || recall.status !== 'DUE') return;
  const service = recall.serviceId ? await Service.findOne({ _id: recall.serviceId }).setOptions({ clinicId }).lean() : null;
  const record = await send({
    clinicId, patientId: recall.patientId, channel: 'WHATSAPP', event: 'RECALL',
    templateName: 'recall_due', variables: { service: recall.recallType || service?.name || 'your check-up' },
  });
  throwIfProviderFailed(record);
  if (record.status === 'SENT') {
    recall.status = 'NOTIFIED';
    recall.notifiedAt = new Date();
    await recall.save();
  }
});

on(QUEUE_NAMES.review, async (job) => {
  const { appointmentId, clinicId } = job.data;
  const appt = await Appointment.findOne({ _id: appointmentId }).setOptions({ clinicId });
  if (!appt || appt.status !== 'COMPLETED') return;
  const clinic = await Clinic.findById(clinicId).lean();
  // Every completed visit is asked the same way — no filtering for happy patients.
  if (!clinic?.reviewUrl) return;
  throwIfProviderFailed(await send({
    clinicId, patientId: appt.patientId, channel: 'WHATSAPP', event: 'REVIEW_REQUEST',
    templateName: 'review_request', variables: { clinic: clinic.name, link: clinic.reviewUrl },
  }));
});

on(QUEUE_NAMES.paymentReminder, async (job) => {
  const { invoiceId, clinicId } = job.data;
  const inv = await Invoice.findOne({ _id: invoiceId }).setOptions({ clinicId });
  if (!inv || ['PAID', 'REFUNDED', 'VOID'].includes(inv.status)) return;
  throwIfProviderFailed(await send({
    clinicId, patientId: inv.patientId, channel: 'WHATSAPP', event: 'PAYMENT_REMINDER',
    templateName: 'payment_reminder', variables: { amount: inv.total - inv.amountPaid, invoice: inv.invoiceNumber },
  }));
});

on(QUEUE_NAMES.campaign, async (job) => {
  const { campaignId, clinicId, patientId } = job.data;
  const campaign = await Campaign.findOne({ _id: campaignId }).setOptions({ clinicId });
  if (!campaign || !['SENDING', 'SENT'].includes(campaign.status)) return;
  throwIfProviderFailed(await send({
    clinicId, patientId, channel: 'WHATSAPP', event: 'CAMPAIGN', templateName: campaign.templateName, campaignId,
  }));
});

// Daily scans: birthday + festival greetings at 9:00, medicine reminders at 8:30 (clinic time).
on(QUEUE_NAMES.birthday, async () => runGreetings());
on(QUEUE_NAMES.medicineReminder, async () => runMedicineReminders());
await queues.birthday.add('daily-greetings', {}, { repeat: { pattern: '0 9 * * *', tz: TZ }, jobId: 'daily-greetings' });
await queues.medicineReminder.add('daily-medicine', {}, { repeat: { pattern: '30 8 * * *', tz: TZ }, jobId: 'daily-medicine' });

console.log('Workers running in', env.nodeEnv);

process.on('SIGTERM', async () => {
  await Promise.all(workers.map((w) => w.close()));
  await db.disconnect();
  process.exit(0);
});
