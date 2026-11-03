import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { TZ } from '../utils/slots.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Deterministic understanding of a booking request, used when no LLM key is
 * configured (and to pre-resolve dates for the LLM). It only extracts what was
 * said — doctor, specialty, day and time window — and never infers anything
 * clinical: specialty hints map a named body area or a specialist's title to a
 * department, never a symptom's seriousness. Emergencies are caught upstream.
 */

// ------------------------------------------------------------------ helpers

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word / whole-phrase matcher. A trailing "*" makes an entry a prefix ("pregnan*"). */
function wordsRx(words) {
  const parts = words.map((w) => (w.endsWith('*') ? `${escapeRx(w.slice(0, -1))}[a-z]*` : escapeRx(w)));
  return new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?=$|[^a-z0-9])`, 'i');
}

/** Lower-case, straighten quotes, drop punctuation that splits words oddly, collapse spaces. */
export function normalise(text = '') {
  return ` ${String(text).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9:/'&+\-.\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

// --------------------------------------------------------------- specialties

/**
 * Each entry has:
 *  - spec:  how this department is written in Doctor.specialization
 *  - hints: what a patient might type (English, Hindi, Hinglish), whole words only
 * Order matters only for ties; every matching department is returned.
 */
const SPECIALTIES = [
  {
    key: 'dermatology',
    spec: /dermat|skin|cosmetolog|venereolog|trichol/,
    hints: wordsRx([
      'skin', 'derma', 'derm', 'dermatology', 'dermatologist', 'skin doctor', 'skin specialist',
      'acne', 'pimple', 'pimples', 'rash', 'rashes', 'eczema', 'psoriasis', 'itching', 'itchy', 'hives',
      'hair fall', 'hairfall', 'hair loss', 'hair thinning', 'dandruff', 'bald*', 'scalp',
      'pigmentation', 'dark spots', 'tanning', 'mole', 'moles', 'wart', 'warts', 'fungal infection', 'nail infection',
      'twacha', 'chamdi', 'khujli', 'daane', 'baal jhad*', 'baal gir*',
    ]),
  },
  {
    key: 'dentistry',
    spec: /dent|orthodont|endodont|periodont|prosthodont|oral|maxillofacial/,
    hints: wordsRx([
      'tooth', 'teeth', 'toothache', 'tooth ache', 'dental', 'dentist', 'dentistry',
      'gum', 'gums', 'cavity', 'cavities', 'braces', 'aligners', 'root canal', 'rct', 'wisdom tooth',
      'teeth cleaning', 'scaling', 'filling', 'crown', 'denture', 'dentures', 'jaw',
      'daant', 'daat', 'dant', 'masoode', 'masude',
    ]),
  },
  {
    key: 'paediatrics',
    spec: /p(a)?ediatr|child|neonat|kids/,
    hints: wordsRx([
      'child', 'children', 'kid', 'kids', 'baby', 'babies', 'infant', 'newborn', 'new born', 'toddler',
      'paediatric', 'pediatric', 'paediatrician', 'pediatrician', 'paeds', 'peds', 'child specialist',
      'baby vaccination', 'child vaccination',
      'bachcha', 'bachche', 'bacche', 'baccha', 'bachhe', 'shishu',
    ]),
  },
  {
    key: 'cardiology',
    spec: /cardi|heart/,
    hints: wordsRx([
      'heart', 'cardiac', 'cardio', 'cardiology', 'cardiologist', 'heart specialist', 'heart doctor',
      'bp', 'blood pressure', 'hypertension', 'palpitation', 'palpitations', 'ecg', 'echo', '2d echo', 'tmt',
      'dil', 'dil ka doctor',
    ]),
  },
  {
    key: 'orthopaedics',
    spec: /orthop|bone|joint|spine|sports med/,
    hints: wordsRx([
      'bone', 'bones', 'joint', 'joints', 'knee', 'knees', 'shoulder', 'elbow', 'wrist', 'ankle', 'hip',
      'back pain', 'backache', 'lower back', 'neck pain', 'spine', 'slip disc', 'fracture', 'sprain',
      'ligament', 'arthritis', 'frozen shoulder', 'orthopedic', 'orthopaedic', 'orthopedician', 'ortho', 'bone doctor',
      'haddi', 'ghutna', 'ghutne', 'kamar dard', 'kamar', 'jodon', 'jodo ka dard',
    ]),
  },
  {
    key: 'ophthalmology',
    spec: /ophthal|eye|optom/,
    hints: wordsRx([
      'eye', 'eyes', 'vision', 'eyesight', 'eye sight', 'spectacles', 'glasses', 'specs', 'contact lens', 'lens',
      'cataract', 'squint', 'eye checkup', 'eye test', 'ophthalmologist', 'eye specialist', 'eye doctor',
      'aankh', 'aankhon', 'ankh', 'chashma', 'nazar',
    ]),
  },
  {
    key: 'gynaecology',
    spec: /gyn|obstet|women|ivf|fertility/,
    hints: wordsRx([
      'gynae', 'gyne', 'gyno', 'gynaecology', 'gynecology', 'gynaecologist', 'gynecologist', 'obgyn', 'ob gyn',
      'pregnan*', 'prenatal', 'antenatal', 'periods', 'period problem', 'menstrual', 'pcos', 'pcod',
      'fertility', 'ivf', 'lady doctor', 'women doctor', "women's health",
      'garbh*', 'mahavari',
    ]),
  },
  {
    key: 'ent',
    spec: /(^|[^a-z])ent([^a-z]|$)|otorhino|otolaryng|ear.{0,6}nose/,
    hints: wordsRx([
      'ent', 'ear', 'ears', 'earache', 'ear pain', 'nose', 'nasal', 'throat', 'sore throat', 'sinus', 'sinusitis',
      'tonsil', 'tonsils', 'hearing', 'ear wax', 'snoring', 'ent specialist',
      'kaan', 'naak', 'gala', 'gale',
    ]),
  },
  {
    key: 'psychiatry',
    spec: /psych|mental|counsel/,
    hints: wordsRx([
      'psychiatrist', 'psychiatry', 'psychologist', 'therapist', 'therapy', 'counsellor', 'counselor', 'counselling', 'counseling',
      'anxiety', 'depression', 'stress', 'mental health', 'insomnia', 'sleep problem', 'panic attacks', 'ocd', 'adhd',
      'tanav', 'neend',
    ]),
  },
  {
    key: 'neurology',
    spec: /neuro/,
    hints: wordsRx(['neurologist', 'neurology', 'neuro', 'nerve', 'nerves', 'migraine', 'numbness', 'tingling', 'vertigo', 'epilepsy']),
  },
  {
    key: 'gastroenterology',
    spec: /gastro|digest|hepat|liver/,
    hints: wordsRx([
      'gastro', 'gastroenterologist', 'stomach', 'acidity', 'gastric', 'gas problem', 'indigestion', 'digestion',
      'constipation', 'liver', 'ibs', 'endoscopy', 'colonoscopy', 'pet dard', 'pet mein', 'pet ki',
    ]),
  },
  {
    key: 'urology',
    spec: /urolog|nephro|kidney/,
    hints: wordsRx(['urologist', 'urology', 'nephrologist', 'kidney', 'kidneys', 'kidney stone', 'stone', 'urine', 'urinary', 'prostate', 'peshab']),
  },
  {
    key: 'endocrinology',
    spec: /endocrin|diabet|thyroid/,
    hints: wordsRx(['diabetes', 'diabetic', 'sugar', 'blood sugar', 'thyroid', 'diabetologist', 'endocrinologist', 'hormone', 'hormones']),
  },
  {
    key: 'pulmonology',
    spec: /pulmon|chest|respirat|lung/,
    hints: wordsRx(['pulmonologist', 'chest specialist', 'lungs', 'lung', 'asthma', 'copd', 'wheezing', 'chronic cough', 'tb', 'tuberculosis']),
  },
  {
    key: 'physiotherapy',
    spec: /physio|rehab/,
    hints: wordsRx(['physio', 'physiotherapy', 'physiotherapist', 'physical therapy', 'rehab', 'rehabilitation', 'exercise therapy']),
  },
  {
    key: 'nutrition',
    spec: /diet|nutri/,
    hints: wordsRx(['dietitian', 'dietician', 'nutritionist', 'nutrition', 'diet plan', 'diet chart', 'weight loss', 'weight gain']),
  },
  {
    key: 'general',
    spec: /general (medicine|physician|practi)|family (medicine|physician|doctor)|internal medicine|(^|[^a-z])gp([^a-z]|$)|(^|[^a-z])physician|mbbs/,
    hints: wordsRx([
      'general physician', 'general doctor', 'general practitioner', 'gp', 'family doctor', 'physician', 'md medicine',
      'fever', 'cold', 'cough', 'flu', 'viral', 'body ache', 'weakness', 'check up', 'checkup', 'check-up',
      'health checkup', 'routine checkup', 'medical certificate', 'fitness certificate',
      'bukhar', 'bukhaar', 'khansi', 'zukam', 'jukam', 'sardi',
    ]),
  },
];

/** Departments the message points at, by specialist title or body-area wording. */
export function matchSpecialties(text) {
  const t = normalise(text);
  return SPECIALTIES.filter((s) => s.hints.test(t)).map((s) => s.key);
}

/** Which catalogue department a doctor belongs to (null if unknown specialty). */
function departmentOf(doctor) {
  const spec = ` ${(doctor.specialization || '').toLowerCase()} `;
  if (!spec.trim()) return null;
  // Surgery is not general medicine even if the title says "General Surgeon".
  return SPECIALTIES.find((s) => s.spec.test(spec) && !(s.key === 'general' && /surg/.test(spec)))?.key || null;
}

// ---------------------------------------------------------------- doctor names

const NAME_STOPWORDS = new Set([
  'dr', 'doctor', 'doc', 'mr', 'mrs', 'ms', 'miss', 'prof', 'sir', 'madam', 'the', 'and', 'for', 'with',
  'kumar', 'kumari', 'devi', 'singh', 'lal', // too common in Indian names to identify a doctor alone
]);

function nameTokens(name = '') {
  return name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 3 && !NAME_STOPWORDS.has(p));
}

