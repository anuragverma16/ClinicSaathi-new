import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { Send, Plus } from 'lucide-react';
import { api, unwrap, unwrapPage } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section, Field, Tabs, Pagination } from '../../components/ui/Page.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner, Skeleton } from '../../components/ui/States.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PatientPicker } from './BookingForm.jsx';
import { dateTime, date, titleCase } from '../../lib/format.js';

const EVENTS = [
  ['confirmation', 'APPOINTMENT_CONFIRMED', 'Booking confirmation', 'appointment_confirmed'],
  ['reminder', 'APPOINTMENT_REMINDER', 'Appointment reminders', 'appointment_reminder_24h'],
  ['reschedule', 'APPOINTMENT_RESCHEDULED', 'Reschedule notice', 'appointment_rescheduled'],
  ['cancellation', 'APPOINTMENT_CANCELLED', 'Cancellation notice', 'appointment_cancelled'],
  ['queueCalled', 'QUEUE_CALLED', '"Your turn" queue alert', 'queue_called'],
  ['followUp', 'FOLLOWUP', 'Doctor follow-up reminder', 'followup_checkin'],
  ['paymentReminder', 'PAYMENT_REMINDER', 'Payment reminder', 'payment_reminder'],
  ['documentReady', 'DOCUMENT_READY', 'Report/prescription ready (portal link only)', 'document_ready'],
  ['reviewRequest', 'REVIEW_REQUEST', 'Review request after a completed visit', 'review_request'],
  ['medicineReminder', 'MEDICINE_REMINDER', 'Daily medicine reminder while a prescription course runs', 'medicine_reminder'],
  ['birthday', 'BIRTHDAY_WISH', 'Birthday wishes (patients with marketing consent)', 'birthday_wish'],
  ['festival', 'FESTIVAL_GREETING', 'Festival greetings (dates set below)', 'festival_greeting'],
];
// Off unless the clinic switches them on.
const OPT_IN = new Set(['reviewRequest', 'medicineReminder', 'birthday', 'festival']);

const CAMPAIGN_TYPES = [
  { kind: 'VACCINATION', label: 'Flu vaccination drive', template: 'flu_vaccination', preview: 'Flu season is here. Book your flu shot at {clinic} this week.' },
  { kind: 'HEALTH_CAMP', label: 'Free diabetes camp', template: 'diabetes_camp', preview: 'Free blood sugar check-up camp this Sunday at {clinic}. Reply to book a slot.' },
  { kind: 'HEALTH_PACKAGE', label: "Women's health package", template: 'womens_health_package', preview: "Our women's health package covers essential screenings. Book today." },
  { kind: 'OFFER', label: 'Dental offer', template: 'dental_offer', preview: 'Teeth cleaning at a special price this month.' },
  { kind: 'SEASONAL_CHECKUP', label: 'Seasonal health check-up', template: 'seasonal_checkup', preview: 'Monsoon check-up: stay ahead of seasonal illness.' },
  { kind: 'AWARENESS', label: 'Health awareness', template: 'health_awareness', preview: 'Tips to stay healthy this season from your doctors.' },
  { kind: 'RECALL', label: 'Recall lapsed patients', template: 'recall_due', preview: "It's been a while — time for your check-up." },
  { kind: 'ANNOUNCEMENT', label: 'Announcement', template: '', preview: '' },
];

