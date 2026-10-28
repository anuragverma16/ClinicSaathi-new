import { Router } from 'express';
import { authenticate } from './middleware/auth.js';
import { requireTenant, requireRole, requireStaff } from './middleware/rbac.js';
import { ROLES } from './config/constants.js';

import authRoutes from './modules/auth/auth.routes.js';
import publicRoutes from './modules/public/public.routes.js';
import webhookRoutes from './modules/webhook/webhook.routes.js';
import clinicRoutes from './modules/clinic/clinic.routes.js';
import doctorRoutes from './modules/doctor/doctor.routes.js';
import serviceRoutes from './modules/service/service.routes.js';
import patientRoutes from './modules/patient/patient.routes.js';
import appointmentRoutes from './modules/appointment/appointment.routes.js';
import queueRoutes from './modules/queue/queue.routes.js';
import consultationRoutes from './modules/consultation/consultation.routes.js';
import { prescriptionRouter, certificateRouter } from './modules/prescription/prescription.routes.js';
import labRoutes from './modules/lab/lab.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import automationRoutes from './modules/automation/automation.routes.js';
import portalRoutes from './modules/portal/portal.routes.js';
import platformRoutes from './modules/platform/platform.routes.js';
import leaveRoutes from './modules/leave/leave.routes.js';
import { signRouter, downloadRouter } from './modules/files/files.routes.js';

const router = Router();

// Open
router.use('/auth', authRoutes);
router.use('/public', publicRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/files', downloadRouter);        // authorised by a signed, expiring token

// Platform admin spans every clinic, so it sits outside tenant resolution.
router.use('/platform', authenticate, requireRole(ROLES.SUPER_ADMIN), platformRoutes);

// Everything below needs a signed-in user AND a resolved tenant from their own record.
router.use(authenticate, requireTenant);

router.use('/portal', portalRoutes);          // patients only (enforced inside)
router.use('/files', signRouter);             // staff and patients, each checked per file

// Clinic staff only.
router.use(requireStaff);
router.use('/clinics', clinicRoutes);
router.use('/doctors', doctorRoutes);
router.use('/services', serviceRoutes);
router.use('/patients', patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/queue', queueRoutes);
router.use('/consultations', consultationRoutes);
router.use('/prescriptions', prescriptionRouter);
router.use('/certificates', certificateRouter);
router.use('/lab', labRoutes);
router.use('/billing', billingRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/automation', automationRoutes);
router.use('/leaves', leaveRoutes);

export default router;
