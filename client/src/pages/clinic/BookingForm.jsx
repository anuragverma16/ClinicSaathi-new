import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { Search, X } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { Spinner } from '../../components/ui/States.jsx';
import { Field, fieldErrors } from '../../components/ui/Page.jsx';
import { inr } from '../../lib/format.js';

/** Live slot picker for one doctor/date. Re-fetched every time — someone else may book meanwhile. */
export function SlotPicker({ doctorId, date, serviceDurationMins, value, onChange }) {
  const slots = useQuery({
    queryKey: ['availability', doctorId, date, serviceDurationMins],
    queryFn: () => api.get('/appointments/availability', { params: { doctorId, date, serviceDurationMins } }).then(unwrap),
    enabled: Boolean(doctorId && date),
    staleTime: 0,
  });
  if (!doctorId) return <p className="text-sm text-ink-muted">Choose a doctor to see open slots.</p>;
  if (slots.isLoading) return <div className="flex items-center gap-2 text-sm text-ink-muted"><Spinner /> Checking the calendar…</div>;
  if (slots.error) return <p className="text-sm text-alert">{slots.error.message}</p>;
  if (!slots.data?.slots?.length) return <p className="rounded-lg bg-signal-soft px-3 py-2 text-sm text-signal">{slots.data?.reason || 'No open slots that day.'}</p>;
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Available times">
      {slots.data.slots.map((s) => {
        const selected = value === s.startAt;
        return (
          <button key={s.slotKey} type="button" role="radio" aria-checked={selected} onClick={() => onChange(s.startAt)}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-sm transition-colors ${selected ? 'border-pulse bg-pulse text-white' : 'border-line bg-surface hover:border-pulse hover:bg-pulse-soft'}`}>
            {dayjs(s.startAt).format('h:mm A')}
          </button>
        );
      })}
    </div>
  );
}

/** Search an existing patient or switch to entering a new one. */
export function PatientPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['patients', 'pick', q],
    queryFn: () => api.get('/patients', { params: { q, limit: 8 } }).then(unwrap),
    enabled: q.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-pulse/40 bg-pulse-soft/40 px-3 py-2">
        <div><p className="text-sm font-medium">{value.name}</p><p className="font-mono text-xs text-ink-muted">{value.phone}</p></div>
        <button type="button" className="btn-quiet btn-sm" onClick={() => onChange(null)} aria-label="Change patient"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-[1.15rem] h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <input className="field pl-9" placeholder="Search existing patient by name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patient" />
      {q.trim().length >= 2 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface">
          {results.isLoading && <li className="px-3 py-2 text-sm text-ink-muted">Searching…</li>}
          {results.data?.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No match — enter the new patient's details below.</li>}
          {results.data?.map((p) => (
            <li key={p._id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-paper-sunk" onClick={() => onChange(p)}>
                <span className="text-sm font-medium">{p.name}</span> <span className="font-mono text-xs text-ink-muted">{p.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EMPTY = { doctorId: '', serviceId: '', date: dayjs().format('YYYY-MM-DD'), startAt: '', reason: '', name: '', phone: '', source: 'RECEPTION', mode: 'OFFLINE' };

/**
 * Staff booking. The server re-validates the slot against the schedule and
 * the double-booking index; if it was just taken we refresh the slots.
 */
export function BookingForm({ onBooked, initialPatient = null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [patient, setPatient] = useState(initialPatient);
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(['doctorId', 'date', 'serviceId'].includes(k) ? { startAt: '' } : {}) }));

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services', { params: { isActive: 'true', limit: 100 } }).then(unwrap) });
  const service = services.data?.find((s) => s._id === form.serviceId);
  const doctor = doctors.data?.find((d) => d._id === form.doctorId);

  const book = useMutation({
    mutationFn: () => api.post('/appointments', {
      doctorId: form.doctorId, serviceId: form.serviceId || undefined, startAt: form.startAt,
      ...(patient ? { patientId: patient._id } : { newPatient: { name: form.name, phone: form.phone } }),
      reason: form.reason || undefined, source: form.source, mode: form.mode,
    }).then(unwrap),
    onSuccess: (appt) => {
      toast.success(`Booked · ref ${appt.bookingRef}`);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setForm({ ...EMPTY, doctorId: form.doctorId, date: form.date });
      setPatient(initialPatient);
      setErrors({});
      onBooked?.(appt);
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(e.message);
      if (e.code === 'SLOT_UNAVAILABLE') { set('startAt', ''); qc.invalidateQueries({ queryKey: ['availability'] }); }
    },
  });

  const canBook = form.doctorId && form.startAt && (patient || (form.name.trim().length > 1 && form.phone.replace(/\D/g, '').length >= 10));

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (canBook) book.mutate(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Doctor" htmlFor="bk-doctor">
          <select id="bk-doctor" className="field" value={form.doctorId} onChange={(e) => set('doctorId', e.target.value)}>
            <option value="">Choose a doctor</option>
            {doctors.data?.map((d) => <option key={d._id} value={d._id}>{d.name}{d.specialization ? ` — ${d.specialization}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Service" htmlFor="bk-service" hint={service ? `${service.durationMins} min · ${inr(service.fee)}` : doctor ? `Consultation · ${inr(doctor.consultationFee)}` : undefined}>
          <select id="bk-service" className="field" value={form.serviceId} onChange={(e) => set('serviceId', e.target.value)}>
            <option value="">General consultation</option>
            {services.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Field label="Date" htmlFor="bk-date">
          <input id="bk-date" type="date" className="field" min={dayjs().format('YYYY-MM-DD')} value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Time">
          <SlotPicker doctorId={form.doctorId} date={form.date} serviceDurationMins={service?.durationMins} value={form.startAt} onChange={(v) => set('startAt', v)} />
        </Field>
      </div>

      <hr className="border-line" />
      <Field label="Patient">
        <PatientPicker value={patient} onChange={setPatient} />
      </Field>
      {!patient && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New patient name" htmlFor="bk-name" error={errors['newPatient.name']}>
            <input id="bk-name" className="field" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Mobile number" htmlFor="bk-phone" error={errors['newPatient.phone']} hint="An existing number attaches to that patient's record.">
            <input id="bk-phone" type="tel" className="field" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reason for visit" htmlFor="bk-reason">
          <input id="bk-reason" className="field" placeholder="Optional" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        <Field label="Booked via" htmlFor="bk-source">
          <select id="bk-source" className="field" value={form.source} onChange={(e) => set('source', e.target.value)}>
            <option value="RECEPTION">Front desk</option><option value="PHONE">Phone call</option><option value="WHATSAPP">WhatsApp</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.mode === 'ONLINE'} onChange={(e) => set('mode', e.target.checked ? 'ONLINE' : 'OFFLINE')} />
          Video consultation (teleconsult) — a private video room link is created for the doctor and patient
        </label>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={!canBook || book.isPending} className="btn-primary">{book.isPending && <Spinner />} Book appointment</button>
      </div>
    </form>
  );
}
