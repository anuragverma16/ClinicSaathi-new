import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { AuthLayout } from './AuthLayout.jsx';

/**
 * One sign-in for all clinic staff and platform admins. Nobody picks a role:
 * the server decides it from the account and returns the matching dashboard.
 */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await login(form.identifier.trim(), form.password);
      const from = location.state?.from?.pathname;
      navigate(from && from.startsWith(me.homePath.split('/').slice(0, 2).join('/')) ? from : me.homePath, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="font-display text-2xl font-semibold">Sign in to ClinicSaathi</h1>
      <p className="mt-1.5 text-sm text-ink-muted">For clinic owners, doctors, front desk, accounts, lab and branch teams.</p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="identifier">Email or mobile number</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input id="identifier" required autoComplete="username" className="field pl-9"
                   value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">Password</label>
            <Link to="/forgot-password" className="mb-1.5 text-xs font-medium text-pulse-deep hover:underline">Forgot password?</Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input id="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
                   className="field pl-9 pr-10" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}

        <button type="submit" disabled={busy || !form.identifier || !form.password} className="btn-primary group w-full">
          {busy ? <Spinner /> : <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
        </button>
      </form>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-xs text-ink-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-pulse" />
        You'll land on the dashboard for the role your clinic assigned you. Clinics and logins are created by the ClinicSaathi admin — there is no self sign-up.
      </div>
      <div className="mt-6 space-y-2 text-sm text-ink-muted">
        <p>Patient? <Link to="/patient/login" className="font-medium text-pulse-deep hover:underline">Sign in with your mobile number</Link></p>
        <p>New clinic? <Link to="/contact" className="font-medium text-pulse-deep hover:underline">Contact us to get onboarded</Link></p>
      </div>
    </AuthLayout>
  );
}
