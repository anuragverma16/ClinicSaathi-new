import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, MapPin, Phone, Clock, Users, Calendar, IndianRupee, ChevronDown, MoreVertical } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Field, Section, fieldErrors, Tabs, Drawer } from '../../components/ui/Page.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { inr } from '../../lib/format.js';

// Branch form component for Add/Edit
export function BranchForm({ branch, clinics, managers, onClose, limited }) {
  const qc = useQueryClient();
  const isNew = !branch?._id;
  const [f, setF] = useState({
    name: branch?.name || '',
    code: branch?.code || '',
    phone: branch?.phone || '',
    email: branch?.email || '',
    address: {
      line1: branch?.address?.line1 || '',
      city: branch?.address?.city || '',
      state: branch?.address?.state || '',
      pincode: branch?.address?.pincode || '',
    },
    timings: {
      workingDays: branch?.timings?.workingDays || [1, 2, 3, 4, 5],
      openTime: branch?.timings?.openTime || '09:00',
      closeTime: branch?.timings?.closeTime || '19:00',
    },
    isActive: branch?.isActive ?? true,
    managerUserId: branch?.managerUserId || '',
  });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: () => {
      const payload = isNew ? f : (limited ? { phone: f.phone, email: f.email, address: f.address, timings: f.timings } : f);
      return isNew ? api.post('/clinics/branches', payload) : api.patch(`/clinics/branches/${branch._id}`, payload);
    },
    onSuccess: () => {
      toast.success('Branch saved');
      qc.invalidateQueries({ queryKey: ['branches'] });
      onClose?.();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(e.message);
    },
  });

  const body = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {!limited && (
          <>
            <Field label="Branch name" htmlFor="b-name" error={errors.name} required>
              <input id="b-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Code" htmlFor="b-code" error={errors.code}>
              <input id="b-code" className="field" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g., LK001" />
            </Field>
          </>
        )}
        <Field label="Phone" htmlFor="b-phone" error={errors.phone} required>
          <input id="b-phone" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="b-email" error={errors.email}>
          <input id="b-email" type="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address" htmlFor="b-addr" error={errors['address.line1']} required>
          <input id="b-addr" className="field" value={f.address.line1} onChange={(e) => setF({ ...f, address: { ...f.address, line1: e.target.value } })} />
        </Field>
        <Field label="City" htmlFor="b-city" error={errors['address.city']} required>
          <input id="b-city" className="field" value={f.address.city} onChange={(e) => setF({ ...f, address: { ...f.address, city: e.target.value } })} />
        </Field>
        <Field label="State" htmlFor="b-state" error={errors['address.state']} required>
          <input id="b-state" className="field" value={f.address.state} onChange={(e) => setF({ ...f, address: { ...f.address, state: e.target.value } })} />
        </Field>
        <Field label="Pincode" htmlFor="b-pin" error={errors['address.pincode']} required>
          <input id="b-pin" className="field" value={f.address.pincode} onChange={(e) => setF({ ...f, address: { ...f.address, pincode: e.target.value } })} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opening time" htmlFor="b-open" error={errors['timings.openTime']} required>
          <input id="b-open" type="time" className="field" value={f.timings.openTime} onChange={(e) => setF({ ...f, timings: { ...f.timings, openTime: e.target.value } })} />
        </Field>
        <Field label="Closing time" htmlFor="b-close" error={errors['timings.closeTime']} required>
          <input id="b-close" type="time" className="field" value={f.timings.closeTime} onChange={(e) => setF({ ...f, timings: { ...f.timings, closeTime: e.target.value } })} />
        </Field>
      </div>

      {!limited && (
        <Field label="Status" htmlFor="b-status">
          <select id="b-status" className="field" value={f.isActive ? 'active' : 'inactive'} onChange={(e) => setF({ ...f, isActive: e.target.value === 'active' })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      )}
    </div>
  );

  const button = (
    <button className="btn-primary" disabled={save.isPending || (!limited && f.name.trim().length < 2)} onClick={() => save.mutate()}>
      {save.isPending && <Spinner />} {isNew ? 'Create Branch' : 'Save branch'}
    </button>
  );
  if (!onClose) return <div className="space-y-4">{body}<div className="flex justify-end">{button}</div></div>;
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add new branch' : 'Edit branch'} width="max-w-2xl" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>{button}</>}>
      {body}
    </Modal>
  );
}

