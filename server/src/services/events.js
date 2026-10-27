import { EventEmitter } from 'node:events';

/**
 * Domain event bus. This is the "every module connects to every module" spine:
 * appointment.confirmed fans out to calendar, comms, reminder jobs and analytics
 * without the appointment controller knowing any of them exist.
 */
export const events = new EventEmitter();
events.setMaxListeners(50);

export const EVENTS = {
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_CONFIRMED: 'appointment.confirmed',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
  APPOINTMENT_COMPLETED: 'appointment.completed',
  PATIENT_CHECKED_IN: 'patient.checked_in',
  QUEUE_UPDATED: 'queue.updated',
  QUEUE_CALLED: 'queue.called',
  CONSULTATION_COMPLETED: 'consultation.completed',
  PRESCRIPTION_ISSUED: 'prescription.issued',
  LAB_ORDERED: 'lab.ordered',
  LAB_RESULT_SUBMITTED: 'lab.result_submitted',
  LAB_REPORT_READY: 'lab.report_ready',
  INVOICE_CREATED: 'invoice.created',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  FOLLOWUP_DUE: 'followup.due',
  RECALL_DUE: 'recall.due',
  AI_ESCALATED: 'ai.escalated',
  DOCTOR_SCHEDULE_UPDATED: 'doctor.schedule_updated',
};

export const emit = (event, payload) => events.emit(event, payload);
