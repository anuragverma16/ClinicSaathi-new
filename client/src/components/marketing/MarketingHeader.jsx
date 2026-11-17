import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, ArrowRight, LayoutDashboard } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';
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

  const menuRef = useRef(null);

  // Condense the bar once the page moves under it.
  useEffect(() => {
    setScrolled(false); // a route change always lands at the top
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
    <header
            className={`sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300 ${
              scrolled ? 'border-line bg-paper/90 shadow-card backdrop-blur' : 'border-transparent bg-paper/70 backdrop-blur'
            }`}>
      {/* max-w-[1600px] to line up with Home's hero, which uses the same
          wider cap so its full-bleed background doesn't sit under a header
          that's still capped at the site's normal (narrower) reading width. */}
      <div className={`mx-auto flex max-w-[1600px] items-center gap-6 px-6 sm:px-10 lg:px-16 xl:px-20 h-16`}>
        <div><Logo /></div>

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 rounded-xl border border-line/70 bg-surface/60 p-1 text-sm md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3.5 py-1.5 font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-pulse/15 text-pulse-deep ring-1 ring-inset ring-pulse/40'
                    : 'text-ink-soft hover:bg-paper-sunk hover:text-ink'
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
              <Link to={dashboardHome} className="btn-ghost h-10 py-0 pl-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pulse-soft text-xs font-medium text-pulse-deep">
                  {user.name?.[0]?.toUpperCase() || '?'}
                </span>
                {user.name?.split(' ')[0]}
              </Link>
              <Link to={dashboardHome} className="btn-primary h-10 py-0 text-sm">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-ghost h-10 py-0 text-sm">Sign in</Link>
              <Link to="/contact" className="btn-primary h-10 py-0 text-sm">
                Book a demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}
        </div>

        <button onClick={() => setOpen(true)} aria-label="Open menu"
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
