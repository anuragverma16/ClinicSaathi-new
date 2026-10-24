import jwt from 'jsonwebtoken';
import dayjs from 'dayjs';
import { env } from '../config/env.js';
import { Appointment, Doctor, Clinic } from '../models/index.js';
import { tenantPopulate } from '../models/plugins/tenantScope.js';

/**
 * Calendar sync without OAuth: each doctor gets a private, unguessable ICS
 * feed URL that Google Calendar / Outlook subscribe to and poll. The token
 * names the doctor and clinic; nothing else is trusted from the request.
 */
export const feedToken = (clinicId, doctorId) =>
  jwt.sign({ c: String(clinicId), d: String(doctorId), p: 'cal-feed' }, env.jwt.accessSecret);

export function readFeedToken(token) {
  const claims = jwt.verify(token, env.jwt.accessSecret);
  if (claims.p !== 'cal-feed') throw new Error('wrong token');
  return { clinicId: claims.c, doctorId: claims.d };
}

const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const stamp = (d) => dayjs(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Builds the doctor's feed: 30 days back, 90 ahead, live appointments only. Patients appear by first name. */
export async function buildDoctorFeed({ clinicId, doctorId }) {
  const [clinic, doctor, appts] = await Promise.all([
    Clinic.findById(clinicId).select('name address').lean(),
    Doctor.findOne({ _id: doctorId }).setOptions({ clinicId }).select('name').lean(),
    Appointment.find({
      doctorId,
      startAt: { $gte: dayjs().subtract(30, 'day').toDate(), $lte: dayjs().add(90, 'day').toDate() },
      status: { $in: ['REQUESTED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED'] },
    }).populate(tenantPopulate(clinicId, 'patientId', 'name')).setOptions({ clinicId }).lean(),
  ]);
  if (!doctor) return null;
  const where = [clinic?.address?.line1, clinic?.address?.city].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClinicSaathi//Doctor Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${doctor.name} · ${clinic?.name || 'ClinicSaathi'}`)}`, 'X-WR-TIMEZONE:Asia/Kolkata',
  ];
  for (const a of appts) {
    const first = (a.patientId?.name || 'Patient').split(/\s+/)[0];
    lines.push(
      'BEGIN:VEVENT', `UID:${a._id}@clinicsaathi`, `DTSTAMP:${stamp(a.updatedAt || new Date())}`,
      `DTSTART:${stamp(a.startAt)}`, `DTEND:${stamp(a.endAt)}`,
      `SUMMARY:${esc(`${first}${a.mode === 'ONLINE' ? ' (video)' : ''} · ${a.bookingRef || ''}`)}`,
      ...(where ? [`LOCATION:${esc(a.meetingUrl || where)}`] : []),
      `STATUS:${a.status === 'REQUESTED' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