/** Score = how many of the doctor's name tokens appear as whole words; "dr <name>" earns a bonus. */
function nameScore(t, doctor) {
  const tokens = nameTokens(doctor.name);
  let score = 0;
  for (const tok of tokens) {
    if (wordsRx([tok]).test(t)) score += 1;
    if (new RegExp(`(?:^|[^a-z])(?:dr|doctor|doc)\\.?\\s*${escapeRx(tok)}(?=$|[^a-z])`).test(t)) score += 1;
  }
  return score;
}

/** Picks doctors the message points at, by name first, then by specialty wording. */
export function matchDoctors(text, doctors = []) {
  const t = normalise(text);
  const active = doctors.filter((d) => d && d.name);

  // 1. By name — keep only the best-scoring doctors ("Dr Mehta" vs "Dr Anil Mehta").
  const scored = active.map((d) => ({ d, score: nameScore(t, d) })).filter((x) => x.score > 0);
  if (scored.length) {
    const best = Math.max(...scored.map((x) => x.score));
    return scored.filter((x) => x.score === best).map((x) => x.d);
  }

  // 2. By department wording.
  const wanted = new Set(matchSpecialties(text));
  if (wanted.size) {
    const hits = active.filter((d) => wanted.has(departmentOf(d)));
    if (hits.length) return hits;
    // A child's complaint with no paediatrician on staff → fall back to general physicians.
    if (wanted.has('paediatrics')) {
      const gps = active.filter((d) => departmentOf(d) === 'general');
      if (gps.length) return gps;
    }
  }

  // 3. Specialties not in the catalogue (e.g. "Homeopathy", "Ayurveda"): whole-phrase match on the title.
  return active.filter((d) => {
    if (departmentOf(d)) return false;
    const words = (d.specialization || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 5);
    return words.length > 0 && words.some((w) => wordsRx([w.length >= 8 ? `${w.slice(0, w.length - 2)}*` : w]).test(t));
  });
}

