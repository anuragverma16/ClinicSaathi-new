import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { Modal } from './Modal.jsx';
import { Spinner } from './States.jsx';
import { useCurrentNav } from '../layout/accents.js';
import { ICONS } from '../layout/navIcons.js';

/**
 * Hero card at the top of every page: the feature's own icon and section
 * colour (looked up from the sidebar nav), a breadcrumb, the title and actions.
 */
export function PageHeader({ title, description, actions, children, icon }) {
  const { item, accent } = useCurrentNav();
  const Icon = icon || ICONS[item?.icon];
  return (
    <div className="rise-in relative mb-6 overflow-hidden rounded-2xl border border-line/80 bg-surface p-5 shadow-card sm:p-6">
      <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent.grad}`} />
      <div aria-hidden="true" className={`pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl ${accent.glow}`} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgb(var(--line-rgb))_1px,transparent_1px)] [background-size:16px_16px] [mask-image:linear-gradient(to_left,black,transparent_55%)]" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {Icon && (
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg shadow-black/10 ${accent.grad}`}>
              <Icon className="h-6 w-6" strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0">
            {item?.section && (
              <p className={`mb-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${accent.soft}`}>
                {item.section}
              </p>
            )}
            <h1 className="font-display text-xl font-semibold tracking-tight text-ink sm:text-[26px]">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
            {children}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

/** Right-hand panel for record detail and quick edits. Escape and backdrop close it. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    if (!prefersReducedMotion() && panel.current) gsap.fromTo(panel.current, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.22, ease: 'power2.out' });
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={title}
             className={`flex h-full w-full ${width} flex-col bg-surface shadow-lift`}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold">{title}</h2>
            {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-muted hover:bg-paper-sunk"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </aside>
    </div>
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
export function Field({ label, htmlFor, error, hint, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-alert">{error}</p>}
    </div>
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

export function Section({ title, actions, children, className = '' }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="section-title">{title}</h2>}
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
