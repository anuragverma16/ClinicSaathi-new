import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { ROLE_NAV } from '../../routes/nav.js';

/**
 * One colour per nav section, shared by the sidebar (dark) and the page
 * header (light) so a feature looks the same in both places. Class strings
 * are written out in full so Tailwind keeps them.
 */
export const ACCENTS = [
  { tile: 'bg-teal-400/15 text-teal-300', head: 'text-teal-300/90', dot: 'bg-teal-400', soft: 'bg-teal-50 text-teal-700 ring-teal-200/70', grad: 'from-teal-500 to-emerald-500', glow: 'bg-teal-400/25' },
  { tile: 'bg-sky-400/15 text-sky-300', head: 'text-sky-300/90', dot: 'bg-sky-400', soft: 'bg-sky-50 text-sky-700 ring-sky-200/70', grad: 'from-sky-500 to-blue-600', glow: 'bg-sky-400/25' },
  { tile: 'bg-violet-400/15 text-violet-300', head: 'text-violet-300/90', dot: 'bg-violet-400', soft: 'bg-violet-50 text-violet-700 ring-violet-200/70', grad: 'from-violet-500 to-fuchsia-500', glow: 'bg-violet-400/25' },
  { tile: 'bg-amber-400/15 text-amber-300', head: 'text-amber-300/90', dot: 'bg-amber-400', soft: 'bg-amber-50 text-amber-700 ring-amber-200/70', grad: 'from-amber-500 to-orange-500', glow: 'bg-amber-400/25' },
  { tile: 'bg-rose-400/15 text-rose-300', head: 'text-rose-300/90', dot: 'bg-rose-400', soft: 'bg-rose-50 text-rose-700 ring-rose-200/70', grad: 'from-rose-500 to-pink-500', glow: 'bg-rose-400/25' },
  { tile: 'bg-emerald-400/15 text-emerald-300', head: 'text-emerald-300/90', dot: 'bg-emerald-400', soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', grad: 'from-emerald-500 to-green-600', glow: 'bg-emerald-400/25' },
  { tile: 'bg-indigo-400/15 text-indigo-300', head: 'text-indigo-300/90', dot: 'bg-indigo-400', soft: 'bg-indigo-50 text-indigo-700 ring-indigo-200/70', grad: 'from-indigo-500 to-blue-600', glow: 'bg-indigo-400/25' },
];

/** Section name -> accent, in the order the role's sections first appear. */
export function sectionAccents(items) {
  const map = {};
  for (const item of items) {
    const name = item.section || 'Menu';
    if (!(name in map)) map[name] = ACCENTS[Object.keys(map).length % ACCENTS.length];
  }
  return map;
}

/** The nav item (and its accent) for the page being viewed, if it has one. */
export function useCurrentNav() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const items = ROLE_NAV[user?.role] || [];
  const item = items
    .filter((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return { item, accent: item ? sectionAccents(items)[item.section || 'Menu'] : ACCENTS[0] };
}
