import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setTokens, clearTokens, getAccessToken, unwrap } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

/**
 * Session state. Everything that decides access — role, clinic, branch, plan
 * features — comes from GET /auth/me; the client only mirrors it for UX.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState({ user: null, clinic: null, subscription: null, entitlements: null, doctor: null, patient: null, homePath: null });
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const d = unwrap(await api.get('/auth/me'));
    setSession(d);
    connectSocket();
    return d;
  }, []);

  useEffect(() => {
    if (!getAccessToken()) { setLoading(false); return; }
    loadMe().catch(() => clearTokens()).finally(() => setLoading(false));
  }, [loadMe]);

  const startSession = async (d) => {
    setTokens({ access: d.accessToken, refresh: d.refreshToken });
    return loadMe();
  };

  const login = async (identifier, password) => startSession(unwrap(await api.post('/auth/login', { identifier, password })));

  /** Patient OTP sign-in. Returns { needsRegistration, registrationToken } for new numbers. */
  const patientVerify = async ({ clinicSlug, phone, code }) => {
    const d = unwrap(await api.post('/auth/patient/verify-otp', { clinicSlug, phone, code }));
    if (d.needsRegistration) return d;
    return startSession(d);
  };
  const patientRegister = async (payload) => startSession(unwrap(await api.post('/auth/patient/register', payload)));

  const logout = async () => {
    const wasPatient = session.user?.role === 'PATIENT';
    const slug = session.clinic?.slug;
    try { await api.post('/auth/logout'); } catch { /* token may already be gone */ }
    clearTokens();
    disconnectSocket();
    setSession({ user: null, clinic: null, subscription: null, entitlements: null, doctor: null, patient: null, homePath: null });
    return wasPatient ? `/patient/login${slug ? `?clinic=${slug}` : ''}` : '/login';
  };

  const hasFeature = useCallback((feature) => {
    const f = session.entitlements?.features || [];
    return f.includes('*') || f.includes(feature);
  }, [session.entitlements]);

  const value = useMemo(
    () => ({ ...session, loading, login, patientVerify, patientRegister, logout, hasFeature, refreshMe: loadMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, loading, hasFeature]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
