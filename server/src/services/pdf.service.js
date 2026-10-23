import PDFDocument from 'pdfkit';
import dayjs from 'dayjs';

const NAVY = '#0B2545';
const TEAL = '#0E8A7D';
const MUTED = '#5C706C';

/** Renders a PDF into a Buffer. `draw(doc)` lays out the body. */
function render(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

function header(doc, clinic, title) {
  doc.fillColor(NAVY).fontSize(18).font('Helvetica-Bold').text(clinic?.name || 'Clinic');
  const addr = [clinic?.address?.line1, clinic?.address?.city, clinic?.address?.pincode].filter(Boolean).join(', ');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text([addr, clinic?.phone, clinic?.email].filter(Boolean).join('  ·  '));
  if (clinic?.gstin) doc.text(`GSTIN: ${clinic.gstin}`);
  doc.moveDown(0.6);
  doc.strokeColor(TEAL).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fillColor(NAVY).fontSize(14).font('Helvetica-Bold').text(title);
  doc.moveDown(0.4);
  doc.font('Helvetica').fillColor('#111').fontSize(10);
}

function kv(doc, pairs) {
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === '') continue;
    doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(String(v));
  }
  doc.moveDown(0.6);
}

const age = (dob) => (dob ? `${dayjs().diff(dayjs(dob), 'year')} y` : undefined);

function signatureBlock(doc, signature) {
  doc.moveDown(2);
  doc.font('Helvetica-Bold').text(signature?.doctorName || '', { align: 'right' });
  doc.font('Helvetica').fillColor(MUTED).text(`Reg. No. ${signature?.registrationNumber || '—'}`, { align: 'right' });
  if (signature?.signedAt) doc.text(`Digitally signed ${dayjs(signature.signedAt).format('DD MMM YYYY, h:mm A')}`, { align: 'right' });
  doc.fillColor('#111');
}

export function prescriptionPdf({ clinic, prescription, patient, doctor, consultation }) {
  return render((doc) => {
    header(doc, clinic, `Prescription  ${prescription.rxNumber || ''}`);
    kv(doc, [
      ['Patient', patient?.name], ['Age / Gender', [age(patient?.dob), patient?.gender].filter(Boolean).join(' / ')],
      ['Doctor', `${doctor?.name || ''}${doctor?.qualification ? `, ${doctor.qualification}` : ''}`],
      ['Date', dayjs(prescription.finalizedAt || prescription.createdAt).format('DD MMM YYYY')],
      ['Diagnosis', consultation?.diagnosis],
      ['Known allergies', patient?.allergies?.length ? patient.allergies.join(', ') : undefined],
    ]);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Rx').fillColor('#111').fontSize(10).font('Helvetica');
    doc.moveDown(0.3);
    const timing = { BEFORE_FOOD: 'before food', AFTER_FOOD: 'after food', ANY: '' };
    prescription.medicines.forEach((m, i) => {
      doc.font('Helvetica-Bold').text(`${i + 1}. ${m.name}${m.dosage ? ` ${m.dosage}` : ''}`);
      const line = [m.frequency, m.durationDays ? `${m.durationDays} days` : null, timing[m.timing], m.instructions].filter(Boolean).join(' · ');
      if (line) doc.font('Helvetica').fillColor(MUTED).text(`   ${line}`).fillColor('#111');
      doc.moveDown(0.2);
    });
    if (prescription.advice) { doc.moveDown(0.5).font('Helvetica-Bold').text('Advice').font('Helvetica').text(prescription.advice); }
    if (consultation?.followUpDate) doc.moveDown(0.5).text(`Follow up on ${dayjs(consultation.followUpDate).format('DD MMM YYYY')}`);
    signatureBlock(doc, prescription.signature);
  });
}

export function certificatePdf({ clinic, certificate, patient, doctor }) {
  const titles = { SICK_LEAVE: 'Medical Certificate (Sick Leave)', FITNESS: 'Certificate of Fitness', GENERAL: 'Medical Certificate' };
  return render((doc) => {
    header(doc, clinic, `${titles[certificate.type]}  ${certificate.certificateNumber}`);
    kv(doc, [['Patient', patient?.name], ['Age / Gender', [age(patient?.dob), patient?.gender].filter(Boolean).join(' / ')],
      ['Issued', dayjs(certificate.issuedAt || certificate.createdAt).format('DD MMM YYYY')]]);
    const range = certificate.fromDate
      ? ` from ${dayjs(certificate.fromDate).format('DD MMM YYYY')}${certificate.toDate ? ` to ${dayjs(certificate.toDate).format('DD MMM YYYY')}` : ''}`
      : '';
    const body = certificate.type === 'FITNESS'
      ? `This is to certify that ${patient?.name} was examined and is medically fit to resume normal duties${range}.`
      : certificate.type === 'SICK_LEAVE'
        ? `This is to certify that ${patient?.name} was under my care and was advised rest${range}.`
        : `This is to certify that ${patient?.name} was examined by me${range}.`;
    doc.fontSize(11).text(body, { lineGap: 4 });
    if (certificate.remarks) doc.moveDown().text(`Remarks: ${certificate.remarks}`);
    signatureBlock(doc, certificate.signature || { doctorName: doctor?.name, registrationNumber: doctor?.registrationNumber });
  });
}

