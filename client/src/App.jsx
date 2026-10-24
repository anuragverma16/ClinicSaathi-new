import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import { AuthProvider } from './hooks/useAuth.jsx';
import { ProtectedRoute } from './routes/ProtectedRoute.jsx';
import { AppShell } from './components/layout/AppShell.jsx';
import { MarketingLayout } from './components/marketing/MarketingLayout.jsx';
import { Spinner } from './components/ui/States.jsx';

// Home and auth load eagerly — they're the first paint for most visitors.
import Home from './pages/public/Home.jsx';
import Login from './pages/auth/Login.jsx';

/**
 * Everything else is split out and arrives on first navigation to that route.
 * Recharts alone is ~400kB, and a receptionist who never opens Analytics
 * shouldn't download it, nor should a visitor reading the blog.
 */
const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

const Features = lazy(() => import('./pages/public/Features.jsx'));
const Pricing = lazy(() => import('./pages/public/Pricing.jsx'));
const Blog = lazy(() => import('./pages/public/Blog.jsx'));
const BlogPost = lazy(() => import('./pages/public/BlogPost.jsx'));
const About = lazy(() => import('./pages/public/About.jsx'));
const Contact = lazy(() => import('./pages/public/Contact.jsx'));
const PublicBooking = lazy(() => import('./pages/public/PublicBooking.jsx'));
const PatientLogin = lazy(() => import('./pages/auth/PatientLogin.jsx'));
const ForgotPassword = named(() => import('./pages/auth/PasswordReset.jsx'), 'ForgotPassword');
const ResetPassword = named(() => import('./pages/auth/PasswordReset.jsx'), 'ResetPassword');

// Clinic (shared across roles)
const OwnerDashboard = lazy(() => import('./pages/clinic/Dashboard.jsx'));
const BranchDashboard = named(() => import('./pages/clinic/Dashboard.jsx'), 'BranchDashboard');
const Appointments = lazy(() => import('./pages/clinic/Appointments.jsx'));
const Patients = lazy(() => import('./pages/clinic/Patients.jsx'));
const PatientRegister = lazy(() => import('./pages/clinic/PatientRegister.jsx'));
const Doctors = lazy(() => import('./pages/clinic/Doctors.jsx'));
const Staff = lazy(() => import('./pages/clinic/Staff.jsx'));
const Services = lazy(() => import('./pages/clinic/Services.jsx'));
const CalendarPage = lazy(() => import('./pages/clinic/CalendarPage.jsx'));
const Queue = lazy(() => import('./pages/clinic/Queue.jsx'));
const Records = lazy(() => import('./pages/clinic/Records.jsx'));
const Analytics = lazy(() => import('./pages/clinic/Analytics.jsx'));
const Branches = lazy(() => import('./pages/clinic/Branches.jsx'));
const BranchReport = named(() => import('./pages/clinic/Branches.jsx'), 'BranchReport');
const Settings = lazy(() => import('./pages/clinic/Settings.jsx'));
const Subscription = lazy(() => import('./pages/clinic/Subscription.jsx'));
const WhatsAppAutomation = named(() => import('./pages/clinic/Automation.jsx'), 'WhatsAppAutomation');
const FollowupsRecall = named(() => import('./pages/clinic/Automation.jsx'), 'FollowupsRecall');
const ReviewsCampaigns = named(() => import('./pages/clinic/Automation.jsx'), 'ReviewsCampaigns');
const PatientCommunication = named(() => import('./pages/clinic/Automation.jsx'), 'PatientCommunication');

// Billing
const BillingHub = named(() => import('./pages/accounts/Billing.jsx'), 'BillingHub');
const FinanceOverview = named(() => import('./pages/accounts/Billing.jsx'), 'FinanceOverview');
const Invoices = named(() => import('./pages/accounts/Billing.jsx'), 'Invoices');
const Payments = named(() => import('./pages/accounts/Billing.jsx'), 'Payments');
const Outstanding = named(() => import('./pages/accounts/Billing.jsx'), 'Outstanding');
const Reconciliation = named(() => import('./pages/accounts/Billing.jsx'), 'Reconciliation');
const FinanceReports = named(() => import('./pages/accounts/Billing.jsx'), 'FinanceReports');

