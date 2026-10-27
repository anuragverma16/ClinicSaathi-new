import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  UserPlus, GitBranch, Stethoscope, ClipboardCheck, Calculator, FlaskConical, Check, Eye, EyeOff, Wand2, Copy,
  Mail, Phone, User, KeyRound, ShieldCheck, Search, CheckCircle2,
} from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Drawer, Field, fieldErrors } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { ROLE_LABEL } from '../../routes/nav.js';
import { relative } from '../../lib/format.js';

// Every role a clinic owner can add. Class strings are written out in full so Tailwind keeps them.
const ROLE_META = {
  DOCTOR: { icon: Stethoscope, help: 'Own schedule, queue and patients; writes notes, prescriptions and lab orders.', tile: 'bg-sky-50 text-sky-600', ring: 'ring-sky-500', badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
  RECEPTIONIST: { icon: ClipboardCheck, help: 'Bookings, registration, check-in and the waiting queue. No clinical notes.', tile: 'bg-teal-50 text-teal-600', ring: 'ring-teal-500', badge: 'bg-teal-50 text-teal-700 ring-teal-200' },
  BRANCH_MANAGER: { icon: GitBranch, help: 'Runs one branch: its appointments, queue, schedules and reports.', tile: 'bg-violet-50 text-violet-600', ring: 'ring-violet-500', badge: 'bg-violet-50 text-violet-700 ring-violet-200' },
  ACCOUNTANT: { icon: Calculator, help: 'Invoices, payments, refunds, GST and financial reports.', tile: 'bg-amber-50 text-amber-600', ring: 'ring-amber-500', badge: 'bg-amber-50 text-amber-700 ring-amber-200' },
  LAB_TECHNICIAN: { icon: FlaskConical, help: 'Lab worklist; uploads results for the doctor to verify.', tile: 'bg-rose-50 text-rose-600', ring: 'ring-rose-500', badge: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
const ROLES = Object.keys(ROLE_META);
const OWNER_BADGE = 'bg-navy/5 text-ink ring-line';

const STRONG = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A readable temporary password that always passes the server's letter + number rule. */
function makePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return `${Array.from({ length: 6 }, () => pick(letters)).join('')}${Array.from({ length: 3 }, () => pick('23456789')).join('')}${pick('@#$%')}`;
}

function RoleBadge({ role }) {
  const m = ROLE_META[role];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${m?.badge || OWNER_BADGE}`}>
      {m && <m.icon className="h-3.5 w-3.5" />} {ROLE_LABEL[role]}
    </span>
  );
}

/** Titled group inside the form. */
function FormBlock({ step, title, children }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2.5 text-sm font-semibold text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pulse/10 text-xs font-bold text-pulse-deep">{step}</span>
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Input with a leading icon. */
function IconInput({ icon: Icon, className = '', ...props }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted/70" />
      <input {...props} className={`field pl-9 ${className}`} />
    </div>
  );
}

function PasswordInput({ value, onChange, id }) {
  const [show, setShow] = useState(true);
  const copy = () => navigator.clipboard?.writeText(value).then(() => toast.success('Password copied'), () => {});
  return (
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted/70" />
        <input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" className="field pl-9 pr-10 font-mono"
               value={value} onChange={(e) => onChange(e.target.value)} placeholder="8+ characters, a letter and a number" />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <button type="button" className="btn-ghost px-3" onClick={() => onChange(makePassword())} title="Generate a password"><Wand2 className="h-4 w-4" /><span className="hidden sm:inline">Generate</span></button>
      <button type="button" className="btn-ghost px-3" disabled={!value} onClick={copy} aria-label="Copy password"><Copy className="h-4 w-4" /></button>
    </div>
  );
}

/** Shown after creating an account, so the owner can hand over the sign-in details. */
function CreatedCard({ created, onDone, onAnother }) {
  const text = `ClinicSaathi sign-in\nURL: ${window.location.origin}/login\nEmail: ${created.email}\nTemporary password: ${created.password}`;
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></span>
      <h3 className="mt-4 font-display text-xl font-semibold text-ink">{created.name} is added</h3>
      <div className="mt-2"><RoleBadge role={created.role} /></div>
      <p className="mt-3 max-w-sm text-sm text-ink-muted">Share these sign-in details privately. Ask them to change the password after their first sign-in.</p>
      <dl className="mt-5 w-full max-w-sm divide-y divide-line rounded-xl border border-line bg-paper text-left text-sm">
        <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-ink-muted">Email</dt><dd className="truncate font-medium text-ink">{created.email}</dd></div>
        <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-ink-muted">Password</dt><dd className="font-mono font-medium text-ink">{created.password}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Sign-in details copied'), () => {})}><Copy className="h-4 w-4" /> Copy details</button>
        <button className="btn-ghost" onClick={onAnother}><UserPlus className="h-4 w-4" /> Add another</button>
        <button className="btn-primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function StaffForm({ member, onClose, onAnother }) {
  const qc = useQueryClient();
  const isNew = !member?._id;
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap) });
  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get('/doctors', { params: { active: 'all' } }).then(unwrap) });
  const [f, setF] = useState({
    name: member?.name || '', email: member?.email || '', phone: member?.phone || '', role: member?.role || 'DOCTOR',
    branchId: member?.branchId?._id || '', doctorId: member?.doctorId?._id || '', password: isNew ? makePassword() : '', isActive: member?.isActive ?? true,
    doctorMode: isNew ? 'new' : 'link', specialization: '', qualification: '', registrationNumber: '', consultationFee: '',
  });
  const [errors, setErrors] = useState({});
  const [created, setCreated] = useState(null);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const freeDoctors = (doctors.data || []).filter((d) => !d.userId || d.userId === member?._id);
  const isDoctor = f.role === 'DOCTOR';
  const newProfile = isNew && isDoctor && f.doctorMode === 'new';

  const validate = () => {
    const e = {};
    if (f.name.trim().length < 2) e.name = 'Enter their full name';
    if (isNew && !EMAIL.test(f.email.trim())) e.email = 'Enter a valid email; they sign in with it';
    if (f.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a 10-digit mobile number';
    if (f.role === 'BRANCH_MANAGER' && !f.branchId) e.branchId = 'A branch manager needs a branch';
    if (isNew && !STRONG.test(f.password)) e.password = 'At least 8 characters with a letter and a number';
    if (isDoctor && f.doctorMode === 'link' && !f.doctorId && isNew) e.doctorId = 'Choose the doctor profile this login belongs to';
    if (newProfile && f.consultationFee !== '' && Number(f.consultationFee) < 0) e.consultationFee = 'Fee cannot be negative';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = useMutation({
    mutationFn: () => {
      const doctorId = isDoctor && f.doctorMode === 'link' ? f.doctorId || undefined : undefined;
      if (!isNew) {
        return api.patch(`/clinics/staff/${member._id}`, {
          name: f.name, phone: f.phone, role: f.role, branchId: f.branchId || null, doctorId: isDoctor ? f.doctorId || null : null, isActive: f.isActive,
        });
      }
      return api.post('/clinics/staff', {
        name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), role: f.role, password: f.password,
        branchId: f.branchId || undefined, doctorId,
        ...(newProfile ? { newDoctor: {
          specialization: f.specialization || undefined, qualification: f.qualification || undefined,
          registrationNumber: f.registrationNumber || undefined, consultationFee: f.consultationFee === '' ? undefined : Number(f.consultationFee),
        } } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      if (isDoctor) qc.invalidateQueries({ queryKey: ['doctors'] });
      if (isNew) setCreated({ name: f.name.trim(), email: f.email.trim(), password: f.password, role: f.role });
      else { toast.success('Staff updated'); onClose(); }
    },
    onError: (e) => {
      const fe = fieldErrors(e);
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace('newDoctor.', ''), v])));
      toast.error(e.message);
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/clinics/staff/${member._id}/reset-password`, { password: f.password }),
    onSuccess: () => { toast.success('Password reset; their other sessions were signed out'); },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => validate() && save.mutate();
  const RoleIcon = ROLE_META[f.role]?.icon || User;

  if (created) {
    return (
      <Drawer open onClose={onClose} title="Account created" width="max-w-2xl">
        <CreatedCard created={created} onDone={onClose} onAnother={onAnother} />
      </Drawer>
    );
  }

  return (
    <Drawer open onClose={onClose} width="max-w-2xl"
      title={isNew ? 'Add a team member' : member.name}
      subtitle={isNew ? 'Create a sign-in for someone at your clinic.' : `${ROLE_LABEL[member.role]} · ${member.email}`}
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex"><RoleIcon className="h-3.5 w-3.5" /> {ROLE_LABEL[f.role]}{f.branchId ? ` · ${branches.data?.find((b) => b._id === f.branchId)?.name || ''}` : ' · All branches'}</p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={save.isPending} onClick={submit}>{save.isPending && <Spinner />} {isNew ? 'Create account' : 'Save changes'}</button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <FormBlock step={1} title="Role">
          <div role="radiogroup" aria-label="Role" className="grid gap-2.5 sm:grid-cols-2">
            {ROLES.map((r) => {
              const m = ROLE_META[r];
              const on = f.role === r;
              return (
                <button key={r} type="button" role="radio" aria-checked={on} onClick={() => set('role', r)}
                        className={`relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150 ${on ? `border-transparent bg-surface ring-2 ${m.ring} shadow-card` : 'border-line hover:border-ink-muted/40 hover:bg-paper'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${m.tile}`}><m.icon className="h-[18px] w-[18px]" /></span>
                  <span className="min-w-0 pr-5">
                    <span className="block text-sm font-semibold text-ink">{ROLE_LABEL[r]}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{m.help}</span>
                  </span>
                  {on && <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-pulse text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>}
                </button>
              );
            })}
          </div>
        </FormBlock>

        <FormBlock step={2} title="Personal details">
          <Field label="Full name" htmlFor="s-name" error={errors.name}>
            <IconInput icon={User} id="s-name" placeholder={isDoctor ? 'e.g. Dr Priya Sharma' : 'e.g. Rahul Verma'} value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email (used to sign in)" htmlFor="s-email" error={errors.email} hint={isNew ? undefined : 'Sign-in email cannot be changed.'}>
              <IconInput icon={Mail} id="s-email" type="email" placeholder="name@clinic.com" disabled={!isNew} value={f.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Mobile number" htmlFor="s-phone" error={errors.phone}>
              <IconInput icon={Phone} id="s-phone" type="tel" inputMode="numeric" placeholder="98765 43210" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
        </FormBlock>

        <FormBlock step={3} title="Access">
          <Field label={f.role === 'BRANCH_MANAGER' ? 'Branch' : 'Branch (optional)'} htmlFor="s-branch" error={errors.branchId}
                 hint={f.role === 'BRANCH_MANAGER' ? 'Managers only see this branch.' : 'Leave on "All branches" unless they work at one location only.'}>
            <select id="s-branch" className="field" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
              <option value="">{f.role === 'BRANCH_MANAGER' ? 'Choose a branch' : 'All branches'}</option>
              {branches.data?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </Field>
          {f.role === 'BRANCH_MANAGER' && branches.data && !branches.data.length && (
            <p className="rounded-lg bg-signal-soft px-3 py-2 text-xs text-signal">Add a branch on the Branch Management page first, then create the manager.</p>
          )}

          {isNew ? (
            <Field label="Temporary password" htmlFor="s-pw" error={errors.password} hint="We generated one for you. You'll see it again after saving so you can share it.">
              <PasswordInput id="s-pw" value={f.password} onChange={(v) => set('password', v)} />
            </Field>
          ) : (
            <>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line p-3">
                <span>
                  <span className="block text-sm font-medium text-ink">Account active</span>
                  <span className="block text-xs text-ink-muted">Turning this off signs them out everywhere.</span>
                </span>
                <span className="relative inline-flex">
                  <input type="checkbox" className="peer sr-only" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                  <span className="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-pulse peer-focus-visible:ring-2 peer-focus-visible:ring-pulse/40" />
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
              <div className="rounded-xl border border-line p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><ShieldCheck className="h-4 w-4 text-ink-muted" /> Reset password</p>
                <PasswordInput id="s-reset" value={f.password} onChange={(v) => set('password', v)} />
                <button className="btn-ghost btn-sm mt-2" disabled={!STRONG.test(f.password) || reset.isPending} onClick={() => reset.mutate()}>
                  {reset.isPending && <Spinner />} Reset password
                </button>
              </div>
            </>
          )}
        </FormBlock>

        {isDoctor && (
          <FormBlock step={4} title="Doctor profile">
            {isNew && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper-sunk p-1 text-sm font-medium">
                {[['new', 'Create new profile'], ['link', 'Link existing profile']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set('doctorMode', v)}
                          className={`rounded-lg py-2 transition-colors ${f.doctorMode === v ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'}`}>{l}</button>
                ))}
              </div>
            )}
            {newProfile ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Specialization" htmlFor="s-spec"><input id="s-spec" className="field" placeholder="e.g. General Physician" value={f.specialization} onChange={(e) => set('specialization', e.target.value)} /></Field>
                  <Field label="Qualification" htmlFor="s-qual"><input id="s-qual" className="field" placeholder="e.g. MBBS, MD" value={f.qualification} onChange={(e) => set('qualification', e.target.value)} /></Field>
                  <Field label="Registration number" htmlFor="s-reg" hint="Printed on prescriptions."><input id="s-reg" className="field" placeholder="State / NMC reg. no." value={f.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} /></Field>
                  <Field label="Consultation fee (₹)" htmlFor="s-fee" error={errors.consultationFee}><input id="s-fee" type="number" min="0" className="field" placeholder="500" value={f.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} /></Field>
                </div>
                <p className="text-xs text-ink-muted">You can set working hours and slots later on the Doctors page.</p>
              </>
            ) : (
              <Field label="Doctor profile" htmlFor="s-doc" error={errors.doctorId} hint="This login acts as the chosen doctor for schedules, notes and prescriptions.">
                <select id="s-doc" className="field" value={f.doctorId} onChange={(e) => set('doctorId', e.target.value)}>
                  <option value="">{freeDoctors.length ? 'Choose a profile' : 'No unlinked profiles'}</option>
                  {freeDoctors.map((d) => <option key={d._id} value={d._id}>{d.name}{d.specialization ? ` · ${d.specialization}` : ''}</option>)}
                </select>
              </Field>
            )}
          </FormBlock>
        )}
      </div>
    </Drawer>
  );
}

