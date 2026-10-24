/**
 * The visit, end to end: walk-in → token → call → consult → prescribe →
 * lab → complete, with each role limited to its part.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, makeClinic, patientLogin } from './helpers.js';

const ctx = await setup('visit');
const C = await makeClinic(ctx, { slug: 'visit' });
const T = C.tokens;
const docId = String(C.doctor._id);
test.after(() => ctx.teardown());

const phone = '+919600000001';
const patient = await patientLogin(ctx, 'visit', phone, 'Visit Patient');
let walkIn; let second; let consultation; let rx; let lab;

test('walk-ins get sequential, unique tokens and a second check-in is refused', async () => {
  const r1 = await ctx.api('POST', '/appointments/walk-in', { token: T.RECEPTIONIST, body: { doctorId: docId, patientId: String(patient.user.patientId) } });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  walkIn = r1.data;
  assert.match(walkIn.token.tokenNumber, /^[A-Z]+1$/);
  const r2 = await ctx.api('POST', '/appointments/walk-in', { token: T.RECEPTIONIST, body: { doctorId: docId, newPatient: { name: 'Second Walk', phone: '+919600000002' } } });
  second = r2.data;
  assert.equal(second.token.tokenNumber, walkIn.token.tokenNumber.replace(/\d+$/, '2'));

  const dup = await ctx.api('POST', '/queue/check-in', { token: T.RECEPTIONIST, body: { appointmentId: String(walkIn.appointment._id) } });
  assert.equal(dup.status, 409);
  const dupes = await Promise.all([1, 2].map(() => ctx.api('POST', '/queue/check-in', { token: T.RECEPTIONIST, body: { appointmentId: String(second.appointment._id) } })));
  assert.ok(dupes.every((d) => d.status === 409));
  const tokens = await ctx.models.QueueToken.countDocuments({ appointmentId: second.appointment._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(tokens, 1);
});

test('the queue is shared between reception and the doctor, and the patient sees their position', async () => {
  const desk = await ctx.api('GET', '/queue', { token: T.RECEPTIONIST });
  const doc = await ctx.api('GET', '/queue', { token: T.DOCTOR });
  assert.equal(desk.data.length, 2);
  assert.deepEqual(doc.data.map((t) => t.tokenNumber), desk.data.map((t) => t.tokenNumber));
  assert.equal(desk.data[1].patientsAhead, 1);
  const mine = await ctx.api('GET', '/portal/queue', { token: patient.accessToken });
  assert.equal(mine.data[0].tokenNumber, walkIn.token.tokenNumber);
  assert.equal(mine.data[0].patientsAhead, 0);
});

test('the doctor calls one patient at a time and invalid moves are refused', async () => {
  const call = await ctx.api('POST', '/queue/call-next', { token: T.DOCTOR, body: {} });
  assert.equal(call.status, 200);
  assert.equal(call.data.tokenNumber, walkIn.token.tokenNumber);
  const busy = await ctx.api('POST', '/queue/call-next', { token: T.DOCTOR, body: {} });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'DOCTOR_BUSY');
  const jump = await ctx.api('PATCH', `/queue/${second.token._id}`, { token: T.DOCTOR, body: { status: 'COMPLETED' } });
  assert.equal(jump.status, 400, 'a waiting token cannot jump to completed');
  const start = await ctx.api('PATCH', `/queue/${call.data._id}`, { token: T.DOCTOR, body: { status: 'IN_CONSULTATION' } });
  assert.equal(start.status, 200);
});

test('only the treating doctor writes clinical notes; status and patient are server-controlled', async () => {
  const body = { appointmentId: String(walkIn.appointment._id), symptoms: 'Itchy rash 3 days', vitals: { pulse: 80 } };
  assert.equal((await ctx.api('POST', '/consultations', { token: T.RECEPTIONIST, body })).status, 403);
  assert.equal((await ctx.api('POST', '/consultations', { token: T.CLINIC_OWNER, body })).status, 403, 'owner without a doctor profile');
  const c = await ctx.api('POST', '/consultations', { token: T.DOCTOR, body: { ...body, patientId: '0'.repeat(24), status: 'COMPLETED' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  consultation = c.data;
  assert.equal(String(consultation.patientId), String(patient.user.patientId), 'patient comes from the appointment');
  assert.equal(consultation.status, 'IN_PROGRESS');

  const early = await ctx.api('POST', `/consultations/${consultation._id}/complete`, { token: T.DOCTOR });
  assert.equal(early.body.code, 'NOTES_REQUIRED');
  const upd = await ctx.api('PATCH', `/consultations/${consultation._id}`, { token: T.DOCTOR, body: { diagnosis: 'Contact dermatitis', followUpDays: 14, status: 'COMPLETED' } });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.status, 'IN_PROGRESS', 'status cannot be set through a patch');
  assert.equal((await ctx.api('PATCH', `/consultations/${consultation._id}`, { token: T.RECEPTIONIST, body: { diagnosis: 'x' } })).status, 403);
});

test('prescriptions are drafted, then signed by the doctor and locked', async () => {
  const d = await ctx.api('POST', '/prescriptions', { token: T.DOCTOR, body: {
    consultationId: String(consultation._id), medicines: [{ name: 'Cetirizine', dosage: '10mg', frequency: '0-0-1', durationDays: 5 }], advice: 'Avoid the irritant',
  } });
  assert.equal(d.status, 201);
  rx = d.data;
  assert.equal(rx.status, 'DRAFT');
  const before = await ctx.api('GET', '/portal/records', { token: patient.accessToken });
  assert.equal(before.data.prescriptions.length, 0, 'drafts are invisible to patients');

  const fin = await ctx.api('POST', `/prescriptions/${rx._id}/finalize`, { token: T.DOCTOR });
  assert.equal(fin.status, 200);
  assert.equal(fin.data.status, 'FINAL');
  assert.equal(fin.data.signature.registrationNumber, 'REG-123');
  const edit = await ctx.api('PATCH', `/prescriptions/${rx._id}`, { token: T.DOCTOR, body: { advice: 'changed' } });
  assert.equal(edit.status, 400);
  assert.equal((await ctx.api('GET', '/prescriptions', { token: T.RECEPTIONIST })).status, 403);
});

test('lab: doctor orders, technician processes with minimal patient data, doctor verifies', async () => {
  const o = await ctx.api('POST', '/lab/orders', { token: T.DOCTOR, body: { consultationId: String(consultation._id), tests: [{ name: 'CBC' }, { name: 'IgE' }], priority: 'URGENT' } });
  assert.equal(o.status, 201);
  lab = o.data;
  assert.equal((await ctx.api('POST', '/lab/orders', { token: T.LAB_TECHNICIAN, body: { consultationId: String(consultation._id), tests: [{ name: 'X1' }] } })).status, 403);

  const list = await ctx.api('GET', '/lab/orders', { token: T.LAB_TECHNICIAN });
  const row = list.data.find((x) => x._id === lab._id);
  assert.equal(row.patientId.name, 'Visit Patient');
  assert.equal(row.patientId.phone, undefined, 'technicians do not get contact details');

  const early = await ctx.api('POST', `/lab/orders/${lab._id}/results`, { token: T.LAB_TECHNICIAN, body: { results: [{ test: 'CBC', value: '1' }] } });
  assert.equal(early.status, 400, 'results before collection');
  assert.equal((await ctx.api('POST', `/lab/orders/${lab._id}/collect`, { token: T.LAB_TECHNICIAN })).status, 200);
  assert.equal((await ctx.api('POST', `/lab/orders/${lab._id}/collect`, { token: T.LAB_TECHNICIAN })).status, 400, 'double collect');
  assert.equal((await ctx.api('POST', `/lab/orders/${lab._id}/process`, { token: T.LAB_TECHNICIAN })).status, 200);

  const form = new FormData();
  form.append('results', JSON.stringify([{ test: 'CBC', value: '11.2', unit: 'g/dL', referenceRange: '12-16', flag: 'LOW' }, { test: 'IgE', value: '310', unit: 'IU/mL', flag: 'HIGH' }]));
  form.append('report', new Blob([Buffer.from('%PDF-1.4 test report')], { type: 'application/pdf' }), 'report.pdf');
  const res = await fetch(`${ctx.url}/lab/orders/${lab._id}/results`, { method: 'POST', headers: { Authorization: `Bearer ${T.LAB_TECHNICIAN}` }, body: form });
  const sub = await res.json();
  assert.equal(res.status, 200, JSON.stringify(sub));
  assert.equal(sub.data.status, 'RESULT_SUBMITTED');

  const exe = new FormData();
  exe.append('report', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'evil.exe');
  const bad = await fetch(`${ctx.url}/lab/orders/${lab._id}/results`, { method: 'POST', headers: { Authorization: `Bearer ${T.LAB_TECHNICIAN}` }, body: exe });
  assert.equal(bad.status, 400);

  assert.equal((await ctx.api('POST', `/lab/orders/${lab._id}/verify`, { token: T.LAB_TECHNICIAN, body: { approve: true } })).status, 403);
  const notReleased = await ctx.api('GET', '/portal/records', { token: patient.accessToken });
  assert.equal(notReleased.data.labReports.length, 0, 'unverified results stay hidden');
  const v = await ctx.api('POST', `/lab/orders/${lab._id}/verify`, { token: T.DOCTOR, body: { approve: true, remarks: 'Mild anaemia' } });
  assert.equal(v.status, 200);
  assert.equal(v.data.status, 'VERIFIED');

  const notif = await ctx.models.Notification.findOne({ type: 'LAB_RESULT' }).setOptions({ clinicId: C.clinic._id });
  assert.ok(notif, 'doctor was notified when results were submitted');
});

test('completing the consultation closes the visit, token and record', async () => {
  const done = await ctx.api('POST', `/consultations/${consultation._id}/complete`, { token: T.DOCTOR });
  assert.equal(done.status, 200);
  const appt = await ctx.models.Appointment.findOne({ _id: walkIn.appointment._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(appt.status, 'COMPLETED');
  const tok = await ctx.models.QueueToken.findOne({ _id: walkIn.token._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(tok.status, 'COMPLETED');
  await new Promise((r) => setTimeout(r, 300));
  const p = await ctx.models.Patient.findOne({ _id: patient.user.patientId }).setOptions({ clinicId: C.clinic._id });
  assert.equal(p.visitCount, 1);
  const fu = await ctx.models.FollowUp.findOne({ consultationId: consultation._id }).setOptions({ clinicId: C.clinic._id });
  assert.ok(fu, 'follow-up created from followUpDays');

  const locked = await ctx.api('PATCH', `/consultations/${consultation._id}`, { token: T.DOCTOR, body: { diagnosis: 'changed' } });
  assert.equal(locked.body.code, 'CONSULTATION_LOCKED');
  const add = await ctx.api('POST', `/consultations/${consultation._id}/addendum`, { token: T.DOCTOR, body: { text: 'Patch test advised' } });
  assert.equal(add.status, 200);
  assert.equal(add.data.addenda.length, 1);
  // Next patient can now be called.
  assert.equal((await ctx.api('POST', '/queue/call-next', { token: T.DOCTOR, body: {} })).status, 200);
});

test('released records download through short-lived signed links only', async () => {
  const recs = await ctx.api('GET', '/portal/records', { token: patient.accessToken });
  assert.equal(recs.data.prescriptions.length, 1);
  assert.equal(recs.data.labReports.length, 1);
  const s = await ctx.api('POST', '/files/sign', { token: patient.accessToken, body: { kind: 'prescription', id: String(rx._id) } });
  assert.equal(s.status, 200);
  const file = await fetch(`${ctx.url.replace('/api', '')}${s.data.url}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const labFile = await ctx.api('POST', '/files/sign', { token: patient.accessToken, body: { kind: 'labFile', id: String(lab._id) } });
  assert.equal(labFile.status, 200);

  const tampered = s.data.url.replace(/token=(.)/, 'token=X');
  assert.equal((await fetch(`${ctx.url.replace('/api', '')}${tampered}`)).status, 403);
  assert.equal((await ctx.api('POST', '/files/sign', { token: T.RECEPTIONIST, body: { kind: 'prescription', id: String(rx._id) } })).status, 403);
  const audit = await ctx.models.AuditLog.findOne({ action: 'FILE_DOWNLOADED', entityId: rx._id });
  assert.ok(audit, 'download was audited');
});

test('certificates: doctor drafts and issues; patient sees only issued ones', async () => {
  const c = await ctx.api('POST', '/certificates', { token: T.DOCTOR, body: { patientId: String(patient.user.patientId), type: 'SICK_LEAVE', fromDate: '2026-10-01', toDate: '2026-10-03' } });
  assert.equal(c.status, 201);
  assert.equal((await ctx.api('GET', '/portal/records', { token: patient.accessToken })).data.certificates.length, 0);
  assert.equal((await ctx.api('POST', `/certificates/${c.data._id}/issue`, { token: T.DOCTOR })).status, 200);
  assert.equal((await ctx.api('GET', '/portal/records', { token: patient.accessToken })).data.certificates.length, 1);
});
