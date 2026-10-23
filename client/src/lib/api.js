import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

let accessToken = localStorage.getItem('cs_access') || null;
let refreshToken = localStorage.getItem('cs_refresh') || null;

export function setTokens({ access, refresh }) {
  accessToken = access ?? accessToken;
  refreshToken = refresh ?? refreshToken;
  if (access) localStorage.setItem('cs_access', access);
  if (refresh) localStorage.setItem('cs_refresh', refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('cs_access');
  localStorage.removeItem('cs_refresh');
}

export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Refresh once on a 401, then replay the original request. The server rotates
// the refresh token on every use, so the new one replaces the old.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const isAuthError = error.response?.status === 401 && !original._retried && !original.url?.startsWith('/auth/');

    if (isAuthError && refreshToken) {
      original._retried = true;
      refreshing = refreshing || axios.post('/api/auth/refresh', { refreshToken })
        .then((r) => {
          setTokens({ access: r.data.data.accessToken, refresh: r.data.data.refreshToken });
          return r.data.data.accessToken;
        })
        .catch((e) => {
          const patient = window.location.pathname.startsWith('/patient');
          clearTokens();
          window.location.href = patient ? '/patient/login' : '/login';
          throw e;
        })
        .finally(() => { refreshing = null; });

      const token = await refreshing;
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
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
