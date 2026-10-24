import { Appointment, Patient } from '../models/index.js';
import { ROLES } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Who may read a patient's clinical record (notes, diagnoses, prescriptions,
 * lab results, documents):
 *  - the clinic owner (clinical lead of the practice),
 *  - a doctor with a care relationship — at least one appointment with them.
 * Front desk, accounts and branch managers see demographics and scheduling
 * only; lab technicians see only what's embedded in their orders.
 */
export function canSeeClinical(user) {
  return [ROLES.CLINIC_OWNER, ROLES.DOCTOR].includes(user.role);
}

export async function hasCareRelationship(req, patientId) {
  if (req.user.role === ROLES.CLINIC_OWNER) return true;
  if (req.user.role !== ROLES.DOCTOR || !req.user.doctorId) return false;
  return Boolean(await Appointment.exists({ patientId, doctorId: req.user.doctorId }).setOptions({ clinicId: req.tenant.clinicId }));
}

/** Throws unless the caller may read this patient's clinical data. */
export async function assertClinicalAccess(req, patientId) {
  if (!canSeeClinical(req.user) || !(await hasCareRelationship(req, patientId))) {
    throw ApiError.forbidden('You do not have clinical access to this patient', 'NO_CLINICAL_ACCESS');
  }
}

/** Doctors author clinical records only as themselves, via their linked profile. */
export function requireDoctorProfile(req) {
  if (!req.user.doctorId) {
    throw ApiError.forbidden('Link your account to a doctor profile to write clinical records', 'NO_DOCTOR_PROFILE');
  }
  return req.user.doctorId;
}

/** Patient ids a patient account may act for: itself plus registered dependents. */
export async function portalPatientIds(req) {
  const self = req.tenant.patientId;
  if (!self) throw ApiError.forbidden('No patient profile on this account');
  const dependents = await Patient.find({ guardianPatientId: self }).select('_id').setOptions({ clinicId: req.tenant.clinicId }).lean();
  return [String(self), ...dependents.map((d) => String(d._id))];
}

/** Resolves ?patientId= for portal calls, refusing anything outside the family. */
export async function resolvePortalPatient(req, requested) {
  const allowed = await portalPatientIds(req);
  const id = requested ? String(requested) : allowed[0];
  if (!allowed.includes(id)) throw ApiError.notFound('Not found');
  return id;
}
