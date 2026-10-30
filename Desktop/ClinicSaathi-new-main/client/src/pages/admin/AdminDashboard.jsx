import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Building2, Users, Stethoscope, CalendarDays, IndianRupee, TrendingUp, Sparkles, MessageCircle, MessageSquare, Mail,
  ArrowUpRight, Layers, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { KpiCard } from '../../components/ui/KpiCard.jsx';
import { Skeleton } from '../../components/ui/States.jsx';
import { inr, date, titleCase } from '../../lib/format.js';
import { useGsapContext, gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';

// Light-theme hex twins of the --line/--ink-muted/--pulse tokens (this
// dashboard renders in the light app theme, and Recharts needs literal
// colour strings — it can't read CSS custom properties).
const GRID_LINE = '#E3E8F0';
const AXIS_TEXT = '#5E6E85';
const LINE_STROKE = '#0D9488';

const PLAN_BARS = ['bg-teal-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500'];

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const greeting = () => {
  const h = dayjs().hour();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Card shell with a title row, shared by the panels below the KPIs. */
function Panel({ title, icon: Icon, action, className = '', children }) {
  return (
    <section data-reveal className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
          {Icon && <Icon className="h-4 w-4 text-ink-muted" />} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Revenue banner in the sidebar's navy, so the landing page has one clear focal point. */
function Hero({ k, loading }) {
  const mini = [
    { label: 'Active subscriptions', value: k?.activeSubscriptions },
    { label: 'On trial', value: k?.trialingClinics },
    { label: 'Past due', value: k?.pastDueClinics, warn: k?.pastDueClinics > 0 },
  ];
  return (
    <section data-reveal className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-lift sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-sky-500/15 blur-3xl" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-teal-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Platform overview
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold sm:text-[28px]">{greeting()}, here’s ClinicSaathi today</h1>
          <p className="mt-1 text-sm text-navy-text/75">{dayjs().format('dddd, D MMMM YYYY')}</p>

          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-text/70">Monthly recurring revenue</p>
            {loading ? <div className="mt-2 h-10 w-44 animate-pulse rounded-lg bg-white/10" /> : (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-4xl font-semibold tabular-nums sm:text-[44px]">{inr(k?.mrr || 0)}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-400/15 px-2 py-0.5 text-xs font-medium text-teal-200">
                  <TrendingUp className="h-3.5 w-3.5" /> {inr((k?.mrr || 0) * 12)} / year run rate
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
          {mini.map((m) => (
            <div key={m.label} className="min-w-[150px] rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-navy-text/75">{m.label}</p>
              <p className={`mt-0.5 font-display text-2xl font-semibold tabular-nums ${m.warn ? 'text-rose-300' : 'text-white'}`}>
                {loading ? '—' : fmt(m.value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative mt-6 flex flex-wrap gap-2">
        {[
          { to: '/super-admin/clinics', label: 'Manage clinics' },
          { to: '/super-admin/plans', label: 'Subscription plans' },
          { to: '/super-admin/revenue', label: 'Revenue report' },
        ].map((a) => (
          <Link key={a.to} to={a.to}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.12]">
            {a.label} <ArrowUpRight className="h-3.5 w-3.5 text-teal-300" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** One stacked bar for every subscription state, with a legend underneath. */
function SubscriptionHealth({ k }) {
  const parts = [
    { label: 'Active', value: k?.activeSubscriptions || 0, bar: 'bg-emerald-500' },
    { label: 'Trialing', value: k?.trialingClinics || 0, bar: 'bg-sky-500' },
    { label: 'Past due', value: k?.pastDueClinics || 0, bar: 'bg-amber-500' },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const activePct = k?.totalClinics ? Math.round(((k.activeClinics || 0) / k.totalClinics) * 100) : 0;

  return (
    <Panel title="Subscription health" icon={Layers}>
      <div className="flex h-3 overflow-hidden rounded-full bg-paper-sunk">
        {total > 0 && parts.map((p) => p.value > 0 && (
          <div key={p.label} className={`${p.bar} transition-[width] duration-700`} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink-soft"><span className={`h-2.5 w-2.5 rounded-full ${p.bar}`} />{p.label}</span>
            <span className="font-semibold tabular-nums text-ink">{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-xl bg-paper p-3">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Clinics active</span>
          <span className="font-semibold text-ink">{activePct}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-[width] duration-700" style={{ width: `${activePct}%` }} />
        </div>
        <p className="mt-2 text-xs text-ink-muted">{fmt(k?.inactiveClinics)} inactive of {fmt(k?.totalClinics)} total</p>
      </div>
    </Panel>
  );
}

/** Messaging and AI consumption as icon rows. */
function UsagePanel({ k }) {
  const rows = [
    { label: 'AI tokens', value: k?.aiUsage, icon: Sparkles, tile: 'bg-violet-50 text-violet-600' },
    { label: 'WhatsApp messages', value: k?.whatsappUsage, icon: MessageCircle, tile: 'bg-emerald-50 text-emerald-600' },
    { label: 'SMS sent', value: k?.smsUsage, icon: MessageSquare, tile: 'bg-sky-50 text-sky-600' },
    { label: 'Emails sent', value: k?.emailUsage, icon: Mail, tile: 'bg-amber-50 text-amber-600' },
  ];
  return (
    <Panel title="Usage" icon={Sparkles}>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        {rows.map(({ label, value, icon: Icon, tile }) => (
          <li key={label} className="flex items-center gap-3 rounded-xl border border-line/70 p-3 transition-colors hover:bg-paper">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tile}`}><Icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{label}</span>
            <span className="font-display text-lg font-semibold tabular-nums text-ink">{fmt(value)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Active subscriptions per plan as proportional bars. */
function PlanMix({ plans }) {
  const total = plans.reduce((s, p) => s + p.count, 0);
  return (
    <Panel title="Plan mix" icon={IndianRupee}>
      {!plans.length ? <p className="py-6 text-center text-sm text-ink-muted">No active subscriptions yet.</p> : (
        <ul className="space-y-4">
          {plans.map((p, i) => {
            const pct = total ? Math.round((p.count / total) * 100) : 0;
            return (
              <li key={p.plan}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">{titleCase(p.plan)}</span>
                  <span className="text-ink-muted"><span className="font-semibold text-ink">{fmt(p.count)}</span> · {pct}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-sunk">
                  <div className={`h-full rounded-full ${PLAN_BARS[i % PLAN_BARS.length]} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export default function AdminDashboard() {
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () => api.get('/platform/overview').then(unwrap),
  });

  const recentClinics = useQuery({
    queryKey: ['platform', 'clinics', 'recent'],
    queryFn: () => api.get('/platform/clinics', { params: { limit: 5 } }).then((r) => r.data.data),
  });

  const k = overview.data?.kpis;
  const signups = overview.data?.charts.signupsByDay || [];
  const newThisMonth = signups.reduce((s, d) => s + d.count, 0);

  // A plain staggered fade-in, not the marketing pages' scroll-triggered
  // reveal — this content lives inside AppShell's internally-scrolling
  // <main>, not the window, so a ScrollTrigger keyed to the viewport would
  // never fire for anything below the fold. Re-run whenever loading flips
  // off, since these elements don't exist in the DOM until the fetch resolves.
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-reveal]', { opacity: 0, y: 14, duration: 0.5, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,transform' });
  }, [overview.isLoading, recentClinics.isLoading]);

  return (
    <div className="space-y-6">
      <Hero k={k} loading={overview.isLoading} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overview.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : (
            <>
              <KpiCard label="Clinics" value={k?.totalClinics || 0} icon={Building2} tone="teal"
                       hint={`${fmt(k?.activeClinics)} active · ${fmt(newThisMonth)} new in 30 days`} />
              <KpiCard label="Users" value={k?.totalUsers || 0} icon={Users} tone="navy" hint="Across all clinics" />
              <KpiCard label="Doctors" value={k?.totalDoctors || 0} icon={Stethoscope} tone="amber"
                       hint={`${fmt(k?.totalPatients)} patients registered`} />
              <KpiCard label="Appointments" value={k?.totalAppointments || 0} icon={CalendarDays} tone="red" hint="All time" />
            </>
          )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="New clinics, last 30 days" icon={TrendingUp} className="lg:col-span-2"
               action={<span className="rounded-full bg-pulse/10 px-2.5 py-0.5 text-xs font-medium text-pulse-deep">{fmt(newThisMonth)} total</span>}>
          <div className="h-64">
            {overview.isLoading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={signups}>
                  <defs>
                    <linearGradient id="signupsGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={LINE_STROKE} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={LINE_STROKE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_LINE} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS_TEXT }}
                         tickFormatter={(d) => dayjs(d).format('D MMM')} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} width={28} />
                  <Tooltip
                    labelFormatter={(d) => dayjs(d).format('DD MMM YYYY')}
                    contentStyle={{ background: '#FFFFFF', border: `1px solid ${GRID_LINE}`, borderRadius: 10, color: '#0B1F3A' }}
                    labelStyle={{ color: AXIS_TEXT }}
                  />
                  <Area type="monotone" dataKey="count" name="New clinics" stroke={LINE_STROKE} strokeWidth={2.5}
                        dot={false} activeDot={{ r: 4 }} fill="url(#signupsGlow)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        {overview.isLoading ? <Skeleton className="h-80" /> : <SubscriptionHealth k={k} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Recently joined" icon={Building2} className="lg:col-span-2"
               action={<Link to="/super-admin/clinics" className="inline-flex items-center gap-0.5 text-sm font-medium text-pulse-deep hover:underline">All clinics <ChevronRight className="h-4 w-4" /></Link>}>
          {recentClinics.isLoading ? <Skeleton className="h-40" /> : (
            <ul className="divide-y divide-line">
              {(recentClinics.data || []).map((c) => (
                <li key={c._id} className="flex items-center gap-3 px-1 py-3 text-sm">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-sky-600 font-semibold text-white">
                    {c.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{c.name}</p>
                    <p className="text-xs text-ink-muted">{fmt(c.userCount)} user{c.userCount === 1 ? '' : 's'} · joined {date(c.createdAt)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-pulse/10 px-2.5 py-0.5 text-xs font-medium text-pulse-deep">
                    {c.subscription?.plan ? titleCase(c.subscription.plan) : 'No plan'}
                  </span>
                </li>
              ))}
              {!recentClinics.data?.length && <p className="py-6 text-center text-sm text-ink-muted">No clinics yet.</p>}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          {overview.isLoading ? <Skeleton className="h-48" /> : <PlanMix plans={overview.data?.charts.planBreakdown || []} />}
          {overview.isLoading ? <Skeleton className="h-64" /> : <UsagePanel k={k} />}
        </div>
      </div>
    </div>
  );
}