/** Festival dates the clinic greets patients on. Saved as the whole list. */
function FestivalCalendar({ clinic }) {
  const qc = useQueryClient();
  const [list, setList] = useState(() => (clinic.festivals || []).map((f) => ({ name: f.name, date: dayjs(f.date).format('YYYY-MM-DD'), message: f.message || '' })));
  const [draft, setDraft] = useState({ name: '', date: '', message: '' });
  const save = useMutation({
    mutationFn: (festivals) => api.patch('/clinics/me', { festivals }),
    onSuccess: () => { toast.success('Festival calendar saved'); qc.invalidateQueries({ queryKey: ['clinic'] }); },
    onError: (e) => toast.error(e.message),
  });
  const commit = (next) => { setList(next); save.mutate(next.map(({ message, ...f }) => ({ ...f, ...(message ? { message } : {}) }))); };
  return (
    <Section title="Festival greetings calendar">
      <p className="muted mb-3">On each date, patients with marketing consent get your festival greeting (turn on "Festival greetings" above).</p>
      <ul className="mb-3 grid gap-2 sm:grid-cols-2">
        {list.sort((a, b) => a.date.localeCompare(b.date)).map((f, i) => (
          <li key={`${f.name}-${f.date}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm">
            <span><b>{f.name}</b> · {dayjs(f.date).format('D MMM YYYY')}{f.message && <span className="block truncate text-xs text-ink-muted">{f.message}</span>}</span>
            <button className="btn-quiet btn-sm" aria-label={`Remove ${f.name}`} onClick={() => commit(list.filter((_, j) => j !== i))}>Remove</button>
          </li>
        ))}
        {!list.length && <li className="text-sm text-ink-muted">No festivals added yet.</li>}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Festival" htmlFor="fe-n"><input id="fe-n" className="field-sm" placeholder="Diwali" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Date" htmlFor="fe-d"><input id="fe-d" type="date" className="field-sm" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
        <Field label="Message (optional)" htmlFor="fe-m" className="min-w-[220px] flex-1"><input id="fe-m" className="field-sm w-full" value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} /></Field>
        <button className="btn-primary btn-sm" disabled={draft.name.trim().length < 2 || !draft.date || save.isPending}
                onClick={() => { commit([...list, { ...draft, name: draft.name.trim() }]); setDraft({ name: '', date: '', message: '' }); }}>Add</button>
      </div>
    </Section>
  );
}
const REMINDER_OPTIONS = [1, 2, 3, 4, 6, 12, 24, 48, 72];

/** Delivery log with filters — shared by the WhatsApp page and the front desk. */
export function MessageLog({ patientId }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ['communications', status, page, patientId],
    queryFn: () => api.get('/automation/communications', { params: { status: status || undefined, page, patientId } }).then(unwrapPage),
  });
  const s = log.data?.meta?.last30Days || {};
  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard label="Sent (30 days)" value={(s.SENT || 0) + (s.DELIVERED || 0) + (s.READ || 0)} />
        <KpiCard label="Delivered / read" value={(s.DELIVERED || 0) + (s.READ || 0)} tone="navy" />
        <KpiCard label="Failed or blocked" value={s.FAILED || 0} tone="red" hint="Includes opt-outs and missing consent" />
        <KpiCard label="Inbound" value={s.RECEIVED || 0} tone="amber" />
      </KpiGrid>
      <select className="field-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
        <option value="">All statuses</option>{['SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
      </select>
      <DataTable loading={log.isLoading} error={log.error} rows={log.data?.data}
        empty={<EmptyState title="No messages yet" body="Confirmations and reminders appear here as they're sent." />}
        columns={[
          { key: 'when', header: 'When', render: (r) => dateTime(r.createdAt) },
          { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name || r.to },
          { key: 'event', header: 'Message', render: (r) => <div><p>{titleCase(r.event)}</p>{r.templateName && <p className="font-mono text-xs text-ink-muted">{r.templateName}</p>}</div> },
          { key: 'channel', header: 'Channel', hideOnMobile: true },
          { key: 'status', header: 'Status', render: (r) => <div><StatusBadge status={r.status} />{r.error && <p className="mt-0.5 max-w-[16rem] truncate text-xs text-ink-muted" title={r.error}>{r.error}</p>}</div> },
        ]} />
      <Pagination meta={log.data?.meta} page={page} onPage={setPage} />
    </div>
  );
}

export function WhatsAppAutomation() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('settings');
  const clinic = useQuery({ queryKey: ['clinic', 'me'], queryFn: () => api.get('/clinics/me').then(unwrap) });
  const health = useQuery({ queryKey: ['automation', 'health'], queryFn: () => api.get('/automation/health').then(unwrap) });
  const [ns, setNs] = useState(null);
  useEffect(() => { if (clinic.data) setNs({ events: { ...clinic.data.notificationSettings?.events }, templates: { ...(clinic.data.notificationSettings?.templates || {}) }, reminderHours: clinic.data.notificationSettings?.reminderHours || [24, 2] }); }, [clinic.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/clinics/me', { notificationSettings: { events: ns.events, templates: Object.fromEntries(Object.entries(ns.templates).filter(([, v]) => v)), reminderHours: ns.reminderHours } }),
    onSuccess: () => { toast.success('Automation settings saved'); qc.invalidateQueries({ queryKey: ['clinic'] }); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="WhatsApp automation" description="Which messages go out automatically, which Meta-approved template each uses, and how they were delivered." />
      {health.data && health.data.queue !== 'ready' && (
        <p className="mb-4 rounded-lg border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-signal">
          Background job queue is <b>{health.data.queue}</b>. Immediate messages (confirmations) still send, but scheduled reminders and follow-ups are recorded as not queued until Redis and the worker are running.
        </p>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'settings', label: 'Messages & templates' }, { value: 'log', label: 'Delivery log' }]} />
      {tab === 'settings' && (!ns ? <Skeleton className="h-80" /> : (
        <div className="space-y-5">
          <Section title="Automated messages">
            <p className="muted mb-4">WhatsApp only allows clinic-initiated messages through templates Meta has approved. Enter your approved template name, or leave blank to use the default shown. Messages never include diagnoses or results.</p>
            <ul className="divide-y divide-line">
              {EVENTS.map(([key, event, label, def]) => (
                <li key={key} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_260px]">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={OPT_IN.has(key) ? ns.events[key] === true : ns.events[key] !== false} onChange={(e) => setNs({ ...ns, events: { ...ns.events, [key]: e.target.checked } })} /> {label}</label>
                  <input className="field-sm w-full font-mono" placeholder={def} value={ns.templates[event] || ''} aria-label={`${label} template`}
                         onChange={(e) => setNs({ ...ns, templates: { ...ns.templates, [event]: e.target.value.trim() } })} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Reminder timing">
            <div className="flex flex-wrap gap-2">
              {REMINDER_OPTIONS.map((h) => {
                const on = ns.reminderHours.includes(h);
                return <button key={h} type="button" aria-pressed={on} disabled={!on && ns.reminderHours.length >= 3}
                               onClick={() => setNs({ ...ns, reminderHours: on ? ns.reminderHours.filter((x) => x !== h) : [...ns.reminderHours, h].sort((a, b) => b - a) })}
                               className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${on ? 'border-pulse bg-pulse text-white' : 'border-line bg-surface'}`}>{h}h before</button>;
              })}
            </div>
            <p className="mt-2 text-xs text-ink-muted">Up to three reminders. Template names follow the pattern appointment_reminder_&lt;hours&gt;h unless mapped above.</p>
          </Section>
          <div className="flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save automation</button></div>
          {clinic.data && <FestivalCalendar clinic={clinic.data} />}
        </div>
      ))}
      {tab === 'log' && <MessageLog />}
    </div>
  );
}

