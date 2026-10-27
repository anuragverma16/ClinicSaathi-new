import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  CalendarCheck, Users, Clock, IndianRupee, AlertCircle, UserX, BellRing, CalendarPlus, UserPlus, Stethoscope, Settings, ExternalLink, Repeat, QrCode,
} from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { onSocket } from '../../lib/socket.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { KpiCard, KpiGrid } from '../../components/ui/KpiCard.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge } from '../../components/ui/StatusBadge.jsx';
import { EmptyState } from '../../components/ui/States.jsx';
import { PageHeader, Section } from '../../components/ui/Page.jsx';
import { RevenueChart, AppointmentsChart, useAnalytics } from './Analytics.jsx';
import { BranchReport } from './Branches.jsx';
import { QRCodeDisplay } from '../../components/clinic/QRCodeDisplay.jsx';
import { inr, time } from '../../lib/format.js';

function TodayTable({ link }) {
  const today = useQuery({ queryKey: ['appointments', 'dash-today'], queryFn: () => api.get('/appointments', { params: { date: dayjs().format('YYYY-MM-DD') } }).then(unwrap) });
  return (
    <Section title="Today's appointments" actions={<Link to={link} className="text-sm font-medium text-pulse-deep hover:underline">Open appointments</Link>}>
      <DataTable loading={today.isLoading} error={today.error} onRetry={today.refetch} rows={today.data}
        empty={<EmptyState title="No appointments today" body="Bookings from your website, WhatsApp, the portal or the front desk land here." />}
        columns={[
          { key: 'time', header: 'Time', render: (r) => <span className="font-mono text-sm">{time(r.startAt)}</span> },
          { key: 'patient', header: 'Patient', render: (r) => r.patientId?.name || '—' },
          { key: 'doctor', header: 'Doctor', hideOnMobile: true, render: (r) => r.doctorId?.name || '—' },
          { key: 'for', header: 'For', hideOnMobile: true, render: (r) => r.serviceId?.name || r.reason || 'Consultation' },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
    </Section>
  );
}

function OverviewKpis({ o }) {
  return (
    <KpiGrid>
      <KpiCard icon={CalendarCheck} label="Today's appointments" value={o?.todayAppointments} hint={o ? `${o.completedAppointments} done · ${o.pendingAppointments} to come · ${o.upcomingAppointments} later` : undefined} />
      <KpiCard icon={Clock} tone="amber" label="Waiting now" value={o?.waitingPatients} hint={o ? `${o.inClinic} in clinic` : undefined} />
      <KpiCard icon={IndianRupee} tone="navy" label="Collected today" value={o?.todayRevenue} format={inr} hint={o ? `${inr(o.monthlyRevenue)} this month` : undefined} />
      <KpiCard icon={AlertCircle} tone="red" label="Outstanding" value={o?.outstandingAmount} format={inr} hint={o ? `${o.pendingPayments} unpaid invoices` : undefined} />
      <KpiCard icon={UserX} tone="red" label="No-shows today" value={o?.noShows} hint={o ? `${o.cancelled} cancelled` : undefined} />
      <KpiCard icon={Users} label="New patients today" value={o?.newPatients} hint={o ? `${o.returningPatients} returning on file` : undefined} />
      <KpiCard icon={BellRing} tone="amber" label="Follow-ups due" value={o?.followUpsDue} />
      <KpiCard icon={Repeat} tone="navy" label="Recalls due" value={o?.recallDue} hint={o ? `${o.reviewRequests} review requests this month` : undefined} />
    </KpiGrid>
  );
}

export default function OwnerDashboard() {
  const qc = useQueryClient();
  const { clinic, hasFeature, user } = useAuth();
  const [showQR, setShowQR] = useState(false);
  const overview = useQuery({ queryKey: ['clinic', 'overview'], queryFn: () => api.get('/clinics/overview').then(unwrap), refetchInterval: 60_000 });
  const reports = hasFeature('reports');
  const analytics = useAnalytics({}, reports);
  useEffect(() => onSocket(['appointment:created', 'appointment:updated', 'queue:updated', 'payment:received'], () => {
    qc.invalidateQueries({ queryKey: ['clinic', 'overview'] }); qc.invalidateQueries({ queryKey: ['appointments', 'dash-today'] });
  }), [qc]);
  const needsSetup = !clinic?.onboarding?.completed;

  return (
    <div className="space-y-6">
      <PageHeader title={`Good ${dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] || ''}`}
        description={`${dayjs().format('dddd, D MMMM')} · ${clinic?.name || ''}`}
        actions={<>
          <button onClick={() => setShowQR(true)} className="btn-ghost"><QrCode className="h-4 w-4" /> Patient QR</button>
          <a href={`/book/${clinic?.slug}`} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink className="h-4 w-4" /> Booking page</a>
          <Link to="/clinic/appointments" className="btn-primary"><CalendarPlus className="h-4 w-4" /> New appointment</Link>
        </>} />

      {needsSetup && (
        <Section title="Finish setting up your clinic">
          <div className="grid gap-3 sm:grid-cols-4">
            {[[Settings, 'Clinic profile & booking rules', '/clinic/settings'], [Stethoscope, 'Add doctors and hours', '/clinic/doctors'], [UserPlus, 'Invite your staff', '/clinic/staff'], [CalendarPlus, 'Add services and fees', '/clinic/services']].map(([Icon, label, to]) => (
              <Link key={to} to={to} className="flex items-center gap-2 rounded-lg border border-line p-3 text-sm hover:border-pulse hover:bg-pulse-soft/40"><Icon className="h-4 w-4 text-pulse" /> {label}</Link>
            ))}
          </div>
        </Section>
      )}

      <OverviewKpis o={overview.data} />

      {reports ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Collections · last 30 days" actions={<Link to="/clinic/analytics" className="text-sm text-pulse-deep hover:underline">Analytics</Link>}>
            <RevenueChart data={analytics.data?.charts?.revenueByDay} loading={analytics.isLoading} />
          </Section>
          <Section title="Appointments · last 30 days">
            <AppointmentsChart data={analytics.data?.charts?.appointmentsByDay?.map((d) => ({ ...d, other: d.total - d.completed - d.noShow }))} loading={analytics.isLoading} />
          </Section>
        </div>
      ) : (
        <Section><p className="muted">Charts and trend analytics are on the Growth plan and above. <Link to="/clinic/subscription" className="text-pulse-deep hover:underline">See plans</Link></p></Section>
      )}
      <TodayTable link="/clinic/appointments" />

      {showQR && (
        <QRCodeDisplay
          clinicId={clinic?._id}
          branchId={clinic?.branches?.[0]?._id}
          clinicName={clinic?.name}
          branchName={clinic?.branches?.[0]?.name || 'Main'}
          onClose={() => setShowQR(false)}
        />
      )}
    </div>
  );
}

export function BranchDashboard() {
  const { user, clinic } = useAuth();
  const [showQR, setShowQR] = useState(false);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap) });
  const overview = useQuery({ queryKey: ['clinic', 'overview'], queryFn: () => api.get('/clinics/overview').then(unwrap), refetchInterval: 60_000 });
  const branch = branches.data?.find((b) => String(b._id) === String(user?.branchId)) || branches.data?.[0];
  return (
    <div className="space-y-6">
      <PageHeader title={branch ? `${branch.name} branch` : 'Branch overview'} description={`${dayjs().format('dddd, D MMMM')} · figures for your branch only`}
        actions={<>
          <button onClick={() => setShowQR(true)} className="btn-ghost"><QrCode className="h-4 w-4" /> Patient QR</button>
          <Link to="/clinic/branch/queue" className="btn-primary">Open queue</Link>
        </>} />
      <OverviewKpis o={overview.data} />
      <Section title="Branch performance · last 30 days"><BranchReport /></Section>
      <TodayTable link="/clinic/branch/appointments" />

      {showQR && (
        <QRCodeDisplay
          clinicId={clinic?._id}
          branchId={branch?._id}
          clinicName={clinic?.name}
          branchName={branch?.name || 'Main'}
          onClose={() => setShowQR(false)}
        />
      )}
    </div>
  );
}
