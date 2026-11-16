import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Database, Server, Inbox, IndianRupee } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { PageHeader, Section, Field } from '../../components/ui/Page.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Skeleton } from '../../components/ui/States.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { inr, date, dateTime, titleCase } from '../../lib/format.js';

export function PlatformBranches() {
  const q = useQuery({ queryKey: ['platform', 'branches'], queryFn: () => api.get('/platform/branches').then(unwrap) });
  return (
    <div>
      <PageHeader title="Branches" description="Every location across all clinics. Branch details are managed by each clinic owner." />
      <DataTable loading={q.isLoading} error={q.error} rows={q.data} empty={<EmptyState title="No branches yet" />} columns={[
        { key: 'clinic', header: 'Clinic', sort: (r) => r.clinic },
        { key: 'name', header: 'Branch', render: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'city', header: 'City', render: (r) => r.address?.city || '—' },
        { key: 'created', header: 'Added', hideOnMobile: true, render: (r) => date(r.createdAt) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
      ]} />
    </div>
  );
}

function PlanCard({ plan, allFeatures }) {
  const qc = useQueryClient();
  const [f, setF] = useState(null);
  useEffect(() => setF({ price: plan.price ?? '', maxDoctors: plan.maxDoctors ?? '', maxBranches: plan.maxBranches ?? '', features: plan.features }), [plan]);
  const save = useMutation({
    mutationFn: () => api.put(`/platform/plans/${plan.name}`, {
      price: f.price === '' ? null : Number(f.price), maxDoctors: f.maxDoctors === '' ? null : Number(f.maxDoctors),
      maxBranches: f.maxBranches === '' ? null : Number(f.maxBranches), features: f.features,
    }),
    onSuccess: () => { toast.success(`${plan.name} updated — enforced on the next request`); qc.invalidateQueries({ queryKey: ['platform', 'plans'] }); },
    onError: (e) => toast.error(e.message),
  });
  if (!f) return null;
  const all = f.features.includes('*');
  return (
    <Section title={titleCase(plan.name)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Price / month (₹)" htmlFor={`p-${plan.name}`} hint="Blank = custom"><input id={`p-${plan.name}`} type="number" min="0" className="field" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Max doctors" htmlFor={`d-${plan.name}`} hint="Blank = unlimited"><input id={`d-${plan.name}`} type="number" min="1" className="field" value={f.maxDoctors} onChange={(e) => setF({ ...f, maxDoctors: e.target.value })} /></Field>
        <Field label="Max branches" htmlFor={`b-${plan.name}`} hint="Blank = unlimited"><input id={`b-${plan.name}`} type="number" min="1" className="field" value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: e.target.value })} /></Field>
      </div>
      <p className="label mt-4">Features</p>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setF({ ...f, features: e.target.checked ? ['*'] : [] })} /> Everything</label>
      {!all && (
        <div className="grid gap-1.5 sm:grid-cols-3">
          {allFeatures.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.features.includes(k)} onChange={(e) => setF({ ...f, features: e.target.checked ? [...f.features, k] : f.features.filter((x) => x !== k) })} /> {titleCase(k)}</label>)}
        </div>
      )}
      <div className="mt-4 flex justify-end"><button className="btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>Save {titleCase(plan.name)}</button></div>
    </Section>
  );
}

export function PlatformPlans() {
  const q = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api.get('/platform/plans').then(unwrap) });
  return (
    <div className="space-y-5">
      <PageHeader title="Subscription plans" description="Prices, limits and feature access. Changes are enforced by the API for every clinic on the plan." />
      {q.isLoading ? <Skeleton className="h-96" /> : q.data.plans.map((p) => <PlanCard key={p.name} plan={p} allFeatures={q.data.allFeatures} />)}
    </div>
  );
}

export function PlatformRevenue() {
  const q = useQuery({ queryKey: ['platform', 'revenue'], queryFn: () => api.get('/platform/revenue').then(unwrap) });
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform revenue" description="Recurring revenue from active subscriptions, by plan." />
      <KpiGrid>
        <KpiCard icon={IndianRupee} label="MRR" value={d?.mrr} format={inr} />
        <KpiCard tone="navy" label="Active" value={d?.statusCounts?.ACTIVE || 0} />
        <KpiCard tone="amber" label="Trialing" value={d?.statusCounts?.TRIALING || 0} />
        <KpiCard tone="red" label="Past due" value={d?.statusCounts?.PAST_DUE || 0} />
      </KpiGrid>
      {d?.note && <p className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-muted">{d.note}</p>}
      <Section title="By plan"><DataTable loading={q.isLoading} rows={d?.byPlan} rowKey={(r) => r.plan} empty={<EmptyState title="No active paid subscriptions" />} columns={[
        { key: 'plan', header: 'Plan' }, { key: 'clinics', header: 'Clinics' }, { key: 'mrr', header: 'MRR', render: (r) => inr(r.mrr) },
      ]} /></Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Trials ending within 7 days"><DataTable loading={q.isLoading} rows={d?.trialsEnding} rowKey={(r) => r.clinic + r.trialEndsAt} empty={<EmptyState title="None" />} columns={[{ key: 'clinic', header: 'Clinic' }, { key: 'end', header: 'Ends', render: (r) => date(r.trialEndsAt) }]} /></Section>
        <Section title="Past due"><DataTable loading={q.isLoading} rows={d?.pastDue} rowKey={(r) => r.clinic} empty={<EmptyState title="None" />} columns={[{ key: 'clinic', header: 'Clinic' }, { key: 'plan', header: 'Plan' }, { key: 'since', header: 'Since', render: (r) => date(r.since) }]} /></Section>
      </div>
    </div>
  );
}

