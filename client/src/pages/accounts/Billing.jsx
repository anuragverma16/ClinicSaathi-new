import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { Plus, Download, FileSpreadsheet, IndianRupee, AlertCircle, Undo2, Receipt, Percent, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, unwrap, unwrapPage, openFile, downloadCsv, razorpayCheckout } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section, Field, Tabs, Drawer, Pagination, KeyValue, useReasonPrompt, fieldErrors } from '../../components/ui/Page.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState, Spinner, Skeleton } from '../../components/ui/States.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { PatientPicker } from '../clinic/BookingForm.jsx';
import { RevenueChart } from '../clinic/Analytics.jsx';
import { CHART } from '../../lib/chart.js';
import { inr, inr2, date, dateTime, titleCase } from '../../lib/format.js';

const pdf = (kind, id, label = 'PDF') => (
  <button className="btn-quiet btn-sm" onClick={(e) => { e.stopPropagation(); openFile(kind, id).catch((err) => toast.error(err.message)); }}><Download className="h-3.5 w-3.5" /> {label}</button>
);
const canPay = (role) => ['CLINIC_OWNER', 'ACCOUNTANT'].includes(role);

// ------------------------------------------------------------------ New invoice

function NewInvoice({ onClose }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('visit');
  const [patient, setPatient] = useState(null);
  const [appointmentId, setAppointmentId] = useState('');
  const [lines, setLines] = useState([{ description: '', unitPrice: '', quantity: 1, gstPercent: 0, serviceId: '' }]);
  const [discount, setDiscount] = useState('');
  const [errors, setErrors] = useState({});
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services').then(unwrap) });
  const visits = useQuery({
    queryKey: ['appointments', 'billable', patient?._id],
    queryFn: () => api.get('/billing/billable-visits', { params: { patientId: patient._id } }).then(unwrap),
    enabled: Boolean(patient),
  });
  const setLine = (i, patch) => setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const pickService = (i, id) => { const s = services.data?.find((x) => x._id === id); setLine(i, s ? { serviceId: id, description: s.name, unitPrice: s.fee, gstPercent: s.gstPercent || 0 } : { serviceId: '' }); };
  const subtotal = lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 1), 0);
  const create = useMutation({
    mutationFn: () => api.post('/billing/invoices', mode === 'visit'
      ? { appointmentId, discount: Number(discount) || 0 }
      : { patientId: patient._id, discount: Number(discount) || 0, lineItems: lines.filter((l) => l.description && l.unitPrice !== '').map((l) => ({ description: l.description, unitPrice: Number(l.unitPrice), quantity: Number(l.quantity) || 1, gstPercent: Number(l.gstPercent) || 0, ...(l.serviceId ? { serviceId: l.serviceId } : {}) })) }).then(unwrap),
    onSuccess: (inv) => { toast.success(`${inv.invoiceNumber} created · ${inr2(inv.total)}`); qc.invalidateQueries({ queryKey: ['invoices'] }); onClose(inv); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  return (
    <Modal open onClose={() => onClose()} title="New invoice" width="max-w-2xl" footer={<><button className="btn-ghost" onClick={() => onClose()}>Cancel</button><button className="btn-primary" disabled={!patient || (mode === 'visit' ? !appointmentId : subtotal <= 0) || create.isPending} onClick={() => create.mutate()}>{create.isPending && <Spinner />} Create invoice</button></>}>
      <div className="space-y-4">
        <Field label="Patient"><PatientPicker value={patient} onChange={(p) => { setPatient(p); setAppointmentId(''); }} /></Field>
        <Tabs value={mode} onChange={setMode} tabs={[{ value: 'visit', label: 'Bill a visit' }, { value: 'manual', label: 'Itemised' }]} />
        {mode === 'visit' ? (
          <Field label="Visit" htmlFor="ni-appt" hint="Fee and GST come from the service or doctor's consultation fee.">
            <select id="ni-appt" className="field" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} disabled={!patient}>
              <option value="">{patient ? 'Choose a visit' : 'Pick a patient first'}</option>
              {visits.data?.map((a) => <option key={a._id} value={a._id}>{dateTime(a.startAt)} · {a.doctorId?.name} · {a.serviceId?.name || 'Consultation'} · {inr(a.fee)}</option>)}
            </select>
          </Field>
        ) : (
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2">
                <div className="grid gap-2 sm:grid-cols-6">
                  <select className="field sm:col-span-2" value={l.serviceId} onChange={(e) => pickService(i, e.target.value)} aria-label="Service"><option value="">Custom item</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
                  <input className="field sm:col-span-2" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Description" />
                  <input className="field" type="number" min="0" placeholder="Rate" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-label="Rate" />
                  <select className="field" value={l.gstPercent} onChange={(e) => setLine(i, { gstPercent: e.target.value })} aria-label="GST">{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select>
                </div>
                <button className="btn-quiet h-fit p-2" aria-label="Remove line" onClick={() => setLines((x) => (x.length > 1 ? x.filter((_, idx) => idx !== i) : x))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button className="btn-quiet btn-sm" onClick={() => setLines((x) => [...x, { description: '', unitPrice: '', quantity: 1, gstPercent: 0, serviceId: '' }])}><Plus className="h-3.5 w-3.5" /> Add line</button>
            <p className="text-right text-sm text-ink-muted">Subtotal {inr2(subtotal)} (GST added on save)</p>
          </div>
        )}
        <Field label="Discount (₹)" htmlFor="ni-disc" error={errors.discount}><input id="ni-disc" type="number" min="0" className="field max-w-[160px]" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Invoice drawer

function InvoiceDrawer({ id, onClose }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [pay, setPay] = useState({ amount: '', method: 'CASH', reference: '' });
  const [askReason, reasonDialog] = useReasonPrompt();
  const inv = useQuery({ queryKey: ['invoices', id], queryFn: () => api.get(`/billing/invoices/${id}`).then(unwrap), enabled: Boolean(id) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['finance'] }); };
  const record = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${id}/record-payment`, { amount: Number(pay.amount), method: pay.method, reference: pay.reference || undefined }).then(unwrap),
    onSuccess: (d) => { toast.success(`Payment recorded · receipt ${d.payment.receiptNumber}`); setPay({ amount: '', method: 'CASH', reference: '' }); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const online = useMutation({
    mutationFn: async () => {
      const o = unwrap(await api.post(`/billing/invoices/${id}/payment-order`));
      const resp = await razorpayCheckout({ keyId: o.keyId, order: o.order, name: 'Clinic payment', description: inv.data.invoiceNumber, prefill: { name: inv.data.patientId?.name, contact: inv.data.patientId?.phone } });
      return api.post('/billing/payments/verify', resp).then(unwrap);
    },
    onSuccess: (r) => { toast.success(r.pending ? 'Payment authorised — it will settle when captured' : 'Payment verified'); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const voidIt = useMutation({ mutationFn: (reason) => api.post(`/billing/invoices/${id}/void`, { reason }), onSuccess: () => { toast.success('Invoice voided'); refresh(); }, onError: (e) => toast.error(e.message) });
  const refund = useMutation({
    mutationFn: ({ paymentId, amount, reason }) => api.post(`/billing/payments/${paymentId}/refund`, { amount, reason }),
    onSuccess: () => { toast.success('Refund recorded'); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const doRefund = async (p) => {
    const max = p.amount - (p.refundedAmount || 0);
    const reason = await askReason({ title: `Refund ${inr2(max)}?`, body: p.gateway === 'RAZORPAY' ? 'The refund is requested from Razorpay and marked done when it confirms.' : 'Record that you returned this cash/desk payment.', confirmLabel: 'Refund', danger: true, required: true });
    if (reason) refund.mutate({ paymentId: p._id, amount: max, reason });
  };
  const d = inv.data;
  const due = d ? Math.round((d.total - d.amountPaid) * 100) / 100 : 0;
  const payable = d && ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(d.status) && canPay(user?.role);
  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={d?.invoiceNumber || 'Invoice'} subtitle={d ? `${d.patientId?.name} · ${date(d.createdAt)}` : ''}
      footer={d && <>{pdf('invoice', d._id, 'Invoice PDF')}{canPay(user?.role) && d.amountPaid === 0 && ['UNPAID', 'OVERDUE'].includes(d.status) && <button className="btn-danger btn-sm" onClick={async () => { const r = await askReason({ title: 'Void invoice?', danger: true, required: true, confirmLabel: 'Void' }); if (r) voidIt.mutate(r); }}>Void</button>}</>}>
      {!d ? <Skeleton className="h-60" /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-2"><StatusBadge status={d.status} />{d.gstin && <span className="text-xs text-ink-muted">GSTIN {d.gstin}</span>}</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-ink-muted"><th className="py-1">Item</th><th>Qty</th><th>GST</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{d.lineItems.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{l.description}</td><td>{l.quantity}</td><td>{l.gstPercent}%</td><td className="text-right">{inr2(l.amount)}</td></tr>)}</tbody>
          </table>
          <KeyValue items={[['Subtotal', inr2(d.subtotal)], ['Discount', inr2(d.discount)], ['GST', inr2(d.gstAmount)], ['Total', inr2(d.total)], ['Paid', inr2(d.amountPaid)], ['Balance', inr2(d.balance)], d.refundedAmount > 0 && ['Refunded', inr2(d.refundedAmount)]]} />

          {payable && (
            <Section title="Collect payment">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Amount" htmlFor="ip-amt"><input id="ip-amt" type="number" min="1" max={due} className="field" placeholder={String(due)} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
                <Field label="Method" htmlFor="ip-m"><select id="ip-m" className="field" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="CASH">Cash</option><option value="UPI">UPI (desk QR)</option><option value="CARD">Card machine</option><option value="NETBANKING">Bank transfer</option></select></Field>
                <Field label="Reference" htmlFor="ip-ref"><input id="ip-ref" className="field" placeholder="UTR / slip no." value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button className="btn-ghost" onClick={() => online.mutate()} disabled={online.isPending}>{online.isPending && <Spinner />} Collect online (Razorpay)</button>
                <button className="btn-primary" onClick={() => record.mutate()} disabled={!(Number(pay.amount) > 0) || Number(pay.amount) > due || record.isPending}>{record.isPending && <Spinner />} Record payment</button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">Desk payments settle immediately. Online payments settle only after Razorpay's signature and capture are verified on the server.</p>
            </Section>
          )}

          <div>
            <h3 className="section-title mb-2">Payments</h3>
            {!d.payments?.length ? <p className="muted">No payments yet.</p> : (
              <ul className="space-y-2">
                {d.payments.map((p) => (
                  <li key={p._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <span><b>{inr2(p.amount)}</b> · {titleCase(p.method)} · {dateTime(p.verifiedAt || p.createdAt)}{p.receiptNumber && <span className="ml-1 font-mono text-xs text-ink-muted">{p.receiptNumber}</span>}</span>
                    <span className="flex items-center gap-1"><StatusBadge status={p.status} />
                      {p.receiptNumber && pdf('receipt', p._id, 'Receipt')}
                      {canPay(user?.role) && ['SUCCESS', 'PARTIALLY_REFUNDED'].includes(p.status) && <button className="btn-quiet btn-sm" onClick={() => doRefund(p)}><Undo2 className="h-3.5 w-3.5" /> Refund</button>}
                    </span>
                    {p.refunds?.map((r, i) => <p key={i} className="w-full text-xs text-ink-muted">Refund {inr2(r.amount)} · {r.reason} · <StatusBadge status={r.status} /></p>)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {reasonDialog}
    </Drawer>
  );
}

// ------------------------------------------------------------------ Pages

export function Invoices({ gst, title, readOnly }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['invoices', status, q, page, gst], queryFn: () => api.get('/billing/invoices', { params: { status: status || undefined, q: q || undefined, page, gst: gst ? 'true' : undefined } }).then(unwrapPage) });
  return (
    <div>
      <PageHeader title={title || (gst ? 'GST invoices' : 'Invoices')}
        description={gst ? 'Tax invoices with GST charged — your clinic GSTIN is stamped at issue.' : readOnly ? 'Payment status for patients\' visits.' : 'Bills for visits and services. Open one to collect payment, refund or download.'}
        actions={<>
          {canPay(user?.role) && <button className="btn-ghost" onClick={() => downloadCsv('/billing/export/invoices.csv', 'invoices.csv').catch((e) => toast.error(e.message))}><FileSpreadsheet className="h-4 w-4" /> Export</button>}
          {!readOnly && canPay(user?.role) && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New invoice</button>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="field-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED', 'VOID'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        <input className="field-sm" placeholder="Invoice number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search invoice number" />
      </div>
      <DataTable loading={list.isLoading} error={list.error} onRetry={list.refetch} rows={list.data?.data} onRowClick={(r) => setOpen(r._id)}
        empty={<EmptyState title="No invoices yet" body="Create one from a visit — fees and GST fill in automatically." />}
        columns={[
          { key: 'no', header: 'Invoice', render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span> },
          { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name },
          { key: 'date', header: 'Date', sort: (r) => r.createdAt, render: (r) => date(r.createdAt) },
          ...(gst ? [{ key: 'gst', header: 'GST', render: (r) => inr2(r.gstAmount) }] : []),
          { key: 'total', header: 'Total', sort: (r) => r.total, render: (r) => inr2(r.total) },
          { key: 'due', header: 'Balance', hideOnMobile: true, render: (r) => inr2(r.total - r.amountPaid) },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      <Pagination meta={list.data?.meta} page={page} onPage={setPage} />
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
      {creating && <NewInvoice onClose={(inv) => { setCreating(false); if (inv) setOpen(inv._id); }} />}
    </div>
  );
}

export function Payments({ mode = 'payments' }) {
  const [page, setPage] = useState(1);
  const params = { page, ...(mode === 'receipts' ? { status: 'SUCCESS,PARTIALLY_REFUNDED,REFUNDED' } : {}), ...(mode === 'refunds' ? { refunds: 'true' } : {}) };
  const list = useQuery({ queryKey: ['payments', mode, page], queryFn: () => api.get('/billing/payments', { params }).then(unwrapPage) });
  const T = { payments: ['Payments', 'Every payment attempt — desk and online — with its verification state.'], receipts: ['Receipts', 'Receipts for settled payments. Numbers are sequential per year.'], refunds: ['Refunds', 'Payments with refunds issued or pending at the gateway.'] }[mode];
  return (
    <div>
      <PageHeader title={T[0]} description={T[1]} actions={<button className="btn-ghost" onClick={() => downloadCsv('/billing/export/payments.csv', 'payments.csv').catch((e) => toast.error(e.message))}><FileSpreadsheet className="h-4 w-4" /> Export</button>} />
      <DataTable loading={list.isLoading} error={list.error} rows={list.data?.data} empty={<EmptyState title={`No ${mode} yet`} />} columns={[
        { key: 'when', header: 'When', sort: (p) => p.createdAt, render: (p) => dateTime(p.verifiedAt || p.createdAt) },
        { key: 'patient', header: 'Patient', render: (p) => p.patientId?.name },
        { key: 'inv', header: 'Invoice', hideOnMobile: true, render: (p) => <span className="font-mono text-xs">{p.invoiceId?.invoiceNumber}</span> },
        { key: 'method', header: 'Method', hideOnMobile: true, render: (p) => `${titleCase(p.method)}${p.gateway === 'RAZORPAY' ? ' · Razorpay' : ''}` },
        { key: 'amt', header: 'Amount', sort: (p) => p.amount, render: (p) => inr2(p.amount) },
        ...(mode === 'refunds' ? [{ key: 'ref', header: 'Refunded', render: (p) => <div>{inr2(p.refundedAmount)}{p.refunds.map((r, i) => <p key={i} className="text-xs text-ink-muted">{inr2(r.amount)} · {r.status.toLowerCase()} · {r.reason}</p>)}</div> }] : []),
        { key: 'status', header: 'Status', render: (p) => <div><StatusBadge status={p.status} />{p.failureReason && <p className="text-xs text-ink-muted">{p.failureReason}</p>}</div> },
        { key: 'r', header: '', render: (p) => p.receiptNumber && pdf('receipt', p._id, p.receiptNumber) },
      ]} />
      <Pagination meta={list.data?.meta} page={page} onPage={setPage} />
    </div>
  );
}

export function Outstanding() {
  const [open, setOpen] = useState(null);
  const d = useQuery({ queryKey: ['invoices', 'outstanding'], queryFn: () => api.get('/billing/outstanding').then(unwrap) });
  return (
    <div>
      <PageHeader title="Outstanding dues" description={d.data ? `${d.data.count} invoices · ${inr2(d.data.total)} to collect` : 'Unpaid and part-paid invoices, oldest first.'} />
      <DataTable loading={d.isLoading} error={d.error} rows={d.data?.items} onRowClick={(r) => setOpen(r._id)} empty={<EmptyState title="Nothing outstanding" body="Every invoice is settled." />} columns={[
        { key: 'no', header: 'Invoice', render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span> },
        { key: 'patient', header: 'Patient', render: (r) => <div><p>{r.patientId?.name}</p><p className="font-mono text-xs text-ink-muted">{r.patientId?.phone}</p></div> },
        { key: 'age', header: 'Age', sort: (r) => r.ageDays, render: (r) => <span className={r.ageDays > 30 ? 'text-alert' : ''}>{r.ageDays} days</span> },
        { key: 'bal', header: 'Balance', sort: (r) => r.balance, render: (r) => <b>{inr2(r.balance)}</b> },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <InvoiceDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function Reconciliation() {
  const d = useQuery({ queryKey: ['finance', 'recon'], queryFn: () => api.get('/billing/reconciliation').then(unwrap) });
  const cols = [
    { key: 'when', header: 'Created', render: (p) => dateTime(p.createdAt) },
    { key: 'order', header: 'Gateway order', render: (p) => <span className="font-mono text-xs">{p.gatewayOrderId || '—'}</span> },
    { key: 'inv', header: 'Invoice', render: (p) => p.invoiceId?.invoiceNumber },
    { key: 'amt', header: 'Amount', render: (p) => inr2(p.amount) },
    { key: 'st', header: 'Status', render: (p) => <div><StatusBadge status={p.status} />{p.failureReason && <p className="text-xs text-ink-muted">{p.failureReason}</p>}</div> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Reconciliation" description="Gateway payments that need a human look. Nothing here is marked paid until Razorpay confirms it." />
      {d.data && !d.data.gatewayConfigured && <p className="rounded-lg border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-signal">Razorpay is not configured on the server, so online payments are disabled. Desk payments work normally.</p>}
      <Section title="Started but never confirmed (30+ minutes)"><DataTable loading={d.isLoading} rows={d.data?.unconfirmed} columns={cols} empty={<EmptyState title="None" />} /></Section>
      <Section title="Failed payments"><DataTable loading={d.isLoading} rows={d.data?.failed} columns={cols} empty={<EmptyState title="None" />} /></Section>
      <Section title="Refunds pending at the gateway"><DataTable loading={d.isLoading} rows={d.data?.pendingRefunds} columns={cols.filter((c) => c.key !== 'inv')} empty={<EmptyState title="None" />} /></Section>
    </div>
  );
}

function useSummary(range) {
  return useQuery({ queryKey: ['finance', 'summary', range], queryFn: () => api.get('/billing/reports/summary', { params: range }).then(unwrap) });
}

export function FinanceReports() {
  const [range, setRange] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') });
  const s = useSummary(range);
  const d = s.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Financial reports" description="Collections by day, method and service for any range." actions={<>
        <button className="btn-ghost" onClick={() => downloadCsv('/billing/export/payments.csv', 'payments.csv').catch((e) => toast.error(e.message))}><FileSpreadsheet className="h-4 w-4" /> Payments CSV</button>
        <button className="btn-ghost" onClick={() => downloadCsv(`/billing/export/invoices.csv?from=${range.from}&to=${range.to}`, 'invoices.csv').catch((e) => toast.error(e.message))}><FileSpreadsheet className="h-4 w-4" /> Invoices CSV</button>
      </>} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-ink-muted">From<input type="date" className="field-sm mt-1 block" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="text-xs text-ink-muted">To<input type="date" className="field-sm mt-1 block" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        {[['This month', dayjs().startOf('month'), dayjs()], ['Last month', dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')], ['Last 7 days', dayjs().subtract(6, 'day'), dayjs()]].map(([l, a, b]) => (
          <button key={l} className="btn-ghost btn-sm" onClick={() => setRange({ from: a.format('YYYY-MM-DD'), to: b.format('YYYY-MM-DD') })}>{l}</button>
        ))}
      </div>
      <KpiGrid>
        <KpiCard icon={IndianRupee} label="Collected" value={d?.collected} format={inr} />
        <KpiCard icon={Undo2} tone="red" label="Refunded" value={d?.refunded} format={inr} />
        <KpiCard icon={Receipt} tone="navy" label="Net" value={d?.net} format={inr} />
        <KpiCard icon={Percent} tone="amber" label="GST invoiced" value={d?.gstCollected} format={inr} hint={d ? `${d.invoiceCount} invoices · ${inr(d.invoiced)} billed` : undefined} />
      </KpiGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Daily collections"><RevenueChart data={d?.byDay?.map((x) => ({ date: x.date, revenue: x.amount }))} loading={s.isLoading} /></Section>
        <Section title="By payment method">
          {s.isLoading ? <Skeleton className="h-64" /> : !d?.byMethod?.length ? <p className="muted py-20 text-center">No collections in this range.</p> : (
            <div className="h-64"><ResponsiveContainer><BarChart data={d.byMethod}><CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} /><XAxis dataKey="method" tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => inr(v)} /><Tooltip formatter={(v) => inr(v)} contentStyle={CHART.tooltip} /><Bar dataKey="amount" fill={CHART.navy} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          )}
        </Section>
      </div>
      <Section title="Service-wise billing">
        <DataTable loading={s.isLoading} rows={d?.byService} rowKey={(r) => r.service} empty={<EmptyState title="No invoices in this range" />} columns={[
          { key: 'service', header: 'Item' }, { key: 'count', header: 'Qty', sort: (r) => r.count }, { key: 'amount', header: 'Billed', sort: (r) => r.amount, render: (r) => inr2(r.amount) },
        ]} />
      </Section>
    </div>
  );
}

export function FinanceOverview() {
  const s = useSummary({});
  const out = useQuery({ queryKey: ['invoices', 'outstanding'], queryFn: () => api.get('/billing/outstanding').then(unwrap) });
  const recon = useQuery({ queryKey: ['finance', 'recon'], queryFn: () => api.get('/billing/reconciliation').then(unwrap) });
  const today = s.data?.byDay?.find((x) => x.date === dayjs().format('YYYY-MM-DD'));
  return (
    <div className="space-y-6">
      <PageHeader title="Financial overview" description={`${dayjs().format('MMMM YYYY')} to date`} />
      <KpiGrid>
        <KpiCard icon={IndianRupee} label="Collected today" value={today?.amount ?? 0} format={inr} hint={`${today?.count || 0} payments`} />
        <KpiCard icon={Receipt} tone="navy" label="This month (net)" value={s.data?.net} format={inr} hint={s.data ? `${inr(s.data.refunded)} refunded` : undefined} />
        <KpiCard icon={AlertCircle} tone="amber" label="Outstanding" value={out.data?.total} format={inr} hint={out.data ? `${out.data.count} invoices` : undefined} />
        <KpiCard icon={Undo2} tone="red" label="Needs attention" value={recon.data ? recon.data.unconfirmed.length + recon.data.failed.length + recon.data.pendingRefunds.length : null} hint="Unconfirmed, failed, pending refunds" />
      </KpiGrid>
      <Section title="Collections this month"><RevenueChart data={s.data?.byDay?.map((x) => ({ date: x.date, revenue: x.amount }))} loading={s.isLoading} /></Section>
      <Outstanding />
    </div>
  );
}

/** Owner's single billing page. */
export function BillingHub() {
  const [tab, setTab] = useState('invoices');
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'invoices', label: 'Invoices' }, { value: 'payments', label: 'Payments' }, { value: 'outstanding', label: 'Outstanding' }, { value: 'reports', label: 'Reports' }, { value: 'recon', label: 'Reconciliation' }]} />
      {tab === 'invoices' && <Invoices title="Billing and payments" />}
      {tab === 'payments' && <Payments />}
      {tab === 'outstanding' && <Outstanding />}
      {tab === 'reports' && <FinanceReports />}
      {tab === 'recon' && <Reconciliation />}
    </div>
  );
}
