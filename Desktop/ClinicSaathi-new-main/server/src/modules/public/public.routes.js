import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import rateLimit from 'express-rate-limit';
import { Clinic, Doctor, Service, Patient, Appointment } from '../../models/index.js';
import { validate } from '../../middleware/validate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok, created } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { getAvailability } from '../../services/availability.service.js';
import { bookAppointment } from '../../services/appointment.service.js';
import { issueOtp, verifyOtp, normalisePhone } from '../../services/otp.service.js';
import { gatewayEnabled } from '../../integrations/razorpay.js';
import { startPrepayment, verifyCheckout } from '../billing/billing.routes.js';
import { env } from '../../config/env.js';
import { TZ } from '../../utils/slots.js';
import { readFeedToken, buildDoctorFeed } from '../../services/calendarFeed.service.js';

const router = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Unauthenticated booking. Tighter limit than the staff API.
router.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 60 * env.rateLimitMultiplier, standardHeaders: true }));
const bookingLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 * env.rateLimitMultiplier, standardHeaders: true });

/** Doctor's private ICS feed for Google Calendar / Outlook subscriptions. */
router.get('/calendar/:token.ics', catchAsync(async (req, res) => {
  let ids;
  try { ids = readFeedToken(req.params.token); } catch { throw ApiError.notFound('Calendar not found'); }
  const ics = await buildDoctorFeed(ids);
  if (!ics) throw ApiError.notFound('Calendar not found');
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' }).send(ics);
}));

/**
 * Real, platform-wide numbers for the marketing site's stats band — no
 * invented figures. Registered before the /:slug routes below.
 */
router.get('/stats', catchAsync(async (_req, res) => {
  const [totalClinics, totalAppointments, totalPatients, statusBreakdown] = await Promise.all([
    Clinic.countDocuments({ isActive: true }),
    Appointment.countDocuments({}).setOptions({ crossTenant: true }),
    Patient.countDocuments({}).setOptions({ crossTenant: true }),
    Appointment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).option({ crossTenant: true }),
  ]);
  const byStatus = Object.fromEntries(statusBreakdown.map((s) => [s._id, s.count]));
  const noShowRate = totalAppointments ? Math.round(((byStatus.NO_SHOW || 0) / totalAppointments) * 1000) / 10 : 0;
  ok(res, { totalClinics, totalAppointments, totalPatients, noShowRate });
}));

/** Resolves the tenant from the URL slug. Public callers never choose a clinicId. */
const loadClinic = catchAsync(async (req, _res, next) => {
  const clinic = await Clinic.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true });
  if (!clinic) throw ApiError.notFound('Clinic not found', 'CLINIC_NOT_FOUND');
  req.clinic = clinic;
  req.tenant = { clinicId: clinic._id, branchId: null };
  next();
});

router.get('/:slug', loadClinic, (req, res) => {
  const { name, slug, tagline, about, logoUrl, address, timings, phone, email, bookingPolicy } = req.clinic;
  ok(res, {
    name, slug, tagline, about, logoUrl, address, timings, phone, email,
    booking: {
      online: bookingPolicy?.allowOnlineBooking !== false,
      prepayment: Boolean(bookingPolicy?.requirePrepayment && gatewayEnabled()),
      phoneVerification: Boolean(bookingPolicy?.requirePhoneVerification),
      maxAdvanceDays: bookingPolicy?.maxAdvanceDays || 60,
      cancelCutoffHours: bookingPolicy?.cancelCutoffHours ?? 2,
    },
  });
});

router.get('/:slug/doctors', loadClinic, catchAsync(async (req, res) => {
  const doctors = await Doctor.find({ isActive: true })
    .select('name photoUrl qualification specialization experienceYears consultationFee supportsOnline slotDurationMins serviceIds')
    .sort('name').setOptions({ clinicId: req.clinic._id });
  ok(res, doctors);
}));

router.get('/:slug/services', loadClinic, catchAsync(async (req, res) => {
  const services = await Service.find({ isActive: true })
    .select('name description durationMins fee mode').sort('name').setOptions({ clinicId: req.clinic._id });
  ok(res, services);
}));

