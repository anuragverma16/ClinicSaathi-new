import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, ShieldCheck, Download, TriangleAlert } from 'lucide-react';
import { api, unwrap, openFile } from '../../lib/api.js';
import { Drawer, Tabs, Field } from '../../components/ui/Page.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { date, age, titleCase } from '../../lib/format.js';

const VITALS = [['bpSystolic', 'BP sys'], ['bpDiastolic', 'BP dia'], ['pulse', 'Pulse'], ['tempC', 'Temp °C'], ['spo2', 'SpO₂ %'], ['weightKg', 'Weight kg'], ['heightCm', 'Height cm'], ['bloodSugar', 'Sugar mg/dL']];
const EMPTY_MED = { name: '', dosage: '', frequency: '', durationDays: '', timing: 'ANY', instructions: '' };

function PrescriptionEditor({ consultation, onChanged }) {
  const qc = useQueryClient();
  const rxList = useQuery({ queryKey: ['prescriptions', 'c', consultation._id], queryFn: () => api.get('/prescriptions', { params: { consultationId: consultation._id } }).then(unwrap) });
  const draft = rxList.data?.find((r) => r.status === 'DRAFT');
  const finals = rxList.data?.filter((r) => r.status === 'FINAL') || [];
  const [meds, setMeds] = useState([{ ...EMPTY_MED }]);
  const [advice, setAdvice] = useState('');
  useEffect(() => { if (draft) { setMeds(draft.medicines.length ? draft.medicines.map((m) => ({ ...EMPTY_MED, ...m, durationDays: m.durationDays ?? '' })) : [{ ...EMPTY_MED }]); setAdvice(draft.advice || ''); } }, [draft?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setMed = (i, k, v) => setMeds((m) => m.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const body = () => ({
    medicines: meds.filter((m) => m.name.trim()).map((m) => ({ ...m, durationDays: m.durationDays ? Number(m.durationDays) : undefined, dosage: m.dosage || undefined, frequency: m.frequency || undefined, instructions: m.instructions || undefined })),
    advice: advice || undefined,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['prescriptions'] }); onChanged?.(); };
  const saveDraft = useMutation({
    mutationFn: async () => (draft ? api.patch(`/prescriptions/${draft._id}`, body()) : api.post('/prescriptions', { consultationId: consultation._id, ...body() })).then(unwrap),
    onSuccess: () => { toast.success('Draft saved'); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const sign = useMutation({
    mutationFn: async () => {
      const d = draft ? unwrap(await api.patch(`/prescriptions/${draft._id}`, body())) : unwrap(await api.post('/prescriptions', { consultationId: consultation._id, ...body() }));
      return api.post(`/prescriptions/${d._id}/finalize`).then(unwrap);
    },
    onSuccess: (rx) => { toast.success(`${rx.rxNumber} signed — the patient can now see it`); setMeds([{ ...EMPTY_MED }]); setAdvice(''); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const ready = meds.some((m) => m.name.trim()) || advice.trim();
  return (
    <div className="space-y-3">
      {finals.map((r) => (
        <div key={r._id} className="flex items-center justify-between rounded-lg border border-pulse/30 bg-pulse-soft/30 px-3 py-2 text-sm">
          <span><b>{r.rxNumber}</b> · {r.medicines.map((m) => m.name).join(', ') || 'Advice'}</span>
          <span className="flex items-center gap-1"><StatusBadge status="FINAL" /><button className="btn-quiet btn-sm" onClick={() => openFile('prescription', r._id).catch((e) => toast.error(e.message))}><Download className="h-3.5 w-3.5" /></button></span>
        </div>
      ))}
      {meds.map((m, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-6">
            <input className="field sm:col-span-2" placeholder="Medicine" value={m.name} onChange={(e) => setMed(i, 'name', e.target.value)} aria-label={`Medicine ${i + 1}`} />
            <input className="field" placeholder="500mg" value={m.dosage} onChange={(e) => setMed(i, 'dosage', e.target.value)} aria-label="Dosage" />
            <input className="field" placeholder="1-0-1" value={m.frequency} onChange={(e) => setMed(i, 'frequency', e.target.value)} aria-label="Frequency" />
            <input className="field" type="number" min="1" placeholder="Days" value={m.durationDays} onChange={(e) => setMed(i, 'durationDays', e.target.value)} aria-label="Days" />
            <select className="field" value={m.timing} onChange={(e) => setMed(i, 'timing', e.target.value)} aria-label="Timing"><option value="ANY">Any time</option><option value="BEFORE_FOOD">Before food</option><option value="AFTER_FOOD">After food</option></select>
            <input className="field sm:col-span-6" placeholder="Instructions (optional)" value={m.instructions} onChange={(e) => setMed(i, 'instructions', e.target.value)} aria-label="Instructions" />
          </div>
          <button type="button" className="btn-quiet h-fit p-2" aria-label="Remove medicine" onClick={() => setMeds((x) => (x.length > 1 ? x.filter((_, idx) => idx !== i) : [{ ...EMPTY_MED }]))}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" className="btn-quiet btn-sm" onClick={() => setMeds((x) => [...x, { ...EMPTY_MED }])}><Plus className="h-3.5 w-3.5" /> Add medicine</button>
      <Field label="Advice" htmlFor="rx-adv"><textarea id="rx-adv" className="field min-h-[50px]" value={advice} onChange={(e) => setAdvice(e.target.value)} /></Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-ink-muted"><ShieldCheck className="h-3.5 w-3.5" /> Signing locks the prescription with your registration number.</p>
        <div className="flex gap-2">
          <button className="btn-ghost btn-sm" disabled={!ready || saveDraft.isPending} onClick={() => saveDraft.mutate()}>Save draft</button>
          <button className="btn-primary btn-sm" disabled={!ready || sign.isPending} onClick={() => sign.mutate()}>{sign.isPending && <Spinner className="h-3 w-3" />} Review & sign</button>
        </div>
      </div>
    </div>
  );
}

function LabOrderForm({ consultation }) {
  const qc = useQueryClient();
  const [tests, setTests] = useState('');
  const [priority, setPriority] = useState('ROUTINE');
  const [notes, setNotes] = useState('');
  const orders = useQuery({ queryKey: ['lab', 'orders', 'c', consultation._id], queryFn: () => api.get('/lab/orders', { params: { patientId: consultation.patientId?._id || consultation.patientId } }).then(unwrap) });
  const order = useMutation({
    mutationFn: () => api.post('/lab/orders', { consultationId: consultation._id, tests: tests.split(',').map((t) => t.trim()).filter(Boolean).map((name) => ({ name })), priority, clinicalNotes: notes || undefined }),
    onSuccess: () => { toast.success('Lab order sent'); setTests(''); setNotes(''); qc.invalidateQueries({ queryKey: ['lab'] }); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <Field label="Tests (comma separated)" htmlFor="lo-t"><input id="lo-t" className="field" placeholder="CBC, Lipid profile, HbA1c" value={tests} onChange={(e) => setTests(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Priority" htmlFor="lo-p"><select id="lo-p" className="field" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option></select></Field>
        <Field label="Note to lab" htmlFor="lo-n"><input id="lo-n" className="field" placeholder="e.g. fasting sample" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end"><button className="btn-primary btn-sm" disabled={!tests.trim() || order.isPending} onClick={() => order.mutate()}>Send order</button></div>
      <ul className="space-y-1.5">
        {orders.data?.map((o) => <li key={o._id} className="flex justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{o.orderNumber} · {o.tests.map((t) => t.name).join(', ')}</span><StatusBadge status={o.status} /></li>)}
      </ul>
    </div>
  );
}

/**
 * The consultation workspace. Opens (or resumes) the consultation for an
 * appointment. Everything here is the doctor's own record; AI does not draft
 * any of it.
 */
export function ConsultationWorkspace({ appointment, onClose, onCompleted }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('notes');
  const [c, setC] = useState(null);
  const [notes, setNotes] = useState({ symptoms: '', diagnosis: '', clinicalNotes: '', treatmentPlan: '', followUpDays: '', followUpInstructions: '', vitals: {} });
  const [allergyText, setAllergyText] = useState('');
  const [addendum, setAddendum] = useState('');
  const patientId = appointment?.patientId?._id || appointment?.patientId;

  const open = useMutation({
    mutationFn: () => api.post('/consultations', { appointmentId: appointment._id }).then(unwrap),
    onSuccess: (data) => setC(data),
    onError: (e) => toast.error(e.message),
  });
  // Open once per appointment, even under StrictMode's double effect run.
  const openedFor = useRef(null);
  useEffect(() => {
    if (appointment && openedFor.current !== appointment._id) { openedFor.current = appointment._id; open.mutate(); }
  }, [appointment?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline = useQuery({ queryKey: ['patient-timeline', patientId], queryFn: () => api.get(`/patients/${patientId}/timeline`).then(unwrap), enabled: Boolean(patientId) });
  useEffect(() => {
    if (!c) return;
    setNotes({ symptoms: c.symptoms || '', diagnosis: c.diagnosis || '', clinicalNotes: c.clinicalNotes || '', treatmentPlan: c.treatmentPlan || '', followUpDays: '', followUpInstructions: c.followUpInstructions || '', vitals: c.vitals || {} });
  }, [c?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAllergyText(timeline.data?.patient?.allergies?.join(', ') || ''); }, [timeline.data]);

  const notePayload = () => {
    const vitals = Object.fromEntries(Object.entries(notes.vitals || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]));
    return {
      symptoms: notes.symptoms, diagnosis: notes.diagnosis, clinicalNotes: notes.clinicalNotes, treatmentPlan: notes.treatmentPlan,
      followUpInstructions: notes.followUpInstructions || undefined, ...(Object.keys(vitals).length ? { vitals } : {}),
      ...(notes.followUpDays ? { followUpDays: Number(notes.followUpDays) } : {}),
    };
  };
  const save = useMutation({
    mutationFn: () => api.patch(`/consultations/${c._id}`, notePayload()).then(unwrap),
    onSuccess: (d) => { setC(d); toast.success('Notes saved'); },
    onError: (e) => toast.error(e.message),
  });
  const saveAllergies = useMutation({
    mutationFn: () => api.post(`/consultations/${c._id}/allergies`, { allergies: allergyText.split(',').map((a) => a.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success('Allergies updated'); qc.invalidateQueries({ queryKey: ['patient-timeline', patientId] }); },
    onError: (e) => toast.error(e.message),
  });
  const complete = useMutation({
    mutationFn: async () => { const d = unwrap(await api.patch(`/consultations/${c._id}`, notePayload())); return api.post(`/consultations/${d._id}/complete`).then(unwrap); },
    onSuccess: () => { toast.success('Visit completed'); qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['appointments'] }); onCompleted?.(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const addAddendum = useMutation({
    mutationFn: () => api.post(`/consultations/${c._id}/addendum`, { text: addendum }).then(unwrap),
    onSuccess: (d) => { setC(d); setAddendum(''); toast.success('Addendum added'); },
    onError: (e) => toast.error(e.message),
  });
  if (!appointment) return null;
  const p = timeline.data?.patient;
  const locked = c?.status === 'COMPLETED';
  const set = (k, v) => setNotes((n) => ({ ...n, [k]: v }));

  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={`Consultation · ${appointment.patientId?.name || p?.name || ''}`}
      subtitle={p ? [age(p.dob), p.gender && titleCase(p.gender), p.phone].filter(Boolean).join(' · ') : ''}
      footer={!c ? null : locked ? <StatusBadge status="COMPLETED" /> : <>
        <button className="btn-ghost" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Spinner />} Save notes</button>
        <button className="btn-primary" onClick={() => complete.mutate()} disabled={complete.isPending}>{complete.isPending && <Spinner />} Complete visit</button>
      </>}>
      {!c ? <div className="flex justify-center py-10"><Spinner className="h-5 w-5" /></div> : (
        <div className="space-y-5">
          <div className="rounded-lg border border-signal/30 bg-signal-soft/50 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-signal"><TriangleAlert className="h-4 w-4" /> Allergies</p>
            <div className="mt-2 flex gap-2">
              <input className="field-sm flex-1" placeholder="None recorded — e.g. penicillin, sulfa" value={allergyText} onChange={(e) => setAllergyText(e.target.value)} aria-label="Allergies" />
              <button className="btn-ghost btn-sm" onClick={() => saveAllergies.mutate()} disabled={saveAllergies.isPending}>Confirm</button>
            </div>
            {p?.chronicConditions?.length > 0 && <p className="mt-2 text-xs text-ink-soft">Chronic: {p.chronicConditions.join(', ')}</p>}
          </div>

          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'notes', label: 'Notes & diagnosis' }, { value: 'rx', label: 'Prescription' }, { value: 'lab', label: 'Lab orders' }, { value: 'history', label: 'History', count: timeline.data?.consultations?.length }]} />

          {tab === 'notes' && (
            <fieldset disabled={locked} className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {VITALS.map(([k, label]) => (
                  <label key={k} className="text-xs text-ink-muted">{label}
                    <input type="number" step="any" className="field mt-1 py-1.5 text-sm" value={notes.vitals?.[k] ?? ''} onChange={(e) => set('vitals', { ...notes.vitals, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <Field label="Symptoms / complaints" htmlFor="cw-s"><textarea id="cw-s" className="field min-h-[60px]" value={notes.symptoms} onChange={(e) => set('symptoms', e.target.value)} /></Field>
              <Field label="Diagnosis" htmlFor="cw-d"><input id="cw-d" className="field" value={notes.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} /></Field>
              <Field label="Clinical notes" htmlFor="cw-n"><textarea id="cw-n" className="field min-h-[80px]" value={notes.clinicalNotes} onChange={(e) => set('clinicalNotes', e.target.value)} /></Field>
              <Field label="Treatment plan" htmlFor="cw-p"><textarea id="cw-p" className="field min-h-[60px]" value={notes.treatmentPlan} onChange={(e) => set('treatmentPlan', e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <Field label="Follow up in (days)" htmlFor="cw-f"><input id="cw-f" type="number" min="1" max="365" className="field" value={notes.followUpDays} onChange={(e) => set('followUpDays', e.target.value)} /></Field>
                <Field label="Follow-up message to patient" htmlFor="cw-fi" hint="Sent as written in the reminder. Keep it non-clinical."><input id="cw-fi" className="field" placeholder="Please book a review visit" value={notes.followUpInstructions} onChange={(e) => set('followUpInstructions', e.target.value)} /></Field>
              </div>
            </fieldset>
          )}
          {locked && tab === 'notes' && (
            <div className="space-y-2">
              {c.addenda?.map((a) => <p key={a._id} className="border-l-2 border-signal pl-2 text-sm">Addendum {date(a.at)}: {a.text}</p>)}
              <div className="flex gap-2"><input className="field" placeholder="Add an addendum to this closed record" value={addendum} onChange={(e) => setAddendum(e.target.value)} aria-label="Addendum" /><button className="btn-ghost" disabled={addendum.trim().length < 3} onClick={() => addAddendum.mutate()}>Add</button></div>
            </div>
          )}
          {tab === 'rx' && <PrescriptionEditor consultation={c} />}
          {tab === 'lab' && <LabOrderForm consultation={c} />}
          {tab === 'history' && (
            <ul className="space-y-2">
              {timeline.data?.consultations?.filter((x) => x._id !== c._id).map((x) => (
                <li key={x._id} className="rounded-lg border border-line px-3 py-2">
                  <p className="text-sm font-medium">{x.diagnosis || 'No diagnosis recorded'}</p>
                  <p className="text-xs text-ink-muted">{date(x.createdAt)} · {x.doctorId?.name}</p>
                  {x.treatmentPlan && <p className="mt-1 text-sm text-ink-soft">{x.treatmentPlan}</p>}
                </li>
              ))}
              {timeline.data?.prescriptions?.filter((r) => r.status === 'FINAL').map((r) => (
                <li key={r._id} className="rounded-lg border border-line px-3 py-2 text-sm">Rx {date(r.finalizedAt)}: {r.medicines.map((m) => `${m.name} ${m.dosage || ''}`).join(', ')}</li>
              ))}
              {!timeline.data?.consultations?.filter((x) => x._id !== c._id).length && <p className="py-6 text-center text-sm text-ink-muted">First visit — no earlier records.</p>}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  );
}