export function invoicePdf({ clinic, invoice, patient, payments = [] }) {
  return render((doc) => {
    header(doc, clinic, `${invoice.gstAmount > 0 ? 'Tax Invoice' : 'Invoice'}  ${invoice.invoiceNumber}`);
    kv(doc, [['Billed to', patient?.name], ['Phone', patient?.phone], ['Date', dayjs(invoice.createdAt).format('DD MMM YYYY')], ['Status', invoice.status]]);
    const cols = [48, 300, 360, 430, 480];
    const row = (cells, bold) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      cells.forEach((c, i) => doc.text(c, cols[i], y, { width: i === 0 ? 240 : 60 }));
      doc.x = 48;
      doc.moveDown(0.4);
    };
    row(['Item', 'Qty', 'Rate', 'GST %', 'Amount'], true);
    for (const li of invoice.lineItems) {
      row([li.description, String(li.quantity), li.unitPrice.toFixed(2), String(li.gstPercent || 0),
        (li.amount ?? li.unitPrice * li.quantity).toFixed(2)]);
    }
    doc.font('Helvetica').moveDown(0.5);
    kv(doc, [['Subtotal', `INR ${invoice.subtotal.toFixed(2)}`],
      ['Discount', invoice.discount ? `INR ${invoice.discount.toFixed(2)}` : undefined],
      ['GST', invoice.gstAmount ? `INR ${invoice.gstAmount.toFixed(2)}` : undefined],
      ['Total', `INR ${invoice.total.toFixed(2)}`], ['Paid', `INR ${invoice.amountPaid.toFixed(2)}`],
      ['Balance due', `INR ${Math.max(0, invoice.total - invoice.amountPaid).toFixed(2)}`]]);
    if (payments.length) {
      doc.font('Helvetica-Bold').text('Payments').font('Helvetica');
      for (const p of payments) doc.text(`${dayjs(p.verifiedAt || p.createdAt).format('DD MMM YYYY')}  ${p.receiptNumber || ''}  ${p.method}  INR ${p.amount.toFixed(2)}`);
    }
  });
}

export function receiptPdf({ clinic, payment, invoice, patient }) {
  return render((doc) => {
    header(doc, clinic, `Payment Receipt  ${payment.receiptNumber}`);
    kv(doc, [['Received from', patient?.name], ['Amount', `INR ${payment.amount.toFixed(2)}`], ['Method', payment.method],
      ['Reference', payment.gatewayPaymentId || payment.reference], ['Against invoice', invoice?.invoiceNumber],
      ['Date', dayjs(payment.verifiedAt || payment.createdAt).format('DD MMM YYYY, h:mm A')]]);
    doc.fillColor(MUTED).text('This is a computer-generated receipt.');
  });
}

export function labReportPdf({ clinic, order, patient, doctor }) {
  return render((doc) => {
    header(doc, clinic, `Lab Report  ${order.orderNumber}`);
    kv(doc, [['Patient', patient?.name], ['Age / Gender', [age(patient?.dob), patient?.gender].filter(Boolean).join(' / ')],
      ['Referred by', doctor?.name], ['Collected', order.collectedAt && dayjs(order.collectedAt).format('DD MMM YYYY, h:mm A')],
      ['Verified', order.verifiedAt && dayjs(order.verifiedAt).format('DD MMM YYYY, h:mm A')]]);
    doc.font('Helvetica-Bold');
    for (const r of order.results) {
      doc.font('Helvetica-Bold').text(r.test, { continued: true }).font('Helvetica')
        .text(`   ${r.value ?? ''} ${r.unit ?? ''}   (ref ${r.referenceRange || '—'}) ${r.flag && r.flag !== 'NORMAL' ? r.flag : ''}`);
    }
    if (order.doctorRemarks) doc.moveDown().font('Helvetica-Bold').text('Doctor remarks').font('Helvetica').text(order.doctorRemarks);
  });
}
