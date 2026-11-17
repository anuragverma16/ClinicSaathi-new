import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { api, unwrap } from '../../lib/api.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field } from '../../components/ui/Page.jsx';
import { Spinner } from '../../components/ui/States.jsx';
import { SlotPicker } from './BookingForm.jsx';
import { dateTime } from '../../lib/format.js';

/** Move an appointment to another open slot. Old reminders are replaced server-side. */
export function RescheduleDialog({ appointment, onClose }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(dayjs(appointment?.startAt).isAfter(dayjs()) ? dayjs(appointment.startAt).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'));
  const [startAt, setStartAt] = useState('');
  const go = useMutation({
    mutationFn: () => api.post(`/appointments/${appointment._id}/reschedule`, { startAt }).then(unwrap),
    onSuccess: (a) => { toast.success(`Moved to ${dateTime(a.startAt)} — patient notified`); qc.invalidateQueries({ queryKey: ['appointments'] }); onClose(); },
    onError: (e) => { toast.error(e.message); if (e.code === 'SLOT_UNAVAILABLE') { setStartAt(''); qc.invalidateQueries({ queryKey: ['availability'] }); } },
  });
  if (!appointment) return null;
  return (
    <Modal open onClose={onClose} title="Reschedule appointment" width="max-w-xl" footer={(
      <><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!startAt || go.isPending} onClick={() => go.mutate()}>{go.isPending && <Spinner />} Move appointment</button></>
    )}>
      <p className="mb-4 text-sm text-ink-muted">{appointment.patientId?.name} with {appointment.doctorId?.name} · currently {dateTime(appointment.startAt)}</p>
      <div className="space-y-4">
        <Field label="New date" htmlFor="rs-date">
          <input id="rs-date" type="date" className="field" min={dayjs().format('YYYY-MM-DD')} value={date} onChange={(e) => { setDate(e.target.value); setStartAt(''); }} />
        </Field>
        <Field label="New time">
          <SlotPicker doctorId={appointment.doctorId?._id || appointment.doctorId} date={date} serviceDurationMins={appointment.durationMins} value={startAt} onChange={setStartAt} />
        </Field>
      </div>
    </Modal>
  );
}
