import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, ExternalLink } from 'lucide-react';
import dayjs from 'dayjs';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section, Field, Tabs, fieldErrors } from '../../components/ui/Page.jsx';
import { Spinner, Skeleton } from '../../components/ui/States.jsx';
import { BookingChannels } from './BookingChannels.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Owner settings: profile, booking rules, holidays and integration ids. All validated server-side. */
export default function Settings() {
  const qc = useQueryClient();
  const { refreshMe } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'profile');
  const clinic = useQuery({ queryKey: ['clinic', 'me'], queryFn: () => api.get('/clinics/me').then(unwrap) });
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  const [holiday, setHoliday] = useState({ date: '', reason: '' });

  useEffect(() => {
    const c = clinic.data;
    if (!c) return;
    setF({
      name: c.name || '', tagline: c.tagline || '', about: c.about || '', email: c.email || '', phone: c.phone || '', gstin: c.gstin || '',
      address: { line1: c.address?.line1 || '', city: c.address?.city || '', state: c.address?.state || '', pincode: c.address?.pincode || '' },
      timings: { workingDays: c.timings?.workingDays || [], openTime: c.timings?.openTime || '09:00', closeTime: c.timings?.closeTime || '19:00' },
      bookingPolicy: { ...c.bookingPolicy },
      integrations: { whatsappPhoneNumberId: c.integrations?.whatsappPhoneNumberId || '' },
      patientInfo: { insurance: c.patientInfo?.insurance || '', parking: c.patientInfo?.parking || '', emergencyContact: c.patientInfo?.emergencyContact || '', mapUrl: c.patientInfo?.mapUrl || '' },
      channels: { websiteUrl: c.channels?.websiteUrl || '', googleBusinessUrl: c.channels?.googleBusinessUrl || '', facebookUrl: c.channels?.facebookUrl || '', instagramUrl: c.channels?.instagramUrl || '' },
    });
  }, [clinic.data]);

  const save = useMutation({
    mutationFn: (body) => api.patch('/clinics/me', body).then(unwrap),
    onSuccess: () => { toast.success('Settings saved'); setErrors({}); qc.invalidateQueries({ queryKey: ['clinic'] }); refreshMe(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  const addHoliday = useMutation({
    mutationFn: () => api.post('/clinics/me/holidays', holiday),
    onSuccess: () => { toast.success('Holiday added — that day is closed for booking'); setHoliday({ date: '', reason: '' }); qc.invalidateQueries({ queryKey: ['clinic'] }); },
    onError: (e) => toast.error(e.message),
  });
  const removeHoliday = useMutation({ mutationFn: (id) => api.delete(`/clinics/me/holidays/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic'] }) });

  if (!f) return <div><PageHeader title="Settings" /><Skeleton className="h-96" /></div>;
  const set = (path, v) => setF((x) => { const n = structuredClone(x); const ks = path.split('.'); let o = n; ks.slice(0, -1).forEach((k) => { o = o[k]; }); o[ks.at(-1)] = v; return n; });
  const bp = f.bookingPolicy;
  const bookingUrl = `${window.location.origin}/book/${clinic.data.slug}`;

  return (
    <div>
      <PageHeader title="Settings" description="Clinic profile, booking rules and integrations." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Clinic profile' }, { value: 'channels', label: 'Booking channels' }, { value: 'patient', label: 'Patient info & FAQ' }, { value: 'booking', label: 'Booking policy' }, { value: 'holidays', label: 'Holidays' }, { value: 'integrations', label: 'Integrations' }]} />

      {tab === 'profile' && (
        <Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic name" htmlFor="c-name" error={errors.name}><input id="c-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Tagline" htmlFor="c-tag"><input id="c-tag" className="field" value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
            <Field label="About (public page)" htmlFor="c-about" className="sm:col-span-2"><textarea id="c-about" className="field min-h-[80px]" value={f.about} onChange={(e) => set('about', e.target.value)} /></Field>
            <Field label="Phone" htmlFor="c-phone"><input id="c-phone" className="field" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email" htmlFor="c-email" error={errors.email}><input id="c-email" className="field" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="GSTIN" htmlFor="c-gst" error={errors.gstin} hint="Printed on tax invoices when GST applies."><input id="c-gst" className="field uppercase" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Field>
            <Field label="Address" htmlFor="c-addr"><input id="c-addr" className="field" value={f.address.line1} onChange={(e) => set('address.line1', e.target.value)} /></Field>
            <Field label="City" htmlFor="c-city"><input id="c-city" className="field" value={f.address.city} onChange={(e) => set('address.city', e.target.value)} /></Field>
            <Field label="Pincode" htmlFor="c-pin"><input id="c-pin" className="field" value={f.address.pincode} onChange={(e) => set('address.pincode', e.target.value)} /></Field>
            <div className="sm:col-span-2">
              <p className="label">Working days</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => {
                  const on = f.timings.workingDays.includes(i);
                  return <button key={d} type="button" aria-pressed={on} onClick={() => set('timings.workingDays', on ? f.timings.workingDays.filter((x) => x !== i) : [...f.timings.workingDays, i].sort())}
                                 className={`rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-pulse bg-pulse text-white' : 'border-line bg-surface'}`}>{d}</button>;
                })}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate({ name: f.name, tagline: f.tagline, about: f.about, phone: f.phone, email: f.email, gstin: f.gstin, address: f.address, timings: f.timings })}>{save.isPending && <Spinner />} Save profile</button>
          </div>
        </Section>
      )}

      {tab === 'channels' && <BookingChannels slug={clinic.data.slug} clinicName={clinic.data.name} />}

      {tab === 'patient' && (
        <div className="space-y-5">
          <Section title="What the AI receptionist tells patients">
            <p className="muted mb-4">Answered on WhatsApp ("Hi" menu → Location, Fees, Emergency Contact) and by the AI assistant when patients ask about insurance or parking.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Emergency contact" htmlFor="pi-em" hint="Shown with the 108 advice."><input id="pi-em" className="field" value={f.patientInfo.emergencyContact} onChange={(e) => set('patientInfo.emergencyContact', e.target.value)} /></Field>
              <Field label="Google Maps link" htmlFor="pi-map" error={errors['patientInfo.mapUrl']}><input id="pi-map" className="field" placeholder="https://maps.app.goo.gl/..." value={f.patientInfo.mapUrl} onChange={(e) => set('patientInfo.mapUrl', e.target.value.trim())} /></Field>
              <Field label="Insurance accepted" htmlFor="pi-ins" className="sm:col-span-2"><textarea id="pi-ins" className="field min-h-[70px]" placeholder="e.g. Cashless with Star Health, HDFC Ergo; reimbursement paperwork for others" value={f.patientInfo.insurance} onChange={(e) => set('patientInfo.insurance', e.target.value)} /></Field>
              <Field label="Parking" htmlFor="pi-park" className="sm:col-span-2"><input id="pi-park" className="field" placeholder="e.g. Free basement parking, entry from MG Road" value={f.patientInfo.parking} onChange={(e) => set('patientInfo.parking', e.target.value)} /></Field>
            </div>
          </Section>
          <Section title="Your online profiles">
            <p className="muted mb-4">Where your booking link is published. Add the matching link from the Booking channels tab to each one.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {[['websiteUrl', 'Clinic website'], ['googleBusinessUrl', 'Google Business Profile'], ['facebookUrl', 'Facebook page'], ['instagramUrl', 'Instagram profile']].map(([k, l]) => (
                <Field key={k} label={l} htmlFor={`ch-${k}`} error={errors[`channels.${k}`]}><input id={`ch-${k}`} className="field" placeholder="https://" value={f.channels[k]} onChange={(e) => set(`channels.${k}`, e.target.value.trim())} /></Field>
              ))}
            </div>
          </Section>
          <div className="flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate({ patientInfo: f.patientInfo, channels: f.channels })}>{save.isPending && <Spinner />} Save patient info</button></div>
        </div>
      )}

      {tab === 'booking' && (
        <Section>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-paper p-3 text-sm">
            Public booking link: <a className="inline-flex items-center gap-1 font-mono text-pulse-deep hover:underline" href={bookingUrl} target="_blank" rel="noreferrer">{bookingUrl}<ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bp.allowOnlineBooking !== false} onChange={(e) => set('bookingPolicy.allowOnlineBooking', e.target.checked)} /> Accept online bookings (website, portal, WhatsApp)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(bp.requirePhoneVerification)} onChange={(e) => set('bookingPolicy.requirePhoneVerification', e.target.checked)} /> Verify the patient's phone by OTP before booking</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={Boolean(bp.requirePrepayment)} onChange={(e) => set('bookingPolicy.requirePrepayment', e.target.checked)} /> Require online prepayment to confirm (only applies once Razorpay is configured)</label>
            <Field label="Unpaid hold released after (minutes)" htmlFor="bp-hold"><input id="bp-hold" type="number" min="5" max="120" className="field" value={bp.holdMinutes ?? 15} onChange={(e) => set('bookingPolicy.holdMinutes', Number(e.target.value))} /></Field>
            <Field label="Bookings open how many days ahead" htmlFor="bp-adv"><input id="bp-adv" type="number" min="1" max="365" className="field" value={bp.maxAdvanceDays ?? 60} onChange={(e) => set('bookingPolicy.maxAdvanceDays', Number(e.target.value))} /></Field>
            <Field label="Patients may cancel up to (hours before)" htmlFor="bp-cc"><input id="bp-cc" type="number" min="0" className="field" value={bp.cancelCutoffHours ?? 2} onChange={(e) => set('bookingPolicy.cancelCutoffHours', Number(e.target.value))} /></Field>
            <Field label="Patients may reschedule up to (hours before)" htmlFor="bp-rc"><input id="bp-rc" type="number" min="0" className="field" value={bp.rescheduleCutoffHours ?? 2} onChange={(e) => set('bookingPolicy.rescheduleCutoffHours', Number(e.target.value))} /></Field>
          </div>
          <div className="mt-5 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate({ bookingPolicy: bp })}>{save.isPending && <Spinner />} Save policy</button></div>
        </Section>
      )}

      {tab === 'holidays' && (
        <Section title="Clinic holidays" actions={null}>
          <p className="muted mb-3">No bookings are offered on these days, for any doctor.</p>
          <ul className="mb-4 space-y-1">
            {(clinic.data.holidays || []).sort((a, b) => new Date(a.date) - new Date(b.date)).map((h) => (
              <li key={h._id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span>{dayjs(h.date).format('ddd, DD MMM YYYY')}{h.reason ? ` · ${h.reason}` : ''}</span>
                <button className="btn-quiet btn-sm" aria-label="Remove holiday" onClick={() => removeHoliday.mutate(h._id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
            {!clinic.data.holidays?.length && <li className="text-sm text-ink-muted">No holidays set.</li>}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Date" htmlFor="h-date"><input id="h-date" type="date" className="field-sm" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /></Field>
            <Field label="Reason" htmlFor="h-r"><input id="h-r" className="field-sm" value={holiday.reason} onChange={(e) => setHoliday({ ...holiday, reason: e.target.value })} /></Field>
            <button className="btn-primary btn-sm" disabled={!holiday.date || addHoliday.isPending} onClick={() => addHoliday.mutate()}>Add holiday</button>
          </div>
        </Section>
      )}

      {tab === 'integrations' && (
        <Section>
          <Field label="WhatsApp Business phone number ID" htmlFor="i-wa" error={errors['integrations.whatsappPhoneNumberId']}
                 hint="From Meta's WhatsApp Manager. Routes inbound messages for this number to your clinic. API credentials are configured by the platform on the server, never here.">
            <input id="i-wa" className="field font-mono" value={f.integrations.whatsappPhoneNumberId} onChange={(e) => set('integrations.whatsappPhoneNumberId', e.target.value.trim())} />
          </Field>
          <div className="mt-5 flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate({ integrations: f.integrations })}>{save.isPending && <Spinner />} Save</button></div>
        </Section>
      )}
    </div>
  );
}
