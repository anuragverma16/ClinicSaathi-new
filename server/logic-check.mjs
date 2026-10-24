/**
 * Assertions that don't need a database. Run: node logic-check.mjs
 * Covers slot maths, the RBAC matrix, token claims, error translation,
 * index declarations and the AI tool boundary.
 */
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'clinicsaathi';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test_access';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh';

import { readFileSync } from 'node:fs';
import dayjs from 'dayjs';

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); console.log('  PASS', n); pass++; } catch (e) { console.log('  FAIL', n, '->', e.message); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

console.log('--- Slot generation ---');
const { generateSlots, slotKeyFor, toMinutes, isOnLeave } = await import('./src/utils/slots.js');
const tomorrow = dayjs().add(1, 'day');

await t('3h window at 15min = 12 slots', async () => {
  const s = generateSlots({ date: tomorrow.toDate(), rules: [{ dayOfWeek: tomorrow.day(), startTime: '09:00', endTime: '12:00' }], slotDurationMins: 15 });
  A(s.length === 12, `got ${s.length}`);
});
await t('breaks are carved out', async () => {
  const s = generateSlots({ date: tomorrow.toDate(), rules: [{ dayOfWeek: tomorrow.day(), startTime: '09:00', endTime: '12:00' }],
    breaks: [{ dayOfWeek: tomorrow.day(), startTime: '10:00', endTime: '10:30' }], slotDurationMins: 15 });
  A(s.length === 10, `expected 10, got ${s.length}`);
});
await t('split shifts both generate', async () => {
  const s = generateSlots({ date: tomorrow.toDate(), rules: [
    { dayOfWeek: tomorrow.day(), startTime: '09:00', endTime: '13:00' },
    { dayOfWeek: tomorrow.day(), startTime: '16:00', endTime: '19:00' }], slotDurationMins: 15 });
  A(s.length === 28, `expected 28, got ${s.length}`);
});
await t('wrong weekday produces nothing', async () => {
  const s = generateSlots({ date: tomorrow.toDate(), rules: [{ dayOfWeek: (tomorrow.day() + 1) % 7, startTime: '09:00', endTime: '12:00' }], slotDurationMins: 15 });
  A(s.length === 0, `got ${s.length}`);
});
await t('partial trailing slot is not offered', async () => {
  const s = generateSlots({ date: tomorrow.toDate(), rules: [{ dayOfWeek: tomorrow.day(), startTime: '09:00', endTime: '09:50' }], slotDurationMins: 20 });
  A(s.length === 2, `expected 2, got ${s.length}`);
});
await t('slotKey is minute-precise and stable', async () => {
  const d = new Date('2026-09-20T10:30:00.000Z');
  A(slotKeyFor(d) === '2026-09-20T10:30', slotKeyFor(d));
  A(slotKeyFor(d) === slotKeyFor(new Date('2026-09-20T10:30:45.000Z')), 'seconds leaked into key');
});
await t('leave range is inclusive at both ends', async () => {
  const leaves = [{ from: new Date('2026-09-20'), to: new Date('2026-09-25') }];
  A(isOnLeave(leaves, new Date('2026-09-22')), 'mid-range missed');
  A(isOnLeave(leaves, new Date('2026-09-20')), 'start missed');
  A(!isOnLeave(leaves, new Date('2026-09-26')), 'false positive');
});
await t('toMinutes parses clock strings', async () => A(toMinutes('09:30') === 570 && toMinutes('00:00') === 0));

console.log('\n--- RBAC matrix ---');
const { can } = await import('./src/middleware/rbac.js');
await t('owner has everything', async () => A(can('CLINIC_OWNER', 'billing:create') && can('CLINIC_OWNER', 'consultation:update')));
await t('doctor prescribes but does not bill', async () => {
  A(can('DOCTOR', 'prescription:create'), 'should prescribe'); A(!can('DOCTOR', 'billing:create'), 'should not bill');
});
await t('receptionist books but does not consult', async () => {
  A(can('RECEPTIONIST', 'appointment:create'), 'should book'); A(!can('RECEPTIONIST', 'consultation:create'), 'should not consult');
});
await t('accountant bills but does not prescribe', async () => {
  A(can('ACCOUNTANT', 'invoice:create'), 'should invoice'); A(!can('ACCOUNTANT', 'prescription:create'), 'should not prescribe');
});
await t('lab tech is confined to lab', async () => {
  A(can('LAB_TECHNICIAN', 'lab:process'), 'should do lab'); A(!can('LAB_TECHNICIAN', 'appointment:create'), 'should not book');
  A(!can('LAB_TECHNICIAN', 'lab:verify'), 'should not verify results'); A(!can('LAB_TECHNICIAN', 'patient:read'), 'should not browse patients');
});
await t('super admin bypasses', async () => A(can('SUPER_ADMIN', 'anything:at:all')));

console.log('\n--- Tokens ---');
const { signAccessToken, verifyAccess, signRefreshToken, verifyRefresh } = await import('./src/utils/tokens.js');
const fake = { _id: { toString: () => 'u1' }, role: 'DOCTOR', clinicId: { toString: () => 'c1' }, branchId: null, doctorId: { toString: () => 'd1' }, patientId: null };
await t('access token carries tenant + role claims', async () => {
  const p = verifyAccess(signAccessToken(fake));
  A(p.clinicId === 'c1' && p.role === 'DOCTOR' && p.doctorId === 'd1', JSON.stringify(p));
});
await t('refresh token carries only subject', async () => {
  const p = verifyRefresh(signRefreshToken(fake));
  A(p.sub === 'u1' && !p.role, 'refresh should not carry role');
});
await t('tampered token is rejected', async () => {
  let threw = false; try { verifyAccess(signAccessToken(fake) + 'x'); } catch { threw = true; }
  A(threw, 'tampered token accepted');
});

console.log('\n--- Error translation ---');
const { errorHandler } = await import('./src/middleware/error.js');
const runErr = (err) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  errorHandler(err, { ip: '1.1.1.1', headers: {} }, res, () => {}); return out; };
await t('slotKey duplicate becomes SLOT_UNAVAILABLE', async () => {
  const o = runErr({ code: 11000, keyPattern: { clinicId: 1, doctorId: 1, slotKey: 1 } });
  A(o.status === 409 && o.body.code === 'SLOT_UNAVAILABLE', JSON.stringify(o.body));
  A(/just taken/i.test(o.body.message), 'message should be patient-readable');
});
await t('other duplicates stay generic', async () => {
  A(runErr({ code: 11000, keyPattern: { email: 1 } }).body.code === 'DUPLICATE_KEY');
});
await t('unknown errors do not leak internals in production', async () => {
  const { env } = await import('./src/config/env.js'); const prev = env.nodeEnv; env.nodeEnv = 'production';
  const o = runErr(new Error('connection string password=hunter2'));
  env.nodeEnv = prev;
  A(o.status === 500 && !/hunter2/.test(JSON.stringify(o.body)), 'leaked internals');
  A(o.body.code === 'INTERNAL_ERROR', o.body.code);
});
await t('ApiError passes through with its code', async () => {
  const { ApiError } = await import('./src/utils/ApiError.js');
  const o = runErr(ApiError.forbidden('nope', 'NO_ACCESS'));
  A(o.status === 403 && o.body.code === 'NO_ACCESS');
});

