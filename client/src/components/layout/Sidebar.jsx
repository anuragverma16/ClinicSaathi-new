import { useMemo, useRef, useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Lock, AlertCircle, ChevronsLeft, ChevronsRight, LogOut, X, Search, Crown, Zap, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { ROLE_NAV, ROLE_LABEL } from '../../routes/nav.js';
import { LogoMark } from '../marketing/Logo.jsx';
import { ICONS } from './navIcons.js';
import { sectionAccents } from './accents.js';

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

// Labels stay mounted and fade with the rail's width, so collapsing never re-lays out the list.
const fade = (collapsed) => `whitespace-nowrap transition-opacity duration-200 ${collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`;

/** Trial countdown or plan badge, so the plan state is always one glance away. */
function PlanCard({ subscription, entitlements, role }) {
  if (!entitlements || role === 'PATIENT') return null;
  const trialing = subscription?.status === 'TRIALING' && subscription?.trialEndsAt;
  const daysLeft = trialing ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt) - Date.now()) / 864e5)) : null;
  const pct = trialing ? Math.min(100, Math.max(4, (daysLeft / 14) * 100)) : 100;
  const owner = role === 'CLINIC_OWNER';

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${entitlements.live ? 'bg-teal-400/15 text-teal-300' : 'bg-rose-400/15 text-rose-300'}`}>
          {entitlements.live ? <Crown className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold capitalize text-white">{entitlements.plan?.toLowerCase()} plan</p>
          <p className="truncate text-xs text-navy-text/60">
            {!entitlements.live ? 'Inactive, paid features paused' : trialing ? `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Active subscription'}
          </p>
        </div>
      </div>
      {trialing && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-teal-400 transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
      {owner && (
        <Link to="/clinic/subscription" className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-pulse py-1.5 text-xs font-medium text-white transition-colors hover:bg-pulse-deep">
          <Zap className="h-3.5 w-3.5" /> {trialing || !entitlements.live ? 'Upgrade plan' : 'Manage plan'}
        </Link>
      )}
    </div>
  );
}

/**
 * Role sidebar shared by every panel: every feature in one scrolling list,
 * grouped under section labels, with a quick filter and flyout labels when
 * the rail is collapsed. Lives in AppShell, so it never remounts on navigation.
 */
