import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

// The refresh token is an httpOnly cookie that only /api/auth/* receives, so
// scripts never read it. The access token lives in memory only; after a page
// reload, refreshSession() gets a new one from the cookie, so users stay signed in.
let accessToken = null;

export function setTokens({ access }) {
  accessToken = access ?? accessToken;
}

export function clearTokens() {
  accessToken = null;
}

export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// One refresh in flight at a time. The server rotates the refresh cookie on each
// use, so two parallel refreshes would look like a replayed token and end the session.
let refreshing = null;
export function refreshSession() {
  refreshing = refreshing || api.post('/auth/refresh')
    .then((r) => {
      setTokens({ access: r.data.data.accessToken });
      return accessToken;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// 401s here mean "wrong credentials" or "no session", not "access token expired".
const NO_REFRESH = /^\/auth\/(login|refresh|logout|forgot-password|reset-password|patient\/)/;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const expired = error.response?.status === 401 && !original._retried && !NO_REFRESH.test(original.url || '');

    if (expired) {
      original._retried = true;
      try {
        const token = await refreshSession();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        // No valid session cookie: end the local session and send the user to sign in.
        clearTokens();
        const path = window.location.pathname;
        if (!path.includes('login')) {
          window.location.href = path.startsWith('/patient') ? '/patient/login' : '/login';
        }
      }
    }

    // Normalise the server's error shape so callers always get .message and .code
    return Promise.reject({
      message: error.response?.data?.message || 'Could not reach the server',
      code: error.response?.data?.code || 'NETWORK_ERROR',
      details: error.response?.data?.details,
      status: error.response?.status,
    });
  }
);

export const unwrap = (res) => res.data.data;
/** For paginated endpoints: { data, meta }. */
export const unwrapPage = (res) => ({ data: res.data.data, meta: res.data.meta || {} });

/**
 * Opens a private file. The API checks access, then returns a five-minute
 * signed link — nothing medical is ever served from a permanent public URL.
 */
export async function openFile(kind, id) {
  const tab = window.open('', '_blank');
  try {
    const { url } = unwrap(await api.post('/files/sign', { kind, id }));
    if (tab) tab.location.href = url; else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Authenticated CSV download (the export endpoints need the bearer token). */
export async function downloadCsv(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  a.click();
  URL.revokeObjectURL(href);
}

/** Loads Razorpay Checkout on demand and resolves with its signed response. */
export function razorpayCheckout({ keyId, order, name, description, prefill }) {
  return new Promise((resolve, reject) => {
    const open = () => {
      const rzp = new window.Razorpay({
        key: keyId, order_id: order.id, amount: order.amount, currency: order.currency || 'INR',
        name, description, prefill,
        handler: resolve,
        modal: { ondismiss: () => reject({ message: 'Payment cancelled', code: 'PAYMENT_CANCELLED' }) },
      });
      rzp.on('payment.failed', (r) => reject({ message: r.error?.description || 'Payment failed', code: 'PAYMENT_FAILED' }));
      rzp.open();
    };
    if (window.Razorpay) return open();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = open;
    s.onerror = () => reject({ message: 'Could not load the payment window', code: 'CHECKOUT_LOAD_FAILED' });
    document.body.appendChild(s);
  });
}
