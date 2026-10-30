import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Shared animation helpers so timelines aren't rebuilt in every component.
 * Each one no-ops under prefers-reduced-motion.
 *
 * Each element gets its own ScrollTrigger rather than sharing one tween with
 * an internal `stagger` array and a single trigger keyed to the first
 * element — that shared-tween shape is fragile under React StrictMode's
 * dev-only double-effect-invoke (a killed/reverted mid-stagger tween can
 * leave later elements frozen at a partial opacity) and it's also the wrong
 * model for a grid: elements further down should reveal when *they*
 * individually scroll into view, not on a timer anchored to element zero.
 */
export function revealOnScroll(elements, { y = 24, stagger = 0.08, start = 'top 85%' } = {}) {
  if (prefersReducedMotion() || !elements) return null;
  const list = gsap.utils.toArray(elements);
  return list.map((el, i) => gsap.from(el, {
    opacity: 0, y, duration: 0.6, delay: i * stagger, ease: 'power2.out',
    scrollTrigger: { trigger: el, start, once: true },
  }));
}

/**
 * Sets up a page's GSAP animations on mount and tears them down on unmount.
 *
 * In dev, React 18 StrictMode mounts the effect, cleans it up, then mounts
 * it again — synchronously, before the browser paints. If a ScrollTrigger's
 * threshold is already satisfied (common for above-the-fold content), it
 * fires the instant it's created; the first invocation's ScrollTrigger can
 * then start a staggered tween that's still mid-flight when its cleanup
 * runs, and reverting/killing it mid-stagger leaves later elements in the
 * group frozen at whatever opacity they'd reached rather than settling at
 * their end state. Deferring the actual setup to the next animation frame
 * means StrictMode's synchronous cleanup cancels the first invocation
 * before it ever creates a ScrollTrigger, so only the surviving mount's
 * setup runs.
 */
export function useGsapContext(setup, deps = []) {
  useEffect(() => {
    let ctx;
    const frame = requestAnimationFrame(() => { ctx = gsap.context(setup); });
    return () => {
      cancelAnimationFrame(frame);
      ctx?.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Splits an element's own text into word-level spans, each masked by an
 * overflow-hidden wrapper, and reveals them with a rising stagger as the
 * element scrolls into view — words animate in individually rather than the
 * whole heading moving as one block. Mutates the DOM directly (innerHTML),
 * so only point it at static text content, and only once (it re-splits on
 * every call, so a second call would double-wrap already-split words).
 */
export function revealTextOnScroll(elements, { y = 28, stagger = 0.028, duration = 0.75, start = 'top 85%' } = {}) {
  if (!elements) return null;
  const list = gsap.utils.toArray(elements);
  if (prefersReducedMotion()) return null;

  return list.map((el) => {
    if (el.dataset.split === '1') return null; // already split by an earlier pass
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words
      .map((w) => `<span class="inline-block overflow-hidden pb-[0.15em] -mb-[0.15em]"><span class="inline-block will-change-transform">${w}</span></span>`)
      .join(' ');
    el.dataset.split = '1';
    const inner = el.querySelectorAll(':scope > span > span');
    return gsap.from(inner, {
      y, opacity: 0, duration, ease: 'power3.out', stagger,
      scrollTrigger: { trigger: el, start, once: true },
    });
  });
}

/**
 * Reveals each section's [data-reveal] children independently, as that
 * section scrolls into view — rather than one batched tween keyed to the
 * page's first reveal element, which leaves far-down sections either firing
 * too early or sitting in a long stagger queue behind everything above them.
 * [data-text-reveal] children get the word-by-word split reveal instead of
 * the plain block fade.
 */
export function revealSectionsOnScroll(opts = {}) {
  if (prefersReducedMotion()) return;
  document.querySelectorAll('section').forEach((section) => {
    const items = section.querySelectorAll('[data-reveal]');
    if (items.length) revealOnScroll(gsap.utils.toArray(items), opts);
  });
  revealTextOnScroll(document.querySelectorAll('[data-text-reveal]'));
}

/** Counts a number up. Used for dashboard KPIs. */
export function countUp(el, value, { duration = 1.1, format = (n) => Math.round(n).toLocaleString('en-IN') } = {}) {
  if (!el) return null;
  if (prefersReducedMotion()) { el.textContent = format(value); return null; }
  const obj = { n: 0 };
  return gsap.to(obj, {
    n: value, duration, ease: 'power2.out',
    onUpdate: () => { el.textContent = format(obj.n); },
  });
}

export function pageEnter(scope) {
  if (prefersReducedMotion() || !scope) return null;
  return gsap.fromTo(scope,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
}

export { gsap, ScrollTrigger };