router.get('/:slug/availability', loadClinic, catchAsync(async (req, res) => {
  const { doctorId, date, serviceId } = req.query;
  if (!doctorId) throw ApiError.badRequest('Pick a doctor first');
  const day = date || dayjs().tz(TZ).format('YYYY-MM-DD');
  const max = req.clinic.bookingPolicy?.maxAdvanceDays || 60;
  if (dayjs.tz(day, TZ).isAfter(dayjs().add(max, 'day'))) {
    return ok(res, { date: day, slots: [], reason: `Bookings open ${max} days ahead` });
  }
  let duration;
  if (serviceId) duration = (await Service.findOne({ _id: serviceId, isActive: true }).setOptions({ clinicId: req.clinic._id }))?.durationMins;
  ok(res, await getAvailability({ clinicId: req.clinic._id, doctorId, date: day, serviceDurationMins: duration }));
}));

router.post('/:slug/verify-phone', bookingLimiter, loadClinic, validate(z.object({ phone: z.string().min(10).max(15) })), catchAsync(async (req, res) => {
  await issueOtp({ clinicId: req.clinic._id, clinicName: req.clinic.name, phone: normalisePhone(req.body.phone), purpose: 'BOOKING' });
  ok(res, { message: 'We sent a 6-digit code to your phone.' });
}));

const publicBookSchema = z.object({
  doctorId: objectId,
  serviceId: objectId.optional(),
  startAt: z.string().min(10),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(15),
  email: z.string().email().optional().or(z.literal('')),
  reason: z.string().max(300).optional(),
  otp: z.string().regex(/^\d{6}$/).optional(),
  consentGiven: z.literal(true, { errorMap: () => ({ message: 'Please accept the privacy notice' }) }),
  marketingConsent: z.boolean().optional(),
  source: z.enum(['WEBSITE', 'BOOKING_LINK', 'QR', 'GOOGLE', 'FACEBOOK', 'INSTAGRAM', 'SOCIAL', 'WHATSAPP']).optional(),
});

/**
 * Public booking: availability is re-validated inside bookAppointment, the
 * phone is verified by OTP when the clinic requires it, and a prepaid clinic
 * gets a time-limited hold that only a verified payment confirms.
 */
router.post('/:slug/appointments', bookingLimiter, loadClinic, validate(publicBookSchema), catchAsync(async (req, res) => {
  const clinic = req.clinic;
  const clinicId = clinic._id;
  const policy = clinic.bookingPolicy || {};
  if (policy.allowOnlineBooking === false) throw ApiError.forbidden('This clinic takes bookings by phone only', 'ONLINE_BOOKING_OFF');
  const phone = normalisePhone(req.body.phone);
  if (policy.requirePhoneVerification) {
    if (!req.body.otp) throw ApiError.badRequest('Verify your phone number to book', 'OTP_REQUIRED');
    await verifyOtp({ clinicId, phone, purpose: 'BOOKING', code: req.body.otp });
  }

  let patient = await Patient.findOne({ phone, guardianPatientId: { $exists: false } }).setOptions({ clinicId });
  if (!patient) {
    patient = await Patient.create({
      clinicId, name: req.body.name, phone, email: req.body.email || undefined,
      consent: {
        dataProcessing: { granted: true, grantedAt: new Date(), version: 'v1' },
        marketing: { granted: Boolean(req.body.marketingConsent), grantedAt: req.body.marketingConsent ? new Date() : undefined },
      },
    });
  }

  const prepay = Boolean(policy.requirePrepayment && gatewayEnabled());
  const appointment = await bookAppointment({
    clinicId, patientId: patient._id, doctorId: req.body.doctorId, serviceId: req.body.serviceId,
    startAt: req.body.startAt, source: req.body.source || 'WEBSITE', reason: req.body.reason,
    holdMinutes: prepay ? policy.holdMinutes || 15 : undefined, enforceAdvanceWindow: true,
  });
  const payment = appointment.paymentRequired ? await startPrepayment(req, appointment) : null;

  created(res, {
    appointmentId: appointment._id,
    bookingRef: appointment.bookingRef,
    startAt: appointment.startAt,
    status: appointment.status,
    fee: appointment.fee,
    payment,
  });
}));

/** Prepaid public booking: settles only after signature + gateway confirmation. */
router.post('/:slug/payments/verify', bookingLimiter, loadClinic, validate(z.object({
  razorpay_order_id: z.string().min(5), razorpay_payment_id: z.string().min(5), razorpay_signature: z.string().min(10),
})), catchAsync(async (req, res) => {
  const result = await verifyCheckout(req.body, req.clinic._id);
  ok(res, { status: result.pending ? 'PENDING' : 'SUCCESS' });
}));

export default router;
