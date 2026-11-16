import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { MapPin, Phone, Clock, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api, unwrap, razorpayCheckout } from '../../lib/api.js';
import { Spinner, ErrorState } from '../../components/ui/States.jsx';
import { LogoMark } from '../../components/marketing/Logo.jsx';

/**
 * Mobile-first public booking. The clinic comes from the URL slug, so the
 * caller never supplies a clinicId; the server re-validates the slot.
 */
export default function PublicBooking() {
  const { slug } = useParams();
  // ?src= tags the channel the link was shared on (QR, Google, Facebook...) for analytics.
  const [params] = useSearchParams();
  const SOURCES = { qr: 'QR', google: 'GOOGLE', facebook: 'FACEBOOK', instagram: 'INSTAGRAM', whatsapp: 'WHATSAPP', link: 'BOOKING_LINK', website: 'WEBSITE' };
  const source = SOURCES[String(params.get('src') || '').toLowerCase()] || 'WEBSITE';
  const [step, setStep] = useState(1);
  const [pick, setPick] = useState({ serviceId: '', doctorId: null, date: dayjs().format('YYYY-MM-DD'), startAt: null });
  const [details, setDetails] = useState({ name: '', phone: '', email: '', reason: '', consentGiven: false, marketingConsent: false, otp: '' });
  const [otpSent, setOtpSent] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [payState, setPayState] = useState(null);

  const clinic = useQuery({ queryKey: ['pub-clinic', slug], queryFn: () => api.get(`/public/${slug}`).then(unwrap), retry: false });
  const doctors = useQuery({ queryKey: ['pub-doctors', slug], queryFn: () => api.get(`/public/${slug}/doctors`).then(unwrap), enabled: clinic.isSuccess });
  const services = useQuery({ queryKey: ['pub-services', slug], queryFn: () => api.get(`/public/${slug}/services`).then(unwrap), enabled: clinic.isSuccess });
  const slots = useQuery({
    queryKey: ['pub-slots', slug, pick.doctorId, pick.date, pick.serviceId],
    queryFn: () => api.get(`/public/${slug}/availability`, { params: { doctorId: pick.doctorId, date: pick.date, serviceId: pick.serviceId || undefined } }).then(unwrap),
    enabled: Boolean(pick.doctorId), staleTime: 0,
  });
  const phone = details.phone.startsWith('+') ? details.phone : `+91${details.phone.replace(/\D/g, '').slice(-10)}`;
  const sendOtp = useMutation({ mutationFn: () => api.post(`/public/${slug}/verify-phone`, { phone }), onSuccess: () => setOtpSent(true) });
  const book = useMutation({
    mutationFn: () => api.post(`/public/${slug}/appointments`, {
      doctorId: pick.doctorId, serviceId: pick.serviceId || undefined, startAt: pick.startAt,
      name: details.name, phone, email: details.email || undefined, reason: details.reason || undefined,
      consentGiven: true, marketingConsent: details.marketingConsent, otp: details.otp || undefined, source,
    }).then(unwrap),
    onSuccess: async (data) => {
      setConfirmed(data); setStep(4);
      if (data.payment) {
        try {
          const resp = await razorpayCheckout({ keyId: data.payment.keyId, order: data.payment.order, name: clinic.data.name, description: `Booking ${data.bookingRef}`, prefill: { name: details.name, contact: phone } });
          const v = await api.post(`/public/${slug}/payments/verify`, resp).then(unwrap);
          setPayState(v.status === 'SUCCESS' ? 'paid' : 'pending');
        } catch (e) { setPayState(`failed:${e.message}`); }
      }
    },
  });

  if (clinic.isLoading) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-6 w-6 text-pulse" /></div>;
  if (clinic.error) return <div className="min-h-screen bg-paper p-6"><div className="card mx-auto max-w-md"><ErrorState error={clinic.error} /></div></div>;
  const c = clinic.data;
  const doctor = doctors.data?.find((d) => d._id === pick.doctorId);
  const service = services.data?.find((s) => s._id === pick.serviceId);
  const fee = service?.fee ?? doctor?.consultationFee ?? 0;
  const detailsOk = details.name.trim().length > 1 && details.phone.replace(/\D/g, '').length >= 10 && details.consentGiven && (!c.booking.phoneVerification || details.otp.length === 6);

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-navy px-5 py-6 text-white">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3"><LogoMark className="h-9 w-9" /><div><h1 className="font-display text-xl font-semibold">{c.name}</h1>{c.tagline && <p className="text-sm text-navy-text">{c.tagline}</p>}</div></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-text">
            {c.address?.line1 && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[c.address.line1, c.address.city].filter(Boolean).join(', ')}</span>}
            {c.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{c.phone}</span>}
            {c.timings?.openTime && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{c.timings.openTime}–{c.timings.closeTime}</span>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-6">
        {!c.booking.online ? <div className="card p-6 text-center"><p className="font-medium">This clinic takes bookings by phone.</p>{c.phone && <a className="btn-primary mt-4" href={`tel:${c.phone}`}>Call {c.phone}</a>}</div> : <>
          {step < 4 && <ol className="mb-6 flex gap-1.5" aria-label="Progress">{[1, 2, 3].map((n) => <li key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-pulse' : 'bg-line'}`} />)}</ol>}

          {step === 1 && (
            <section>
              <h2 className="font-display text-xl font-semibold">Who would you like to see?</h2>
              {services.data?.length > 0 && (
                <div className="mt-4"><label className="label" htmlFor="pub-svc">Service (optional)</label>
                  <select id="pub-svc" className="field" value={pick.serviceId} onChange={(e) => setPick({ ...pick, serviceId: e.target.value })}>
                    <option value="">General consultation</option>{services.data.map((s) => <option key={s._id} value={s._id}>{s.name} · ₹{s.fee} · {s.durationMins} min</option>)}
                  </select>
                </div>
              )}
              {doctors.isLoading && <div className="mt-4"><Spinner /></div>}
              <ul className="mt-4 space-y-2">
                {doctors.data?.map((d) => (
                  <li key={d._id}>
                    <button onClick={() => { setPick({ ...pick, doctorId: d._id, startAt: null }); setStep(2); }} className="card w-full p-4 text-left transition hover:border-pulse">
                      <p className="font-medium">{d.name}</p>
                      <p className="text-sm text-ink-muted">{[d.specialization, d.qualification, d.experienceYears && `${d.experienceYears} yrs`].filter(Boolean).join(' · ')}</p>
                      <p className="mt-1 text-sm font-medium text-pulse-deep">₹{service?.fee ?? d.consultationFee}</p>
                    </button>
                  </li>
                ))}
                {doctors.data?.length === 0 && <li className="text-sm text-ink-muted">No doctors are taking online bookings yet.</li>}
              </ul>
            </section>
          )}

          {step === 2 && (
            <section>
              <button onClick={() => setStep(1)} className="btn-quiet mb-3 px-0 text-sm">← Back</button>
              <h2 className="font-display text-xl font-semibold">Pick a time with {doctor?.name}</h2>
              <input type="date" className="field mt-4" value={pick.date} min={dayjs().format('YYYY-MM-DD')} max={dayjs().add(c.booking.maxAdvanceDays, 'day').format('YYYY-MM-DD')}
                     onChange={(e) => setPick({ ...pick, date: e.target.value, startAt: null })} aria-label="Date" />
              {slots.isLoading && <div className="mt-4 flex items-center gap-2 text-sm text-ink-muted"><Spinner /> Checking…</div>}
              {!slots.isLoading && !slots.data?.slots?.length && <p className="mt-4 rounded-lg bg-signal-soft px-3 py-3 text-sm text-signal">{slots.data?.reason || 'No open times that day. Try another date.'}</p>}
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.data?.slots?.map((s) => (
                  <button key={s.slotKey} onClick={() => { setPick({ ...pick, startAt: s.startAt }); setStep(3); }} className="rounded-lg border border-line bg-surface py-2.5 font-mono text-sm transition hover:border-pulse hover:bg-pulse-soft">{dayjs(s.startAt).format('h:mm A')}</button>
                ))}
              </div>
            </section>
          )}

          {step === 3 && (
            <section>
              <button onClick={() => setStep(2)} className="btn-quiet mb-3 px-0 text-sm">← Back</button>
              <h2 className="font-display text-xl font-semibold">Your details</h2>
              <p className="mt-1 text-sm text-ink-muted">{doctor?.name} · {dayjs(pick.startAt).format('ddd DD MMM, h:mm A')} · ₹{fee}</p>
              <div className="mt-5 space-y-4">
                <div><label className="label" htmlFor="n">Full name</label><input id="n" autoComplete="name" className="field" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} /></div>
                <div><label className="label" htmlFor="p">Mobile number</label>
                  <div className="flex gap-2"><input id="p" type="tel" inputMode="tel" autoComplete="tel" className="field" value={details.phone} onChange={(e) => { setDetails({ ...details, phone: e.target.value, otp: '' }); setOtpSent(false); }} />
                    {c.booking.phoneVerification && <button className="btn-ghost shrink-0" disabled={details.phone.replace(/\D/g, '').length < 10 || sendOtp.isPending} onClick={() => sendOtp.mutate()}>{otpSent ? 'Resend' : 'Send code'}</button>}</div>
                  {sendOtp.error && <p className="mt-1 text-xs text-alert">{sendOtp.error.message}</p>}
                </div>
                {c.booking.phoneVerification && otpSent && <div><label className="label" htmlFor="o">6-digit code</label><input id="o" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="field font-mono tracking-[0.4em]" value={details.otp} onChange={(e) => setDetails({ ...details, otp: e.target.value.replace(/\D/g, '') })} /></div>}
                <div><label className="label" htmlFor="e">Email (optional)</label><input id="e" type="email" className="field" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} /></div>
                <div><label className="label" htmlFor="r">What's it about? (optional)</label><input id="r" className="field" value={details.reason} onChange={(e) => setDetails({ ...details, reason: e.target.value })} /></div>
                <label className="flex items-start gap-2.5 text-sm text-ink-soft"><input type="checkbox" className="mt-0.5" checked={details.consentGiven} onChange={(e) => setDetails({ ...details, consentGiven: e.target.checked })} /><span>I agree that {c.name} may store my details to provide care and contact me about this appointment.</span></label>
                <label className="flex items-start gap-2.5 text-sm text-ink-soft"><input type="checkbox" className="mt-0.5" checked={details.marketingConsent} onChange={(e) => setDetails({ ...details, marketingConsent: e.target.checked })} /><span>Send me check-up reminders and clinic updates (optional).</span></label>
                {book.error && (
                  <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert">{book.error.message}
                    {book.error.code === 'SLOT_UNAVAILABLE' && <button onClick={() => { setStep(2); slots.refetch(); }} className="ml-1 underline">Pick another time</button>}
                  </p>
                )}
                <button onClick={() => book.mutate()} disabled={!detailsOk || book.isPending} className="btn-primary w-full">{book.isPending && <Spinner />} {c.booking.prepayment ? `Continue to pay ₹${fee}` : 'Confirm booking'}</button>
                <p className="flex items-center justify-center gap-1 text-xs text-ink-muted"><ShieldCheck className="h-3.5 w-3.5" /> Your details go only to {c.name}.</p>
              </div>
            </section>
          )}

          {step === 4 && confirmed && (
            <section className="text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-pulse" />
              <h2 className="mt-3 font-display text-2xl font-semibold">{confirmed.status === 'CONFIRMED' || payState === 'paid' ? 'You\'re booked' : payState?.startsWith('failed') ? 'Payment not completed' : 'Slot held for you'}</h2>
              <p className="mt-2 text-ink-soft">{doctor?.name}<br />{dayjs(confirmed.startAt).format('dddd, DD MMMM · h:mm A')}</p>
              <div className="card mx-auto mt-6 max-w-sm p-4 text-left text-sm">
                <p className="text-ink-muted">Booking reference</p><p className="font-mono text-lg font-semibold">{confirmed.bookingRef}</p>
                <p className="mt-3 text-ink-muted">Fee</p><p className="font-medium">₹{confirmed.fee}{payState === 'paid' ? ' · paid' : confirmed.payment ? '' : ' · pay at the clinic'}</p>
                {payState?.startsWith('failed') && <p className="mt-3 text-alert">{payState.slice(7)}. The slot is held until {dayjs(confirmed.payment.holdExpiresAt).format('h:mm A')}; sign in to the patient portal to pay.</p>}
                <p className="mt-3 text-ink-muted">A confirmation is on its way to {phone}. Quote the reference if you call the clinic.</p>
              </div>
              <Link to={`/patient/login?clinic=${slug}`} className="btn-ghost mt-6">Manage this booking in the patient portal</Link>
            </section>
          )}
        </>}
      </main>
    </div>
  );
}
