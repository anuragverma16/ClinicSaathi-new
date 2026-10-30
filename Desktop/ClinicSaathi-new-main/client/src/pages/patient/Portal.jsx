import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { CalendarPlus, Download, Send, Siren, Sparkles, Clock, FileText, Receipt, Plus } from 'lucide-react';
import { api, unwrap, openFile, razorpayCheckout } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section, Field, Tabs, useReasonPrompt } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner, Skeleton } from '../../components/ui/States.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { inr, inr2, date, dateTime, titleCase } from '../../lib/format.js';

const usePortalMe = () => useQuery({ queryKey: ['portal', 'me'], queryFn: () => api.get('/portal/me').then(unwrap) });
const dl = (kind, id, label = 'Download') => (
  <button className="btn-ghost btn-sm" onClick={() => openFile(kind, id).catch((e) => toast.error(e.message))}><Download className="h-3.5 w-3.5" /> {label}</button>
);

/** Opens Razorpay for a prepaid booking or invoice, then has the server verify it. */
async function payNow({ order, keyId, me, label }) {
  const resp = await razorpayCheckout({ keyId, order, name: me?.clinic?.name || 'Clinic', description: label, prefill: { name: me?.patient?.name, contact: me?.patient?.phone } });
  return unwrap(await api.post('/portal/payments/verify', resp));
}

function PortalSlots({ doctorId, serviceId, date: day, value, onChange }) {
  const s = useQuery({ queryKey: ['portal', 'slots', doctorId, serviceId, day], queryFn: () => api.get('/portal/availability', { params: { doctorId, serviceId: serviceId || undefined, date: day } }).then(unwrap), enabled: Boolean(doctorId), staleTime: 0 });
  if (!doctorId) return <p className="muted">Choose a doctor first.</p>;
  if (s.isLoading) return <Spinner />;
  if (!s.data?.slots?.length) return <p className="rounded-lg bg-signal-soft px-3 py-2 text-sm text-signal">{s.data?.reason || 'No open times that day.'}</p>;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {s.data.slots.map((x) => (
        <button key={x.slotKey} type="button" aria-pressed={value === x.startAt} onClick={() => onChange(x.startAt)}
                className={`rounded-lg border py-2 font-mono text-sm ${value === x.startAt ? 'border-pulse bg-pulse text-white' : 'border-line bg-surface hover:border-pulse'}`}>
          {dayjs(x.startAt).format('h:mm A')}
        </button>
      ))}
    </div>
  );
}

