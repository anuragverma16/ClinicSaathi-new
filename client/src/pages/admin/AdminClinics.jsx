import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Ban, CheckCircle2, Plus, Building2, Check, Eye, EyeOff, Wand2, Copy } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { date } from '../../lib/format.js';
import { PageHeader, Field, FormSection, fieldErrors } from '../../components/ui/Page.jsx';

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

const PLAN_INFO = {
  STARTER: { price: '₹999', note: '1 doctor · booking & reminders' },
  GROWTH: { price: '₹2,999', note: '5 doctors · queue, billing, reports' },
  PRO: { price: '₹5,999', note: '25 doctors · AI & campaigns' },
  ENTERPRISE: { price: 'Custom', note: 'Unlimited doctors & branches' },
};
const STRONG_PW = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const genPassword = () => {
  const pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const l = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  return `${Array.from({ length: 6 }, () => pick(l)).join('')}${Array.from({ length: 3 }, () => pick('23456789')).join('')}${pick('@#$%')}`;
};

function CreateClinicModal({ open, onClose }) {
  const qc = useQueryClient();
  const empty = () => ({ name: '', email: '', phone: '', city: '', plan: 'STARTER', status: 'TRIALING', owner: { name: '', email: '', phone: '', password: genPassword() } });
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [showPw, setShowPw] = useState(true);
  const set = (key, value) => { setForm((c) => ({ ...c, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined })); };
  const setOwner = (key, value) => { setForm((c) => ({ ...c, owner: { ...c.owner, [key]: value } })); setErrors((e) => ({ ...e, [`owner.${key}`]: undefined })); };
  const close = () => { setForm(empty()); setErrors({}); onClose(); };

  const create = useMutation({
    mutationFn: () => api.post('/platform/clinics', form),
    onSuccess: () => {
      toast.success(`Clinic created. Owner signs in as ${form.owner.email}`);
      qc.invalidateQueries({ queryKey: ['platform'] });
      close();
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });

  const validate = () => {
    const e = {};
    const digits = (s) => s.replace(/\D/g, '').length;
    if (form.name.trim().length < 2) e.name = 'Enter the clinic name';
    if (form.email && !form.email.includes('@')) e.email = 'Enter a valid email or leave it blank';
    if (form.phone && digits(form.phone) < 10) e.phone = 'Enter a 10-digit number or leave it blank';
    if (form.owner.name.trim().length < 2) e['owner.name'] = 'Enter the owner name';
    if (digits(form.owner.phone) < 10) e['owner.phone'] = 'Enter a 10-digit mobile number';
    if (!form.owner.email.includes('@')) e['owner.email'] = 'The owner signs in with this email';
    if (!STRONG_PW.test(form.owner.password)) e['owner.password'] = 'At least 8 characters with a letter and a number';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const copyLogin = () => navigator.clipboard?.writeText(`ClinicSaathi sign-in\nURL: ${window.location.origin}/login\nEmail: ${form.owner.email}\nPassword: ${form.owner.password}`)
    .then(() => toast.success('Sign-in details copied'), () => {});

  return (
    <Modal open={open} onClose={close} width="max-w-2xl" icon={Building2}
      title="Create a clinic" subtitle="Set up the clinic, its plan and the owner's sign-in."
      footer={(
        <>
          <button onClick={close} className="btn-ghost">Cancel</button>
          <button onClick={() => validate() && create.mutate()} disabled={create.isPending} className="btn-primary">
            {create.isPending && <Spinner />} Create clinic
          </button>
        </>
      )}>
      <div className="space-y-5">
        <FormSection title="Clinic details" description="Shown to patients on booking pages and receipts.">
          <Field label="Clinic name" htmlFor="cname" error={errors.name} required>
            <input id="cname" className="field" placeholder="e.g. Aastha Clinic" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic email" htmlFor="cemail" error={errors.email} hint="Optional">
              <input id="cemail" type="email" className="field" placeholder="hello@clinic.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Clinic phone" htmlFor="cphone" error={errors.phone} hint="Optional">
              <input id="cphone" type="tel" inputMode="numeric" className="field" placeholder="98765 43210" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Plan" description="You can change the plan any time from the clinic's details.">
          <div role="radiogroup" aria-label="Plan" className="grid gap-2.5 sm:grid-cols-2">
            {PLANS.map((p) => {
              const on = form.plan === p;
              return (
                <button key={p} type="button" role="radio" aria-checked={on} onClick={() => set('plan', p)}
                        className={`relative rounded-xl border p-3 text-left transition-all ${on ? 'border-transparent bg-surface shadow-card ring-2 ring-pulse' : 'border-line bg-surface hover:border-ink-muted/40'}`}>
                  <span className="flex items-baseline justify-between gap-2 pr-6">
                    <span className="text-sm font-semibold text-ink">{p.charAt(0) + p.slice(1).toLowerCase()}</span>
                    <span className="text-sm font-semibold text-pulse-deep">{PLAN_INFO[p].price}<span className="text-xs font-normal text-ink-muted">{p === 'ENTERPRISE' ? '' : '/mo'}</span></span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{PLAN_INFO[p].note}</span>
                  {on && <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-pulse text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>}
                </button>
              );
            })}
          </div>
          <Field label="Subscription status" htmlFor="cstatus">
            <select id="cstatus" className="field" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</option>)}
            </select>
          </Field>
        </FormSection>

        <FormSection title="Clinic owner login" description="The owner signs in with these details, then adds their own doctors, staff and branches.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner name" htmlFor="oname" error={errors['owner.name']} required>
              <input id="oname" className="field" placeholder="e.g. Dr Anil Gupta" value={form.owner.name} onChange={(e) => setOwner('name', e.target.value)} />
            </Field>
            <Field label="Owner mobile" htmlFor="ophone" error={errors['owner.phone']} required>
              <input id="ophone" type="tel" inputMode="numeric" className="field" placeholder="98765 43210" value={form.owner.phone} onChange={(e) => setOwner('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="Owner email (used to sign in)" htmlFor="oemail" error={errors['owner.email']} required>
            <input id="oemail" type="email" autoComplete="off" className="field" placeholder="owner@clinic.com" value={form.owner.email} onChange={(e) => setOwner('email', e.target.value)} />
          </Field>
          <Field label="Temporary password" htmlFor="opass" error={errors['owner.password']} required hint="Generated for you. Copy the details and share them privately with the owner.">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input id="opass" type={showPw ? 'text' : 'password'} autoComplete="new-password" className="field pr-10 font-mono"
                       value={form.owner.password} onChange={(e) => setOwner('password', e.target.value)} />
                <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button type="button" className="btn-ghost px-3" onClick={() => setOwner('password', genPassword())} title="Generate a new password"><Wand2 className="h-4 w-4" /></button>
              <button type="button" className="btn-ghost px-3" onClick={copyLogin} title="Copy sign-in details"><Copy className="h-4 w-4" /></button>
            </div>
          </Field>
        </FormSection>
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
