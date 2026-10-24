import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, makeClinic, makeSuperAdmin, patientLogin } from './helpers.js';

const ctx = await setup('auth');
const A = await makeClinic(ctx, { slug: 'alpha' });
const rootToken = await makeSuperAdmin(ctx);
test.after(() => ctx.teardown());

test('each role signs in and is routed to its own dashboard', async () => {
  const expected = {
    CLINIC_OWNER: '/clinic/dashboard', BRANCH_MANAGER: '/clinic/branch/dashboard', DOCTOR: '/clinic/doctor/dashboard',
    RECEPTIONIST: '/clinic/reception/dashboard', ACCOUNTANT: '/clinic/accounts/dashboard', LAB_TECHNICIAN: '/clinic/lab/dashboard',
  };
  for (const [role, home] of Object.entries(expected)) {
    const me = await ctx.api('GET', '/auth/me', { token: A.tokens[role] });
    assert.equal(me.status, 200, role);
    assert.equal(me.data.user.role, role);
    assert.equal(me.data.homePath, home, `${role} home`);
  }
  const me = await ctx.api('GET', '/auth/me', { token: rootToken });
  assert.equal(me.data.homePath, '/super-admin/dashboard');
  const patient = await patientLogin(ctx, 'alpha', '+919800000001');
  const pm = await ctx.api('GET', '/auth/me', { token: patient.accessToken });
  assert.equal(pm.data.user.role, 'PATIENT');
  assert.equal(pm.data.homePath, '/patient/dashboard');
});

test('there is no public sign-up; the super admin onboards clinics with an owner login', async () => {
  const r = await ctx.api('POST', '/auth/register', { body: {
    clinicName: 'Sneaky', name: 'Eve', email: 'eve@sneaky.test', phone: '9000000099', password: 'Password123', role: 'SUPER_ADMIN',
  } });
  assert.ok([401, 404].includes(r.status), 'sign-up endpoint must not exist');
  assert.equal(r.data?.accessToken, undefined);

  const c = await ctx.api('POST', '/platform/clinics', { token: rootToken, body: {
    name: 'Onboarded Clinic', plan: 'GROWTH',
    owner: { name: 'Olive Owner', email: 'olive@onboarded.test', phone: '9000000098', password: 'Password123' },
  } });
  assert.equal(c.status, 201);
  assert.equal(c.data.owner.role, 'CLINIC_OWNER');
  const login = await ctx.api('POST', '/auth/login', { body: { identifier: 'olive@onboarded.test', password: 'Password123' } });
  assert.equal(login.status, 200);
  const plat = await ctx.api('GET', '/platform/overview', { token: login.data.accessToken });
  assert.equal(plat.status, 403);

  const doc = await ctx.api('POST', '/platform/users', { token: rootToken, body: {
    name: 'Dr Dev', email: 'dev@onboarded.test', phone: '9000000097', password: 'Password123', role: 'DOCTOR', clinicId: c.data._id, specialization: 'ENT',
  } });
  assert.equal(doc.status, 201);
  assert.ok(doc.data.doctorId, 'doctor login is linked to a doctor profile');
});

test('wrong passwords are rejected and repeated failures lock the account', async () => {
  const email = A.users.ACCOUNTANT.email;
  const bad = await ctx.api('POST', '/auth/login', { body: { identifier: email, password: 'nope-nope-1' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'INVALID_CREDENTIALS');
  let last;
  for (let i = 0; i < 8; i += 1) last = await ctx.api('POST', '/auth/login', { body: { identifier: email, password: 'nope-nope-1' } });
  assert.equal(last.status, 423);
  const good = await ctx.api('POST', '/auth/login', { body: { identifier: email, password: A.password } });
  assert.equal(good.status, 423, 'locked account must not sign in even with the right password');
  await ctx.models.User.updateOne({ _id: A.users.ACCOUNTANT._id }, { $unset: { lockedUntil: 1 } });
});

test('refresh tokens rotate, replay revokes the session, logout ends it', async () => {
  const login = await ctx.api('POST', '/auth/login', { body: { identifier: A.users.RECEPTIONIST.email, password: A.password } });
  const first = login.data.refreshToken;
  const r1 = await ctx.api('POST', '/auth/refresh', { body: { refreshToken: first } });
  assert.equal(r1.status, 200);
  const second = r1.data.refreshToken;
  assert.notEqual(second, first);
  const replay = await ctx.api('POST', '/auth/refresh', { body: { refreshToken: first } });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'REFRESH_REUSED');
  const afterReplay = await ctx.api('POST', '/auth/refresh', { body: { refreshToken: second } });
  assert.equal(afterReplay.status, 401, 'replay must revoke the whole session');

  const l2 = await ctx.api('POST', '/auth/login', { body: { identifier: A.users.RECEPTIONIST.email, password: A.password } });
  await ctx.api('POST', '/auth/logout', { token: l2.data.accessToken });
  const r3 = await ctx.api('POST', '/auth/refresh', { body: { refreshToken: l2.data.refreshToken } });
  assert.equal(r3.status, 401);
});

test('patients cannot use password login or staff APIs', async () => {
  const p = await patientLogin(ctx, 'alpha', '+919800000002', 'Pat Two');
  assert.ok(p.accessToken);
  const pw = await ctx.api('POST', '/auth/login', { body: { identifier: '+919800000002', password: 'anything1' } });
  assert.equal(pw.status, 401);
  for (const path of ['/patients', '/appointments', '/billing/invoices', '/lab/orders']) {
    const r = await ctx.api('GET', path, { token: p.accessToken });
    assert.equal(r.status, 403, path);
  }
});

test('OTP is single use and wrong codes are counted', async () => {
  const phone = '+919800000003';
  await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'alpha', phone } });
  const wrong = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'alpha', phone, code: '000000' } });
  assert.equal(wrong.status, 400);
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const code = lastStubTo(phone).body.match(/\d{6}/)[0];
  const ok1 = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'alpha', phone, code } });
  assert.equal(ok1.status, 200);
  const again = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'alpha', phone, code } });
  assert.equal(again.status, 400, 'a consumed code must not work twice');
});

