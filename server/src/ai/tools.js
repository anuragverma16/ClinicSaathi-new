import dayjs from 'dayjs';
import { findNextAvailable } from '../services/availability.service.js';
import { bookAppointment, cancelAppointment, rescheduleAppointment } from '../services/appointment.service.js';
import { Doctor, Service, Clinic, Patient, Appointment } from '../models/index.js';
import { tenantPopulate } from '../models/plugins/tenantScope.js';
import { TZ } from '../utils/slots.js';

/**
 * The AI's entire surface area.
 *
 * The model never touches the database directly. It can only call these functions, each of
 * which runs the same tenant-scoped service code the REST API uses. Every
 * handler receives ctx (clinicId, patientId, phone) from the trusted session,
 * not from the model's arguments — otherwise a prompt injection could rewrite
 * which clinic or patient it operates on.
 */
export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_doctors',
      description: 'List doctors at the clinic, optionally filtered by specialization.',
      parameters: { type: 'object', properties: { specialization: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Find open appointment slots for a doctor on or after a date. Only ever offer slots this returns.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { type: 'string' },
          date: { type: 'string', description: 'Clinic-local date, YYYY-MM-DD' },
          afterHour: { type: 'number', description: '24h clock, e.g. 17 for "after 5 PM"' },
          beforeHour: { type: 'number' },
        },
        required: ['doctorId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_patient',
      description: 'Register the person messaging as a new patient. Ask for their full name first; their phone number is already known.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book a specific slot. Only call after the patient has explicitly confirmed the exact doctor and time.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { type: 'string' },
          serviceId: { type: 'string' },
          startAt: { type: 'string', description: 'ISO datetime of the chosen slot, exactly as returned by check_availability' },
          reason: { type: 'string' },
        },
        required: ['doctorId', 'startAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_appointments',
      description: "Look up the patient's upcoming appointments.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancel one of the patient\'s own appointments after they confirm.',
      parameters: {
        type: 'object',
        properties: { appointmentId: { type: 'string' }, reason: { type: 'string' } },
        required: ['appointmentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: "Move one of the patient's own appointments to a new slot returned by check_availability, after they confirm.",
      parameters: {
        type: 'object',
        properties: { appointmentId: { type: 'string' }, newStartAt: { type: 'string', description: 'ISO datetime of the new slot' } },
        required: ['appointmentId', 'newStartAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clinic_info',
      description: 'Clinic timings, address, map link, phone, emergency contact, insurance accepted, parking and service/consultation fees.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const label = (d) => dayjs(d).tz(TZ).format('ddd DD MMM, h:mm A');

export const toolHandlers = {
  async list_doctors({ specialization }, ctx) {
    const filter = { isActive: true };
    if (specialization) filter.specialization = new RegExp(String(specialization).replace(/[.*+?^${}()|[\]\\]/g, ''), 'i');
    const doctors = await Doctor.find(filter)
      .select('name specialization qualification consultationFee')
      .setOptions({ clinicId: ctx.clinicId });
    return doctors.map((d) => ({
      doctorId: d._id.toString(), name: d.name, specialization: d.specialization, fee: d.consultationFee,
    }));
  },

  async check_availability({ doctorId, date, afterHour, beforeHour }, ctx) {
    const result = await findNextAvailable({
      clinicId: ctx.clinicId, doctorId, fromDate: date || dayjs().tz(TZ).format('YYYY-MM-DD'),
      days: date ? 1 : 14, afterHour, beforeHour,
    });
    return {
      date: result.date,
      slots: result.slots.slice(0, 6).map((s) => ({ startAt: s.startAt, label: label(s.startAt) })),
      ...(result.slots.length ? {} : { note: 'No open slots matched. Offer another day or time — never invent one.' }),
    };
  },

  async register_patient({ name }, ctx) {
    if (ctx.patientId) return { patientId: String(ctx.patientId), alreadyRegistered: true };
    if (!ctx.phone) return { error: 'NO_PHONE', message: 'Registration needs the patient to sign in to the portal.' };
    const clean = String(name || '').trim().slice(0, 80);
    if (clean.length < 2) return { error: 'NAME_REQUIRED', message: 'Ask for the patient\'s full name.' };
    let patient = await Patient.findOne({ phone: ctx.phone, guardianPatientId: { $exists: false } }).setOptions({ clinicId: ctx.clinicId });
    if (!patient) {
      patient = await Patient.create({
        clinicId: ctx.clinicId, name: clean, phone: ctx.phone,
        consent: { dataProcessing: { granted: true, grantedAt: new Date(), version: 'whatsapp-v1' }, marketing: { granted: false } },
      });
    }
    ctx.patientId = patient._id;
    return { registered: true };
  },

  async book_appointment({ doctorId, serviceId, startAt, reason }, ctx) {
    if (!ctx.patientId) {
      return { error: 'NEEDS_REGISTRATION', message: 'Ask for the patient\'s full name and call register_patient first.' };
    }
    const appt = await bookAppointment({
      clinicId: ctx.clinicId, patientId: ctx.patientId,
      doctorId, serviceId, startAt, source: ctx.channel === 'WEB' ? 'AI_ASSISTANT' : 'WHATSAPP', reason,
      enforceAdvanceWindow: true,
    });
    return { appointmentId: appt._id.toString(), bookingRef: appt.bookingRef, confirmedFor: label(appt.startAt), fee: appt.fee };
  },

  async get_my_appointments(_args, ctx) {
    if (!ctx.patientId) return { appointments: [] };
    const appts = await Appointment.find({
      patientId: ctx.patientId,
      startAt: { $gte: new Date() },
      status: { $in: ['REQUESTED', 'CONFIRMED'] },
    }).populate(tenantPopulate(ctx.clinicId, 'doctorId', 'name')).setOptions({ clinicId: ctx.clinicId });
    return {
      appointments: appts.map((a) => ({
        appointmentId: a._id.toString(), bookingRef: a.bookingRef, doctor: a.doctorId?.name, when: label(a.startAt),
      })),
    };
  },

  async cancel_appointment({ appointmentId, reason }, ctx) {
    if (!ctx.patientId) return { error: 'NOT_FOUND', message: 'No such appointment for this patient.' };
    // Ownership check lives in the service call: the patientId comes from ctx.
    await cancelAppointment({ clinicId: ctx.clinicId, appointmentId, reason, cancelledBy: 'PATIENT', patientId: ctx.patientId });
    return { cancelled: true };
  },

  async get_clinic_info(_args, ctx) {
    const [clinic, services] = await Promise.all([
      Clinic.findById(ctx.clinicId).select('name address phone timings patientInfo').lean(),
      Service.find({ isActive: true }).select('name fee durationMins').setOptions({ clinicId: ctx.clinicId }),
    ]);
    const doctors = await Doctor.find({ isActive: true }).select('name specialization consultationFee').setOptions({ clinicId: ctx.clinicId }).lean();
    const info = clinic?.patientInfo || {};
    return {
      name: clinic?.name, address: clinic?.address, phone: clinic?.phone, timings: clinic?.timings,
      mapUrl: info.mapUrl || null,
      emergencyContact: info.emergencyContact || clinic?.phone || null,
      insurance: info.insurance || 'Not specified — ask the clinic',
      parking: info.parking || 'Not specified — ask the clinic',
      services: services.map((s) => ({ serviceId: s._id.toString(), name: s.name, fee: s.fee })),
      consultationFees: doctors.map((d) => ({ doctor: d.name, specialization: d.specialization, fee: d.consultationFee })),
    };
  },

  async reschedule_appointment({ appointmentId, newStartAt }, ctx) {
    if (!ctx.patientId) return { error: 'NOT_FOUND', message: 'No such appointment for this patient.' };
    const appt = await rescheduleAppointment({ clinicId: ctx.clinicId, appointmentId, newStartAt, patientId: ctx.patientId });
    return { rescheduled: true, bookingRef: appt.bookingRef, confirmedFor: label(appt.startAt) };
  },
};

export async function runTool(name, args, ctx) {
  const handler = toolHandlers[name];
  if (!handler) return { error: 'UNKNOWN_TOOL' };
  try {
    return await handler(args || {}, ctx);
  } catch (err) {
    // Surface a usable message to the model without leaking internals.
    return { error: err.code || 'TOOL_ERROR', message: err.statusCode && err.statusCode < 500 ? err.message : 'That did not work.' };
  }
}
