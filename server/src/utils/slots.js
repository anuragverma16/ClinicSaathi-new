import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(timezone);

export const TZ = 'Asia/Kolkata';

/** Canonical key for a slot. Also the value the unique index guards. */
export function slotKeyFor(startAt) {
  return dayjs(startAt).utc().format('YYYY-MM-DDTHH:mm');
}

export function dateKey(d, tz = TZ) {
  return dayjs(d).tz(tz).format('YYYY-MM-DD');
}

/** "09:30" -> minutes since midnight */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Expand a doctor's availability rules into candidate slots for one day.
 * Returns array of { startAt, endAt } in UTC Date form.
 */
export function generateSlots({ date, rules, breaks = [], slotDurationMins, tz = TZ, override }) {
  // A 'YYYY-MM-DD' string is taken as the clinic-local date as-is; a Date is
  // converted to the clinic timezone first so a UTC server can't shift the day.
  const ymd = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayjs(date).tz(tz).format('YYYY-MM-DD');
  const day = dayjs.tz(ymd, tz);
  const dow = day.day();
  // Hours the doctor set for this exact date replace the weekly pattern. The
  // weekly breaks go with it — those windows are already the hours they chose.
  const todaysRules = override ? (override.windows || []) : rules.filter((r) => r.dayOfWeek === dow);
  const todaysBreaks = override ? [] : breaks.filter((b) => b.dayOfWeek === dow);

  const slots = [];
  for (const rule of todaysRules) {
    let cursor = toMinutes(rule.startTime);
    const end = toMinutes(rule.endTime);
    while (cursor + slotDurationMins <= end) {
      const slotStart = cursor;
      const slotEnd = cursor + slotDurationMins;
      const overlapsBreak = todaysBreaks.some(
        (b) => slotStart < toMinutes(b.endTime) && slotEnd > toMinutes(b.startTime)
      );
      if (!overlapsBreak) {
        slots.push({
          startAt: day.add(slotStart, 'minute').toDate(),
          endAt: day.add(slotEnd, 'minute').toDate(),
        });
      }
      cursor += slotDurationMins;
    }
  }
  return slots.sort((a, b) => a.startAt - b.startAt);
}

export function isOnLeave(leaves = [], date) {
  const d = dayjs(date);
  return leaves.some((l) => d.isAfter(dayjs(l.from).subtract(1, 'day')) && d.isBefore(dayjs(l.to).add(1, 'day')));
}
