import dayjs from 'dayjs';
import { TZ } from '../utils/slots.js';

/**
 * Deterministic understanding of a booking request, used when no LLM key is
 * configured (and to pre-resolve dates for the LLM). It only extracts what was
 * said — specialty, day and time window — and never infers anything clinical.
 */
const SPECIALTY_HINTS = {
  dermatolog: ['skin', 'derma', 'acne', 'rash', 'hair fall', 'dermatologist'],
  dent: ['teeth', 'tooth', 'dental', 'dentist', 'cleaning'],
  pediatric: ['child', 'kid', 'baby', 'paediatric', 'pediatrician'],
  cardio: ['heart', 'cardiologist', 'cardiac'],
  ortho: ['bone', 'joint', 'knee', 'back pain', 'orthopedic', 'orthopaedic'],
  ophthal: ['eye', 'vision', 'ophthalmologist'],
  gyn: ['gynae', 'gynecologist', 'gynaecologist', 'pregnan'],
  ent: [' ent ', 'ear', 'nose', 'throat'],
  'general': ['general physician', 'gp', 'fever', 'cold', 'general'],
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseDate(text, now = dayjs().tz(TZ)) {
  const t = ` ${text.toLowerCase()} `;
  if (/\btoday\b|\btonight\b/.test(t)) return now.format('YYYY-MM-DD');
  if (/\bday after tomorrow\b/.test(t)) return now.add(2, 'day').format('YYYY-MM-DD');
  if (/\btomorrow\b|\btmrw\b/.test(t)) return now.add(1, 'day').format('YYYY-MM-DD');
  for (let i = 0; i < 7; i += 1) {
    const name = WEEKDAYS[i];
    const m = t.match(new RegExp(`\\b(next\\s+)?(${name}|${name.slice(0, 3)})\\b`));
    if (m) {
      let diff = (i - now.day() + 7) % 7;
      if (diff === 0 && m[1]) diff = 7;
      if (m[1] && diff < 7 && /next\s+week/.test(t)) diff += 7;
      return now.add(diff, 'day').format('YYYY-MM-DD');
    }
  }
  const dm = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : now.year();
    const d = dayjs.tz(`${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`, TZ);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  return null;
}

function toHour(h, ampm) {
  let hour = Number(h);
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;   // "after 5" at a clinic means 5 PM
  return hour;
}

export function parseTimeWindow(text) {
  const t = text.toLowerCase();
  const out = {};
  const after = t.match(/\b(?:after|from|post)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  const before = t.match(/\b(?:before|by|until|till)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  const at = t.match(/\b(?:at|around)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  if (after) out.afterHour = toHour(after[1], after[2]);
  if (before) out.beforeHour = toHour(before[1], before[2]);
  if (at && !after && !before) { out.afterHour = toHour(at[1], at[2]); out.beforeHour = out.afterHour + 1; }
  if (!after && !before && !at) {
    if (/\bmorning\b/.test(t)) Object.assign(out, { afterHour: 6, beforeHour: 12 });
    else if (/\bafternoon\b/.test(t)) Object.assign(out, { afterHour: 12, beforeHour: 17 });
    else if (/\bevening\b/.test(t)) Object.assign(out, { afterHour: 17 });
  }
  return out;
}

/** Picks doctors the message points at, by name or by specialty wording. */
export function matchDoctors(text, doctors) {
  const t = ` ${text.toLowerCase()} `;
  const byName = doctors.filter((d) => {
    const parts = d.name.toLowerCase().replace(/^dr\.?\s*/, '').split(/\s+/).filter((p) => p.length > 2);
    return parts.some((p) => t.includes(p));
  });
  if (byName.length) return byName;
  const bySpec = doctors.filter((d) => {
    const spec = (d.specialization || '').toLowerCase();
    if (!spec) return false;
    if (t.includes(spec) || t.includes(spec.slice(0, 6))) return true;
    return Object.entries(SPECIALTY_HINTS).some(([key, hints]) => spec.includes(key) && hints.some((h) => t.includes(h)));
  });
  return bySpec;
}

export function interpret(text, doctors) {
  return { doctors: matchDoctors(text, doctors), date: parseDate(text), ...parseTimeWindow(text) };
}