export function PlatformIntegrations() {
  const q = useQuery({ queryKey: ['platform', 'integrations'], queryFn: () => api.get('/platform/integrations').then(unwrap) });
  return (
    <div>
      <PageHeader title="Integrations" description="Configured on the server through environment variables. Secrets are never shown or editable here." />
      <div className="grid gap-4 md:grid-cols-2">
        {q.isLoading ? <Skeleton className="h-40" /> : q.data.map((i) => (
          <div key={i.key} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{i.name}</p>
              {i.configured ? <span className="flex items-center gap-1 text-sm text-pulse-deep"><CheckCircle2 className="h-4 w-4" /> Configured</span> : <span className="flex items-center gap-1 text-sm text-signal"><XCircle className="h-4 w-4" /> Not configured</span>}
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-ink-muted">
              {i.webhookSigned !== undefined && <li>Webhook signature check: {i.webhookSigned ? 'on' : 'off (secret missing)'}</li>}
              {i.failures24h !== undefined && <li>Failures in last 24h: {i.failures24h}</li>}
              {i.note && <li>{i.note}</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SystemHealth() {
  const q = useQuery({ queryKey: ['platform', 'health'], queryFn: () => api.get('/platform/health').then(unwrap), refetchInterval: 30_000 });
  const d = q.data;
  const failed = d ? (d.messages24h?.FAILED || 0) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="System health" description="API, database, background jobs, notifications and webhooks. Refreshes every 30 seconds." />
      <KpiGrid>
        <KpiCard icon={Server} label="API uptime" value={d ? `${Math.floor(d.api.uptimeSeconds / 3600)}h ${Math.floor((d.api.uptimeSeconds % 3600) / 60)}m` : null} hint={d ? `${d.api.node} · ${d.api.memoryMb} MB` : undefined} />
        <KpiCard icon={Database} tone="navy" label="Database" value={d ? `${d.database.latencyMs} ms` : null} hint="ping latency" />
        <KpiCard icon={Inbox} tone={d?.queue.redis === 'ready' ? 'teal' : 'red'} label="Job queue (Redis)" value={d?.queue.redis ?? null} hint={d?.queue.redis === 'ready' ? 'Reminders and campaigns run' : 'Scheduled jobs are not running'} />
        <KpiCard tone="red" label="Messages failed (24h)" value={failed} hint={d ? `${Object.entries(d.messages24h).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'no messages'}` : undefined} />
      </KpiGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Job outcomes · 24h"><DataTable loading={q.isLoading} rows={d?.jobs} rowKey={(r) => r.queue + r.status} empty={<EmptyState title="No job events" />} columns={[{ key: 'queue', header: 'Queue' }, { key: 'status', header: 'Outcome', render: (r) => <StatusBadge status={r.status} /> }, { key: 'count', header: 'Count' }]} /></Section>
        <Section title="Webhooks · 24h"><DataTable loading={q.isLoading} rows={d?.webhooks24h} rowKey={(r) => r.provider} empty={<EmptyState title="No webhooks received" />} columns={[{ key: 'provider', header: 'Provider' }, { key: 'count', header: 'Received' }, { key: 'unprocessed', header: 'Unprocessed' }]} /></Section>
      </div>
      <Section title="Recent job failures">
        <DataTable loading={q.isLoading} rows={d?.recentJobFailures} empty={<EmptyState title="No failures" />} columns={[
          { key: 'when', header: 'When', render: (r) => dateTime(r.createdAt) }, { key: 'clinic', header: 'Clinic', render: (r) => r.clinicId?.name || '—' },
          { key: 'queue', header: 'Queue' }, { key: 'job', header: 'Job', render: (r) => <span className="font-mono text-xs">{r.jobId || r.jobName}</span> },
          { key: 'status', header: 'Outcome', render: (r) => <StatusBadge status={r.status} /> }, { key: 'error', header: 'Error', render: (r) => <span className="text-xs text-ink-muted">{r.error}</span> },
        ]} />
      </Section>
    </div>
  );
}
