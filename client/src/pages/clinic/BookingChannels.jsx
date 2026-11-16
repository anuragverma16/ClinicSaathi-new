import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { Globe, Link2, QrCode, MessageCircle, MapPin, Facebook, Instagram, Copy, Download, ExternalLink, Code2 } from 'lucide-react';

/**
 * Every place a patient can book from. Each channel gets its own tagged link
 * (?src=...) so Analytics can show which channel fills the calendar, plus a
 * printable QR code.
 */
const CHANNELS = [
  { key: 'website', label: 'Clinic website', icon: Globe, grad: 'from-sky-500 to-blue-600', hint: 'Add a "Book appointment" button to your site.' },
  { key: 'link', label: 'Booking link', icon: Link2, grad: 'from-teal-500 to-emerald-500', hint: 'Share anywhere — SMS, email, bio.' },
  { key: 'qr', label: 'QR code', icon: QrCode, grad: 'from-violet-500 to-fuchsia-500', hint: 'Print for the reception desk, posters and visiting cards.' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, grad: 'from-green-500 to-emerald-600', hint: 'Patients can also just message "Hi" to your WhatsApp number.' },
  { key: 'google', label: 'Google Business Profile', icon: MapPin, grad: 'from-amber-400 to-orange-500', hint: 'Paste as the "Appointment link" in your Google profile.' },
  { key: 'facebook', label: 'Facebook', icon: Facebook, grad: 'from-blue-500 to-indigo-600', hint: 'Use as the page\'s "Book Now" button link.' },
  { key: 'instagram', label: 'Instagram', icon: Instagram, grad: 'from-pink-500 to-rose-500', hint: 'Add to your bio or as an action button.' },
];

const copy = async (text, what = 'Link') => {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); } catch { toast.error('Copy failed — select and copy manually'); }
};

function QrImage({ url, name }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: '#0B1F3A', light: '#FFFFFF' } }).then(setSrc).catch(() => setSrc(''));
  }, [url]);
  if (!src) return <div className="h-32 w-32 animate-pulse rounded-xl bg-paper-sunk" />;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} alt={`QR code for ${name}`} className="h-32 w-32 rounded-xl border border-line bg-white p-1.5 shadow-sm" />
      <a href={src} download={`${name}-booking-qr.png`} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /> PNG</a>
    </div>
  );
}

export function BookingChannels({ slug, clinicName }) {
  const base = `${window.location.origin}/book/${slug}`;
  const linkFor = (key) => (key === 'website' ? base : `${base}?src=${key}`);
  const fileName = slug || 'clinic';
  const embed = `<a href="${linkFor('website')}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0D9488;color:#fff;font:600 15px system-ui;text-decoration:none">Book appointment</a>`;

  return (
    <div className="space-y-5">
      {/* Hero: the main QR, ready to print */}
      <div className="card rise-in relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <QrImage url={linkFor('qr')} name={fileName} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-pulse-deep">Scan to book</p>
            <h3 className="mt-1 font-display text-xl font-semibold">{clinicName}</h3>
            <p className="mt-1 text-sm text-ink-muted">Patients scan, pick a doctor and a free slot, and get instant WhatsApp confirmation — no app needed. Print this at the front desk, on prescriptions and on posters.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" onClick={() => copy(linkFor('link'))}><Copy className="h-3.5 w-3.5" /> Copy booking link</button>
              <a className="btn-ghost btn-sm" href={linkFor('link')} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open booking page</a>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CHANNELS.map(({ key, label, icon: Icon, grad, hint }, i) => {
          const url = linkFor(key);
          const share = key === 'whatsapp' ? `https://wa.me/?text=${encodeURIComponent(`Book your appointment at ${clinicName}: ${url}`)}` : null;
          return (
            <div key={key} className="card card-hover rise-in flex flex-col gap-3 p-4" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md shadow-black/10 ${grad}`}><Icon className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{label}</p>
                  <p className="truncate text-xs text-ink-muted">{hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{url}</span>
                <button className="btn-quiet btn-sm" onClick={() => copy(url)} aria-label={`Copy ${label} link`}><Copy className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                {share && <a className="btn-ghost btn-sm" href={share} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" /> Share on WhatsApp</a>}
                {key === 'website' && <button className="btn-ghost btn-sm" onClick={() => copy(embed, 'Button code')}><Code2 className="h-3.5 w-3.5" /> Copy button code</button>}
                <QrDownload url={url} name={`${fileName}-${key}`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QrDownload({ url, name }) {
  const download = async () => {
    const data = await QRCode.toDataURL(url, { width: 600, margin: 2, color: { dark: '#0B1F3A', light: '#FFFFFF' } });
    const a = document.createElement('a');
    a.href = data; a.download = `${name}-qr.png`; a.click();
  };
  return <button className="btn-ghost btn-sm" onClick={download}><QrCode className="h-3.5 w-3.5" /> QR code</button>;
}