// Roles
const ReceptionDashboard = lazy(() => import('./pages/reception/ReceptionDashboard.jsx'));
const NewAppointment = named(() => import('./pages/reception/ReceptionDashboard.jsx'), 'NewAppointment');
const WalkIn = named(() => import('./pages/reception/ReceptionDashboard.jsx'), 'WalkIn');
const DoctorDashboard = lazy(() => import('./pages/doctor/DoctorDashboard.jsx'));
const Consultations = named(() => import('./pages/doctor/DoctorPages.jsx'), 'Consultations');
const DoctorPrescriptions = named(() => import('./pages/doctor/DoctorPages.jsx'), 'DoctorPrescriptions');
const DoctorLabOrders = named(() => import('./pages/doctor/DoctorPages.jsx'), 'DoctorLabOrders');
const Certificates = named(() => import('./pages/doctor/DoctorPages.jsx'), 'Certificates');
const DoctorSchedule = named(() => import('./pages/doctor/DoctorPages.jsx'), 'DoctorSchedule');
const LabDashboard = lazy(() => import('./pages/lab/Dashboard.jsx'));

// Patient portal
const PatientDashboard = named(() => import('./pages/patient/Portal.jsx'), 'PatientDashboard');
const PatientBook = named(() => import('./pages/patient/Portal.jsx'), 'PatientBook');
const PatientAppointments = named(() => import('./pages/patient/Portal.jsx'), 'PatientAppointments');
const PatientRecords = named(() => import('./pages/patient/Portal.jsx'), 'PatientRecords');
const PatientBilling = named(() => import('./pages/patient/Portal.jsx'), 'PatientBilling');
const PatientProfile = named(() => import('./pages/patient/Portal.jsx'), 'PatientProfile');
const PatientAssistant = named(() => import('./pages/patient/Portal.jsx'), 'PatientAssistant');

// Platform
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const AdminClinics = lazy(() => import('./pages/admin/AdminClinics.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminAuditLog = lazy(() => import('./pages/admin/AdminAuditLog.jsx'));
const AdminOperations = lazy(() => import('./pages/admin/AdminOperations.jsx'));
const PlatformBranches = named(() => import('./pages/admin/PlatformPages.jsx'), 'PlatformBranches');
const PlatformPlans = named(() => import('./pages/admin/PlatformPages.jsx'), 'PlatformPlans');
const PlatformRevenue = named(() => import('./pages/admin/PlatformPages.jsx'), 'PlatformRevenue');
const PlatformIntegrations = named(() => import('./pages/admin/PlatformPages.jsx'), 'PlatformIntegrations');
const SystemHealth = named(() => import('./pages/admin/PlatformPages.jsx'), 'SystemHealth');

function RouteFallback() {
  return <div className="flex h-64 items-center justify-center"><Spinner className="h-5 w-5 text-pulse" /></div>;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => n < 1 && ![401, 402, 403, 404].includes(e?.status), refetchOnWindowFocus: false, staleTime: 30_000 } },
});

