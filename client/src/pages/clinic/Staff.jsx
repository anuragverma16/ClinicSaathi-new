import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserPlus } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Drawer, Field, fieldErrors } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { ROLE_LABEL } from '../../routes/nav.js';
import { relative } from '../../lib/format.js';

const ROLES = ['BRANCH_MANAGER', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECHNICIAN'];
const ROLE_HELP = {
  BRANCH_MANAGER: 'Runs one branch: its appointments, queue, schedules and reports.',
  DOCTOR: 'Sees their own schedule and patients; writes notes and prescriptions. Link to a doctor profile.',
  RECEPTIONIST: 'Books, registers, checks in and manages the queue. No clinical notes.',
  ACCOUNTANT: 'Invoices, payments, refunds and financial reports.',
  LAB_TECHNICIAN: 'Processes lab orders and uploads results for the doctor to verify.',
};

function StaffForm({ member, onClose }) {
  const qc = useQueryClient();
  const isNew = !member?._id;
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap) });
  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get('/doctors', { params: { active: 'all' } }).then(unwrap) });
  const [f, setF] = useState({
    name: member?.name || '', email: member?.email || '', phone: member?.phone || '', role: member?.role || 'RECEPTIONIST',
    branchId: member?.branchId?._id || '', doctorId: member?.doctorId?._id || '', password: '', isActive: member?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => (isNew
      ? api.post('/clinics/staff', { ...f, branchId: f.branchId || undefined, doctorId: f.role === 'DOCTOR' ? f.doctorId || undefined : undefined, isActive: undefined })
      : api.patch(`/clinics/staff/${member._id}`, { name: f.name, phone: f.phone, role: f.role, branchId: f.branchId || null, doctorId: f.role === 'DOCTOR' ? f.doctorId || null : null, isActive: f.isActive })),
    onSuccess: () => { toast.success(isNew ? 'Staff account created — share the password securely' : 'Staff updated'); qc.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/clinics/staff/${member._id}/reset-password`, { password: f.password }),
    onSuccess: () => { toast.success('Password reset; their other sessions were signed out'); set('password', ''); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Drawer open onClose={onClose} title={isNew ? 'Invite staff member' : member.name} subtitle={ROLE_HELP[f.role]}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} {isNew ? 'Create account' : 'Save changes'}</button></>}>
      <div className="space-y-4">
        <Field label="Full name" htmlFor="s-name" error={errors.name}><input id="s-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email (sign-in)" htmlFor="s-email" error={errors.email}><input id="s-email" type="email" className="field" disabled={!isNew} value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Mobile" htmlFor="s-phone" error={errors.phone}><input id="s-phone" type="tel" className="field" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="Role" htmlFor="s-role">
          <select id="s-role" className="field" value={f.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="Branch" htmlFor="s-branch" hint={f.role === 'BRANCH_MANAGER' ? 'Required — managers only see this branch.' : 'Optional — limits this person to one branch.'}>
          <select id="s-branch" className="field" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
            <option value="">All branches</option>{branches.data?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        </Field>
        {f.role === 'DOCTOR' && (
          <Field label="Doctor profile" htmlFor="s-doc" hint="The login acts as this doctor for schedules, notes and prescriptions.">
            <select id="s-doc" className="field" value={f.doctorId} onChange={(e) => set('doctorId', e.target.value)}>
              <option value="">Choose…</option>{doctors.data?.map((d) => <option key={d._id} value={d._id} disabled={d.userId && d.userId !== member?._id}>{d.name}{d.userId && d.userId !== member?._id ? ' (linked)' : ''}</option>)}
            </select>
          </Field>
        )}
        {isNew ? (
          <Field label="Temporary password" htmlFor="s-pw" error={errors.password} hint="At least 8 characters with a letter and a number. Ask them to change it after signing in.">
            <input id="s-pw" type="text" autoComplete="new-password" className="field font-mono" value={f.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Account active (unticking signs them out everywhere)</label>
            <div className="rounded-lg border border-line p-3">
              <p className="label">Reset password</p>
              <div className="flex gap-2">
                <input className="field font-mono" placeholder="New temporary password" value={f.password} onChange={(e) => set('password', e.target.value)} aria-label="New password" />
                <button className="btn-ghost" disabled={f.password.length < 8 || reset.isPending} onClick={() => reset.mutate()}>Reset</button>
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

export default function Staff({ title = 'Staff management', readOnly }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(null);
  const canEdit = !readOnly && user?.role === 'CLINIC_OWNER';
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['staff'], queryFn: () => api.get('/clinics/staff').then(unwrap) });
  return (
    <div>
      <PageHeader title={title} description={canEdit ? 'Invite your team and assign each person a role. Access is enforced by the server on every request.' : 'Team members assigned to your branch.'}
        actions={canEdit && <button className="btn-primary" onClick={() => setEditing({})}><UserPlus className="h-4 w-4" /> Invite staff</button>} />
      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={data} onRowClick={canEdit ? (r) => r.role !== 'CLINIC_OWNER' && setEditing(r) : undefined}
        empty={<EmptyState title="No staff yet" body="Invite your doctors, front desk and accounts team." />}
        columns={[
          { key: 'name', header: 'Name', sort: (r) => r.name, render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{r.email}</p></div> },
          { key: 'role', header: 'Role', sort: (r) => r.role, render: (r) => ROLE_LABEL[r.role] },
          { key: 'branch', header: 'Branch', hideOnMobile: true, render: (r) => r.branchId?.name || 'All' },
          { key: 'doctor', header: 'Doctor profile', hideOnMobile: true, render: (r) => r.doctorId?.name || '—' },
          { key: 'last', header: 'Last sign-in', hideOnMobile: true, render: (r) => relative(r.lastLoginAt) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
        ]}
      />
      {editing && <StaffForm member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
