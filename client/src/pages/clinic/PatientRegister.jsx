import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, unwrap } from '../../lib/api.js';
import { PageHeader, Field, Section, fieldErrors } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { BookingForm } from './BookingForm.jsx';
import Patients from './Patients.jsx';

const EMPTY = { name: '', phone: '', email: '', gender: '', dob: '', city: '', guardianPatientId: '', relationToGuardian: '', consent: false, marketing: false };

/** Front-desk registration with a live duplicate check on the phone number. */
export default function PatientRegister() {
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [created, setCreated] = useState(null);
  const [debouncedPhone, setDebouncedPhone] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { const t = setTimeout(() => setDebouncedPhone(f.phone), 400); return () => clearTimeout(t); }, [f.phone]);

  const dupes = useQuery({
    queryKey: ['patients', 'dupe', debouncedPhone],
    queryFn: () => api.get('/patients/check-duplicate', { params: { phone: debouncedPhone.startsWith('+') ? debouncedPhone : `+91${debouncedPhone.replace(/\D/g, '').slice(-10)}` } }).then(unwrap),
    enabled: debouncedPhone.replace(/\D/g, '').length >= 10,
  });
  const matches = dupes.data?.matches || [];
  const selfMatch = matches.find((m) => !m.guardianPatientId);

  const save = useMutation({
    mutationFn: () => api.post('/patients', {
      name: f.name, phone: f.phone.startsWith('+') ? f.phone : `+91${f.phone.replace(/\D/g, '').slice(-10)}`,
      email: f.email, ...(f.gender ? { gender: f.gender } : {}), dob: f.dob, address: f.city ? { city: f.city } : undefined,
      ...(f.guardianPatientId ? { guardianPatientId: f.guardianPatientId, relationToGuardian: f.relationToGuardian } : {}),
      consent: { dataProcessing: { granted: true }, marketing: { granted: f.marketing } },
    }).then(unwrap),
    onSuccess: (p) => { toast.success(`${p.name} registered`); setCreated(p); setF(EMPTY); setErrors({}); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Patient registration" description="Register a new patient. Existing numbers are flagged so the clinic keeps one record per person." />
      <Section>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="pr-name" error={errors.name}><input id="pr-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Mobile number" htmlFor="pr-phone" error={errors.phone}><input id="pr-phone" type="tel" className="field" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>
          {matches.length > 0 && (
            <div className="rounded-lg border border-signal/40 bg-signal-soft px-3 py-2 text-sm">
              <p className="font-medium text-signal">This number is already registered:</p>
              <ul className="mt-1 space-y-1">
                {matches.map((m) => (
                  <li key={m._id} className="flex items-center justify-between gap-2">
                    <span>{m.name}{m.guardianPatientId ? ' (dependent)' : ''}</span>
                    {!m.guardianPatientId && <button type="button" className="btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, guardianPatientId: m._id }))}>Register as their dependent</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.guardianPatientId && (
            <Field label="Relation to guardian" htmlFor="pr-rel" hint="Child, parent or other family member sharing this number.">
              <input id="pr-rel" className="field" value={f.relationToGuardian} onChange={(e) => set('relationToGuardian', e.target.value)} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Gender" htmlFor="pr-g"><select id="pr-g" className="field" value={f.gender} onChange={(e) => set('gender', e.target.value)}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field>
            <Field label="Date of birth" htmlFor="pr-dob"><input id="pr-dob" type="date" className="field" value={f.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
            <Field label="Email" htmlFor="pr-email" error={errors.email}><input id="pr-email" type="email" className="field" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="City" htmlFor="pr-city"><input id="pr-city" className="field" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} /> Patient consents to the clinic storing their health and contact details (required).</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.marketing} onChange={(e) => set('marketing', e.target.checked)} /> Patient agrees to recall reminders and clinic announcements (optional).</label>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={save.isPending || !f.consent || f.name.trim().length < 2 || (selfMatch && !f.guardianPatientId)}>{save.isPending && <Spinner />} Register patient</button>
          </div>
        </form>
      </Section>

      <Patients title="Find a patient" description="Search existing records before registering." />

      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title={`Book for ${created?.name || ''}?`} width="max-w-2xl">
        {created && <BookingForm initialPatient={created} onBooked={() => setCreated(null)} />}
      </Modal>
    </div>
  );
}
