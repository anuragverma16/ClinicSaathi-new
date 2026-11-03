/**
 * ============================================================================
 * CLINIC AI ASSISTANT - TOOL DEFINITIONS AND HANDLERS
 * ============================================================================
 * This module defines the complete capability set (surface area) exposed to the 
 * LLM agent for interacting with the clinic management system.
 * 
 * ARCHITECTURE & SECURITY NOTES:
 * 1. Database isolation: The model never touches the database directly. All operations
 *    are mediated through strongly typed tool handlers.
 * 2. Tenant Scoping: Every handler receives a trusted `ctx` object containing 
 *    `clinicId`, `patientId`, and `phone` originating from the verified authenticated session,
 *    preventing prompt injection attacks from spoofing or altering tenant boundaries.
 * 3. Error Handling: Internal errors are caught safely and mapped to user-friendly messages
 *    without exposing database internals or stack traces.
 * ============================================================================
 */

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
  /**
   * --------------------------------------------------------------------------
   * TOOL: list_doctors
   * --------------------------------------------------------------------------
   * Allows the AI assistant to query active doctors working at the current clinic.
   * Supports optional filtering by medical specialization.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'list_doctors',
      description: 'List doctors at the clinic, optionally filtered by specialization.',
      parameters: { 
        type: 'object', 
        properties: { 
          specialization: { 
            type: 'string', 
            description: 'Medical specialization to filter doctors by (e.g., Cardiology, Dermatology)' 
          } 
        } 
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: check_availability
   * --------------------------------------------------------------------------
   * Queries open appointment slots for a specific doctor starting from a given date.
   * Enforces clinic timezone and operational hours via the availability service.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Find open appointment slots for a doctor on or after a date. Only ever offer slots this returns.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { 
            type: 'string', 
            description: 'Unique identifier of the doctor' 
          },
          date: { 
            type: 'string', 
            description: 'Clinic-local date in YYYY-MM-DD format' 
          },
          afterHour: { 
            type: 'number', 
            description: '24h clock hour lower bound, e.g. 17 for "after 5 PM"' 
          },
          beforeHour: { 
            type: 'number', 
            description: '24h clock hour upper bound' 
          },
        },
        required: ['doctorId'],
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: register_patient
   * --------------------------------------------------------------------------
   * Registers a messaging user as a patient in the system. Requires their full name.
   * The phone number is securely retrieved from the verified session context.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'register_patient',
      description: 'Register the person messaging as a new patient. Ask for their full name first; their phone number is already known.',
      parameters: { 
        type: 'object', 
        properties: { 
          name: { 
            type: 'string', 
            description: 'Full legal name of the patient' 
          } 
        }, 
        required: ['name'] 
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: book_appointment
   * --------------------------------------------------------------------------
   * Books a specific time slot for the registered patient with a chosen doctor.
   * Requires explicit patient confirmation before execution.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book a specific slot. Only call after the patient has explicitly confirmed the exact doctor and time.',
      parameters: {
        type: 'object',
        properties: {
          doctorId: { 
            type: 'string', 
            description: 'Unique identifier of the doctor' 
          },
          serviceId: { 
            type: 'string', 
            description: 'Optional service identifier being booked' 
          },
          startAt: { 
            type: 'string', 
            description: 'ISO datetime of the chosen slot, exactly as returned by check_availability' 
          },
          reason: { 
            type: 'string', 
            description: 'Reason for visit or symptoms described by the patient' 
          },
        },
        required: ['doctorId', 'startAt'],
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: get_my_appointments
   * --------------------------------------------------------------------------
   * Retrieves active upcoming appointments associated with the currently authenticated patient.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'get_my_appointments',
      description: "Look up the patient's upcoming appointments.",
      parameters: { 
        type: 'object', 
        properties: {} 
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: cancel_appointment
   * --------------------------------------------------------------------------
   * Cancels an existing appointment belonging to the patient after explicit confirmation.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancel one of the patient\'s own appointments after they confirm.',
      parameters: {
        type: 'object',
        properties: { 
          appointmentId: { 
            type: 'string', 
            description: 'Unique identifier of the appointment to cancel' 
          }, 
          reason: { 
            type: 'string', 
            description: 'Reason for cancellation provided by the patient' 
          } 
        },
        required: ['appointmentId'],
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: reschedule_appointment
   * --------------------------------------------------------------------------
   * Reschedules an existing appointment to a new available slot.
   * Requires explicit patient confirmation.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: "Move one of the patient's own appointments to a new slot returned by check_availability, after they confirm.",
      parameters: {
        type: 'object',
        properties: { 
          appointmentId: { 
            type: 'string', 
            description: 'Unique identifier of the appointment to move' 
          }, 
          newStartAt: { 
            type: 'string', 
            description: 'ISO datetime of the new slot' 
          } 
        },
        required: ['appointmentId', 'newStartAt'],
      },
    },
  },

  /**
   * --------------------------------------------------------------------------
   * TOOL: get_clinic_info
   * --------------------------------------------------------------------------
   * Fetches general clinic information including operating hours, address, maps link,
   * emergency contact details, accepted insurance, parking, and consultation fee schedules.
   * --------------------------------------------------------------------------
   */
  {
    type: 'function',
    function: {
      name: 'get_clinic_info',
      description: 'Clinic timings, address, map link, phone, emergency contact, insurance accepted, parking and service/consultation fees.',
      parameters: { 
        type: 'object', 
        properties: {} 
      },
    },
  },
];