export function Sidebar({ onNavigate, collapsed = false, onToggleCollapse, onClose }) {
  const { user, clinic, subscription, entitlements, hasFeature, logout } = useAuth();
  const navigate = useNavigate();
  const items = ROLE_NAV[user?.role] || [];
  const isPlatform = user?.role === 'SUPER_ADMIN';
  const upgradePath = user?.role === 'CLINIC_OWNER' ? '/clinic/subscription' : null;

  const [query, setQuery] = useState('');
  const [flyout, setFlyout] = useState(null);
  const searchRef = useRef(null);

  const accents = useMemo(() => sectionAccents(items), [items]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.section?.toLowerCase().includes(q)) : items;
    return groupItems(filtered);
  }, [items, query]);

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

  useEffect(() => { if (collapsed) setQuery(''); }, [collapsed]);

  const doLogout = async () => navigate(await logout(), { replace: true });
  const showFlyout = (e, label) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setFlyout({ label, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const hideFlyout = () => setFlyout(null);
  const roleLine = isPlatform ? 'Platform administration' : ROLE_LABEL[user?.role] || '';

  return (
    <nav aria-label="Main"
         className={`flex h-full shrink-0 flex-col overflow-hidden bg-navy text-navy-text transition-[width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${collapsed ? 'w-[72px]' : 'w-[264px]'}`}>
      {/* Brand / workspace */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.08] px-[18px]">
        <LogoMark className="h-9 w-9 shrink-0" />
        <div className={`min-w-0 flex-1 ${fade(collapsed)}`}>
          <p className="truncate font-display text-[15px] font-semibold text-white">
            {isPlatform ? 'ClinicSaathi' : clinic?.name || 'ClinicSaathi'}
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-navy-text/60">
            {isPlatform && <ShieldCheck className="h-3 w-3 text-teal-300" />} {roleLine}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className="rounded-lg p-1.5 text-navy-text/70 transition-colors hover:bg-white/[0.06] hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Quick filter */}
      <div className="shrink-0 px-3 pt-3">
        {collapsed ? (
          <button onClick={onToggleCollapse} aria-label="Search menu" onMouseEnter={(e) => showFlyout(e, 'Search menu')} onMouseLeave={hideFlyout}
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-navy-text/70 transition-colors hover:bg-white/[0.06] hover:text-white">
            <Search className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <label className="group relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-text/50 transition-colors group-focus-within:text-teal-300" />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
                   placeholder="Search menu" aria-label="Search menu"
                   className="w-full rounded-lg border border-white/10 bg-white/[0.05] py-2 pl-9 pr-9 text-[13.5px] text-white outline-none transition-colors placeholder:text-navy-text/50 focus:border-teal-400/50 focus:bg-white/[0.08] focus:ring-2 focus:ring-teal-400/15" />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/15 px-1.5 text-[10px] text-navy-text/60">/</kbd>
          </label>
        )}
      </div>

      {/* Navigation: every feature in one list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 [scrollbar-width:thin]">
        {!groups.length && <p className="px-2 py-6 text-center text-[13px] text-navy-text/60">No menu items match “{query}”.</p>}

        {groups.map((group, gi) => (
          <div key={group.name} className={gi ? 'mt-4' : ''}>
            <div className="relative mb-1 flex h-6 items-center px-2.5">
              <span className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-text/55 ${fade(collapsed)}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${accents[group.name].dot}`} />
                {group.name}
              </span>
              <span aria-hidden="true" className={`absolute inset-x-3 top-1/2 h-px bg-white/10 transition-opacity duration-200 ${collapsed ? 'opacity-100' : 'opacity-0'}`} />
            </div>

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] || LayoutDashboard;
                const locked = item.feature && !hasFeature(item.feature);
                return (
                  <li key={item.to}>
                    <NavLink
                      to={locked && upgradePath ? upgradePath : item.to}
                      onClick={onNavigate}
                      title={locked ? 'Not included in your plan' : undefined}
                      onMouseEnter={(e) => showFlyout(e, locked ? `${item.label} · locked` : item.label)}
                      onMouseLeave={hideFlyout}
                      className={({ isActive }) => {
                        const active = isActive && !locked;
                        return [
                          'group relative flex h-10 items-center gap-3 rounded-lg px-[15px] text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-teal-400/50',
                          active ? 'bg-white/[0.09] font-semibold text-white' : 'font-medium text-navy-text hover:bg-white/[0.05] hover:text-white',
                          locked ? 'opacity-55' : '',
                        ].join(' ');
                      }}
                    >
                      {({ isActive }) => (
                        <>
                          <span aria-hidden="true"
                                className={`absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.6)] transition-opacity duration-150 ${isActive && !locked ? 'opacity-100' : 'opacity-0'}`} />
                          <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${isActive && !locked ? 'text-teal-300' : 'text-navy-text/60 group-hover:text-white'}`} strokeWidth={1.9} />
                          <span className={`flex-1 truncate ${fade(collapsed)}`}>{item.label}</span>
                          {locked && <Lock className={`h-3.5 w-3.5 shrink-0 ${fade(collapsed)}`} aria-label="Locked" />}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {!collapsed && !isPlatform && !query && (
          <div className="mt-5">
            <PlanCard subscription={subscription} entitlements={entitlements} role={user?.role} />
          </div>
        )}
      </div>

      {/* Footer: profile, sign out, collapse */}
      <div className="shrink-0 border-t border-white/[0.08] p-3">
        <div className={`flex items-center gap-2.5 rounded-xl ${collapsed ? 'flex-col' : 'p-1.5'}`}>
          <span className="relative shrink-0" onMouseEnter={(e) => showFlyout(e, user?.name)} onMouseLeave={hideFlyout}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-sky-500 text-sm font-semibold text-white">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-navy bg-emerald-400" />
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs text-navy-text/60">{user?.email || user?.phone}</p>
            </div>
          )}
          <button onClick={doLogout} aria-label="Sign out" onMouseEnter={(e) => showFlyout(e, 'Sign out')} onMouseLeave={hideFlyout}
                  className="rounded-lg p-2 text-navy-text/70 transition-colors hover:bg-rose-500/15 hover:text-rose-300">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  onMouseEnter={(e) => showFlyout(e, 'Expand sidebar')} onMouseLeave={hideFlyout}
                  className="mt-2 flex h-9 w-full items-center gap-2 rounded-lg px-[15px] text-[13px] text-navy-text/70 transition-colors hover:bg-white/[0.06] hover:text-white">
            {collapsed ? <ChevronsRight className="mx-auto h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
            {!collapsed && <span className="whitespace-nowrap">Collapse sidebar</span>}
          </button>
        )}
      </div>

      {/* Collapsed-rail flyout label (fixed so the nav's overflow can't clip it). */}
      {collapsed && flyout && (
        <div role="tooltip" style={{ top: flyout.top, left: flyout.left }}
             className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-navy px-2.5 py-1.5 text-xs font-medium text-white shadow-lift animate-[fadeIn_.15s_ease-out]">
          <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-navy" />
          {flyout.label}
        </div>
      )}
    </nav>
  );
}
