import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, QrCode } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { PageHeader, Field, Section, fieldErrors } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';

const INITIAL_FORM = {
  name: '',
  phone: '',
  email: '',
  gender: '',
  dob: '',
  city: '',
  consent: false,
  marketing: false,
};

export default function PatientQRRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clinicSlug = searchParams.get('clinic') || '';
  const branchId = searchParams.get('branch') || '';

  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [clinicInfo, setClinicInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [registeredPatient, setRegisteredPatient] = useState(null);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let active = true;

    async function loadClinic() {
      if (!clinicSlug || !branchId) {
        setLoading(false);
        return;
      }

      try {
        const data = await api
          .get(`/public/qr/${encodeURIComponent(clinicSlug)}/${encodeURIComponent(branchId)}`)
          .then(unwrap);

        if (active) setClinicInfo(data);
      } catch (error) {
        if (active) toast.error(error.message || 'This clinic QR code is invalid or inactive');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadClinic();
    return () => { active = false; };
  }, [clinicSlug, branchId]);

  const registration = useMutation({
    mutationFn: async () => {
      const digits = form.phone.replace(/\D/g, '');
      let phone = form.phone.trim();

      if (digits.length === 10) phone = `+91${digits}`;
      else if (digits.length === 12 && digits.startsWith('91')) phone = `+${digits}`;

      const payload = {
        name: form.name.trim(),
        phone,
        email: form.email.trim(),
        gender: form.gender || undefined,
        dob: form.dob || undefined,
        address: form.city.trim() ? { city: form.city.trim() } : undefined,
        consentGiven: form.consent,
        marketingConsent: form.marketing,
      };

      return api
        .post(`/public/qr/${encodeURIComponent(clinicSlug)}/${encodeURIComponent(branchId)}/register`, payload)
        .then(unwrap);
    },
    onSuccess: (data) => {
      setRegisteredPatient(data);
      setErrors({});
      toast.success('Patient registered successfully');
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(error.message || 'Patient registration failed');
    },
  });

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }

  if (!clinicInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-5">
        <div className="max-w-md space-y-4 text-center">
          <QrCode className="mx-auto h-16 w-16 text-pulse" />
          <h1 className="text-2xl font-bold text-ink">Invalid Registration QR</h1>
          <p className="text-ink-muted">This QR code is invalid, incomplete, or the clinic branch is inactive. Please ask the clinic reception for a new QR code.</p>
          <button type="button" onClick={() => navigate('/patient/login')} className="btn btn-primary">Go to Patient Login</button>
        </div>
      </div>
    );
  }

  if (registeredPatient) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-5">
        <div className="w-full max-w-md space-y-4 rounded-2xl bg-surface p-8 text-center shadow-lg">
          <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
          <h1 className="text-2xl font-bold text-ink">Registration Successful</h1>
          <p className="text-ink-muted">Welcome, {registeredPatient.name}.</p>
          <div className="rounded-lg bg-pulse-soft p-4">
            <p className="text-sm text-ink-muted">Your Patient ID</p>
            <p className="break-all text-lg font-bold text-ink">{registeredPatient.patientId}</p>
          </div>
          <p className="text-sm text-ink-muted">Please keep this Patient ID for future reference. Contact the clinic if you need help accessing your patient portal.</p>
          <button type="button" onClick={() => navigate('/patient/login')} className="btn btn-primary w-full">Go to Patient Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Patient Registration"
          description={`Register at ${clinicInfo.clinic.name} — ${clinicInfo.branch.name}`}
        />

        <Section>
          <div className="space-y-5">
            <div className="rounded-lg border border-pulse/30 bg-pulse-soft px-4 py-3">
              <p className="text-sm text-ink-muted">Registering at</p>
              <p className="text-lg font-semibold text-ink">{clinicInfo.clinic.name}</p>
              <p className="text-sm text-ink-soft">{clinicInfo.branch.name}</p>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                registration.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="qr-name" error={errors.name} required>
                  <input id="qr-name" className="field" value={form.name} onChange={(event) => update('name', event.target.value)} minLength={2} maxLength={80} required />
                </Field>

                <Field label="Mobile number" htmlFor="qr-phone" error={errors.phone} required>
                  <input id="qr-phone" type="tel" className="field" value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+91 9876543210" required />
                </Field>

                <Field label="Email (optional)" htmlFor="qr-email" error={errors.email}>
                  <input id="qr-email" type="email" className="field" value={form.email} onChange={(event) => update('email', event.target.value)} />
                </Field>

                <Field label="Gender (optional)" htmlFor="qr-gender" error={errors.gender}>
                  <select id="qr-gender" className="field" value={form.gender} onChange={(event) => update('gender', event.target.value)}>
                    <option value="">Select gender</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>

                <Field label="Date of birth (optional)" htmlFor="qr-dob" error={errors.dob}>
                  <input id="qr-dob" type="date" className="field" value={form.dob} onChange={(event) => update('dob', event.target.value)} />
                </Field>

                <Field label="City (optional)" htmlFor="qr-city">
                  <input id="qr-city" className="field" value={form.city} onChange={(event) => update('city', event.target.value)} maxLength={100} />
                </Field>
              </div>

              <div className="space-y-3 border-t border-line pt-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={form.consent} onChange={(event) => update('consent', event.target.checked)} required />
                  <span className="text-sm text-ink">I consent to my personal information being processed and stored securely by this clinic for registration and healthcare services.</span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={form.marketing} onChange={(event) => update('marketing', event.target.checked)} />
                  <span className="text-sm text-ink">I separately agree to receive optional promotional communications from this clinic.</span>
                </label>
              </div>

              <button type="submit" disabled={!form.consent || registration.isPending} className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50">
                {registration.isPending ? 'Registering…' : 'Complete Registration'}
              </button>
            </form>
          </div>
        </Section>
      </div>
    </div>
  );
}
