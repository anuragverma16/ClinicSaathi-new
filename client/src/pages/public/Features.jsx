import { Link } from 'react-router-dom';
import {
  CalendarDays, ListOrdered, Stethoscope, Receipt, MessageCircle, RefreshCw, Check,
} from 'lucide-react';
import { gsap, useGsapContext, revealSectionsOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { GlyphTile, BlobBackdrop } from '../../components/marketing/illustrations.jsx';

function CalendarMock() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between text-sm font-medium"><span>Dr. Anjali Mehta</span><span className="text-ink-muted">Fri, 24 Apr</span></div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {['9:00', '9:15', '9:30', '9:45'].map((t, i) => (
          <div key={t} className={`rounded-lg border px-2 py-3 text-center text-xs font-mono ${i === 2 ? 'border-pulse bg-pulse text-on-pulse' : 'border-line bg-paper-sunk text-ink-muted'}`}>{t}</div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-pulse-soft px-3 py-2 text-xs text-pulse-deep">Booked via WhatsApp · confirmation sent</div>
    </div>
  );
}

function QueueMock() {
  return (
    <div className="card p-5">
      <p className="text-sm font-medium">Waiting room · MG Road</p>
      <ul className="mt-3 space-y-2">
        {[['A7', 'With doctor', 'positive'], ['A8', 'Waiting · 12 min', 'warning'], ['A9', 'Waiting · 4 min', 'warning']].map(([tok, status, tone]) => (
          <li key={tok} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
            <span className="font-mono font-semibold">{tok}</span>
            <span className={`text-xs ${tone === 'positive' ? 'text-pulse-deep' : 'text-signal'}`}>{status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConsultMock() {
  return (
    <div className="card p-5 text-sm">
      <p className="font-medium">Rahul Verma · 38 · Type 2 Diabetes</p>
      <div className="mt-3 space-y-2 text-ink-soft">
        <p><span className="text-ink-muted">Dx —</span> Routine diabetes review, well controlled</p>
        <p><span className="text-ink-muted">Rx —</span> Metformin 500mg, continue</p>
      </div>
      <div className="mt-3 flex gap-2">
        <span className="rounded-full bg-pulse-soft px-2.5 py-1 text-xs text-pulse-deep">Invoice generated</span>
        <span className="rounded-full bg-signal-soft px-2.5 py-1 text-xs text-signal">Follow-up in 90 days</span>
      </div>
    </div>
  );
}

function BillingMock() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between text-sm"><span className="font-medium">Invoice #INV-1042</span><span className="rounded-full bg-pulse-soft px-2 py-0.5 text-xs text-pulse-deep">Paid</span></div>
      <div className="mt-3 space-y-1.5 text-sm text-ink-soft">
        <div className="flex justify-between"><span>Diabetes review</span><span>₹800</span></div>
        <div className="flex justify-between"><span>GST (0%)</span><span>₹0</span></div>
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-semibold"><span>Total</span><span>₹800</span></div>
    </div>
  );
}

function FollowUpMock() {
  return (
    <div className="card space-y-2 p-5 text-sm">
      <div className="ml-auto max-w-[75%] rounded-lg rounded-br-sm bg-pulse px-3 py-2 text-white">How are you feeling since Tuesday's visit?</div>
      <div className="mr-auto max-w-[75%] rounded-lg rounded-bl-sm bg-paper-sunk px-3 py-2">Much better, thank you!</div>
      <p className="pt-1 text-xs text-ink-muted">No concerning keywords detected — no staff alert raised.</p>
    </div>
  );
}

function RecallMock() {
  return (
    <div className="card p-5">
      <p className="text-sm font-medium">Recall due this week</p>
      <ul className="mt-3 space-y-2 text-sm">
        {[['Sneha Kulkarni', 'Annual checkup · 8 months overdue'], ['Arjun Desai', 'Dental cleaning · due in 3 days']].map(([n, r]) => (
          <li key={n} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
            <span>{n}</span><span className="text-xs text-ink-muted">{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MODULES = [
  {
    id: 'appointments', icon: CalendarDays, name: 'Appointments', tone: 'pulse', Mock: CalendarMock,
    tagline: 'One calendar per doctor, filled from every channel at once.',
    bullets: ['Booking from your website, a QR code, WhatsApp or the front desk', 'Real-time availability — no two patients ever double-booked', 'Automatic confirmation and reminder on WhatsApp and SMS'],
  },
  {
    id: 'queue', icon: ListOrdered, name: 'Queue', tone: 'signal', Mock: QueueMock,
    tagline: 'Check-in issues a token. Everyone sees the same, honest line.',
    bullets: ['Waiting-room screen and doctor\'s tab update together, live', 'Walk-ins slot in fairly alongside booked appointments', 'Average wait time shown to patients before they sit down'],
  },
  {
    id: 'consultation', icon: Stethoscope, name: 'Consultation', tone: 'pulse', Mock: ConsultMock,
    tagline: 'History, notes and prescription in the flow the doctor already works in.',
    bullets: ['Full visit history and chronic conditions, one screen', 'Structured prescriptions patients can read at the pharmacy', 'Finishing a visit is what triggers billing and follow-up'],
  },
  {
    id: 'billing', icon: Receipt, name: 'Billing', tone: 'signal', Mock: BillingMock,
    tagline: 'GST-correct invoices, collected the way patients actually pay.',
    bullets: ['UPI and card collection built into the invoice flow', 'Partial payments tracked against a running balance', 'A live list of exactly who still owes what'],
  },
  {
    id: 'follow-ups', icon: MessageCircle, name: 'Follow-ups', tone: 'pulse', Mock: FollowUpMock,
    tagline: 'Scheduled at the end of the consult. Sent without anyone remembering.',
    bullets: ['Timed to the specific visit — day 2, day 7, day 30', 'Replies that sound concerning are flagged to staff, not auto-answered', 'Never attempts clinical judgment — logistics only'],
  },
  {
    id: 'recall', icon: RefreshCw, name: 'Recall', tone: 'signal', Mock: RecallMock,
    tagline: 'The list of who is overdue builds itself from visit history.',
    bullets: ['A cleaning due at six months, a diabetes review at three', 'Recall messages go out automatically, ahead of the due date', 'One screen shows every overdue patient across the clinic'],
  },
];

export default function Features() {
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-hero-in]', { opacity: 0, y: 20, duration: 0.6, stagger: 0.08, ease: 'power2.out' });
    MODULES.forEach((m) => {
      const row = document.getElementById(m.id);
      if (!row) return;
      gsap.from(row.querySelectorAll('[data-row-text]'), {
        opacity: 0, x: -24, duration: 0.6, ease: 'power2.out',
        scrollTrigger: { trigger: row, start: 'top 75%', once: true },
      });
      gsap.from(row.querySelectorAll('[data-row-mock]'), {
        opacity: 0, x: 24, duration: 0.6, ease: 'power2.out',
        scrollTrigger: { trigger: row, start: 'top 75%', once: true },
      });
    });
    revealSectionsOnScroll({ y: 20, stagger: 0.05 });
  }, []);

  return (
    <div>
      <section className="relative overflow-hidden px-5 pb-16 pt-16 text-center md:pt-24">
        <BlobBackdrop className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[480px] -translate-x-1/2" tone="pulse" />
        <div className="relative mx-auto max-w-2xl">
          <p data-hero-in className="text-sm font-medium uppercase tracking-wide text-pulse-deep">Everything inside ClinicSaathi</p>
          <h1 data-text-reveal className="mt-3 font-display text-title font-bold sm:text-display">Six modules. One system.</h1>
          <p data-hero-in className="mt-4 text-lg text-ink-soft">
            Not separate tools bolted together — finishing one step is what starts the next.
          </p>
        </div>
      </section>

      <div className="divide-y divide-line border-y border-line">
        {MODULES.map((m, i) => (
          <section key={m.id} id={m.id} className="bg-paper-sunk">
            <div className="mx-auto max-w-6xl px-5 py-20">
              <div className={`grid items-center gap-12 lg:grid-cols-2 ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
                <div data-row-text>
                  <GlyphTile icon={m.icon} tone={m.tone} />
                  <h2 className="mt-5 font-display text-title font-semibold">{m.name}</h2>
                  <p className="mt-2 text-lg text-ink-soft">{m.tagline}</p>
                  <ul className="mt-6 space-y-3">
                    {m.bullets.map((b) => (
                      <li key={b} className="flex gap-2.5 text-[15px] text-ink-soft">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-pulse-deep" /> {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div data-row-mock><m.Mock /></div>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 data-text-reveal className="font-display text-title font-semibold">See it running on your own clinic</h2>
        <p data-reveal className="mx-auto mt-3 max-w-md text-ink-soft">14 days free. No card needed.</p>
        <Link to="/contact" data-reveal className="btn-primary mt-7 inline-flex">Book a demo</Link>
      </section>
    </div>
  );
}
