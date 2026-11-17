import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PhoneCall, Check, Play, SkipForward, RotateCcw, Footprints } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Skeleton, ErrorState } from '../../components/ui/States.jsx';
import { PageHeader } from '../../components/ui/Page.jsx';
import { time, age } from '../../lib/format.js';
import { useAuth } from '../../hooks/useAuth.jsx';

const ACTIONS = {
  WAITING: [['SKIPPED', 'Skip', SkipForward]],
  CALLED: [['IN_CONSULTATION', 'Start', Play], ['WAITING', 'Back to waiting', RotateCcw], ['SKIPPED', 'Skip (not present)', SkipForward]],
  IN_CONSULTATION: [['COMPLETED', 'Complete', Check]],
  SKIPPED: [['WAITING', 'Re-queue', RotateCcw]],
};

/** Live token queue, grouped by doctor. Same data on the front desk and the doctor's screen. */
export default function Queue({ walkInPath }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isDoctor = user?.role === 'DOCTOR';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.get('/queue').then(unwrap),
    refetchInterval: 30000,   // the socket is primary; this is the safety net
  });
  useEffect(() => onSocket('queue:updated', () => qc.invalidateQueries({ queryKey: ['queue'] })), [qc]);

  const callNext = useMutation({
    mutationFn: (doctorId) => api.post('/queue/call-next', isDoctor ? {} : { doctorId }).then(unwrap),
    onSuccess: (t) => { toast.success(`Calling ${t.tokenNumber} — ${t.patientId?.name || ''}`); qc.invalidateQueries({ queryKey: ['queue'] }); },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = useMutation({
    mutationFn: ({ tokenId, status }) => api.patch(`/queue/${tokenId}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['appointments'] }); },
    onError: (e) => toast.error(e.message),
  });

  const header = (
    <PageHeader title={isDoctor ? 'Consultation queue' : 'Waiting queue'}
      description="Tokens update live as patients are checked in, called and seen."
      actions={walkInPath && <Link to={walkInPath} className="btn-primary"><Footprints className="h-4 w-4" /> Register walk-in</Link>} />
  );
  if (isLoading) return <div>{header}<div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div></div>;
  if (error) return <div>{header}<div className="card"><ErrorState error={error} onRetry={refetch} /></div></div>;

  const byDoctor = (data || []).reduce((acc, t) => {
    const id = t.doctorId?._id || t.doctorId;
    (acc[id] ||= { doctor: t.doctorId, tokens: [] }).tokens.push(t);
    return acc;
  }, {});

  return (
    <div>
      {header}
      {!data?.length && <div className="card"><EmptyState title="Nobody is waiting" body="Check a patient in from today's appointments, or register a walk-in, and their token appears here." /></div>}
      <div className="grid gap-5 xl:grid-cols-2">
        {Object.entries(byDoctor).map(([doctorId, { doctor, tokens }]) => {
          const busy = tokens.some((t) => ['CALLED', 'IN_CONSULTATION'].includes(t.status));
          const waiting = tokens.filter((t) => t.status === 'WAITING').length;
          return (
            <section key={doctorId} className="card overflow-hidden">
              <header className="flex items-center justify-between gap-3 border-b border-line bg-paper-sunk/50 px-4 py-3">
                <div>
                  <h2 className="section-title">{doctor?.name || 'Doctor'}</h2>
                  <p className="text-xs text-ink-muted">{waiting} waiting · {tokens.length} in queue</p>
                </div>
                <button onClick={() => callNext.mutate(doctorId)} disabled={callNext.isPending || busy || !waiting}
                        title={busy ? 'Finish or skip the current patient first' : undefined} className="btn-primary btn-sm">
                  <PhoneCall className="h-4 w-4" /> Call next
                </button>
              </header>
              <ul className="divide-y divide-line">
                {tokens.map((t) => (
                  <li key={t._id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${t.status === 'CALLED' || t.status === 'IN_CONSULTATION' ? 'bg-pulse-soft/40' : ''}`}>
                    <span className={`flex h-11 w-14 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold ${
                      ['CALLED', 'IN_CONSULTATION'].includes(t.status) ? 'bg-pulse text-white' : t.status === 'SKIPPED' ? 'bg-paper-sunk text-ink-muted line-through' : 'bg-navy text-white'}`}>
                      {t.tokenNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t.patientId?.name}{t.priority > 0 && <span className="ml-2 text-xs font-semibold text-alert">PRIORITY</span>}</p>
                      <p className="text-xs text-ink-muted">
                        {[age(t.patientId?.dob), `in ${time(t.checkedInAt)}`, t.status === 'WAITING' && `~${t.estimatedWaitMins} min wait`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                    <div className="flex gap-1">
                      {(ACTIONS[t.status] || []).map(([status, label, Icon]) => (
                        <button key={status} onClick={() => setStatus.mutate({ tokenId: t._id, status })} aria-label={label} title={label}
                                className={status === 'COMPLETED' || status === 'IN_CONSULTATION' ? 'btn-primary btn-sm' : 'btn-quiet btn-sm'}>
                          <Icon className="h-4 w-4" />{(status === 'COMPLETED' || status === 'IN_CONSULTATION') && <span>{label}</span>}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
