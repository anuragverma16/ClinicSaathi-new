
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  CalendarCheck, Users, Clock, IndianRupee, AlertCircle, UserX,
  BellRing, CalendarPlus, UserPlus, Stethoscope, Settings, ExternalLink,
  Repeat, QrCode, FlaskConical, GitBranch, Calculator, ClipboardCheck,
  ChevronDown,
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
import { ROLE_LABEL } from '../../routes/nav.js';
import { inr, time } from '../../lib/format.js';

const ADD_ROLES = [
  ['DOCTOR', Stethoscope, 'Schedule, queue, notes and prescriptions'],
  ['LAB_TECHNICIAN', FlaskConical, 'Lab worklist and result uploads'],
  ['BRANCH_MANAGER', GitBranch, 'Runs one branch end to end'],
  ['ACCOUNTANT', Calculator, 'Invoices, payments and GST'],
  ['RECEPTIONIST', ClipboardCheck, 'Bookings, check-in and waiting queue'],
];

function AddStaffMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        setPos({
          top: r.bottom + 8,
          right: Math.max(8, window.innerWidth - r.right),
        });
      }
    };

    place();

    const onDown = (e) => {
      if (
        !btnRef.current?.contains(e.target) &&
        !menuRef.current?.contains(e.target)
      ) setOpen(false);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <UserPlus className="h-4 w-4" />
        Add staff
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-72 rounded-card border border-line bg-surface p-1 shadow-lift"
        >
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Create a login for
          </p>

          {ADD_ROLES.map(([role, Icon, help]) => (
            <Link
              key={role}
              role="menuitem"
              to={`/clinic/staff?add=${role}`}
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-paper-sunk"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  {ROLE_LABEL[role]}
                </span>
                <span className="block text-xs leading-snug text-ink-muted">
                  {help}
                </span>
              </span>
            </Link>
          ))}

          <hr className="my-1 border-line" />

          <Link
            to="/clinic/staff"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunk"
          >
            <Users className="h-4 w-4 text-ink-muted" />
            Manage all staff
          </Link>
        </div>,
        document.body
      )}
    </>
  );
}

function TodayTable({ link }) {
  const today = useQuery({
    queryKey: ['appointments', 'dash-today'],
    queryFn: () =>
      api.get('/appointments', {
        params: { date: dayjs().format('YYYY-MM-DD') },
      }).then(unwrap),
  });

  return (
    <Section
      title="Today's appointments"
      actions={
        <Link to={link} className="text-sm font-medium text-pulse-deep hover:underline">
          Open appointments
        </Link>
      }
    >
      <DataTable
        loading={today.isLoading}
        error={today.error}
        onRetry={today.refetch}
        rows={today.data}
        empty={
          <EmptyState
            title="No appointments today"
            body="Bookings from your website, WhatsApp, the portal or the front desk land here."
          />
        }
        columns={[
          {
            key: 'time',
            header: 'Time',
            render: (r) => <span className="font-mono text-sm">{time(r.startAt)}</span>,
          },
          {
            key: 'patient',
            header: 'Patient',
            render: (r) => r.patientId?.name || '—',
          },
          {
            key: 'doctor',
            header: 'Doctor',
            hideOnMobile: true,
            render: (r) => r.doctorId?.name || '—',
          },
          {
            key: 'for',
            header: 'For',
            hideOnMobile: true,
            render: (r) => r.serviceId?.name || r.reason || 'Consultation',
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => <StatusBadge status={r.status} />,
          },
        ]}
      />
    </Section>
  );
}

