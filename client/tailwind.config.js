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
        // Fixed brand dark teal (iPhone 16 inspired) for the app sidebar — not theme-swapped.
        navy: { DEFAULT: '#054C44', soft: '#1A9888', line: '#2CB4A8', text: '#CFFAF6' },
      },
      fontFamily: {
        display: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['clamp(2.5rem, 6vw, 4rem)', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
        title: ['clamp(1.75rem, 3vw, 2.25rem)', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
        'xl': ['1.25rem', { lineHeight: '1.5', letterSpacing: '-0.01em' }],
        'lg': ['1.125rem', { lineHeight: '1.5', letterSpacing: '0em' }],
        'base': ['1rem', { lineHeight: '1.6', letterSpacing: '0em' }],
        'sm': ['0.875rem', { lineHeight: '1.5', letterSpacing: '0em' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.08)',
        lift: '0 2px 4px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.12)',
        'sm': '0 1px 2px rgba(0,0,0,0.04)',
        'md': '0 2px 6px rgba(0,0,0,0.08)',
        'lg': '0 4px 12px rgba(0,0,0,0.10)',
      },
      borderRadius: {
        'card': '12px',
        'xs': '6px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '20px',
      },
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '24px',
        '2xl': '32px',
        '3xl': '48px',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '400': '400ms',
      },
      transitionTimingFunction: {
        'ease-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