test('role permissions are enforced on the API, not just hidden in the UI', async () => {
  const t = A.tokens;
  const cases = [
    ['RECEPTIONIST', 'POST', '/consultations', { appointmentId: '0'.repeat(24) }],
    ['RECEPTIONIST', 'GET', '/billing/reports/summary'],
    ['RECEPTIONIST', 'POST', '/prescriptions', { consultationId: '0'.repeat(24), medicines: [] }],
    ['LAB_TECHNICIAN', 'GET', '/patients'],
    ['LAB_TECHNICIAN', 'GET', '/appointments'],
    ['ACCOUNTANT', 'POST', '/appointments', { doctorId: '0'.repeat(24), startAt: '2030-01-01T10:00:00Z', patientId: '0'.repeat(24) }],
    ['ACCOUNTANT', 'GET', '/consultations'],
    ['DOCTOR', 'POST', '/billing/invoices', { patientId: '0'.repeat(24), lineItems: [{ description: 'x', unitPrice: 1 }] }],
    ['DOCTOR', 'POST', '/clinics/staff', {}],
    ['BRANCH_MANAGER', 'POST', '/clinics/staff', {}],
    ['BRANCH_MANAGER', 'GET', '/consultations'],
    ['CLINIC_OWNER', 'GET', '/platform/overview'],
  ];
  for (const [role, method, path, body] of cases) {
    const r = await ctx.api(method, path, { token: t[role], body });
    assert.equal(r.status, 403, `${role} ${method} ${path} → ${r.status}`);
  }
});

test('super admin works on the platform but has no default access to clinic patient data', async () => {
  const ov = await ctx.api('GET', '/platform/overview', { token: rootToken });
  assert.equal(ov.status, 200);
  for (const path of ['/patients', '/consultations', '/appointments']) {
    const r = await ctx.api('GET', path, { token: rootToken });
    assert.equal(r.status, 403, path);
  }
  const details = await ctx.api('GET', `/platform/clinic-details/${A.clinic._id}`, { token: rootToken });
  assert.equal(details.status, 200);
  assert.equal(details.data.patients, undefined, 'clinic details must not list patients');
  assert.equal(typeof details.data.patientCount, 'number');
});

test('super admin role cannot be granted through the API', async () => {
  const r = await ctx.api('PATCH', `/platform/users/${A.users.RECEPTIONIST._id}`, { token: rootToken, body: { role: 'SUPER_ADMIN' } });
  assert.equal(r.status, 400);
});

test('suspending a clinic locks its staff out immediately', async () => {
  const s = await ctx.api('PATCH', `/platform/clinics/${A.clinic._id}/status`, { token: rootToken, body: { isActive: false } });
  assert.equal(s.status, 200);
  const r = await ctx.api('GET', '/appointments', { token: A.tokens.RECEPTIONIST });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'CLINIC_SUSPENDED');
  const login = await ctx.api('POST', '/auth/login', { body: { identifier: A.users.CLINIC_OWNER.email, password: A.password } });
  assert.equal(login.status, 403);
  await ctx.api('PATCH', `/platform/clinics/${A.clinic._id}/status`, { token: rootToken, body: { isActive: true } });
  const back = await ctx.api('GET', '/appointments', { token: A.tokens.RECEPTIONIST });
  assert.equal(back.status, 200);
});

test('password reset uses a single-use emailed token', async () => {
  const email = A.users.BRANCH_MANAGER.email;
  const f = await ctx.api('POST', '/auth/forgot-password', { body: { email } });
  assert.equal(f.status, 200);
  const unknown = await ctx.api('POST', '/auth/forgot-password', { body: { email: 'nobody@nowhere.test' } });
  assert.deepEqual(unknown.body, f.body, 'unknown emails get the same response');
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const link = lastStubTo(email).body.match(/uid=([a-f\d]+)&token=([a-f\d]+)/);
  const reset = await ctx.api('POST', '/auth/reset-password', { body: { uid: link[1], token: link[2], password: 'BrandNew123' } });
  assert.equal(reset.status, 200);
  const reuse = await ctx.api('POST', '/auth/reset-password', { body: { uid: link[1], token: link[2], password: 'Another123' } });
  assert.equal(reuse.status, 400);
  const login = await ctx.api('POST', '/auth/login', { body: { identifier: email, password: 'BrandNew123' } });
  assert.equal(login.status, 200);
});
