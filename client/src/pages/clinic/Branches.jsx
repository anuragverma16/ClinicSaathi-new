import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Field, Section, fieldErrors } from '../../components/ui/Page.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { inr } from '../../lib/format.js';

export function BranchForm({ branch, onClose, limited }) {
  const qc = useQueryClient();
  const isNew = !branch?._id;
  const [f, setF] = useState({
    name: branch?.name || '', code: branch?.code || '', phone: branch?.phone || '',
    address: { line1: branch?.address?.line1 || '', city: branch?.address?.city || '', pincode: branch?.address?.pincode || '' },
    timings: { openTime: branch?.timings?.openTime || '09:00', closeTime: branch?.timings?.closeTime || '19:00' },
  });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: () => (isNew ? api.post('/clinics/branches', f) : api.patch(`/clinics/branches/${branch._id}`, limited ? { phone: f.phone, address: f.address, timings: f.timings } : f)),
    onSuccess: () => { toast.success('Branch saved'); qc.invalidateQueries({ queryKey: ['branches'] }); onClose?.(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const body = (
    <div className="grid gap-4 sm:grid-cols-2">
      {!limited && <Field label="Branch name" htmlFor="b-name" error={errors.name}><input id="b-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
      {!limited && <Field label="Short code" htmlFor="b-code"><input id="b-code" className="field" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>}
      <Field label="Phone" htmlFor="b-phone"><input id="b-phone" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Address" htmlFor="b-addr"><input id="b-addr" className="field" value={f.address.line1} onChange={(e) => setF({ ...f, address: { ...f.address, line1: e.target.value } })} /></Field>
      <Field label="City" htmlFor="b-city"><input id="b-city" className="field" value={f.address.city} onChange={(e) => setF({ ...f, address: { ...f.address, city: e.target.value } })} /></Field>
      <Field label="Pincode" htmlFor="b-pin"><input id="b-pin" className="field" value={f.address.pincode} onChange={(e) => setF({ ...f, address: { ...f.address, pincode: e.target.value } })} /></Field>
      <Field label="Opens" htmlFor="b-open"><input id="b-open" type="time" className="field" value={f.timings.openTime} onChange={(e) => setF({ ...f, timings: { ...f.timings, openTime: e.target.value } })} /></Field>
      <Field label="Closes" htmlFor="b-close"><input id="b-close" type="time" className="field" value={f.timings.closeTime} onChange={(e) => setF({ ...f, timings: { ...f.timings, closeTime: e.target.value } })} /></Field>
    </div>
  );
  const button = <button className="btn-primary" disabled={save.isPending || (!limited && f.name.trim().length < 2)} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save branch</button>;
  if (!onClose) return <div className="space-y-4">{body}<div className="flex justify-end">{button}</div></div>;
  return <Modal open onClose={onClose} title={isNew ? 'Add branch' : 'Edit branch'} width="max-w-xl" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>{button}</>}>{body}</Modal>;
}

/** Branch performance for the last 30 days (owners: all branches; managers: theirs). */
export function BranchReport() {
  const r = useQuery({ queryKey: ['branches', 'report'], queryFn: () => api.get('/clinics/branches/report').then(unwrap) });
  return (
    <DataTable loading={r.isLoading} error={r.error} rows={r.data?.branches} rowKey={(x) => x.branchId || 'none'}
      empty={<EmptyState title="No activity in the last 30 days" />}
      columns={[
        { key: 'name', header: 'Branch', render: (x) => <span className="font-medium">{x.name}</span> },
        { key: 'appointments', header: 'Appointments', sort: (x) => x.appointments },
        { key: 'completed', header: 'Completed' },
        { key: 'cancelled', header: 'Cancelled', hideOnMobile: true },
        { key: 'noShows', header: 'No-shows', hideOnMobile: true },
        { key: 'collections', header: 'Collections', sort: (x) => x.collections, render: (x) => inr(x.collections) },
      ]} />
  );
}

export default function Branches() {
  const { entitlements } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const list = useQuery({ queryKey: ['branches', 'all'], queryFn: () => api.get('/clinics/branches', { params: { all: 'true' } }).then(unwrap) });
  const toggle = useMutation({
    mutationFn: (b) => api.patch(`/clinics/branches/${b._id}`, { isActive: !b.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
    onError: (e) => toast.error(e.message),
  });
  const limit = entitlements?.limits?.maxBranches;
  const active = list.data?.filter((b) => b.isActive).length || 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Branch management" description="Locations, their hours, and how each one is performing. Staff assigned to a branch only see that branch."
        actions={<button className="btn-primary" disabled={limit != null && active >= limit} onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Add branch</button>}>
        {limit != null && <p className="mt-1 text-xs text-ink-muted">{active} of {limit} branches on your plan{active >= limit ? ' — upgrade to Enterprise for more' : ''}</p>}
      </PageHeader>
      <DataTable loading={list.isLoading} error={list.error} rows={list.data} onRowClick={setEditing}
        empty={<EmptyState title="No branches yet" body="Single-location clinics can skip this." />}
        columns={[
          { key: 'name', header: 'Branch', render: (b) => <div><p className="font-medium">{b.name}</p><p className="text-xs text-ink-muted">{b.address?.city}</p></div> },
          { key: 'code', header: 'Code', hideOnMobile: true },
          { key: 'hours', header: 'Hours', hideOnMobile: true, render: (b) => (b.timings?.openTime ? `${b.timings.openTime}–${b.timings.closeTime}` : '—') },
          { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
          { key: 'act', header: '', className: 'text-right', render: (b) => <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); toggle.mutate(b); }}>{b.isActive ? 'Deactivate' : 'Reactivate'}</button> },
        ]} />
      <Section title="Branch performance · last 30 days"><BranchReport /></Section>
      {editing && <BranchForm branch={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
