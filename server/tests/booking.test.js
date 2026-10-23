/**
 * Booking correctness: real availability, schedule validation, the
 * double-booking guard under concurrency, cancellation, rescheduling and
 * patient change-policy cutoffs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { setup, makeClinic, patientLogin, firstSlot } from './helpers.js';

const ctx = await setup('booking');
const C = await makeClinic(ctx, { slug: 'book' });
const docId = String(C.doctor._id);
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
test.after(() => ctx.teardown());

const book = (body) => ctx.api('POST', '/public/book/appointments', { body: { doctorId: docId, consentGiven: true, ...body } });

test('availability comes from the schedule and excludes breaks', async () => {
  const r = await ctx.api('GET', `/public/book/availability?doctorId=${docId}&date=${tomorrow}`);
  assert.equal(r.status, 200);
  const hours = r.data.slots.map((s) => dayjs(s.startAt).format('HH:mm'));
  assert.equal(hours[0], '09:00');
  assert.ok(!hours.some((h) => h >= '13:00' && h < '14:00'), 'break slots offered');
  assert.equal(r.data.slots.length, 28, '8h at 15min minus a 1h break');
});

test('times outside the schedule or in the past are rejected', async () => {
  const threeAm = dayjs(tomorrow).hour(3).toISOString();
  const r1 = await book({ startAt: threeAm, name: 'Night Owl', phone: '+919700000001' });
  assert.equal(r1.status, 400);
  assert.equal(r1.body.code, 'OUTSIDE_SCHEDULE');
  const offGrid = dayjs(tomorrow).hour(9).minute(7).toISOString();
  assert.equal((await book({ startAt: offGrid, name: 'Odd Time', phone: '+919700000002' })).body.code, 'OUTSIDE_SCHEDULE');
  const past = dayjs().subtract(1, 'hour').toISOString();
  assert.equal((await book({ startAt: past, name: 'Late', phone: '+919700000003' })).body.code, 'SLOT_IN_PAST');
  const breakTime = dayjs(tomorrow).hour(13).minute(15).toISOString();
  assert.equal((await book({ startAt: breakTime, name: 'Lunch', phone: '+919700000004' })).body.code, 'OUTSIDE_SCHEDULE');
});

test('two simultaneous bookings for one slot: exactly one wins', async () => {
  const startAt = await firstSlot(ctx, 'book', docId);
  const results = await Promise.all([
    book({ startAt, name: 'Racer One', phone: '+919700000011' }),
    book({ startAt, name: 'Racer Two', phone: '+919700000012' }),
    book({ startAt, name: 'Racer Three', phone: '+919700000013' }),
  ]);
  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status === 409);
  assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(lost.length, 2);
  assert.ok(lost.every((r) => r.body.code === 'SLOT_UNAVAILABLE'));
  assert.match(won[0].data.bookingRef, /^CS-[A-Z0-9]{6}$/);
  const after = await ctx.api('GET', `/public/book/availability?doctorId=${docId}&date=${tomorrow}`);
  assert.ok(!after.data.slots.some((s) => s.startAt === startAt), 'taken slot still offered');
});

test('bookings of different lengths cannot overlap', async () => {
  // A 30-minute service at 10:00 must block the 10:15 single slot.
  const ten = dayjs(tomorrow).hour(10).minute(0).second(0).millisecond(0).toISOString();
  const long = await book({ startAt: ten, serviceId: String(C.service._id), name: 'Long Visit', phone: '+919700000021' });
  assert.equal(long.status, 201, JSON.stringify(long.body));
  const tenFifteen = dayjs(tomorrow).hour(10).minute(15).second(0).millisecond(0).toISOString();
  const clash = await book({ startAt: tenFifteen, name: 'Short Visit', phone: '+919700000022' });
  assert.equal(clash.status, 409);
  const avail = await ctx.api('GET', `/public/book/availability?doctorId=${docId}&date=${tomorrow}`);
  const hours = avail.data.slots.map((s) => dayjs(s.startAt).format('HH:mm'));
  assert.ok(!hours.includes('10:00') && !hours.includes('10:15'));
});

test('concurrent overlapping bookings of different lengths never both succeed', async () => {
  const at = (h, m) => dayjs(tomorrow).hour(h).minute(m).second(0).millisecond(0).toISOString();
  const results = await Promise.all([
    book({ startAt: at(11, 0), serviceId: String(C.service._id), name: 'Overlap A', phone: '+919700000031' }),
    book({ startAt: at(11, 15), name: 'Overlap B', phone: '+919700000032' }),
  ]);
  assert.ok(results.filter((r) => r.status === 201).length <= 1, JSON.stringify(results.map((r) => r.status)));
});

test('cancelling frees the slot for someone else', async () => {
  const startAt = dayjs(tomorrow).hour(12).minute(0).second(0).millisecond(0).toISOString();
  const first = await book({ startAt, name: 'Cancel Me', phone: '+919700000041' });
  assert.equal(first.status, 201);
  const c = await ctx.api('POST', `/appointments/${first.data.appointmentId}/cancel`, { token: C.tokens.RECEPTIONIST, body: { reason: 'test' } });
  assert.equal(c.status, 200);
  assert.equal(c.data.status, 'CANCELLED');
  const again = await book({ startAt, name: 'Takes Over', phone: '+919700000042' });
  assert.equal(again.status, 201);
  const twice = await ctx.api('POST', `/appointments/${first.data.appointmentId}/cancel`, { token: C.tokens.RECEPTIONIST, body: {} });
  assert.equal(twice.status, 400);
});

test('rescheduling claims the new slot, frees the old one and re-plans reminders', async () => {
  const from = dayjs(tomorrow).hour(14).minute(0).second(0).millisecond(0).toISOString();
  const to = dayjs(tomorrow).hour(15).minute(0).second(0).millisecond(0).toISOString();
  const orig = await book({ startAt: from, name: 'Mover', phone: '+919700000051' });
  const r = await ctx.api('POST', `/appointments/${orig.data.appointmentId}/reschedule`, { token: C.tokens.RECEPTIONIST, body: { startAt: to } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(dayjs(r.data.startAt).toISOString(), to);
  assert.equal(r.data.status, 'CONFIRMED');
  assert.equal(r.data.bookingRef, orig.data.bookingRef, 'reference survives a reschedule');

  const old = await ctx.models.Appointment.findOne({ _id: orig.data.appointmentId }).setOptions({ clinicId: C.clinic._id });
  assert.equal(old.status, 'RESCHEDULED');
  assert.equal(old.slotKey, null);
  assert.equal(String(old.rescheduledTo), String(r.data._id));

  // The old slot is bookable again; the new one is not.
  assert.equal((await book({ startAt: from, name: 'Gets Old Slot', phone: '+919700000052' })).status, 201);
  assert.equal((await book({ startAt: to, name: 'Too Late', phone: '+919700000053' })).status, 409);

  // Moving into a taken slot fails and leaves the original untouched.
  const taken = await ctx.api('POST', `/appointments/${r.data._id}/reschedule`, { token: C.tokens.RECEPTIONIST, body: { startAt: from } });
  assert.equal(taken.status, 409);
  const still = await ctx.models.Appointment.findOne({ _id: r.data._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(still.status, 'CONFIRMED');

  await new Promise((res) => setTimeout(res, 300));
  const msg = await ctx.models.Communication.findOne({ event: 'APPOINTMENT_RESCHEDULED', patientId: r.data.patientId }).setOptions({ clinicId: C.clinic._id });
  assert.ok(msg, 'reschedule notice recorded');
  // Redis is off in tests, so the new reminder jobs are recorded as not queued — never silently lost.
  const jobs = await ctx.models.JobEvent.find({ jobId: new RegExp(`^reminder:${r.data._id}`) });
  assert.ok(jobs.length >= 1, 'reminder scheduling for the new time was attempted');
});

test('patients can only change bookings before the clinic cutoff', async () => {
  const p = await patientLogin(ctx, 'book', '+919700000061', 'Policy Pat');
  const soon = dayjs().add(1, 'hour').second(0).millisecond(0);
  const appt = await ctx.models.Appointment.create({
    clinicId: C.clinic._id, patientId: p.user.patientId, doctorId: C.doctor._id,
    startAt: soon.toDate(), endAt: soon.add(15, 'minute').toDate(), durationMins: 15, slotKey: `soon-${Date.now()}`, status: 'CONFIRMED',
  });
  const r = await ctx.api('POST', `/portal/appointments/${appt._id}/cancel`, { token: p.accessToken, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'POLICY_CUTOFF');
  const staff = await ctx.api('POST', `/appointments/${appt._id}/cancel`, { token: C.tokens.RECEPTIONIST, body: {} });
  assert.equal(staff.status, 200, 'staff can still cancel inside the cutoff');
});

test('clinic holidays close the booking calendar', async () => {
  const day = dayjs().add(3, 'day').format('YYYY-MM-DD');
  const h = await ctx.api('POST', '/clinics/me/holidays', { token: C.tokens.CLINIC_OWNER, body: { date: day, reason: 'Diwali' } });
  assert.equal(h.status, 200);
  const r = await ctx.api('GET', `/public/book/availability?doctorId=${docId}&date=${day}`);
  assert.equal(r.data.slots.length, 0);
  assert.match(r.data.reason, /Diwali/);
});

test('the tenant filter is mandatory at the model layer', async () => {
  await assert.rejects(() => ctx.models.Appointment.find({ doctorId: C.doctor._id }), /Tenant filter missing/);
});
