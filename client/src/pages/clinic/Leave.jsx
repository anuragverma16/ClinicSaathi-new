import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import {
  CalendarOff, CalendarCheck, Clock, XCircle, Send, Check, X, AlertTriangle, Users, Plane, Thermometer, Sun, Wallet, MoreHorizontal,
} from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { ymd } from '../../lib/format.js';
import { ROLE_LABEL } from '../../routes/nav.js';
import { PageHeader, Section, Field, FormSection, fieldErrors, useReasonPrompt } from '../../components/ui/Page.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton, Spinner } from '../../components/ui/States.jsx';

const TYPES = {
  CASUAL: { label: 'Casual', icon: Sun },
  SICK: { label: 'Sick', icon: Thermometer },
  EARNED: { label: 'Earned', icon: Plane },
  UNPAID: { label: 'Unpaid', icon: Wallet },
  OTHER: { label: 'Other', icon: MoreHorizontal },
};
const ROLE_TINT = {
  DOCTOR: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25',
  RECEPTIONIST: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/25',
  BRANCH_MANAGER: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/25',
  ACCOUNTANT: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25',
  LAB_TECHNICIAN: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25',
};
const STAFF_ROLES = Object.keys(ROLE_TINT);

const fmt = (d) => dayjs(d).format('D MMM YYYY');
const span = (l) => (l.from === l.to ? fmt(l.from) : `${fmt(l.from)} – ${fmt(l.to)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dayCount = (from, to) => (from && to && to >= from ? dayjs(to).diff(dayjs(from), 'day') + 1 : 0);

function RoleBadge({ role }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ROLE_TINT[role] || 'bg-paper-sunk text-ink-muted ring-line'}`}>{ROLE_LABEL[role] || role}</span>;
}

function DateTile({ value }) {
  const d = dayjs(value);
  return (
    <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-surface leading-none">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-pulse-deep">{d.format('MMM')}</span>
      <span className="mt-0.5 font-display text-lg font-semibold text-ink">{d.format('D')}</span>
    </span>
  );
}

// ------------------------------------------------------------------ Staff: My leave

const emptyForm = () => ({ type: 'CASUAL', from: '', to: '', reason: '' });

