import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, Plus, Ban, CheckCircle2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { date } from '../../lib/format.js';
import { PageHeader } from '../../components/ui/Page.jsx';

const ROLES = ['CLINIC_OWNER', 'BRANCH_MANAGER', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT', 'LAB_TECHNICIAN', 'PATIENT'];
// Every panel login belongs to a clinic. Super admin is predefined; patients sign in by OTP.
const CREATABLE_ROLES = ROLES.filter((r) => !['SUPER_ADMIN', 'PATIENT'].includes(r));
const ROLE_HINT = {
  CLINIC_OWNER: 'Full control of the clinic: doctors, staff, branches, billing and settings.',
  BRANCH_MANAGER: 'Runs one branch — appointments, queue, schedules and branch reports.',
  DOCTOR: 'Gets a linked doctor profile: queue, consultations, prescriptions and lab orders.',
  RECEPTIONIST: 'Front desk — bookings, walk-ins, check-in and the waiting queue.',
  ACCOUNTANT: 'Invoices, payments, refunds, GST and financial reports.',
  LAB_TECHNICIAN: 'Lab worklist and result submission.',
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ['platform', 'users', q, role],
    queryFn: () => api.get('/platform/users', { params: { ...(q ? { q } : {}), ...(role ? { role } : {}) } }).then((r) => r.data.data),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/platform/users/${id}/status`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'users'] }),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Users and roles" description="Every login on the platform. Create clinic owners, branch managers, doctors, front desk, accounts and lab users." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email"
              className="field pl-9 transition-colors duration-150"
              aria-label="Search users" />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="field w-auto transition-colors duration-150"
            aria-label="Filter by role">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> New user
        </button>
      </div>

      <DataTable
        loading={users.isLoading}
        error={users.error}
        onRetry={users.refetch}
        rows={users.data}
        onRowClick={setEditUser}
        columns={[
          {
            key: 'name', header: 'User', render: (r) => (
              <div>
                <p className="font-medium text-ink">{r.name}</p>
                <p className="text-xs text-ink-muted">{r.email}</p>
              </div>
            ),
          },
          { key: 'role', header: 'Role', render: (r) => r.role.replace('_', ' ') },
          { key: 'phone', header: 'Phone', hideOnMobile: true, render: (r) => r.phone || '—' },
          { key: 'branch', header: 'Branch', hideOnMobile: true, render: (r) => r.branchId?.name || '—' },
          { key: 'clinic', header: 'Clinic', hideOnMobile: true, render: (r) => r.clinicId?.name || '—' },
          { key: 'createdAt', header: 'Joined', hideOnMobile: true, render: (r) => date(r.createdAt) },
          { key: 'lastLoginAt', header: 'Last login', hideOnMobile: true, render: (r) => r.lastLoginAt ? date(r.lastLoginAt) : 'Never' },
          {
            key: 'active', header: 'Status',
            render: (r) => (
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${r.isActive ? 'text-pulse-deep' : 'text-alert'}`}>
                {r.isActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                {r.isActive ? 'Active' : 'Deactivated'}
              </span>
            ),
          },
          {
            key: 'actions', header: '',
            render: (r) => r._id === me?._id ? (
              <span className="text-xs text-ink-muted">You</span>
            ) : (
              <div className="flex justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); setResetUser(r); }} className="btn-ghost text-xs">Reset access</button>
                <button onClick={(e) => { e.stopPropagation(); setStatus.mutate({ id: r._id, isActive: !r.isActive }); }} disabled={setStatus.isPending} className="btn-ghost text-xs">{r.isActive ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            ),
          },
        ]}
      />

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ResetAccessModal user={resetUser} onClose={() => setResetUser(null)} />
      <EditUserModal user={editUser} onClose={() => setEditUser(null)} />
    </div>
  );
}

