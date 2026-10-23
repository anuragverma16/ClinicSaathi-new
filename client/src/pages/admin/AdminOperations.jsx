import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, unwrap } from '../../lib/api.js';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner, Skeleton } from '../../components/ui/States.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PageHeader } from '../../components/ui/Page.jsx';
import { date, inr } from '../../lib/format.js';

const PLANS = [
  ['Starter', '₹999/month', '1 doctor, booking, reminders and patient records'],
  ['Growth', '₹2,999/month', 'Up to 5 doctors, queue, billing, follow-ups and reports'],
  ['Pro', '₹5,999/month', 'Up to 25 doctors, AI receptionist and campaigns'],
  ['Enterprise', 'Custom', 'Unlimited scale and custom support'],
];

export default function AdminOperations({ mode }) {
  if (mode === 'plans') return <Plans />;
  if (mode === 'support') return <Support />;
  if (mode === 'settings') return <Settings />;
  if (mode === 'analytics') return <Analytics />;
  return <OperationsTable mode={mode} />;
}

function OperationsTable({ mode }) {
  const config = {
    subscriptions: {
      title: 'Subscriptions',
      endpoint: '/platform/subscriptions',
      columns: [
        { key: 'clinic', header: 'Clinic', render: (r) => r.clinicId?.name || 'Deleted clinic' },
        { key: 'plan', header: 'Plan' },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'updatedAt', header: 'Updated', hideOnMobile: true, render: (r) => date(r.updatedAt) },
      ],
    },
    payments: {
      title: 'Payments',
      endpoint: '/platform/payments',
      columns: [
        { key: 'receiptNumber', header: 'Receipt', render: (r) => r.receiptNumber || '—' },
        { key: 'amount', header: 'Amount', render: (r) => inr(r.amount) },
        { key: 'method', header: 'Method' },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'createdAt', header: 'Created', hideOnMobile: true, render: (r) => date(r.createdAt) },
      ],
    },
    usage: {
      title: 'Subscription usage',
      endpoint: '/platform/usage',
      columns: [
        { key: 'clinic', header: 'Clinic', render: (r) => r.clinic?.name || 'Deleted clinic' },
        { key: 'plan', header: 'Plan' },
        { key: 'ai', header: 'AI tokens', render: (r) => `${r.usage?.aiTokens || 0} / ${r.usage?.aiTokensIncluded || 0}` },
        { key: 'whatsapp', header: 'WhatsApp', render: (r) => `${r.usage?.whatsappMessages || 0} / ${r.usage?.whatsappIncluded || 0}` },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ],
    },
    ai: {
      title: 'AI usage',
      endpoint: '/platform/ai-usage',
      columns: [
        { key: 'clinic', header: 'Clinic' },
        { key: 'conversations', header: 'Conversations' },
        { key: 'tokens', header: 'Tokens used' },
      ],
    },
    communication: {
      title: 'Communication usage',
      endpoint: '/platform/communication-usage',
      columns: [
        { key: 'clinic', header: 'Clinic', render: (r) => r.clinic || 'Deleted clinic' },
        { key: 'channel', header: 'Channel' },
        { key: 'count', header: 'Messages' },
        { key: 'costPaise', header: 'Cost', render: (r) => inr((r.costPaise || 0) / 100) },
      ],
    },
  }[mode];

  const query = useQuery({
    queryKey: ['platform', mode],
    queryFn: () => api.get(config.endpoint).then(unwrap),
  });

  return (
    <div className="space-y-4">
      <PageHeader title={config.title} description="Platform-wide operational data across all clinics." />
      <DataTable
        loading={query.isLoading}
        error={query.error}
        onRetry={query.refetch}
        rows={query.data}
        empty={<EmptyState title={`No ${config.title.toLowerCase()} recorded yet`} />}
        columns={config.columns}
      />
    </div>
  );
}

