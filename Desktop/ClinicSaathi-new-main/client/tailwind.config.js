/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // RGB-triplet CSS variables (not plain hex) so Tailwind's opacity
        // modifiers (bg-ink/[0.04], bg-pulse/10, ...) keep working. Values
        // are swapped per-scope: :root holds the light palette the internal
        // app uses everywhere, .theme-dark (wraps just the marketing site)
        // overrides them to a dark palette — same class names, same
        // components, no per-file edits needed to retheme the public site.
        ink: {
          DEFAULT: 'rgb(var(--ink-rgb) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted-rgb) / <alpha-value>)',
        },
        paper: {
          DEFAULT: 'rgb(var(--paper-rgb) / <alpha-value>)',
          sunk: 'rgb(var(--paper-sunk-rgb) / <alpha-value>)',
        },
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        pulse: {
          DEFAULT: 'rgb(var(--pulse-rgb) / <alpha-value>)',
          soft: 'rgb(var(--pulse-soft-rgb) / <alpha-value>)',
          deep: 'rgb(var(--pulse-deep-rgb) / <alpha-value>)',
        },
        signal: {
          DEFAULT: 'rgb(var(--signal-rgb) / <alpha-value>)',
          soft: 'rgb(var(--signal-soft-rgb) / <alpha-value>)',
        },
        alert: {
          DEFAULT: 'rgb(var(--alert-rgb) / <alpha-value>)',
          soft: 'rgb(var(--alert-soft-rgb) / <alpha-value>)',
        },
        line: 'rgb(var(--line-rgb) / <alpha-value>)',
        // Fixed brand navy for the app sidebar — not theme-swapped.
        navy: { DEFAULT: '#0B1F3A', soft: '#12305A', line: '#1C3B66', text: '#C7D3E6' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['clamp(2.5rem, 6vw, 4.5rem)', { lineHeight: '0.98', letterSpacing: '-0.03em' }],
        title: ['clamp(1.75rem, 3vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,31,58,0.04), 0 8px 24px -12px rgba(11,31,58,0.10)',
        lift: '0 2px 4px rgba(11,31,58,0.06), 0 16px 40px -16px rgba(11,31,58,0.22)',
      },
      borderRadius: { card: '14px' },
    },
  },
  plugins: [],
};
