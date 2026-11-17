import { useState } from 'react';
import { Mail, Phone, MapPin, CheckCircle2 } from 'lucide-react';
import { gsap, useGsapContext, revealSectionsOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { Spinner } from '../../components/ui/States.jsx';

const CHANNELS = [
  [Mail, 'Email', 'hello@clinicsaathi.in'],
  [Phone, 'Phone', '+91 80 4001 2345'],
  [MapPin, 'Office', 'Bengaluru, Karnataka'],
];

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', clinic: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-hero-in]', { opacity: 0, y: 20, duration: 0.6, stagger: 0.08, ease: 'power2.out' });
    revealSectionsOnScroll({ y: 20, stagger: 0.06 });
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setStatus('sending');
    setTimeout(() => setStatus('sent'), 900);
  };

  const canSubmit = form.name.length > 1 && form.email.includes('@') && form.message.length > 4;

  return (
    <div>
      <section className="px-5 pb-4 pt-16 text-center md:pt-24">
        <p data-hero-in className="text-sm font-medium uppercase tracking-wide text-pulse-deep">Contact</p>
        <h1 data-text-reveal className="mt-3 font-display text-title font-bold sm:text-display">Talk to us</h1>
        <p data-hero-in className="mx-auto mt-4 max-w-lg text-lg text-ink-soft">
          Questions about a plan, multi-branch or moving from another system — a real person replies within a business day.
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div data-reveal className="space-y-6">
            {CHANNELS.map(([Icon, label, value]) => (
              <div key={label} className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pulse-soft text-pulse-deep">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm text-ink-muted">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              </div>
            ))}
            <div className="rounded-card border border-line bg-surface p-5">
              <p className="font-display text-sm font-semibold">Prefer a live demo?</p>
              <p className="mt-1.5 text-sm text-ink-soft">Book a 20-minute walkthrough with our team instead of the form — we'll show the WhatsApp flow live.</p>
            </div>
          </div>

          <div data-reveal className="card p-6 sm:p-8">
            {status === 'sent' ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-4 rounded-full bg-pulse-soft p-3">
                  <CheckCircle2 className="h-6 w-6 text-pulse-deep" strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-lg font-semibold">Message sent</h3>
                <p className="mt-1.5 max-w-xs text-sm text-ink-muted">Thanks, {form.name.split(' ')[0]}. We'll reply at {form.email} within a business day.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="cname">Name</label>
                    <input id="cname" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="cemail">Email</label>
                    <input id="cemail" type="email" className="field" value={form.email} onChange={(e) => set('email', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="cclinic">Clinic name</label>
                  <input id="cclinic" className="field" placeholder="Optional" value={form.clinic} onChange={(e) => set('clinic', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="cmessage">Message</label>
                  <textarea id="cmessage" rows={4} className="field resize-none" value={form.message} onChange={(e) => set('message', e.target.value)} />
                </div>
                <button type="submit" disabled={!canSubmit || status === 'sending'} className="btn-primary w-full">
                  {status === 'sending' && <Spinner />} Send message
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
