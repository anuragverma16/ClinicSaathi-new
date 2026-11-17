import db from '../db/index.js';
import { tenantScope } from './plugins/tenantScope.js';
import { APPOINTMENT_STATUS } from '../config/constants.js';

const appointmentSchema = new db.Schema({
  patientId: { type: db.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctorId: { type: db.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  serviceId: { type: db.Schema.Types.ObjectId, ref: 'Service' },

  // Short reference a patient can quote on the phone, e.g. "CS-7F3K2Q".
  bookingRef: { type: String, index: true },

  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true },
  durationMins: Number,

  status: {
    type: String,
    enum: Object.values(APPOINTMENT_STATUS),
    default: APPOINTMENT_STATUS.REQUESTED,
    index: true,
  },
  mode: { type: String, enum: ['OFFLINE', 'ONLINE'], default: 'OFFLINE' },
  source: {
    type: String,
    enum: ['WEBSITE', 'BOOKING_LINK', 'WHATSAPP', 'QR', 'GOOGLE', 'FACEBOOK', 'INSTAGRAM', 'SOCIAL', 'RECEPTION', 'WALK_IN', 'PHONE', 'PORTAL', 'AI_ASSISTANT'],
    default: 'WEBSITE',
  },

  /**
   * Slot lock. This is the double-booking guard: a unique partial index on
   * (clinicId, doctorId, slotKey) that only applies while the appointment
   * still blocks the slot. Cancelling sets slotKey to null, freeing it.
   */
  slotKey: { type: String, default: null },

  reason: String,
  notes: String,
  fee: Number,
  // Payment state is tracked independently of the visit's status.
  paymentStatus: { type: String, enum: ['UNPAID', 'PAID', 'PARTIAL', 'REFUNDED'], default: 'UNPAID' },
  paymentRequired: { type: Boolean, default: false },
  // An unpaid prepayment hold stops blocking the slot after this time.
  holdExpiresAt: Date,
  invoiceId: { type: db.Schema.Types.ObjectId, ref: 'Invoice' },

  checkedInAt: Date,
  consultationStartedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  cancelReason: String,
  cancelledBy: { type: String, enum: ['PATIENT', 'CLINIC', 'SYSTEM'] },
  rescheduledFrom: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },
  rescheduledTo: { type: db.Schema.Types.ObjectId, ref: 'Appointment' },

  // Emergency walk-ins jump the queue and are flagged on every desk view.
  isEmergency: { type: Boolean, default: false, index: true },
  meetingUrl: String,
  calendarEventId: String,
  createdByUserId: { type: db.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Teleconsultation: every online visit gets its own private video room.
appointmentSchema.pre('save', function ensureMeetingRoom(next) {
  if (this.mode === 'ONLINE' && !this.meetingUrl) {
    this.meetingUrl = `https://meet.jit.si/ClinicSaathi-${this.bookingRef || this._id}-${Math.random().toString(36).slice(2, 8)}`;
  }
  next();
});

appointmentSchema.plugin(tenantScope);

// The double-booking guard. Partial so cancelled/no-show rows (slotKey: null)
// don't collide and the slot can be resold.
appointmentSchema.index(
  { clinicId: 1, doctorId: 1, slotKey: 1 },
  { unique: true, partialFilterExpression: { slotKey: { $type: 'string' } } }
);
appointmentSchema.index({ clinicId: 1, startAt: 1, status: 1 });
appointmentSchema.index({ clinicId: 1, patientId: 1, startAt: -1 });
appointmentSchema.index({ clinicId: 1, doctorId: 1, startAt: 1 });

export const Appointment = db.model('Appointment', appointmentSchema);