/** Every staff role's own leave: request it, track it, withdraw it. The clinic owner decides. */
export function MyLeave({ isDoctor = false }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const mine = useQuery({ queryKey: ['leaves', 'mine'], queryFn: () => api.get('/leaves/mine').then(unwrap) });
  const days = dayCount(form.from, form.to);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v, ...(k === 'from' && (!f.to || f.to < v) ? { to: v } : {}) })); setErrors((e) => ({ ...e, [k]: undefined })); };

  const submit = useMutation({
    mutationFn: () => api.post('/leaves', form),
    onSuccess: () => {
      toast.success('Leave request sent to the clinic owner');
      setForm(emptyForm());
      qc.invalidateQueries({ queryKey: ['leaves'] });
    },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/leaves/${id}/cancel`),
    onSuccess: () => { toast.success('Leave request withdrawn'); qc.invalidateQueries({ queryKey: ['leaves'] }); },
    onError: (e) => toast.error(e.message),
  });

  const validate = () => {
    const e = {};
    if (!form.from) e.from = 'Pick the first day';
    else if (form.from < ymd()) e.from = 'Leave cannot start in the past';
    if (!form.to) e.to = 'Pick the last day';
    else if (form.from && form.to < form.from) e.to = 'Must be on or after the first day';
    if (form.reason.trim().length < 3) e.reason = 'Add a short reason';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const s = mine.data?.summary;
  const items = mine.data?.items || [];
  const today = ymd();

  return (
    <div>
      <PageHeader title="My leave" description="Request time off and follow it here. The clinic owner approves or rejects each request." />

      <KpiGrid>
        <KpiCard label="Pending" value={s?.pending ?? null} icon={Clock} tone="amber" hint="Waiting for the owner" />
        <KpiCard label="Upcoming leave" value={s?.upcoming ?? null} icon={CalendarCheck} tone="teal" hint="Approved, not over yet" />
        <KpiCard label="Days approved" value={s?.approvedDays ?? null} icon={CalendarOff} tone="navy" hint={`In ${dayjs().year()}`} />
        <KpiCard label="Rejected" value={s?.rejected ?? null} icon={XCircle} tone="violet" />
      </KpiGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Section title="Request leave" className="self-start">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (validate()) submit.mutate(); }}>
            <FormSection title="Type of leave">
              <div role="radiogroup" aria-label="Type of leave" className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3">
                {Object.entries(TYPES).map(([key, { label, icon: Icon }]) => {
                  const on = form.type === key;
                  return (
                    <button key={key} type="button" role="radio" aria-checked={on} onClick={() => set('type', key)}
                            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors ${on ? 'border-transparent bg-pulse/10 text-pulse-deep ring-2 ring-pulse' : 'border-line bg-surface text-ink-soft hover:border-ink-muted/40'}`}>
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  );
                })}
              </div>
            </FormSection>

            <FormSection title="Dates" description="Both days are included.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" htmlFor="lv-from" error={errors.from} required>
                  <input id="lv-from" type="date" min={today} className="field" value={form.from} onChange={(e) => set('from', e.target.value)} />
                </Field>
                <Field label="To" htmlFor="lv-to" error={errors.to} required>
                  <input id="lv-to" type="date" min={form.from || today} className="field" value={form.to} onChange={(e) => set('to', e.target.value)} />
                </Field>
              </div>
              {days > 0 && (
                <p className="flex items-center gap-2 rounded-lg bg-pulse/10 px-3 py-2 text-sm font-medium text-pulse-deep">
                  <CalendarOff className="h-4 w-4" /> {plural(days, 'day')} of leave
                </p>
              )}
            </FormSection>

            <Field label="Reason" htmlFor="lv-reason" error={errors.reason} required>
              <textarea id="lv-reason" rows={3} maxLength={300} className="field" placeholder="e.g. Family function out of town"
                        value={form.reason} onChange={(e) => set('reason', e.target.value)} />
            </Field>

            {isDoctor && (
              <p className="flex gap-2 rounded-lg border border-signal/25 bg-signal-soft px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                Once approved, these days close for new bookings. Patients already booked are not moved automatically.
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submit.isPending}>
              {submit.isPending ? <Spinner /> : <Send className="h-4 w-4" />} Send request
            </button>
          </form>
        </Section>

        <Section title="My requests">
          {mine.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>}
          {mine.isError && <ErrorState error={mine.error} onRetry={mine.refetch} />}
          {mine.isSuccess && !items.length && (
            <EmptyState icon={CalendarOff} title="No leave requested yet" body="Requests you send appear here with their status." />
          )}
          <ul className="space-y-3">
            {items.map((l) => {
              const TypeIcon = TYPES[l.type]?.icon || CalendarOff;
              const canCancel = l.status === 'PENDING' || (l.status === 'APPROVED' && l.from > today);
              return (
                <li key={l._id} className="rounded-xl border border-line bg-paper/50 p-4">
                  <div className="flex items-start gap-3">
                    <DateTile value={l.from} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{span(l)}</p>
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                        <TypeIcon className="h-3.5 w-3.5" /> {TYPES[l.type]?.label} leave · {plural(l.days, 'day')}
                      </p>
                      {l.reason && <p className="mt-2 text-sm text-ink-soft">{l.reason}</p>}
                      {l.reviewNote && (
                        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft ring-1 ring-line">
                          <span className="font-semibold">{l.reviewedByName || 'Clinic owner'}:</span> {l.reviewNote}
                        </p>
                      )}
                    </div>
                    {canCancel && (
                      <button className="btn-ghost btn-sm shrink-0" disabled={cancel.isPending} onClick={() => cancel.mutate(l._id)}>
                        {l.status === 'PENDING' ? 'Withdraw' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Owner: Leave requests

const STATUS_TABS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

/** The clinic owner's inbox of leave requests from every role. */
export function LeaveRequests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [role, setRole] = useState('ALL');
  const [ask, dialog] = useReasonPrompt();
  const list = useQuery({
    queryKey: ['leaves', 'all', status, role],
    queryFn: () => api.get('/leaves', { params: { status, role } }).then(unwrap),
  });

  const review = useMutation({
    mutationFn: ({ id, decision, note }) => api.post(`/leaves/${id}/review`, { decision, note }).then(unwrap),
    onSuccess: (d, { decision }) => {
      if (decision === 'REJECTED') toast.success('Leave rejected');
      else if (d.bookings) toast(`Leave approved. ${plural(d.bookings, 'patient')} still booked in those days. Reschedule them from Appointments.`, { icon: '⚠️', duration: 7000 });
      else toast.success('Leave approved');
      qc.invalidateQueries({ queryKey: ['leaves'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = async (l) => {
    const note = await ask({ title: `Reject ${l.userName}'s leave?`, body: span(l), confirmLabel: 'Reject leave', danger: true, required: true });
    if (note) review.mutate({ id: l._id, decision: 'REJECTED', note });
  };

  const c = list.data?.counts || {};
  const items = list.data?.items || [];
  const tabs = useMemo(() => STATUS_TABS.map((t) => ({
    ...t, count: t.value === 'ALL' ? ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].reduce((n, k) => n + (c[k] || 0), 0) : c[t.value] || 0,
  })), [c]);

  return (
    <div>
      {dialog}
      <PageHeader title="Leave requests" description="Leave from doctors, branch managers, receptionists, accountants and lab staff. Approving a doctor's leave closes those days for booking." />

      <KpiGrid>
        <KpiCard label="Awaiting decision" value={list.data ? c.PENDING || 0 : null} icon={Clock} tone="amber" />
        <KpiCard label="On leave today" value={list.data ? c.onLeaveToday || 0 : null} icon={Users} tone="teal" />
        <KpiCard label="Approved" value={list.data ? c.APPROVED || 0 : null} icon={CalendarCheck} tone="navy" />
        <KpiCard label="Rejected" value={list.data ? c.REJECTED || 0 : null} icon={XCircle} tone="violet" />
      </KpiGrid>

      <Section className="mt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button key={t.value} role="tab" aria-selected={status === t.value} onClick={() => setStatus(t.value)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${status === t.value ? 'bg-pulse text-on-pulse' : 'bg-paper-sunk text-ink-soft hover:text-ink'}`}>
                {t.label}
                <span className={`rounded-full px-1.5 text-xs ${status === t.value ? 'bg-black/10' : 'bg-surface'}`}>{t.count}</span>
              </button>
            ))}
          </div>
          <select aria-label="Filter by role" className="field-sm" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="ALL">All roles</option>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>

        {list.isLoading && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
        {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
        {list.isSuccess && !items.length && (
          <EmptyState icon={CalendarOff} title={status === 'PENDING' ? 'No requests waiting' : 'Nothing here'}
                      body={status === 'PENDING' ? 'New leave requests from your team show up here, and in your notifications.' : 'Try another tab or role.'} />
        )}

        <ul className="space-y-3">
          {items.map((l) => {
            const TypeIcon = TYPES[l.type]?.icon || CalendarOff;
            const busy = review.isPending && review.variables?.id === l._id;
            return (
              <li key={l._id} className="rounded-xl border border-line bg-paper/50 p-4 transition-colors hover:border-ink-muted/30">
                <div className="flex flex-col gap-4 md:flex-row md:items-start">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-500 text-sm font-semibold text-white">
                      {l.userName?.[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{l.userName}</p>
                        <RoleBadge role={l.role} />
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
                        <span className="inline-flex items-center gap-1.5 font-medium text-ink"><CalendarOff className="h-4 w-4 text-pulse-deep" /> {span(l)}</span>
                        <span>{plural(l.days, 'day')}</span>
                        <span className="inline-flex items-center gap-1 text-ink-muted"><TypeIcon className="h-3.5 w-3.5" /> {TYPES[l.type]?.label}</span>
                      </p>
                      {l.reason && <p className="mt-2 text-sm text-ink-soft">“{l.reason}”</p>}
                      {l.bookings > 0 && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-signal-soft px-2.5 py-1 text-xs font-medium text-signal">
                          <AlertTriangle className="h-3.5 w-3.5" /> {plural(l.bookings, 'patient')} already booked in these days
                        </p>
                      )}
                      {l.reviewNote && <p className="mt-2 text-xs text-ink-muted">Note: {l.reviewNote}</p>}
                      <p className="mt-2 text-xs text-ink-muted">
                        Requested {dayjs(l.createdAt).format('D MMM, h:mm A')}
                        {l.reviewedAt && ` · ${l.status === 'APPROVED' ? 'Approved' : 'Reviewed'} ${dayjs(l.reviewedAt).format('D MMM')}`}
                      </p>
                    </div>
                  </div>
                  {l.status === 'PENDING' && (
                    <div className="flex shrink-0 gap-2 md:flex-col">
                      <button className="btn-primary btn-sm flex-1 px-4 py-2" disabled={busy}
                              onClick={() => review.mutate({ id: l._id, decision: 'APPROVED' })}>
                        {busy && review.variables?.decision === 'APPROVED' ? <Spinner /> : <Check className="h-4 w-4" />} Approve
                      </button>
                      <button className="btn-danger btn-sm flex-1 px-4 py-2" disabled={busy} onClick={() => reject(l)}>
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
