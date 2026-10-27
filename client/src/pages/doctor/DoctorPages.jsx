import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Plus, Search, RefreshCw, Copy } from 'lucide-react';
import { api, unwrap, unwrapPage, openFile } from '../../lib/api.js';
import { PageHeader, Tabs, Section, Field, Drawer, Pagination, useReasonPrompt } from '../../components/ui/Page.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PatientPicker } from '../clinic/BookingForm.jsx';
import Appointments from '../clinic/Appointments.jsx';
import { ConsultationWorkspace } from './ConsultationWorkspace.jsx';
import { WeeklyHours } from './WeeklyHours.jsx';
import { date, dateTime, titleCase } from '../../lib/format.js';

const dl = (kind, id, label = 'PDF') => (
  <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); openFile(kind, id).catch((err) => toast.error(err.message)); }}><Download className="h-3.5 w-3.5" /> {label}</button>
);

/** Consultations: in-progress, completed history, or a diagnosis/notes search view. */
export function Consultations({ mode = 'active' }) {
  const [status, setStatus] = useState(mode === 'history' ? 'COMPLETED' : mode === 'active' ? 'IN_PROGRESS' : '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const list = useQuery({ queryKey: ['consultations', status, q, page], queryFn: () => api.get('/consultations', { params: { status: status || undefined, q: q || undefined, page } }).then(unwrapPage) });
  const titles = { active: ['Consultations', 'Open consultations you can still edit.'], history: ['Consultation history', 'Completed visits — closed records accept addenda only.'], notes: ['Diagnoses and clinical notes', 'Search your diagnoses and notes across patients.'] };
  return (
    <div>
      <PageHeader title={titles[mode][0]} description={titles[mode][1]} />
      <div className="mb-4 flex flex-wrap gap-2">
        {mode !== 'history' && <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} tabs={[{ value: 'IN_PROGRESS', label: 'In progress' }, { value: 'COMPLETED', label: 'Completed' }, { value: '', label: 'All' }]} />}
        <div className="relative ml-auto"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input className="field-sm pl-8" placeholder="Search diagnosis or symptoms" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" /></div>
      </div>
      <DataTable loading={list.isLoading} error={list.error} rows={list.data?.data}
        onRowClick={(c) => setOpen({ _id: c.appointmentId, patientId: c.patientId })}
        empty={<EmptyState title="No consultations here" body="Consultations start from your queue or today's schedule." />}
        columns={[
          { key: 'date', header: 'Date', sort: (c) => c.createdAt, render: (c) => dateTime(c.createdAt) },
          { key: 'patient', header: 'Patient', render: (c) => c.patientId?.name },
          { key: 'dx', header: 'Diagnosis', render: (c) => c.diagnosis || <span className="text-ink-muted">—</span> },
          ...(mode === 'notes' ? [{ key: 'notes', header: 'Notes', hideOnMobile: true, render: (c) => <span className="line-clamp-2 text-sm text-ink-soft">{c.clinicalNotes || c.symptoms || '—'}</span> }] : []),
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
        ]} />
      <Pagination meta={list.data?.meta} page={page} onPage={setPage} />
      {open && <ConsultationWorkspace appointment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function DoctorPrescriptions() {
  const [status, setStatus] = useState('');
  const list = useQuery({ queryKey: ['prescriptions', status], queryFn: () => api.get('/prescriptions', { params: { status: status || undefined } }).then(unwrap) });
  return (
    <div>
      <PageHeader title="Prescriptions" description="Drafts are private to you. Signed prescriptions are locked and visible to the patient." />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'FINAL', label: 'Signed' }]} />
      <DataTable loading={list.isLoading} error={list.error} rows={list.data} empty={<EmptyState title="No prescriptions yet" body="Write one from inside a consultation." />} columns={[
        { key: 'no', header: 'Rx no.', render: (r) => <span className="font-mono text-xs">{r.rxNumber}</span> },
        { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
        { key: 'meds', header: 'Medicines', render: (r) => r.medicines.map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}`).join(', ') || r.advice || '—' },
        { key: 'date', header: 'Date', sort: (r) => r.createdAt, render: (r) => date(r.finalizedAt || r.createdAt) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'f', header: '', render: (r) => r.status === 'FINAL' && dl('prescription', r._id) },
      ]} />
    </div>
  );
}

function VerifyDrawer({ order, onClose }) {
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState(order.doctorRemarks || '');
  const verify = useMutation({
    mutationFn: (approve) => api.post(`/lab/orders/${order._id}/verify`, { approve, remarks: remarks || undefined }),
    onSuccess: (_r, approve) => { toast.success(approve ? 'Verified — released to the patient' : 'Sent back to the lab'); qc.invalidateQueries({ queryKey: ['lab'] }); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Drawer open onClose={onClose} title={`${order.orderNumber} · ${order.patientId?.name}`} subtitle={order.tests.map((t) => t.name).join(', ')}
      footer={order.status === 'RESULT_SUBMITTED' && <>
        <button className="btn-ghost" onClick={() => verify.mutate(false)} disabled={verify.isPending}>Return for re-test</button>
        <button className="btn-primary" onClick={() => verify.mutate(true)} disabled={verify.isPending}>Verify & release</button>
      </>}>
      <div className="space-y-4">
        <StatusBadge status={order.status} />
        {order.results?.length > 0 ? (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-muted"><th className="py-1">Test</th><th>Value</th><th>Ref.</th><th>Flag</th></tr></thead>
            <tbody>{order.results.map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{r.test}</td><td className="font-medium">{r.value} {r.unit}</td><td className="text-ink-muted">{r.referenceRange}</td><td>{r.flag && r.flag !== 'NORMAL' ? <StatusBadge status={r.flag === 'CRITICAL' ? 'URGENT' : 'DUE'}>{r.flag}</StatusBadge> : ''}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted">No structured values — see the attached report.</p>}
        <div className="flex gap-2">{order.report?.storageKey && dl('labFile', order._id, 'Attached report')}{['RESULT_SUBMITTED', 'VERIFIED'].includes(order.status) && dl('labReport', order._id, 'Report PDF')}</div>
        {order.technicianNotes && <p className="text-sm"><b>Lab note:</b> {order.technicianNotes}</p>}
        <Field label="Your remarks (shown on the report)" htmlFor="vr-r"><textarea id="vr-r" className="field" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={order.status !== 'RESULT_SUBMITTED'} /></Field>
      </div>
    </Drawer>
  );
}

export function DoctorLabOrders() {
  const [status, setStatus] = useState('RESULT_SUBMITTED');
  const [open, setOpen] = useState(null);
  const list = useQuery({ queryKey: ['lab', 'orders', status], queryFn: () => api.get('/lab/orders', { params: { status: status || undefined } }).then(unwrap) });
  return (
    <div>
      <PageHeader title="Lab orders and reports" description="Results submitted by the lab wait here for your verification before the patient can see them." />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: 'RESULT_SUBMITTED', label: 'To verify' }, { value: 'ORDERED,SAMPLE_COLLECTED,PROCESSING', label: 'In lab' }, { value: 'VERIFIED', label: 'Verified' }, { value: '', label: 'All' }]} />
      <DataTable loading={list.isLoading} error={list.error} rows={list.data} onRowClick={setOpen}
        empty={<EmptyState title="Nothing here" body="Order tests from inside a consultation." />}
        columns={[
          { key: 'no', header: 'Order', render: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
          { key: 'patient', header: 'Patient', render: (o) => o.patientId?.name },
          { key: 'tests', header: 'Tests', render: (o) => o.tests.map((t) => t.name).join(', ') },
          { key: 'prio', header: 'Priority', hideOnMobile: true, render: (o) => <StatusBadge status={o.priority} /> },
          { key: 'date', header: 'Ordered', hideOnMobile: true, render: (o) => date(o.createdAt) },
          { key: 'status', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
        ]} />
      {open && <VerifyDrawer order={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function Certificates() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [patient, setPatient] = useState(null);
  const [f, setF] = useState({ type: 'SICK_LEAVE', fromDate: '', toDate: '', remarks: '' });
  const [askReason, reasonDialog] = useReasonPrompt();
  const list = useQuery({ queryKey: ['certificates'], queryFn: () => api.get('/certificates').then(unwrap) });
  const create = useMutation({
    mutationFn: () => api.post('/certificates', { patientId: patient._id, type: f.type, fromDate: f.fromDate || undefined, toDate: f.toDate || undefined, remarks: f.remarks || undefined }),
    onSuccess: () => { toast.success('Draft created — review and issue it'); setCreating(false); setPatient(null); qc.invalidateQueries({ queryKey: ['certificates'] }); },
    onError: (e) => toast.error(e.message),
  });
  const act = useMutation({
    mutationFn: ({ id, action, body }) => api.post(`/certificates/${id}/${action}`, body),
    onSuccess: () => { toast.success('Certificate updated'); qc.invalidateQueries({ queryKey: ['certificates'] }); },
    onError: (e) => toast.error(e.message),
  });
  const revoke = async (c) => { const reason = await askReason({ title: 'Revoke certificate?', body: c.certificateNumber, danger: true, confirmLabel: 'Revoke', required: true }); if (reason) act.mutate({ id: c._id, action: 'revoke', body: { reason } }); };
  return (
    <div>
      <PageHeader title="Medical certificates" description="Draft, review, then issue. Issued certificates carry your registration number and appear in the patient's portal."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New certificate</button>} />
      <DataTable loading={list.isLoading} error={list.error} rows={list.data} empty={<EmptyState title="No certificates yet" />} columns={[
        { key: 'no', header: 'No.', render: (c) => <span className="font-mono text-xs">{c.certificateNumber}</span> },
        { key: 'patient', header: 'Patient', render: (c) => c.patientId?.name },
        { key: 'type', header: 'Type', render: (c) => titleCase(c.type) },
        { key: 'period', header: 'Period', hideOnMobile: true, render: (c) => (c.fromDate ? `${date(c.fromDate)}${c.toDate ? ` – ${date(c.toDate)}` : ''}` : '—') },
        { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
        { key: 'a', header: '', className: 'text-right', render: (c) => (
          <div className="flex justify-end gap-1">
            {c.status === 'DRAFT' && <button className="btn-primary btn-sm" onClick={() => act.mutate({ id: c._id, action: 'issue' })}>Sign & issue</button>}
            {c.status === 'ISSUED' && <>{dl('certificate', c._id)}<button className="btn-quiet btn-sm text-alert" onClick={() => revoke(c)}>Revoke</button></>}
          </div>
        ) },
      ]} />
      <Modal open={creating} onClose={() => setCreating(false)} title="New medical certificate" width="max-w-xl"
        footer={<><button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn-primary" disabled={!patient || create.isPending} onClick={() => create.mutate()}>{create.isPending && <Spinner />} Create draft</button></>}>
        <div className="space-y-4">
          <Field label="Patient" hint="Only patients you've seen can be selected."><PatientPicker value={patient} onChange={setPatient} /></Field>
          <Field label="Type" htmlFor="ct-t"><select id="ct-t" className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="SICK_LEAVE">Sick leave</option><option value="FITNESS">Fitness</option><option value="GENERAL">General</option></select></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="ct-f"><input id="ct-f" type="date" className="field" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
            <Field label="To" htmlFor="ct-to"><input id="ct-to" type="date" className="field" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
          </div>
          <Field label="Remarks" htmlFor="ct-r"><textarea id="ct-r" className="field" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      </Modal>
      {reasonDialog}
    </div>
  );
}

/** Subscribe-able ICS feed: appointments show up in Google Calendar / Outlook and stay in sync. */
export function CalendarSyncCard({ doctorId }) {
  const feed = useQuery({ queryKey: ['calendar-feed', doctorId], queryFn: () => api.get(`/doctors/${doctorId}/calendar-feed`).then(unwrap), enabled: Boolean(doctorId) });
  const url = feed.data?.url;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success('Calendar link copied'); } catch { toast.error('Copy failed'); } };
  return (
    <Section title="Calendar sync">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white"><RefreshCw className="h-5 w-5" /></span>
        <p className="text-sm text-ink-soft">Your appointments appear in Google Calendar or Outlook automatically and stay updated. Patients are shown by first name only. Keep this link private.</p>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{url || 'Loading…'}</span>
        <button className="btn-quiet btn-sm" disabled={!url} onClick={copy} aria-label="Copy calendar link"><Copy className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className={`btn-ghost btn-sm ${url ? '' : 'pointer-events-none opacity-50'}`} target="_blank" rel="noreferrer"
           href={url ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}` : undefined}>Add to Google Calendar</a>
        <a className={`btn-ghost btn-sm ${url ? '' : 'pointer-events-none opacity-50'}`} target="_blank" rel="noreferrer"
           href={url ? `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent('Clinic appointments')}` : undefined}>Add to Outlook</a>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Google needs a publicly reachable server URL (set PUBLIC_API_URL in production).</p>
    </Section>
  );
}

export function DoctorSchedule() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['doctors', 'me'], queryFn: () => api.get('/doctors/me').then(unwrap) });
  const [leave, setLeave] = useState({ from: '', to: '', reason: '' });
  const add = useMutation({
    mutationFn: () => api.post('/doctors/me/leaves', leave),
    onSuccess: () => { toast.success('Leave recorded — those days are closed for booking'); setLeave({ from: '', to: '', reason: '' }); qc.invalidateQueries({ queryKey: ['doctors'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <Appointments mode="doctor" />
      <div className="grid gap-5 lg:grid-cols-2">
        <WeeklyHours />
        <CalendarSyncCard doctorId={me.data?._id} />
        <Section title="Request leave">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="dl-f"><input id="dl-f" type="date" className="field" value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value })} /></Field>
              <Field label="To" htmlFor="dl-t"><input id="dl-t" type="date" className="field" value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} /></Field>
            </div>
            <Field label="Reason" htmlFor="dl-r"><input id="dl-r" className="field" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></Field>
            <p className="text-xs text-ink-muted">Existing bookings on those days are not moved automatically — ask the front desk to reschedule them.</p>
            <button className="btn-primary" disabled={!leave.from || !leave.to || add.isPending} onClick={() => add.mutate()}>Add leave</button>
          </div>
        </Section>
      </div>
    </div>
  );
}
