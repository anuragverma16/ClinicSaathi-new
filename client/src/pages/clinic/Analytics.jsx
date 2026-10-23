import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CalendarCheck, XCircle, UserX, Clock, IndianRupee, AlertCircle, Users, Repeat, MessageCircle, Star, HeartHandshake, RefreshCcw } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section } from '../../components/ui/Page.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { Skeleton, ErrorState } from '../../components/ui/States.jsx';
import { CHART } from '../../lib/chart.js';
import { inr } from '../../lib/format.js';

function ChartBox({ loading, empty, children, height = 'h-64' }) {
  if (loading) return <Skeleton className={height} />;
  if (empty) return <div className={`${height} flex items-center justify-center text-sm text-ink-muted`}>No data in this range yet.</div>;
  return <div className={height}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}
const axis = { tick: { fontSize: 11, fill: CHART.axis }, tickLine: false, axisLine: false };

const SOURCE_LABEL = {
  WEBSITE: 'Website', BOOKING_LINK: 'Booking link', QR: 'QR code', WHATSAPP: 'WhatsApp', GOOGLE: 'Google', FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram', SOCIAL: 'Social', RECEPTION: 'Reception', WALK_IN: 'Walk-in', PHONE: 'Phone', PORTAL: 'Patient portal', AI_ASSISTANT: 'AI assistant',
};

export function useAnalytics(filters, enabled = true) {
  return useQuery({ queryKey: ['analytics', filters], queryFn: () => api.get('/analytics/overview', { params: filters }).then(unwrap), enabled });
}

export function RevenueChart({ data, loading }) {
  return (
    <ChartBox loading={loading} empty={!data?.length}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d) => dayjs(d).format('D MMM')} />
        <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} width={48} />
        <Tooltip formatter={(v) => inr(v)} labelFormatter={(d) => dayjs(d).format('DD MMM YYYY')} contentStyle={CHART.tooltip} />
        <Line type="monotone" dataKey="revenue" name="Collected" stroke={CHART.teal} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ChartBox>
  );
}

export function AppointmentsChart({ data, loading }) {
  return (
    <ChartBox loading={loading} empty={!data?.length}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d) => dayjs(d).format('D MMM')} />
        <YAxis {...axis} allowDecimals={false} width={32} />
        <Tooltip contentStyle={CHART.tooltip} labelFormatter={(d) => dayjs(d).format('DD MMM YYYY')} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="completed" name="Completed" stackId="a" fill={CHART.teal} radius={[0, 0, 0, 0]} />
        <Bar dataKey="noShow" name="No-show" stackId="a" fill={CHART.red} />
        <Bar dataKey="other" name="Other" stackId="a" fill={CHART.navy} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartBox>
  );
}

