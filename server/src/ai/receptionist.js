import dayjs from 'dayjs';
import { env } from '../config/env.js';
import { toolDefinitions, runTool, toolHandlers } from './tools.js';
import { interpret } from './intent.js';
import { AIConversation, Doctor, FollowUp } from '../models/index.js';
import { checkQuota, recordUsage } from '../middleware/planGate.js';
import { TZ } from '../utils/slots.js';

const SYSTEM_PROMPT = `You are the receptionist for {{CLINIC_NAME}}, replying on {{CHANNEL}}.
Today is {{TODAY}} (clinic time zone Asia/Kolkata).

What you do: answer questions about timings, location, fees and services; find open
slots; book, check and cancel appointments. Use the tools for anything factual —
never guess a doctor's name, a fee or a free slot, and only offer slots that
check_availability returned. Resolve words like "Friday" to a YYYY-MM-DD date.

What you never do:
- Give medical advice, interpret symptoms, suggest medicines, or estimate how
  serious something is. If a patient describes symptoms, book them with the right
  doctor or offer to have staff call back.
- Handle emergencies. If anything sounds urgent — chest pain, breathing trouble,
  heavy bleeding, a fall, an unresponsive person — tell them to call 108 or go to
  the nearest emergency room.

Before booking, ask for anything missing (full name for a new patient), then read
back the doctor, date and time and wait for an explicit yes.
Style: short messages, plain language, no more than 3 sentences unless listing slots.`;

const EMERGENCY_HINTS = [
  'chest pain', 'can\'t breathe', 'cant breathe', 'breathless', 'not breathing', 'unconscious', 'unresponsive',
  'bleeding heavily', 'heavy bleeding', 'suicide', 'kill myself', 'stroke', 'seizure', 'fainted', 'severe pain',
  'heart attack', 'overdose', 'poison',
];
export const EMERGENCY_REPLY = 'This sounds urgent. Please call 108 or go to the nearest emergency room now. I am alerting our staff.';

export function looksUrgent(text = '') {
  const t = text.toLowerCase();
  return EMERGENCY_HINTS.some((h) => t.includes(h));
}

const label = (d) => dayjs(d).tz(TZ).format('ddd DD MMM, h:mm A');
const YES = /^(yes|y|confirm|ok|okay|haan|ha)\b/;

// ------------------------------------------------------------ WhatsApp menu

const MENU_OPTIONS = ['Book Appointment', 'Reschedule', 'Cancel Appointment', 'Check Doctor Availability', 'Clinic Location', 'Consultation Fees', 'Emergency Contact'];
const menuText = (clinicName) => `Namaste! Welcome to ${clinicName}. How can I help? Reply with a number:\n${MENU_OPTIONS.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nOr just type, e.g. "I need a dermatologist this Friday after 5 PM".`;
const isGreeting = (t) => /^(hi+|hello|hey|namaste|namaskar|menu|start|help|hlo)\b[\s!.]*$/.test(t);

async function clinicInfoReply(kind, ctx) {
  const info = await runTool('get_clinic_info', {}, ctx);
  const addr = [info.address?.line1, info.address?.city, info.address?.pincode].filter(Boolean).join(', ');
  switch (kind) {
    case 'location':
      return `${info.name}\n${addr || 'Address not listed yet.'}${info.mapUrl ? `\nMap: ${info.mapUrl}` : ''}${info.timings ? `\nOpen ${info.timings.openTime}–${info.timings.closeTime}` : ''}`;
    case 'fees': {
      const docs = (info.consultationFees || []).map((d) => `• ${d.doctor}${d.specialization ? ` (${d.specialization})` : ''}: ₹${d.fee ?? 0}`);
      const svcs = (info.services || []).slice(0, 8).map((x) => `• ${x.name}: ₹${x.fee ?? 0}`);
      return [docs.length && `Consultation fees:\n${docs.join('\n')}`, svcs.length && `Services:\n${svcs.join('\n')}`].filter(Boolean).join('\n\n') || 'Fees are not listed yet — please call the clinic.';
    }
    case 'emergency':
      return `For a medical emergency call 108 or go to the nearest emergency room.\nClinic emergency contact: ${info.emergencyContact || 'not listed'}`;
    case 'insurance': return `Insurance: ${info.insurance}`;
    case 'parking': return `Parking: ${info.parking}`;
    case 'timings': return info.timings ? `We're open ${info.timings.openTime}–${info.timings.closeTime}.` : 'Please call the clinic for timings.';
    default: return null;
  }
}

