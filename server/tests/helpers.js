/**
 * Test harness: boots the real Express app on an ephemeral port against a
 * throwaway MySQL database (clinicsaathi_test_<suite>), and builds tenants/users
 * directly through the models. Every test then talks to the API over HTTP
 * exactly as the frontend does.
 *
 * Needs a local MySQL. Connection comes from MYSQL_TEST_HOST / _PORT / _USER /
 * _PASSWORD (falling back to the normal MYSQL_* settings).
 * Redis is disabled, so job scheduling is recorded as ENQUEUE_FAILED.
 */
import http from 'node:http';
import dayjs from 'dayjs';

export async function setup(name) {
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = 'disabled';
  for (const k of ['HOST', 'PORT', 'USER', 'PASSWORD']) {
    if (process.env[`MYSQL_TEST_${k}`] !== undefined) process.env[`MYSQL_${k}`] = process.env[`MYSQL_TEST_${k}`];
  }
  process.env.MYSQL_DATABASE = `clinicsaathi_test_${name}`;
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.STORAGE_DIR = `storage/test-${name}`;
  for (const k of ['WHATSAPP_TOKEN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'WHATSAPP_APP_SECRET']) {
    delete process.env[k];
  }

  const db = (await import('../src/db/index.js')).default;
  const { connectDb } = await import('../src/config/db.js');
  const { createApp } = await import('../src/app.js');
  const { registerListeners } = await import('../src/services/listeners.js');
  const models = await import('../src/models/index.js');

  await connectDb();
  await db.connection.db.dropDatabase();
  for (const M of Object.values(models)) if (M?.schema && M.init) await M.init();
  registerListeners({});

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/api`;

  async function api(method, path, { token, body, raw, headers = {} } = {}) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, data: json?.data, headers: res.headers };
  }

  async function teardown() {
    await new Promise((r) => server.close(r));
    await db.query(`DROP DATABASE IF EXISTS \`${process.env.MYSQL_DATABASE}\``);
    await db.disconnect();
    const { rm } = await import('node:fs/promises');
    await rm(process.env.STORAGE_DIR, { recursive: true, force: true });
  }

  return { api, teardown, models, db, url };
}

const PASSWORD = 'Testpass123';

/** A full clinic with one user per staff role, a doctor working tomorrow, and a service. */
export async function makeClinic(ctx, { slug, plan = 'ENTERPRISE', status = 'ACTIVE' } = {}) {
  const { User, Clinic, Subscription, Doctor, Service, Branch } = ctx.models;
  const clinic = await Clinic.create({ name: `Clinic ${slug}`, slug, onboarding: { completed: true } });
  await Subscription.create({ clinicId: clinic._id, plan, status });
  const branch = await Branch.create({ clinicId: clinic._id, name: 'Main' });

  const tomorrow = dayjs().add(1, 'day');
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00' }));
  const doctor = await Doctor.create({
    clinicId: clinic._id, branchId: branch._id, name: `Dr ${slug}`, specialization: 'Dermatology',
    registrationNumber: 'REG-123', consultationFee: 500, slotDurationMins: 15, availability: allDays,
    breaks: [{ dayOfWeek: tomorrow.day(), startTime: '13:00', endTime: '14:00' }],
  });
  const service = await Service.create({ clinicId: clinic._id, name: 'Skin consult', fee: 800, durationMins: 30, gstPercent: 18, recallIntervalDays: 180 });

  const users = {};
  const roles = ['CLINIC_OWNER', 'BRANCH_MANAGER', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECHNICIAN'];
  for (const role of roles) {
    const u = new User({
      name: `${role} ${slug}`, email: `${role.toLowerCase()}@${slug}.test`, phone: `9${Math.floor(Math.random() * 1e9)}`.padEnd(10, '0'),
      role, clinicId: clinic._id,
      branchId: role === 'BRANCH_MANAGER' ? branch._id : undefined,
      doctorId: role === 'DOCTOR' ? doctor._id : undefined,
    });
    await u.setPassword(PASSWORD);
    await u.save();
    users[role] = u;
  }
  await Doctor.updateOne({ _id: doctor._id }, { userId: users.DOCTOR._id }).setOptions({ clinicId: clinic._id });

  const tokens = {};
  for (const role of roles) {
    const r = await ctx.api('POST', '/auth/login', { body: { identifier: users[role].email, password: PASSWORD } });
    if (r.status !== 200) throw new Error(`login failed for ${role}: ${JSON.stringify(r.body)}`);
    tokens[role] = r.data.accessToken;
  }
  return { clinic, branch, doctor, service, users, tokens, password: PASSWORD };
}

export async function makeSuperAdmin(ctx) {
  const u = new ctx.models.User({ name: 'Root', email: 'root@platform.test', role: 'SUPER_ADMIN' });
  await u.setPassword(PASSWORD);
  await u.save();
  const r = await ctx.api('POST', '/auth/login', { body: { identifier: 'root@platform.test', password: PASSWORD } });
  return r.data.accessToken;
}

/** Signs a patient into the portal through the real OTP flow (code read from the stub outbox). */
export async function patientLogin(ctx, slug, phone, name = 'Portal Patient') {
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: slug, phone } });
  if (req.status !== 200) throw new Error(`otp request failed ${JSON.stringify(req.body)}`);
  const code = lastStubTo(phone).body.match(/\d{6}/)[0];
  const v = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: slug, phone, code } });
  if (v.data?.needsRegistration) {
    const reg = await ctx.api('POST', '/auth/patient/register', { body: { registrationToken: v.data.registrationToken, name, consentGiven: true } });
    return reg.data;
  }
  return v.data;
}

/** First open slot tomorrow for a doctor, via the public availability API. */
export async function firstSlot(ctx, slug, doctorId, { serviceId, offset = 0 } = {}) {
  const date = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const r = await ctx.api('GET', `/public/${slug}/availability?doctorId=${doctorId}&date=${date}${serviceId ? `&serviceId=${serviceId}` : ''}`);
  return r.data.slots[offset]?.startAt;
}
