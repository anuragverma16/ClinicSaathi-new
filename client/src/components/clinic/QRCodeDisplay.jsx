import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Copy, X } from 'lucide-react';
import toast from 'react-hot-toast';

export function QRCodeDisplay({
  clinicSlug,
  branchId,
  clinicName,
  branchName,
  onClose,
}) {
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const registrationUrl = useMemo(() => {
    if (!clinicSlug || !branchId || typeof window === 'undefined') return '';
    const url = new URL('/patient-register-qr', window.location.origin);
    url.searchParams.set('clinic', clinicSlug);
    url.searchParams.set('branch', String(branchId));
    return url.toString();
  }, [clinicSlug, branchId]);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      if (!registrationUrl) {
        setQrImageUrl('');
        return;
      }

      setLoading(true);
      try {
        const dataUrl = await QRCode.toDataURL(registrationUrl, {
          width: 420,
          margin: 2,
          errorCorrectionLevel: 'H',
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        if (!cancelled) setQrImageUrl(dataUrl);
      } catch (error) {
        console.error('Patient QR generation failed:', error);
        if (!cancelled) toast.error('Could not generate the QR code');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, [registrationUrl]);

  async function copyLink() {
    if (!registrationUrl) return;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setCopied(true);
      toast.success('Registration link copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the link. Please copy it manually.');
    }
  }

  function downloadQR() {
    if (!qrImageUrl) return;
    const anchor = document.createElement('a');
    anchor.href = qrImageUrl;
    anchor.download = `${(clinicSlug || 'clinic')}-${(branchName || 'branch').replace(/[^a-z0-9-_]/gi, '-')}-patient-registration-qr.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast.success('QR code downloaded');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-20">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-surface p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">Patient Registration QR</h2>
          <button type="button" onClick={onClose} aria-label="Close QR dialog" className="rounded-lg p-2 transition-colors hover:bg-paper">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-0.5 text-center">
          <p className="text-xs text-ink-muted">Patients will register at</p>
          <p className="font-semibold text-ink">{clinicName || 'Clinic'}</p>
          <p className="text-xs text-ink-soft">{branchName || 'Main branch'}</p>
        </div>

        <div className="flex min-h-64 items-center justify-center rounded-lg border border-line bg-white p-4">
          {loading ? (
            <p className="text-sm text-gray-500">Generating QR code…</p>
          ) : qrImageUrl ? (
            <img src={qrImageUrl} alt="Patient registration QR code" className="h-56 w-56 object-contain" />
          ) : (
            <p className="max-w-xs text-center text-sm text-red-600">
              QR code unavailable. The clinic slug or branch ID is missing.
            </p>
          )}
        </div>

        <div className="rounded-lg bg-pulse-soft p-3">
          <p className="text-xs leading-relaxed text-ink">
            <strong>Instructions:</strong> Patients can scan this code using their phone camera to open the clinic's patient registration form.
          </p>
        </div>

        <div className="space-y-2">
          <button type="button" onClick={downloadQR} disabled={!qrImageUrl} className="btn btn-primary flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="h-4 w-4" /> Download QR Code
          </button>
          <button type="button" onClick={copyLink} disabled={!registrationUrl} className="btn btn-ghost flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
            <Copy className="h-4 w-4" /> {copied ? 'Link Copied!' : 'Copy Registration Link'}
          </button>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="patient-registration-url" className="text-xs font-semibold text-ink-soft">Registration link</label>
          <input id="patient-registration-url" type="text" value={registrationUrl} readOnly className="field w-full p-2 text-xs" />
        </div>
      </div>
    </div>
  );
}
