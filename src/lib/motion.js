/**
 * ============================================================================
 *  Motion — small, purposeful, and switchable off
 * ============================================================================
 *  Everything here degrades to "just show the content":
 *    • reveals are gated behind a class added by JS, so a failed script can
 *      never leave the page blank;
 *    • counters and the rail progress respect prefers-reduced-motion;
 *    • theme transitions use the View Transitions API when it exists and a
 *      plain swap when it doesn't.
 */

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------------ */
/*  Reveal on scroll                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Mark `.reveal` elements visible as they enter the viewport.
 * Elements already in view are revealed synchronously on the first pass, so
 * there is no flash of hidden content.
 */
export function initReveals(selector = '.reveal') {
  const elements = [...document.querySelectorAll(selector)];
  if (elements.length === 0) return;

  const show = (element) => element.classList.add('is-in');

  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    elements.forEach(show);
    return;
  }

  const viewport = window.innerHeight || 800;
  const pending = [];

  for (const element of elements) {
    if (element.getBoundingClientRect().top < viewport * 0.92) show(element);
    else pending.push(element);
  }

  document.documentElement.classList.add('reveal-ready');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );

  for (const element of pending) observer.observe(element);
}

/* ------------------------------------------------------------------------ */
/*  Count-up                                                               */
/* ------------------------------------------------------------------------ */

const easeOutQuart = (t) => 1 - (1 - t) ** 4;

/**
 * Animate `[data-count]` numerals from zero when they scroll into view.
 * Locale-aware, respects tabular figures set in CSS.
 */
export function initCounters(selector = '[data-count]') {
  const elements = [...document.querySelectorAll(selector)];
  if (elements.length === 0) return;

  const format = new Intl.NumberFormat('en-US');

  const run = (element) => {
    const target = Number(element.dataset.count);
    if (!Number.isFinite(target)) return;

    if (prefersReducedMotion()) {
      element.textContent = format.format(target);
      return;
    }

    const duration = 1100;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const value = Math.round(target * easeOutQuart(progress));
      element.textContent = format.format(value);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in window)) {
    elements.forEach(run);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.4 },
  );

  for (const element of elements) observer.observe(element);
}

/* ------------------------------------------------------------------------ */
/*  Rail progress                                                          */
/* ------------------------------------------------------------------------ */

/** Fill the slim vertical rule beside the section index as you read. */
export function initRailProgress(fillId = 'rail-fill') {
  const fill = document.getElementById(fillId);
  if (!fill) return;

  let queued = false;

  const update = () => {
    queued = false;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
    fill.style.height = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

/* ------------------------------------------------------------------------ */
/*  View transitions                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Run a DOM update inside a View Transition anchored at (x, y) — used for the
 * theme swap, where a circular wipe out of the toggle reads much better than
 * a full-page crossfade.
 */
export function withViewTransition(update, { x, y } = {}) {
  const root = document.documentElement;

  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }

  if (typeof x === 'number') root.style.setProperty('--vt-x', `${x}px`);
  if (typeof y === 'number') root.style.setProperty('--vt-y', `${y}px`);

  document.startViewTransition(update);
}
