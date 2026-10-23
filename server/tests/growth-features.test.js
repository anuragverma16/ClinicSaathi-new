import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { setup, makeClinic } from './helpers.js';

const ctx = await setup('growth');
const A = await makeClinic(ctx, { slug: 'grow' });
test.after(() => ctx.teardown());

test('WhatsApp "Hi" shows the menu, and menu options answer from clinic data', async () => {
  const { handleMessage } = await import('../src/ai/receptionist.js');
  const { AIConversation, Clinic } = ctx.models;
  await Clinic.updateOne({ _id: A.clinic._id }, {
    address: { line1: '12 MG Road', city: 'Pune' },
    patientInfo: { emergencyContact: '+91 98000 11111', parking: 'Free basement parking', mapUrl: 'https://maps.example/x' },
  });
  const convo = await AIConversation.create({ clinicId: A.clinic._id, channel: 'WHATSAPP', phone: '+919811111111' });
  const say = (text) => handleMessage({ clinicId: A.clinic._id, clinicName: 'Clinic grow', conversationId: convo._id, phone: '+919811111111', text });

  const hi = await say('Hi');
  assert.match(hi.reply, /1\. Book Appointment/);
  assert.match(hi.reply, /7\. Emergency Contact/);
  assert.match((await say('5')).reply, /12 MG Road[\s\S]*maps\.example/);
  await say('menu');
  assert.match((await say('6')).reply, /Dr grow.*₹500/);
  await say('hello');
  assert.match((await say('7')).reply, /108[\s\S]*98000 11111/);
  assert.match((await say('is there parking?')).reply, /basement/);
});

test('emergency walk-ins jump the queue and are filterable', async () => {
  const normal = await ctx.api('POST', '/appointments/walk-in', { token: A.tokens.RECEPTIONIST, body: { doctorId: String(A.doctor._id), newPatient: { name: 'Calm Patient', phone: '9822222222' } } });
  assert.equal(normal.status, 201, JSON.stringify(normal.body));
  const urgent = await ctx.api('POST', '/appointments/walk-in', { token: A.tokens.RECEPTIONIST, body: { doctorId: String(A.doctor._id), newPatient: { name: 'Urgent Patient', phone: '9833333333' }, emergency: true } });
  assert.equal(urgent.status, 201, JSON.stringify(urgent.body));
  assert.equal(urgent.data.appointment.isEmergency, true);

  const list = await ctx.api('GET', '/appointments?emergency=true', { token: A.tokens.RECEPTIONIST });
  assert.deepEqual(list.data.map((a) => String(a._id)), [String(urgent.data.appointment._id)]);
  if (urgent.data.token && normal.data.token) assert.ok(urgent.data.token.priority > normal.data.token.priority);
});

test('doctors get a private calendar feed that Google/Outlook can subscribe to', async () => {
  const link = await ctx.api('GET', `/doctors/${A.doctor._id}/calendar-feed`, { token: A.tokens.DOCTOR });
  assert.equal(link.status, 200);
  const path = new URL(link.data.url).pathname.replace(/^\/api/, '');
  const feed = await ctx.api('GET', path);
  assert.equal(feed.status, 200);
  assert.match(feed.body, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT[\s\S]*END:VCALENDAR/);
  assert.equal((await ctx.api('GET', '/public/calendar/not-a-token.ics')).status, 404);
  // Receptionists can't pull a doctor's feed.
  assert.equal((await ctx.api('GET', `/doctors/${A.doctor._id}/calendar-feed`, { token: A.tokens.RECEPTIONIST })).status, 403);
});

test('analytics include repeat, retention, monthly revenue and channel breakdown', async () => {
  const r = await ctx.api('GET', `/analytics/overview?from=${dayjs().subtract(7, 'day').format('YYYY-MM-DD')}&to=${dayjs().format('YYYY-MM-DD')}`, { token: A.tokens.CLINIC_OWNER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok('repeatPatientRate' in r.data.kpis);
  assert.ok('retentionRate' in r.data.kpis);
  assert.ok(Array.isArray(r.data.charts.revenueByMonth));
  assert.ok(r.data.charts.bookingsBySource.some((b) => b.source === 'WALK_IN'));
});

test('birthday greetings go only to consenting patients, once a day', async () => {
  const { runGreetings } = await import('../src/services/dailyAutomation.service.js');
  const { Clinic, Patient, Communication } = ctx.models;
  await Clinic.updateOne({ _id: A.clinic._id }, { 'notificationSettings.events.birthday': true });
  const dob = dayjs().subtract(30, 'year').toDate();
  await Patient.create({ clinicId: A.clinic._id, name: 'Birthday Yes', phone: '+919844444444', dob, consent: { dataProcessing: { granted: true }, marketing: { granted: true } } });
  await Patient.create({ clinicId: A.clinic._id, name: 'Birthday No', phone: '+919855555555', dob, consent: { dataProcessing: { granted: true }, marketing: { granted: false } } });
  await runGreetings();
  await runGreetings();
  const sent = await Communication.find({ event: 'BIRTHDAY_WISH' }).setOptions({ clinicId: A.clinic._id }).lean();
  assert.equal(sent.length, 2, 'one record per patient, no duplicates on re-run');
  assert.equal(sent.filter((c) => c.status !== 'FAILED').length, 1, 'only the consenting patient is messaged');
});

test('replies to a follow-up check-in are classified and concerns escalate to staff', async () => {
  const { handleMessage } = await import('../src/ai/receptionist.js');
  const { AIConversation, Patient, FollowUp } = ctx.models;
  const patient = await Patient.create({ clinicId: A.clinic._id, name: 'Rahul Follow', phone: '+919866666666', consent: { dataProcessing: { granted: true } } });
  const fu = await FollowUp.create({ clinicId: A.clinic._id, patientId: patient._id, doctorId: A.doctor._id, dueDate: new Date(), status: 'SENT' });
  const convo = await AIConversation.create({ clinicId: A.clinic._id, channel: 'WHATSAPP', phone: '+919866666666', patientId: patient._id });
  const out = await handleMessage({ clinicId: A.clinic._id, clinicName: 'Clinic grow', conversationId: convo._id, patientId: patient._id, phone: '+919866666666', text: 'Still having pain in the evening' });
  assert.equal(out.escalate, true);
  assert.match(out.reply, /Reply 1 to book/);
  const saved = await FollowUp.findOne({ _id: fu._id }).setOptions({ clinicId: A.clinic._id });
  assert.equal(saved.status, 'ESCALATED');
  assert.equal(saved.aiClassification, 'CONCERN');
});
