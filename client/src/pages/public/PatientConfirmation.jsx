import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Phone } from 'lucide-react';

export default function PatientConfirmation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patientId');

  useEffect(() => {
    // Redirect if no patientId
    if (!patientId) {
      navigate('/');
    }
  }, [patientId, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-paper to-paper-sunk flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        {/* Success Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-pulse/20 rounded-full blur-2xl animate-pulse"></div>
            <div className="relative bg-pulse/10 rounded-full p-6 flex items-center justify-center">
              <CheckCircle2 className="h-20 w-20 text-pulse" />
            </div>
          </div>
        </div>

        {/* Success Message */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-ink">Registration Complete!</h1>
          <p className="text-ink-muted">
            Your profile has been successfully created. You're all set to book appointments!
          </p>
        </div>

        {/* What's Next */}
        <div className="bg-pulse-soft border border-pulse/30 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-ink">What's Next?</h2>
          <ul className="space-y-3 text-left">
            <li className="flex gap-3">
              <span className="text-pulse font-bold">1.</span>
              <span className="text-sm text-ink">
                Your appointment details have been sent via WhatsApp
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-pulse font-bold">2.</span>
              <span className="text-sm text-ink">
                Save your clinic's phone number for easy access
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-pulse font-bold">3.</span>
              <span className="text-sm text-ink">
                You can book your first appointment with your preferred doctor
              </span>
            </li>
          </ul>
        </div>

        {/* Contact Info */}
        <div className="bg-surface border border-line rounded-lg p-4">
          <p className="text-sm text-ink-muted mb-3">Need help?</p>
          <div className="flex items-center justify-center gap-2 text-ink font-medium">
            <Phone className="h-4 w-4" />
            <span>WhatsApp: +91-XXXXX-XXXXX</span>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="space-y-2">
          <button
            onClick={() => navigate('/patient-login')}
            className="btn btn-primary w-full"
          >
            Go to Patient Portal
          </button>
          <button
            onClick={() => navigate('/')}
            className="btn btn-ghost w-full"
          >
            Back to Home
          </button>
        </div>

        {/* Fine Print */}
        <p className="text-xs text-ink-muted">
          Your health information is securely stored and encrypted. We respect your privacy.
        </p>
      </div>
    </div>
  );
}
