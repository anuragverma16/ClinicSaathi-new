import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Spinner } from '../../components/ui/States.jsx';
import { AuthLayout } from './AuthLayout.jsx';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ busy: false, done: false, error: null });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try { await api.post('/auth/forgot-password', { email }); setState({ done: true }); }
    catch (err) { setState({ error: err.message }); }
  };
  return (
    <AuthLayout>
      <h1 className="font-display text-2xl font-semibold">Reset your password</h1>
      {state.done ? (
        <p className="mt-4 rounded-lg bg-pulse-soft p-4 text-sm text-pulse-deep">If that email belongs to an account, a reset link is on its way. It expires in 30 minutes.</p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="fp-email">Account email</label>
            <input id="fp-email" type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {state.error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{state.error}</p>}
          <button className="btn-primary w-full" disabled={state.busy || !email}>{state.busy && <Spinner />} Send reset link</button>
        </form>
      )}
      <p className="mt-6 text-sm"><Link to="/login" className="text-pulse-deep hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [state, setState] = useState({ busy: false, error: null });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api.post('/auth/reset-password', { uid: params.get('uid'), token: params.get('token'), password });
      navigate('/login', { replace: true });
    } catch (err) { setState({ error: err.details?.[0]?.message || err.message }); }
  };
  return (
    <AuthLayout>
      <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="rp-pass">New password</label>
          <input id="rp-pass" type="password" autoComplete="new-password" required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-ink-muted">At least 8 characters, with a letter and a number.</p>
        </div>
        {state.error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{state.error}</p>}
        <button className="btn-primary w-full" disabled={state.busy || password.length < 8}>{state.busy && <Spinner />} Set password</button>
      </form>
    </AuthLayout>
  );
}
