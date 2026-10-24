import { useEffect, useRef } from 'react';
import { countUp } from '../../animations/gsapUtils.js';

const TONE = {
  teal: { icon: 'from-teal-500 to-emerald-500', glow: 'bg-teal-400/20', bar: 'from-teal-500 to-emerald-400' },
  navy: { icon: 'from-sky-500 to-blue-600', glow: 'bg-sky-400/20', bar: 'from-sky-500 to-blue-500' },
  amber: { icon: 'from-amber-400 to-orange-500', glow: 'bg-amber-400/20', bar: 'from-amber-400 to-orange-400' },
  red: { icon: 'from-rose-500 to-red-500', glow: 'bg-rose-400/20', bar: 'from-rose-500 to-red-400' },
};

/** One number with a label. `value === null` renders an em dash (no data), never a made-up zero. */
export function KpiCard({ label, value, prefix = '', suffix = '', hint, format, icon: Icon, tone = 'teal' }) {
  const valueRef = useRef(null);
  const t = TONE[tone] || TONE.teal;

  useEffect(() => {
    if (typeof value === 'number') countUp(valueRef.current, value, format ? { format } : {});
  }, [value, format]);

  return (
    <div className="card card-hover rise-in group relative flex items-start gap-3 overflow-hidden p-4">
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r opacity-70 transition-opacity group-hover:opacity-100 ${t.bar}`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl transition-transform duration-500 group-hover:scale-125 ${t.glow}`} />
      {Icon && (
        <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md shadow-black/10 ${t.icon}`}>
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
      )}
      <div className="relative min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
          {value === null || value === undefined ? '—' : <>{prefix}<span ref={valueRef}>{typeof value === 'number' ? 0 : value}</span>{suffix}</>}
        </p>
        {hint && <p className="mt-0.5 truncate text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function KpiGrid({ children, cols = 'sm:grid-cols-2 xl:grid-cols-4' }) {
  return <div className={`grid gap-4 ${cols}`}>{children}</div>;
}