export function PatientDashboard() {
  const me = usePortalMe();
  const appts = useQuery({ queryKey: ['portal', 'appointments'], queryFn: () => api.get('/portal/appointments').then(unwrap) });
  const queue = useQuery({ queryKey: ['portal', 'queue'], queryFn: () => api.get('/portal/queue').then(unwrap), refetchInterval: 20_000 });
  const records = useQuery({ queryKey: ['portal', 'records'], queryFn: () => api.get('/portal/records').then(unwrap) });
  const billing = useQuery({ queryKey: ['portal', 'billing'], queryFn: () => api.get('/portal/billing').then(unwrap) });
  const upcoming = (appts.data || []).filter((a) => ['REQUESTED', 'CONFIRMED'].includes(a.status) && dayjs(a.startAt).isAfter(dayjs())).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const dues = (billing.data?.invoices || []).filter((i) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status));
  const recCount = records.data ? records.data.prescriptions.length + records.data.labReports.length + records.data.certificates.length + records.data.documents.length : null;
  return (
    <div className="space-y-6">
      <PageHeader title={`Hello, ${me.data?.patient?.name?.split(' ')[0] || ''}`} description={me.data?.clinic?.name}
        actions={<Link to="/patient/book" className="btn-primary"><CalendarPlus className="h-4 w-4" /> Book appointment</Link>} />
      {queue.data?.map((q) => (
        <div key={q.tokenNumber} className="card flex items-center gap-4 border-pulse/40 bg-pulse-soft/40 p-4">
          <span className="flex h-16 w-20 items-center justify-center rounded-xl bg-pulse font-mono text-2xl font-semibold text-white">{q.tokenNumber}</span>
          <div>
            <p className="font-medium">{q.status === 'CALLED' ? 'It\'s your turn — please go in' : q.status === 'IN_CONSULTATION' ? 'With the doctor' : `${q.patientsAhead} ahead of you · about ${q.estimatedWaitMins} min`}</p>
            <p className="text-sm text-ink-muted">{q.doctor} · updates live</p>
          </div>
        </div>
      ))}
      <KpiGrid>
        <KpiCard icon={CalendarPlus} label="Upcoming visits" value={upcoming.length} hint={upcoming[0] ? `Next: ${dateTime(upcoming[0].startAt)}` : 'None booked'} />
        <KpiCard icon={FileText} tone="navy" label="Records available" value={recCount} />
        <KpiCard icon={Receipt} tone="amber" label="Amount due" value={dues.reduce((s, i) => s + i.total - i.amountPaid, 0)} format={inr} />
        <KpiCard icon={Clock} label="Past visits" value={(appts.data || []).filter((a) => a.status === 'COMPLETED').length} />
      </KpiGrid>
      <Section title="Next appointment" actions={<Link to="/patient/appointments" className="text-sm text-pulse-deep hover:underline">All appointments</Link>}>
        {appts.isLoading ? <Skeleton className="h-16" /> : upcoming[0] ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-display text-lg font-semibold">{dayjs(upcoming[0].startAt).format('dddd, D MMMM · h:mm A')}</p><p className="text-sm text-ink-muted">{upcoming[0].doctorId?.name} · {upcoming[0].serviceId?.name || 'Consultation'} · ref {upcoming[0].bookingRef}</p></div>
            <StatusBadge status={upcoming[0].status} />
          </div>
        ) : <EmptyState title="No upcoming appointments" action={<Link to="/patient/book" className="btn-primary">Book now</Link>} />}
      </Section>
    </div>
  );
}

