import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight, LayoutDashboard } from 'lucide-react';
import { gsap, useGsapContext, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { useMagnetic } from '../../hooks/useMagnetic.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { HOME_FOR_ROLE } from '../../routes/nav.js';
import { Logo } from './Logo.jsx';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/blog', label: 'Blog' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const dashboardHome = user ? HOME_FOR_ROLE[user.role] || '/clinic/dashboard' : null;

  const barRef = useRef(null);
  const navRef = useRef(null);
  const pillRef = useRef(null);
  const menuRef = useRef(null);
  const ctaMagnetRef = useMagnetic(0.25);

  // Entrance. Deliberately not a plain gsap.context()/useEffect: this tween
  // has no ScrollTrigger gate, so it starts playing the instant it's
  // created — under React 18 StrictMode's dev-only double-invoke, the first
  // invocation's tween was already mid-flight when its cleanup ran, and
  // reverting it there left later stagger items (the CTA buttons) stuck at
  // their "from" state — opacity: 0 — forever, on every real page load.
  // useGsapContext defers setup a frame so StrictMode's synchronous
  // cleanup cancels the first invocation before it ever creates a tween.
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-head-item]', {
      y: -14, opacity: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out', delay: 0.1,
    });
  }, []);

  // Condense the bar once the page moves under it.
  useEffect(() => {
    setScrolled(false); // a route change always lands at the top
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  // Slide the active-link pill to whichever route is current, with a
  // "water flow" morph rather than a plain slide: the pill first stretches
  // into a stem spanning its old and new position (like a drop being pulled
  // along), squashing vertically and rounding out to full-pill, then an
  // elastic ease snaps it back to the target's exact box — the overshoot and
  // wobble read as liquid surface tension rather than a mechanical tween.
  // useLayoutEffect so the first paint already has it in the right place
  // rather than flashing in from the left.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;

    const active = nav.querySelector('[aria-current="page"]');
    if (!active) { gsap.to(pill, { opacity: 0, duration: 0.2 }); return; }

    const { offsetLeft: left, offsetWidth: width } = active;
    const settled = pill.dataset.settled === '1';

    if (!settled || prefersReducedMotion()) {
      gsap.set(pill, { x: left, width, scaleY: 1, borderRadius: 8, opacity: 1 });
      pill.dataset.settled = '1';
      return;
    }

    const fromX = gsap.getProperty(pill, 'x');
    const fromWidth = pill.offsetWidth;
    const goingRight = left >= fromX;
    // The stem's box covers both the old and new position at once — its
    // left edge and width computed from whichever end is further out.
    const stemX = goingRight ? fromX : left;
    const stemWidth = Math.abs(left - fromX) + (goingRight ? width : fromWidth);

    gsap.timeline()
      .set(pill, { opacity: 1 })
      .to(pill, {
        x: stemX, width: stemWidth, scaleY: 0.7, borderRadius: 999,
        duration: 0.22, ease: 'power2.out',
      }, 0)
      .to(pill, {
        x: left, width, scaleY: 1, borderRadius: 8,
        duration: 0.6, ease: 'elastic.out(1, 0.55)',
      });
    pill.dataset.settled = '1';
  }, [location.pathname]);

  // Mobile sheet
  useEffect(() => {
    if (!open || prefersReducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.from('[data-mobile-panel]', { yPercent: -3, opacity: 0, duration: 0.3, ease: 'power2.out' });
      gsap.from('[data-mobile-link]', {
        y: 18, opacity: 0, duration: 0.45, stagger: 0.05, ease: 'power3.out', delay: 0.05,
      });
    }, menuRef);
    return () => ctx.revert();
  }, [open]);

  // Never leave the sheet open across a navigation
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
    <header ref={barRef}
            className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
              scrolled ? 'border-line bg-paper/90 shadow-card backdrop-blur' : 'border-transparent bg-paper/70 backdrop-blur'
            }`}>
      {/* max-w-[1600px] to line up with Home's hero, which uses the same
          wider cap so its full-bleed background doesn't sit under a header
          that's still capped at the site's normal (narrower) reading width. */}
      <div className={`mx-auto flex max-w-[1600px] items-center gap-6 px-6 transition-[height] duration-300 sm:px-10 lg:px-16 xl:px-20 ${scrolled ? 'h-14' : 'h-16'}`}>
        <div data-head-item><Logo /></div>

        <nav ref={navRef} className="relative ml-4 hidden items-center gap-1 text-sm text-ink-soft md:flex">
          {/* the sliding indicator, behind the links */}
          <span ref={pillRef} aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-8 -translate-y-1/2 rounded-lg bg-pulse/20 opacity-0 shadow-[0_0_0_1px_rgb(var(--pulse-rgb)/0.35),0_0_18px_-2px_rgb(var(--pulse-rgb)/0.55)]" />
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-head-item
              className={({ isActive }) =>
                `relative rounded-lg px-3 py-2 transition-colors duration-200 ${
                  isActive ? 'font-medium text-pulse-deep' : 'hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {user ? (
            <>
              <Link to={dashboardHome} data-head-item className="btn-quiet text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pulse-soft text-xs font-medium text-pulse-deep">
                  {user.name?.[0]?.toUpperCase() || '?'}
                </span>
                {user.name?.split(' ')[0]}
              </Link>
              <Link ref={ctaMagnetRef} to={dashboardHome} data-head-item className="btn-primary group text-sm">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" data-head-item className="btn-quiet text-sm">Sign in</Link>
              <Link ref={ctaMagnetRef} to="/contact" data-head-item className="btn-primary group text-sm">
                Book a demo
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </>
          )}
        </div>

        <button onClick={() => setOpen(true)} aria-label="Open menu" data-head-item
                className="ml-auto rounded-lg p-2 text-ink-soft transition hover:bg-paper-sunk md:hidden">
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </header>

    {/* Rendered as a sibling of <header>, not nested inside it — that header
        has backdrop-blur, and a backdrop-filter ancestor becomes the
        containing block for position:fixed descendants, which would squash
        this into the header's own ~64px box instead of covering the
        viewport. */}
    {open && (
      <div ref={menuRef} className="fixed inset-0 z-50 md:hidden">
        <div data-mobile-panel className="absolute inset-0 bg-paper">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-6">
            <Logo />
            <button onClick={() => setOpen(false)} aria-label="Close menu"
                    className="ml-auto rounded-lg p-2 text-ink-soft transition hover:bg-paper-sunk">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 px-5 py-4">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-mobile-link
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-lg px-3 py-3 text-lg font-medium transition ${
                    isActive ? 'bg-pulse-soft text-pulse-deep' : 'text-ink-soft'
                  }`
                }
              >
                {item.label}
                <ArrowRight className="h-4 w-4 opacity-40" />
              </NavLink>
            ))}
            <hr className="my-3 border-line" />
            {user ? (
              <>
                <p data-mobile-link className="px-3 py-1 text-sm text-ink-muted">Signed in as <span className="font-medium text-ink">{user.name}</span></p>
                <Link to={dashboardHome} data-mobile-link onClick={() => setOpen(false)} className="btn-primary mt-2 w-full justify-center">
                  <LayoutDashboard className="h-4 w-4" /> Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" data-mobile-link onClick={() => setOpen(false)} className="btn-ghost w-full justify-center">Sign in</Link>
                <Link to="/contact" data-mobile-link onClick={() => setOpen(false)} className="btn-primary mt-2 w-full justify-center">Book a demo</Link>
              </>
            )}
          </nav>
        </div>
      </div>
    )}
    </>
  );
}
