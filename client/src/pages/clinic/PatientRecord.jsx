import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Upload, Lock } from 'lucide-react';
import { api, unwrap, openFile } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Drawer, Tabs, KeyValue, Field } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Spinner, EmptyState } from '../../components/ui/States.jsx';
import { dateTime, date, inr, age, titleCase } from '../../lib/format.js';

const fileBtn = (kind, id, label = 'PDF') => (
  <button className="btn-quiet btn-sm" onClick={() => openFile(kind, id).catch((e) => toast.error(e.message))}>
    <Download className="h-3.5 w-3.5" /> {label}
  </button>
);

function Row({ title, sub, right }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
      <div className="min-w-0"><p className="text-sm font-medium">{title}</p>{sub && <p className="text-xs text-ink-muted">{sub}</p>}</div>
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </li>
  );
}

const List = ({ items, empty, render }) => (items?.length ? <ul className="space-y-2">{items.map(render)}</ul> : <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>);

function DocumentUpload({ patientId }) {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [share, setShare] = useState(false);
  const up = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file); fd.append('title', title); fd.append('sharedWithPatient', String(share));
      return api.post(`/patients/${patientId}/documents`, fd);
    },
    onSuccess: () => { toast.success('Document uploaded'); setFile(null); setTitle(''); qc.invalidateQueries({ queryKey: ['patient-timeline', patientId] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed border-line p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Attach a document (PDF or image, 10 MB max)</p>
      <input className="field" placeholder="Title, e.g. MRI knee — Apollo" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Document title" />
      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} aria-label="Choose file" className="text-sm" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share with patient in their portal</label>
      <button className="btn-primary btn-sm" disabled={!file || title.trim().length < 2 || up.isPending} onClick={() => up.mutate()}>{up.isPending ? <Spinner className="h-3 w-3" /> : <Upload className="h-3.5 w-3.5" />} Upload</button>
    </div>
  );
}