export function FollowupsRecall() {
  const qc = useQueryClient();
  const { hasFeature, user } = useAuth();
  const [tab, setTab] = useState('followups');
  const fu = useQuery({ queryKey: ['followups'], queryFn: () => api.get('/automation/followups').then(unwrap) });
  const rc = useQuery({ queryKey: ['recalls'], queryFn: () => api.get('/automation/recalls').then(unwrap), enabled: hasFeature('ai_recall') && user?.role === 'CLINIC_OWNER' });
  const act = useMutation({
    mutationFn: ({ kind, id, action, body }) => (kind === 'fu' ? api.patch(`/automation/followups/${id}`, body) : api.post(`/automation/recalls/${id}/${action}`)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['followups'] }); qc.invalidateQueries({ queryKey: ['recalls'] }); toast.success('Updated'); },
    onError: (e) => toast.error(e.message),
  });
  const isDoctor = user?.role === 'DOCTOR';
  return (
    <div>
      <PageHeader title={isDoctor ? 'Follow-ups' : 'Follow-ups and recall'} description="Follow-ups come from the doctor's consultation; recalls from services with a recall interval. Messages only go to patients who allow them." />
      {!isDoctor && <Tabs value={tab} onChange={setTab} tabs={[{ value: 'followups', label: 'Follow-ups', count: fu.data?.length }, { value: 'recall', label: 'Recall', count: rc.data?.length }]} />}
      {tab === 'followups' && (
        <DataTable loading={fu.isLoading} error={fu.error} rows={fu.data}
          empty={<EmptyState title="No follow-ups yet" body="When a doctor sets 'follow up in N days' on a consultation, it appears here." />}
          columns={[
            { key: 'due', header: 'Due', sort: (r) => r.dueDate, render: (r) => date(r.dueDate) },
            { key: 'patient', header: 'Patient', render: (r) => <div><p className="font-medium">{r.patientId?.name}</p><p className="font-mono text-xs text-ink-muted">{r.patientId?.phone}</p></div> },
            { key: 'doctor', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name },
            { key: 'note', header: 'Instructions', hideOnMobile: true, render: (r) => r.instructions || r.reason || '—' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'act', header: '', className: 'text-right', render: (r) => !['CLOSED', 'BOOKED'].includes(r.status) && (
              <div className="flex justify-end gap-1">
                <button className="btn-quiet btn-sm" onClick={() => act.mutate({ kind: 'fu', id: r._id, body: { status: 'ESCALATED' } })}>Escalate</button>
                <button className="btn-ghost btn-sm" onClick={() => act.mutate({ kind: 'fu', id: r._id, body: { status: 'CLOSED' } })}>Close</button>
              </div>
            ) },
          ]} />
      )}
      {tab === 'recall' && (!hasFeature('ai_recall') ? <div className="card"><EmptyState title="Recall is on the Pro plan" body="Upgrade to send recall reminders automatically." /></div> : (
        <DataTable loading={rc.isLoading} error={rc.error} rows={rc.data}
          empty={<EmptyState title="No recalls yet" body="Set 'recall after N days' on a service. Completing that service schedules a recall." />}
          columns={[
            { key: 'due', header: 'Due', sort: (r) => r.dueDate, render: (r) => date(r.dueDate) },
            { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
            { key: 'svc', header: 'For', render: (r) => r.serviceId?.name || r.recallType },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'act', header: '', className: 'text-right', render: (r) => ['DUE', 'NOTIFIED'].includes(r.status) && (
              <div className="flex justify-end gap-1">
                {r.status === 'DUE' && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ kind: 'rc', id: r._id, action: 'send' })}>Send now</button>}
                <button className="btn-quiet btn-sm" onClick={() => act.mutate({ kind: 'rc', id: r._id, action: 'dismiss' })}>Dismiss</button>
              </div>
            ) },
          ]} />
      ))}
    </div>
  );
}

