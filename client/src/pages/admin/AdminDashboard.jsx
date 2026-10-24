import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, unwrap } from '../../lib/api.js';
import { KpiCard } from '../../components/ui/KpiCard.jsx';
import { Skeleton } from '../../components/ui/States.jsx';
import { inr, date } from '../../lib/format.js';
import { useGsapContext, gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { PageHeader } from '../../components/ui/Page.jsx';

// Light-theme hex twins of the --line/--ink-muted/--pulse tokens (this
// dashboard renders in the light app theme, and Recharts needs literal
// colour strings — it can't read CSS custom properties).
const GRID_LINE = '#E3E8F0';
const AXIS_TEXT = '#5E6E85';
const LINE_STROKE = '#0D9488';

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

  // A plain staggered fade-in, not the marketing pages' scroll-triggered
  // reveal — this content lives inside AppShell's internally-scrolling
  // <main>, not the window, so a ScrollTrigger keyed to the viewport would
  // never fire for anything below the fold. Re-run whenever loading flips
  // off, since these elements don't exist in the DOM until the fetch resolves.
  useGsapContext(() => {
    if (prefersReducedMotion()) return;
    gsap.from('[data-reveal]', { opacity: 0, y: 14, duration: 0.5, stagger: 0.06, ease: 'power2.out' });
  }, [overview.isLoading, recentClinics.isLoading]);

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Clinics, users, subscriptions and revenue across ClinicSaathi." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overview.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : (
            <>
              <div data-reveal><KpiCard label="Clinics" value={k?.totalClinics || 0}
                       hint={`${k?.activeClinics || 0} active`} /></div>
              <div data-reveal><KpiCard label="Trialing" value={k?.trialingClinics || 0}
                       hint={k?.pastDueClinics ? `${k.pastDueClinics} past due` : 'None past due'} /></div>
              <div data-reveal><KpiCard label="Total users" value={k?.totalUsers || 0} /></div>
              <div data-reveal><KpiCard label="MRR" value={k?.mrr || 0} format={(n) => inr(n)} /></div>
              <div data-reveal><KpiCard label="Inactive clinics" value={k?.inactiveClinics || 0} /></div>
              <div data-reveal><KpiCard label="Doctors" value={k?.totalDoctors || 0} /></div>
              <div data-reveal><KpiCard label="Patients" value={k?.totalPatients || 0} /></div>
              <div data-reveal><KpiCard label="Appointments" value={k?.totalAppointments || 0} /></div>
              <div data-reveal><KpiCard label="Active subscriptions" value={k?.activeSubscriptions || 0} /></div>
              <div data-reveal><KpiCard label="AI tokens" value={k?.aiUsage || 0} /></div>
              <div data-reveal><KpiCard label="WhatsApp messages" value={k?.whatsappUsage || 0} /></div>
              <div data-reveal><KpiCard label="SMS sent" value={k?.smsUsage || 0} /></div>
              <div data-reveal><KpiCard label="Emails sent" value={k?.emailUsage || 0} /></div>
            </>
          )}
      </div>

      <section data-reveal className="card p-5">
        <h2 className="font-display text-[15px] font-semibold">New clinics, last 30 days</h2>
        <div className="mt-4 h-56">
          {overview.isLoading ? <Skeleton className="h-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overview.data?.charts.signupsByDay || []}>
                <defs>
                  <linearGradient id="signupsGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={LINE_STROKE} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={LINE_STROKE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_LINE} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: AXIS_TEXT }}
                       tickFormatter={(d) => dayjs(d).format('D MMM')} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS_TEXT }} tickLine={false} axisLine={false} />
                <Tooltip
                  labelFormatter={(d) => dayjs(d).format('DD MMM YYYY')}
                  contentStyle={{ background: '#FFFFFF', border: `1px solid ${GRID_LINE}`, borderRadius: 10, color: '#0B1F3A' }}
                  labelStyle={{ color: AXIS_TEXT }}
                />
                <Area type="monotone" dataKey="count" stroke={LINE_STROKE} strokeWidth={2}
                      dot={false} fill="url(#signupsGlow)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section data-reveal className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[15px] font-semibold">Recently joined</h2>
          <Link to="/super-admin/clinics" className="text-sm text-pulse-deep hover:underline">All clinics</Link>
        </div>
        {recentClinics.isLoading ? <Skeleton className="h-32" /> : (
          <ul className="divide-y divide-line">
            {(recentClinics.data || []).map((c) => (
              <li key={c._id} data-reveal
                  className="flex items-center justify-between gap-4 rounded-lg py-2.5 px-2 text-sm transition-colors hover:bg-paper-sunk">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-xs text-ink-muted">{c.subscription?.plan || 'No plan'} · {c.userCount} user{c.userCount === 1 ? '' : 's'}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-muted">{date(c.createdAt)}</span>
              </li>
            ))}
            {!recentClinics.data?.length && <p className="py-4 text-sm text-ink-muted">No clinics yet.</p>}
          </ul>
        )}
      </section>
    </div>
  );
}