const FAQ = [
  ['location', /\b(location|address|where|directions?|map)\b/],
  ['fees', /\b(fees?|charges?|cost|price|kitna)\b/],
  ['insurance', /\b(insurance|cashless|tpa|mediclaim)\b/],
  ['parking', /\bpark(ing)?\b/],
  ['emergency', /\bemergency (contact|number)\b/],
  ['timings', /\b(timings?|hours|open|close|closing)\b/],
];

// ------------------------------------------------------- AI follow-up replies

const CONCERN = /\b(worse|not (feeling )?better|no better|not well|still|pain|fever|vomit|swell|bleed|dizz|rash|problem|issue|nahi|dard)\b/;
const POSITIVE = /\b(better|fine|good|great|ok|okay|recovered|well|theek|thik|accha|achha|improv)/;

/**
 * A patient replying to a doctor's follow-up check-in. The reply is only
 * classified (better / concern) — never interpreted clinically. Concerns go
 * to staff and the patient is offered a visit.
 */
async function followUpTurn({ convo, ctx, text }) {
  if (!ctx.patientId || convo.pending) return null;
  const fu = await FollowUp.findOne({ patientId: ctx.patientId, status: 'SENT', updatedAt: { $gte: dayjs().subtract(7, 'day').toDate() } })
    .sort({ updatedAt: -1 }).setOptions({ clinicId: ctx.clinicId });
  if (!fu) return null;
  const t = text.toLowerCase();
  const concern = CONCERN.test(t);
  const positive = !concern && POSITIVE.test(t);
  if (!concern && !positive) return null;
  fu.patientResponse = text.slice(0, 1000);
  fu.aiClassification = concern ? 'CONCERN' : 'POSITIVE';
  fu.status = concern ? 'ESCALATED' : 'RESPONDED';
  await fu.save();
  if (positive) return { reply: "Glad to hear you're feeling better! Keep following your doctor's advice. Reply \"menu\" any time if you need us." };
  convo.pending = { menu: true };
  return {
    reply: "Sorry you're not feeling better. I've alerted the clinic team and someone will call you. Would you like a follow-up visit? Reply 1 to book.",
    escalate: true, reason: 'FOLLOWUP_CONCERN',
  };
}

/**
 * Deterministic menu + FAQ layer that runs before either assistant. Returns
 * a turn result, `{ rewrite }` to hand a menu choice to the LLM as words, or null.
 */
async function menuTurn({ convo, ctx, text, clinicName, llm }) {
  const t = text.trim().toLowerCase();
  const pending = convo.pending || {};

  if (isGreeting(t)) { convo.pending = { menu: true }; return { reply: menuText(clinicName) }; }

  if (pending.manage && /^[1-6]$/.test(t)) {
    const appt = pending.manage.appts[Number(t) - 1];
    if (appt) {
      if (pending.manage.action === 'cancel') {
        convo.pending = { confirmCancel: appt };
        return { reply: `Cancel your appointment with ${appt.doctor} on ${appt.when}? Reply YES to confirm.` };
      }
      convo.pending = { rescheduleFrom: appt };
      return { reply: 'When would you like to come instead? For example "tomorrow evening" or "Monday after 11".' };
    }
  }
  if (pending.confirmCancel && YES.test(t)) {
    const r = await runTool('cancel_appointment', { appointmentId: pending.confirmCancel.appointmentId, reason: 'Cancelled on WhatsApp' }, ctx);
    convo.pending = null;
    return { reply: r.error ? (r.message || 'I could not cancel that. A staff member will help you.') : 'Your appointment is cancelled. Reply 1 any time to book again.' };
  }

  if (pending.menu && /^[1-7]$/.test(t)) {
    const choice = Number(t);
    convo.pending = null;
    if (choice === 5) return { reply: await clinicInfoReply('location', ctx) };
    if (choice === 6) return { reply: await clinicInfoReply('fees', ctx) };
    if (choice === 7) return { reply: await clinicInfoReply('emergency', ctx) };
    if (llm) return { rewrite: ['I want to book an appointment', 'I want to reschedule my appointment', 'I want to cancel my appointment', 'Which doctors are available and when?'][choice - 1] };
    if (choice === 1) return { reply: 'Sure! Which doctor or specialty, and when? e.g. "dentist tomorrow after 5 PM".' };
    if (choice === 4) {
      const docs = await runTool('list_doctors', {}, ctx);
      if (!docs.length) return { reply: 'No doctors are taking bookings right now. Please call the clinic.' };
      return { reply: `Our doctors:\n${docs.map((d) => `• ${d.name}${d.specialization ? ` — ${d.specialization}` : ''}`).join('\n')}\n\nTell me who and which day, and I'll show open slots.` };
    }
    const mine = await runTool('get_my_appointments', {}, ctx);
    if (!mine.appointments?.length) return { reply: 'You have no upcoming appointments with us. Reply 1 to book one.' };
    const appts = mine.appointments.slice(0, 6);
    convo.pending = { manage: { action: choice === 3 ? 'cancel' : 'reschedule', appts } };
    return { reply: `Which appointment?\n${appts.map((a, i) => `${i + 1}. ${a.doctor} — ${a.when} (${a.bookingRef})`).join('\n')}` };
  }

  // Quick facts, asked any time outside a numbered flow.
  if (!pending.offered && !pending.confirm) {
    const hit = FAQ.find(([, rx]) => rx.test(t));
    if (hit && !/\b(book|appointment|slot)\b/.test(t)) return { reply: await clinicInfoReply(hit[0], ctx) };
  }
  return null;
}