// Branch details drawer
function BranchDetailsDrawer({ branch, open, onClose, onEdit }) {
  const [tab, setTab] = useState('overview');
  if (!branch) return null;

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'doctors', label: 'Doctors' },
    { value: 'staff', label: 'Staff' },
    { value: 'patients', label: 'Patients' },
    { value: 'appointments', label: 'Appointments' },
    { value: 'queue', label: 'Queue' },
    { value: 'billing', label: 'Billing' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={branch.name}
      subtitle={branch.address?.city || 'Branch details'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={() => { onEdit(branch); onClose(); }}>Edit</button>
        </>
      }
    >
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard label="Total Patients" value={branch.patientCount || 0} />
            <KpiCard label="Today's Appointments" value={branch.todayAppointments || 0} />
            <KpiCard label="Today's Revenue" value={branch.todayRevenue || 0} format={inr} />
            <KpiCard label="Avg Waiting Time" value={branch.avgWaitingTime || 0} suffix=" min" />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Working Hours</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-muted">Monday – Friday</span><span className="font-medium">{branch.timings?.openTime}–{branch.timings?.closeTime}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Saturday</span><span className="font-medium">{branch.timings?.openTime}–{branch.timings?.closeTime}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Sunday</span><span className="font-medium">Closed</span></div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Location</h3>
            <div className="space-y-2 text-sm">
              <p className="text-ink-soft">{branch.address?.line1}</p>
              <p className="text-ink-soft">{branch.address?.city}, {branch.address?.state} {branch.address?.pincode}</p>
              <a href="#" className="text-pulse-deep hover:underline">View on Map</a>
            </div>
          </div>
        </div>
      )}

      {tab === 'doctors' && <div className="text-sm text-ink-muted">Doctors for this branch</div>}
      {tab === 'staff' && <div className="text-sm text-ink-muted">Staff for this branch</div>}
      {tab === 'patients' && <div className="text-sm text-ink-muted">Patients for this branch</div>}
      {tab === 'appointments' && <div className="text-sm text-ink-muted">Appointments for this branch</div>}
      {tab === 'queue' && <div className="text-sm text-ink-muted">Queue for this branch</div>}
      {tab === 'billing' && <div className="text-sm text-ink-muted">Billing information</div>}
      {tab === 'analytics' && <div className="text-sm text-ink-muted">Analytics and performance</div>}
      {tab === 'settings' && <div className="text-sm text-ink-muted">Branch settings</div>}
    </Drawer>
  );
}

// Branch performance for the last 30 days
export function BranchReport() {
  const r = useQuery({ queryKey: ['branches', 'report'], queryFn: () => api.get('/clinics/branches/report').then(unwrap) });
  return (
    <DataTable
      loading={r.isLoading}
      error={r.error}
      rows={r.data?.branches}
      rowKey={(x) => x.branchId || 'none'}
      empty={<EmptyState title="No activity in the last 30 days" />}
      columns={[
        { key: 'name', header: 'Branch', render: (x) => <span className="font-medium">{x.name}</span> },
        { key: 'appointments', header: 'Appointments', sort: (x) => x.appointments },
        { key: 'completed', header: 'Completed' },
        { key: 'cancelled', header: 'Cancelled', hideOnMobile: true },
        { key: 'noShows', header: 'No-shows', hideOnMobile: true },
        { key: 'collections', header: 'Collections', sort: (x) => x.collections, render: (x) => inr(x.collections) },
      ]}
    />
  );
}