const OWNER = ['CLINIC_OWNER'];
const shell = (roles) => <ProtectedRoute roles={roles}><AppShell /></ProtectedRoute>;
const BranchSettings = lazy(() => import('./pages/clinic/BranchSettings.jsx'));

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-right" toastOptions={{ style: { borderRadius: '10px', background: '#0B1F3A', color: '#FFFFFF', fontSize: '14px' } }} />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route element={<MarketingLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/features" element={<Features />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/blog/:slug" element={<BlogPost />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
              </Route>

              <Route path="/book/:slug" element={<PublicBooking />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Navigate to="/login" replace />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/patient/login" element={<PatientLogin />} />

              {/* Super Admin */}
              <Route path="/super-admin" element={shell(['SUPER_ADMIN'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="clinics" element={<AdminClinics />} />
                <Route path="branches" element={<PlatformBranches />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="plans" element={<PlatformPlans />} />
                <Route path="subscriptions" element={<AdminOperations mode="subscriptions" />} />
                <Route path="revenue" element={<PlatformRevenue />} />
                <Route path="payments" element={<AdminOperations mode="payments" />} />
                <Route path="integrations" element={<PlatformIntegrations />} />
                <Route path="health" element={<SystemHealth />} />
                <Route path="usage" element={<AdminOperations mode="usage" />} />
                <Route path="support" element={<AdminOperations mode="support" />} />
                <Route path="audit" element={<AdminAuditLog />} />
                <Route path="settings" element={<AdminOperations mode="settings" />} />
              </Route>
              <Route path="/admin/*" element={<Navigate to="/super-admin/dashboard" replace />} />

              {/* Branch manager */}
              <Route path="/clinic/branch" element={shell(['BRANCH_MANAGER'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<BranchDashboard />} />
                <Route path="appointments" element={<Appointments />} />
                <Route path="queue" element={<Queue />} />
                <Route path="schedules" element={<Doctors title="Doctor schedules" description="Working hours, breaks and leave for your branch's doctors." />} />
                <Route path="staff" element={<Staff title="Branch staff" readOnly />} />
                <Route path="patients" element={<Patients />} />
                <Route path="reports" element={<Analytics title="Branch reports and collections" fixedBranch />} />
                <Route path="settings" element={<BranchSettings />} />
              </Route>

              {/* Doctor */}
              <Route path="/clinic/doctor" element={shell(['DOCTOR'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DoctorDashboard />} />
                <Route path="schedule" element={<DoctorSchedule />} />
                <Route path="queue" element={<Queue />} />
                <Route path="patients" element={<Patients title="Patient history" />} />
                <Route path="consultations" element={<Consultations mode="active" />} />
                <Route path="notes" element={<Consultations mode="notes" />} />
                <Route path="prescriptions" element={<DoctorPrescriptions />} />
                <Route path="lab-orders" element={<DoctorLabOrders />} />
                <Route path="followups" element={<FollowupsRecall />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="history" element={<Consultations mode="history" />} />
              </Route>

              {/* Receptionist */}
              <Route path="/clinic/reception" element={shell(['RECEPTIONIST'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<ReceptionDashboard />} />
                <Route path="new-appointment" element={<NewAppointment />} />
                <Route path="register" element={<PatientRegister />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="walk-in" element={<WalkIn />} />
                <Route path="queue" element={<Queue walkInPath="/clinic/reception/walk-in" />} />
                <Route path="check-in" element={<Appointments mode="checkin" bookPath="/clinic/reception/new-appointment" />} />
                <Route path="changes" element={<Appointments mode="changes" bookPath="/clinic/reception/new-appointment" />} />
                <Route path="communication" element={<PatientCommunication />} />
                <Route path="payments" element={<Invoices title="Payment status" readOnly />} />
              </Route>

              {/* Accountant */}
              <Route path="/clinic/accounts" element={shell(['ACCOUNTANT'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<FinanceOverview />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="fees" element={<Services title="Consultation fees" />} />
                <Route path="payments" element={<Payments />} />
                <Route path="receipts" element={<Payments mode="receipts" />} />
                <Route path="outstanding" element={<Outstanding />} />
                <Route path="refunds" element={<Payments mode="refunds" />} />
                <Route path="gst" element={<Invoices gst />} />
                <Route path="reconciliation" element={<Reconciliation />} />
                <Route path="reports" element={<FinanceReports />} />
              </Route>

              {/* Lab */}
              <Route path="/clinic/lab" element={shell(['LAB_TECHNICIAN'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<LabDashboard />} />
                <Route path="completed" element={<LabDashboard view="completed" />} />
              </Route>

              {/* Clinic owner (declared after the role sub-trees above) */}
              <Route path="/clinic" element={shell(OWNER)}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<OwnerDashboard />} />
                <Route path="appointments" element={<Appointments />} />
                <Route path="patients" element={<Patients />} />
                <Route path="doctors" element={<Doctors />} />
                <Route path="staff" element={<Staff />} />
                <Route path="services" element={<Services />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="queue" element={<Queue />} />
                <Route path="records" element={<Records />} />
                <Route path="billing" element={<BillingHub />} />
                <Route path="whatsapp" element={<WhatsAppAutomation />} />
                <Route path="followups" element={<FollowupsRecall />} />
                <Route path="campaigns" element={<ReviewsCampaigns />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="branches" element={<Branches />} />
                <Route path="branch-report" element={<BranchReport />} />
                <Route path="subscription" element={<Subscription />} />
                <Route path="settings" element={<Settings />} />
              </Route>

              {/* Patient portal */}
              <Route path="/patient" element={shell(['PATIENT'])}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<PatientDashboard />} />
                <Route path="book" element={<PatientBook />} />
                <Route path="appointments" element={<PatientAppointments />} />
                <Route path="records" element={<PatientRecords />} />
                <Route path="billing" element={<PatientBilling />} />
                <Route path="profile" element={<PatientProfile />} />
                <Route path="assistant" element={<PatientAssistant />} />
              </Route>

              {/* Old role URLs from the previous build */}
              <Route path="/doctor/*" element={<Navigate to="/clinic/doctor/dashboard" replace />} />
              <Route path="/reception/*" element={<Navigate to="/clinic/reception/dashboard" replace />} />
              <Route path="/lab/*" element={<Navigate to="/clinic/lab/dashboard" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