/**
 * Rule-based assistant used when no LLM key is configured. It understands
 * specialty + day + time window, offers only slots the availability service
 * returns, and books only after an explicit "yes".
 */
async function fallbackTurn({ convo, ctx, text }) {
  const t = text.trim().toLowerCase();
  const pending = convo.pending || {};

  if (pending.confirm && YES.test(t)) {
    if (pending.rescheduleFrom) {
      const r = await runTool('reschedule_appointment', { appointmentId: pending.rescheduleFrom.appointmentId, newStartAt: pending.confirm.startAt }, ctx);
      convo.pending = null;
      return { reply: r.error ? 'That slot is no longer available. Tell me another time.' : `Rescheduled to ${r.confirmedFor} with ${pending.confirm.doctorName}. Reference ${r.bookingRef}.` };
    }
    if (!ctx.patientId) {
      convo.pending = { ...pending, awaitingName: true };
      return { reply: 'Almost done — please reply with the patient\'s full name.' };
    }
    const result = await runTool('book_appointment', { doctorId: pending.confirm.doctorId, startAt: pending.confirm.startAt }, ctx);
    convo.pending = null;
    if (result.error) return { reply: `${result.message || 'That slot is no longer available.'} Tell me another day or time and I'll check again.` };
    return { reply: `Booked: ${pending.confirm.doctorName} on ${result.confirmedFor}. Your reference is ${result.bookingRef}. A confirmation is on its way.`, booked: result };
  }
  if (pending.awaitingName && t.length >= 2 && !/\d/.test(t)) {
    const reg = await runTool('register_patient', { name: text.trim() }, ctx);
    if (reg.error) return { reply: reg.message };
    convo.pending = { ...pending, awaitingName: false };
    return fallbackTurn({ convo, ctx, text: 'yes' });
  }
  if (pending.offered?.length && /^[1-6]$/.test(t)) {
    const pick = pending.offered[Number(t) - 1];
    if (pick) {
      convo.pending = { confirm: pick, rescheduleFrom: pending.rescheduleFrom };
      return { reply: `${pick.doctorName}, ${label(pick.startAt)}. Reply YES to confirm.` };
    }
  }
  if (/\b(no|cancel that|never ?mind)\b/.test(t) && (pending.confirm || pending.offered)) {
    convo.pending = null;
    return { reply: 'No problem. Tell me another day or time whenever you\'re ready.' };
  }

  const doctors = await Doctor.find({ isActive: true }).select('name specialization').setOptions({ clinicId: ctx.clinicId }).lean();
  const intent = interpret(text, doctors);
  const wantsBooking = /\b(book|appointment|slot|available|see|visit|consult|need)\b/.test(t) || intent.doctors.length || intent.date || pending.rescheduleFrom;
  if (!wantsBooking) {
    return { reply: 'I can book, reschedule or cancel appointments. Reply "menu" for options, or type e.g. "I need a dermatologist this Friday after 5 PM".' };
  }
  const original = pending.rescheduleFrom && doctors.filter((d) => d.name === pending.rescheduleFrom.doctor);
  const candidates = intent.doctors.length ? intent.doctors : (original?.length ? original : doctors);
  if (!candidates.length) return { reply: 'No doctors are taking online bookings right now. Please call the clinic.' };
  if (!intent.doctors.length && doctors.length > 1 && !original?.length) {
    const specs = [...new Set(doctors.map((d) => d.specialization).filter(Boolean))];
    return { reply: `Which doctor or specialty would you like?${specs.length ? ` We have: ${specs.join(', ')}.` : ''}` };
  }

  const offered = [];
  for (const d of candidates.slice(0, 3)) {
    const r = await runTool('check_availability', { doctorId: String(d._id), date: intent.date, afterHour: intent.afterHour, beforeHour: intent.beforeHour }, ctx);
    for (const s of r.slots || []) {
      if (offered.length < 6) offered.push({ doctorId: String(d._id), doctorName: d.name, startAt: s.startAt, label: s.label });
    }
  }
  if (!offered.length) {
    const when = intent.date ? dayjs.tz(intent.date, TZ).format('dddd D MMM') : 'the next two weeks';
    convo.pending = null;
    return { reply: `I couldn't find an open slot for ${when}${intent.afterHour != null ? ' at that time' : ''}. Would another day work?` };
  }
  convo.pending = { offered, rescheduleFrom: pending.rescheduleFrom };
  const list = offered.map((o, i) => `${i + 1}. ${o.doctorName} — ${o.label}`).join('\n');
  return { reply: `Here are the open slots:\n${list}\nReply with a number to choose.`, suggestions: offered };
}

