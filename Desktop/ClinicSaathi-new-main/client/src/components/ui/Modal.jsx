import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { gsap, prefersReducedMotion } from '../../animations/gsapUtils.js';

// Nested dialogs (a confirm on top of a drawer) share one scroll lock.
let locks = 0;
const lockScroll = () => {
  if (locks++ > 0) return;
  document.body.style.overflow = 'hidden';
  const main = document.getElementById('main');
  if (main) main.style.overflow = 'hidden';
};
const unlockScroll = () => {
  if (--locks > 0) return;
  locks = 0;
  document.body.style.overflow = '';
  const main = document.getElementById('main');
  if (main) main.style.overflow = '';
};

/**
 * Shared dialog behaviour for Modal and Drawer: Escape closes, the page behind
 * can't scroll, the first field gets focus, the panel animates in, and focus
 * goes back to whatever opened it on close.
 */
export function useDialog(open, onClose, panelRef, enter) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    lockScroll();

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (first || panel).focus({ preventScroll: true });
      if (enter && !prefersReducedMotion()) {
        gsap.fromTo(panel, enter.from, { ...enter.to, duration: 0.28, ease: 'power3.out', clearProps: 'transform,opacity' });
      }
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Centred dialog on desktop, bottom sheet on phones. Portalled into <body> so
 * it covers the sidebar and top bar and is never clipped by the page. Header
 * and footer stay put; only the body scrolls.
 */
export function Modal({ open, onClose, title, subtitle, icon: Icon, children, footer, width = 'max-w-lg' }) {
  const panel = useRef(null);
  useDialog(open, onClose, panel, { from: { y: 16, opacity: 0, scale: 0.98 }, to: { y: 0, opacity: 1, scale: 1 } });
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy/45 backdrop-blur-[3px] sm:items-center sm:p-6"
         onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
           className={`flex max-h-[92dvh] w-full ${width} flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl outline-none sm:max-h-[min(88dvh,860px)] sm:rounded-2xl`}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pulse-soft text-pulse-deep">
                <Icon className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="-mr-1.5 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-paper-sunk hover:text-ink">
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
