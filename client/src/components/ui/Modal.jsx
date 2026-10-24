import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';

let openCount = 0;

/**
 * Shared open/close behaviour for Modal and Drawer: Escape closes, the page
 * behind stops scrolling (AppShell scrolls <main>, not <body>, so both are
 * locked), focus moves into the panel and returns to the opener afterwards.
 */
export function useDialog(open, onClose, panelRef, enter) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const main = document.getElementById('main');
    const onKey = (e) => e.key === 'Escape' && closeRef.current?.();
    document.addEventListener('keydown', onKey);
    openCount += 1;
    document.body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector('[data-autofocus], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])');
      (first || panel).focus({ preventScroll: true });
      if (!prefersReducedMotion()) gsap.fromTo(panel, enter.from, { ...enter.to, duration: 0.24, ease: 'power2.out', clearProps: 'transform' });
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      openCount -= 1;
      if (!openCount) {
        document.body.style.overflow = '';
        if (main) main.style.overflow = '';
      }
      if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
    // enter is a constant per component; re-running only on open keeps focus stable while typing.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Centred dialog on desktop, bottom sheet on phones. Rendered into <body>
 * through a portal so no transformed or scrolling ancestor can clip it, and
 * laid out as header / scrolling body / footer so the title and actions
 * always stay on screen however long the form is.
 */
export function Modal({ open, onClose, title, subtitle, icon: Icon, children, footer, width = 'max-w-lg' }) {
  const panelRef = useRef(null);
  useDialog(open, onClose, panelRef, { from: { opacity: 0, y: 16, scale: 0.98 }, to: { opacity: 1, y: 0, scale: 1 } });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy/50 backdrop-blur-[3px] sm:items-center sm:p-6"
         onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
           className={`flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl outline-none sm:max-h-[min(88dvh,860px)] sm:rounded-2xl`}>
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" />
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pulse/10 text-pulse-deep"><Icon className="h-5 w-5" /></span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold leading-tight text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-paper-sunk hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-paper/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:px-6 [&>*]:w-full sm:[&>*]:w-auto">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
