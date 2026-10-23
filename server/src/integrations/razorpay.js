import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const API = 'https://api.razorpay.com/v1';
const auth = () => `Basic ${Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64')}`;

export const gatewayEnabled = () => env.razorpay.enabled;
/** Key id is public by design (Checkout needs it); the secret never leaves the server. */
export const publicKeyId = () => (env.razorpay.enabled ? env.razorpay.keyId : null);

export async function createOrder({ amountPaise, receipt, notes }) {
  if (!env.razorpay.enabled) {
    throw new ApiError(503, 'Online payments are not configured yet. Pay at the clinic instead.', 'GATEWAY_NOT_CONFIGURED');
  }
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed (${res.status})`);
  return res.json();
}

/** Server-side fetch of a payment's real state — used to double-check checkout callbacks. */
export async function fetchPayment(paymentId) {
  const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: auth() } });
  if (!res.ok) throw new Error(`Razorpay payment lookup failed (${res.status})`);
  return res.json();
}

export async function createRefund({ paymentId, amountPaise, notes }) {
  const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, notes }),
  });
  if (!res.ok) throw new Error(`Razorpay refund failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function hmacEquals(secret, data, signature) {
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || '')));
  } catch {
    return false;
  }
}

/**
 * Webhook signature check. Payment status is only ever set from a verified
 * webhook or a verified checkout signature — never from what the browser reports.
 */
export function verifyWebhookSignature(rawBody, signature) {
  return hmacEquals(env.razorpay.webhookSecret, rawBody, signature);
}

/** Checkout callback: HMAC(order_id|payment_id) with the key secret, per Razorpay docs. */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  return hmacEquals(env.razorpay.keySecret, `${orderId}|${paymentId}`, signature);
}
