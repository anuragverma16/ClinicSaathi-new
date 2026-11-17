export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  CLINIC_OWNER: 'CLINIC_OWNER',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
  ACCOUNTANT: 'ACCOUNTANT',
  LAB_TECHNICIAN: 'LAB_TECHNICIAN',
  PATIENT: 'PATIENT',
};

/**
 * Hours a new doctor starts on, so adding one never leaves them silently
 * unbookable. Mon–Sat 09:00–17:00, Sunday off. The clinic edits it afterwards.
 */
export const DEFAULT_AVAILABILITY = [1, 2, 3, 4, 5, 6]
  .map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));

/** Roles a clinic owner may invite. Owners and super admins are provisioned elsewhere. */
export const STAFF_ROLES = [
  ROLES.BRANCH_MANAGER, ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.ACCOUNTANT, ROLES.LAB_TECHNICIAN,
];

/**
 * REQUESTED is the "pending_confirmation" state: the slot is held but not yet
 * confirmed (prepayment outstanding, or awaiting staff confirmation).
 */
export const APPOINTMENT_STATUS = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  WAITING: 'WAITING',
  IN_CONSULTATION: 'IN_CONSULTATION',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  RESCHEDULED: 'RESCHEDULED',
  NO_SHOW: 'NO_SHOW',
};

/** Statuses that still occupy a slot. Anything else frees it for rebooking. */
export const BLOCKING_STATUSES = [
  APPOINTMENT_STATUS.REQUESTED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.CHECKED_IN,
  APPOINTMENT_STATUS.WAITING,
  APPOINTMENT_STATUS.IN_CONSULTATION,
  APPOINTMENT_STATUS.COMPLETED,
];

/** Statuses a patient or the front desk may still cancel or reschedule from. */
export const CHANGEABLE_STATUSES = [APPOINTMENT_STATUS.REQUESTED, APPOINTMENT_STATUS.CONFIRMED];

export const LAB_STATUS = {
  ORDERED: 'ORDERED',
  SAMPLE_COLLECTED: 'SAMPLE_COLLECTED',
  PROCESSING: 'PROCESSING',
  RESULT_SUBMITTED: 'RESULT_SUBMITTED',
  VERIFIED: 'VERIFIED',
  CANCELLED: 'CANCELLED',
};

export const PLANS = {
  STARTER: { name: 'STARTER', price: 999, maxDoctors: 1, maxBranches: 1, features: ['booking', 'reminders', 'patients'] },
  GROWTH: { name: 'GROWTH', price: 2999, maxDoctors: 5, maxBranches: 1, features: ['booking', 'reminders', 'patients', 'queue', 'billing', 'followups', 'reports'] },
  PRO: { name: 'PRO', price: 5999, maxDoctors: 25, maxBranches: 1, features: ['booking', 'reminders', 'patients', 'queue', 'billing', 'followups', 'reports', 'ai_receptionist', 'ai_followup', 'ai_recall', 'reviews', 'campaigns'] },
  ENTERPRISE: { name: 'ENTERPRISE', price: null, maxDoctors: Infinity, maxBranches: Infinity, features: ['*'] },
};

export const ALL_FEATURES = [
  'booking', 'reminders', 'patients', 'queue', 'billing', 'followups', 'reports',
  'ai_receptionist', 'ai_followup', 'ai_recall', 'reviews', 'campaigns', 'multi_branch', 'api_access',
];

/** Campaign types the AI campaign manager offers (flu drive, diabetes camp, packages, offers...). */
export const CAMPAIGN_KINDS = ['RECALL', 'ANNOUNCEMENT', 'HEALTH_CAMP', 'VACCINATION', 'HEALTH_PACKAGE', 'OFFER', 'SEASONAL_CHECKUP', 'AWARENESS'];

/** Recall programmes the recall engine tracks. */
export const RECALL_TYPES = ['Dental cleaning', 'Annual health checkup', 'Diabetes review', 'Eye examination', 'Vaccination', 'Pregnancy follow-up', 'Child growth checkup'];