/**
 * One turn of the receptionist. Returns { reply, escalate, reason, suggestions? }.
 * ctx carries the trusted session: clinic, patient (if known) and phone.
 */
export async function handleMessage({ clinicId, clinicName, conversationId, patientId, phone, text, channel = 'WHATSAPP' }) {
  const convo = await AIConversation.findOne({ _id: conversationId }).setOptions({ clinicId });
  convo.messages.push({ role: 'user', content: String(text).slice(0, 2000) });
  convo.lastInboundAt = new Date();

  if (looksUrgent(text)) {
    convo.messages.push({ role: 'assistant', content: EMERGENCY_REPLY });
    convo.pending = null;
    await convo.save();
    return { reply: EMERGENCY_REPLY, escalate: true, reason: 'URGENT', emergency: true };
  }

  const ctx = { clinicId, patientId: patientId || convo.patientId, phone, channel };

  const menu = (await followUpTurn({ convo, ctx, text: String(text) }))
    || (await menuTurn({ convo, ctx, text: String(text), clinicName, llm: Boolean(env.openaiKey) }));
  if (menu?.reply) {
    convo.messages.push({ role: 'assistant', content: menu.reply });
    convo.markModified('pending');
    await convo.save();
    return { escalate: false, ...menu, mode: 'menu' };
  }
  if (menu?.rewrite) text = menu.rewrite;

  if (!env.openaiKey) {
    const out = await fallbackTurn({ convo, ctx, text: String(text) });
    if (ctx.patientId && !convo.patientId) convo.patientId = ctx.patientId;
    convo.messages.push({ role: 'assistant', content: out.reply });
    convo.markModified('pending');
    await convo.save();
    return { escalate: false, ...out, mode: 'rules' };
  }

  const quota = await checkQuota(clinicId, 'ai', 2000);
  if (!quota.allowed) {
    await convo.save();
    return { reply: 'Our assistant is unavailable right now. A staff member will reply shortly.', escalate: true, reason: 'QUOTA' };
  }

  const prompt = SYSTEM_PROMPT
    .replace('{{CLINIC_NAME}}', clinicName)
    .replace('{{CHANNEL}}', channel === 'WEB' ? 'the patient portal' : 'WhatsApp')
    .replace('{{TODAY}}', dayjs().tz(TZ).format('dddd, YYYY-MM-DD'));
  const messages = [
    { role: 'system', content: prompt },
    ...convo.messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-12).map((m) => ({ role: m.role, content: m.content })),
  ];

  let reply = '';
  let turnTokens = 0;
  let booked = null;
  // Bounded tool loop: the model gets at most 4 round trips before we answer.
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, tools: toolDefinitions, tool_choice: 'auto' }),
    });
    if (!res.ok) throw new Error(`AI call failed (${res.status})`);
    const data = await res.json();
    turnTokens += data.usage?.total_tokens || 0;

    const msg = data.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) { reply = msg.content || ''; break; }

    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* ignore */ }
      const result = await runTool(call.function.name, args, ctx);
      if (call.function.name === 'book_appointment' && !result.error) booked = result;
      convo.messages.push({ role: 'tool', content: JSON.stringify(result).slice(0, 2000), toolName: call.function.name, toolArgs: args });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  if (!reply) reply = 'Sorry, I could not finish that. A staff member will follow up shortly.';

  if (ctx.patientId && !convo.patientId) convo.patientId = ctx.patientId;
  convo.messages.push({ role: 'assistant', content: reply });
  convo.tokensUsed += turnTokens;
  await convo.save();
  await recordUsage(clinicId, 'ai', turnTokens);
  return { reply, escalate: false, booked, mode: 'llm' };
}

export { toolHandlers };
