import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, X, RotateCcw } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { Section } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_WINDOW = { startTime: '09:00', endTime: '17:00' };

/** The flat availability list the API uses becomes one row of windows per weekday. */
const toRows = (availability = []) => Array.from({ length: 7 }, (_, dow) => availability
  .filter((a) => a.dayOfWeek === dow)
  .map((a) => ({ startTime: a.startTime, endTime: a.endTime }))
  .sort((x, y) => x.startTime.localeCompare(y.startTime)));

const toAvailability = (rows) => rows.flatMap((ws, dow) => ws.map((w) => ({ dayOfWeek: dow, ...w })));

function problemIn(rows) {
  for (let dow = 0; dow < 7; dow += 1) {
    const ws = rows[dow];
    if (ws.some((w) => !w.startTime || !w.endTime)) return `Fill in both times on ${DAYS[dow]}`;
    if (ws.some((w) => w.startTime >= w.endTime)) return `${DAYS[dow]} ends before it starts`;
    const sorted = [...ws].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startTime < sorted[i - 1].endTime) return `${DAYS[dow]} has overlapping hours`;
    }
  }
  return null;
}

/**
 * The doctor's own weekly days and hours. This is the pattern every date falls
 * back to, so turning a day off here closes it for booking from now on.
 */
export function WeeklyHours() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const me = useQuery({ queryKey: ['doctors', 'me'], queryFn: () => api.get('/doctors/me').then(unwrap) });

  const saved = useMemo(() => toRows(me.data?.availability), [me.data]);
  const rows = draft ?? saved;
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const problem = problemIn(rows);

  const setRow = (dow, windows) => setDraft(rows.map((ws, i) => (i === dow ? windows : ws)));

  const save = useMutation({
    mutationFn: () => api.put('/doctors/me/availability', { availability: toAvailability(rows) }),
    onSuccess: () => {
      toast.success('Working hours saved — the clinic has been notified');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (me.isLoading) return <Section title="Working hours"><div className="flex justify-center py-6"><Spinner /></div></Section>;

  const workingDays = rows.filter((ws) => ws.length).length;

  return (
    <Section
      title="Working hours"
      actions={dirty && (
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setDraft(null)}><RotateCcw className="h-3.5 w-3.5" /> Discard</button>
          <button className="btn-primary btn-sm" disabled={save.isPending || Boolean(problem)} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />} Save
          </button>
        </div>
      )}
    >
      <p className="mb-1 text-sm text-ink-muted">
        Turn on the days you work and set the hours. This repeats every week and is what patients can book.
      </p>
      <p className="mb-3 text-xs text-ink-muted">
        {workingDays ? `${workingDays} working day${workingDays === 1 ? '' : 's'} a week.` : 'No working days set — nobody can book you.'}
        {' '}To work different hours on one particular date, set that date on your dashboard.
      </p>

      <div className="divide-y divide-line">
        {DAYS.map((name, dow) => {
          const ws = rows[dow];
          const on = ws.length > 0;
          return (
            <div key={name} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-2.5">
              <label className="flex w-24 shrink-0 cursor-pointer items-center gap-2.5 pt-1">
                <span className="relative inline-flex">
                  <input type="checkbox" className="peer sr-only" checked={on}
                         aria-label={`${name} working`}
                         onChange={(e) => setRow(dow, e.target.checked ? [{ ...DEFAULT_WINDOW }] : [])} />
                  <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-pulse peer-focus-visible:ring-2 peer-focus-visible:ring-pulse/40" />
                  <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                </span>
                <span className={`text-sm font-medium ${on ? 'text-ink' : 'text-ink-muted'}`}>{name}</span>
              </label>

              <div className="min-w-0 flex-1 space-y-2">
                {on ? ws.map((w, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input type="time" className="field-sm font-mono" value={w.startTime} aria-label={`${name} start time`}
                           onChange={(e) => setRow(dow, ws.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                    <span className="text-sm text-ink-muted">to</span>
                    <input type="time" className="field-sm font-mono" value={w.endTime} aria-label={`${name} end time`}
                           onChange={(e) => setRow(dow, ws.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                    {ws.length > 1 && (
                      <button className="btn-quiet btn-sm" aria-label={`Remove these ${name} hours`}
                              onClick={() => setRow(dow, ws.filter((_, j) => j !== i))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )) : <p className="pt-1.5 text-sm text-ink-muted">Off</p>}

                {on && ws.length < 3 && (
                  <button className="btn-quiet btn-sm" onClick={() => setRow(dow, [...ws, { startTime: '17:00', endTime: '20:00' }])}>
                    <Plus className="h-3.5 w-3.5" /> Add an evening session
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {problem && <p className="mt-3 text-sm text-alert">{problem}</p>}
    </Section>
  );
}
