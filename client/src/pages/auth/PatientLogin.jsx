import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { AuthLayout } from './AuthLayout.jsx';

/**
 * Patients sign in to one clinic's portal with a one-time code to their
 * mobile. New numbers are registered after the code proves the phone.
 */
export default function PatientLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { patientVerify, patientRegister } = useAuth();
  const [step, setStep] = useState('phone');
  const [form, setForm] = useState({ clinicSlug: params.get('clinic') || '', phone: '', code: '', name: '', consent: false });
  const [regToken, setRegToken] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, info: null });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const phone = form.phone.startsWith('+') ? form.phone : `+91${form.phone.replace(/\D/g, '').slice(-10)}`;

  const run = async (fn) => {
    setState({ busy: true, error: null });
    try { await fn(); } catch (e) { setState({ busy: false, error: e.details?.[0]?.message || e.message }); return; }
    setState((s) => ({ ...s, busy: false }));
  };

  const requestCode = () => run(async () => {
    const r = await api.post('/auth/patient/request-otp', { clinicSlug: form.clinicSlug.trim().toLowerCase(), phone });
    setStep('code');
    setState({ busy: false, info: r.data.data.message });
  });
  const verify = () => run(async () => {
    const r = await patientVerify({ clinicSlug: form.clinicSlug.trim().toLowerCase(), phone, code: form.code });
    if (r.needsRegistration) { setRegToken(r.registrationToken); setStep('register'); return; }
    navigate('/patient/dashboard', { replace: true });
  });
  const register = () => run(async () => {
    await patientRegister({ registrationToken: regToken, name: form.name, consentGiven: true });
    navigate('/patient/dashboard', { replace: true });
  });

  return (
    <AuthLayout heading="Your appointments, prescriptions and reports in one place." sub="Book, reschedule, see your queue position and download released reports — securely, with a code sent to your phone.">
      <h1 className="font-display text-2xl font-semibold">Patient sign-in</h1>
      <p className="mt-1.5 text-sm text-ink-muted">We'll send a 6-digit code to your mobile number.</p>

      <div className="mt-7 space-y-4">
        {step === 'phone' && (
          <>
            <div>
              <label className="label" htmlFor="pl-clinic">Clinic code</label>
              <input id="pl-clinic" className="field" placeholder="e.g. sunrise-skin-clinic" value={form.clinicSlug} onChange={(e) => set('clinicSlug', e.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">It's the last part of your clinic's booking link.</p>
            </div>
            <div>
              <label className="label" htmlFor="pl-phone">Mobile number</label>
              <div className="relative">
                <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input id="pl-phone" type="tel" inputMode="tel" autoComplete="tel" className="field pl-9" placeholder="98765 43210" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
            </div>
            <button className="btn-primary w-full" disabled={state.busy || !form.clinicSlug || form.phone.replace(/\D/g, '').length < 10} onClick={requestCode}>
              {state.busy && <Spinner />} Send code
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            {state.info && <p className="rounded-lg bg-pulse-soft px-3 py-2 text-sm text-pulse-deep">{state.info}</p>}
            <div>
              <label className="label" htmlFor="pl-code">6-digit code</label>
              <input id="pl-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="field text-center font-mono text-lg tracking-[0.5em]"
                     value={form.code} onChange={(e) => set('code', e.target.value.replace(/\D/g, ''))} />
            </div>
            <button className="btn-primary w-full" disabled={state.busy || form.code.length !== 6} onClick={verify}>{state.busy && <Spinner />} Verify and continue</button>
            <button className="btn-quiet w-full text-sm" onClick={() => { setStep('phone'); set('code', ''); }}>Use a different number</button>
          </>
        )}

        {step === 'register' && (
          <>
            <p className="rounded-lg bg-pulse-soft px-3 py-2 text-sm text-pulse-deep">Number verified. Tell us who you are to finish.</p>
            <div>
              <label className="label" htmlFor="pl-name">Full name</label>
              <input id="pl-name" className="field" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <label className="flex items-start gap-2.5 text-sm text-ink-soft">
              <input type="checkbox" className="mt-0.5" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
              <span>I agree that the clinic may store my health and contact details to provide care and contact me about my appointments.</span>
            </label>
            <button className="btn-primary w-full" disabled={state.busy || form.name.trim().length < 2 || !form.consent} onClick={register}>{state.busy && <Spinner />} Create my account</button>
          </>
        )}

        {state.error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{state.error}</p>}
      </div>

      <p className="mt-8 text-sm text-ink-muted">Clinic staff? <Link to="/login" className="font-medium text-pulse-deep hover:underline">Staff sign-in</Link></p>
    </AuthLayout>
  );
}