console.log('\n--- Index declarations ---');
const { Appointment, Patient, QueueToken, Invoice } = await import('./src/models/index.js');
await t('appointment has partial unique slot index', async () => {
  const idx = Appointment.schema.indexes().find(([k]) => k.slotKey);
  A(idx, 'slot index missing');
  A(idx[1].unique === true, 'not unique — double booking is possible');
  A(idx[1].partialFilterExpression?.slotKey?.$type === 'string', 'not partial — cancelled rows would collide');
});
await t('patient phone unique per clinic', async () => {
  const idx = Patient.schema.indexes().find(([k]) => k.clinicId && k.phone);
  A(idx && idx[1].unique, 'missing unique (clinicId, phone)');
});
await t('queue token unique per doctor/day/sequence', async () => {
  const idx = QueueToken.schema.indexes().find(([k]) => k.sequence);
  A(idx && idx[1].unique, 'missing');
});
await t('invoice number unique per clinic', async () => {
  const idx = Invoice.schema.indexes().find(([k]) => k.clinicId && k.invoiceNumber);
  A(idx && idx[1].unique, 'missing unique (clinicId, invoiceNumber)');
});
await t('sequence generation is atomic, not read-then-write', async () => {
  const counter = readFileSync('src/models/Counter.js', 'utf8');
  A(/\$inc/.test(counter) && /findOneAndUpdate/.test(counter), 'counter is not atomic');
  A(!/countDocuments\(\{\}\)/.test(readFileSync('src/modules/billing/billing.routes.js', 'utf8')), 'invoice number still derived from a count');
  A(!/sequence: -1/.test(readFileSync('src/services/queue.service.js', 'utf8')), 'token number still derived from a sort');
});
await t('every tenant model carries clinicId', async () => {
  for (const M of [Appointment, Patient, QueueToken, Invoice]) A(M.schema.path('clinicId'), `${M.modelName} missing clinicId`);
});

console.log('\n--- AI safety ---');
const { looksUrgent } = await import('./src/ai/receptionist.js');
await t('urgent symptoms short-circuit the model', async () => {
  A(looksUrgent('I have severe chest pain'), 'missed chest pain');
  A(looksUrgent('my father is unconscious'), 'missed unconscious');
  A(!looksUrgent('I need a dental cleaning'), 'false positive');
});
const { toolDefinitions, toolHandlers } = await import('./src/ai/tools.js');
await t('every tool definition has a handler', async () => {
  for (const d of toolDefinitions) A(toolHandlers[d.function.name], `no handler for ${d.function.name}`);
});
await t('no tool lets the model choose the tenant', async () => {
  for (const d of toolDefinitions) {
    const props = Object.keys(d.function.parameters.properties || {});
    A(!props.includes('clinicId') && !props.includes('patientId'), `${d.function.name} exposes tenant as an argument — prompt-injection risk`);
  }
});

console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
