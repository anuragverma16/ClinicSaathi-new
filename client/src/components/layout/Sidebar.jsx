import { useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Lock, AlertCircle, ChevronsLeft, ChevronsRight, ChevronDown, LogOut, X, Search, Crown, Zap, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { ROLE_NAV, ROLE_LABEL } from '../../routes/nav.js';
import { LogoMark } from '../marketing/Logo.jsx';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { ICONS } from './navIcons.js';
import { sectionAccents } from './accents.js';


const SECTIONS_KEY = 'cs.sidebarClosedSections';
const readClosed = () => { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY)) || []; } catch { return []; } };
const isActivePath = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

/** Groups the flat role nav into its sections, keeping first-seen order. */
function groupItems(items) {
  const groups = [];
  const byName = {};
  for (const item of items) {
    const name = item.section || 'Menu';
    if (!byName[name]) { byName[name] = { name, items: [] }; groups.push(byName[name]); }
    byName[name].items.push(item);
  }
  return groups;
}

/** Trial countdown or plan badge, so the plan state is always one glance away. */
function PlanCard({ subscription, entitlements, role }) {
  if (!entitlements || role === 'PATIENT') return null;
  const trialing = subscription?.status === 'TRIALING' && subscription?.trialEndsAt;
  const daysLeft = trialing ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - Date.now()) / 864e5)) : null;
  const pct = trialing ? Math.min(100, Math.max(4, (daysLeft / 14) * 100)) : 100;
  const owner = role === 'CLINIC_OWNER';

  return (
    <div className="relative mx-3 mb-1 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] p-3">
      <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-pulse/30 blur-2xl" />
      <div className="relative flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pulse/25 text-pulse-soft">
          {entitlements.live ? <Crown className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold capitalize text-white">{entitlements.plan?.toLowerCase()} plan</p>
          <p className="truncate text-[11px] text-navy-text/70">
            {!entitlements.live ? 'Inactive — paid features paused' : trialing ? `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Active subscription'}
          </p>
        </div>
      </div>
      {trialing && (
        <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-400 transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
      {owner && (
        <Link to="/clinic/subscription" className="relative mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-white/10 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/20">
          <Zap className="h-3 w-3" /> {trialing || !entitlements.live ? 'Upgrade plan' : 'Manage plan'}
        </Link>
      )}
    </div>
  );
}

/**
 * Role sidebar shared by every panel: grouped, collapsible sections, a quick
 * filter, a pill that slides behind the active link, and flyout labels when
 * the rail is collapsed.
 */
export function Sidebar({ onNavigate, collapsed = false, onToggleCollapse, onClose }) {
  const { user, clinic, subscription, entitlements, hasFeature, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const items = ROLE_NAV[user?.role] || [];
  const isPlatform = user?.role === 'SUPER_ADMIN';
  const upgradePath = user?.role === 'CLINIC_OWNER' ? '/clinic/subscription' : null;

  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState(readClosed);
  const [flyout, setFlyout] = useState(null);

  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const pillRef = useRef(null);
  const searchRef = useRef(null);

  const accents = useMemo(() => sectionAccents(items), [items]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.section?.toLowerCase().includes(q)) : items;
    return groupItems(filtered);
  }, [items, query]);

  // Keep the section holding the current page open, whatever was saved.
  const activeSection = items.find((i) => isActivePath(location.pathname, i.to))?.section;
  const isOpen = (name) => collapsed || Boolean(query) || name === activeSection || !closed.includes(name);
  const toggleSection = (name) => setClosed((c) => {
    const next = c.includes(name) ? c.filter((n) => n !== name) : [...c, name];
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });

  // "/" jumps to the filter, like most dashboards.
  useEffect(() => {
    if (collapsed || onClose) return undefined;
    const onKey = (e) => {
      if (e.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [collapsed, onClose]);

  // Ambient drift only. Entrances are CSS keyframes, which always finish —
  // a GSAP "from opacity 0" tween interrupted by StrictMode/HMR can leave items invisible.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const ctx = gsap.context(() => {
      gsap.utils.toArray('[data-side-glow]').forEach((el, i) => gsap.to(el, {
        x: [40, -30, 20][i], y: [70, -60, 30][i], scale: 1.2, duration: 11 + i * 4, ease: 'sine.inOut', yoyo: true, repeat: -1,
      }));
    }, rootRef);
    return () => ctx.revert();
  }, [user?.role]);

  // Slide the pill behind the router's active link; hide it when that link is folded away.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) return undefined;
    const place = (animate) => {
      const active = scrollRef.current?.querySelector('a[aria-current="page"]:not([data-locked])');
      const hidden = !active || active.closest('[data-section-body]')?.dataset.open === 'false';
      if (hidden) { gsap.to(pill, { opacity: 0, duration: 0.15 }); return; }
      const box = scrollRef.current.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      const to = { y: a.top - box.top + scrollRef.current.scrollTop, height: a.height, opacity: 1 };
      if (!animate || prefersReducedMotion()) gsap.set(pill, to);
      else gsap.to(pill, { ...to, duration: 0.45, ease: 'power3.out' });
    };
    place(pill.dataset.placed === '1');
    pill.dataset.placed = '1';
    // Sections animate open/closed; settle the pill once they finish.
    const t = setTimeout(() => place(true), 320);
    return () => clearTimeout(t);
  }, [location.pathname, collapsed, closed, query, items.length]);

  const doLogout = async () => navigate(await logout(), { replace: true });
  const showFlyout = (e, label) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setFlyout({ label, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const roleLine = isPlatform ? 'Platform administration' : ROLE_LABEL[user?.role] || '';

  return (
    <nav ref={rootRef} aria-label="Main"
         className={`relative flex h-full shrink-0 flex-col overflow-hidden bg-[#0A1B33] text-slate-200 transition-[width] duration-300 ease-out ${collapsed ? 'w-[78px]' : 'w-[272px]'}`}>
      {/* Ambient layers: glows, a faint grid and an edge highlight. */}
      <div data-side-glow aria-hidden="true" className="pointer-events-none absolute -left-20 -top-16 h-64 w-64 rounded-full bg-pulse/25 blur-3xl" />
      <div data-side-glow aria-hidden="true" className="pointer-events-none absolute -right-24 top-1/3 h-56 w-56 rounded-full bg-signal/10 blur-3xl" />
      <div data-side-glow aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 h-60 w-60 rounded-full bg-pulse-deep/25 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />

      {/* Brand / workspace card */}
      <div className={`nav-in relative pt-4 ${collapsed ? 'px-3' : 'px-4'}`}>
        <div className={`flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5 backdrop-blur-sm ${collapsed ? 'justify-center' : ''}`}>
          <span className="relative shrink-0">
            <LogoMark className="h-9 w-9 drop-shadow-[0_0_14px_rgba(14,138,125,0.55)]" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0A1B33] bg-emerald-400" title="Online" />
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[14.5px] font-semibold text-white">
                {isPlatform ? 'ClinicSaathi' : clinic?.name || 'ClinicSaathi'}
              </p>
              <p className="flex items-center gap-1 truncate text-[11px] text-navy-text/70">
                {isPlatform && <ShieldCheck className="h-3 w-3 text-pulse-soft" />} {roleLine}
              </p>
            </div>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 text-navy-text hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Quick filter */}
        {collapsed ? (
          <button onClick={onToggleCollapse} aria-label="Search menu" onMouseEnter={(e) => showFlyout(e, 'Search menu')} onMouseLeave={() => setFlyout(null)}
                  className="mx-auto mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-navy-text hover:bg-white/10 hover:text-white">
            <Search className="h-4 w-4" />
          </button>
        ) : (
          <label className="group relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-navy-text/60 transition-colors group-focus-within:text-pulse-soft" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
                   placeholder="Search menu…" aria-label="Search menu"
                   className="w-full rounded-lg border border-white/10 bg-white/[0.05] py-2 pl-8 pr-9 text-[13px] text-white placeholder:text-navy-text/50 outline-none transition-all focus:border-pulse/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-pulse/25" />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/15 px-1.5 text-[10px] text-navy-text/60">/</kbd>
          </label>
        )}
      </div>

      {/* Navigation */}
      <div ref={scrollRef} className="relative mt-3 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 [scrollbar-width:thin]">
        <span ref={pillRef} aria-hidden="true"
              className="pointer-events-none absolute left-3 right-3 top-0 z-0 rounded-lg bg-gradient-to-r from-pulse via-pulse to-pulse-deep opacity-0 shadow-[0_8px_24px_-8px_rgba(14,138,125,0.8)]">
          <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
          <span className="absolute inset-0 rounded-lg bg-gradient-to-b from-white/15 to-transparent" />
        </span>

        {!groups.length && <p className="px-2 py-6 text-center text-xs text-navy-text/60">No menu items match “{query}”.</p>}

        {groups.map((group, gi) => {
          const open = isOpen(group.name);
          const accent = accents[group.name];
          return (
            <div key={group.name} className={gi ? 'mt-3' : ''}>
              {collapsed ? (
                gi > 0 && <div aria-hidden="true" className="mx-3 mb-3 h-px bg-white/10" />
              ) : (
                <button onClick={() => toggleSection(group.name)} aria-expanded={open} style={{ animationDelay: `${gi * 40}ms` }}
                        className={`nav-in group flex w-full items-center gap-2 px-2 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] transition-colors hover:text-white ${accent.head}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                  <span className="flex-1 text-left">{group.name}</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-semibold normal-case tracking-normal text-white/80">{group.items.length}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? '' : '-rotate-90'}`} />
                </button>
              )}

              <div data-section-body data-open={open}
                   className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <ul className="min-h-0 space-y-0.5 overflow-hidden">
                  {group.items.map((item, ii) => {
                    const Icon = ICONS[item.icon] || LayoutDashboard;
                    const locked = item.feature && !hasFeature(item.feature);
                    const to = locked && upgradePath ? upgradePath : item.to;
                    return (
                      <li key={item.to} className="nav-in" style={{ animationDelay: `${Math.min((gi * 3 + ii) * 20 + 40, 300)}ms` }}>
                        <NavLink
                          to={to}
                          onClick={onNavigate}
                          tabIndex={open ? undefined : -1}
                          data-locked={locked || undefined}
                          title={locked ? 'Not included in your plan' : undefined}
                          onMouseEnter={(e) => showFlyout(e, locked ? `${item.label} · locked` : item.label)}
                          onMouseLeave={() => setFlyout(null)}
                          className={({ isActive }) => [
                            'group relative z-10 flex items-center gap-3 rounded-lg py-2 text-[13.5px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-pulse/60',
                            collapsed ? 'justify-center px-0' : 'px-2.5',
                            isActive && !locked ? 'font-semibold text-white' : 'font-medium text-slate-200 hover:bg-white/[0.08] hover:text-white',
                            locked ? 'opacity-60' : '',
                          ].join(' ')}
                        >
                          {({ isActive }) => (
                            <>
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-200 ${isActive && !locked ? 'bg-white/20 text-white shadow-inner' : `${accent.tile} group-hover:scale-110`}`}>
                                <Icon className="h-4 w-4" strokeWidth={1.8} />
                              </span>
                              <span className={collapsed ? 'sr-only' : 'flex-1 truncate transition-transform duration-200 group-hover:translate-x-0.5'}>{item.label}</span>
                              {!collapsed && locked && <Lock className="h-3 w-3" aria-label="Locked" />}
                              {!collapsed && isActive && !locked && <span className="h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_white]" />}
                            </>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}

        {!collapsed && !isPlatform && !query && (
          <div className="nav-in -mx-3 mt-4" style={{ animationDelay: '250ms' }}>
            <PlanCard subscription={subscription} entitlements={entitlements} role={user?.role} />
          </div>
        )}
      </div>

      {/* Footer: profile, collapse */}
      <div className="nav-in relative" style={{ animationDelay: '200ms' }}>
        <div className={`border-t border-white/10 p-3 ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
          <div className={`flex items-center gap-2.5 rounded-xl ${collapsed ? 'flex-col' : 'bg-white/[0.04] p-2'}`}>
            <span className="relative shrink-0" onMouseEnter={(e) => showFlyout(e, user?.name)} onMouseLeave={() => setFlyout(null)}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-sky-600 text-sm font-semibold text-white ring-2 ring-white/15">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0A1B33] bg-emerald-400" />
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-white">{user?.name}</p>
                <p className="truncate text-[11px] text-navy-text/60">{user?.email || user?.phone}</p>
              </div>
            )}
            <button onClick={doLogout} aria-label="Sign out" onMouseEnter={(e) => showFlyout(e, 'Sign out')} onMouseLeave={() => setFlyout(null)}
                    className="rounded-lg p-2 text-navy-text transition-colors hover:bg-alert/25 hover:text-white">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {onToggleCollapse && (
            <button onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    onMouseEnter={(e) => showFlyout(e, 'Expand sidebar')} onMouseLeave={() => setFlyout(null)}
                    className={`mt-2 flex items-center gap-2 rounded-lg py-1.5 text-xs text-navy-text/60 transition-colors hover:bg-white/[0.06] hover:text-white ${collapsed ? 'justify-center px-2' : 'w-full px-2'}`}>
              {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse sidebar</>}
            </button>
          )}
        </div>
      </div>

      {/* Collapsed-rail flyout label (fixed so the nav's overflow can't clip it). */}
      {collapsed && flyout && (
        <div role="tooltip" style={{ top: flyout.top, left: flyout.left }}
             className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#0A1B33] px-2.5 py-1.5 text-xs font-medium text-white shadow-xl ring-1 ring-white/10 animate-[fadeIn_.15s_ease-out]">
          <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-[#0A1B33]" />
          {flyout.label}
        </div>
      )}
    </nav>
  );
}
