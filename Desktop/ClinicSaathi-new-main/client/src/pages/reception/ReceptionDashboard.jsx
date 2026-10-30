import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { CalendarCheck, Clock, CheckCircle2, UserX, CalendarPlus, Footprints, UserPlus, Siren } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Section, Field, Tabs, fieldErrors } from '../../components/ui/Page.jsx';
import { BookingForm, PatientPicker } from '../clinic/BookingForm.jsx';
import { RescheduleDialog } from '../clinic/RescheduleDialog.jsx';
import { time, inr } from '../../lib/format.js';

export default function ReceptionDashboard() {
  const qc = useQueryClient();
  const { hasFeature } = useAuth();
  const [moving, setMoving] = useState(null);
  const [view, setView] = useState('today');
  const upcoming = useQuery({
    queryKey: ['appointments', 'reception-upcoming'],
    queryFn: () => api.get('/appointments', { params: { from: dayjs().add(1, 'day').format('YYYY-MM-DD'), to: dayjs().add(7, 'day').format('YYYY-MM-DD'), status: 'REQUESTED,CONFIRMED', limit: 200 } }).then(unwrap),
    enabled: view === 'upcoming',
  });
  const today = useQuery({
    queryKey: ['appointments', 'reception-today'],
    queryFn: () => api.get('/appointments', { params: { date: dayjs().format('YYYY-MM-DD'), limit: 200 } }).then(unwrap),
    refetchInterval: 60_000,
  });
  useEffect(() => onSocket(['appointment:created', 'appointment:updated', 'appointment:cancelled', 'queue:updated'], () => qc.invalidateQueries({ queryKey: ['appointments'] })), [qc]);

  const act = useMutation({
    mutationFn: ({ id, action }) => (action === 'checkin' ? api.post('/queue/check-in', { appointmentId: id }) : api.post(`/appointments/${id}/${action}`)),
    onSuccess: (res, { action }) => {
      toast.success(action === 'checkin' ? `Token ${res.data.data.tokenNumber} issued` : action === 'confirm' ? 'Confirmed' : 'Marked as no-show');
      qc.invalidateQueries({ queryKey: ['appointments'] }); qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = today.data || [];
  const count = (...s) => rows.filter((r) => s.includes(r.status)).length;
  // Every reception view of the day, as one tab strip.
  const VIEWS = {
    today: { label: "Today's", rows },
    upcoming: { label: 'Upcoming (7 days)', rows: upcoming.data || [] },
    waiting: { label: 'Waiting list', rows: rows.filter((r) => ['CHECKED_IN', 'WAITING'].includes(r.status)) },
    completed: { label: 'Completed', rows: rows.filter((r) => r.status === 'COMPLETED') },
    cancelled: { label: 'Cancelled', rows: rows.filter((r) => r.status === 'CANCELLED') },
    noshow: { label: 'No-shows', rows: rows.filter((r) => r.status === 'NO_SHOW') },
    walkin: { label: 'Walk-ins', rows: rows.filter((r) => r.source === 'WALK_IN') },
    emergency: { label: 'Emergency', rows: rows.filter((r) => r.isEmergency) },
  };
  const current = VIEWS[view];
  const loading = view === 'upcoming' ? upcoming.isLoading : today.isLoading;
  const canQueue = hasFeature('queue');

  return (
    <div className="space-y-6">
      <PageHeader title="Today's appointments" description={dayjs().format('dddd, D MMMM YYYY')} actions={<>
        <Link to="/clinic/reception/walk-in" className="btn-ghost"><Footprints className="h-4 w-4" /> Walk-in</Link>
        <Link to="/clinic/reception/register" className="btn-ghost"><UserPlus className="h-4 w-4" /> Register</Link>
        <Link to="/clinic/reception/new-appointment" className="btn-primary"><CalendarPlus className="h-4 w-4" /> New appointment</Link>
      </>} />
      <KpiGrid>
        <KpiCard icon={CalendarCheck} label="Booked today" value={rows.length} hint={`${count('REQUESTED', 'CONFIRMED')} yet to arrive`} />
        <KpiCard icon={Clock} tone="amber" label="In clinic" value={count('WAITING', 'CHECKED_IN', 'IN_CONSULTATION')} />
        <KpiCard icon={CheckCircle2} tone="navy" label="Seen" value={count('COMPLETED')} />
        <KpiCard icon={UserX} tone="red" label="No-shows / cancelled" value={count('NO_SHOW', 'CANCELLED')} />
      </KpiGrid>
      <Tabs value={view} onChange={setView} tabs={Object.entries(VIEWS).map(([value, v]) => ({ value, label: v.label, count: value === 'upcoming' && !upcoming.data ? undefined : v.rows.length }))} />
      <DataTable
        loading={loading} error={today.error || upcoming.error} onRetry={today.refetch} rows={current.rows}
        empty={<EmptyState title={view === 'today' ? 'Nothing booked today' : `No ${current.label.toLowerCase()} appointments`} action={view === 'today' && <Link to="/clinic/reception/walk-in" className="btn-primary">Register a walk-in</Link>} />}
        columns={[
          { key: 'time', header: 'Time', sort: (r) => r.startAt, render: (r) => <span className="font-mono text-sm">{view === 'upcoming' ? dayjs(r.startAt).format('ddd D MMM, h:mm A') : r.source === 'WALK_IN' ? 'Walk-in' : time(r.startAt)}</span> },
          { key: 'patient', header: 'Patient', sort: (r) => r.patientId?.name, render: (r) => (
            <div>
              <p className="flex items-center gap-1.5 font-medium">{r.patientId?.name}
                {r.isEmergency && <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-px text-[10px] font-bold uppercase text-rose-700"><Siren className="h-3 w-3" />Emergency</span>}
              </p>
              <p className="font-mono text-xs text-ink-muted">{r.patientId?.phone}</p>
            </div>
          ) },
          { key: 'doctor', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name },
          { key: 'pay', header: 'Payment', hideOnMobile: true, render: (r) => <span className="text-sm">{inr(r.fee)} <StatusBadge status={r.paymentStatus} /></span> },
          { key: 'status', header: 'Status', sort: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
          { key: 'actions', header: '', className: 'text-right', render: (r) => (
            <div className="flex justify-end gap-1">
              {r.status === 'REQUESTED' && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: r._id, action: 'confirm' })}>Confirm</button>}
              {r.status === 'CONFIRMED' && canQueue && <button className="btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ id: r._id, action: 'checkin' })}>Check in</button>}
              {['CONFIRMED', 'REQUESTED'].includes(r.status) && dayjs(r.startAt).isAfter(dayjs()) && r.slotKey && <button className="btn-quiet btn-sm" onClick={() => setMoving(r)}>Reschedule</button>}
              {['CONFIRMED', 'REQUESTED'].includes(r.status) && dayjs(r.startAt).isBefore(dayjs()) && <button className="btn-quiet btn-sm" onClick={() => act.mutate({ id: r._id, action: 'no-show' })}>No-show</button>}
            </div>
          ) },
        ]}
      />
      {moving && <RescheduleDialog appointment={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

export function NewAppointment() {
  return (
    <div>
      <PageHeader title="New appointment" description="Pick a doctor and an open slot. Availability is re-checked when you book, so two desks can't double-book." />
      <Section><BookingForm /></Section>
    </div>
  );
}

/** Walk-in: find or register the patient and put them straight into the doctor's queue. */
export function WalkIn() {
  const qc = useQueryClient();
  const [patient, setPatient] = useState(null);
  const [f, setF] = useState({ name: '', phone: '', doctorId: '', serviceId: '', reason: '', priority: false, emergency: false });
  const [errors, setErrors] = useState({});
  const [last, setLast] = useState(null);
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services').then(unwrap) });
  const go = useMutation({
    mutationFn: () => api.post('/appointments/walk-in', {
      doctorId: f.doctorId, serviceId: f.serviceId || undefined, reason: f.reason || undefined, priority: f.priority ? 5 : 0, emergency: f.emergency,
      ...(patient ? { patientId: patient._id } : { newPatient: { name: f.name, phone: f.phone } }),
    }).then(unwrap),
    onSuccess: (d) => {
      setLast(d);
      toast.success(d.token ? `Token ${d.token.tokenNumber} issued` : 'Walk-in registered');
      setPatient(null); setF({ ...f, name: '', phone: '', reason: '', priority: false, emergency: false }); setErrors({});
      qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const ready = f.doctorId && (patient || (f.name.trim().length > 1 && f.phone.replace(/\D/g, '').length >= 10));
  return (
    <div className="space-y-6">
      <PageHeader title="Walk-in patients" description="Registers the visit now and issues the next token in the doctor's queue." />
      {last?.token && (
        <div className="card flex items-center gap-4 border-pulse/40 bg-pulse-soft/40 p-4">
          <span className="flex h-14 w-20 items-center justify-center rounded-xl bg-pulse font-mono text-xl font-semibold text-white">{last.token.tokenNumber}</span>
          <p className="text-sm">Token issued. The patient now appears in the waiting queue.</p>
        </div>
      )}
      <Section>
        <div className="space-y-4">
          <Field label="Existing patient"><PatientPicker value={patient} onChange={setPatient} /></Field>
          {!patient && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New patient name" htmlFor="wi-name" error={errors['newPatient.name']}><input id="wi-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Mobile number" htmlFor="wi-phone" error={errors['newPatient.phone']}><input id="wi-phone" type="tel" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Doctor" htmlFor="wi-doc"><select id="wi-doc" className="field" value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}><option value="">Choose a doctor</option>{doctors.data?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></Field>
            <Field label="Service" htmlFor="wi-svc"><select id="wi-svc" className="field" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}><option value="">General consultation</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
            <Field label="Reason" htmlFor="wi-r"><input id="wi-r" className="field" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <label className="mt-7 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.priority} onChange={(e) => setF({ ...f, priority: e.target.checked })} /> Priority (elderly, pregnant, unwell)</label>
          </div>
          <label className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition-colors ${f.emergency ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-line'}`}>
            <input type="checkbox" checked={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.checked })} />
            <Siren className={`h-4 w-4 ${f.emergency ? 'text-rose-600' : 'text-ink-muted'}`} />
            <span><b>Emergency booking</b> — goes to the top of the doctor's queue and is flagged on every desk view.</span>
          </label>
          <div className="flex justify-end"><button className="btn-primary" disabled={!ready || go.isPending} onClick={() => go.mutate()}>{go.isPending && <Spinner />} Register and issue token</button></div>
        </div>
      </Section>
    </div>
  );
}
