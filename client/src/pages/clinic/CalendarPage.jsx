import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  ChevronLeft, ChevronRight, CalendarDays, CalendarCheck2, Flame, Stethoscope, CalendarOff, Coffee, Clock, Plane, Sparkles,
} from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { PageHeader } from '../../components/ui/Page.jsx';
import { Skeleton } from '../../components/ui/States.jsx';
import { time } from '../../lib/format.js';
import { SlotPicker } from './BookingForm.jsx';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Left edge + chip colour per appointment status. The tints are too light to
// survive dark mode, so each carries a translucent-fill version of itself.
const STATUS_STYLE = {
  REQUESTED: { bar: 'border-l-amber-400', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300', label: 'Requested' },
  CONFIRMED: { bar: 'border-l-sky-500', chip: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300', label: 'Confirmed' },
  CHECKED_IN: { bar: 'border-l-violet-500', chip: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300', label: 'Checked in' },
  WAITING: { bar: 'border-l-orange-500', chip: 'bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300', label: 'Waiting' },
  IN_CONSULTATION: { bar: 'border-l-fuchsia-500', chip: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-400/10 dark:text-fuchsia-300', label: 'In consult' },
  COMPLETED: { bar: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300', label: 'Done' },
};

// Working-hours timeline spans 07:00–21:00.
const T0 = 7 * 60;
const T1 = 21 * 60;
const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const pct = (m) => `${((Math.min(Math.max(m, T0), T1) - T0) / (T1 - T0)) * 100}%`;
const span = (a, b) => ({ left: pct(mins(a)), width: `calc(${pct(mins(b))} - ${pct(mins(a))})` });

function StatTile({ icon: Icon, label, value, hint, grad }) {
  return (
    <div className="card card-hover rise-in relative flex items-center gap-3 overflow-hidden p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md shadow-black/10 ${grad}`}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="font-display text-xl font-semibold text-ink">{value}</p>
        {hint && <p className="truncate text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * Week view of real bookings per doctor, plus the selected doctor's working
 * pattern and free slots for any day — the "calendar and availability" view.
 */
export default function CalendarPage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(dayjs().startOf('week'));
  const [doctorId, setDoctorId] = useState('');
  const [freeDay, setFreeDay] = useState(dayjs().format('YYYY-MM-DD'));
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap) });
  const from = weekStart.format('YYYY-MM-DD');
  const to = weekStart.add(6, 'day').format('YYYY-MM-DD');
  const appts = useQuery({
    queryKey: ['appointments', 'week', from, doctorId],
    queryFn: () => api.get('/appointments', { params: { from, to, doctorId: doctorId || undefined, limit: 200, status: 'REQUESTED,CONFIRMED,WAITING,CHECKED_IN,IN_CONSULTATION,COMPLETED' } }).then(unwrap),
  });
  const clinic = useQuery({ queryKey: ['clinic', 'me'], queryFn: () => api.get('/clinics/me').then(unwrap) });
  // A doctor can change their own hours from their dashboard — pick it up live.
  useEffect(() => onSocket(['doctor:schedule', 'appointment:created', 'appointment:updated', 'appointment:cancelled'], () => {
    qc.invalidateQueries({ queryKey: ['doctors'] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['availability'] });
  }), [qc]);
  const doctor = doctors.data?.find((d) => d._id === doctorId);
  const holidays = new Set((clinic.data?.holidays || []).map((h) => dayjs(h.date).format('YYYY-MM-DD')));

  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
  const byDay = Object.fromEntries(days.map((d) => {
    const key = d.format('YYYY-MM-DD');
    const list = (appts.data || []).filter((a) => dayjs(a.startAt).format('YYYY-MM-DD') === key)
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    return [key, list];
  }));
  const total = Object.values(byDay).reduce((s, l) => s + l.length, 0);
  const busiest = days.reduce((best, d) => (byDay[d.format('YYYY-MM-DD')].length > (best ? byDay[best.format('YYYY-MM-DD')].length : 0) ? d : best), null);
  const todayCount = byDay[dayjs().format('YYYY-MM-DD')]?.length;
  const isThisWeek = weekStart.isSame(dayjs().startOf('week'), 'day');
  const rangeLabel = `${weekStart.format('D MMM')} – ${weekStart.add(6, 'day').format('D MMM YYYY')}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Calendar and availability" description="Bookings for the week, each doctor's working hours, and open slots on any day." actions={(
        <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/80 p-1 shadow-sm backdrop-blur">
          <button className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-paper-sunk" onClick={() => setWeekStart(weekStart.subtract(7, 'day'))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[150px] px-1 text-center">
            <p className="text-sm font-semibold text-ink">{rangeLabel}</p>
            {!isThisWeek && <button className="text-[11px] font-medium text-pulse-deep hover:underline" onClick={() => setWeekStart(dayjs().startOf('week'))}>Back to this week</button>}
            {isThisWeek && <p className="text-[11px] text-ink-muted">This week</p>}
          </div>
          <button className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-paper-sunk" onClick={() => setWeekStart(weekStart.add(7, 'day'))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )} />

      {/* Week at a glance */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={CalendarDays} label="Bookings this week" value={appts.isLoading ? '…' : total} hint={rangeLabel} grad="from-sky-500 to-blue-600" />
        <StatTile icon={CalendarCheck2} label="Today" value={appts.isLoading ? '…' : (todayCount ?? '—')} hint={isThisWeek ? dayjs().format('dddd, D MMM') : 'Not in this week'} grad="from-teal-500 to-emerald-500" />
        <StatTile icon={Flame} label="Busiest day" value={busiest ? busiest.format('ddd D') : '—'} hint={busiest ? `${byDay[busiest.format('YYYY-MM-DD')].length} bookings` : 'No bookings yet'} grad="from-amber-400 to-orange-500" />
        <StatTile icon={Stethoscope} label="Doctors" value={doctors.data?.length ?? '…'} hint={doctor ? `Showing ${doctor.name}` : 'Showing everyone'} grad="from-violet-500 to-fuchsia-500" />
      </div>

      {/* Doctor filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Doctor</span>
        {[{ _id: '', name: 'All doctors' }, ...(doctors.data || [])].map((d) => {
          const active = doctorId === d._id;
          return (
            <button key={d._id || 'all'} onClick={() => setDoctorId(d._id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-all ${active
                      ? 'border-transparent bg-gradient-to-r from-teal-500 to-sky-600 text-white shadow-md shadow-teal-500/20'
                      : 'border-line bg-surface text-ink-soft hover:border-pulse/40 hover:text-ink'}`}>
              {d._id && (
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-white/25' : 'bg-pulse-soft text-pulse-deep'}`}>
                  {d.name.replace(/^Dr\.?\s*/i, '')[0]?.toUpperCase()}
                </span>
              )}
              {d.name}
            </button>
          );
        })}
        {doctors.data && !doctors.data.length && <span className="text-sm text-ink-muted">No doctors yet — add one under Doctors.</span>}
      </div>

      {/* Week grid */}
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[880px] grid-cols-7 gap-3">
          {days.map((d, i) => {
            const key = d.format('YYYY-MM-DD');
            const list = byDay[key];
            const isToday = d.isSame(dayjs(), 'day');
            const isPast = d.isBefore(dayjs(), 'day');
            const closed = holidays.has(key);
            const selected = freeDay === key;
            return (
              <div key={key} role="button" tabIndex={0} onClick={() => setFreeDay(key)} onKeyDown={(e) => e.key === 'Enter' && setFreeDay(key)}
                   aria-label={`${d.format('dddd D MMMM')}, ${list.length} bookings — show open slots`}
                   style={{ animationDelay: `${i * 40}ms` }}
                   className={`rise-in group relative flex min-h-[260px] cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift
                     ${isToday ? 'border-transparent ring-2 ring-pulse/60' : selected ? 'border-sky-300 ring-2 ring-sky-200 dark:border-sky-400/50 dark:ring-sky-400/25' : 'border-line/80'}
                     ${isPast && !isToday ? 'opacity-75' : ''}`}>
                {/* Day header */}
                <div className={`flex items-center gap-2.5 px-3 py-3 ${isToday ? 'bg-gradient-to-br from-teal-500 to-sky-600 text-white' : 'border-b border-line/70 bg-paper-sunk/40'}`}>
                  <span className={`flex h-10 w-10 flex-col items-center justify-center rounded-xl leading-none ${isToday ? 'bg-white/20' : 'bg-surface shadow-sm ring-1 ring-line'}`}>
                    <span className={`font-display text-lg font-bold ${isToday ? 'text-white' : 'text-ink'}`}>{d.format('D')}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-bold uppercase tracking-wider ${isToday ? 'text-white' : 'text-ink-soft'}`}>{d.format('ddd')}</p>
                    <p className={`text-[11px] ${isToday ? 'text-white/80' : 'text-ink-muted'}`}>{isToday ? 'Today' : d.format('MMM')}</p>
                  </div>
                  {list.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${isToday ? 'bg-white text-teal-700' : 'bg-pulse-soft text-pulse-deep'}`}>{list.length}</span>
                  )}
                </div>

                {/* Day body */}
                <div className={`relative flex-1 p-2 ${closed ? 'bg-[repeating-linear-gradient(135deg,transparent,transparent_8px,rgb(251_191_36/0.10)_8px,rgb(251_191_36/0.10)_16px)]' : ''}`}>
                  {closed && (
                    <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                      <CalendarOff className="h-3.5 w-3.5" /> Clinic closed
                    </p>
                  )}
                  {appts.isLoading ? (
                    <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
                  ) : list.length ? (
                    <ul className="space-y-1.5">
                      {list.map((a) => {
                        const st = STATUS_STYLE[a.status] || STATUS_STYLE.CONFIRMED;
                        return (
                          <li key={a._id} className={`rounded-lg border border-l-[3px] border-line/80 bg-surface px-2 py-1.5 shadow-sm transition-transform hover:translate-x-0.5 ${st.bar}`}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-ink-soft"><Clock className="h-3 w-3" />{time(a.startAt)}</span>
                              <span className={`rounded px-1 py-px text-[9.5px] font-semibold ${st.chip}`}>{st.label}</span>
                            </div>
                            <p className="mt-0.5 truncate text-xs font-semibold text-ink">{a.patientId?.name || 'Patient'}</p>
                            {!doctorId && a.doctorId?.name && <p className="truncate text-[11px] text-ink-muted">{a.doctorId.name}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  ) : !closed && (
                    <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-center transition-colors group-hover:border-pulse/40 group-hover:bg-pulse-soft/30">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-sunk text-ink-muted transition-colors group-hover:bg-pulse-soft group-hover:text-pulse-deep">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <p className="text-xs font-medium text-ink-muted">{isPast ? 'No visits' : 'Free day'}</p>
                      {!isPast && <p className="text-[10.5px] text-ink-muted/80">Click for open slots</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
        {Object.values(STATUS_STYLE).map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-1 rounded-full border-l-[3px] ${s.bar}`} />{s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-200 dark:bg-amber-400/40" />Clinic closed</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Working hours timeline */}
        <div className="card rise-in overflow-hidden lg:col-span-3">
          <div className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white"><Clock className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="section-title">{doctor ? `${doctor.name} — working hours` : 'Working hours'}</h2>
              <p className="text-xs text-ink-muted">{doctor?.specialization || 'Weekly pattern, 7 am – 9 pm'}</p>
            </div>
          </div>
          <div className="p-5">
            {!doctor ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
                <Stethoscope className="h-6 w-6 text-ink-muted" />
                <p className="text-sm font-medium text-ink-soft">Pick a doctor to see their weekly pattern</p>
                <p className="text-xs text-ink-muted">Use the doctor chips above the calendar.</p>
              </div>
            ) : (
              <>
                <div className="mb-2 ml-12 flex justify-between text-[10px] font-medium text-ink-muted">
                  {[7, 9, 11, 13, 15, 17, 19, 21].map((h) => <span key={h}>{h > 12 ? `${h - 12}p` : `${h}${h === 12 ? 'p' : 'a'}`}</span>)}
                </div>
                <ul className="space-y-2">
                  {DAY_NAMES.map((n, i) => {
                    const rules = doctor.availability.filter((r) => r.dayOfWeek === i);
                    const breaks = doctor.breaks.filter((r) => r.dayOfWeek === i);
                    return (
                      <li key={n} className="flex items-center gap-3">
                        <span className="w-9 text-xs font-semibold text-ink-soft">{n}</span>
                        <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-paper-sunk/70 ring-1 ring-inset ring-line/60">
                          {!rules.length && <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-muted">Off</span>}
                          {rules.map((r) => (
                            <span key={`${r.startTime}-${r.endTime}`} style={span(r.startTime, r.endTime)} title={`${r.startTime}–${r.endTime}`}
                                  className="absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-r from-teal-500 to-sky-500 text-[10px] font-semibold text-white shadow-sm">
                              {r.startTime}–{r.endTime}
                            </span>
                          ))}
                          {breaks.map((b) => (
                            <span key={`b-${b.startTime}`} style={span(b.startTime, b.endTime)} title={`Break ${b.startTime}–${b.endTime}`}
                                  className="absolute inset-y-1 flex items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,#fde68a,#fde68a_4px,#fcd34d_4px,#fcd34d_8px)] text-amber-900">
                              <Coffee className="h-3 w-3" />
                            </span>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {doctor.leaves?.some((l) => dayjs(l.to).isAfter(dayjs())) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {doctor.leaves.filter((l) => dayjs(l.to).isAfter(dayjs())).map((l) => (
                      <span key={l._id} className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25">
                        <Plane className="h-3 w-3" /> Leave {dayjs(l.from).format('D MMM')}–{dayjs(l.to).format('D MMM')}{l.reason ? ` · ${l.reason}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Open slots */}
        <div className="card rise-in overflow-hidden lg:col-span-2" style={{ animationDelay: '80ms' }}>
          <div className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white"><CalendarCheck2 className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="section-title">Open slots</h2>
              <p className="text-xs text-ink-muted">{dayjs(freeDay).format('dddd, D MMMM')}</p>
            </div>
            <input type="date" className="field-sm" value={freeDay} onChange={(e) => setFreeDay(e.target.value)} aria-label="Day" />
          </div>
          <div className="p-5">
            {!doctorId ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
                <CalendarCheck2 className="h-6 w-6 text-ink-muted" />
                <p className="text-sm font-medium text-ink-soft">Choose a doctor to see open slots</p>
                <p className="text-xs text-ink-muted">Tip: click any day in the calendar to jump here.</p>
              </div>
            ) : (
              <SlotPicker doctorId={doctorId} date={freeDay} value="" onChange={() => {}} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