function EditUserModal({ user, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '', role: '' });

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name || '',
        phone: user.phone || '',
        role: user.role || '',
      });
    } else {
      setForm({ name: '', phone: '', role: '' });
    }
  }, [user]);

  const save = useMutation({
    mutationFn: () => api.patch(`/platform/users/${user._id}`, form),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      setForm({ name: '', phone: '', role: '' });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const isFormValid = form.name.length >= 2 && form.phone.length >= 10;

  return (
    <Modal
      open={Boolean(user)}
      onClose={() => {
        setForm({ name: '', phone: '', role: '' });
        onClose();
      }}
      title="Edit user"
      footer={(
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !isFormValid}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {save.isPending && <Spinner />} Save changes
          </button>
        </>
      )}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="field transition-colors duration-150"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="User name" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="field transition-colors duration-150"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            aria-label="User phone" />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="field transition-colors duration-150"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            aria-label="User role">
            {ROLES.map((role) => (
              <option key={role} value={role}>{role.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <p className="text-sm text-ink-muted">
          {user?.email} · {user?.clinicId?.name || 'Platform'}
        </p>
      </div>
    </Modal>
  );
}

function ResetAccessModal({ user, onClose }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => api.post(`/platform/users/${user._id}/reset-access`, { password }),
    onSuccess: () => {
      toast.success('Access reset');
      qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      setPassword('');
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      title="Reset access"
      footer={(
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => reset.mutate()}
            disabled={password.length < 8 || reset.isPending}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {reset.isPending && <Spinner />} Reset access
          </button>
        </>
      )}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          Set a new password for <strong>{user?.name}</strong>. Existing sign-in sessions will be invalidated.
        </p>
        <div>
          <label className="label" htmlFor="pwd">New password</label>
          <input
            id="pwd"
            type="password"
            className="field transition-colors duration-150"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            aria-label="New password" />
        </div>
      </div>
    </Modal>
  );
}

function CreateUserModal({ open, onClose }) {
  const qc = useQueryClient();
  const empty = { name: '', email: '', phone: '', password: '', role: 'RECEPTIONIST', clinicId: '', branchId: '', specialization: '', consultationFee: '' };
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const clinics = useQuery({
    queryKey: ['platform', 'clinics', 'all'],
    queryFn: () => api.get('/platform/clinics', { params: { limit: 100 } }).then((r) => r.data.data),
    enabled: open,
  });

  const branches = useQuery({
    queryKey: ['platform', 'branches'],
    queryFn: () => api.get('/platform/branches').then((r) => r.data.data),
    enabled: open,
  });
  const clinicBranches = (branches.data || []).filter((b) => String(b.clinicId) === form.clinicId && b.isActive !== false);

  const create = useMutation({
    mutationFn: () => {
      const { consultationFee, specialization, branchId, ...rest } = form;
      return api.post('/platform/users', {
        ...rest,
        ...(branchId ? { branchId } : {}),
        ...(form.role === 'DOCTOR' ? { specialization: specialization || undefined, consultationFee: consultationFee === '' ? undefined : Number(consultationFee) } : {}),
      });
    },
    onSuccess: () => {
      toast.success('User created');
      qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
      setForm(empty);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = form.name.length > 1 && form.email.includes('@')
    && form.phone.length >= 10 && /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(form.password) && form.clinicId
    && (form.role !== 'BRANCH_MANAGER' || form.branchId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a user"
      footer={(
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={!canSubmit || create.isPending}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {create.isPending && <Spinner />} Create user
          </button>
        </>
      )}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="uname">Name</label>
            <input
              id="uname"
              className="field transition-colors duration-150"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              aria-label="User full name" />
          </div>
          <div>
            <label className="label" htmlFor="uphone">Mobile number</label>
            <input
              id="uphone"
              type="tel"
              className="field transition-colors duration-150"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              aria-label="User phone number" />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="uemail">Email</label>
          <input
            id="uemail"
            type="email"
            className="field transition-colors duration-150"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            aria-label="User email address" />
        </div>

        <div>
          <label className="label" htmlFor="upass">Password</label>
          <input
            id="upass"
            type="password"
            className="field transition-colors duration-150"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder="8+ characters with a letter and a number"
            aria-label="User password" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="urole">Role</label>
            <select
              id="urole"
              className="field transition-colors duration-150"
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
              aria-label="User role">
              {CREATABLE_ROLES.map((r) => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="uclinic">Clinic</label>
            <select
              id="uclinic"
              className="field transition-colors duration-150"
              value={form.clinicId}
              onChange={(e) => setForm((f) => ({ ...f, clinicId: e.target.value, branchId: '' }))}
              aria-label="Select clinic">
              <option value="">Choose a clinic</option>
              {clinics.isLoading ? (
                <option disabled>Loading clinics...</option>
              ) : (
                clinics.data?.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))
              )}
            </select>
          </div>
        </div>
        {ROLE_HINT[form.role] && <p className="-mt-1 text-xs text-ink-muted">{ROLE_HINT[form.role]}</p>}

        {form.clinicId && (
          <div>
            <label className="label" htmlFor="ubranch">Branch{form.role === 'BRANCH_MANAGER' ? '' : ' (optional)'}</label>
            <select id="ubranch" className="field" value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
              <option value="">{clinicBranches.length ? 'All branches / main' : 'This clinic has no branches yet'}</option>
              {clinicBranches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
            {form.role === 'BRANCH_MANAGER' && !clinicBranches.length && (
              <p className="mt-1 text-xs text-alert">Ask the clinic owner to add a branch first, then create the branch manager.</p>
            )}
          </div>
        )}

        {form.role === 'DOCTOR' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="uspec">Specialization</label>
              <input id="uspec" className="field" placeholder="e.g. General Physician" value={form.specialization} onChange={(e) => set('specialization', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ufee">Consultation fee (₹)</label>
              <input id="ufee" type="number" min="0" className="field" value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
