import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { Plus, X, RotateCcw, CalendarOff, CalendarCheck2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { Section } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_AHEAD = 31;
/** What turning a weekday on means when the clinic has no pattern for it. */
const DEFAULT_WINDOW = [{ startTime: '09:00', endTime: '17:00' }];

const ymdOf = (d) => dayjs(d).format('YYYY-MM-DD');
const label = (w) => `${w.startTime}–${w.endTime}`;
const sameWindows = (a = [], b = []) =>
  a.length === b.length && a.every((w, i) => w.startTime === b[i].startTime && w.endTime === b[i].endTime);

/**
 * The doctor's own hours per date for the month ahead. A date the doctor has
 * not touched follows the clinic's weekly pattern, so the grid always shows
 * what patients can actually book — not just the dates that were changed.
 */
export function MonthSchedule() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [picked, setPicked] = useState(null);

  const sched = useQuery({
    queryKey: ['doctors', 'me', 'schedule'],
    queryFn: () => api.get('/doctors/me/schedule').then(unwrap),
  });

  const saved = useMemo(() => {
    const m = {};
    for (const o of sched.data?.overrides || []) m[o.date] = o.windows || [];
    return m;
  }, [sched.data]);

  const current = draft ?? saved;
  const weekly = sched.data?.availability || [];
  const leaves = sched.data?.leaves || [];

  const days = useMemo(() => {
    const start = dayjs(sched.data?.today || undefined);
    return Array.from({ length: DAYS_AHEAD }, (_, i) => start.add(i, 'day'));
  }, [sched.data?.today]);

  const weeklyFor = (dow) => weekly.filter((r) => r.dayOfWeek === dow).map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
  const leaveOn = (ymd) => leaves.some((l) => ymd >= ymdOf(l.from) && ymd <= ymdOf(l.to));
  const windowsFor = (d) => {
    const ymd = d.format('YYYY-MM-DD');
    return Object.prototype.hasOwnProperty.call(current, ymd) ? current[ymd] : weeklyFor(d.day());
  };
  const isSet = (ymd) => Object.prototype.hasOwnProperty.call(current, ymd);

  const dirty = useMemo(() => {
    const a = Object.keys(current);
    const b = Object.keys(saved);
    return a.length !== b.length || a.some((k) => !(k in saved) || !sameWindows(current[k], saved[k]));
  }, [current, saved]);

  const setDay = (ymd, windows) => setDraft({ ...current, [ymd]: windows });
  const clearDay = (ymd) => { const next = { ...current }; delete next[ymd]; setDraft(next); };

  const save = useMutation({
    mutationFn: () => api.put('/doctors/me/schedule', {
      overrides: Object.entries(current).map(([date, windows]) => ({ date, windows })),
    }),
    onSuccess: () => {
      toast.success('Hours updated — the clinic has been notified');
      setDraft(null);
      setPicked(null);
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (sched.isLoading) return <Section title="My working days and hours"><div className="flex justify-center py-8"><Spinner /></div></Section>;
  if (sched.error) {
    return (
      <Section title="My working days and hours">
        <p className="text-sm text-alert">{sched.error.message}</p>
        <button className="btn-ghost btn-sm mt-3" onClick={() => sched.refetch()}>Try again</button>
      </Section>
    );
  }

  const pickedWindows = picked ? windowsFor(dayjs(picked)) : [];
  const pickedOnLeave = picked ? leaveOn(picked) : false;

  const applyToWeekday = () => {
    const dow = dayjs(picked).day();
    const next = { ...current };
    for (const d of days) if (d.day() === dow && !leaveOn(d.format('YYYY-MM-DD'))) next[d.format('YYYY-MM-DD')] = pickedWindows;
    setDraft(next);
    toast.success(`Applied to every ${DOW[dow]} this month`);
  };

  // Every date of one weekday in the month, so "no Sundays" is a single click.
  const datesOfWeekday = (dow) => days.filter((d) => d.day() === dow && !leaveOn(d.format('YYYY-MM-DD')));
  const weekdayState = (dow) => {
    const ds = datesOfWeekday(dow);
    if (!ds.length) return 'off';
    const working = ds.filter((d) => windowsFor(d).length).length;
    if (!working) return 'off';
    return working === ds.length ? 'on' : 'mixed';
  };
  const toggleWeekday = (dow) => {
    const turningOn = weekdayState(dow) !== 'on';
    const windows = turningOn ? (weeklyFor(dow).length ? weeklyFor(dow) : DEFAULT_WINDOW) : [];
    const next = { ...current };
    for (const d of datesOfWeekday(dow)) next[d.format('YYYY-MM-DD')] = windows;
    setDraft(next);
    toast.success(turningOn ? `Every ${DOW[dow]} is now a working day` : `Every ${DOW[dow]} is now off`);
  };

  return (
    <Section
      title="My working days and hours"
      actions={dirty && (
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => { setDraft(null); setPicked(null); }}><RotateCcw className="h-3.5 w-3.5" /> Discard</button>
          <button className="btn-primary btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />} Save and notify clinic
          </button>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-ink-muted">
        Set the hours you work on each of the next {DAYS_AHEAD} days. A date you leave alone follows your clinic&apos;s
        weekly pattern. Saving opens or closes booking straight away and tells the clinic and front desk what changed.
      </p>

      {!weekly.length && (
        <p className="mb-3 rounded-lg bg-signal-soft px-3 py-2 text-xs text-signal">
          Your clinic has not set a weekly pattern yet, so every date is closed for booking. Turn on the days you work below.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Working days</span>
        {DOW.map((d, i) => {
          const state = weekdayState(i);
          return (
            <button
              key={d} type="button" onClick={() => toggleWeekday(i)} aria-pressed={state === 'on'}
              title={`${state === 'on' ? 'Turn off' : 'Turn on'} every ${d} this month`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                state === 'on' ? 'border-transparent bg-pulse text-white'
                  : state === 'mixed' ? 'border-pulse/50 bg-pulse-soft text-pulse-deep'
                    : 'border-line bg-surface text-ink-muted hover:border-ink-muted/40'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{d}</div>)}
        {Array.from({ length: days[0].day() }, (_, i) => <div key={`pad${i}`} />)}
        {days.map((d) => {
          const ymd = d.format('YYYY-MM-DD');
          const onLeave = leaveOn(ymd);
          const windows = windowsFor(d);
          const off = !onLeave && !windows.length;
          const on = picked === ymd;
          return (
            <button
              key={ymd} type="button" onClick={() => setPicked(on ? null : ymd)} aria-pressed={on}
              className={`flex min-h-[72px] flex-col rounded-lg border p-1.5 text-left transition-colors ${
                on ? 'border-pulse ring-2 ring-pulse/30' : 'border-line hover:border-ink-muted/40'
              } ${onLeave ? 'bg-paper-sunk' : off ? 'bg-paper-sunk/60' : 'bg-surface'}`}
            >
              <span className="flex items-center justify-between">
                <span className={`text-[13px] font-semibold ${off || onLeave ? 'text-ink-muted' : 'text-ink'}`}>{d.date()}</span>
                {isSet(ymd) && !onLeave && <span className="h-1.5 w-1.5 rounded-full bg-pulse" title="You set this day" />}
              </span>
              <span className="mt-0.5 space-y-0.5 overflow-hidden">
                {onLeave ? <span className="block text-[10px] font-medium text-ink-muted">On leave</span>
                  : off ? <span className="block text-[10px] font-medium text-ink-muted">Off</span>
                    : windows.map((w) => <span key={label(w)} className="block font-mono text-[10px] leading-tight text-ink-soft">{label(w)}</span>)}
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">{dayjs(picked).format('dddd, D MMMM')}</p>
            <div className="flex flex-wrap gap-2">
              {isSet(picked) && <button className="btn-quiet btn-sm" onClick={() => clearDay(picked)}>Use clinic default</button>}
              <button className="btn-ghost btn-sm" onClick={() => setDay(picked, [])}><CalendarOff className="h-3.5 w-3.5" /> Day off</button>
              <button className="btn-ghost btn-sm" onClick={() => setDay(picked, [...pickedWindows, { startTime: '09:00', endTime: '13:00' }])}>
                <Plus className="h-3.5 w-3.5" /> Add hours
              </button>
            </div>
          </div>

          {pickedOnLeave && (
            <p className="mt-3 rounded-lg bg-signal-soft px-3 py-2 text-xs text-signal">
              You are on leave this day, so it stays closed for booking whatever hours you set here.
            </p>
          )}

          {pickedWindows.length ? (
            <div className="mt-3 space-y-2">
              {pickedWindows.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" className="field-sm font-mono" value={w.startTime}
                         onChange={(e) => setDay(picked, pickedWindows.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                  <span className="text-ink-muted">to</span>
                  <input type="time" className="field-sm font-mono" value={w.endTime}
                         onChange={(e) => setDay(picked, pickedWindows.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                  {w.startTime >= w.endTime && <span className="text-xs text-alert">End must be after start</span>}
                  <button className="btn-quiet btn-sm ml-auto" aria-label="Remove these hours"
                          onClick={() => setDay(picked, pickedWindows.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">Not working this day — patients cannot book you.</p>
          )}

          <button className="btn-quiet btn-sm mt-3" onClick={applyToWeekday}>
            <CalendarCheck2 className="h-3.5 w-3.5" /> Apply these hours to every {DOW[dayjs(picked).day()]} this month
          </button>
        </div>
      )}
    </Section>
  );
}