// ------------------------------------------------------------------- dates

const WEEKDAYS = [
  ['sunday', 'sun', 'ravivar', 'raviwar', 'itvaar', 'itwar', 'itvar'],
  ['monday', 'mon', 'somvar', 'somwar', 'somvaar'],
  ['tuesday', 'tue', 'tues', 'mangalvar', 'mangalwar', 'mangal'],
  ['wednesday', 'wed', 'budhvar', 'budhwar', 'budh'],
  ['thursday', 'thu', 'thur', 'thurs', 'guruvar', 'guruwar', 'veervar', 'brihaspativar'],
  ['friday', 'fri', 'shukravar', 'shukrawar', 'shukra'],
  ['saturday', 'sat', 'shanivar', 'shaniwar', 'shani'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RX = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Builds a date only if it really exists (no 31 Feb rolling into March). */
function makeDate(year, month1, day) {
  const d = dayjs.tz(`${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, TZ);
  return d.isValid() && d.date() === Number(day) && d.month() + 1 === Number(month1) ? d : null;
}

/** A date with no year that has already passed this year means next year. */
function rollForward(d, now, yearGiven) {
  if (!d) return null;
  if (!yearGiven && d.isBefore(now.startOf('day'))) return d.add(1, 'year');
  return d;
}

/** Removes time expressions so "10-12" or "5:30" are never read as dates. */
function stripTimes(t) {
  return t
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|to|and|se)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/g, ' ')
    .replace(/\bbetween\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|to|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/g, ' ')
    .replace(/\b\d{1,2}\s*(?:am|pm|baje)\b/g, ' ');
}

export function parseDate(text, now = dayjs().tz(TZ)) {
  const t = stripTimes(normalise(text));

  if (/\b(today|tonight|aaj|abhi)\b/.test(t)) return now.format('YYYY-MM-DD');
  if (/\b(day after tomorrow|day after tmrw|parso|parson|parsoon)\b/.test(t)) return now.add(2, 'day').format('YYYY-MM-DD');
  if (/\b(tomorrow|tomorow|tommorow|tommorrow|tmrw|tmr|kal)\b/.test(t)) return now.add(1, 'day').format('YYYY-MM-DD');

  const inDays = t.match(/\bin\s+(\d{1,2}|a|one|two|three|four|five|six|seven)\s+days?\b/);
  if (inDays) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[inDays[1]] ?? Number(inDays[1]);
    if (n >= 0 && n <= 60) return now.add(n, 'day').format('YYYY-MM-DD');
  }

  // Explicit calendar dates win over weekdays ("Friday 6 Nov").
  // "6 Nov", "6th November", "6 nov 2026"
  let m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RX}\\b(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const d = makeDate(m[3] || now.year(), MONTHS.indexOf(m[2].slice(0, 3)) + 1, m[1]);
    if (d) return rollForward(d, now, Boolean(m[3])).format('YYYY-MM-DD');
  }
  // "Nov 6", "November 6th, 2026"
  m = t.match(new RegExp(`\\b${MONTH_RX}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?`));
  if (m) {
    const d = makeDate(m[3] || now.year(), MONTHS.indexOf(m[1].slice(0, 3)) + 1, m[2]);
    if (d) return rollForward(d, now, Boolean(m[3])).format('YYYY-MM-DD');
  }
  // "6/11", "06-11-2026", "6/11/26" — Indian day-first order.
  m = t.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : now.year();
    const d = makeDate(year, m[2], m[1]);
    if (d) return rollForward(d, now, Boolean(m[3])).format('YYYY-MM-DD');
  }

  // Weekdays — the first one mentioned in the message.
  let first = null;
  WEEKDAYS.forEach((names, dow) => {
    const rx = new RegExp(`\\b(next\\s+|this\\s+|coming\\s+|agle\\s+|is\\s+)?(?:${names.join('|')})\\b`);
    const hit = rx.exec(t);
    if (hit && (!first || hit.index < first.index)) first = { index: hit.index, dow, prefix: (hit[1] || '').trim() };
  });
  if (first) {
    let diff = (first.dow - now.day() + 7) % 7;
    const nextWeek = /\b(next week|agle hafte|agle week)\b/.test(t);
    if (nextWeek) {
      // A day in the calendar week (Mon–Sun) after this one.
      const mondayNext = now.startOf('day').add(((1 - now.day() + 7) % 7) || 7, 'day');
      const offset = (first.dow + 6) % 7; // Monday = 0 … Sunday = 6
      return mondayNext.add(offset, 'day').format('YYYY-MM-DD');
    }
    if (diff === 0 && (first.prefix === 'next' || first.prefix === 'agle')) diff = 7;
    return now.add(diff, 'day').format('YYYY-MM-DD');
  }

  // "this weekend" → the coming Saturday (today if it is already the weekend).
  if (/\b(this weekend|weekend)\b/.test(t)) {
    const diff = now.day() === 0 || now.day() === 6 ? 0 : 6 - now.day();
    return now.add(diff, 'day').format('YYYY-MM-DD');
  }

  // "on the 6th" — this month, or next month if it has passed.
  m = t.match(/\bon\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    let d = makeDate(now.year(), now.month() + 1, m[1]);
    if (d && d.isBefore(now.startOf('day'))) {
      const next = now.add(1, 'month');
      d = makeDate(next.year(), next.month() + 1, m[1]);
    }
    if (d) return d.format('YYYY-MM-DD');
  }
  return null;
}

// ------------------------------------------------------------------- times

/** Clinic-friendly 24h hour. With no am/pm, 1–7 means afternoon/evening, 8–11 morning. */
function toHour(h, ampm) {
  let hour = Number(h);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 7) hour += 12;
  return hour;
}

// A number followed by a month or a date separator is a date, not a time.
const NOT_DATE = `(?!\\s*(?:st|nd|rd|th)\\b)(?!\\s*(?:${MONTH_RX.slice(1)})(?![/.-]\\d)`;
const TIME = `(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?${NOT_DATE}`;
// Start of a range ("10-12 am"): the dash is the range separator, so no date guard here.
const RANGE_START = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
const ampmOf = (s) => (s ? s.replace(/\./g, '') : undefined);

const PERIODS = [
  [/\b(early morning|subah subah)\b/, { afterHour: 6, beforeHour: 9 }],
  [/\b(morning|subah|savere)\b/, { afterHour: 8, beforeHour: 12 }],
  [/\b(noon|lunch time|lunchtime|dopahar|dophar)\b/, { afterHour: 12, beforeHour: 15 }],
  [/\b(after lunch|afternoon)\b/, { afterHour: 12, beforeHour: 17 }],
  [/\b(evening|shaam|sham|shām)\b/, { afterHour: 17, beforeHour: 21 }],
  [/\b(night|raat|late evening)\b/, { afterHour: 19 }],
  [/\b(after (office|work)|office ke baad)\b/, { afterHour: 18 }],
];

export function parseTimeWindow(text) {
  const t = normalise(text);
  const out = {};

  // Ranges: "between 10 and 12", "10-12 pm", "11 to 1", "4 se 6 baje"
  const range = t.match(new RegExp(`\\b(?:between\\s+|from\\s+)?${RANGE_START}\\s*(?:-|to|and|se)\\s*${TIME}`));
  if (range && (range[3] || range[6] || /\b(between|from|baje)\b/.test(t))) {
    const endAmpm = ampmOf(range[6]);
    const startAmpm = ampmOf(range[3]) || (endAmpm === 'pm' && Number(range[1]) < Number(range[4]) ? 'pm' : undefined);
    const a = toHour(range[1], startAmpm);
    // "10-12 am" means until noon, not midnight.
    let b = endAmpm === 'am' && Number(range[4]) === 12 && Number(range[1]) < 12 ? 12 : toHour(range[4], endAmpm);
    if (a != null && b != null) {
      if (range[5] && Number(range[5]) > 0) b += 1; // "till 5:30" still includes the 5 o'clock hour
      if (b > a) return { afterHour: a, beforeHour: b };
    }
  }

  const after = t.match(new RegExp(`\\b(?:after|from|post|past)\\s+${TIME}`))
    || t.match(new RegExp(`\\b${TIME}\\s*(?:baje\\s+)?(?:ke\\s+)?baad\\b`));
  const before = t.match(new RegExp(`\\b(?:before|by|until|till|upto|up to)\\s+${TIME}`))
    || t.match(new RegExp(`\\b${TIME}\\s*(?:baje\\s+)?(?:se\\s+)?pehle\\b`));
  const at = t.match(new RegExp(`\\b(?:at|around|about|near|sharp)\\s+${TIME}`))
    || t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|baje)\b/);

  if (after) {
    const h = toHour(after[1], ampmOf(after[3]));
    if (h != null) out.afterHour = h;
  }
  if (before) {
    let h = toHour(before[1], ampmOf(before[3]));
    if (h != null && before[2] && Number(before[2]) > 0) h += 1;
    if (h != null) out.beforeHour = h;
  }
  if (at && !after && !before) {
    const ampm = at[3] === 'baje' ? undefined : ampmOf(at[3]);
    const h = toHour(at[1], ampm);
    if (h != null) { out.afterHour = h; out.beforeHour = Math.min(h + 1, 24); }
  }

  // Part of day, used alone or to bound an open-ended "after 5" / "before 11".
  if (out.afterHour == null || out.beforeHour == null) {
    const period = PERIODS.find(([rx]) => rx.test(t))?.[1];
    if (period) {
      if (out.afterHour == null && out.beforeHour == null) Object.assign(out, period);
      else if (out.afterHour == null && period.afterHour != null && period.afterHour < out.beforeHour) out.afterHour = period.afterHour;
      else if (out.beforeHour == null && period.beforeHour != null && period.beforeHour > out.afterHour) out.beforeHour = period.beforeHour;
    }
  }

  // An impossible window ("after 6 before 4") keeps only the start.
  if (out.afterHour != null && out.beforeHour != null && out.beforeHour <= out.afterHour) delete out.beforeHour;
  return out;
}

// ------------------------------------------------------------------ public API

export function interpret(text, doctors) {
  return {
    doctors: matchDoctors(text, doctors),
    specialties: matchSpecialties(text),
    date: parseDate(text),
    ...parseTimeWindow(text),
  };
}