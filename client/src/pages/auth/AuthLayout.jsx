import { Logo } from '../../components/marketing/Logo.jsx';
import { PulseLine } from '../../components/marketing/illustrations.jsx';

/** Split-screen frame shared by every sign-in page: brand panel left, form right. */
export function AuthLayout({ children, heading = 'The AI-powered operating system for modern clinics.', sub }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-pulse/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 -left-16 h-[360px] w-[360px] rounded-full bg-pulse/15 blur-3xl" aria-hidden="true" />
        <div className="relative theme-dark bg-transparent"><Logo markClassName="h-9 w-9" textClassName="text-xl text-white" /></div>
        <div className="relative max-w-md">
          <p className="text-sm font-medium uppercase tracking-widest text-pulse">Smarter Clinics. Happier Patients.</p>
          <p className="mt-3 font-display text-3xl font-bold leading-tight">{heading}</p>
          <p className="mt-4 text-navy-text">{sub || 'Booking, queue, records, prescriptions, billing and WhatsApp follow-ups — each team member sees exactly what their role needs.'}</p>
          <PulseLine className="mt-10 h-12 w-full max-w-xs" />
        </div>
        <p className="relative text-xs text-navy-text/70">© {new Date().getFullYear()} ClinicSaathi · Built for clinics in India</p>
      </div>
      <div className="flex items-center justify-center bg-paper px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
