import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Drawer, Field, fieldErrors } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { inr } from '../../lib/format.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Per-day hours editor: one optional window + one optional break per weekday. */
function weekFromDoctor(d) {
  return DAYS.map((_, i) => {
    const r = d?.availability?.find((a) => a.dayOfWeek === i);
    const b = d?.breaks?.find((a) => a.dayOfWeek === i);
    return { on: Boolean(r), start: r?.startTime || '10:00', end: r?.endTime || '18:00', breakOn: Boolean(b), bStart: b?.startTime || '13:00', bEnd: b?.endTime || '14:00' };
  });
}

function DoctorForm({ doctor, onClose, limitedEdit }) {
  const qc = useQueryClient();
  const isNew = !doctor?._id;
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap) });
  const [f, setF] = useState({
    name: doctor?.name || '', specialization: doctor?.specialization || '', qualification: doctor?.qualification || '',
    registrationNumber: doctor?.registrationNumber || '', experienceYears: doctor?.experienceYears ?? '', consultationFee: doctor?.consultationFee ?? '',
    slotDurationMins: doctor?.slotDurationMins || 15, branchId: doctor?.branchId || '', supportsOnline: Boolean(doctor?.supportsOnline),
  });
  const [week, setWeek] = useState(weekFromDoctor(doctor));
  const [leave, setLeave] = useState({ from: '', to: '', reason: '' });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setDay = (i, patch) => setWeek((w) => w.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const badDay = week.find((d) => d.on && (d.start >= d.end || (d.breakOn && (d.bStart >= d.bEnd || d.bStart < d.start || d.bEnd > d.end))));

  const payload = () => ({
    ...(limitedEdit ? {} : {
      name: f.name, specialization: f.specialization || undefined, qualification: f.qualification || undefined,
      registrationNumber: f.registrationNumber || undefined, experienceYears: f.experienceYears === '' ? undefined : Number(f.experienceYears),
      consultationFee: f.consultationFee === '' ? undefined : Number(f.consultationFee), branchId: f.branchId || null, supportsOnline: f.supportsOnline,
    }),
    slotDurationMins: Number(f.slotDurationMins),
    availability: week.map((d, i) => d.on && { dayOfWeek: i, startTime: d.start, endTime: d.end }).filter(Boolean),
    breaks: week.map((d, i) => d.on && d.breakOn && { dayOfWeek: i, startTime: d.bStart, endTime: d.bEnd }).filter(Boolean),
  });
  const save = useMutation({
    mutationFn: () => (isNew ? api.post('/doctors', payload()) : api.patch(`/doctors/${doctor._id}`, payload())),
    onSuccess: () => { toast.success(isNew ? 'Doctor added' : 'Schedule saved'); qc.invalidateQueries({ queryKey: ['doctors'] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const addLeave = useMutation({
    mutationFn: () => api.post(`/doctors/${doctor._id}/leaves`, leave),
    onSuccess: () => { toast.success('Leave added — those days close for booking'); qc.invalidateQueries({ queryKey: ['doctors'] }); setLeave({ from: '', to: '', reason: '' }); },
    onError: (e) => toast.error(e.message),
  });
  const removeLeave = useMutation({
    mutationFn: (id) => api.delete(`/doctors/${doctor._id}/leaves/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctors'] }); },
  });
  const current = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap), enabled: !isNew });
  const leaves = current.data?.find((d) => d._id === doctor?._id)?.leaves || [];

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={isNew ? 'Add a doctor' : doctor.name} subtitle={isNew ? 'Patients can book once working hours are set.' : 'Profile, weekly schedule and leave'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || (!limitedEdit && f.name.trim().length < 2) || Boolean(badDay)} onClick={() => save.mutate()}>{save.isPending && <Spinner />} {isNew ? 'Add doctor' : 'Save'}</button></>}>
      <div className="space-y-5">
        {!limitedEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="d-name" error={errors.name}><input id="d-name" className="field" placeholder="Dr. Asha Rao" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Specialization" htmlFor="d-spec"><input id="d-spec" className="field" placeholder="Dermatology" value={f.specialization} onChange={(e) => set('specialization', e.target.value)} /></Field>
            <Field label="Qualification" htmlFor="d-qual"><input id="d-qual" className="field" placeholder="MBBS, MD" value={f.qualification} onChange={(e) => set('qualification', e.target.value)} /></Field>
            <Field label="Medical registration no." htmlFor="d-reg" hint="Printed on and required for prescriptions."><input id="d-reg" className="field" value={f.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} /></Field>
            <Field label="Consultation fee (₹)" htmlFor="d-fee"><input id="d-fee" type="number" min="0" className="field" value={f.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} /></Field>
            <Field label="Experience (years)" htmlFor="d-exp"><input id="d-exp" type="number" min="0" className="field" value={f.experienceYears} onChange={(e) => set('experienceYears', e.target.value)} /></Field>
            <Field label="Branch" htmlFor="d-branch">
              <select id="d-branch" className="field" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>
                <option value="">Not assigned</option>{branches.data?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </Field>
            <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.supportsOnline} onChange={(e) => set('supportsOnline', e.target.checked)} /> Offers online consultations</label>
          </div>
        )}
        <Field label="Slot length (minutes)" htmlFor="d-slot" className="max-w-[200px]">
          <input id="d-slot" type="number" min="5" max="120" className="field" value={f.slotDurationMins} onChange={(e) => set('slotDurationMins', e.target.value)} />
        </Field>

        <div>
          <p className="label">Weekly schedule</p>
          <div className="space-y-2">
            {week.map((d, i) => (
              <div key={DAYS[i]} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                <label className="flex w-16 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={d.on} onChange={(e) => setDay(i, { on: e.target.checked })} /> {DAYS[i]}</label>
                {d.on ? (
                  <>
                    <input type="time" className="field-sm" value={d.start} onChange={(e) => setDay(i, { start: e.target.value })} aria-label={`${DAYS[i]} start`} />
                    <span className="text-ink-muted">to</span>
                    <input type="time" className="field-sm" value={d.end} onChange={(e) => setDay(i, { end: e.target.value })} aria-label={`${DAYS[i]} end`} />
                    <label className="ml-2 flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={d.breakOn} onChange={(e) => setDay(i, { breakOn: e.target.checked })} /> Break</label>
                    {d.breakOn && <><input type="time" className="field-sm" value={d.bStart} onChange={(e) => setDay(i, { bStart: e.target.value })} aria-label={`${DAYS[i]} break start`} /><input type="time" className="field-sm" value={d.bEnd} onChange={(e) => setDay(i, { bEnd: e.target.value })} aria-label={`${DAYS[i]} break end`} /></>}
                  </>
                ) : <span className="text-sm text-ink-muted">Off</span>}
              </div>
            ))}
          </div>
          {badDay && <p className="mt-2 text-xs text-alert">Check the times: each day must end after it starts, and breaks must sit inside working hours.</p>}
        </div>

        {!isNew && (
          <div>
            <p className="label">Leave</p>
            <ul className="mb-2 space-y-1">
              {leaves.map((l) => (
                <li key={l._id} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm">
                  <span>{dayjs(l.from).format('DD MMM')} – {dayjs(l.to).format('DD MMM YYYY')}{l.reason ? ` · ${l.reason}` : ''}</span>
                  <button className="btn-quiet btn-sm" aria-label="Remove leave" onClick={() => removeLeave.mutate(l._id)}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="From" htmlFor="lv-from"><input id="lv-from" type="date" className="field-sm" value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} /></Field>
              <Field label="To" htmlFor="lv-to"><input id="lv-to" type="date" className="field-sm" value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} /></Field>
              <Field label="Reason" htmlFor="lv-r"><input id="lv-r" className="field-sm" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></Field>
              <button className="btn-ghost btn-sm" disabled={!leave.from || !leave.to || addLeave.isPending} onClick={() => addLeave.mutate()}>Add leave</button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default function Doctors({ title = 'Doctors', description = 'Profiles, fees and weekly schedules. Patients can only book inside these hours.' }) {
  const { user, entitlements } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const canCreate = user?.role === 'CLINIC_OWNER';
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get('/doctors', { params: { active: 'all' } }).then(unwrap) });
  const toggle = useMutation({
    mutationFn: (d) => api.patch(`/doctors/${d._id}`, { isActive: !d.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors'] }),
    onError: (e) => toast.error(e.message),
  });
  const limit = entitlements?.limits?.maxDoctors;
  const active = data?.filter((d) => d.isActive).length || 0;

  return (
    <div>
      <PageHeader title={title} description={description}
        actions={canCreate && <button onClick={() => setEditing({})} disabled={limit !== null && limit !== undefined && active >= limit} className="btn-primary" title={limit && active >= limit ? 'Plan limit reached' : undefined}><Plus className="h-4 w-4" /> Add doctor</button>}>
        {canCreate && limit != null && <p className="mt-1 text-xs text-ink-muted">{active} of {limit} doctors on your plan</p>}
      </PageHeader>
      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={data} onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title="No doctors yet" body="Add a doctor with their working hours so patients can book." action={canCreate && <button onClick={() => setEditing({})} className="btn-primary">Add doctor</button>} />}
        columns={[
          { key: 'name', header: 'Doctor', sort: (r) => r.name, render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{[r.specialization, r.qualification].filter(Boolean).join(' · ')}</p></div> },
          { key: 'fee', header: 'Fee', sort: (r) => r.consultationFee, render: (r) => inr(r.consultationFee) },
          { key: 'slot', header: 'Slot', hideOnMobile: true, render: (r) => `${r.slotDurationMins} min` },
          { key: 'days', header: 'Working days', hideOnMobile: true, render: (r) => { const ds = [...new Set(r.availability.map((a) => a.dayOfWeek))].sort(); return ds.length ? ds.map((d) => DAYS[d]).join(', ') : <span className="text-alert">Not set</span>; } },
          { key: 'reg', header: 'Reg. no.', hideOnMobile: true, render: (r) => (r.registrationNumber ? <span className="font-mono text-xs">{r.registrationNumber}</span> : <span className="text-xs text-alert">Missing</span>) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
          ...(canCreate ? [{ key: 'act', header: '', className: 'text-right', render: (r) => <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); toggle.mutate(r); }}>{r.isActive ? 'Deactivate' : 'Reactivate'}</button> }] : []),
        ]}
      />
      {editing && <DoctorForm doctor={editing} limitedEdit={user?.role === 'BRANCH_MANAGER'} onClose={() => setEditing(null)} />}
    </div>
  );
}
