import { useState } from 'react';
import { Download, Copy, X } from 'lucide-react';
import toast from 'react-hot-toast';

export function QRCodeDisplay({ clinicId, branchId, clinicName, branchName, onClose }) {
  const [copied, setCopied] = useState(false);

  // Generate QR code value - this should be the registration URL
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const qrValue = clinicId && branchId ? `${origin}/patient-register-qr?qr=${String(clinicId)}-${String(branchId)}` : `${origin}/patient-register-qr?qr=test-clinic`;

  // Use QR Server API to generate QR code image
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrValue)}`;

  console.log('QR Debug:', { clinicId, branchId, qrValue, qrImageUrl });

  const downloadQR = () => {
    if (!qrImageUrl) {
      toast.error('QR code not available');
      return;
    }
    const link = document.createElement('a');
    link.href = qrImageUrl;
    link.download = `${clinicName}-${branchName}-qr.png`;
    link.click();
    toast.success('QR code downloaded!');
  };

  const copyLink = () => {
    if (!qrValue) {
      toast.error('Registration link not available');
      return;
    }
    navigator.clipboard.writeText(qrValue);
    setCopied(true);
    toast.success('Registration link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto pt-20">
      <div className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-ink">Patient Registration QR</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-paper rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Clinic Info */}
        <div className="text-center space-y-0.5">
          <p className="text-xs text-ink-muted">Scanning QR will direct patients to:</p>
          <p className="font-semibold text-ink text-sm">{clinicName}</p>
          <p className="text-xs text-ink-soft">{branchName}</p>
        </div>

        {/* QR Code */}
        {qrImageUrl ? (
          <div className="flex justify-center bg-white p-4 rounded-lg border border-line">
            <img
              src={qrImageUrl}
              alt="Patient Registration QR Code"
              className="w-44 h-44"
              onError={(e) => {
                console.error('QR code failed to load');
                toast.error('QR code failed to load');
              }}
            />
          </div>
        ) : (
          <div className="flex justify-center p-4">
            <p className="text-sm text-ink-muted">Loading QR code...</p>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-pulse-soft p-3 rounded-lg">
          <p className="text-xs text-ink leading-relaxed">
            📱 <strong>Instructions:</strong> Patients can scan this QR code to register themselves at your clinic. Share it at the reception desk or print it.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-1.5">
          <button
            onClick={downloadQR}
            className="btn btn-primary w-full flex items-center justify-center gap-2"
            disabled={!qrImageUrl}
          >
            <Download className="h-4 w-4" />
            Download QR Code
          </button>
          <button
            onClick={copyLink}
            className="btn btn-ghost w-full flex items-center justify-center gap-2"
            disabled={!qrValue}
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Link Copied!' : 'Copy Registration Link'}
          </button>
        </div>

        {/* Registration Link */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink-soft">Registration Link</label>
          <input
            type="text"
            value={qrValue}
            readOnly
            className="field w-full text-xs p-2"
          />
        </div>
      </div>
    </div>
  );
}