function ContactEditor({ patient, onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: patient.name, email: patient.email || '', gender: patient.gender || '', address: patient.address || {},
    optOutAll: Boolean(patient.communicationPrefs?.optOutAll), marketing: Boolean(patient.consent?.marketing?.granted),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/patients/${patient._id}`, {
      name: f.name, email: f.email, ...(f.gender ? { gender: f.gender } : {}), address: f.address,
      communicationPrefs: { optOutAll: f.optOutAll }, consent: { marketing: { granted: f.marketing } },
    }),
    onSuccess: () => { toast.success('Patient updated'); qc.invalidateQueries({ queryKey: ['patient-timeline', patient._id] }); qc.invalidateQueries({ queryKey: ['patients'] }); onDone(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="pe-name"><input id="pe-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" htmlFor="pe-email"><input id="pe-email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Gender" htmlFor="pe-gender">
          <select id="pe-gender" className="field" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">—</option><option>MALE</option><option>FEMALE</option><option>OTHER</option></select>
        </Field>
        <Field label="City" htmlFor="pe-city"><input id="pe-city" className="field" value={f.address.city || ''} onChange={(e) => setF({ ...f, address: { ...f.address, city: e.target.value } })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.checked })} /> Patient agreed to recall and promotional messages</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.optOutAll} onChange={(e) => setF({ ...f, optOutAll: e.target.checked })} /> Patient opted out of all automated messages</label>
      <div className="flex gap-2"><button className="btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</button><button className="btn-ghost btn-sm" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

/** Unified patient record. Sections the server didn't release for this role are shown as locked. */
export function PatientRecord({ patientId, onClose }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('visits');
  const [editing, setEditing] = useState(false);
  const t = useQuery({ queryKey: ['patient-timeline', patientId], queryFn: () => api.get(`/patients/${patientId}/timeline`).then(unwrap), enabled: Boolean(patientId) });
  const d = t.data;
  const p = d?.patient;
  const tabs = [
    { value: 'visits', label: 'Visits', count: d?.appointments?.length },
    ...(d?.access?.clinical ? [{ value: 'clinical', label: 'Clinical' }, { value: 'files', label: 'Reports & documents' }] : []),
    ...(d?.access?.billing ? [{ value: 'billing', label: 'Billing' }] : []),
    ...(d?.communications ? [{ value: 'messages', label: 'Messages', count: d.communications.length }] : []),
  ];
  const canEdit = ['CLINIC_OWNER', 'RECEPTIONIST', 'BRANCH_MANAGER'].includes(user?.role);

  return (
    <Drawer open={Boolean(patientId)} onClose={onClose} width="max-w-2xl" title={p?.name || 'Patient'}
            subtitle={p ? [p.phone, age(p.dob), p.gender && titleCase(p.gender)].filter(Boolean).join(' · ') : ''}>
      {t.isLoading && <div className="flex justify-center py-10"><Spinner className="h-5 w-5" /></div>}
      {t.error && <p className="text-sm text-alert">{t.error.message}</p>}
      {d && (
        <div className="space-y-5">
          {editing ? <ContactEditor patient={p} onDone={() => setEditing(false)} /> : (
            <div className="rounded-lg bg-paper p-4">
              <KeyValue items={[
                ['Visits', p.visitCount || 0], ['Patient type', titleCase(p.patientType)], ['Last visit', date(p.lastVisitAt)],
                d.access.clinical && ['Allergies', p.allergies?.length ? p.allergies.join(', ') : 'None recorded'],
                d.access.clinical && ['Blood group', p.bloodGroup],
                d.outstanding !== null && ['Outstanding', inr(d.outstanding)],
                ['Messages', p.communicationPrefs?.optOutAll ? 'Opted out' : 'Allowed'],
                ['Marketing consent', p.consent?.marketing?.granted ? 'Yes' : 'No'],
              ]} />
              {canEdit && <button className="btn-quiet btn-sm mt-3" onClick={() => setEditing(true)}>Edit contact & preferences</button>}
              {!d.access.clinical && <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted"><Lock className="h-3 w-3" /> Clinical notes, prescriptions and reports are visible only to the treating doctor and clinic owner.</p>}
            </div>
          )}

          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'visits' && <List items={d.appointments} empty="No visits yet." render={(a) => (
            <Row key={a._id} title={dateTime(a.startAt)} sub={`${a.doctorId?.name || ''}${a.serviceId?.name ? ` · ${a.serviceId.name}` : ''}${a.bookingRef ? ` · ${a.bookingRef}` : ''}`} right={<StatusBadge status={a.status} />} />
          )} />}

          {tab === 'clinical' && (
            <div className="space-y-5">
              <div><h3 className="section-title mb-2">Consultations</h3>
                <List items={d.consultations} empty="No consultations recorded." render={(c) => (
                  <li key={c._id} className="rounded-lg border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between"><p className="text-sm font-medium">{c.diagnosis || 'No diagnosis recorded'}</p><StatusBadge status={c.status} /></div>
                    <p className="text-xs text-ink-muted">{dateTime(c.createdAt)} · {c.doctorId?.name}</p>
                    {c.symptoms && <p className="mt-1 text-sm text-ink-soft">Symptoms: {c.symptoms}</p>}
                    {c.treatmentPlan && <p className="text-sm text-ink-soft">Plan: {c.treatmentPlan}</p>}
                    {c.addenda?.map((x) => <p key={x._id} className="mt-1 border-l-2 border-signal pl-2 text-xs">Addendum {date(x.at)}: {x.text}</p>)}
                  </li>
                )} />
              </div>
              <div><h3 className="section-title mb-2">Prescriptions</h3>
                <List items={d.prescriptions} empty="No prescriptions." render={(r) => (
                  <Row key={r._id} title={`${r.rxNumber} · ${r.medicines.map((m) => m.name).join(', ') || 'Advice only'}`} sub={`${date(r.finalizedAt || r.createdAt)} · ${r.doctorId?.name || ''}`}
                       right={<><StatusBadge status={r.status} />{r.status === 'FINAL' && fileBtn('prescription', r._id)}</>} />
                )} />
              </div>
              <div><h3 className="section-title mb-2">Follow-ups</h3>
                <List items={d.followUps} empty="No follow-ups." render={(f) => <Row key={f._id} title={`Due ${date(f.dueDate)}`} sub={f.instructions || f.reason} right={<StatusBadge status={f.status} />} />} />
              </div>
            </div>
          )}

          {tab === 'files' && (
            <div className="space-y-5">
              <div><h3 className="section-title mb-2">Lab orders</h3>
                <List items={d.labOrders} empty="No lab orders." render={(o) => (
                  <Row key={o._id} title={`${o.orderNumber} · ${o.tests.map((x) => x.name).join(', ')}`} sub={date(o.createdAt)}
                       right={<><StatusBadge status={o.status} />{['VERIFIED', 'RESULT_SUBMITTED'].includes(o.status) && fileBtn('labReport', o._id, 'Report')}{o.report?.storageKey && fileBtn('labFile', o._id, 'File')}</>} />
                )} />
              </div>
              <div><h3 className="section-title mb-2">Certificates</h3>
                <List items={d.certificates} empty="No certificates." render={(c) => <Row key={c._id} title={`${c.certificateNumber} · ${titleCase(c.type)}`} sub={date(c.issuedAt || c.createdAt)} right={<><StatusBadge status={c.status} />{c.status === 'ISSUED' && fileBtn('certificate', c._id)}</>} />} />
              </div>
              <div><h3 className="section-title mb-2">Documents</h3>
                <List items={d.documents} empty="No documents attached." render={(x) => <Row key={x._id} title={x.title} sub={`${titleCase(x.category)} · ${date(x.createdAt)} · ${x.sharedWithPatient ? 'shared with patient' : 'clinic only'}`} right={fileBtn('document', x._id, 'Open')} />} />
                {user?.role === 'DOCTOR' && <DocumentUpload patientId={patientId} />}
              </div>
            </div>
          )}

          {tab === 'billing' && (
            <div className="space-y-5">
              <List items={d.invoices} empty="No invoices." render={(i) => <Row key={i._id} title={`${i.invoiceNumber} · ${inr(i.total)}`} sub={`${date(i.createdAt)} · paid ${inr(i.amountPaid)}`} right={<><StatusBadge status={i.status} />{fileBtn('invoice', i._id)}</>} />} />
              <h3 className="section-title">Payments</h3>
              <List items={d.payments} empty="No payments." render={(x) => <Row key={x._id} title={`${inr(x.amount)} · ${x.method}`} sub={`${dateTime(x.verifiedAt || x.createdAt)} · ${x.receiptNumber || ''}`} right={<StatusBadge status={x.status} />} />} />
            </div>
          )}

          {tab === 'messages' && <List items={d.communications} empty="No messages yet." render={(m) => (
            <Row key={m._id} title={titleCase(m.event)} sub={`${m.channel} · ${dateTime(m.createdAt)}${m.error ? ` · ${m.error}` : ''}`} right={<StatusBadge status={m.status} />} />
          )} />}
        </div>
      )}
      {!d && !t.isLoading && !t.error && <EmptyState title="Select a patient" />}
    </Drawer>
  );
}
