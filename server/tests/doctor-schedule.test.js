/**
 * A doctor setting their own working days and hours for the dates ahead:
 * it beats the clinic's weekly pattern, reaches public booking immediately,
 * and tells the clinic what changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { setup, makeClinic } from './helpers.js';

const ctx = await setup('docsched');
const C = await makeClinic(ctx, { slug: 'docsched' });
const docId = String(C.doctor._id);
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
test.after(() => ctx.teardown());

const asDoctor = (method, path, body) => ctx.api(method, path, { token: C.tokens.DOCTOR, body });
const hoursOn = async (date) => {
  const r = await ctx.api('GET', `/public/docsched/availability?doctorId=${docId}&date=${date}`);
  return r.data.slots.map((s) => dayjs(s.startAt).format('HH:mm'));
};

test('the doctor reads their own schedule with the clinic weekly pattern to fall back on', async () => {
  const r = await asDoctor('GET', '/doctors/me/schedule');
  assert.equal(r.status, 200);
  assert.equal(r.data.availability.length, 7, 'weekly pattern comes back');
  assert.deepEqual(r.data.overrides, [], 'nothing set yet');
  assert.equal(r.data.today, dayjs().format('YYYY-MM-DD'));
});

test('hours the doctor sets replace the weekly pattern for booking straight away', async () => {
  const before = await hoursOn(tomorrow);
  assert.equal(before[0], '09:00');
  assert.ok(!before.includes('13:00'), 'weekly break applies before any override');

  const put = await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: tomorrow, windows: [{ startTime: '12:00', endTime: '15:00' }] }],
  });
  assert.equal(put.status, 200);

  const after = await hoursOn(tomorrow);
  assert.equal(after[0], '12:00');
  assert.equal(after.at(-1), '14:45');
  assert.equal(after.length, 12, '3h at 15min — the weekly 13:00 break does not cut into chosen hours');
  assert.ok(after.includes('13:00'), 'the doctor chose to work through the weekly break');
});

test('a day with no hours closes booking entirely', async () => {
  await asDoctor('PUT', '/doctors/me/schedule', { overrides: [{ date: tomorrow, windows: [] }] });
  assert.deepEqual(await hoursOn(tomorrow), []);
  const r = await ctx.api('GET', `/public/docsched/availability?doctorId=${docId}&date=${tomorrow}`);
  assert.match(r.data.reason, /not working/i);
});

test('clearing the override hands the date back to the clinic weekly pattern', async () => {
  await asDoctor('PUT', '/doctors/me/schedule', { overrides: [] });
  const back = await hoursOn(tomorrow);
  assert.equal(back[0], '09:00');
  assert.ok(!back.includes('13:00'), 'the weekly break is back in force');
});

test('a split shift produces both windows and nothing in between', async () => {
  await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: tomorrow, windows: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '17:00', endTime: '18:00' }] }],
  });
  const h = await hoursOn(tomorrow);
  assert.deepEqual(h, ['09:00', '09:15', '09:30', '09:45', '17:00', '17:15', '17:30', '17:45']);
});

test('past dates, far-future dates and overlapping hours are refused', async () => {
  const past = await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: dayjs().subtract(1, 'day').format('YYYY-MM-DD'), windows: [] }],
  });
  assert.equal(past.status, 400);
  assert.equal(past.body.code, 'DATE_IN_PAST');

  const far = await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: dayjs().add(200, 'day').format('YYYY-MM-DD'), windows: [] }],
  });
  assert.equal(far.status, 400);
  assert.equal(far.body.code, 'DATE_TOO_FAR');

  const overlap = await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: tomorrow, windows: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }] }],
  });
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.code, 'OVERLAPPING_WINDOWS');

  const backwards = await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: tomorrow, windows: [{ startTime: '15:00', endTime: '09:00' }] }],
  });
  assert.equal(backwards.status, 400, 'end before start is a validation error');
});

test('only a doctor can set a doctor schedule', async () => {
  for (const role of ['RECEPTIONIST', 'CLINIC_OWNER', 'ACCOUNTANT']) {
    const r = await ctx.api('PUT', '/doctors/me/schedule', {
      token: C.tokens[role], body: { overrides: [{ date: tomorrow, windows: [] }] },
    });
    assert.equal(r.status, 403, `${role} must not set a doctor's hours`);
  }
});

test('the doctor turns weekday days on and off and sets the hours themselves', async () => {
  await asDoctor('PUT', '/doctors/me/schedule', { overrides: [] }); // clear per-date work from earlier tests
  const dowOf = (d) => dayjs(d).day();

  // Turn every day off: nobody can book at all.
  const off = await asDoctor('PUT', '/doctors/me/availability', { availability: [] });
  assert.equal(off.status, 200);
  assert.deepEqual(await hoursOn(tomorrow), []);

  // Turn tomorrow's weekday back on with chosen hours, morning and evening.
  const on = await asDoctor('PUT', '/doctors/me/availability', {
    availability: [
      { dayOfWeek: dowOf(tomorrow), startTime: '10:00', endTime: '11:00' },
      { dayOfWeek: dowOf(tomorrow), startTime: '18:00', endTime: '19:00' },
    ],
  });
  assert.equal(on.status, 200);
  assert.deepEqual(await hoursOn(tomorrow), ['10:00', '10:15', '10:30', '10:45', '18:00', '18:15', '18:30', '18:45']);
});

test('weekly hours that overlap or run backwards are refused', async () => {
  const overlap = await asDoctor('PUT', '/doctors/me/availability', {
    availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }, { dayOfWeek: 1, startTime: '12:00', endTime: '17:00' }],
  });
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.code, 'OVERLAPPING_WINDOWS');

  const backwards = await asDoctor('PUT', '/doctors/me/availability', {
    availability: [{ dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }],
  });
  assert.equal(backwards.status, 400);

  // Same weekday, non-overlapping sessions are fine.
  const split = await asDoctor('PUT', '/doctors/me/availability', {
    availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '13:00' }, { dayOfWeek: 1, startTime: '17:00', endTime: '20:00' }],
  });
  assert.equal(split.status, 200);
});

test('setting weekly hours is scoped to the caller and never edits a colleague', async () => {
  for (const role of ['RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECHNICIAN']) {
    const r = await ctx.api('PUT', '/doctors/me/availability', {
      token: C.tokens[role], body: { availability: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }] },
    });
    assert.equal(r.status, 403, `${role} must not set doctor hours`);
  }
  const fee = (await ctx.api('GET', `/doctors/${String(C.doctor._id)}`, { token: C.tokens.DOCTOR })).data.consultationFee;
  assert.equal(fee, 500, 'the endpoint touches hours only, never fees');
});

test('a doctor added without hours is bookable from day one, with Sunday off', async () => {
  const r = await ctx.api('POST', '/doctors', { token: C.tokens.CLINIC_OWNER, body: { name: 'Dr Fresh' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.availability.length, 6, 'Mon–Sat seeded');
  assert.ok(!r.data.availability.some((a) => a.dayOfWeek === 0), 'Sunday is not a working day by default');

  const id = String(r.data._id);
  const next = (dow) => { let d = dayjs().add(1, 'day'); while (d.day() !== dow) d = d.add(1, 'day'); return d.format('YYYY-MM-DD'); };
  const slotsOn = async (date) => (await ctx.api('GET', `/public/docsched/availability?doctorId=${id}&date=${date}`)).data.slots;

  assert.ok((await slotsOn(next(1))).length, 'a brand new doctor can be booked on a Monday');
  assert.equal((await slotsOn(next(0))).length, 0, 'Sunday is closed by default');
});

test('a doctor added through staff creation also gets working hours', async () => {
  const r = await ctx.api('POST', '/clinics/staff', {
    token: C.tokens.CLINIC_OWNER,
    body: {
      name: 'Dr Staff', email: 'dr.staff@docsched.test', phone: '9876500011',
      role: 'DOCTOR', password: 'Passw0rd123', newDoctor: { specialization: 'ENT' },
    },
  });
  assert.equal(r.status, 201);
  const list = await ctx.api('GET', '/doctors', { token: C.tokens.CLINIC_OWNER });
  const made = list.data.find((d) => d.name === 'Dr Staff');
  assert.ok(made, 'the doctor profile was created');
  assert.equal(made.availability.length, 6, 'staff-created doctors are bookable too');
});

test('the clinic and front desk are told what changed', async () => {
  await asDoctor('PUT', '/doctors/me/schedule', {
    overrides: [{ date: tomorrow, windows: [{ startTime: '10:00', endTime: '11:00' }] }],
  });
  await new Promise((r) => setTimeout(r, 150)); // listeners run off the event bus

  for (const role of ['CLINIC_OWNER', 'RECEPTIONIST']) {
    const r = await ctx.api('GET', '/clinics/notifications', { token: C.tokens[role] });
    const mine = (r.data?.items || []).filter((n) => n.type === 'DOCTOR_SCHEDULE');
    assert.ok(mine.length, `${role} was not notified`);
    assert.match(mine[0].title, /updated their working hours/);
    assert.equal(mine[0].link, '/clinic/calendar');
  }
});