function Plans() {
  return (
    <div className="space-y-4">
      <PageHeader title="Plans" description="Plan definitions used for subscriptions." />
      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map(([name, price, detail]) => (
          <section key={name} className="card p-5 transition-all duration-300 hover:shadow-lg">
            <h2 className="font-display text-lg font-semibold">{name}</h2>
            <p className="mt-2 text-pulse-deep font-semibold">{price}</p>
            <p className="mt-3 text-sm text-ink-muted">{detail}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function Analytics() {
  const query = useQuery({
    queryKey: ['platform', 'analytics'],
    queryFn: () => api.get('/platform/analytics').then(unwrap),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Platform analytics" description="Clinic growth and appointment volume across the platform." />
      <section className="card p-5">
        <h2 className="font-display text-[15px] font-semibold">Appointments by status</h2>
        <div className="mt-4 h-64">
          {query.isLoading ? (
            <Skeleton className="h-full" />
          ) : query.data ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={query.data.appointmentsByStatus}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8F0" />
                <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#5E6E85' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5E6E85' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #DFE5EE', borderRadius: 10 }} />
                <Bar dataKey="count" fill="#0D9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No data yet" />
          )}
        </div>
      </section>
    </div>
  );
}

function Support() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '', priority: 'NORMAL' });

  const tickets = useQuery({
    queryKey: ['platform', 'support'],
    queryFn: () => api.get('/platform/support').then(unwrap),
  });

  const update = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/platform/support/${id}`, { status }),
    onSuccess: () => {
      toast.success('Ticket updated');
      qc.invalidateQueries({ queryKey: ['platform', 'support'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: () => api.post('/platform/support', form),
    onSuccess: () => {
      toast.success('Support ticket created');
      setOpen(false);
      setForm({ subject: '', description: '', priority: 'NORMAL' });
      qc.invalidateQueries({ queryKey: ['platform', 'support'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const isFormValid = form.subject.length >= 3 && form.description.length >= 3;

  return (
    <div className="space-y-4">
      <PageHeader title="Support" description="Track and resolve customer support work."
                  actions={<button onClick={() => setOpen(true)} className="btn-primary">New ticket</button>} />

      <DataTable
        loading={tickets.isLoading}
        error={tickets.error}
        onRetry={tickets.refetch}
        rows={tickets.data}
        columns={[
          { key: 'subject', header: 'Subject' },
          { key: 'clinic', header: 'Clinic', render: (r) => r.clinicId?.name || 'Platform' },
          { key: 'priority', header: 'Priority' },
          { key: 'status', header: 'Status' },
          { key: 'createdAt', header: 'Created', hideOnMobile: true, render: (r) => date(r.createdAt) },
          {
            key: 'actions',
            header: '',
            render: (r) => r.status !== 'CLOSED' && (
              <button
                onClick={() => update.mutate({ id: r._id, status: 'CLOSED' })}
                disabled={update.isPending}
                className="btn-ghost text-xs disabled:opacity-50">
                {update.isPending && update.variables?.id === r._id ? <Spinner className="h-3 w-3" /> : 'Close'}
              </button>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New support ticket"
        footer={(
          <>
            <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
            <button
              onClick={() => create.mutate()}
              disabled={!isFormValid || create.isPending}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
              {create.isPending && <Spinner />} Create ticket
            </button>
          </>
        )}>
        <div className="space-y-4">
          <input
            className="field"
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            aria-label="Subject" />
          <textarea
            className="field min-h-28"
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            aria-label="Description" />
          <select
            className="field"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            aria-label="Priority">
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  );
}

function Settings() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => api.get('/platform/settings').then(unwrap),
  });

  const save = useMutation({
    mutationFn: ({ key, value, description }) =>
      api.put(`/platform/settings/${encodeURIComponent(key)}`, { value, description }),
    onSuccess: () => {
      toast.success('Setting saved');
      qc.invalidateQueries({ queryKey: ['platform', 'settings'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (setting, value) => save.mutate({
    key: setting.key,
    value,
    description: setting.description,
  });

  const switches = settings.data?.filter((setting) => typeof setting.value === 'boolean') || [];
  const fields = settings.data?.filter((setting) => typeof setting.value !== 'boolean') || [];

  if (settings.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="System settings" description="Platform-wide controls. Every change is stored and recorded in the audit log." />

      <section className="card p-5">
        <h2 className="font-display text-[15px] font-semibold">Platform controls</h2>
        <div className="mt-4 divide-y divide-line">
          {switches.map((setting) => (
            <label key={setting.key} className="flex cursor-pointer items-center justify-between gap-4 py-4">
              <span>
                <span className="block font-medium">{setting.key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="mt-1 block text-sm text-ink-muted">{setting.description}</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-pulse"
                checked={Boolean(setting.value)}
                disabled={save.isPending}
                onChange={(e) => update(setting, e.target.checked)}
                aria-label={`Toggle ${setting.key}`} />
            </label>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-[15px] font-semibold">General configuration</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {fields.map((setting) => (
            <label key={setting.key} className="block">
              <span className="mb-1 block text-sm font-medium">{setting.key.replace(/([A-Z])/g, ' $1')}</span>
              <input
                className="field"
                defaultValue={setting.value}
                disabled={save.isPending}
                onBlur={(e) => {
                  const newValue = setting.key === 'defaultTrialDays' ? Number(e.target.value) : e.target.value;
                  if (String(newValue) !== String(setting.value)) {
                    update(setting, newValue);
                  }
                }}
                aria-label={setting.key} />
              <span className="mt-1 block text-xs text-ink-muted">{setting.description}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