export default function Branches() {
  const { entitlements } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [filters, setFilters] = useState({ search: '', clinic: '', city: '', status: '', manager: '' });

  const list = useQuery({ queryKey: ['branches', 'all'], queryFn: () => api.get('/clinics/branches', { params: { all: 'true' } }).then(unwrap) });
  const clinics = useQuery({ queryKey: ['clinics'], queryFn: () => api.get('/clinics').then(unwrap) });
  const staff = useQuery({ queryKey: ['clinic', 'staff'], queryFn: () => api.get('/clinics/staff').then(unwrap) });

  const toggle = useMutation({
    mutationFn: (b) => api.patch(`/clinics/branches/${b._id}`, { isActive: !b.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => toast.error(e.message),
  });

  const limit = entitlements?.limits?.maxBranches;
  const active = list.data?.filter((b) => b.isActive).length || 0;

  // Filter and search branches
  const filteredBranches = useMemo(() => {
    if (!list.data) return [];
    return list.data.filter((b) => {
      const searchMatch = !filters.search || b.name.toLowerCase().includes(filters.search.toLowerCase()) || b.address?.city?.toLowerCase().includes(filters.search.toLowerCase());
      const statusMatch = !filters.status || (filters.status === 'active' ? b.isActive : !b.isActive);
      return searchMatch && statusMatch;
    });
  }, [list.data, filters]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!list.data) return { total: 0, active: 0, inactive: 0, doctors: 0, appointments: 0, revenue: 0 };
    const total = list.data.length;
    const active = list.data.filter((b) => b.isActive).length;
    const inactive = total - active;
    return {
      total,
      active,
      inactive,
      doctors: list.data.reduce((sum, b) => sum + (b.doctorCount || 0), 0),
      appointments: list.data.reduce((sum, b) => sum + (b.todayAppointments || 0), 0),
      revenue: list.data.reduce((sum, b) => sum + (b.todayRevenue || 0), 0),
    };
  }, [list.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Every location across all clinics. Branch details are managed by each clinic owner."
        actions={<button className="btn-primary" disabled={limit != null && active >= limit} onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Add Branch</button>}
      >
        {limit != null && <p className="mt-1 text-xs text-ink-muted">{active} of {limit} branches on your plan{active >= limit ? ' — upgrade to Enterprise for more' : ''}</p>}
      </PageHeader>

      {/* Statistics cards */}
      <KpiGrid cols="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Branches" value={stats.total} hint="All clinics" />
        <KpiCard label="Active Branches" value={stats.active} hint="Currently operational" tone="teal" />
        <KpiCard label="Inactive Branches" value={stats.inactive} hint="Temporarily closed" tone="amber" />
        <KpiCard icon={Users} label="Total Doctors" value={stats.doctors} hint="Across all branches" />
        <KpiCard icon={Calendar} label="Today's Appointments" value={stats.appointments} hint="All branches" tone="navy" />
        <KpiCard icon={IndianRupee} label="Today's Revenue" value={stats.revenue} format={inr} hint="All branches" tone="teal" />
      </KpiGrid>

      {/* Search and filters */}
      <Section title="Search & Filters">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Search branches by name, city, manager..."
            className="field w-full"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Clinic</label>
              <select className="field" value={filters.clinic} onChange={(e) => setFilters({ ...filters, clinic: e.target.value })}>
                <option value="">All Clinics</option>
              </select>
            </div>
            <div>
              <label className="label">City</label>
              <select className="field" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
                <option value="">All Cities</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="field" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label className="label">Branch Manager</label>
              <select className="field" value={filters.manager} onChange={(e) => setFilters({ ...filters, manager: e.target.value })}>
                <option value="">All Managers</option>
              </select>
            </div>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => setFilters({ search: '', clinic: '', city: '', status: '', manager: '' })}>Reset</button>
        </div>
      </Section>

      {/* Branches table */}
      <div className="card overflow-hidden">
        <DataTable
          loading={list.isLoading}
          error={list.error}
          rows={filteredBranches}
          onRowClick={(b) => setSelectedBranch(b)}
          empty={<EmptyState title="No branches found" />}
          columns={[
            {
              key: 'name',
              header: 'Branch Name',
              render: (b) => (
                <div className="space-y-1">
                  <p className="font-medium">{b.name}</p>
                  <div className="flex items-center gap-1 text-xs text-ink-muted"><MapPin className="h-3 w-3" /> {b.address?.city || '—'}</div>
                </div>
              ),
            },
            { key: 'clinic', header: 'Clinic', render: (b) => 'Apollo Care Clinic' },
            { key: 'location', header: 'Location', hideOnMobile: true, render: (b) => b.address?.city || '—' },
            { key: 'manager', header: 'Branch Manager', hideOnMobile: true, render: (b) => b.managerName || '—' },
            { key: 'doctors', header: 'Doctors', hideOnMobile: true, render: (b) => b.doctorCount || 0 },
            { key: 'patients', header: 'Patients', hideOnMobile: true, render: (b) => b.patientCount || 0 },
            { key: 'appointments', header: "Today's Appointments", hideOnMobile: true, render: (b) => b.todayAppointments || 0 },
            { key: 'revenue', header: "Today's Revenue", hideOnMobile: true, render: (b) => inr(b.todayRevenue || 0) },
            { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
            {
              key: 'actions',
              header: 'Actions',
              className: 'text-right',
              render: (b) => (
                <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); setSelectedBranch(b); }}>
                  View
                </button>
              ),
            },
          ]}
        />
      </div>

      {/* Branch performance section */}
      <Section title="Branch performance · last 30 days">
        <BranchReport />
      </Section>

      {/* Add/Edit branch modal */}
      {editing !== null && <BranchForm branch={editing.name ? editing : null} clinics={clinics.data} managers={staff.data} onClose={() => setEditing(null)} />}

      {/* Branch details drawer */}
      <BranchDetailsDrawer branch={selectedBranch} open={!!selectedBranch} onClose={() => setSelectedBranch(null)} onEdit={setEditing} />
    </div>
  );
}