function OverviewKpis({ o }) {
  return (
    <KpiGrid>
      <KpiCard
        icon={CalendarCheck}
        label="Today's appointments"
        value={o?.todayAppointments}
        hint={o ? `${o.completedAppointments} done · ${o.pendingAppointments} to come · ${o.upcomingAppointments} later` : undefined}
      />
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

function BranchLoadingModal({ onClose, retry }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-ink">Patient Registration QR</h2>
        <p className="mt-3 text-sm text-ink-muted">
          Loading clinic branch details...
        </p>
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          {retry && (
            <button type="button" className="btn-primary" onClick={retry}>Retry</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const qc = useQueryClient();
  const { clinic, hasFeature, user } = useAuth();
  const [showQR, setShowQR] = useState(false);

  const branches = useQuery({
    queryKey: ['clinic', 'branches'],
    queryFn: () => api.get('/clinics/branches').then(unwrap),
    enabled: Boolean(clinic?._id),
  });

  const activeBranch =
    branches.data?.find((b) => b.isActive !== false) ||
    branches.data?.[0];

  const overview = useQuery({
    queryKey: ['clinic', 'overview'],
    queryFn: () => api.get('/clinics/overview').then(unwrap),
    refetchInterval: 60_000,
  });

  const reports = hasFeature('reports');
  const analytics = useAnalytics({}, reports);

  useEffect(
    () => onSocket(
      ['appointment:created', 'appointment:updated', 'queue:updated', 'payment:received'],
      () => {
        qc.invalidateQueries({ queryKey: ['clinic', 'overview'] });
        qc.invalidateQueries({ queryKey: ['appointments', 'dash-today'] });
      }
    ),
    [qc]
  );

  const needsSetup = !clinic?.onboarding?.completed;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good ${dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'}, ${user?.name?.split(' ')[0] || ''}`}
        description={`${dayjs().format('dddd, D MMMM')} · ${clinic?.name || ''}`}
        actions={
          <>
            <AddStaffMenu />

            <button
              type="button"
              onClick={() => setShowQR(true)}
              className="btn-ghost"
            >
              <QrCode className="h-4 w-4" />
              Patient QR
            </button>

            <a
              href={`/book/${clinic?.slug}`}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
            >
              <ExternalLink className="h-4 w-4" />
              Booking page
            </a>

            <Link to="/clinic/appointments" className="btn-primary">
              <CalendarPlus className="h-4 w-4" />
              New appointment
            </Link>
          </>
        }
      />

      {needsSetup && (
        <Section title="Finish setting up your clinic">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              [Settings, 'Clinic profile & booking rules', '/clinic/settings'],
              [Stethoscope, 'Add doctors and hours', '/clinic/doctors'],
              [UserPlus, 'Invite your staff', '/clinic/staff'],
              [CalendarPlus, 'Add services and fees', '/clinic/services'],
            ].map(([Icon, label, to]) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-2 rounded-lg border border-line p-3 text-sm hover:border-pulse hover:bg-pulse-soft/40"
              >
                <Icon className="h-4 w-4 text-pulse" />
                {label}
              </Link>
            ))}
          </div>
        </Section>
      )}

      <OverviewKpis o={overview.data} />

      {reports ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section
            title="Collections · last 30 days"
            actions={
              <Link to="/clinic/analytics" className="text-sm text-pulse-deep hover:underline">
                Analytics
              </Link>
            }
          >
            <RevenueChart data={analytics.data?.charts?.revenueByDay} loading={analytics.isLoading} />
          </Section>

          <Section title="Appointments · last 30 days">
            <AppointmentsChart
              data={analytics.data?.charts?.appointmentsByDay?.map((d) => ({
                ...d,
                other: d.total - d.completed - d.noShow,
              }))}
              loading={analytics.isLoading}
            />
          </Section>
        </div>
      ) : (
        <Section>
          <p className="muted">
            Charts and trend analytics are on the Growth plan and above.{' '}
            <Link to="/clinic/subscription" className="text-pulse-deep hover:underline">
              See plans
            </Link>
          </p>
        </Section>
      )}

      <TodayTable link="/clinic/appointments" />

      {showQR && (
        branches.isLoading ? (
          <BranchLoadingModal onClose={() => setShowQR(false)} />
        ) : branches.isError ? (
          <BranchLoadingModal
            onClose={() => setShowQR(false)}
            retry={() => branches.refetch()}
          />
        ) : activeBranch ? (
          <QRCodeDisplay
            clinicSlug={clinic?.slug}
            branchId={activeBranch._id}
            clinicName={clinic?.name}
            branchName={activeBranch.name || 'Main'}
            onClose={() => setShowQR(false)}
          />
        ) : (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-ink">No clinic branch found</h2>
              <p className="mt-2 text-sm text-ink-muted">
                Create or activate a branch before generating the Patient QR.
              </p>
              <div className="mt-5 flex gap-2">
                <Link to="/clinic/branches" className="btn-primary">Manage branches</Link>
                <button type="button" className="btn-ghost" onClick={() => setShowQR(false)}>Close</button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function BranchDashboard() {
  const { user, clinic } = useAuth();
  const [showQR, setShowQR] = useState(false);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/clinics/branches').then(unwrap),
  });

  const overview = useQuery({
    queryKey: ['clinic', 'overview'],
    queryFn: () => api.get('/clinics/overview').then(unwrap),
    refetchInterval: 60_000,
  });

  const branch =
    branches.data?.find((b) => String(b._id) === String(user?.branchId)) ||
    branches.data?.[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={branch ? `${branch.name} branch` : 'Branch overview'}
        description={`${dayjs().format('dddd, D MMMM')} · figures for your branch only`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowQR(true)}
              className="btn-ghost"
            >
              <QrCode className="h-4 w-4" />
              Patient QR
            </button>
            <Link to="/clinic/branch/queue" className="btn-primary">
              Open queue
            </Link>
          </>
        }
      />

      <OverviewKpis o={overview.data} />

      <Section title="Branch performance · last 30 days">
        <BranchReport />
      </Section>

      <TodayTable link="/clinic/branch/appointments" />

      {showQR && (
        branches.isLoading ? (
          <BranchLoadingModal onClose={() => setShowQR(false)} />
        ) : branches.isError ? (
          <BranchLoadingModal
            onClose={() => setShowQR(false)}
            retry={() => branches.refetch()}
          />
        ) : branch ? (
          <QRCodeDisplay
            clinicSlug={clinic?.slug}
            branchId={branch._id}
            clinicName={clinic?.name}
            branchName={branch.name || 'Main'}
            onClose={() => setShowQR(false)}
          />
        ) : (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="rounded-2xl bg-surface p-6 shadow-xl">
              <p className="text-sm text-ink">No branch found.</p>
              <button type="button" className="btn-ghost mt-4" onClick={() => setShowQR(false)}>
                Close
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