export default function Staff({ title = 'Staff management', readOnly }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [q, setQ] = useState('');
  const canEdit = !readOnly && user?.role === 'CLINIC_OWNER';
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['staff'], queryFn: () => api.get('/clinics/staff').then(unwrap) });

  // ?add=DOCTOR — the dashboard's "Add staff" menu opens the form on that role.
  const [params, setParams] = useSearchParams();
  const addRole = params.get('add');
  useEffect(() => {
    if (!canEdit || !ROLES.includes(addRole)) return;
    setEditing({ role: addRole, _fresh: Date.now() });
    setParams((p) => { p.delete('add'); return p; }, { replace: true });
  }, [addRole, canEdit, setParams]);

  const counts = useMemo(() => (data || []).reduce((c, r) => ({ ...c, [r.role]: (c[r.role] || 0) + 1 }), {}), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data || []).filter((r) => (!roleFilter || r.role === roleFilter)
      && (!s || r.name.toLowerCase().includes(s) || r.email?.toLowerCase().includes(s) || r.phone?.includes(s)));
  }, [data, roleFilter, q]);

  const chips = [['', 'All', data?.length || 0], ...ROLES.map((r) => [r, ROLE_LABEL[r], counts[r] || 0])];

  return (
    <div>
      <PageHeader title={title} description={canEdit ? 'Add your doctors, lab technicians, branch managers, accountants and receptionists. Each person sees only what their role allows.' : 'Team members assigned to your branch.'}
        actions={canEdit && <button className="btn-primary" onClick={() => setEditing({})}><UserPlus className="h-4 w-4" /> Add team member</button>} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {chips.map(([value, label, n]) => {
            const on = roleFilter === value;
            return (
              <button key={value || 'all'} onClick={() => setRoleFilter(value)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? 'border-transparent bg-navy text-white' : 'border-line bg-surface text-ink-soft hover:bg-paper-sunk'}`}>
                {label}<span className={`rounded-full px-1.5 text-[11px] ${on ? 'bg-white/20' : 'bg-paper-sunk text-ink-muted'}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input className="field pl-9" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" />
        </div>
      </div>

      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={rows} onRowClick={canEdit ? (r) => r.role !== 'CLINIC_OWNER' && setEditing(r) : undefined}
        empty={<EmptyState title={data?.length ? 'No one matches' : 'No staff yet'} body={data?.length ? 'Try another role or search.' : 'Add your doctors, lab technicians, branch managers, accountants and receptionists.'}
                           action={canEdit && !data?.length ? <button className="btn-primary" onClick={() => setEditing({})}><UserPlus className="h-4 w-4" /> Add team member</button> : undefined} />}
        columns={[
          { key: 'name', header: 'Name', sort: (r) => r.name, render: (r) => (
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${ROLE_META[r.role]?.tile || 'bg-navy/5 text-ink'}`}>{r.name?.[0]?.toUpperCase()}</span>
              <div className="min-w-0"><p className="truncate font-medium">{r.name}</p><p className="truncate text-xs text-ink-muted">{r.email}</p></div>
            </div>
          ) },
          { key: 'role', header: 'Role', sort: (r) => r.role, render: (r) => <RoleBadge role={r.role} /> },
          { key: 'branch', header: 'Branch', hideOnMobile: true, render: (r) => r.branchId?.name || 'All' },
          { key: 'doctor', header: 'Doctor profile', hideOnMobile: true, render: (r) => r.doctorId?.name || '—' },
          { key: 'last', header: 'Last sign-in', hideOnMobile: true, render: (r) => (r.lastLoginAt ? relative(r.lastLoginAt) : 'Never') },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
        ]}
      />
      {editing && <StaffForm key={editing._id || editing._fresh || 'new'} member={editing} onClose={() => setEditing(null)} onAnother={() => setEditing({ _fresh: Date.now() })} />}
    </div>
  );
}