function CampaignForm({ onClose }) {
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services').then(unwrap) });
  const [f, setF] = useState({ name: '', kind: 'RECALL', templateName: '', messagePreview: '', audience: { lastVisitBeforeDays: 180 } });
  const preview = useQuery({ queryKey: ['campaign-preview', f.audience], queryFn: () => api.post('/automation/campaigns/preview', { audience: f.audience }).then(unwrap) });
  const save = useMutation({ mutationFn: () => api.post('/automation/campaigns', f), onSuccess: () => { toast.success('Draft saved — approve it to send'); qc.invalidateQueries({ queryKey: ['campaigns'] }); onClose(); }, onError: (e) => toast.error(e.message) });
  const aud = f.audience;
  return (
    <Modal open onClose={onClose} title="New campaign" width="max-w-xl" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || f.name.length < 3 || !f.templateName} onClick={() => save.mutate()}>Save draft</button></>}>
      <div className="space-y-4">
        <div>
          <p className="label">Campaign type</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CAMPAIGN_TYPES.map((c) => (
              <button key={c.kind + c.label} type="button" aria-pressed={f.kind === c.kind && f.name === c.label}
                      onClick={() => setF({ ...f, kind: c.kind, name: c.label, templateName: c.template || f.templateName, messagePreview: c.preview })}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${f.kind === c.kind && f.name === c.label ? 'border-pulse bg-pulse-soft text-pulse-deep' : 'border-line hover:border-pulse/40'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Name" htmlFor="cp-name"><input id="cp-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Approved WhatsApp template" htmlFor="cp-tpl" hint="Exact template name from Meta. Only approved templates can be sent."><input id="cp-tpl" className="field font-mono" value={f.templateName} onChange={(e) => setF({ ...f, templateName: e.target.value.trim() })} /></Field>
        <Field label="Message preview (for your records)" htmlFor="cp-prev"><textarea id="cp-prev" className="field" value={f.messagePreview} onChange={(e) => setF({ ...f, messagePreview: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Last visit more than (days) ago" htmlFor="cp-days"><input id="cp-days" type="number" min="1" className="field" value={aud.lastVisitBeforeDays || ''} onChange={(e) => setF({ ...f, audience: { ...aud, lastVisitBeforeDays: e.target.value ? Number(e.target.value) : undefined } })} /></Field>
          <Field label="Gender" htmlFor="cp-g"><select id="cp-g" className="field" value={aud.gender || ''} onChange={(e) => setF({ ...f, audience: { ...aud, gender: e.target.value || undefined } })}><option value="">Any</option><option value="FEMALE">Women</option><option value="MALE">Men</option><option value="OTHER">Other</option></select></Field>
          <Field label="Age band" htmlFor="cp-a1">
            <div className="flex items-center gap-2">
              <input id="cp-a1" type="number" min="0" placeholder="Min" className="field" value={aud.minAge ?? ''} onChange={(e) => setF({ ...f, audience: { ...aud, minAge: e.target.value === '' ? undefined : Number(e.target.value) } })} />
              <span className="text-ink-muted">–</span>
              <input aria-label="Maximum age" type="number" min="0" placeholder="Max" className="field" value={aud.maxAge ?? ''} onChange={(e) => setF({ ...f, audience: { ...aud, maxAge: e.target.value === '' ? undefined : Number(e.target.value) } })} />
            </div>
          </Field>
          <Field label="Who had service" htmlFor="cp-svc"><select id="cp-svc" className="field" value={aud.serviceId || ''} onChange={(e) => setF({ ...f, audience: { ...aud, serviceId: e.target.value || undefined } })}><option value="">Any</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>
        </div>
        {preview.data && <p className="rounded-lg bg-paper p-3 text-sm"><b>{preview.data.eligible}</b> patients will receive this. {preview.data.excluded} excluded for no marketing consent or opt-out.</p>}
      </div>
    </Modal>
  );
}

export function ReviewsCampaigns() {
  const qc = useQueryClient();
  const { hasFeature } = useAuth();
  const [creating, setCreating] = useState(false);
  const clinic = useQuery({ queryKey: ['clinic', 'me'], queryFn: () => api.get('/clinics/me').then(unwrap) });
  const [review, setReview] = useState(null);
  useEffect(() => { if (clinic.data) setReview({ url: clinic.data.reviewUrl || '', on: Boolean(clinic.data.notificationSettings?.events?.reviewRequest), delay: clinic.data.notificationSettings?.reviewDelayHours || 3 }); }, [clinic.data]);
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get('/automation/campaigns').then(unwrap), enabled: hasFeature('campaigns') });
  const saveReview = useMutation({
    mutationFn: () => api.patch('/clinics/me', { reviewUrl: review.url, notificationSettings: { events: { reviewRequest: review.on && Boolean(review.url) }, reviewDelayHours: Number(review.delay) } }),
    onSuccess: () => { toast.success('Review settings saved'); qc.invalidateQueries({ queryKey: ['clinic'] }); },
    onError: (e) => toast.error(e.message),
  });
  const act = useMutation({
    mutationFn: ({ id, action }) => api.post(`/automation/campaigns/${id}/${action}`),
    onSuccess: () => { toast.success('Campaign updated'); qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Reviews and campaigns" description="Ask every patient for an honest review after their visit, and send approved recall or announcement campaigns." />
      <Section title="Review requests">
        {!hasFeature('reviews') ? <p className="muted">Review requests are on the Pro plan.</p> : !review ? <Skeleton className="h-24" /> : (
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field label="Your verified review link (Google Business profile)" htmlFor="rv-url"><input id="rv-url" className="field" placeholder="https://g.page/r/…/review" value={review.url} onChange={(e) => setReview({ ...review, url: e.target.value })} /></Field>
            <Field label="Send after (hours)" htmlFor="rv-d"><input id="rv-d" type="number" min="1" max="72" className="field" value={review.delay} onChange={(e) => setReview({ ...review, delay: e.target.value })} /></Field>
            <button className="btn-primary" disabled={saveReview.isPending} onClick={() => saveReview.mutate()}>Save</button>
            <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={review.on} disabled={!review.url} onChange={(e) => setReview({ ...review, on: e.target.checked })} /> Send a review request after every completed visit (all patients equally — no incentives, no filtering).</label>
          </div>
        )}
      </Section>
      <Section title="Campaigns" actions={hasFeature('campaigns') && <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New campaign</button>}>
        {!hasFeature('campaigns') ? <p className="muted">Campaigns are on the Pro plan.</p> : (
          <DataTable loading={campaigns.isLoading} rows={campaigns.data}
            empty={<EmptyState title="No campaigns yet" body="Draft a campaign, approve it, then send. Each patient receives it once." />}
            columns={[
              { key: 'name', header: 'Campaign', render: (c) => <div><p className="font-medium">{c.name}</p><p className="font-mono text-xs text-ink-muted">{c.templateName}</p></div> },
              { key: 'aud', header: 'Audience', hideOnMobile: true, render: (c) => (c.audience?.lastVisitBeforeDays ? `Not seen in ${c.audience.lastVisitBeforeDays}d` : 'All with consent') },
              { key: 'stats', header: 'Sent', render: (c) => (c.stats?.queued ? `${c.stats.queued} queued · ${c.stats.excluded} excluded` : '—') },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
              { key: 'act', header: '', className: 'text-right', render: (c) => (
                <div className="flex justify-end gap-1">
                  {c.status === 'DRAFT' && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: c._id, action: 'approve' })}>Approve</button>}
                  {c.status === 'APPROVED' && <button className="btn-primary btn-sm" onClick={() => act.mutate({ id: c._id, action: 'send' })}><Send className="h-3.5 w-3.5" /> Send</button>}
                  {['DRAFT', 'APPROVED'].includes(c.status) && <button className="btn-quiet btn-sm" onClick={() => act.mutate({ id: c._id, action: 'cancel' })}>Cancel</button>}
                </div>
              ) },
            ]} />
        )}
      </Section>
      {creating && <CampaignForm onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Front desk: message a patient and see the delivery log. */
export function PatientCommunication() {
  const qc = useQueryClient();
  const [patient, setPatient] = useState(null);
  const [channel, setChannel] = useState('WHATSAPP');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => api.post('/automation/communications', { patientId: patient._id, channel, body }).then(unwrap),
    onSuccess: (r) => { r.status === 'FAILED' ? toast.error(`Not sent: ${r.error}`) : toast.success('Message sent'); setBody(''); qc.invalidateQueries({ queryKey: ['communications'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Patient communication" description="Send a scheduling or logistics message. Never send diagnoses, results or prescriptions here — share those through the patient portal." />
      <Section title="New message">
        <div className="space-y-4">
          <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Channel" htmlFor="pc-ch"><select id="pc-ch" className="field" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></Field>
            <Field label="Message" htmlFor="pc-body" hint="On WhatsApp, outside 24h of the patient's last message this is sent through your approved staff_message template."><textarea id="pc-body" className="field min-h-[80px]" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end"><button className="btn-primary" disabled={!patient || body.trim().length < 2 || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <Spinner /> : <Send className="h-4 w-4" />} Send</button></div>
        </div>
      </Section>
      <MessageLog patientId={patient?._id} />
    </div>
  );
}
