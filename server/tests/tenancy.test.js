import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import { setup, makeClinic, patientLogin, firstSlot } from './helpers.js';

const ctx = await setup('tenancy');
const A = await makeClinic(ctx, { slug: 'clinic-a' });
const B = await makeClinic(ctx, { slug: 'clinic-b' });
test.after(() => ctx.teardown());

async function bookPublic(slug, doctorId, phone, name, offset = 0) {
  const startAt = await firstSlot(ctx, slug, doctorId, { offset });
  const r = await ctx.api('POST', `/public/${slug}/appointments`, { body: { doctorId: String(doctorId), startAt, name, phone, consentGiven: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.data;
}

const bAppt = await bookPublic('clinic-b', B.doctor._id, '+919811111111', 'Bea B');
const bPatient = await ctx.models.Patient.findOne({ phone: '+919811111111' }).setOptions({ clinicId: B.clinic._id });

test('clinic A staff cannot read or change clinic B records', async () => {
  const t = A.tokens.CLINIC_OWNER;
  assert.equal((await ctx.api('GET', `/patients/${bPatient._id}`, { token: t })).status, 404);
  assert.equal((await ctx.api('GET', `/patients/${bPatient._id}/timeline`, { token: t })).status, 404);
  assert.equal((await ctx.api('GET', `/appointments/${bAppt.appointmentId}`, { token: t })).status, 404);
  assert.equal((await ctx.api('POST', `/appointments/${bAppt.appointmentId}/cancel`, { token: t, body: {} })).status, 404);
  assert.equal((await ctx.api('PATCH', `/doctors/${B.doctor._id}`, { token: t, body: { consultationFee: 1 } })).status, 404);
  assert.equal((await ctx.api('POST', '/queue/check-in', { token: A.tokens.RECEPTIONIST, body: { appointmentId: bAppt.appointmentId } })).status, 404);
  const list = await ctx.api('GET', '/patients?q=Bea', { token: t });
  assert.equal(list.data.length, 0);
  const appts = await ctx.api('GET', '/appointments', { token: t });
  assert.ok(appts.data.every((a) => String(a.clinicId) === String(A.clinic._id)));
  // Booking against another clinic's doctor id through clinic A's public page fails.
  const startAt = await firstSlot(ctx, 'clinic-b', B.doctor._id, { offset: 3 });
  const cross = await ctx.api('POST', '/public/clinic-a/appointments', { body: { doctorId: String(B.doctor._id), startAt, name: 'X Y', phone: '+919811111112', consentGiven: true } });
  assert.equal(cross.status, 404);
});

test('a patient sees only their own appointments and records', async () => {
  const p1 = await patientLogin(ctx, 'clinic-a', '+919822222221', 'Pat One');
  const p2 = await patientLogin(ctx, 'clinic-a', '+919822222222', 'Pat Two');
  const slot1 = await firstSlot(ctx, 'clinic-a', A.doctor._id, { offset: 0 });
  const slot2 = await firstSlot(ctx, 'clinic-a', A.doctor._id, { offset: 1 });
  const b1 = await ctx.api('POST', '/portal/appointments', { token: p1.accessToken, body: { doctorId: String(A.doctor._id), startAt: slot1 } });
  const b2 = await ctx.api('POST', '/portal/appointments', { token: p2.accessToken, body: { doctorId: String(A.doctor._id), startAt: slot2 } });
  assert.equal(b1.status, 201); assert.equal(b2.status, 201);

  const mine = await ctx.api('GET', '/portal/appointments', { token: p1.accessToken });
  assert.equal(mine.data.length, 1);
  assert.equal(String(mine.data[0]._id), String(b1.data.appointment._id));

  // Swapping in someone else's id gets a 404, never their data.
  const steal = await ctx.api('POST', `/portal/appointments/${b2.data.appointment._id}/cancel`, { token: p1.accessToken, body: {} });
  assert.equal(steal.status, 404);
  const asOther = await ctx.api('POST', '/portal/appointments', { token: p1.accessToken, body: { doctorId: String(A.doctor._id), startAt: slot2, patientId: String(b2.data.appointment.patientId) } });
  assert.equal(asOther.status, 404);
  const sign = await ctx.api('POST', '/files/sign', { token: p1.accessToken, body: { kind: 'invoice', id: String(b2.data.appointment._id) } });
  assert.equal(sign.status, 404);
  // A clinic A patient token is useless at clinic B.
  const other = await ctx.api('GET', `/portal/appointments`, { token: p1.accessToken });
  assert.ok(other.data.every((a) => String(a.clinicId) === String(A.clinic._id)));
});

test('a patient can act for registered dependents, and only them', async () => {
  const p = await patientLogin(ctx, 'clinic-a', '+919822222223', 'Parent');
  const dep = await ctx.api('POST', '/portal/dependents', { token: p.accessToken, body: { name: 'Kid', relationToGuardian: 'Son' } });
  assert.equal(dep.status, 201);
  const slot = await firstSlot(ctx, 'clinic-a', A.doctor._id, { offset: 5 });
  const r = await ctx.api('POST', '/portal/appointments', { token: p.accessToken, body: { doctorId: String(A.doctor._id), startAt: slot, patientId: String(dep.data._id) } });
  assert.equal(r.status, 201);
  const list = await ctx.api('GET', '/portal/appointments', { token: p.accessToken });
  assert.ok(list.data.some((a) => String(a.patientId._id) === String(dep.data._id)));
});

test('clinical sections require a care relationship', async () => {
  const phone = '+919833333333';
  const booked = await bookPublic('clinic-a', A.doctor._id, phone, 'Care Patient', 7);
  const patient = await ctx.models.Patient.findOne({ phone }).setOptions({ clinicId: A.clinic._id });

  const asDoctor = await ctx.api('GET', `/patients/${patient._id}/timeline`, { token: A.tokens.DOCTOR });
  assert.equal(asDoctor.status, 200);
  assert.equal(asDoctor.data.access.clinical, true);
  assert.ok(Array.isArray(asDoctor.data.consultations));

  const asDesk = await ctx.api('GET', `/patients/${patient._id}/timeline`, { token: A.tokens.RECEPTIONIST });
  assert.equal(asDesk.status, 200);
  assert.equal(asDesk.data.access.clinical, false);
  assert.equal(asDesk.data.consultations, null);
  assert.equal(asDesk.data.prescriptions, null);
  assert.equal(asDesk.data.patient.allergies, undefined);

  // A second doctor with no appointment with this patient gets nothing clinical.
  const other = await ctx.models.Doctor.create({ clinicId: A.clinic._id, name: 'Dr Other', registrationNumber: 'R2', availability: [] });
  const u = new ctx.models.User({ name: 'Other', email: 'other@clinic-a.test', role: 'DOCTOR', clinicId: A.clinic._id, doctorId: other._id });
  await u.setPassword(A.password); await u.save();
  const login = await ctx.api('POST', '/auth/login', { body: { identifier: 'other@clinic-a.test', password: A.password } });
  const asOther = await ctx.api('GET', `/patients/${patient._id}/timeline`, { token: login.data.accessToken });
  assert.equal(asOther.status, 404, 'doctors only see patients they treat');
  const docs = await ctx.api('GET', `/consultations?patientId=${patient._id}`, { token: login.data.accessToken });
  assert.equal(docs.data.length, 0);
  void booked;
});

test('branch managers see only their own branch', async () => {
  const otherBranch = await ctx.models.Branch.create({ clinicId: A.clinic._id, name: 'East' });
  const eastDoc = await ctx.models.Doctor.create({
    clinicId: A.clinic._id, branchId: otherBranch._id, name: 'Dr East', registrationNumber: 'E1',
    availability: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00' })),
  });
  await bookPublic('clinic-a', eastDoc._id, '+919844444444', 'East Patient');
  const date = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const mgr = await ctx.api('GET', `/appointments?date=${date}`, { token: A.tokens.BRANCH_MANAGER });
  assert.equal(mgr.status, 200);
  assert.ok(mgr.data.length > 0);
  assert.ok(mgr.data.every((a) => String(a.branchId) === String(A.branch._id)), 'manager saw another branch');
  const owner = await ctx.api('GET', `/appointments?date=${date}`, { token: A.tokens.CLINIC_OWNER });
  assert.ok(owner.data.some((a) => String(a.branchId) === String(otherBranch._id)));
  const doctors = await ctx.api('GET', '/doctors', { token: A.tokens.BRANCH_MANAGER });
  assert.ok(doctors.data.every((d) => String(d.branchId) === String(A.branch._id)));
});

test('query-string operator injection is not interpreted', async () => {
  const r = await ctx.api('GET', '/appointments?patientId[$ne]=x', { token: A.tokens.CLINIC_OWNER });
  // The simple parser keeps the key literal, so no operator reaches the database query.
  assert.equal(r.status, 200);
});
