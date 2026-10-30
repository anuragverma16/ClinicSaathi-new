import { Link } from 'react-router-dom';
import { gsap, useGsapContext, revealSectionsOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { BlobBackdrop, AvatarInitials } from '../../components/marketing/illustrations.jsx';
import { StatsBand } from '../../components/marketing/StatsBand.jsx';
import { TEAM, VALUES } from '../../data/team.js';

export default function About() {
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-hero-in]', { opacity: 0, y: 20, duration: 0.6, stagger: 0.08, ease: 'power2.out' });
    revealSectionsOnScroll({ y: 20, stagger: 0.06 });
  }, []);

  return (
    <div>
      <section className="relative overflow-hidden px-5 pb-16 pt-16 text-center md:pt-24">
        <BlobBackdrop className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[480px] -translate-x-1/2" tone="signal" />
        <div className="relative mx-auto max-w-2xl">
          <p data-hero-in className="text-sm font-medium uppercase tracking-wide text-pulse-deep">About ClinicSaathi</p>
          <h1 data-text-reveal className="mt-3 font-display text-title font-bold sm:text-display">Built by people who sat at the front desk</h1>
          <p data-hero-in className="mt-4 text-lg text-ink-soft">
            We started by watching a receptionist juggle a ringing phone, a walk-in and a doctor asking for a chart —
            all at once. Everything we've built since answers something from that afternoon.
          </p>
        </div>
      </section>

      <section className="border-y border-line bg-paper-sunk">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <StatsBand
            numberClassName="font-display text-3xl font-bold tabular-nums text-pulse-deep sm:text-4xl"
            labelClassName="mt-1.5 text-sm text-ink-muted"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 data-text-reveal className="font-display text-title font-semibold">What we hold onto</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {VALUES.map(([title, body]) => (
            <div key={title} data-reveal className="card p-6">
              <h3 className="font-display text-[17px] font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-paper-sunk">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 data-text-reveal className="font-display text-title font-semibold">The team</h2>
          <p data-reveal className="mt-2 max-w-lg text-ink-soft">A small team, split between people who write software and people who used to run clinic operations.</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((person) => (
              <div key={person.name} data-reveal className="flex items-center gap-4 rounded-card border border-line bg-paper p-5">
                <AvatarInitials name={person.name} tone={person.tone} className="h-12 w-12" />
                <div>
                  <p className="font-medium">{person.name}</p>
                  <p className="text-sm text-ink-muted">{person.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 data-text-reveal className="font-display text-title font-semibold">Want to see it on your clinic?</h2>
        <div data-reveal className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/contact" className="btn-primary">Book a demo</Link>
          <Link to="/contact" className="btn-ghost">Talk to us</Link>
        </div>
      </section>
    </div>
  );
}
