import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { Modal, useDialog } from './Modal.jsx';
import { Spinner } from './States.jsx';
import { useCurrentNav } from '../layout/accents.js';
import { ICONS } from '../layout/navIcons.js';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/**
 * Navy banner at the top of every page, matching the sidebar. The feature's
 * own icon and section colour (looked up from the sidebar nav) tint the glow,
 * icon tile and watermark, so each feature reads differently at a glance.
 * Dashboards also get a greeting and today's date.
 */
export function PageHeader({ title, description, actions, children, icon }) {
  const { item, accent } = useCurrentNav();
  const Icon = icon || ICONS[item?.icon];
  const isDashboard = item?.to?.endsWith('/dashboard');
  return (
    <div className="hero-dark rise-in relative mb-6 overflow-hidden rounded-2xl bg-navy p-5 text-white shadow-lift sm:p-7">
      <div aria-hidden="true" className={`pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl ${accent.glow}`} />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_left,black,transparent_60%)]" />
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r opacity-80 ${accent.grad}`} />
      {Icon && <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-8 right-6 hidden h-44 w-44 text-white opacity-[0.05] md:block" strokeWidth={1.2} />}

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {Icon && (
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg shadow-black/30 ring-1 ring-white/15 sm:h-14 sm:w-14 ${accent.grad}`}>
              <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {item?.section && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${accent.tile}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} /> {item.section}
                </span>
              )}
              {isDashboard && (
                <span className="text-xs text-ink-muted">
                  {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              )}
            </div>
            {isDashboard && <p className="text-sm font-medium text-ink-muted">{greeting()}</p>}
            <h1 className="font-display text-xl font-semibold tracking-tight text-white sm:text-[28px]">{title}</h1>
            {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-soft/80">{description}</p>}
            {children}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  value === t.value ? 'border-pulse font-medium text-pulse-deep' : 'border-transparent text-ink-muted hover:text-ink'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-paper-sunk px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Right-hand panel for record detail and quick edits. Portalled into <body>
 * like Modal, full-height with a fixed header and footer around a scrolling body.
 */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }) {
  const panel = useRef(null);
  useDialog(open, onClose, panel, { from: { x: 48, opacity: 0 }, to: { x: 0, opacity: 1 } });
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end bg-navy/45 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
             className={`flex h-[100dvh] w-full ${width} flex-col bg-paper shadow-2xl outline-none`}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-paper-sunk hover:text-ink"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3.5 sm:px-6">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export function Pagination({ meta, page, onPage }) {
  if (!meta?.pages || meta.pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-ink-muted">
      <span>Page {page} of {meta.pages} · {meta.total} total</span>
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <button className="btn-ghost btn-sm" disabled={page >= meta.pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** Label + control + inline error, so every form reads the same way. */
export function Field({ label, htmlFor, error, hint, required, children, className = '' }) {
  return (
    <div className={`${className} ${error ? 'field-error' : ''}`}>
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="ml-0.5 text-alert">*</span>}</label>}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-alert">{error}</p>}
    </div>
  );
}

/** Titled group of fields inside a form, so long forms read as clear steps. */
export function FormSection({ title, description, children, className = '' }) {
  return (
    <fieldset className={`rounded-xl border border-line bg-paper/50 p-4 sm:p-5 ${className}`}>
      {title && <legend className="sr-only">{title}</legend>}
      {title && <p className="text-sm font-semibold text-ink">{title}</p>}
      {description && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>}
      <div className={title || description ? 'mt-4 space-y-4' : 'space-y-4'}>{children}</div>
    </fieldset>
  );
}

/** Maps a server VALIDATION_ERROR into { field: message }. */
export const fieldErrors = (err) => Object.fromEntries((err?.details || []).map((d) => [d.field, d.message]));

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={(
      <>
        <button className="btn-ghost" onClick={onClose}>Back</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy && <Spinner />} {confirmLabel}
        </button>
      </>
    )}>
      {body && <p className="text-sm text-ink-soft">{body}</p>}
      {children}
    </Modal>
  );
}

/** Small "ask for a reason, then do it" helper used by cancel/void/refund buttons. */
export function useReasonPrompt() {
  const [state, setState] = useState(null);
  const ask = (opts) => new Promise((resolve) => setState({ ...opts, resolve, reason: '' }));
  const dialog = state && (
    <ConfirmDialog open title={state.title} body={state.body} confirmLabel={state.confirmLabel || 'Confirm'} danger={state.danger}
                   onClose={() => { state.resolve(null); setState(null); }}
                   onConfirm={() => { if (state.required && state.reason.trim().length < 3) return; state.resolve(state.reason.trim() || 'n/a'); setState(null); }}>
      {state.askReason !== false && (
        <Field label="Reason" htmlFor="reason-input" className="mt-3">
          <input id="reason-input" className="field" autoFocus value={state.reason}
                 onChange={(e) => setState({ ...state, reason: e.target.value })} placeholder={state.required ? 'Required' : 'Optional'} />
        </Field>
      )}
    </ConfirmDialog>
  );
  return [ask, dialog];
}

/** Card with a title row; the title's marker takes the page's section colour. */
export function Section({ title, actions, children, className = '' }) {
  const { accent } = useCurrentNav();
  return (
    <section className={`card p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="section-title flex items-center gap-2.5">
              <span aria-hidden="true" className={`h-4 w-1 rounded-full bg-gradient-to-b ${accent.grad}`} />{title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function KeyValue({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.filter(Boolean).map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink-muted">{k}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
