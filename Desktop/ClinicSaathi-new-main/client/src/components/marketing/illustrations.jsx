/**
 * Small decorative graphics shared across the marketing pages, drawn from
 * the brand palette so they read as one system. Blog cover photography
 * (BlogPhoto, below) is the one exception — real photos, not SVG.
 */

const TONES = {
  pulse: { a: '#0E8A7D', b: '#0A6B60' },
  signal: { a: '#E0952F', b: '#C97B1E' },
  ink: { a: '#1C4742', b: '#11312D' },
};

/**
 * Real photography for a blog post's cover, via Picsum (picsum.photos) —
 * actual photographs sourced from Unsplash under a free-use license, served
 * through a stable, keyless CDN built for exactly this. Seeded by slug so
 * a given post always gets the same photo rather than a new random one on
 * every render, with a brand-tinted gradient over it so it reads as part
 * of the same visual system as the rest of the site rather than a stock
 * photo dropped in untouched.
 */
export function BlogPhoto({ seed, tone = 'pulse', w = 800, h = 450, alt = '', className = '' }) {
  const c = TONES[tone] || TONES.pulse;
  return (
    <div className={`relative overflow-hidden bg-paper-sunk ${className}`}>
      <img
        src={`https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0"
           style={{ background: `linear-gradient(200deg, ${c.a}4D 0%, ${c.b}26 45%, transparent 80%)` }} />
    </div>
  );
}

export function BlobBackdrop({ className = '', tone = 'pulse' }) {
  const c = TONES[tone] || TONES.pulse;
  return (
    <svg viewBox="0 0 600 600" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`blob-${tone}`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={c.a} stopOpacity="0.30" />
          <stop offset="100%" stopColor={c.b} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path fill={`url(#blob-${tone})`} d="M451 108Q522 216 486 326Q450 436 336 476Q222 516 132 438Q42 360 66 240Q90 120 210 78Q330 36 451 108Z" />
    </svg>
  );
}

export function DotGrid({ className = '' }) {
  return (
    <svg className={className} aria-hidden="true">
      <defs>
        <pattern id="dot-grid" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </svg>
  );
}

/** An icon set inside a soft gradient tile — the repeating unit for feature grids. */
export function GlyphTile({ icon: Icon, tone = 'pulse', className = '' }) {
  const c = TONES[tone] || TONES.pulse;
  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${className}`}
         style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}>
      <Icon className="h-5 w-5 text-white" strokeWidth={1.75} />
    </div>
  );
}

export function WaveDivider({ flip = false, className = '', fill = '#FCFBF8' }) {
  return (
    <svg viewBox="0 0 1440 80" className={`${className} ${flip ? 'rotate-180' : ''}`} preserveAspectRatio="none" aria-hidden="true">
      <path fill={fill} d="M0 40C240 80 480 0 720 20C960 40 1200 80 1440 40V80H0V40Z" />
    </svg>
  );
}

const PULSE_D = 'M0 50H70L90 20L115 80L140 50H180L200 30L215 50H400';

/**
 * The heartbeat-to-chat-bubble line used in the hero — a real EKG-monitor
 * sweep, not a static drawing. Two paths share the same trace: a dim,
 * always-on baseline (data-pulse-base) and a bright overlay
 * (data-pulse-path) whose gradient is a narrow glowing band that the page's
 * GSAP setup slides continuously left-to-right and loops, off-screen to
 * off-screen so the loop never visibly jumps.
 */
export function PulseLine({ className = '' }) {
  return (
    <svg viewBox="0 0 400 100" fill="none" className={className} aria-hidden="true">
      <path data-pulse-base d={PULSE_D} stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="text-pulse/20" />
      <path data-pulse-path d={PULSE_D}
            stroke="url(#pulse-line-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="pulse-line-grad" x1="-150" y1="0" x2="-20" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#17C6A8" stopOpacity="0" />
          <stop offset="0.5" stopColor="#17C6A8" stopOpacity="1" />
          <stop offset="1" stopColor="#17C6A8" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function AvatarInitials({ name, className = 'h-11 w-11', tone = 'pulse' }) {
  const c = TONES[tone] || TONES.pulse;
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold text-white ${className}`}
         style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}>
      {initials}
    </div>
  );
}
