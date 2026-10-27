import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { QrCode, X } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { PageHeader, Field, Section, fieldErrors } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  gender: '',
  dob: '',
  city: '',
  consent: false,
  marketing: false
};

export default function PatientQRRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [clinicInfo, setClinicInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [scanned, setScanned] = useState(false);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Get QR code from URL params
  useEffect(() => {
    const qrCode = searchParams.get('qr');

    if (qrCode) {
      // Fetch clinic info using QR code
      (async () => {
        try {
          const response = await api.get(`/clinics/qr/${qrCode}`).then(unwrap);
          setClinicInfo(response);
          setLoading(false);
        } catch (error) {
          toast.error('Invalid or expired QR code');
          setLoading(false);
        }
      })();
    } else {
      setLoading(false);
    }
  }, [searchParams]);

  const save = useMutation({
    mutationFn: () => api.post('/patients', {
      name: f.name,
      phone: f.phone.startsWith('+') ? f.phone : `+91${f.phone.replace(/\D/g, '').slice(-10)}`,
      email: f.email,
      ...(f.gender ? { gender: f.gender } : {}),
      dob: f.dob,
      address: f.city ? { city: f.city } : undefined,
      clinicId: clinicInfo?.clinic?._id,
      branchId: clinicInfo?.branch?._id,
      consent: {
        dataProcessing: { granted: true },
        marketing: { granted: f.marketing }
      },
    }).then(unwrap),
    onSuccess: (p) => {
      toast.success(`${p.name} registered successfully!`);
      // Redirect to patient portal or confirmation page
      navigate(`/patient-confirmation?patientId=${p._id}`);
      setF(EMPTY);
      setErrors({});
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(e.message);
    },
  });

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Spinner /></div>;

  if (!clinicInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="text-center space-y-6 max-w-md">
          <div className="flex justify-center">
            <div className="h-24 w-24 rounded-full bg-pulse/10 flex items-center justify-center">
              <QrCode className="h-12 w-12 text-pulse" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink mb-2">Scan QR Code</h1>
            <p className="text-ink-muted mb-6">
              Ask the clinic staff for the QR code to register as a new patient.
            </p>
            <button
              onClick={() => navigate('/patient-login')}
              className="btn btn-primary"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Registration"
        description={`Register at ${clinicInfo.clinic?.name} - ${clinicInfo.branch?.name}`}
      />

      <Section>
        <div className="space-y-6">
          {/* Clinic Info Badge */}
          <div className="rounded-lg border border-pulse/30 bg-pulse-soft px-4 py-3">
            <p className="text-sm text-ink-muted">Registering at</p>
            <p className="text-lg font-semibold text-ink">{clinicInfo.clinic?.name}</p>
            <p className="text-sm text-ink-soft">{clinicInfo.branch?.name}</p>
          </div>

          {/* Registration Form */}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="qr-name" error={errors.name}>
                <input
                  id="qr-name"
                  className="field"
                  value={f.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                />
              </Field>
              <Field label="Mobile number" htmlFor="qr-phone" error={errors.phone}>
                <input
                  id="qr-phone"
                  type="tel"
                  className="field"
                  value={f.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email (optional)" htmlFor="qr-email">
                <input
                  id="qr-email"
                  type="email"
                  className="field"
                  value={f.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label="Gender (optional)" htmlFor="qr-gender">
                <select
                  id="qr-gender"
                  className="field"
                  value={f.gender}
                  onChange={(e) => set('gender', e.target.value)}
                >
                  <option value="">Select gender</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date of Birth (optional)" htmlFor="qr-dob">
                <input
                  id="qr-dob"
                  type="date"
                  className="field"
                  value={f.dob}
                  onChange={(e) => set('dob', e.target.value)}
                />
              </Field>
              <Field label="City (optional)" htmlFor="qr-city">
                <input
                  id="qr-city"
                  className="field"
                  value={f.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </Field>
            </div>

            {/* Consent */}
            <div className="space-y-3 pt-4 border-t border-line">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="field mt-1"
                  checked={f.consent}
                  onChange={(e) => set('consent', e.target.checked)}
                  required
                />
                <span className="text-sm text-ink">
                  I consent to my health data being processed and stored securely at this clinic.
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="field mt-1"
                  checked={f.marketing}
                  onChange={(e) => set('marketing', e.target.checked)}
                />
                <span className="text-sm text-ink">
                  I'd like to receive appointment reminders and health tips via WhatsApp or SMS.
                </span>
              </label>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={!f.consent || save.isPending}
              >
                {save.isPending ? 'Registering...' : 'Complete Registration'}
              </button>
            </div>
          </form>
        </div>
      </Section>
    </div>
  );
}
