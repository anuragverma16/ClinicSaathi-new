import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { Plus, Search } from 'lucide-react';
import { api, unwrapPage } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Pagination, useReasonPrompt } from '../../components/ui/Page.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { BookingForm } from './BookingForm.jsx';
import { RescheduleDialog } from './RescheduleDialog.jsx';
import { time, inr, date as fmtDate } from '../../lib/format.js';

const STATUSES = ['REQUESTED', 'CONFIRMED', 'WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

const MODES = {
  all: { title: 'Appointments', description: 'Every booking across your clinic — filter, confirm, check in, move or cancel.' },
  checkin: { title: 'Check-in', description: 'Patients due today. Checking in issues a queue token.', today: true, status: 'REQUESTED,CONFIRMED' },
  changes: { title: 'Rescheduling and cancellations', description: 'Upcoming bookings that can still be moved or cancelled.', upcoming: true, status: 'REQUESTED,CONFIRMED' },
  doctor: { title: 'My schedule', description: 'Your booked patients for the selected day.', readOnly: true },
};

export default function Appointments({ mode = 'all', bookPath }) {
  const cfg = MODES[mode];
  const qc = useQueryClient();
  const { hasFeature, user } = useAuth();
  const [day, setDay] = useState(dayjs().format('YYYY-MM-DD'));
  const [status, setStatus] = useState(cfg.status || '');
  const [doctorId, setDoctorId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState(false);
  const [moving, setMoving] = useState(null);
  const [askReason, reasonDialog] = useReasonPrompt();

  const params = {
    ...(cfg.upcoming ? { upcoming: 'true' } : { date: cfg.today ? dayjs().format('YYYY-MM-DD') : day }),
    status: status || undefined, doctorId: doctorId || undefined, q: q || undefined, page, limit: 50,
  };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['appointments', mode, params],
    queryFn: () => api.get('/appointments', { params }).then(unwrapPage),
  });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then((r) => r.data.data), enabled: user?.role !== 'DOCTOR' });
  useEffect(() => onSocket(['appointment:created', 'appointment:updated', 'appointment:cancelled', 'queue:updated'], () => qc.invalidateQueries({ queryKey: ['appointments'] })), [qc]);

  const act = useMutation({
    mutationFn: ({ id, action, body }) => (action === 'checkin'
      ? api.post('/queue/check-in', { appointmentId: id })
      : api.post(`/appointments/${id}/${action}`, body || {})),
    onSuccess: (res, { action }) => {
      const msg = { checkin: `Token ${res.data.data.tokenNumber} issued`, confirm: 'Appointment confirmed', cancel: 'Appointment cancelled — patient notified', 'no-show': 'Marked as no-show' }[action];
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const cancel = async (row) => {
    const reason = await askReason({ title: 'Cancel appointment?', body: `${row.patientId?.name} · ${fmtDate(row.startAt)} ${time(row.startAt)}. The slot is released and the patient is notified.`, confirmLabel: 'Cancel appointment', danger: true });
    if (reason) act.mutate({ id: row._id, action: 'cancel', body: { reason } });
  };
  const busyFor = (id, action) => act.isPending && act.variables?.id === id && act.variables?.action === action;
  const canQueue = hasFeature('queue');
  const isToday = (d) => dayjs(d).isSame(dayjs(), 'day');

  return (
    <div>
      <PageHeader title={cfg.title} description={cfg.description} actions={!cfg.readOnly && (
        bookPath ? <Link to={bookPath} className="btn-primary"><Plus className="h-4 w-4" /> New appointment</Link>
          : <button onClick={() => setBooking(true)} className="btn-primary"><Plus className="h-4 w-4" /> New appointment</button>
      )} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!cfg.today && !cfg.upcoming && (
          <input type="date" value={day} onChange={(e) => { setDay(e.target.value); setPage(1); }} className="field-sm" aria-label="Date" />
        )}
        {!cfg.status && (
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="field-sm" aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
          </select>
        )}
        {user?.role !== 'DOCTOR' && (
          <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setPage(1); }} className="field-sm" aria-label="Doctor">
            <option value="">All doctors</option>
            {doctors.data?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </select>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="field-sm pl-8" placeholder="Patient or booking ref" aria-label="Search appointments" />
        </div>
      </div>

      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={data?.data}
        empty={<EmptyState title={cfg.upcoming ? 'No upcoming bookings' : `Nothing booked for ${dayjs(cfg.today ? undefined : day).format('DD MMM')}`}
                           body="Bookings from the website, WhatsApp, the portal and the front desk land here." />}
        columns={[
          { key: 'time', header: cfg.upcoming ? 'When' : 'Time', sort: (r) => r.startAt, render: (r) => (
            <span className="font-mono text-sm">{cfg.upcoming ? `${dayjs(r.startAt).format('DD MMM')} ` : ''}{time(r.startAt)}</span>
          ) },
          { key: 'patient', header: 'Patient', sort: (r) => r.patientId?.name, render: (r) => (
            <div><p className="font-medium">{r.patientId?.name}</p><p className="font-mono text-xs text-ink-muted">{r.patientId?.phone}</p></div>
          ) },
          ...(user?.role !== 'DOCTOR' ? [{ key: 'doctor', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name }] : []),
          { key: 'for', header: 'For', hideOnMobile: true, render: (r) => r.serviceId?.name || r.reason || 'Consultation' },
          { key: 'ref', header: 'Ref', hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.bookingRef || '—'}</span> },
          ...(user?.role !== 'DOCTOR' ? [{ key: 'fee', header: 'Fee', hideOnMobile: true, render: (r) => <span>{inr(r.fee)} <StatusBadge status={r.paymentStatus} /></span> }] : []),
          { key: 'status', header: 'Status', sort: (r) => r.status, render: (r) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={r.status} />{r.meetingUrl && <a href={r.meetingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100">Join video</a>}</div> },
          ...(!cfg.readOnly ? [{ key: 'actions', header: '', className: 'text-right', render: (r) => (
            <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {r.status === 'REQUESTED' && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: r._id, action: 'confirm' })}>Confirm</button>}
              {r.status === 'CONFIRMED' && canQueue && isToday(r.startAt) && (
                <button className="btn-primary btn-sm" disabled={busyFor(r._id, 'checkin')} onClick={() => act.mutate({ id: r._id, action: 'checkin' })}>
                  {busyFor(r._id, 'checkin') ? <Spinner className="h-3 w-3" /> : 'Check in'}
                </button>
              )}
              {['REQUESTED', 'CONFIRMED'].includes(r.status) && r.slotKey !== null && dayjs(r.startAt).isAfter(dayjs()) && (
                <button className="btn-ghost btn-sm" onClick={() => setMoving(r)}>Reschedule</button>
              )}
              {['REQUESTED', 'CONFIRMED'].includes(r.status) && dayjs(r.startAt).isBefore(dayjs()) && (
                <button className="btn-quiet btn-sm" onClick={() => act.mutate({ id: r._id, action: 'no-show' })}>No-show</button>
              )}
              {['REQUESTED', 'CONFIRMED'].includes(r.status) && <button className="btn-quiet btn-sm text-alert" onClick={() => cancel(r)}>Cancel</button>}
            </div>
          ) }] : []),
        ]}
      />
      <Pagination meta={data?.meta} page={page} onPage={setPage} />

      <Modal open={booking} onClose={() => setBooking(false)} title="New appointment" width="max-w-2xl">
        <BookingForm onBooked={() => setBooking(false)} />
      </Modal>
      {moving && <RescheduleDialog appointment={moving} onClose={() => setMoving(null)} />}
      {reasonDialog}
    </div>
  );
}
