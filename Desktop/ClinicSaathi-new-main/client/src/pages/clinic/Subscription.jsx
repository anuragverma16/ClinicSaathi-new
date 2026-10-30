import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Lock } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { PageHeader, Section, Field } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Skeleton, Spinner } from '../../components/ui/States.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { date } from '../../lib/format.js';

const FEATURE_LABEL = {
  booking: 'Online booking', reminders: 'Confirmations & reminders', patients: 'Patient records', queue: 'Digital queue', billing: 'Billing & payments',
  followups: 'Follow-ups', reports: 'Reports & analytics', ai_receptionist: 'AI receptionist', ai_followup: 'AI follow-up', ai_recall: 'Recall engine',
  reviews: 'Review requests', campaigns: 'Campaigns', multi_branch: 'Multi-branch', api_access: 'API access',
};

function Meter({ label, used, limit }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="font-medium">{used}{limit ? ` / ${limit}` : ' · unlimited'}</span></div>
      <div className="mt-1.5 h-2 rounded-full bg-paper-sunk"><div className={`h-2 rounded-full ${pct >= 90 ? 'bg-alert' : 'bg-pulse'}`} style={{ width: `${limit ? pct : 4}%` }} /></div>
    </div>
  );
}

export default function Subscription() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['clinic', 'subscription'], queryFn: () => api.get('/clinics/subscription').then(unwrap) });
  const tickets = useQuery({ queryKey: ['support'], queryFn: () => api.get('/clinics/support').then(unwrap) });
  const [t, setT] = useState({ subject: '', description: '' });
  const raise = useMutation({
    mutationFn: () => api.post('/clinics/support', t),
    onSuccess: () => { toast.success('Request sent to ClinicSaathi support'); setT({ subject: '', description: '' }); qc.invalidateQueries({ queryKey: ['support'] }); },
    onError: (e) => toast.error(e.message),
  });
  if (s.isLoading) return <Skeleton className="h-96" />;
  const { subscription: sub, entitlements: ent, usage } = s.data;
  const all = Object.keys(FEATURE_LABEL);

  return (
    <div className="space-y-6">
      <PageHeader title="Subscription" description="Your plan, what it includes, and how much of it you're using." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Current plan" className="lg:col-span-1">
          <p className="font-display text-3xl font-semibold">{ent.plan}</p>
          <div className="mt-2 flex items-center gap-2"><StatusBadge status={sub?.status || 'ACTIVE'} />{sub?.trialEndsAt && sub.status === 'TRIALING' && <span className="text-sm text-ink-muted">trial ends {date(sub.trialEndsAt)}</span>}</div>
          {!ent.live && <p className="mt-3 rounded-lg bg-alert-soft p-3 text-sm text-alert">Your subscription is not active, so paid features are paused. Booking keeps working.</p>}
          <p className="mt-4 text-sm text-ink-muted">To change plan, raise a request below — upgrades are applied by ClinicSaathi after payment.</p>
        </Section>
        <Section title="Usage" className="lg:col-span-2">
          <div className="space-y-4">
            <Meter label="Active doctors" used={usage.doctors} limit={ent.limits.maxDoctors} />
            <Meter label="Branches" used={usage.branches} limit={ent.limits.maxBranches} />
            <Meter label="WhatsApp messages this month" used={usage.whatsappMessages || 0} limit={usage.whatsappIncluded} />
            <Meter label="AI tokens this month" used={usage.aiTokens || 0} limit={usage.aiTokensIncluded} />
          </div>
        </Section>
      </div>
      <Section title="Included features">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {all.map((k) => {
            const on = ent.features.includes('*') || ent.features.includes(k);
            return <li key={k} className={`flex items-center gap-2 text-sm ${on ? '' : 'text-ink-muted'}`}>{on ? <Check className="h-4 w-4 text-pulse" /> : <Lock className="h-4 w-4" />} {FEATURE_LABEL[k]}</li>;
          })}
        </ul>
      </Section>
      <Section title="Support and plan requests">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Subject" htmlFor="t-sub"><input id="t-sub" className="field" placeholder="Upgrade to Pro" value={t.subject} onChange={(e) => setT({ ...t, subject: e.target.value })} /></Field>
          <Field label="Details" htmlFor="t-desc"><input id="t-desc" className="field" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} /></Field>
          <button className="btn-primary" disabled={t.subject.length < 3 || t.description.length < 3 || raise.isPending} onClick={() => raise.mutate()}>{raise.isPending && <Spinner />} Send</button>
        </div>
        <div className="mt-4">
          <DataTable loading={tickets.isLoading} rows={tickets.data} columns={[
            { key: 'subject', header: 'Subject' }, { key: 'createdAt', header: 'Raised', render: (r) => date(r.createdAt) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </div>
      </Section>
    </div>
  );
}
