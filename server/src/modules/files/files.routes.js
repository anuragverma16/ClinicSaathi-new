import { Router } from 'express';
import { z } from 'zod';
import {
  Prescription, MedicalCertificate, LabOrder, MedicalDocument, Invoice, Payment, Patient, Doctor, Consultation, Clinic, AuditLog,
} from '../../models/index.js';
import { validate } from '../../middleware/validate.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { ok } from '../../utils/respond.js';
import { ApiError } from '../../utils/ApiError.js';
import { recordAudit } from '../../middleware/audit.js';
import { can } from '../../middleware/rbac.js';
import { ROLES } from '../../config/constants.js';
import { assertClinicalAccess, portalPatientIds } from '../../services/access.service.js';
import { createDownloadToken, verifyDownloadToken, readFile } from '../../integrations/storage.js';
import * as pdf from '../../services/pdf.service.js';

const MODELS = {
  prescription: Prescription, certificate: MedicalCertificate, labReport: LabOrder, labFile: LabOrder,
  document: MedicalDocument, invoice: Invoice, receipt: Payment,
};
const CLINICAL = ['prescription', 'certificate', 'labReport', 'labFile', 'document'];
// What a patient may download: only finalised, released records.
const PATIENT_VISIBLE = {
  prescription: (d) => d.status === 'FINAL',
  certificate: (d) => d.status === 'ISSUED',
  labReport: (d) => d.status === 'VERIFIED',
  labFile: (d) => d.status === 'VERIFIED' && d.report?.storageKey,
  document: (d) => d.sharedWithPatient,
  invoice: (d) => d.status !== 'DRAFT',
  receipt: (d) => d.status === 'SUCCESS' || d.status?.includes('REFUNDED'),
};

/** Authorised, authenticated: returns a one-resource link valid for five minutes. */
export const signRouter = Router();
signRouter.post('/sign', validate(z.object({
  kind: z.enum(Object.keys(MODELS)),
  id: z.string().regex(/^[a-f\d]{24}$/i),
})), catchAsync(async (req, res) => {
  const { kind, id } = req.body;
  const clinicId = req.tenant.clinicId;
  const doc = await MODELS[kind].findOne({ _id: id }).setOptions({ clinicId }).lean();
  if (!doc) throw ApiError.notFound('File not found');

  if (req.user.role === ROLES.PATIENT) {
    const family = await portalPatientIds(req);
    if (!family.includes(String(doc.patientId)) || !PATIENT_VISIBLE[kind](doc)) throw ApiError.notFound('File not found');
  } else if (CLINICAL.includes(kind)) {
    if (req.user.role === ROLES.LAB_TECHNICIAN && kind.startsWith('lab')) {
      // Technicians may open the report file they uploaded, nothing else.
    } else {
      await assertClinicalAccess(req, doc.patientId);
    }
  } else if (!can(req.user.role, 'invoice:read')) {
    throw ApiError.forbidden('Your role cannot download billing documents');
  }
  if (kind === 'labFile' && !doc.report?.storageKey) throw ApiError.notFound('No report file was uploaded');

  const token = createDownloadToken({ clinicId, kind, id, userId: req.user._id });
  recordAudit(req, { action: 'FILE_LINK_ISSUED', entityType: kind, entityId: doc._id });
  ok(res, { url: `/api/files/download?token=${encodeURIComponent(token)}`, expiresInSeconds: 300 });
}));

/** Open route: the signed token is the authorisation. */
export const downloadRouter = Router();
downloadRouter.get('/download', catchAsync(async (req, res) => {
  const claims = verifyDownloadToken(req.query.token);
  if (!claims) throw ApiError.forbidden('This link has expired. Open the file again from ClinicSaathi.', 'LINK_EXPIRED');
  const { clinicId, kind, id } = claims;
  const opts = { clinicId };
  const doc = await MODELS[kind]?.findOne({ _id: id }).setOptions(opts);
  if (!doc) throw ApiError.notFound('File not found');

  const [clinic, patient] = await Promise.all([
    Clinic.findById(clinicId).lean(),
    doc.patientId ? Patient.findOne({ _id: doc.patientId }).setOptions(opts).lean() : null,
  ]);
  const doctorOf = (d) => (d.doctorId ? Doctor.findOne({ _id: d.doctorId }).setOptions(opts).lean() : null);

  let buffer; let filename; let mime = 'application/pdf';
  switch (kind) {
    case 'prescription': {
      const consultation = doc.consultationId ? await Consultation.findOne({ _id: doc.consultationId }).setOptions(opts).lean() : null;
      buffer = await pdf.prescriptionPdf({ clinic, prescription: doc, patient, doctor: await doctorOf(doc), consultation });
      filename = `${doc.rxNumber || 'prescription'}.pdf`; break;
    }
    case 'certificate':
      buffer = await pdf.certificatePdf({ clinic, certificate: doc, patient, doctor: await doctorOf(doc) });
      filename = `${doc.certificateNumber}.pdf`; break;
    case 'labReport':
      buffer = await pdf.labReportPdf({ clinic, order: doc, patient, doctor: await doctorOf(doc) });
      filename = `${doc.orderNumber}.pdf`; break;
    case 'labFile':
      buffer = await readFile(doc.report.storageKey); mime = doc.report.mimeType; filename = doc.report.fileName; break;
    case 'document':
      buffer = await readFile(doc.storageKey); mime = doc.mimeType; filename = doc.fileName;
      await MedicalDocument.updateOne({ _id: doc._id }, { $inc: { accessCount: 1 }, lastAccessedAt: new Date() }).setOptions(opts);
      break;
    case 'invoice': {
      const payments = await Payment.find({ invoiceId: doc._id, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }).setOptions(opts).lean();
      buffer = await pdf.invoicePdf({ clinic, invoice: doc, patient, payments });
      filename = `${doc.invoiceNumber}.pdf`; break;
    }
    case 'receipt': {
      const invoice = doc.invoiceId ? await Invoice.findOne({ _id: doc.invoiceId }).setOptions(opts).lean() : null;
      buffer = await pdf.receiptPdf({ clinic, payment: doc, invoice, patient });
      filename = `${doc.receiptNumber || 'receipt'}.pdf`; break;
    }
    default: throw ApiError.notFound('File not found');
  }

  await AuditLog.create({ clinicId, actorUserId: claims.userId, action: 'FILE_DOWNLOADED', entityType: kind, entityId: doc._id, ip: req.ip })
    .catch(() => {});
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(filename).replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}));
