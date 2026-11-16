/**
 * Subscription entitlements, analytics fidelity, notification recording and
 * the AI booking assistant's guard-rails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { setup, makeClinic, makeSuperAdmin, patientLogin, firstSlot } from './helpers.js';

const ctx = await setup('platform');
const PRO = await makeClinic(ctx, { slug: 'pro', plan: 'PRO' });
const STARTER = await makeClinic(ctx, { slug: 'starter', plan: 'STARTER' });
const LAPSED = await makeClinic(ctx, { slug: 'lapsed', plan: 'GROWTH', status: 'TRIALING' });
await ctx.models.Subscription.updateOne({ clinicId: LAPSED.clinic._id }, { trialEndsAt: dayjs().subtract(1, 'day').toDate() });
const root = await makeSuperAdmin(ctx);
test.after(() => ctx.teardown());

test('plan features and limits are enforced by the API', async () => {
  const t = STARTER.tokens.CLINIC_OWNER;
  const doc = await ctx.api('POST', '/doctors', { token: t, body: { name: 'Dr Second' } });
  assert.equal(doc.status, 402);
  assert.equal(doc.body.code, 'PLAN_LIMIT_REACHED');
  const q = await ctx.api('GET', '/queue', { token: STARTER.tokens.RECEPTIONIST });
  assert.equal(q.status, 402);
  assert.equal(q.body.code, 'PLAN_UPGRADE_REQUIRED');
  assert.equal((await ctx.api('GET', '/billing/invoices', { token: STARTER.tokens.ACCOUNTANT })).status, 402);
  assert.equal((await ctx.api('GET', '/automation/campaigns', { token: PRO.tokens.CLINIC_OWNER })).status, 200);
  assert.equal((await ctx.api('GET', '/automation/campaigns', { token: t })).status, 402);
  const lapsed = await ctx.api('GET', '/queue', { token: LAPSED.tokens.RECEPTIONIST });
  assert.equal(lapsed.status, 402);
  assert.equal(lapsed.body.code, 'SUBSCRIPTION_INACTIVE', 'expired trial loses paid features');
  // Core booking keeps working for the lapsed clinic.
  assert.equal((await ctx.api('GET', '/appointments', { token: LAPSED.tokens.RECEPTIONIST })).status, 200);
  const me = await ctx.api('GET', '/auth/me', { token: t });
  assert.deepEqual(me.data.entitlements.features, ['booking', 'reminders', 'patients']);
});

test('super admin plan changes take effect on the server', async () => {
  const r = await ctx.api('PUT', '/platform/plans/STARTER', { token: root, body: { maxDoctors: 2 } });
  assert.equal(r.status, 200);
  const doc = await ctx.api('POST', '/doctors', { token: STARTER.tokens.CLINIC_OWNER, body: { name: 'Dr Second' } });
  assert.equal(doc.status, 201);
  await ctx.api('PUT', '/platform/plans/STARTER', { token: root, body: { maxDoctors: 1 } });
});

test('an empty clinic reports zeros, not sample data', async () => {
  const r = await ctx.api('GET', '/analytics/overview', { token: PRO.tokens.CLINIC_OWNER });
  assert.equal(r.status, 200);
  assert.equal(r.data.kpis.totalAppointments, 0);
  assert.equal(r.data.kpis.revenue, 0);
  assert.deepEqual(r.data.charts.revenueByDay, []);
  assert.equal(r.data.kpis.avgWaitMins, null);
});

test('analytics reflect actual records and respect role scope', async () => {
  const slugDoc = String(PRO.doctor._id);
  const s1 = await firstSlot(ctx, 'pro', slugDoc, { offset: 0 });
  const s2 = await firstSlot(ctx, 'pro', slugDoc, { offset: 1 });
  const b1 = await ctx.api('POST', '/public/pro/appointments', { body: { doctorId: slugDoc, startAt: s1, name: 'Ana One', phone: '+919400000001', consentGiven: true } });
  await ctx.api('POST', '/public/pro/appointments', { body: { doctorId: slugDoc, startAt: s2, name: 'Ben Two', phone: '+919400000002', consentGiven: true } });
  await ctx.api('POST', `/appointments/${b1.data.appointmentId}/cancel`, { token: PRO.tokens.RECEPTIONIST, body: {} });
  const inv = await ctx.api('POST', '/billing/invoices', { token: PRO.tokens.ACCOUNTANT, body: { appointmentId: b1.data.appointmentId } });
  await ctx.api('POST', `/billing/invoices/${inv.data._id}/record-payment`, { token: PRO.tokens.ACCOUNTANT, body: { amount: 500, method: 'CASH' } });

  const to = dayjs().add(2, 'day').format('YYYY-MM-DD');
  const r = await ctx.api('GET', `/analytics/overview?to=${to}`, { token: PRO.tokens.CLINIC_OWNER });
  assert.equal(r.data.kpis.totalAppointments, 2);
  assert.equal(r.data.kpis.cancelled, 1);
  assert.equal(r.data.kpis.cancellationRate, 50);
  assert.equal(r.data.kpis.revenue, 500);
  assert.equal(r.data.kpis.upcoming, 1);

  const acct = await ctx.api('GET', `/analytics/overview?to=${to}`, { token: PRO.tokens.ACCOUNTANT });
  assert.equal(acct.data.kpis.revenue, 500);
  assert.equal(acct.data.kpis.totalAppointments, undefined, 'accountants get financial analytics only');
  const filtered = await ctx.api('GET', `/analytics/overview?to=${to}&doctorId=${'0'.repeat(24)}`, { token: PRO.tokens.CLINIC_OWNER });
  assert.equal(filtered.data.kpis.totalAppointments, 0);
});

test('notifications are recorded — sends, opt-outs, and jobs that could not be queued', async () => {
  const slot = await firstSlot(ctx, 'pro', PRO.doctor._id, { offset: 3 });
  const b = await ctx.api('POST', '/public/pro/appointments', { body: { doctorId: String(PRO.doctor._id), startAt: slot, name: 'Note Taker', phone: '+919400000003', consentGiven: true } });
  await new Promise((r) => setTimeout(r, 300));
  const appt = await ctx.models.Appointment.findOne({ _id: b.data.appointmentId }).setOptions({ clinicId: PRO.clinic._id });
  const sent = await ctx.models.Communication.findOne({ patientId: appt.patientId, event: 'APPOINTMENT_CONFIRMED' }).setOptions({ clinicId: PRO.clinic._id });
  assert.equal(sent.status, 'SENT');
  const jobs = await ctx.models.JobEvent.find({ jobId: new RegExp(`^reminder:${appt._id}`) });
  assert.ok(jobs.length >= 1 && jobs.every((j) => j.status === 'ENQUEUE_FAILED'), 'reminders recorded as not queued while Redis is down');

  await ctx.models.Patient.updateOne({ _id: appt.patientId }, { 'communicationPrefs.optOutAll': true }).setOptions({ clinicId: PRO.clinic._id });
  await ctx.api('POST', `/appointments/${appt._id}/cancel`, { token: PRO.tokens.RECEPTIONIST, body: {} });
  await new Promise((r) => setTimeout(r, 300));
  const blocked = await ctx.models.Communication.findOne({ patientId: appt.patientId, event: 'APPOINTMENT_CANCELLED' }).setOptions({ clinicId: PRO.clinic._id });
  assert.equal(blocked.status, 'FAILED');
  assert.match(blocked.error, /opted out/);

  const health = await ctx.api('GET', '/platform/health', { token: root });
  assert.equal(health.status, 200);
  assert.ok(health.data.recentJobFailures.length >= 1);
  assert.equal(health.data.queue.redis, 'disabled');
  const integ = await ctx.api('GET', '/platform/integrations', { token: root });
  assert.ok(integ.data.every((i) => !JSON.stringify(i).match(/secret|token|key_/i)), 'no secrets in integration status');
});

test('AI assistant offers only real slots, books only on confirmation, and escalates emergencies', async () => {
  const p = await patientLogin(ctx, 'pro', '+919400000010', 'Asha Patient');
  const day = dayjs().add(1, 'day');
  const ask = await ctx.api('POST', '/portal/assistant', { token: p.accessToken, body: { message: `I need a dermatologist ${day.format('dddd')} after 2 pm` } });
  assert.equal(ask.status, 200, JSON.stringify(ask.body));
  assert.ok(ask.data.suggestions.length > 0, ask.data.reply);
  const avail = await ctx.api('GET', `/public/pro/availability?doctorId=${PRO.doctor._id}&date=${day.format('YYYY-MM-DD')}`);
  const real = new Set(avail.data.slots.map((s) => s.startAt));
  for (const s of ask.data.suggestions) {
    assert.ok(real.has(s.startAt), `invented slot ${s.startAt}`);
    assert.ok(dayjs(s.startAt).hour() >= 14, 'time window respected');
  }
  const before = await ctx.models.Appointment.countDocuments({ patientId: p.user.patientId }).setOptions({ clinicId: PRO.clinic._id });
  assert.equal(before, 0, 'nothing is booked before the patient confirms');
  await ctx.api('POST', '/portal/assistant', { token: p.accessToken, body: { message: '1' } });
  const yes = await ctx.api('POST', '/portal/assistant', { token: p.accessToken, body: { message: 'yes' } });
  assert.match(yes.data.reply, /Booked/);
  assert.ok(yes.data.booked?.bookingRef);

  const sos = await ctx.api('POST', '/portal/assistant', { token: p.accessToken, body: { message: 'my father has chest pain and is breathless' } });
  assert.equal(sos.data.emergency, true);
  assert.match(sos.data.reply, /108/);
  assert.equal(sos.data.suggestions.length, 0);
});

test('signed WhatsApp webhooks route by clinic number and STOP opts the patient out', async () => {
  const { env } = await import('../src/config/env.js');
  const crypto = await import('node:crypto');
  env.whatsapp.appSecret = 'wa_app_secret';
  await ctx.models.Clinic.updateOne({ _id: PRO.clinic._id }, { 'integrations.whatsappPhoneNumberId': '1234567890' });
  const pt = await ctx.models.Patient.create({ clinicId: PRO.clinic._id, name: 'WA User', phone: '+919400000020' });
  const payload = (text, id) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1234567890' }, messages: [{ id, from: '919400000020', text: { body: text } }] } }] }] });
  const post = (body, sig) => ctx.api('POST', '/webhooks/whatsapp', { raw: body, headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig } });
  const sign = (b) => `sha256=${crypto.createHmac('sha256', 'wa_app_secret').update(b).digest('hex')}`;

  const unsigned = payload('hi', 'wamid.1');
  assert.equal((await post(unsigned, 'sha256=bad')).status, 401);
  const stop = payload('STOP', 'wamid.2');
  assert.equal((await post(stop, sign(stop))).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const after = await ctx.models.Patient.findOne({ _id: pt._id }).setOptions({ clinicId: PRO.clinic._id });
  assert.equal(after.communicationPrefs.optOutAll, true);
  // A message to an unmapped number never lands in some other clinic.
  const stray = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'wamid.3', from: '919400000099', text: { body: 'hello' } }] } }] }] });
  await post(stray, sign(stray));
  await new Promise((r) => setTimeout(r, 200));
  const leaked = await ctx.models.Communication.countDocuments({ to: '919400000099' }).setOptions({ crossTenant: true });
  assert.equal(leaked, 0);
  env.whatsapp.appSecret = undefined;
});
