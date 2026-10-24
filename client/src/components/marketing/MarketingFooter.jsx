import { Link } from 'react-router-dom';
import { Twitter, Linkedin, Instagram } from 'lucide-react';
import { Logo } from './Logo.jsx';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      ['Features', '/features'],
      ['Pricing', '/pricing'],
      ['Sign in', '/login'],
      ['Book a demo', '/contact'],
    ],
  },
  {
    heading: 'Company',
    links: [
      ['About', '/about'],
      ['Blog', '/blog'],
      ['Contact', '/contact'],
    ],
  },
  {
    heading: 'Modules',
    links: [
      ['Appointments', '/features#appointments'],
      ['Queue', '/features#queue'],
      ['Billing', '/features#billing'],
      ['Follow-ups', '/features#follow-ups'],
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-paper-sunk">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-muted">
              The clinic operating system that turns one patient message into a booked,
              reminded, billed and followed-up visit — automatically.
            </p>
            <div className="mt-5 flex gap-3">
              {[Twitter, Linkedin, Instagram].map((Icon, i) => (
                <a key={i} href="#" aria-label="Social link"
                   className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-muted transition hover:border-pulse hover:text-pulse-deep">
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="font-display text-sm font-semibold text-ink">{col.heading}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-sm text-ink-muted transition hover:text-pulse-deep">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-line pt-6 text-sm text-ink-muted sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} ClinicSaathi. Built for clinics in India.</p>
          <p className="sm:ml-auto">Patient data stays in India.</p>
        </div>
      </div>
    </footer>
  );
}
