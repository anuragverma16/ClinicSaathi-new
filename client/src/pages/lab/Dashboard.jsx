import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FlaskConical, TestTube, Loader, ClipboardCheck, Siren, Plus, Trash2, Download } from 'lucide-react';
import { api, unwrap, openFile } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Tabs, Drawer, Field } from '../../components/ui/Page.jsx';
import { date, dateTime, age, titleCase } from '../../lib/format.js';

const FLAGS = ['', 'NORMAL', 'LOW', 'HIGH', 'CRITICAL'];

function ResultsDrawer({ order, onClose }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(order.tests.map((t) => ({ test: t.name, value: '', unit: '', referenceRange: '', flag: '' })));
  const [file, setFile] = useState(null);
  const [notes, setNotes] = useState('');
  const setRow = (i, patch) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const submit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('results', JSON.stringify(rows.filter((r) => r.test && (r.value || r.flag))));
      if (file) fd.append('report', file);
      if (notes) fd.append('technicianNotes', notes);
      return api.post(`/lab/orders/${order._id}/results`, fd);
    },
    onSuccess: () => { toast.success('Results submitted — the doctor has been notified to verify'); qc.invalidateQueries({ queryKey: ['lab'] }); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const hasData = file || rows.some((r) => r.value);
  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={`${order.orderNumber} · results`} subtitle={`${order.patientId?.name} · ${[age(order.patientId?.dob), order.patientId?.gender && titleCase(order.patientId.gender)].filter(Boolean).join(' · ')}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!hasData || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending && <Spinner />} Submit for verification</button></>}>
      <div className="space-y-4">
        {order.clinicalNotes && <p className="rounded-lg bg-paper p-3 text-sm"><b>Doctor's note:</b> {order.clinicalNotes}</p>}
        <p className="text-xs text-ink-muted">Record measured values only. Interpretation and diagnosis are the doctor's — results reach the patient after the doctor verifies them.</p>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2">
            <div className="grid gap-2 sm:grid-cols-5">
              <input className="field sm:col-span-2" value={r.test} onChange={(e) => setRow(i, { test: e.target.value })} aria-label="Test" />
              <input className="field" placeholder="Value" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} aria-label={`${r.test} value`} />
              <input className="field" placeholder="Unit" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} aria-label="Unit" />
              <input className="field" placeholder="Ref. range" value={r.referenceRange} onChange={(e) => setRow(i, { referenceRange: e.target.value })} aria-label="Reference range" />
              <select className="field sm:col-span-2" value={r.flag} onChange={(e) => setRow(i, { flag: e.target.value })} aria-label="Flag">{FLAGS.map((f) => <option key={f} value={f}>{f ? titleCase(f) : 'No flag'}</option>)}</select>
            </div>
            <button className="btn-quiet h-fit p-2" aria-label="Remove row" onClick={() => setRows((x) => x.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="btn-quiet btn-sm" onClick={() => setRows((x) => [...x, { test: '', value: '', unit: '', referenceRange: '', flag: '' }])}><Plus className="h-3.5 w-3.5" /> Add parameter</button>
        <Field label="Report file (PDF or image, optional)" htmlFor="lr-file"><input id="lr-file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label="Technician note" htmlFor="lr-n"><input id="lr-n" className="field" placeholder="e.g. sample slightly haemolysed" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

export default function LabDashboard({ view = 'worklist' }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(view === 'completed' ? 'RESULT_SUBMITTED,VERIFIED' : 'ORDERED,SAMPLE_COLLECTED,PROCESSING');
  const [entering, setEntering] = useState(null);
  const overview = useQuery({ queryKey: ['lab', 'overview'], queryFn: () => api.get('/lab/overview').then(unwrap), refetchInterval: 60_000 });
  const orders = useQuery({ queryKey: ['lab', 'orders', status], queryFn: () => api.get('/lab/orders', { params: { status } }).then(unwrap), refetchInterval: 60_000 });
  useEffect(() => onSocket('lab:updated', () => qc.invalidateQueries({ queryKey: ['lab'] })), [qc]);
  const step = useMutation({
    mutationFn: ({ id, action }) => api.post(`/lab/orders/${id}/${action}`),
    onSuccess: (_r, { action }) => { toast.success(action === 'collect' ? 'Sample collected' : 'Processing started'); qc.invalidateQueries({ queryKey: ['lab'] }); },
    onError: (e) => toast.error(e.message),
  });
  const o = overview.data;
  return (
    <div className="space-y-6">
      <PageHeader title={view === 'completed' ? 'Submitted results' : 'Lab worklist'} description="Orders from doctors, urgent first. You see only what you need to collect and label samples." />
      {view !== 'completed' && (
        <KpiGrid cols="sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard icon={FlaskConical} label="New orders" value={o?.ordered} />
          <KpiCard icon={TestTube} tone="navy" label="Collected" value={o?.collected} />
          <KpiCard icon={Loader} tone="amber" label="Processing" value={o?.processing} />
          <KpiCard icon={ClipboardCheck} label="Submitted today" value={o?.submittedToday} />
          <KpiCard icon={Siren} tone="red" label="Urgent open" value={o?.urgentOpen} />
        </KpiGrid>
      )}
      {view !== 'completed' && <Tabs value={status} onChange={setStatus} tabs={[{ value: 'ORDERED,SAMPLE_COLLECTED,PROCESSING', label: 'Open' }, { value: 'ORDERED', label: 'To collect' }, { value: 'SAMPLE_COLLECTED,PROCESSING', label: 'In progress' }]} />}
      <DataTable loading={orders.isLoading} error={orders.error} onRetry={orders.refetch} rows={orders.data}
        empty={<EmptyState icon={FlaskConical} title={view === 'completed' ? 'Nothing submitted yet' : 'No open orders'} body="Doctors' lab orders appear here as soon as they're placed." />}
        columns={[
          { key: 'no', header: 'Order', render: (r) => <div><p className="font-mono text-xs">{r.orderNumber}</p><p className="text-xs text-ink-muted">{dateTime(r.createdAt)}</p></div> },
          { key: 'patient', header: 'Patient', render: (r) => <div><p className="font-medium">{r.patientId?.name}</p><p className="text-xs text-ink-muted">{[age(r.patientId?.dob), r.patientId?.gender && titleCase(r.patientId.gender)].filter(Boolean).join(' · ')}</p></div> },
          { key: 'tests', header: 'Tests', render: (r) => <div>{r.tests.map((t) => t.name).join(', ')}{r.clinicalNotes && <p className="text-xs text-ink-muted">{r.clinicalNotes}</p>}</div> },
          { key: 'doc', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name },
          { key: 'prio', header: 'Priority', render: (r) => <StatusBadge status={r.priority} /> },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'act', header: '', className: 'text-right', render: (r) => (
            <div className="flex justify-end gap-1">
              {r.status === 'ORDERED' && <button className="btn-primary btn-sm" onClick={() => step.mutate({ id: r._id, action: 'collect' })}>Collect sample</button>}
              {r.status === 'SAMPLE_COLLECTED' && <button className="btn-ghost btn-sm" onClick={() => step.mutate({ id: r._id, action: 'process' })}>Start processing</button>}
              {['SAMPLE_COLLECTED', 'PROCESSING'].includes(r.status) && <button className="btn-primary btn-sm" onClick={() => setEntering(r)}>Enter results</button>}
              {r.report?.storageKey && <button className="btn-quiet btn-sm" onClick={() => openFile('labFile', r._id).catch((e) => toast.error(e.message))}><Download className="h-3.5 w-3.5" /></button>}
              {view === 'completed' && <span className="text-xs text-ink-muted">{date(r.submittedAt)}</span>}
            </div>
          ) },
        ]} />
      {entering && <ResultsDrawer order={entering} onClose={() => setEntering(null)} />}
    </div>
  );
}
