import dayjs from 'dayjs';
import { events, EVENTS } from './events.js';
import { scheduleAppointmentReminders, cancelAppointmentJobs } from '../jobs/scheduleAppointmentJobs.js';
import { enqueue } from '../jobs/queues.js';
import { send } from './communication.service.js';
import { notifyStaff, setNotifyIo } from './notify.service.js';
import { Patient, Service, Recall, FollowUp, Doctor, Clinic } from '../models/index.js';
import { TZ } from '../utils/slots.js';
import { env } from '../config/env.js';

const when = (d) => dayjs(d).tz(TZ).format('DD MMM, h:mm A');
const safely = (name, fn) => async (payload) => {
  try { await fn(payload); } catch (e) { console.error(`${name} listener:`, e.message); }
};

/**
 * Wires domain events to side effects. Registered once at boot.
 * This is where "appointment created" becomes comms + reminders + analytics
 * without the booking code importing any of them.
 */
export function registerListeners({ io } = {}) {
  setNotifyIo(io);
  const toClinic = (clinicId, name, data) => io?.to(`clinic:${clinicId}`).emit(name, data);

  events.on(EVENTS.APPOINTMENT_CREATED, safely('APPOINTMENT_CREATED', async ({ appointment }) => {
    const clinicId = appointment.clinicId;
    toClinic(clinicId, 'appointment:created', { id: appointment._id });
    // Conversion tracking: a booking after a recall or follow-up nudge closes it.
    await Recall.updateMany(
      { patientId: appointment.patientId, status: 'NOTIFIED' },
      { status: 'BOOKED', bookedAppointmentId: appointment._id }
    ).setOptions({ clinicId });
    await FollowUp.updateMany(
      { patientId: appointment.patientId, status: { $in: ['SENT', 'RESPONDED'] } },
      { status: 'BOOKED', bookedAppointmentId: appointment._id }
    ).setOptions({ clinicId });
  }));

  events.on(EVENTS.APPOINTMENT_CONFIRMED, safely('APPOINTMENT_CONFIRMED', async ({ appointment }) => {
    await send({
      clinicId: appointment.clinicId, patientId: appointment.patientId, channel: 'WHATSAPP',
      event: 'APPOINTMENT_CONFIRMED', templateName: 'appointment_confirmed',
      variables: { date: when(appointment.startAt), ref: appointment.bookingRef || '' },
    });
    await scheduleAppointmentReminders(appointment);
    toClinic(appointment.clinicId, 'appointment:updated', { id: appointment._id });
  }));

  events.on(EVENTS.APPOINTMENT_CANCELLED, safely('APPOINTMENT_CANCELLED', async ({ appointment }) => {
    await cancelAppointmentJobs(appointment._id);
    // System releases of unpaid holds don't message the patient a second time.
    if (appointment.cancelledBy !== 'SYSTEM') {
      await send({
        clinicId: appointment.clinicId, patientId: appointment.patientId, channel: 'WHATSAPP',
        event: 'APPOINTMENT_CANCELLED', templateName: 'appointment_cancelled',
        variables: { date: when(appointment.startAt) },
      });
    }
    toClinic(appointment.clinicId, 'appointment:cancelled', { id: appointment._id });
  }));

  events.on(EVENTS.APPOINTMENT_RESCHEDULED, safely('APPOINTMENT_RESCHEDULED', async ({ appointment, previous }) => {
    // Old reminders are removed before new ones are scheduled for the new time.
    await cancelAppointmentJobs(previous._id);
    if (appointment.status === 'CONFIRMED') await scheduleAppointmentReminders(appointment);
    await send({
      clinicId: appointment.clinicId, patientId: appointment.patientId, channel: 'WHATSAPP',
      event: 'APPOINTMENT_RESCHEDULED', templateName: 'appointment_rescheduled',
      variables: { from: when(previous.startAt), to: when(appointment.startAt) },
    });
    toClinic(appointment.clinicId, 'appointment:updated', { id: appointment._id });
  }));

  events.on(EVENTS.APPOINTMENT_COMPLETED, safely('APPOINTMENT_COMPLETED', async ({ appointment }) => {
    if (!appointment) return;
    const clinicId = appointment.clinicId;
    const patient = await Patient.findOne({ _id: appointment.patientId }).setOptions({ clinicId });
    if (patient) {
      await Patient.updateOne(
        { _id: patient._id },
        { $set: { lastVisitAt: new Date(), ...(patient.firstVisitAt ? {} : { firstVisitAt: new Date() }) }, $inc: { visitCount: 1 } }
      ).setOptions({ clinicId });
    }

    // Recall engine: a service with a recall interval opens one recall per
    // patient per service. The partial unique index stops duplicates.
    if (appointment.serviceId) {
      const service = await Service.findOne({ _id: appointment.serviceId }).setOptions({ clinicId }).lean();
      if (service?.recallIntervalDays > 0) {
        const dueDate = dayjs().add(service.recallIntervalDays, 'day').toDate();
        const recall = await Recall.create({
          clinicId, patientId: appointment.patientId, serviceId: service._id, recallType: service.name,
          dueDate, lastServiceDate: new Date(), sourceAppointmentId: appointment._id,
        }).catch((e) => (e.code === 11000 ? null : Promise.reject(e)));
        if (recall) {
          await enqueue('recall', 'due', { recallId: String(recall._id), clinicId: String(clinicId) },
            { delay: dayjs(dueDate).diff(dayjs()), jobId: `recall:${recall._id}` });
        }
      }
    }
    toClinic(clinicId, 'appointment:updated', { id: appointment._id });
  }));

  events.on(EVENTS.QUEUE_UPDATED, ({ clinicId, doctorId }) => {
    io?.to(`clinic:${clinicId}`).emit('queue:updated', { doctorId });
    io?.to(`doctor:${doctorId}`).emit('queue:updated', { doctorId });
  });

  events.on(EVENTS.QUEUE_CALLED, safely('QUEUE_CALLED', async ({ clinicId, token }) => {
    await send({
      clinicId, patientId: token.patientId?._id || token.patientId, channel: 'WHATSAPP',
      event: 'QUEUE_CALLED', templateName: 'queue_called', variables: { token: token.tokenNumber },
    });
  }));

  events.on(EVENTS.CONSULTATION_COMPLETED, safely('CONSULTATION_COMPLETED', async ({ consultation }) => {
    if (!consultation.followUpDate) return;
    const clinicId = consultation.clinicId;
    const followUp = await FollowUp.create({
      clinicId, patientId: consultation.patientId, doctorId: consultation.doctorId,
      consultationId: consultation._id, dueDate: consultation.followUpDate,
      reason: 'Doctor-requested follow-up', instructions: consultation.followUpInstructions,
    });
    const delay = dayjs(consultation.followUpDate).diff(dayjs());
    if (delay > 0) {
      await enqueue('followUp', 'checkin', { followUpId: String(followUp._id), clinicId: String(clinicId) },
        { delay, jobId: `followup:${followUp._id}` });
    }
  }));

  // Documents are announced with a pointer to the secure portal — never attached.
  const documentReady = (kind) => safely(`${kind}_READY`, async ({ clinicId, patientId }) => {
    const clinic = await Clinic.findById(clinicId).select('slug').lean();
    await send({
      clinicId, patientId, channel: 'WHATSAPP', event: 'DOCUMENT_READY', templateName: 'document_ready',
      variables: { kind, link: `${env.clientUrl}/patient/login?clinic=${clinic?.slug || ''}` },
    });
  });
  events.on(EVENTS.PRESCRIPTION_ISSUED, ({ prescription }) =>
    documentReady('prescription')({ clinicId: prescription.clinicId, patientId: prescription.patientId }));
  events.on(EVENTS.LAB_REPORT_READY, ({ order }) =>
    documentReady('lab report')({ clinicId: order.clinicId, patientId: order.patientId }));

  events.on(EVENTS.LAB_ORDERED, safely('LAB_ORDERED', async ({ order }) => {
    await notifyStaff({
      clinicId: order.clinicId, role: 'LAB_TECHNICIAN', type: 'LAB_ORDER',
      title: `New ${order.priority === 'URGENT' ? 'urgent ' : ''}lab order ${order.orderNumber}`,
      link: '/clinic/lab/dashboard',
    });
    io?.to(`clinic:${order.clinicId}`).emit('lab:updated', { id: order._id });
  }));

  events.on(EVENTS.LAB_RESULT_SUBMITTED, safely('LAB_RESULT_SUBMITTED', async ({ order }) => {
    const doctor = await Doctor.findOne({ _id: order.doctorId }).select('userId').setOptions({ clinicId: order.clinicId }).lean();
    if (doctor?.userId) {
      await notifyStaff({
        clinicId: order.clinicId, userId: doctor.userId, type: 'LAB_RESULT',
        title: `Results ready to verify: ${order.orderNumber}`, link: '/clinic/doctor/lab-orders',
      });
    }
    io?.to(`clinic:${order.clinicId}`).emit('lab:updated', { id: order._id });
  }));

  events.on(EVENTS.PAYMENT_SUCCEEDED, ({ payment, clinicId }) => {
    io?.to(`clinic:${clinicId}`).emit('payment:received', { id: payment._id, amount: payment.amount });
  });

  /**
   * A doctor set their own hours. Booking already reflects it, so the clinic is
   * told rather than asked — reception needs it most, since bookings that were
   * already taken on those dates are not moved automatically.
   */
  events.on(EVENTS.DOCTOR_SCHEDULE_UPDATED, safely('DOCTOR_SCHEDULE_UPDATED', async ({ clinicId, doctorId, doctorName, dates, weekly }) => {
    if (!weekly && !dates?.length) return;
    const span = weekly ? null : dates.length === 1
      ? dayjs.tz(dates[0], TZ).format('D MMM')
      : `${dates.length} days from ${dayjs.tz(dates[0], TZ).format('D MMM')}`;
    const title = weekly
      ? `${doctorName} updated their weekly working hours`
      : `${doctorName} updated their working hours · ${span}`;
    for (const role of ['CLINIC_OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST']) {
      await notifyStaff({ clinicId, role, type: 'DOCTOR_SCHEDULE', title, link: '/clinic/calendar' });
    }
    io?.to(`clinic:${clinicId}`).emit('doctor:schedule', { doctorId, dates });
  }));

  events.on(EVENTS.AI_ESCALATED, safely('AI_ESCALATED', async ({ clinicId, reason }) => {
    await notifyStaff({
      clinicId, role: 'RECEPTIONIST', type: 'AI_ESCALATION',
      title: reason === 'URGENT' ? 'Possible emergency reported on WhatsApp — call the patient' : 'A patient needs a staff reply on WhatsApp',
      link: '/clinic/reception/communication',
    });
  }));
}
