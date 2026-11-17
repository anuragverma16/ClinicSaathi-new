/**
 * Money: invoice maths, desk payments, gateway settlement only via verified
 * signatures, webhook de-duplication, refunds and reports.
 *
 * Razorpay's HTTP API is replaced by a fetch stub (no real credentials are
 * available); signatures are real HMACs computed with test secrets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup, makeClinic, firstSlot, patientLogin } from './helpers.js';

const ctx = await setup('billing');
const C = await makeClinic(ctx, { slug: 'bill' });
const T = C.tokens;
const { env } = await import('../src/config/env.js');
test.after(() => ctx.teardown());

const startAt = await firstSlot(ctx, 'bill', C.doctor._id, { serviceId: String(C.service._id) });
const booking = await ctx.api('POST', '/public/bill/appointments', { body: {
  doctorId: String(C.doctor._id), serviceId: String(C.service._id), startAt, name: 'Bill Payer', phone: '+919500000001', consentGiven: true,
} });
let invoice;

test('invoice from a visit uses the service fee and GST', async () => {
  const r = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { appointmentId: booking.data.appointmentId } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  invoice = r.data;
  assert.equal(invoice.subtotal, 800);
  assert.equal(invoice.gstAmount, 144);
  assert.equal(invoice.total, 944);
  assert.match(invoice.invoiceNumber, /^INV-\d{4}-00001$/);
  const dup = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { appointmentId: booking.data.appointmentId } });
  assert.equal(dup.status, 409);
  assert.equal((await ctx.api('POST', '/billing/invoices', { token: T.DOCTOR, body: { appointmentId: booking.data.appointmentId } })).status, 403);
});

test('desk payments cannot exceed the balance and settle the invoice', async () => {
  const over = await ctx.api('POST', `/billing/invoices/${invoice._id}/record-payment`, { token: T.ACCOUNTANT, body: { amount: 2000, method: 'CASH' } });
  assert.equal(over.body.code, 'AMOUNT_EXCEEDS_DUE');
  const p1 = await ctx.api('POST', `/billing/invoices/${invoice._id}/record-payment`, { token: T.ACCOUNTANT, body: { amount: 500, method: 'CASH' } });
  assert.equal(p1.status, 201);
  assert.equal(p1.data.invoice.status, 'PARTIAL');
  const p2 = await ctx.api('POST', `/billing/invoices/${invoice._id}/record-payment`, { token: T.ACCOUNTANT, body: { amount: 444, method: 'UPI', reference: 'UTR123' } });
  assert.equal(p2.data.invoice.status, 'PAID');
  assert.notEqual(p1.data.payment.receiptNumber, p2.data.payment.receiptNumber);
  const appt = await ctx.models.Appointment.findOne({ _id: booking.data.appointmentId }).setOptions({ clinicId: C.clinic._id });
  assert.equal(appt.paymentStatus, 'PAID');
  assert.equal(appt.status, 'CONFIRMED', 'payment status is tracked separately from the visit status');
});

test('concurrent desk payments cannot over-collect', async () => {
  const inv = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { patientId: String(appointmentPatient()), lineItems: [{ description: 'Dressing', unitPrice: 300, quantity: 1 }] } });
  const tries = await Promise.all([1, 2, 3].map(() => ctx.api('POST', `/billing/invoices/${inv.data._id}/record-payment`, { token: T.ACCOUNTANT, body: { amount: 300, method: 'CASH' } })));
  assert.equal(tries.filter((t) => t.status === 201).length, 1, JSON.stringify(tries.map((t) => t.status)));
  const after = await ctx.models.Invoice.findOne({ _id: inv.data._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(after.amountPaid, 300);
});
function appointmentPatient() { return booking.data && invoice.patientId; }

test('without gateway credentials online payment is refused, never faked', async () => {
  const inv = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { patientId: String(invoice.patientId), lineItems: [{ description: 'Consult', unitPrice: 100 }] } });
  const r = await ctx.api('POST', `/billing/invoices/${inv.data._id}/payment-order`, { token: T.ACCOUNTANT });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'GATEWAY_NOT_CONFIGURED');
});

// ---- gateway paths with test secrets and a stubbed Razorpay API
const realFetch = globalThis.fetch;
let remotePayment = null;
function enableGateway() {
  Object.assign(env.razorpay, { keyId: 'rzp_test_key', keySecret: 'key_secret_test', webhookSecret: 'wh_secret_test', enabled: true });
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://api.razorpay.com/v1/orders')) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: `order_${crypto.randomBytes(5).toString('hex')}`, amount: body.amount, currency: 'INR' }), { status: 200 });
    }
    if (u.startsWith('https://api.razorpay.com/v1/payments/') && u.endsWith('/refund')) {
      return new Response(JSON.stringify({ id: `rfnd_${crypto.randomBytes(4).toString('hex')}`, status: 'pending' }), { status: 200 });
    }
    if (u.startsWith('https://api.razorpay.com/v1/payments/')) return new Response(JSON.stringify(remotePayment), { status: 200 });
    return realFetch(url, init);
  };
}
test.after(() => { globalThis.fetch = realFetch; });

const sign = (body) => crypto.createHmac('sha256', 'wh_secret_test').update(body).digest('hex');
const webhook = (event, eventId, signature) => ctx.api('POST', '/webhooks/razorpay', {
  raw: event, headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature ?? sign(event), 'x-razorpay-event-id': eventId },
});

test('webhooks: bad signatures are rejected, duplicates never double-credit', async () => {
  enableGateway();
  const inv = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { patientId: String(invoice.patientId), lineItems: [{ description: 'Procedure', unitPrice: 1000 }] } });
  const order = await ctx.api('POST', `/billing/invoices/${inv.data._id}/payment-order`, { token: T.ACCOUNTANT });
  assert.equal(order.status, 200);
  assert.equal(order.data.keyId, 'rzp_test_key');
  const pending = await ctx.models.Payment.findOne({ gatewayOrderId: order.data.order.id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(pending.status, 'CREATED', 'creating an order marks nothing paid');

  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_abc123', order_id: order.data.order.id, amount: 100000 } } } });
  assert.equal((await webhook(event, 'evt_1', 'deadbeef')).status, 400);
  const tampered = event.replace('100000', '1');
  assert.equal((await webhook(tampered, 'evt_1b', sign(event))).status, 400);

  const results = await Promise.all([webhook(event, 'evt_1'), webhook(event, 'evt_1'), webhook(event, 'evt_2')]);
  assert.ok(results.every((r) => r.status === 200));
  const after = await ctx.models.Invoice.findOne({ _id: inv.data._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(after.amountPaid, 1000, 'credited exactly once across duplicate deliveries');
  assert.equal(after.status, 'PAID');
  const pay = await ctx.models.Payment.findOne({ gatewayOrderId: order.data.order.id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(pay.status, 'SUCCESS');
  assert.equal(pay.verifiedVia, 'WEBHOOK');
});

test('checkout callback settles only with a valid signature and a captured payment', async () => {
  const inv = await ctx.api('POST', '/billing/invoices', { token: T.ACCOUNTANT, body: { patientId: String(invoice.patientId), lineItems: [{ description: 'Peel', unitPrice: 600 }] } });
  const order = await ctx.api('POST', `/billing/invoices/${inv.data._id}/payment-order`, { token: T.ACCOUNTANT });
  const orderId = order.data.order.id;
  const goodSig = crypto.createHmac('sha256', 'key_secret_test').update(`${orderId}|pay_x1`).digest('hex');

  const forged = await ctx.api('POST', '/billing/payments/verify', { token: T.ACCOUNTANT, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x1', razorpay_signature: 'f'.repeat(64) } });
  assert.equal(forged.body.code, 'BAD_SIGNATURE');

  remotePayment = { id: 'pay_x1', order_id: orderId, status: 'failed' };
  const notCaptured = await ctx.api('POST', '/billing/payments/verify', { token: T.ACCOUNTANT, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x1', razorpay_signature: goodSig } });
  assert.equal(notCaptured.body.code, 'PAYMENT_NOT_CAPTURED');

  remotePayment = { id: 'pay_x1', order_id: orderId, status: 'captured' };
  const ok1 = await ctx.api('POST', '/billing/payments/verify', { token: T.ACCOUNTANT, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x1', razorpay_signature: goodSig } });
  assert.equal(ok1.status, 200);
  const ok2 = await ctx.api('POST', '/billing/payments/verify', { token: T.ACCOUNTANT, body: { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x1', razorpay_signature: goodSig } });
  assert.equal(ok2.data.alreadySettled, true);
  const after = await ctx.models.Invoice.findOne({ _id: inv.data._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(after.amountPaid, 600);
});

test('prepaid booking holds the slot until a verified payment confirms it', async () => {
  await ctx.models.Clinic.updateOne({ _id: C.clinic._id }, { 'bookingPolicy.requirePrepayment': true, 'bookingPolicy.holdMinutes': 15 });
  const slot = await firstSlot(ctx, 'bill', C.doctor._id, { offset: 4 });
  const b = await ctx.api('POST', '/public/bill/appointments', { body: { doctorId: String(C.doctor._id), startAt: slot, name: 'Pre Payer', phone: '+919500000009', consentGiven: true } });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.data.status, 'REQUESTED');
  assert.ok(b.data.payment?.order?.id);
  const blocked = await ctx.api('POST', '/public/bill/appointments', { body: { doctorId: String(C.doctor._id), startAt: slot, name: 'Other', phone: '+919500000010', consentGiven: true } });
  assert.equal(blocked.status, 409, 'a live hold blocks the slot');

  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_pre1', order_id: b.data.payment.order.id } } } });
  assert.equal((await webhook(event, 'evt_pre1')).status, 200);
  const appt = await ctx.models.Appointment.findOne({ _id: b.data.appointmentId }).setOptions({ clinicId: C.clinic._id });
  assert.equal(appt.status, 'CONFIRMED');
  assert.equal(appt.paymentStatus, 'PAID');

  // An expired, unpaid hold is released.
  const slot2 = await firstSlot(ctx, 'bill', C.doctor._id, { offset: 6 });
  const h = await ctx.api('POST', '/public/bill/appointments', { body: { doctorId: String(C.doctor._id), startAt: slot2, name: 'Abandons', phone: '+919500000011', consentGiven: true } });
  await ctx.models.Appointment.updateOne({ _id: h.data.appointmentId }, { holdExpiresAt: new Date(Date.now() - 1000) }).setOptions({ clinicId: C.clinic._id });
  const retake = await ctx.api('POST', '/public/bill/appointments', { body: { doctorId: String(C.doctor._id), startAt: slot2, name: 'Takes It', phone: '+919500000012', consentGiven: true } });
  assert.equal(retake.status, 201);
  const released = await ctx.models.Appointment.findOne({ _id: h.data.appointmentId }).setOptions({ clinicId: C.clinic._id });
  assert.equal(released.status, 'CANCELLED');
  assert.equal(released.cancelledBy, 'SYSTEM');
  await ctx.models.Clinic.updateOne({ _id: C.clinic._id }, { 'bookingPolicy.requirePrepayment': false });
});

test('refunds: cash settles immediately; gateway refunds wait for the refund webhook', async () => {
  const pays = await ctx.api('GET', '/billing/payments?status=SUCCESS', { token: T.ACCOUNTANT });
  const cash = pays.data.find((p) => p.method === 'CASH');
  const tooMuch = await ctx.api('POST', `/billing/payments/${cash._id}/refund`, { token: T.ACCOUNTANT, body: { amount: 9999, reason: 'test' } });
  assert.equal(tooMuch.body.code, 'REFUND_TOO_LARGE');
  const r = await ctx.api('POST', `/billing/payments/${cash._id}/refund`, { token: T.ACCOUNTANT, body: { amount: 100, reason: 'Overcharged' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'PARTIALLY_REFUNDED');
  assert.equal((await ctx.api('POST', `/billing/payments/${cash._id}/refund`, { token: T.RECEPTIONIST, body: { amount: 1, reason: 'x' } })).status, 403);

  const online = pays.data.find((p) => p.gateway === 'RAZORPAY');
  const g = await ctx.api('POST', `/billing/payments/${online._id}/refund`, { token: T.ACCOUNTANT, body: { amount: 200, reason: 'Goodwill' } });
  assert.equal(g.status, 200);
  assert.equal(g.data.refunds[0].status, 'PENDING');
  const refundId = g.data.refunds[0].gatewayRefundId;
  const ev = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: refundId, status: 'processed' } } } });
  await webhook(ev, 'evt_rf1');
  await webhook(ev, 'evt_rf2');
  const settled = await ctx.models.Payment.findOne({ _id: online._id }).setOptions({ clinicId: C.clinic._id });
  assert.equal(settled.refundedAmount, 200, 'refund applied once');
});

test('finance reports reflect real records and export as CSV', async () => {
  const s = await ctx.api('GET', '/billing/reports/summary', { token: T.ACCOUNTANT });
  assert.equal(s.status, 200);
  // two desk payments + one desk payment + webhook + checkout + prepaid consult (doctor fee 500)
  assert.equal(s.data.collected, 944 + 300 + 1000 + 600 + 500);
  assert.equal(s.data.refunded, 300);
  const out = await ctx.api('GET', '/billing/outstanding', { token: T.ACCOUNTANT });
  assert.ok(out.data.items.every((i) => i.balance > 0));
  const csv = await ctx.api('GET', '/billing/export/payments.csv', { token: T.ACCOUNTANT });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /^"Date","Receipt"/);
});

test('patient pays an invoice from the portal only through verified checkout', async () => {
  const p = await patientLogin(ctx, 'bill', '+919500000001');
  const bill = await ctx.api('GET', '/portal/billing', { token: p.accessToken });
  assert.ok(bill.data.invoices.length >= 1);
  const open = bill.data.invoices.find((i) => ['UNPAID', 'PARTIAL'].includes(i.status));
  if (open) {
    const o = await ctx.api('POST', `/portal/invoices/${open._id}/pay`, { token: p.accessToken });
    assert.equal(o.status, 200);
    const bad = await ctx.api('POST', '/portal/payments/verify', { token: p.accessToken, body: { razorpay_order_id: o.data.order.id, razorpay_payment_id: 'pay_zz', razorpay_signature: 'a'.repeat(64) } });
    assert.equal(bad.status, 400);
  }
});
