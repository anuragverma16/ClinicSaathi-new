import dayjs from 'dayjs';
import { Clinic, Patient, Prescription, Communication } from '../models/index.js';
import { send } from './communication.service.js';
import { TZ } from '../utils/slots.js';

/**
 * Once-a-day patient messages: birthday wishes, festival greetings and
 * medicine reminders. Each is opt-in per clinic, respects the patient's
 * consent/opt-out inside send(), and is de-duplicated per patient per day,
 * so a re-run (worker restart, manual trigger) never double-sends.
 */
async function alreadySent(clinicId, patientId, event, since, extra = {}) {
  return Communication.exists({ patientId, event, createdAt: { $gte: since }, ...extra }).setOptions({ clinicId });
}

export async function runGreetings(now = dayjs().tz(TZ)) {
  const since = now.startOf('day').toDate();
  const today = now.format('MM-DD');
  const clinics = await Clinic.find({
    isActive: true,
    $or: [{ 'notificationSettings.events.birthday': true }, { 'notificationSettings.events.festival': true }],
  }).select('name notificationSettings festivals').lean();
  const stats = { birthdays: 0, festivals: 0 };

  for (const clinic of clinics) {
    const clinicId = clinic._id;
    if (clinic.notificationSettings?.events?.birthday) {
      const born = await Patient.aggregate([
        { $match: { dob: { $type: 'date' } } },
        { $project: { name: 1, md: { $dateToString: { format: '%m-%d', date: '$dob', timezone: TZ } } } },
        { $match: { md: today } }, { $limit: 2000 },
      ]).option({ clinicId });
      for (const p of born) {
        if (await alreadySent(clinicId, p._id, 'BIRTHDAY_WISH', since)) continue;
        const r = await send({ clinicId, patientId: p._id, channel: 'WHATSAPP', event: 'BIRTHDAY_WISH', templateName: 'birthday_wish', variables: { name: p.name.split(/\s+/)[0], clinic: clinic.name } });
        if (r?.status !== 'FAILED') stats.birthdays += 1;
      }
    }

    const festival = clinic.notificationSettings?.events?.festival
      && (clinic.festivals || []).find((f) => dayjs(f.date).tz(TZ).format('YYYY-MM-DD') === now.format('YYYY-MM-DD'));
    if (festival) {
      // send() drops anyone without marketing consent, so only consenting patients are fetched.
      const patients = await Patient.find({ 'consent.marketing.granted': true }).select('name').limit(5000).setOptions({ clinicId }).lean();
      for (const p of patients) {
        if (await alreadySent(clinicId, p._id, 'FESTIVAL_GREETING', since)) continue;
        const r = await send({
          clinicId, patientId: p._id, channel: 'WHATSAPP', event: 'FESTIVAL_GREETING', templateName: 'festival_greeting',
          variables: { name: p.name.split(/\s+/)[0], festival: festival.name, clinic: clinic.name, message: festival.message || '' },
        });
        if (r?.status !== 'FAILED') stats.festivals += 1;
      }
    }
  }
  return stats;
}

/** Daily nudge for every finalised prescription whose course is still running. */
export async function runMedicineReminders(now = dayjs().tz(TZ)) {
  const since = now.startOf('day').toDate();
  const clinics = await Clinic.find({ isActive: true, 'notificationSettings.events.medicineReminder': true }).select('_id').lean();
  let sent = 0;
  for (const { _id: clinicId } of clinics) {
    const rxs = await Prescription.find({ status: 'FINAL', finalizedAt: { $gte: now.subtract(90, 'day').toDate() } })
      .select('patientId medicines finalizedAt rxNumber').setOptions({ clinicId }).lean();
    for (const rx of rxs) {
      const running = (rx.medicines || []).filter((m) => m.durationDays && dayjs(rx.finalizedAt).tz(TZ).startOf('day').add(m.durationDays, 'day').isAfter(now));
      if (!running.length) continue;
      if (await alreadySent(clinicId, rx.patientId, 'MEDICINE_REMINDER', since)) continue;
      const list = running.map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` (${m.frequency})` : ''}`).join(', ');
      const r = await send({ clinicId, patientId: rx.patientId, channel: 'WHATSAPP', event: 'MEDICINE_REMINDER', templateName: 'medicine_reminder', variables: { medicines: list, rx: rx.rxNumber || '' } });
      if (r?.status !== 'FAILED') sent += 1;
    }
  }
  return { sent };
}
