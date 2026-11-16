import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, ChevronDown } from 'lucide-react';
import { gsap, useGsapContext, revealOnScroll, revealSectionsOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';

const PLANS = [
  { name: 'Starter', price: 999, who: '1 doctor', features: ['Online appointment booking', 'WhatsApp confirmations', 'Appointment reminders', 'Patient database'] },
  { name: 'Growth', price: 2999, who: 'Up to 5 doctors', features: ['Everything in Starter', 'Unlimited patients', 'Queue management', 'Billing', 'Follow-ups', 'Reports', 'Doctor dashboard'], highlight: true },
  { name: 'Pro', price: 5999, who: 'Multi-doctor (up to 25)', features: ['Everything in Growth', 'AI receptionist', 'AI follow-up', 'AI recall engine', 'Review automation', 'Marketing campaigns', 'Multi-doctor support'] },
  { name: 'Enterprise', price: null, who: 'Hospitals and chains', features: ['Everything in Pro', 'Multi-branch', 'White label', 'API access', 'Dedicated success manager', 'Custom integrations'] },
];

const COMPARE_ROWS = [
  ['Doctors included', '1', '5', '25', 'Unlimited'],
  ['Branches', '1', '1', '1', 'Unlimited'],
  ['Online booking (web, QR, WhatsApp, Google, social)', true, true, true, true],
  ['WhatsApp confirmations & reminders', true, true, true, true],
  ['Queue & tokens', false, true, true, true],
  ['Billing & GST invoices', false, true, true, true],
  ['Follow-ups', false, true, true, true],
  ['Analytics & reports', false, true, true, true],
  ['AI WhatsApp receptionist', false, false, true, true],
  ['AI follow-up assistant', false, false, true, true],
  ['AI recall engine', false, false, true, true],
  ['Google review automation', false, false, true, true],
  ['Marketing campaigns', false, false, true, true],
  ['White label & API access', false, false, false, true],
];

const FAQS = [
  ['Can I switch plans later?', 'Yes — upgrade or downgrade at any time from Settings. Changes apply to your next billing cycle, and we prorate the difference.'],
  ['Is there a setup fee?', 'No. Every plan starts with a 14-day free trial and no card is required until you decide to continue.'],
  ['What happens to my data if I cancel?', 'You can export every patient record, invoice and appointment at any time. We retain your data for 90 days after cancellation in case you come back.'],
  ['Do you support multiple branches?', 'Growth and Pro support one branch. Multi-branch, white-label and API access are available on Enterprise — talk to us.'],
  ['Is patient data stored in India?', 'Yes, always. No exceptions, no offshore backups.'],
];

export default function Pricing() {
  const [openFaq, setOpenFaq] = useState(0);

  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-hero-in]', { opacity: 0, y: 20, duration: 0.6, stagger: 0.08, ease: 'power2.out' });
    revealOnScroll(gsap.utils.toArray('[data-plan]'), { y: 24, stagger: 0.1 });
    revealSectionsOnScroll({ y: 20, stagger: 0.05 });
  }, []);

  return (
    <div>
      <section className="px-5 pb-4 pt-16 text-center md:pt-24">
        <p data-hero-in className="text-sm font-medium uppercase tracking-wide text-pulse-deep">Pricing</p>
        <h1 data-text-reveal className="mt-3 font-display text-title font-bold sm:text-display">Priced for a clinic, not a hospital chain</h1>
        <p data-hero-in className="mx-auto mt-4 max-w-lg text-lg text-ink-soft">
          One flat monthly fee per plan. No per-appointment charges, no surprise invoices.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <div key={plan.name} data-plan
                 className={`rounded-card border p-6 ${plan.highlight ? 'border-pulse bg-pulse-soft/30 shadow-lift' : 'border-line bg-surface'}`}>
              {plan.highlight && <p className="mb-3 inline-flex rounded-full bg-pulse px-2.5 py-1 text-xs font-medium text-white">Most popular</p>}
              <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 text-sm text-ink-muted">{plan.who}</p>
              <p className="mt-4 font-display text-3xl font-bold">{plan.price ? <>₹{plan.price.toLocaleString('en-IN')}
                <span className="text-base font-normal text-ink-muted">/month</span></> : 'Custom'}</p>
              <ul className="mt-5 space-y-2 text-sm text-ink-soft">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-pulse-deep" />{f}</li>
                ))}
              </ul>
              <Link to="/contact" className={`mt-6 w-full ${plan.highlight ? 'btn-primary' : 'btn-ghost'}`}>
                {plan.price ? 'Book a demo' : 'Talk to sales'}
              </Link>
            </div>
          ))}
        </div>
        <p data-reveal className="mt-6 text-center text-sm text-ink-muted">
          Multi-branch, white label and API access are on Enterprise. <Link to="/contact" className="text-pulse-deep hover:underline">Talk to us.</Link>
        </p>
      </section>

      <section className="border-y border-line bg-paper-sunk">
        <div className="mx-auto max-w-5xl px-5 py-20">
          <h2 data-text-reveal className="text-center font-display text-title font-semibold">Compare plans</h2>
          <div data-reveal className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-3 pr-4 font-medium text-ink-muted">Feature</th>
                  {PLANS.map((p) => <th key={p.name} className="px-4 py-3 text-center font-display font-semibold">{p.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map(([label, ...cells]) => (
                  <tr key={label} className="border-b border-line">
                    <td className="py-3 pr-4 text-ink-soft">{label}</td>
                    {cells.map((c, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        {typeof c === 'boolean'
                          ? (c ? <Check className="mx-auto h-4 w-4 text-pulse-deep" /> : <Minus className="mx-auto h-4 w-4 text-ink-muted/50" />)
                          : <span className="font-medium">{c}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-5 py-20">
        <h2 data-text-reveal className="text-center font-display text-title font-semibold">Frequently asked</h2>
        <div data-reveal className="mt-8 divide-y divide-line rounded-card border border-line bg-surface">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
                <span className="font-medium">{q}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ${openFaq === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-4 text-sm leading-relaxed text-ink-soft">{a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