export function PatientBook() {
  const qc = useQueryClient();
  const me = usePortalMe();
  const opts = useQuery({ queryKey: ['portal', 'doctors'], queryFn: () => api.get('/portal/doctors').then(unwrap) });
  const [f, setF] = useState({ doctorId: '', serviceId: '', date: dayjs().format('YYYY-MM-DD'), startAt: '', reason: '', patientId: '' });
  const [done, setDone] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, ...(['doctorId', 'serviceId', 'date'].includes(k) ? { startAt: '' } : {}) }));
  const book = useMutation({
    mutationFn: async () => {
      const r = unwrap(await api.post('/portal/appointments', { doctorId: f.doctorId, serviceId: f.serviceId || undefined, startAt: f.startAt, reason: f.reason || undefined, patientId: f.patientId || undefined }));
      if (r.payment) {
        try { await payNow({ ...r.payment, me: me.data, label: `Booking ${r.appointment.bookingRef}` }); r.paid = true; } catch (e) { r.payError = e.message; }
      }
      return r;
    },
    onSuccess: (r) => { setDone(r); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e) => { toast.error(e.message); if (e.code === 'SLOT_UNAVAILABLE') { set('startAt', ''); qc.invalidateQueries({ queryKey: ['portal', 'slots'] }); } },
  });
  const doctor = opts.data?.doctors?.find((d) => d._id === f.doctorId);
  const service = opts.data?.services?.find((s) => s._id === f.serviceId);
  if (done) {
    const a = done.appointment;
    return (
      <Section>
        <div className="py-6 text-center">
          <p className="font-display text-2xl font-semibold">{a.status === 'CONFIRMED' || done.paid ? 'You\'re booked' : 'Slot held — payment pending'}</p>
          <p className="mt-2 text-ink-soft">{doctor?.name} · {dayjs(a.startAt).format('dddd D MMMM, h:mm A')}</p>
          <p className="mt-1 font-mono text-sm">Reference {a.bookingRef}</p>
          {done.payError && <p className="mx-auto mt-3 max-w-md rounded-lg bg-signal-soft p-3 text-sm text-signal">{done.payError}. Your slot is held until {dayjs(done.payment.holdExpiresAt).format('h:mm A')} — pay from Invoices to confirm.</p>}
          <div className="mt-5 flex justify-center gap-2"><Link to="/patient/appointments" className="btn-primary">My appointments</Link><button className="btn-ghost" onClick={() => setDone(null)}>Book another</button></div>
        </div>
      </Section>
    );
  }
  return (
    <div>
      <PageHeader title="Book an appointment" description="Times shown are the doctor's real open slots." />
      <Section>
        <div className="space-y-5">
          {me.data?.dependents?.length > 0 && (
            <Field label="Who is the appointment for?" htmlFor="pb-who">
              <select id="pb-who" className="field" value={f.patientId} onChange={(e) => set('patientId', e.target.value)}>
                <option value="">Myself</option>{me.data.dependents.map((d) => <option key={d._id} value={d._id}>{d.name} ({d.relationToGuardian})</option>)}
              </select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Doctor" htmlFor="pb-doc"><select id="pb-doc" className="field" value={f.doctorId} onChange={(e) => set('doctorId', e.target.value)}><option value="">Choose a doctor</option>{opts.data?.doctors?.map((d) => <option key={d._id} value={d._id}>{d.name}{d.specialization ? ` — ${d.specialization}` : ''} · {inr(d.consultationFee)}</option>)}</select></Field>
            <Field label="Service" htmlFor="pb-svc"><select id="pb-svc" className="field" value={f.serviceId} onChange={(e) => set('serviceId', e.target.value)}><option value="">Consultation</option>{opts.data?.services?.map((s) => <option key={s._id} value={s._id}>{s.name} · {inr(s.fee)}</option>)}</select></Field>
          </div>
          <Field label="Date" htmlFor="pb-date" className="max-w-[220px]"><input id="pb-date" type="date" className="field" min={dayjs().format('YYYY-MM-DD')} max={dayjs().add(me.data?.clinic?.bookingPolicy?.maxAdvanceDays || 60, 'day').format('YYYY-MM-DD')} value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Time"><PortalSlots doctorId={f.doctorId} serviceId={f.serviceId} date={f.date} value={f.startAt} onChange={(v) => set('startAt', v)} /></Field>
          <Field label="Reason (optional)" htmlFor="pb-r"><input id="pb-r" className="field" value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Fee {inr(service?.fee ?? doctor?.consultationFee ?? 0)}{me.data?.clinic?.bookingPolicy?.requirePrepayment ? ' · payable online to confirm' : ' · pay at the clinic'}</p>
            <button className="btn-primary" disabled={!f.startAt || book.isPending} onClick={() => book.mutate()}>{book.isPending && <Spinner />} Confirm booking</button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function PortalReschedule({ appointment, onClose }) {
  const qc = useQueryClient();
  const [day, setDay] = useState(dayjs(appointment.startAt).format('YYYY-MM-DD'));
  const [startAt, setStartAt] = useState('');
  const go = useMutation({
    mutationFn: () => api.post(`/portal/appointments/${appointment._id}/reschedule`, { startAt }),
    onSuccess: () => { toast.success('Appointment moved'); qc.invalidateQueries({ queryKey: ['portal'] }); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal open onClose={onClose} title="Reschedule" footer={<><button className="btn-ghost" onClick={onClose}>Back</button><button className="btn-primary" disabled={!startAt || go.isPending} onClick={() => go.mutate()}>Move appointment</button></>}>
      <div className="space-y-4">
        <Field label="New date" htmlFor="pr-d"><input id="pr-d" type="date" className="field" min={dayjs().format('YYYY-MM-DD')} value={day} onChange={(e) => { setDay(e.target.value); setStartAt(''); }} /></Field>
        <PortalSlots doctorId={appointment.doctorId?._id} serviceId={appointment.serviceId?._id} date={day} value={startAt} onChange={setStartAt} />
      </div>
    </Modal>
  );
}

export function PatientAppointments() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('upcoming');
  const [moving, setMoving] = useState(null);
  const [askReason, reasonDialog] = useReasonPrompt();
  const me = usePortalMe();
  const appts = useQuery({ queryKey: ['portal', 'appointments'], queryFn: () => api.get('/portal/appointments').then(unwrap) });
  const cancel = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/portal/appointments/${id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Appointment cancelled'); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e) => toast.error(e.message),
  });
  const list = (appts.data || []).filter((a) => (tab === 'upcoming' ? ['REQUESTED', 'CONFIRMED', 'WAITING', 'IN_CONSULTATION', 'CHECKED_IN'].includes(a.status) && dayjs(a.endAt).isAfter(dayjs().subtract(2, 'hour')) : true));
  const cutoff = me.data?.clinic?.bookingPolicy?.cancelCutoffHours ?? 2;
  return (
    <div>
      <PageHeader title="My appointments" description={`You can cancel or reschedule up to ${cutoff} hours before the appointment.`} actions={<Link to="/patient/book" className="btn-primary"><CalendarPlus className="h-4 w-4" /> Book</Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'all', label: 'All' }]} />
      {appts.isLoading ? <Skeleton className="h-40" /> : !list.length ? <div className="card"><EmptyState title="No appointments here" /></div> : (
        <ul className="space-y-3">
          {list.map((a) => {
            const changeable = ['REQUESTED', 'CONFIRMED'].includes(a.status) && dayjs(a.startAt).diff(dayjs(), 'minute') > cutoff * 60;
            return (
              <li key={a._id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{dayjs(a.startAt).format('ddd, D MMM YYYY · h:mm A')}</p>
                  <p className="text-sm text-ink-muted">{a.doctorId?.name} · {a.serviceId?.name || 'Consultation'}{a.patientId?.name ? ` · for ${a.patientId.name}` : ''} · <span className="font-mono">{a.bookingRef}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  {changeable && <><button className="btn-ghost btn-sm" onClick={() => setMoving(a)}>Reschedule</button>
                    <button className="btn-quiet btn-sm text-alert" onClick={async () => { const reason = await askReason({ title: 'Cancel this appointment?', confirmLabel: 'Cancel appointment', danger: true }); if (reason) cancel.mutate({ id: a._id, reason }); }}>Cancel</button></>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {moving && <PortalReschedule appointment={moving} onClose={() => setMoving(null)} />}
      {reasonDialog}
    </div>
  );
}

export function PatientRecords() {
  const r = useQuery({ queryKey: ['portal', 'records'], queryFn: () => api.get('/portal/records').then(unwrap) });
  const d = r.data;
  const Block = ({ title, items, render }) => (
    <Section title={title}>{!items?.length ? <p className="muted">Nothing yet.</p> : <ul className="divide-y divide-line">{items.map(render)}</ul>}</Section>
  );
  const row = (key, main, sub, action) => <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><div><p className="text-sm font-medium">{main}</p><p className="text-xs text-ink-muted">{sub}</p></div>{action}</li>;
  return (
    <div className="space-y-5">
      <PageHeader title="Prescriptions and reports" description="Only records your doctor has signed or verified appear here. Downloads use a private link that expires in minutes." />
      {r.isLoading ? <Skeleton className="h-60" /> : <>
        <Block title="Prescriptions" items={d.prescriptions} render={(x) => row(x._id, `${x.rxNumber} · ${x.medicines.map((m) => m.name).join(', ') || 'Advice'}`, `${date(x.finalizedAt)} · ${x.doctorId?.name || ''} · ${x.patientId?.name || ''}`, dl('prescription', x._id))} />
        <Block title="Lab reports" items={d.labReports} render={(x) => row(x._id, `${x.orderNumber} · ${x.tests.map((t) => t.name).join(', ')}`, `${date(x.verifiedAt)} · ${x.patientId?.name || ''}`, <div className="flex gap-1">{dl('labReport', x._id, 'Report')}{x.report?.fileName && dl('labFile', x._id, 'Original')}</div>)} />
        <Block title="Medical certificates" items={d.certificates} render={(x) => row(x._id, `${x.certificateNumber} · ${titleCase(x.type)}`, date(x.issuedAt), dl('certificate', x._id))} />
        <Block title="Shared documents" items={d.documents} render={(x) => row(x._id, x.title, `${titleCase(x.category)} · ${date(x.createdAt)}`, dl('document', x._id, 'Open'))} />
      </>}
    </div>
  );
}

export function PatientBilling() {
  const qc = useQueryClient();
  const me = usePortalMe();
  const b = useQuery({ queryKey: ['portal', 'billing'], queryFn: () => api.get('/portal/billing').then(unwrap) });
  const pay = useMutation({
    mutationFn: async (inv) => { const o = unwrap(await api.post(`/portal/invoices/${inv._id}/pay`)); return payNow({ ...o, me: me.data, label: inv.invoiceNumber }); },
    onSuccess: (r) => { toast.success(r.status === 'SUCCESS' ? 'Payment received — thank you' : 'Payment authorised, confirming shortly'); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Invoices and payments" />
      <Section title="Invoices">
        {b.isLoading ? <Skeleton className="h-32" /> : !b.data?.invoices?.length ? <p className="muted">No invoices yet.</p> : (
          <ul className="divide-y divide-line">
            {b.data.invoices.map((i) => (
              <li key={i._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div><p className="text-sm font-medium">{i.invoiceNumber} · {inr2(i.total)}</p><p className="text-xs text-ink-muted">{date(i.createdAt)} · paid {inr2(i.amountPaid)}</p></div>
                <div className="flex items-center gap-2"><StatusBadge status={i.status} />{dl('invoice', i._id, 'PDF')}
                  {['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status) && (b.data.onlinePayments
                    ? <button className="btn-primary btn-sm" disabled={pay.isPending} onClick={() => pay.mutate(i)}>Pay {inr2(i.total - i.amountPaid)}</button>
                    : <span className="text-xs text-ink-muted">Pay at the clinic</span>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Payments and receipts">
        {!b.data?.payments?.length ? <p className="muted">No payments yet.</p> : (
          <ul className="divide-y divide-line">
            {b.data.payments.map((p) => <li key={p._id} className="flex items-center justify-between py-2.5 text-sm"><span>{inr2(p.amount)} · {titleCase(p.method)} · {dateTime(p.verifiedAt)}</span><span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.receiptNumber && dl('receipt', p._id, 'Receipt')}</span></li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function PatientProfile() {
  const qc = useQueryClient();
  const me = usePortalMe();
  const [f, setF] = useState(null);
  const [dep, setDep] = useState({ name: '', relationToGuardian: '', gender: '', dob: '' });
  useEffect(() => {
    const p = me.data?.patient;
    if (p) setF({ name: p.name, email: p.email || '', gender: p.gender || '', dob: p.dob ? dayjs(p.dob).format('YYYY-MM-DD') : '', prefs: { whatsapp: p.communicationPrefs?.whatsapp !== false, sms: p.communicationPrefs?.sms !== false, email: p.communicationPrefs?.email !== false, optOutAll: Boolean(p.communicationPrefs?.optOutAll) }, marketing: Boolean(p.consent?.marketing?.granted) });
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/portal/me', { name: f.name, email: f.email, ...(f.gender ? { gender: f.gender } : {}), ...(f.dob ? { dob: f.dob } : {}), communicationPrefs: f.prefs, marketingConsent: f.marketing }),
    onSuccess: () => { toast.success('Profile saved'); qc.invalidateQueries({ queryKey: ['portal', 'me'] }); },
    onError: (e) => toast.error(e.message),
  });
  const addDep = useMutation({
    mutationFn: () => api.post('/portal/dependents', { name: dep.name, relationToGuardian: dep.relationToGuardian, ...(dep.gender ? { gender: dep.gender } : {}), ...(dep.dob ? { dob: dep.dob } : {}) }),
    onSuccess: () => { toast.success('Family member added'); setDep({ name: '', relationToGuardian: '', gender: '', dob: '' }); qc.invalidateQueries({ queryKey: ['portal', 'me'] }); },
    onError: (e) => toast.error(e.message),
  });
  if (!f) return <Skeleton className="h-80" />;
  return (
    <div className="space-y-5">
      <PageHeader title="Profile and family" description={`Signed in with ${me.data.patient.phone}`} />
      <Section title="Your details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="pp-n"><input id="pp-n" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" htmlFor="pp-e"><input id="pp-e" type="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Gender" htmlFor="pp-g"><select id="pp-g" className="field" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field>
          <Field label="Date of birth" htmlFor="pp-d"><input id="pp-d" type="date" className="field" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} /></Field>
        </div>
        <h3 className="section-title mt-6">Messages</h3>
        <div className="mt-2 space-y-2 text-sm">
          {['whatsapp', 'sms', 'email'].map((k) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f.prefs[k]} onChange={(e) => setF({ ...f, prefs: { ...f.prefs, [k]: e.target.checked } })} /> {k === 'sms' ? 'SMS' : titleCase(k)} reminders and updates</label>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.checked })} /> Check-up reminders and clinic announcements</label>
          <label className="flex items-center gap-2 text-alert"><input type="checkbox" checked={f.prefs.optOutAll} onChange={(e) => setF({ ...f, prefs: { ...f.prefs, optOutAll: e.target.checked } })} /> Stop all automated messages</label>
        </div>
        <div className="mt-5 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button></div>
      </Section>
      <Section title="Family members">
        <ul className="mb-4 divide-y divide-line">
          {me.data.dependents.map((d) => <li key={d._id} className="py-2 text-sm">{d.name} <span className="text-ink-muted">· {d.relationToGuardian}</span></li>)}
          {!me.data.dependents.length && <li className="py-2 text-sm text-ink-muted">Add children or parents you book for.</li>}
        </ul>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name" htmlFor="dp-n"><input id="dp-n" className="field" value={dep.name} onChange={(e) => setDep({ ...dep, name: e.target.value })} /></Field>
          <Field label="Relation" htmlFor="dp-r"><input id="dp-r" className="field" placeholder="Son, Mother…" value={dep.relationToGuardian} onChange={(e) => setDep({ ...dep, relationToGuardian: e.target.value })} /></Field>
          <button className="btn-ghost" disabled={dep.name.length < 2 || dep.relationToGuardian.length < 2 || addDep.isPending} onClick={() => addDep.mutate()}><Plus className="h-4 w-4" /> Add</button>
        </div>
      </Section>
    </div>
  );
}

/**
 * Booking assistant. It only ever offers slots the server returned and books
 * only after an explicit choice and "yes". Emergencies get 108 guidance.
 */
export function PatientAssistant() {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState([{ from: 'bot', text: 'Hi! Tell me who you\'d like to see and when — for example, "I need a dermatologist this Friday after 5 PM".' }]);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  const send = useMutation({
    mutationFn: (message) => api.post('/portal/assistant', { message }).then(unwrap),
    onSuccess: (r) => {
      setMsgs((m) => [...m, { from: 'bot', text: r.reply, suggestions: r.suggestions, emergency: r.emergency }]);
      if (r.booked) qc.invalidateQueries({ queryKey: ['portal'] });
    },
    onError: (e) => setMsgs((m) => [...m, { from: 'bot', text: e.message }]),
  });
  const say = (t) => { if (!t.trim()) return; setMsgs((m) => [...m, { from: 'me', text: t }]); setText(''); send.mutate(t); };
  return (
    <div>
      <PageHeader title="Booking assistant" description="Finds real open slots and books after you confirm. It can't give medical advice." />
      <div className="card flex h-[60vh] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : ''}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.emergency ? 'border border-alert bg-alert-soft text-alert' : m.from === 'me' ? 'bg-navy text-white' : 'bg-paper-sunk'}`}>
                {m.emergency && <p className="mb-1 flex items-center gap-1 font-semibold"><Siren className="h-4 w-4" /> Emergency</p>}
                <p className="whitespace-pre-line">{m.text}</p>
                {m.suggestions?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.suggestions.map((s, idx) => <button key={s.startAt + s.doctorId} className="btn-ghost btn-sm" onClick={() => say(String(idx + 1))}>{s.label} · {s.doctorName}</button>)}
                  </div>
                )}
                {m.text?.endsWith('Reply YES to confirm.') && <div className="mt-2 flex gap-2"><button className="btn-primary btn-sm" onClick={() => say('yes')}>Yes, book it</button><button className="btn-ghost btn-sm" onClick={() => say('no')}>No</button></div>}
              </div>
            </div>
          ))}
          {send.isPending && <div className="flex items-center gap-2 text-sm text-ink-muted"><Sparkles className="h-4 w-4 animate-pulse" /> Checking the calendar…</div>}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); say(text); }}>
          <input className="field" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" maxLength={1000} />
          <button className="btn-primary" disabled={!text.trim() || send.isPending} aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    </div>
  );
}
