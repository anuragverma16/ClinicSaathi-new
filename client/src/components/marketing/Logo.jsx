import { Link } from 'react-router-dom';

/**
 * The mark is a heartbeat line resolving into a chat bubble tail — the
 * product's whole claim (a message that becomes a completed visit) in one
 * glyph. Reused in the header, footer and browser chrome.
 */
export function LogoMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="url(#logo-grad)" />
      <path d="M6.5 17h4l2-6 3.5 12 2.5-9 1.5 3h6"
            stroke="#FCFBF8" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14B8A6" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({ className = '', markClassName = 'h-8 w-8', textClassName = 'text-lg' }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className={markClassName} />
      <span className={`font-display font-bold tracking-tight ${textClassName}`}>
        Clinic<span className="text-pulse-deep">Saathi</span>
      </span>
    </Link>
  );
}
