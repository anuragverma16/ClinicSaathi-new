import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState, Spinner } from '../../components/ui/States.jsx';
import { PageHeader, Field, fieldErrors, Section } from '../../components/ui/Page.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { inr } from '../../lib/format.js';

function ServiceForm({ service, onClose }) {
  const qc = useQueryClient();
  const isNew = !service?._id;
  const [f, setF] = useState({
    name: service?.name || '', description: service?.description || '', durationMins: service?.durationMins || 15,
    fee: service?.fee ?? 0, gstPercent: service?.gstPercent ?? 0, mode: service?.mode || 'OFFLINE', recallIntervalDays: service?.recallIntervalDays ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, durationMins: Number(f.durationMins), fee: Number(f.fee), gstPercent: Number(f.gstPercent), recallIntervalDays: f.recallIntervalDays === '' ? 0 : Number(f.recallIntervalDays) };
      return isNew ? api.post('/services', body) : api.patch(`/services/${service._id}`, body);
    },
    onSuccess: () => { toast.success('Service saved'); qc.invalidateQueries({ queryKey: ['services'] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  return (
    <Modal open onClose={onClose} title={isNew ? 'Add service' : 'Edit service'} width="max-w-xl"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="sv-name" error={errors.name} className="sm:col-span-2"><input id="sv-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Description" htmlFor="sv-desc" className="sm:col-span-2"><input id="sv-desc" className="field" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Fee (₹, before GST)" htmlFor="sv-fee" error={errors.fee}><input id="sv-fee" type="number" min="0" className="field" value={f.fee} onChange={(e) => set('fee', e.target.value)} /></Field>
        <Field label="GST" htmlFor="sv-gst" error={errors.gstPercent} hint="Most clinical consultations are GST-exempt (0%).">
          <select id="sv-gst" className="field" value={f.gstPercent} onChange={(e) => set('gstPercent', e.target.value)}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select>
        </Field>
        <Field label="Duration (minutes)" htmlFor="sv-dur" error={errors.durationMins}><input id="sv-dur" type="number" min="5" max="240" className="field" value={f.durationMins} onChange={(e) => set('durationMins', e.target.value)} /></Field>
        <Field label="Mode" htmlFor="sv-mode"><select id="sv-mode" className="field" value={f.mode} onChange={(e) => set('mode', e.target.value)}><option value="OFFLINE">In clinic</option><option value="ONLINE">Online</option><option value="BOTH">Both</option></select></Field>
        <Field label="Recall after (days)" htmlFor="sv-recall" className="sm:col-span-2" hint="Optional. Patients who complete this service get a recall reminder after this many days (needs marketing consent).">
          <input id="sv-recall" type="number" min="0" className="field" value={f.recallIntervalDays} onChange={(e) => set('recallIntervalDays', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Services and fees. Accountants and others see it read-only, with doctor consultation fees. */
export default function Services({ title = 'Services and fees' }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'CLINIC_OWNER';
  const [editing, setEditing] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get('/services', { params: { limit: 100 } }).then(unwrap) });
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap) });
  return (
    <div className="space-y-6">
      <PageHeader title={title} description="What patients can book and what it costs. Invoices pick up these fees and GST rates automatically."
        actions={canEdit && <button className="btn-primary" onClick={() => setEditing({})}><Plus className="h-4 w-4" /> Add service</button>} />
      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={data} onRowClick={canEdit ? setEditing : undefined}
        empty={<EmptyState title="No services yet" body="Without services, bookings are billed at the doctor's consultation fee." />}
        columns={[
          { key: 'name', header: 'Service', sort: (r) => r.name, render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{r.description}</p></div> },
          { key: 'fee', header: 'Fee', sort: (r) => r.fee, render: (r) => inr(r.fee) },
          { key: 'gst', header: 'GST', render: (r) => `${r.gstPercent || 0}%` },
          { key: 'dur', header: 'Duration', hideOnMobile: true, render: (r) => `${r.durationMins} min` },
          { key: 'recall', header: 'Recall', hideOnMobile: true, render: (r) => (r.recallIntervalDays ? `${r.recallIntervalDays} days` : '—') },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
        ]}
      />
      <Section title="Doctor consultation fees">
        <ul className="divide-y divide-line">
          {doctors.data?.map((d) => <li key={d._id} className="flex justify-between py-2 text-sm"><span>{d.name}<span className="ml-2 text-ink-muted">{d.specialization}</span></span><span className="font-medium">{inr(d.consultationFee)}</span></li>)}
          {!doctors.data?.length && <li className="py-2 text-sm text-ink-muted">No doctors yet.</li>}
        </ul>
      </Section>
      {editing && <ServiceForm service={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
