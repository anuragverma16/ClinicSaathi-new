import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, makeClinic, patientLogin } from './helpers.js';

const ctx = await setup('patient-login');
const A = await makeClinic(ctx, { slug: 'sunrise' });
test.after(() => ctx.teardown());

// A patient saved the way reception saves them: 10 digits, no country code.
const RECEPTION_PHONE = '9811122233';

test('a patient already on file signs in with OTP and is not asked to register again', async () => {
  const patient = await ctx.models.Patient.create({
    clinicId: A.clinic._id, name: 'Asha Existing', phone: RECEPTION_PHONE,
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });

  // The portal sends the number in +91 form, which must match the reception record.
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone: `+91${RECEPTION_PHONE}` } });
  assert.equal(req.status, 200);
  const code = lastStubTo(`+91${RECEPTION_PHONE}`).body.match(/\d{6}/)[0];
  const verify = await ctx.api('POST', '/auth/patient/verify-otp', { body: { clinicSlug: 'sunrise', phone: `+91${RECEPTION_PHONE}`, code } });

  assert.equal(verify.status, 200);
  assert.equal(verify.data.needsRegistration, undefined, 'a registered patient must not be sent to registration');
  assert.ok(verify.data.accessToken);
  assert.equal(verify.data.user.patientId, String(patient._id));
  const copies = await ctx.models.Patient.find({ phone: { $in: [RECEPTION_PHONE, `+91${RECEPTION_PHONE}`] } }).setOptions({ clinicId: A.clinic._id });
  assert.equal(copies.length, 1, 'no duplicate patient record is created');
});

test('a number reserved for clinic staff never gets a patient login code', async () => {
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const phone = '9811133333';
  await ctx.models.User.create({ name: 'Owner', email: 'owner-reserved@sunrise.test', phone, role: 'CLINIC_OWNER', clinicId: A.clinic._id });
  await ctx.models.Patient.create({ clinicId: A.clinic._id, name: 'Owner As Patient', phone,
    consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' } } });

  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone: `+91${phone}` } });
  assert.equal(req.status, 403);
  assert.equal(req.body.code, 'STAFF_NUMBER');
  assert.equal(lastStubTo(`+91${phone}`), undefined, 'no code is sent to a staff number');
});

test('a number that is not registered gets no code', async () => {
  const { lastStubTo } = await import('../src/integrations/stubOutbox.js');
  const phone = '+919811100000';
  const req = await ctx.api('POST', '/auth/patient/request-otp', { body: { clinicSlug: 'sunrise', phone } });
  assert.equal(req.status, 404);
  assert.equal(req.body.code, 'NOT_REGISTERED');
  assert.equal(lastStubTo(phone), undefined, 'no WhatsApp message is sent to an unregistered number');
});
