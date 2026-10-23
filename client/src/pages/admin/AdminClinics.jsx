import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Ban, CheckCircle2, Plus } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { date } from '../../lib/format.js';
import { PageHeader } from '../../components/ui/Page.jsx';

const PLANS = ['STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'];
const STATUSES = ['TRIALING', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED'];

export default function AdminClinics() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();

  const clinics = useQuery({
    queryKey: ['platform', 'clinics', q],
    queryFn: () => api.get('/platform/clinics', { params: q ? { q } : {} }).then((r) => r.data.data),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/platform/clinics/${id}/status`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'clinics'] });
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Clinics" description="Every clinic on the platform. Create a clinic with its owner login, or click a row for details." />
      <div className="flex items-center justify-end gap-4">
        <div className="flex w-full max-w-md gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name"
              className="field pl-9 transition-colors duration-150"
              aria-label="Search clinics" />
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="btn-primary shrink-0 transition-all duration-200 hover:shadow-lg">
            <Plus className="h-4 w-4" /> Add clinic
          </button>
        </div>
      </div>

      <DataTable
        loading={clinics.isLoading}
        error={clinics.error}
        onRetry={clinics.refetch}
        rows={clinics.data}
        onRowClick={(r) => setOpenId(r._id)}
        columns={[
          {
            key: 'name', header: 'Clinic', render: (r) => (
              <div>
                <p className="font-medium text-ink">{r.name}</p>
                <p className="text-xs text-ink-muted">{r.slug}</p>
              </div>
            ),
          },
          { key: 'plan', header: 'Plan', hideOnMobile: true, render: (r) => r.subscription?.plan || '—' },
          {
            key: 'status', header: 'Subscription',
            render: (r) => r.subscription ? <StatusBadge status={r.subscription.status} /> : '—',
          },
          { key: 'userCount', header: 'Users', hideOnMobile: true },
          { key: 'createdAt', header: 'Joined', hideOnMobile: true, render: (r) => date(r.createdAt) },
          {
            key: 'active', header: 'Access',
            render: (r) => (
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${r.isActive ? 'text-pulse-deep' : 'text-alert'}`}>
                {r.isActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                {r.isActive ? 'Active' : 'Suspended'}
              </span>
            ),
          },
          {
            key: 'actions', header: '',
            render: (r) => (
              <button
                onClick={(e) => { e.stopPropagation(); setStatus.mutate({ id: r._id, isActive: !r.isActive }); }}
                disabled={setStatus.isPending}
                className="btn-ghost text-xs"
              >
                {r.isActive ? 'Suspend' : 'Reactivate'}
              </button>
            ),
          },
        ]}
      />

      <ClinicDetailModal id={openId} onClose={() => setOpenId(null)} onStatusChange={setStatus} />
      <CreateClinicModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateClinicModal({ open, onClose }) {
  const qc = useQueryClient();
  const empty = { name: '', email: '', phone: '', city: '', plan: 'STARTER', status: 'TRIALING', owner: { name: '', email: '', phone: '', password: '' } };
  const [form, setForm] = useState(empty);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setOwner = (key, value) => setForm((current) => ({ ...current, owner: { ...current.owner, [key]: value } }));

  const create = useMutation({
    mutationFn: () => api.post('/platform/clinics', form),
    onSuccess: () => {
      toast.success(`Clinic created — owner can sign in as ${form.owner.email}`);
      qc.invalidateQueries({ queryKey: ['platform'] });
      setForm(empty);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const canSubmit = form.name.trim().length > 1
    && (!form.email || form.email.includes('@'))
    && (!form.phone || form.phone.length >= 10)
    && form.owner.name.trim().length > 1 && form.owner.email.includes('@')
    && form.owner.phone.length >= 10 && /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(form.owner.password);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create clinic"
      footer={(
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={!canSubmit || create.isPending}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {create.isPending && <Spinner />} Create clinic
          </button>
        </>
      )}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="cname">Clinic name</label>
          <input
            id="cname"
            className="field transition-colors duration-150"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            aria-label="Clinic name" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cemail">Email</label>
            <input
              id="cemail"
              type="email"
              className="field transition-colors duration-150"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              aria-label="Clinic email" />
          </div>
          <div>
            <label className="label" htmlFor="cphone">Phone</label>
            <input
              id="cphone"
              className="field transition-colors duration-150"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              aria-label="Clinic phone" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cplan">Plan</label>
            <select
              id="cplan"
              className="field transition-colors duration-150"
              value={form.plan}
              onChange={(e) => set('plan', e.target.value)}
              aria-label="Subscription plan">
              {PLANS.map((plan) => (
                <option key={plan} value={plan}>{plan.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cstatus">Subscription status</label>
            <select
              id="cstatus"
              className="field transition-colors duration-150"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Subscription status">
              {STATUSES.map((status) => (
                <option key={status} value={status}>{status.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-paper-sunk/50 p-4">
          <p className="text-sm font-semibold text-ink">Clinic owner login</p>
          <p className="mb-3 text-xs text-ink-muted">The owner signs in with these details and can then add doctors, staff and branches.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="oname">Owner name</label>
              <input id="oname" className="field" value={form.owner.name} onChange={(e) => setOwner('name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ophone">Owner mobile</label>
              <input id="ophone" type="tel" className="field" value={form.owner.phone} onChange={(e) => setOwner('phone', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="oemail">Owner email (login)</label>
              <input id="oemail" type="email" autoComplete="off" className="field" value={form.owner.email} onChange={(e) => setOwner('email', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="opass">Password</label>
              <input id="opass" type="text" autoComplete="new-password" className="field" placeholder="8+ chars, letter and number"
                     value={form.owner.password} onChange={(e) => setOwner('password', e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ClinicDetailModal({ id, onClose, onStatusChange }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [profile, setProfile] = useState(null);

  const detail = useQuery({
    queryKey: ['platform', 'clinic', id],
    queryFn: () => api.get(`/platform/clinics/${id}`).then(unwrap),
    enabled: Boolean(id),
  });
  const activity = useQuery({
    queryKey: ['platform', 'clinic-details', id],
    queryFn: () => api.get(`/platform/clinic-details/${id}`).then(unwrap),
    enabled: Boolean(id),
  });

  useEffect(() => { setDraft(null); setProfile(null); }, [id]);
  useEffect(() => {
    if (detail.data) { setDraft({ plan: detail.data.subscription?.plan, status: detail.data.subscription?.status }); setProfile({ name: detail.data.name || '', email: detail.data.email || '', phone: detail.data.phone || '' }); }
  }, [detail.data]);

  const saveSubscription = useMutation({
    mutationFn: () => api.patch(`/platform/clinics/${id}/subscription`, draft),
    onSuccess: () => {
      toast.success('Subscription updated');
      qc.invalidateQueries({ queryKey: ['platform', 'clinic', id] });
      qc.invalidateQueries({ queryKey: ['platform', 'clinics'] });
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
    onError: (e) => toast.error(e.message),
  });
  const saveProfile = useMutation({
    mutationFn: () => api.patch(`/platform/clinics/${id}`, profile),
    onSuccess: () => { toast.success('Clinic updated'); qc.invalidateQueries({ queryKey: ['platform', 'clinic', id] }); qc.invalidateQueries({ queryKey: ['platform', 'clinics'] }); },
    onError: (error) => toast.error(error.message),
  });

  const c = detail.data;

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={c?.name || 'Clinic'} width="max-w-2xl">
      {detail.isLoading || !c || !draft || !profile ? (
        <div className="flex justify-center py-10"><Spinner className="h-5 w-5 text-pulse" /></div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="font-display text-sm font-semibold">Clinic details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                className="field transition-colors duration-150"
                placeholder="Clinic name"
                aria-label="Clinic name"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              <input
                className="field transition-colors duration-150"
                type="email"
                placeholder="Email"
                aria-label="Clinic email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
              <input
                className="field transition-colors duration-150"
                placeholder="Phone"
                aria-label="Clinic phone"
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <button
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending || profile.name.length < 2}
              className="btn-primary mt-3 disabled:cursor-not-allowed disabled:opacity-50">
              {saveProfile.isPending && <Spinner />} Save clinic details
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 text-sm">
            <div><p className="text-ink-muted">Slug</p><p className="font-mono">{c.slug}</p></div>
            <div><p className="text-ink-muted">Email</p><p>{c.email || '—'}</p></div>
            <div><p className="text-ink-muted">Phone</p><p>{c.phone || '—'}</p></div>
            <div><p className="text-ink-muted">City</p><p>{c.address?.city || '—'}</p></div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Subscription</h3>
              <button
                onClick={() => onStatusChange.mutate({ id: c._id, isActive: !c.isActive })}
                className="btn-ghost text-xs"
              >
                {c.isActive ? 'Suspend clinic' : 'Reactivate clinic'}
              </button>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="plan">Plan</label>
                <select
                  id="plan"
                  className="field transition-colors duration-150"
                  value={draft.plan || ''}
                  onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
                  aria-label="Subscription plan">
                  {PLANS.map((p) => (
                    <option key={p} value={p}>{p.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="status">Status</label>
                <select
                  id="status"
                  className="field transition-colors duration-150"
                  value={draft.status || ''}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  aria-label="Subscription status">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={() => saveSubscription.mutate()}
              disabled={saveSubscription.isPending}
              className="btn-primary mt-3 disabled:cursor-not-allowed disabled:opacity-50">
              {saveSubscription.isPending && <Spinner />} Save subscription
            </button>
          </div>

          <div>
            <h3 className="font-display text-sm font-semibold">Staff ({c.users?.length || 0})</h3>
            <ul className="mt-2 divide-y divide-line">
              {c.users?.map((u) => (
                <li key={u._id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-ink-muted">{u.email}</p>
                  </div>
                  <span className="text-xs text-ink-muted">{u.role.replace('_', ' ')}</span>
                </li>
              ))}
              {!c.users?.length && <p className="py-2 text-sm text-ink-muted">No staff yet.</p>}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Branches', activity.data?.branches?.length || 0],
              ['Doctors', activity.data?.doctors?.length || 0],
              ['Patients', activity.data?.patientCount ?? 0],
              ['Appointments', activity.data?.appointmentCount ?? 0],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-paper-sunk p-3"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 font-display text-lg font-semibold">{value}</p></div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
