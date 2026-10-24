import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { ClipboardList, PhoneCall, Play, CalendarCheck, Clock, CheckCircle2, FlaskConical } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState } from '../../components/ui/States.jsx';
import { PageHeader, Section } from '../../components/ui/Page.jsx';
import { ConsultationWorkspace } from './ConsultationWorkspace.jsx';
import { time, age } from '../../lib/format.js';

export default function DoctorDashboard() {
  const qc = useQueryClient();
  const { hasFeature, doctor, user } = useAuth();
  const canQueue = hasFeature('queue');
  const [open, setOpen] = useState(null);

  const today = useQuery({ queryKey: ['appointments', 'doctor-today'], queryFn: () => api.get('/appointments', { params: { date: dayjs().format('YYYY-MM-DD') } }).then(unwrap) });
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api.get('/queue').then(unwrap), refetchInterval: 30_000, enabled: canQueue });
  const lab = useQuery({ queryKey: ['lab', 'overview'], queryFn: () => api.get('/lab/overview').then(unwrap) });
  useEffect(() => onSocket(['queue:updated', 'appointment:created', 'appointment:updated'], () => {
    qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['appointments'] });
  }), [qc]);

  const callNext = useMutation({
    mutationFn: () => api.post('/queue/call-next', {}).then(unwrap),
    onSuccess: (t) => { toast.success(`Calling ${t.tokenNumber}`); qc.invalidateQueries({ queryKey: ['queue'] }); },
    onError: (e) => toast.error(e.message),
  });
  const start = useMutation({
    mutationFn: (token) => api.patch(`/queue/${token._id}`, { status: 'IN_CONSULTATION' }).then(() => token),
    onSuccess: (token) => { qc.invalidateQueries({ queryKey: ['queue'] }); openFor(token.appointmentId, token.patientId); },
    onError: (e) => toast.error(e.message),
  });

  const rows = today.data || [];
  const waiting = queue.data?.filter((t) => t.status === 'WAITING').length || 0;
  const current = queue.data?.find((t) => ['CALLED', 'IN_CONSULTATION'].includes(t.status));
  const openFor = (appointmentId, patient) => setOpen({ _id: appointmentId, patientId: patient });

  if (!user?.doctorId) {
    return <div className="card"><EmptyState title="Your login isn't linked to a doctor profile" body="Ask the clinic owner to link your account under Staff Management." /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Good ${dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'}, ${doctor?.name || user?.name}`} description={dayjs().format('dddd, D MMMM')} />
      {!doctor?.registrationNumber && <p className="rounded-lg border border-alert/30 bg-alert-soft px-3 py-2 text-sm text-alert">Your medical registration number is missing — prescriptions can't be signed until the clinic adds it to your profile.</p>}
      <KpiGrid>
        <KpiCard icon={CalendarCheck} label="Booked today" value={rows.length} />
        <KpiCard icon={Clock} tone="amber" label="Waiting now" value={canQueue ? waiting : null} />
        <KpiCard icon={CheckCircle2} tone="navy" label="Seen today" value={rows.filter((r) => r.status === 'COMPLETED').length} />
        <KpiCard icon={FlaskConical} tone="red" label="Results to verify" value={lab.data?.awaitingVerification ?? null} />
      </KpiGrid>

      {canQueue && (
        <section className={`card p-5 ${current ? 'border-pulse bg-pulse-soft/40' : ''}`}>
          {current ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-pulse-deep">{current.status === 'IN_CONSULTATION' ? 'With you now' : 'Patient called'}</p>
                <p className="mt-1 font-display text-xl font-semibold">{current.patientId?.name} <span className="font-mono text-base font-normal">· {current.tokenNumber}</span></p>
                <p className="text-sm text-ink-muted">{[age(current.patientId?.dob), current.patientId?.gender].filter(Boolean).join(' · ')}</p>
              </div>
              {current.status === 'CALLED'
                ? <button onClick={() => start.mutate(current)} disabled={start.isPending} className="btn-primary"><Play className="h-4 w-4" /> Start consultation</button>
                : <button onClick={() => openFor(current.appointmentId, current.patientId)} className="btn-primary"><ClipboardList className="h-4 w-4" /> Open consultation</button>}
            </div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-lg font-semibold">Ready for your next patient</p>
                <p className="text-sm text-ink-muted">{waiting ? `${waiting} waiting in your queue.` : 'Nobody is waiting right now.'}</p>
              </div>
              <button onClick={() => callNext.mutate()} disabled={!waiting || callNext.isPending} className="btn-primary"><PhoneCall className="h-4 w-4" /> Call next</button>
            </div>
          )}
        </section>
      )}

      <Section title="Today's schedule" actions={<Link to="/clinic/doctor/schedule" className="text-sm text-pulse-deep hover:underline">Full schedule</Link>}>
        <DataTable loading={today.isLoading} error={today.error} onRetry={today.refetch} rows={rows}
          onRowClick={(r) => ['WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CHECKED_IN'].includes(r.status) && openFor(r._id, r.patientId)}
          empty={<EmptyState title="Nothing booked today" />}
          columns={[
            { key: 'time', header: 'Time', render: (r) => <span className="font-mono text-sm">{r.source === 'WALK_IN' ? 'Walk-in' : time(r.startAt)}</span> },
            { key: 'patient', header: 'Patient', render: (r) => <div><p className="font-medium">{r.patientId?.name}</p><p className="text-xs text-ink-muted">{[age(r.patientId?.dob), r.patientId?.gender].filter(Boolean).join(' · ')}</p></div> },
            { key: 'for', header: 'For', hideOnMobile: true, render: (r) => r.serviceId?.name || r.reason || 'Consultation' },
            { key: 'status', header: 'Status', render: (r) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={r.status} />{r.meetingUrl && <a href={r.meetingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100">Join video</a>}</div> },
          ]} />
      </Section>
      {open && <ConsultationWorkspace appointment={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
