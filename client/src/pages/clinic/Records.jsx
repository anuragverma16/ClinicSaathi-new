import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { api, unwrap, openFile } from '../../lib/api.js';
import { PageHeader, Tabs } from '../../components/ui/Page.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState } from '../../components/ui/States.jsx';
import { PatientRecord } from './PatientRecord.jsx';
import { date, titleCase } from '../../lib/format.js';

const pdf = (kind, id) => (
  <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); openFile(kind, id).catch((err) => toast.error(err.message)); }}>
    <Download className="h-3.5 w-3.5" /> PDF
  </button>
);

/** Clinic-wide clinical documents for the owner: prescriptions, lab reports, certificates. */
export default function Records() {
  const [tab, setTab] = useState('prescriptions');
  const [patient, setPatient] = useState(null);
  const rx = useQuery({ queryKey: ['prescriptions', 'all'], queryFn: () => api.get('/prescriptions').then(unwrap), enabled: tab === 'prescriptions' });
  const lab = useQuery({ queryKey: ['lab', 'orders', 'all'], queryFn: () => api.get('/lab/orders').then(unwrap), enabled: tab === 'lab' });
  const certs = useQuery({ queryKey: ['certificates', 'all'], queryFn: () => api.get('/certificates').then(unwrap), enabled: tab === 'certs' });
  const open = (r) => setPatient(r.patientId?._id);
  return (
    <div>
      <PageHeader title="Prescriptions and reports" description="Every signed prescription, lab report and certificate issued at your clinic. Opening one is logged." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'prescriptions', label: 'Prescriptions' }, { value: 'lab', label: 'Lab reports' }, { value: 'certs', label: 'Certificates' }]} />
      {tab === 'prescriptions' && <DataTable loading={rx.isLoading} error={rx.error} rows={rx.data} onRowClick={open} empty={<EmptyState title="No prescriptions yet" />} columns={[
        { key: 'rx', header: 'Rx no.', render: (r) => <span className="font-mono text-xs">{r.rxNumber}</span> },
        { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
        { key: 'doctor', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name },
        { key: 'meds', header: 'Medicines', hideOnMobile: true, render: (r) => r.medicines.map((m) => m.name).join(', ') || '—' },
        { key: 'date', header: 'Date', render: (r) => date(r.finalizedAt || r.createdAt) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'f', header: '', render: (r) => r.status === 'FINAL' && pdf('prescription', r._id) },
      ]} />}
      {tab === 'lab' && <DataTable loading={lab.isLoading} error={lab.error} rows={lab.data} onRowClick={open} empty={<EmptyState title="No lab orders yet" />} columns={[
        { key: 'no', header: 'Order', render: (r) => <span className="font-mono text-xs">{r.orderNumber}</span> },
        { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
        { key: 'tests', header: 'Tests', hideOnMobile: true, render: (r) => r.tests.map((t) => t.name).join(', ') },
        { key: 'date', header: 'Ordered', render: (r) => date(r.createdAt) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'f', header: '', render: (r) => ['VERIFIED', 'RESULT_SUBMITTED'].includes(r.status) && pdf('labReport', r._id) },
      ]} />}
      {tab === 'certs' && <DataTable loading={certs.isLoading} error={certs.error} rows={certs.data} onRowClick={open} empty={<EmptyState title="No certificates yet" />} columns={[
        { key: 'no', header: 'No.', render: (r) => <span className="font-mono text-xs">{r.certificateNumber}</span> },
        { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
        { key: 'type', header: 'Type', render: (r) => titleCase(r.type) },
        { key: 'date', header: 'Issued', render: (r) => date(r.issuedAt || r.createdAt) },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'f', header: '', render: (r) => r.status === 'ISSUED' && pdf('certificate', r._id) },
      ]} />}
      <PatientRecord patientId={patient} onClose={() => setPatient(null)} />
    </div>
  );
}