/**
 * Helper utility function to format raw date/time strings into human-readable 
 * clinic-local strings using dayjs with the configured timezone (TZ).
 * 
 * @param {string|Date} d - The date/time input to format
 * @returns {string} Formatted date string (e.g., "Wed 04 Nov, 3:30 PM")
 */
const label = (d) => dayjs(d).tz(TZ).format('ddd DD MMM, h:mm A');

/**
 * ============================================================================
 * TOOL HANDLERS IMPLEMENTATION MAP
 * ============================================================================
 * Maps each tool name declared above to its corresponding asynchronous execution function.
 * Each handler enforces multi-tenant scoping and executes underlying domain services.
 * ============================================================================
 */
export const toolHandlers = {
  
  /**
   * Handler: list_doctors
   * Filters and retrieves active doctors for the active clinic tenant.
   */
  async list_doctors({ specialization }, ctx) {
    // Build query filter ensuring only active doctors are retrieved
    const filter = { isActive: true };
    
    // If specialization search term is provided, sanitize and apply case-insensitive regex search
    if (specialization) {
      filter.specialization = new RegExp(String(specialization).replace(/[.*+?^${}()|[\]\\]/g, ''), 'i');
    }
    
    // Execute database query with tenant scoping options
    const doctors = await Doctor.find(filter)
      .select('name specialization qualification consultationFee')
      .setOptions({ clinicId: ctx.clinicId });
      
    // Map database documents to clean JSON response objects for the AI model
    return doctors.map((d) => ({
      doctorId: d._id.toString(), 
      name: d.name, 
      specialization: d.specialization, 
      fee: d.consultationFee,
    }));
  },

  /**
   * Handler: check_availability
   * Queries available appointment slots for a specified doctor within the clinic context.
   */
  async check_availability({ doctorId, date, afterHour, beforeHour }, ctx) {
    // Call availability service with date range and hour constraints
    const result = await findNextAvailable({
      clinicId: ctx.clinicId, 
      doctorId, 
      fromDate: date || dayjs().tz(TZ).format('YYYY-MM-DD'),
      days: date ? 1 : 14, 
      afterHour, 
      beforeHour,
    });
    
    // Return formatted slots, capped at a maximum of 6 slots to manage token context efficiently
    return {
      date: result.date,
      slots: result.slots.slice(0, 6).map((s) => ({ startAt: s.startAt, label: label(s.startAt) })),
      ...(result.slots.length ? {} : { note: 'No open slots matched. Offer another day or time — never invent one.' }),
    };
  },

  /**
   * Handler: register_patient
   * Registers a new patient record linked to the tenant clinic and verified phone number.
   */
  async register_patient({ name }, ctx) {
    // Check if patient is already registered in the current session context
    if (ctx.patientId) {
      return { patientId: String(ctx.patientId), alreadyRegistered: true };
    }
    
    // Ensure verified phone number exists in session context
    if (!ctx.phone) {
      return { error: 'NO_PHONE', message: 'Registration needs the patient to sign in to the portal.' };
    }
    
    // Sanitize and validate name length
    const clean = String(name || '').trim().slice(0, 80);
    if (clean.length < 2) {
      return { error: 'NAME_REQUIRED', message: 'Ask for the patient\'s full name.' };
    }
    
    // Check if patient already exists in database for this clinic and phone
    let patient = await Patient.findOne({ 
      phone: ctx.phone, 
      guardianPatientId: { $exists: false } 
    }).setOptions({ clinicId: ctx.clinicId });
    
    // If patient does not exist, create a new patient record with mandatory data processing consent
    if (!patient) {
      patient = await Patient.create({
        clinicId: ctx.clinicId, 
        name: clean, 
        phone: ctx.phone,
        consent: { 
          dataProcessing: { granted: true, grantedAt: new Date(), version: 'whatsapp-v1' }, 
          marketing: { granted: false } 
        },
      });
    }
    
    // Bind newly created or found patient ID to the session context
    ctx.patientId = patient._id;
    return { registered: true };
  },

  /**
   * Handler: book_appointment
   * Creates a confirmed appointment record for the authenticated patient.
   */
  async book_appointment({ doctorId, serviceId, startAt, reason }, ctx) {
    // Verify patient registration before booking
    if (!ctx.patientId) {
      return { error: 'NEEDS_REGISTRATION', message: 'Ask for the patient\'s full name and call register_patient first.' };
    }
    
    // Invoke appointment booking service with tenant scoping and channel detection
    const appt = await bookAppointment({
      clinicId: ctx.clinicId, 
      patientId: ctx.patientId,
      doctorId, 
      serviceId, 
      startAt, 
      source: ctx.channel === 'WEB' ? 'AI_ASSISTANT' : 'WHATSAPP', 
      reason,
      enforceAdvanceWindow: true,
    });
    
    // Return booking confirmation details
    return { 
      appointmentId: appt._id.toString(), 
      bookingRef: appt.bookingRef, 
      confirmedFor: label(appt.startAt), 
      fee: appt.fee 
    };
  },

  /**
   * Handler: get_my_appointments
   * Retrieves upcoming requested or confirmed appointments for the authenticated patient.
   */
  async get_my_appointments(_args, ctx) {
    // Return empty list if patient is not registered in session
    if (!ctx.patientId) {
      return { appointments: [] };
    }
    
    // Query upcoming active appointments
    const appts = await Appointment.find({
      patientId: ctx.patientId,
      startAt: { $gte: new Date() },
      status: { $in: ['REQUESTED', 'CONFIRMED'] },
    }).populate(tenantPopulate(ctx.clinicId, 'doctorId', 'name'))
      .setOptions({ clinicId: ctx.clinicId });
      
    // Format appointment details for the AI model
    return {
      appointments: appts.map((a) => ({
        appointmentId: a._id.toString(), 
        bookingRef: a.bookingRef, 
        doctor: a.doctorId?.name, 
        when: label(a.startAt),
      })),
    };
  },

  /**
   * Handler: cancel_appointment
   * Cancels a patient's appointment with ownership validation handled by the service layer.
   */
  async cancel_appointment({ appointmentId, reason }, ctx) {
    // Verify patient context exists
    if (!ctx.patientId) {
      return { error: 'NOT_FOUND', message: 'No such appointment for this patient.' };
    }
    
    // Ownership check lives in the service call: the patientId comes from ctx.
    await cancelAppointment({ 
      clinicId: ctx.clinicId, 
      appointmentId, 
      reason, 
      cancelledBy: 'PATIENT', 
      patientId: ctx.patientId 
    });
    
    return { cancelled: true };
  },

  /**
   * Handler: get_clinic_info
   * Aggregates clinic metadata, active services, and doctor consultation fees in parallel.
   */
  async get_clinic_info(_args, ctx) {
    // Fetch clinic details, active services, and active doctors concurrently for performance
    const [clinic, services] = await Promise.all([
      Clinic.findById(ctx.clinicId).select('name address phone timings patientInfo').lean(),
      Service.find({ isActive: true }).select('name fee durationMins').setOptions({ clinicId: ctx.clinicId }),
    ]);
    
    const doctors = await Doctor.find({ isActive: true })
      .select('name specialization consultationFee')
      .setOptions({ clinicId: ctx.clinicId })
      .lean();
      
    const info = clinic?.patientInfo || {};
    
    // Construct comprehensive clinic info payload
    return {
      name: clinic?.name, 
      address: clinic?.address, 
      phone: clinic?.phone, 
      timings: clinic?.timings,
      mapUrl: info.mapUrl || null,
      emergencyContact: info.emergencyContact || clinic?.phone || null,
      insurance: info.insurance || 'Not specified — ask the clinic',
      parking: info.parking || 'Not specified — ask the clinic',
      services: services.map((s) => ({ serviceId: s._id.toString(), name: s.name, fee: s.fee })),
      consultationFees: doctors.map((d) => ({ doctor: d.name, specialization: d.specialization, fee: d.consultationFee })),
    };
  },

  /**
   * Handler: reschedule_appointment
   * Reschedules an appointment to a new validated slot time.
   */
  async reschedule_appointment({ appointmentId, newStartAt }, ctx) {
    // Verify patient context exists
    if (!ctx.patientId) {
      return { error: 'NOT_FOUND', message: 'No such appointment for this patient.' };
    }
    
    // Invoke reschedule service
    const appt = await rescheduleAppointment({ 
      clinicId: ctx.clinicId, 
      appointmentId, 
      newStartAt, 
      patientId: ctx.patientId 
    });
    
    return { 
      rescheduled: true, 
      bookingRef: appt.bookingRef, 
      confirmedFor: label(appt.startAt) 
    };
  },
};

/**
 * ============================================================================
 * TOOL EXECUTION ROUTER
 * ============================================================================
 * Safely dispatches tool calls requested by the LLM to the appropriate handler,
 * wrapping executions in robust try/catch error boundaries.
 * 
 * @param {string} name - Name of the tool being invoked
 * @param {Object} args - Arguments passed by the model
 * @param {Object} ctx - Trusted session context (clinicId, patientId, phone, channel)
 * @returns {Promise<Object>} Result object or safe error payload
 * ============================================================================
 */
export async function runTool(name, args, ctx) {
  // Look up handler by tool name
  const handler = toolHandlers[name];
  
  // Return unknown tool error if handler is not found
  if (!handler) {
    return { error: 'UNKNOWN_TOOL' };
  }
  
  try {
    // Execute handler with provided arguments and secure context
    return await handler(args || {}, ctx);
  } catch (err) {
    // Surface a usable message to the model without leaking database internals.
    // Preserves custom error codes and client-safe status codes (< 500).
    return { 
      error: err.code || 'TOOL_ERROR', 
      message: err.statusCode && err.statusCode < 500 ? err.message : 'That did not work.' 
    };
  }
}