export default function Analytics({ title = 'Analytics', fixedBranch }) {
  const { user } = useAuth();
  const [f, setF] = useState({ from: dayjs().subtract(29, 'day').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), branchId: '', doctorId: '', serviceId: '' });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const a = useAnalytics(params);
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: () => api.get('/doctors').then(unwrap), enabled: user?.role !== 'ACCOUNTANT' });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api.get('/services').then(unwrap) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap), enabled: !fixedBranch && user?.role === 'CLINIC_OWNER' });
  const k = a.data?.kpis;
  const apptsByDay = a.data?.charts?.appointmentsByDay?.map((d) => ({ ...d, other: d.total - d.completed - d.noShow }));

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Every figure is calculated from your clinic's records for the selected range." />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs text-ink-muted">From<input type="date" className="field-sm mt-1 block" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-xs text-ink-muted">To<input type="date" className="field-sm mt-1 block" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        {branches.data?.length > 0 && (
          <label className="text-xs text-ink-muted">Branch<select className="field-sm mt-1 block" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">All branches</option>{branches.data.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</select></label>
        )}
        {doctors.data && (
          <label className="text-xs text-ink-muted">Doctor<select className="field-sm mt-1 block" value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}><option value="">All doctors</option>{doctors.data.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>
        )}
        <label className="text-xs text-ink-muted">Service<select className="field-sm mt-1 block" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}><option value="">All services</option>{services.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
      </div>

      {a.error && <div className="card"><ErrorState error={a.error} onRetry={a.refetch} /></div>}

      <KpiGrid>
        <KpiCard icon={IndianRupee} label="Collected" value={k?.revenue} format={inr} />
        <KpiCard icon={AlertCircle} tone="amber" label="Outstanding" value={k?.outstanding} format={inr} hint={k ? `${k.outstandingInvoices} invoices` : undefined} />
        {k?.totalAppointments !== undefined && <>
          <KpiCard icon={CalendarCheck} tone="navy" label="Appointments" value={k.totalAppointments} hint={`${k.completed} completed · ${k.upcoming} upcoming`} />
          <KpiCard icon={UserX} tone="red" label="No-show rate" value={k.noShowRate} suffix="%" hint={`${k.noShows} no-shows`} />
          <KpiCard icon={XCircle} tone="red" label="Cancellation rate" value={k.cancellationRate} suffix="%" hint={`${k.cancelled} cancelled`} />
          <KpiCard icon={Clock} tone="amber" label="Avg. wait" value={k.avgWaitMins} suffix=" min" hint="Check-in to called" />
          <KpiCard icon={Users} label="New / returning" value={`${k.newPatients} / ${k.returningPatients}`} hint={`${k.totalPatients} patients on file`} />
          <KpiCard icon={Repeat} tone="navy" label="Follow-up conversion" value={k.followUpConversion} suffix="%" hint={`${k.followUps} follow-ups · recall ${k.recallConversion}%`} />
          <KpiCard icon={MessageCircle} label="Messages delivered" value={k.messageDeliveryRate} suffix="%" hint={`${k.messagesSent} sent · ${k.messageFailureRate}% failed`} />
          <KpiCard icon={Star} tone="amber" label="Review requests" value={k.reviewRequests} />
          <KpiCard icon={RefreshCcw} tone="navy" label="Repeat patient rate" value={k.repeatPatientRate} suffix="%" hint="Seen more than once in range" />
          <KpiCard icon={HeartHandshake} label="Patient retention" value={k.retentionRate} suffix={k.retentionRate == null ? '' : '%'} hint={k.retentionRate == null ? 'No visits in the previous period' : `${k.retainedPatients} came back from last period`} />
        </>}
      </KpiGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Daily collections"><RevenueChart data={a.data?.charts?.revenueByDay} loading={a.isLoading} /></Section>
        {apptsByDay && <Section title="Appointments by day"><AppointmentsChart data={apptsByDay} loading={a.isLoading} /></Section>}
        <Section title="Revenue by service">
          <ChartBox loading={a.isLoading} empty={!a.data?.charts?.revenueByService?.length}>
            <BarChart data={a.data?.charts?.revenueByService} layout="vertical" margin={{ left: 8 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="service" width={140} {...axis} tick={{ fontSize: 12, fill: CHART.axis }} />
              <Tooltip formatter={(v) => inr(v)} contentStyle={CHART.tooltip} />
              <Bar dataKey="revenue" fill={CHART.navy} radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ChartBox>
        </Section>
        <Section title="Monthly revenue (last 12 months)">
          <ChartBox loading={a.isLoading} empty={!a.data?.charts?.revenueByMonth?.length}>
            <BarChart data={a.data?.charts?.revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="month" {...axis} tickFormatter={(m) => dayjs(`${m}-01`).format('MMM')} />
              <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} width={48} />
              <Tooltip formatter={(v) => inr(v)} labelFormatter={(m) => dayjs(`${m}-01`).format('MMMM YYYY')} contentStyle={CHART.tooltip} />
              <Bar dataKey="revenue" name="Revenue" fill={CHART.teal} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartBox>
        </Section>
        {a.data?.charts?.bookingsBySource && (
          <Section title="Bookings by channel">
            <ChartBox loading={a.isLoading} empty={!a.data.charts.bookingsBySource.length}>
              <BarChart data={a.data.charts.bookingsBySource.map((b) => ({ ...b, label: SOURCE_LABEL[b.source] || b.source }))} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={120} {...axis} tick={{ fontSize: 12, fill: CHART.axis }} />
                <Tooltip contentStyle={CHART.tooltip} />
                <Bar dataKey="count" name="Bookings" fill={CHART.amber} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ChartBox>
          </Section>
        )}
        {a.data?.charts?.topDoctors && (
          <Section title="Top performing doctors">
            <ChartBox loading={a.isLoading} empty={!a.data.charts.topDoctors.length}>
              <BarChart data={a.data.charts.topDoctors} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fontSize: 12, fill: CHART.axis }} />
                <Tooltip contentStyle={CHART.tooltip} />
                <Bar dataKey="consultations" name="Consultations" fill={CHART.navy} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ChartBox>
          </Section>
        )}
        {a.data?.charts?.reviewRequestsByMonth && (
          <Section title="Google review requests sent">
            <ChartBox loading={a.isLoading} empty={!a.data.charts.reviewRequestsByMonth.length}>
              <LineChart data={a.data.charts.reviewRequestsByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="month" {...axis} tickFormatter={(m) => dayjs(`${m}-01`).format('MMM')} />
                <YAxis {...axis} allowDecimals={false} width={32} />
                <Tooltip contentStyle={CHART.tooltip} labelFormatter={(m) => dayjs(`${m}-01`).format('MMMM YYYY')} />
                <Line type="monotone" dataKey="count" name="Review requests" stroke={CHART.amber} strokeWidth={2.5} />
              </LineChart>
            </ChartBox>
          </Section>
        )}
        {a.data?.charts?.utilisation && (
          <Section title="Doctor utilisation">
            <DataTable loading={a.isLoading} rows={a.data.charts.utilisation} rowKey={(r) => r.doctorId} columns={[
              { key: 'name', header: 'Doctor' },
              { key: 'booked', header: 'Seen (hrs)', render: (r) => (r.bookedMins / 60).toFixed(1) },
              { key: 'avail', header: 'Scheduled (hrs)', render: (r) => (r.availableMins / 60).toFixed(1) },
              { key: 'u', header: 'Utilisation', sort: (r) => r.utilisation, render: (r) => (
                <div className="flex items-center gap-2"><div className="h-2 w-20 rounded-full bg-paper-sunk"><div className="h-2 rounded-full bg-pulse" style={{ width: `${Math.min(100, r.utilisation)}%` }} /></div>{r.utilisation}%</div>
              ) },
            ]} />
          </Section>
        )}
      </div>
    </div>
  );
}
