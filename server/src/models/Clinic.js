import db from '../db/index.js';

const clinicSchema = new db.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, index: true },
  tagline: String,
  about: String,
  logoUrl: String,
  email: String,
  phone: String,
  gstin: String,
  address: {
    line1: String, line2: String, city: String, state: String,
    pincode: String, country: { type: String, default: 'India' },
    lat: Number, lng: Number,
  },
  timings: {
    // 0 = Sunday
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    openTime: { type: String, default: '09:00' },
    closeTime: { type: String, default: '19:00' },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  holidays: [{ date: Date, reason: String }],

  // Patient-facing rules the server enforces on every booking change.
  bookingPolicy: {
    requirePrepayment: { type: Boolean, default: false },
    // Unpaid prepayment holds are released after this many minutes.
    holdMinutes: { type: Number, default: 15 },
    cancelCutoffHours: { type: Number, default: 2 },
    rescheduleCutoffHours: { type: Number, default: 2 },
    maxAdvanceDays: { type: Number, default: 60 },
    requirePhoneVerification: { type: Boolean, default: false },
    allowOnlineBooking: { type: Boolean, default: true },
  },

  // Which automated messages go out, and the Meta-approved template behind each.
  notificationSettings: {
    reminderHours: { type: [Number], default: [24, 2] },
    events: {
      confirmation: { type: Boolean, default: true },
      reminder: { type: Boolean, default: true },
      cancellation: { type: Boolean, default: true },
      reschedule: { type: Boolean, default: true },
      queueCalled: { type: Boolean, default: true },
      followUp: { type: Boolean, default: true },
      paymentReminder: { type: Boolean, default: true },
      reviewRequest: { type: Boolean, default: false },
      documentReady: { type: Boolean, default: true },
      // Opt-in: greetings are marketing and medicine nudges are a clinical choice.
      birthday: { type: Boolean, default: false },
      festival: { type: Boolean, default: false },
      medicineReminder: { type: Boolean, default: false },
    },
    templates: { type: Map, of: String, default: {} },
    reviewDelayHours: { type: Number, default: 3 },
  },
  // Only a review URL the clinic has entered is ever sent to patients.
  reviewUrl: String,

  // Answers the AI receptionist and WhatsApp menu give patients.
  patientInfo: {
    insurance: String,
    parking: String,
    emergencyContact: String,
    mapUrl: String,
  },
  // Where the clinic's booking link is published (for channel links + QR codes).
  channels: {
    websiteUrl: String,
    googleBusinessUrl: String,
    facebookUrl: String,
    instagramUrl: String,
  },
  // Festival greetings sent on the day to patients with marketing consent.
  festivals: [{ name: { type: String, required: true }, date: { type: Date, required: true }, message: String }],

  integrations: {
    whatsappPhoneNumberId: { type: String, index: true, sparse: true },
  },

  onboarding: {
    completed: { type: Boolean, default: false },
    currentStep: { type: Number, default: 1 },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export const Clinic = db.model('Clinic', clinicSchema);
