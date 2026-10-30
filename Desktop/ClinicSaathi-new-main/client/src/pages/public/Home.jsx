import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, ListOrdered, Stethoscope, Receipt, MessageCircle, RefreshCw, ArrowRight,
  Quote, ChevronDown, ShieldCheck, Clock, Smartphone,
  CalendarCheck, Bell, CheckCircle2, Smile, Activity, Dumbbell, Building2, User,
} from 'lucide-react';
import { gsap, ScrollTrigger, useGsapContext, revealSectionsOnScroll, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { BlobBackdrop, GlyphTile, PulseLine, BlogPhoto, AvatarInitials } from '../../components/marketing/illustrations.jsx';
import { StatsBand } from '../../components/marketing/StatsBand.jsx';
import { useMagnetic } from '../../hooks/useMagnetic.js';
import { BLOG_POSTS } from '../../data/blog.js';

const CHAIN = [
  { label: '"Need a doctor Friday evening"', role: 'Patient, on WhatsApp' },
  { label: 'Finds Dr. Mehta, 5:30 PM free', role: 'Assistant checks the calendar' },
  { label: 'Booked · reminder queued', role: 'Confirmation sent' },
  { label: 'Token A7 · 12 min wait', role: 'Front desk, Friday' },
  { label: 'Notes, Rx, invoice, receipt', role: 'After the consult' },
  { label: 'Check-in on day 7', role: 'Follow-up, automatic' },
];

const MODULES = [
  [CalendarDays, 'Appointments', 'Booking from your site, a QR code, WhatsApp or the front desk — into one calendar per doctor.'],
  [ListOrdered, 'Queue', 'Check-in issues a token. The waiting-room screen and the doctor\'s tab update together.'],
  [Stethoscope, 'Consultation', 'History, notes, diagnosis and prescription in the flow the doctor already works in.'],
  [Receipt, 'Billing', 'GST invoices, UPI and card collection, receipts, and a list of who still owes what.'],
  [MessageCircle, 'Follow-ups', 'Scheduled at the end of the consult. Sent on the day. Concerning replies get flagged to staff.'],
  [RefreshCw, 'Recall', 'A cleaning due at six months, a diabetes review at three. The list builds itself from visit history.'],
];

const LOGOS = ['Sunrise Family Clinic', 'Green Valley Dental', 'Amrit Diagnostics', 'Wellspring Physio', 'CarePoint Clinic', 'Root & Smile Dental'];

// Ambient hero chips — what the product actually does, not abstract shapes.
// Positive offsets only (no bleeding past the edge): a negative offset here
// clips more than half the chip off-screen, which reads as a broken sliver
// rather than an icon. They sit inside the section's own side/top/bottom
// padding, so they land clear of the headline and paragraph regardless.
const HERO_FLOATERS = [
  [CalendarCheck, 'left-4 top-8'],
  [MessageCircle, 'right-6 bottom-10'],
  [Activity, 'left-6 bottom-10'],
];

const HOW_IT_WORKS = [
  [MessageCircle, 'Patient reaches out', 'On WhatsApp, your booking page or a QR code at the door — whichever they already have open.'],
  [CalendarCheck, 'Assistant checks and books', 'Real availability, not a guess. The slot is held the moment it\'s confirmed, so no two patients land on the same one.'],
  [Bell, 'Reminder and queue token', 'A reminder goes out automatically. On the day, check-in issues a token — no separate app for the patient to install.'],
  [CheckCircle2, 'Visit closes itself out', 'Consult notes finish the loop: invoice raised, follow-up scheduled, recall clock started. Nobody has to remember to do it.'],
];

const CLINIC_TYPES = [
  [User, 'Single-doctor practice', 'One calendar, simple billing, no features you\'ll never touch.'],
  [Smile, 'Dental clinics', 'Recall built around cleaning and treatment intervals, not generic follow-up.'],
  [Activity, 'Diagnostics & labs', 'Report-ready notifications and a queue that handles walk-in test bookings.'],
  [Dumbbell, 'Physiotherapy', 'Multi-session packages and recurring appointment series, tracked per patient.'],
  [Stethoscope, 'Multi-doctor clinics', 'Per-doctor calendars and queues that never cross-book each other.'],
  [Building2, 'Multi-branch groups', 'One account, every branch — patients and staff scoped correctly to each.'],
];

const WHY = [
  [ShieldCheck, 'Patient data stays in India', 'No exceptions, no offshore backups, no ambiguity in the contract — the thing clinics ask about first.'],
  [Clock, 'Live in under a day', 'Import your patient list, set doctor hours, connect WhatsApp. Most clinics are booking within a day.'],
  [Smartphone, 'Works on the phone at the counter', 'No dedicated terminal or tablet required — the front desk runs it from the phone already on the counter.'],
];

const TESTIMONIALS = [
  {
    quote: 'We stopped losing evening bookings the week we switched on WhatsApp. The front desk finally gets to leave at 7 instead of manning the phone.',
    name: 'Dr. Anjali Mehta', role: 'Sunrise Family Clinic, Bengaluru', tone: 'pulse',
  },
  {
    quote: 'The recall list alone paid for the subscription. We found forty patients who were overdue for a cleaning and never would have known.',
    name: 'Vikram Rao', role: 'Root & Smile Dental, Pune', tone: 'signal',
  },
  {
    quote: 'Queue tokens sound small until you don\'t have them. No more "who was here first" arguments at the counter.',
    name: 'Kavya Nair', role: 'Front desk, Green Valley Dental', tone: 'pulse',
  },
];

const FAQ = [
  ['Do I need to switch everything on day one?', 'No — most clinics start with booking and reminders, then turn on queue, billing and follow-ups as staff get comfortable. Nothing is all-or-nothing.'],
  ['What happens to my existing patient records?', 'Import them from a spreadsheet or export from most common clinic software. Our onboarding team does the first import with you at no charge.'],
  ['Can patients still call instead of using WhatsApp?', 'Always. WhatsApp and online booking take pressure off the phone — they don\'t replace it. The front desk still books over the phone exactly as before.'],
  ['Is there a contract or can I cancel anytime?', 'Month to month, cancel anytime from Settings. No lock-in, no cancellation fee.'],
];

export default function Home() {
  const heroRef = useRef(null);
  const marqueeRef = useRef(null);
  const [openFaq, setOpenFaq] = useState(0);
  const magneticRef = useMagnetic(0.3);

  useGsapContext(() => {
    if (prefersReducedMotion()) return;

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('[data-hero-line]', { yPercent: 105, opacity: 0, duration: 0.7, stagger: 0.08 })
      .from('[data-hero-sub]', { opacity: 0, y: 14, duration: 0.5 }, '-=0.35')
      .from('[data-hero-cta]', { opacity: 0, y: 10, duration: 0.4, stagger: 0.06 }, '-=0.25');

    // The chain section (moved out of the hero, further down the page): the
    // connecting line fills as it scrolls into view, and each step's dot +
    // card lights up the moment the line reaches it — the chain visibly
    // "executing" top to bottom rather than the whole line just appearing.
    const chainSection = document.querySelector('[data-chain-section]');
    const chainRule = document.querySelector('[data-chain-rule]');
    const chainDots = gsap.utils.toArray('[data-chain-dot]');
    const chainCards = gsap.utils.toArray('[data-chain-card]');
    if (chainSection && chainRule && chainDots.length) {
      const setActive = (i, active) => {
        chainDots[i]?.classList.toggle('border-pulse', active);
        chainDots[i]?.classList.toggle('bg-pulse', active);
        chainDots[i]?.classList.toggle('border-pulse/45', !active);
        chainDots[i]?.classList.toggle('bg-paper', !active);
        chainCards[i]?.classList.toggle('border-pulse/40', active);
        chainCards[i]?.classList.toggle('shadow-lift', active);
        chainCards[i]?.classList.toggle('border-line', !active);
        chainCards[i]?.classList.toggle('shadow-card', !active);
      };

      gsap.set(chainRule, { scaleY: 0 });
      ScrollTrigger.create({
        trigger: chainSection,
        start: 'top 75%',
        end: 'bottom 65%',
        scrub: 0.6,
        onUpdate: (self) => {
          gsap.set(chainRule, { scaleY: self.progress });
          chainDots.forEach((_, i) => setActive(i, self.progress >= (i + 0.2) / chainDots.length));
        },
      });
    }

    // The heartbeat line draws in once, then runs a real EKG-monitor sweep:
    // the dim baseline stays fully on screen forever (never disappears, so
    // it never reads as "broken"), while the bright overlay's gradient band
    // slides continuously across it — off-screen left to off-screen right,
    // looping — for actual, legible motion instead of a static line.
    const base = document.querySelector('[data-pulse-base]');
    const path = document.querySelector('[data-pulse-path]');
    const grad = document.querySelector('#pulse-line-grad');
    if (base && path) {
      const len = base.getTotalLength();
      gsap.set([base, path], { strokeDasharray: len, strokeDashoffset: len });
      gsap.to([base, path], {
        strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', delay: 0.2,
        onComplete: () => {
          if (grad) {
            gsap.to(grad, { attr: { x1: 550, x2: 680 }, duration: 2.4, ease: 'none', repeat: -1 });
          }
        },
      });
    }

    revealSectionsOnScroll({ y: 20, stagger: 0.06 });

    // The glows drift slowly and continuously — ambient depth behind the
    // content and the corner logo video.
    gsap.utils.toArray('[data-hero-glow]').forEach((el, i) => {
      gsap.to(el, {
        x: i % 2 === 0 ? 60 : -50,
        y: i % 2 === 0 ? 40 : -35,
        scale: 1.15,
        duration: 14 + i * 4,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    });

    // Ambient hero background: each icon chip drifts and tilts on its own
    // slow, reversing loop — offset directions and durations so they never
    // sync up into a single visible "beat".
    gsap.utils.toArray('[data-hero-float]').forEach((el, i) => {
      gsap.to(el, {
        y: i % 2 === 0 ? -14 : 12,
        x: i % 2 === 0 ? 8 : -10,
        rotate: i % 2 === 0 ? 4 : -4,
        duration: 4 + i * 1.1,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: i * 0.3,
      });
    });

    if (marqueeRef.current) {
      gsap.to(marqueeRef.current, { xPercent: -50, duration: 22, ease: 'none', repeat: -1 });
    }

    // "How it works": the connecting line fills as the row scrolls through
    // view, and each step's circle solidifies once the fill reaches it.
    const stepsRow = document.querySelector('[data-steps-row]');
    const fill = document.querySelector('[data-step-fill]');
    const stepCircles = gsap.utils.toArray('[data-step-circle]');
    if (stepsRow && fill && stepCircles.length) {
      ScrollTrigger.create({
        trigger: stepsRow,
        start: 'top 75%',
        end: 'bottom 60%',
        scrub: 0.6,
        onUpdate: (self) => {
          gsap.set(fill, { scaleX: self.progress });
          stepCircles.forEach((el, i) => {
            const active = self.progress >= (i + 0.5) / stepCircles.length;
            el.classList.toggle('bg-pulse', active);
            el.classList.toggle('bg-paper', !active);
            el.querySelector('[data-step-icon]')?.classList.toggle('text-white', active);
            el.querySelector('[data-step-icon]')?.classList.toggle('text-pulse-deep', !active);
          });
        },
      });
    }
  }, []);

  return (
    <div>
      <section ref={heroRef} className="relative overflow-hidden px-6 pb-20 pt-16 sm:px-10 md:pt-24 lg:px-16 xl:px-20">
        {/* Ambient background: one soft glow, no competing colours, plus a
            handful of chips for what the product actually does — booking,
            reminders, messages, live monitoring — each drifting on its own
            slow loop (data-hero-float, animated below). Spans the full
            section (no max-width), so it reaches the actual screen edges
            rather than stopping at a centred content column. */}
        <div data-hero-glow className="pointer-events-none absolute -right-24 -top-20 h-[480px] w-[480px] rounded-full bg-pulse/10 blur-3xl" aria-hidden="true" />
        <div data-hero-glow className="pointer-events-none absolute -left-32 bottom-0 h-[380px] w-[380px] rounded-full bg-ink/[0.04] blur-3xl" aria-hidden="true" />
        {HERO_FLOATERS.map(([Icon, pos], i) => (
          <div key={i} data-hero-float aria-hidden="true"
               className={`pointer-events-none absolute hidden h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface/85 shadow-card backdrop-blur sm:flex ${pos}`}>
            <Icon className="h-6 w-6 text-pulse-deep" strokeWidth={1.75} />
          </div>
        ))}
        {/* The content itself keeps a (generous, wider-than-the-rest-of-the-
            site) cap so paragraph line length and card proportions stay
            sane on ultrawide monitors — full-bleed background, bounded
            content is the actual fix for "side margins", not literally
            zero max-width. */}
        <div className="relative mx-auto grid max-w-[1600px] gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          <div>
            <p data-hero-cta className="mb-4 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-pulse-deep">
              <span className="h-px w-6 bg-pulse-deep/50" aria-hidden="true" />
              Clinic operating system
            </p>
            <h1 className="font-display text-display font-bold tracking-tight">
              <span className="block overflow-hidden"><span data-hero-line className="block">Smarter clinics.</span></span>
              <span className="block overflow-hidden"><span data-hero-line className="block text-pulse-deep">Happier patients.</span></span>
            </h1>
            <p data-hero-sub className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">
              One message from a patient should end with a booked slot, a reminder, a queue token,
              a prescription, a paid invoice and a follow-up. ClinicSaathi runs that whole chain
              so your front desk doesn't have to.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link ref={magneticRef} to="/contact" data-hero-cta className="btn-primary">Book a demo</Link>
              <Link to="/features" data-hero-cta className="btn-ghost">See what's inside</Link>
            </div>
            <p data-hero-cta className="mt-4 text-sm text-ink-muted">14 days free. No card needed.</p>

            <PulseLine className="mt-10 hidden h-14 w-full max-w-md md:block" />
          </div>

          <div className="relative">
            {/* Looping logo video behind the steps — dissolved into the
                section via a radial mask (soft centre, fading to fully
                transparent at the edges) instead of sitting in a hard-edged
                box, so it blends into the hero rather than reading as a
                separate panel. Muted/loop/playsInline so it autoplays on
                mobile too. */}


                
            {/* <video
              className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-50"
              style={{
                maskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(ellipse at center, black 35%, transparent 75%)',
              }}
              src="/logo.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
            /> */}


            <div data-chain-rule className="absolute left-[11px] top-3 bottom-3 w-px origin-top bg-gradient-to-b from-pulse via-pulse/40 to-transparent" />
            <ol className="space-y-5">
              {CHAIN.map((step, i) => (
                <li key={step.label} className="relative flex gap-4 pl-0">
                  <span data-chain-step data-chain-dot
                        className="relative z-10 mt-1.5 h-[22px] w-[22px] shrink-0 rounded-full border-2 border-pulse/45 bg-paper transition-colors duration-300" />
                  <div data-chain-step data-chain-card
                       className="min-w-0 flex-1 rounded-card border border-line bg-surface px-4 py-3 shadow-card transition-[border-color,box-shadow] duration-300">
                    <p className="text-[15px] font-medium leading-snug">{step.label}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">{step.role}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <div className="overflow-hidden border-y border-line bg-paper-sunk py-6">
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wide text-ink-muted">Trusted by clinics across India</p>
        <div className="flex w-max" ref={marqueeRef}>
          {[...LOGOS, ...LOGOS].map((name, i) => (
            <span key={i} className="mx-8 shrink-0 font-display text-lg font-semibold text-ink-muted/50">{name}</span>
          ))}
        </div>
      </div>

      <section className="border-b border-line bg-paper-sunk">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 data-text-reveal className="max-w-md font-display text-title font-semibold">The front desk is the bottleneck</h2>
            </div>
            <div data-reveal className="space-y-5">
              <p className="text-lg leading-relaxed text-ink-soft">
                Most clinics lose more revenue to missed calls and no-shows than to anything on the P&L.
                A receptionist can hold one conversation at a time. Evenings and Sundays, nobody is holding any.
              </p>
              <ul className="space-y-3 border-l-2 border-signal pl-5">
                {[
                  'Calls that ring out after hours are bookings that go to the clinic down the road.',
                  'Reminders only go out when someone remembers to send them.',
                  'The patient who last came eight months ago is not on anybody\'s list.',
                ].map((p) => <li key={p} className="text-[15px] leading-relaxed text-ink-soft">{p}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 data-text-reveal className="max-w-lg font-display text-title font-semibold">From message to closed visit, in four steps</h2>
        <p data-reveal className="mt-3 max-w-xl text-ink-soft">
          The same chain shown at the top of this page — here's what each link actually does.
        </p>
        <div data-steps-row className="relative mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-line lg:block" aria-hidden="true" />
          {/* Fills left to right as the row scrolls through view — each
              step's circle switches from outline to solid once the fill
              reaches it, so the line reads as the thing actually doing
              the work rather than a static rule. */}
          <div data-step-fill aria-hidden="true"
               className="pointer-events-none absolute left-0 top-6 hidden h-px w-full origin-left scale-x-0 bg-pulse lg:block" />
          {HOW_IT_WORKS.map(([Icon, title, body], i) => (
            <div key={title} data-reveal className="relative">
              <div data-step-circle className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-pulse bg-paper transition-colors duration-300">
                <Icon data-step-icon className="h-5 w-5 text-pulse-deep transition-colors duration-300" strokeWidth={1.75} />
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-pulse-deep">Step {i + 1}</p>
              <h3 className="mt-1 font-display text-[17px] font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="modules" className="border-t border-line bg-paper-sunk px-5 py-20">
        <div className="mx-auto max-w-6xl">
        <h2 data-text-reveal className="max-w-lg font-display text-title font-semibold">
          Every part hands off to the next one
        </h2>
        <p data-reveal className="mt-3 max-w-xl text-ink-soft">
          Not separate tools bolted together. Finishing a consultation is what creates the invoice,
          schedules the follow-up and starts the recall clock.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(([Icon, name, desc]) => (
            <div key={name} data-reveal className="card p-6">
              <GlyphTile icon={Icon} />
              <h3 className="mt-4 font-display text-[17px] font-semibold">{name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{desc}</p>
            </div>
          ))}
        </div>
        <Link to="/features" data-reveal className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-pulse-deep hover:underline">
          See every module in detail <ArrowRight className="h-4 w-4" />
        </Link>
        </div>
      </section>

      <section className="border-t border-line bg-paper">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 data-text-reveal className="max-w-lg font-display text-title font-semibold">Why clinics choose us over a generic booking tool</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {WHY.map(([Icon, title, body]) => (
              <div key={title} data-reveal>
                <GlyphTile icon={Icon} tone="signal" />
                <h3 className="mt-4 font-display text-[17px] font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-paper-sunk">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 data-text-reveal className="max-w-lg font-display text-title font-semibold">Built for every kind of clinic</h2>
          <p data-reveal className="mt-3 max-w-xl text-ink-soft">
            The same six modules, shaped by how your specialty actually runs a day.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CLINIC_TYPES.map(([Icon, title, body]) => (
              <div key={title} data-reveal className="flex gap-4 rounded-card border border-line bg-paper p-5">
                <GlyphTile icon={Icon} tone="pulse" className="shrink-0" />
                <div>
                  <h3 className="font-display text-[15px] font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <StatsBand
            numberClassName="font-display text-3xl font-bold tabular-nums sm:text-4xl"
            labelClassName="mt-1.5 text-sm text-paper/70"
            skeletonClassName="bg-paper/10"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 data-text-reveal className="font-display text-title font-semibold">What clinics running on ClinicSaathi say</h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} data-reveal className="card flex flex-col p-6">
              <Quote className="h-6 w-6 text-pulse/40" />
              <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-soft">{t.quote}</blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <AvatarInitials name={t.name} tone={t.tone} className="h-10 w-10" />
                <div className="text-sm">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-ink-muted">{t.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex items-end justify-between gap-4">
          <h2 data-text-reveal className="font-display text-title font-semibold">From the blog</h2>
          <Link to="/blog" data-reveal className="hidden text-sm font-medium text-pulse-deep hover:underline sm:block">All posts</Link>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {BLOG_POSTS.slice(0, 3).map((post) => (
            <Link key={post.slug} to={`/blog/${post.slug}`} data-reveal
                  className="card group flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-lift">
              <BlogPhoto seed={post.slug} tone={post.tone} w={500} h={280} alt=""
                         className="h-36 transition-transform duration-500 group-hover:scale-105" />
              <div className="flex flex-1 flex-col p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-pulse-deep">{post.category}</p>
                <h3 className="mt-2 font-display text-[17px] font-semibold leading-snug group-hover:text-pulse-deep">{post.title}</h3>
                <p className="mt-2 line-clamp-2 flex-1 text-sm text-ink-soft">{post.excerpt}</p>
                <p className="mt-4 text-xs text-ink-muted">{post.readMins} min read</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-paper-sunk">
        <div className="mx-auto max-w-2xl px-5 py-20">
          <h2 data-text-reveal className="text-center font-display text-title font-semibold">Questions clinics ask before switching</h2>
          <div data-reveal className="mt-8 divide-y divide-line rounded-card border border-line">
            {FAQ.map(([q, a], i) => (
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
          <p className="mt-6 text-center text-sm text-ink-muted">
            More questions? <Link to="/contact" className="text-pulse-deep hover:underline">Talk to us</Link> or see the full <Link to="/pricing" className="text-pulse-deep hover:underline">pricing FAQ</Link>.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24">
        <div data-reveal className="relative overflow-hidden rounded-card bg-pulse px-8 py-14 text-center text-white sm:px-16">
          <BlobBackdrop className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 opacity-40" tone="ink" />
          <h2 data-text-reveal className="relative font-display text-title font-semibold">Ready to stop losing patients to a busy line?</h2>
          <p className="relative mx-auto mt-3 max-w-lg text-white/85">
            14 days free. No card needed. Your first clinic can be live before lunch.
          </p>
          <Link to="/contact" className="relative mt-7 inline-flex rounded-lg bg-surface px-6 py-3 text-[15px] font-medium text-pulse-deep transition hover:bg-paper-sunk">
            Book a demo
          </Link>
        </div>
      </section>
    </div>
  );
}
