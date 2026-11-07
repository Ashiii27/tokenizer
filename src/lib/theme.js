/**
 * Theme: "paper" (light) and "night press" (dark).
 * Follows the OS until you choose explicitly, then remembers.
 * The swap runs inside a View Transition when the browser has one, so the new
 * theme wipes in as a circle from the toggle instead of snapping.
 */

import { readTheme, writeTheme } from './urlstate.js';
import { withViewTransition } from './motion.js';

const SUN = `
<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
</svg>`;

const MOON = `
<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />
</svg>`;

const THEME_COLOR = { light: '#f1ece1', dark: '#121110' };

export function initTheme(button) {
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    button.innerHTML = theme === 'dark' ? SUN : MOON;
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[theme] ?? THEME_COLOR.light);
  };

  apply(readTheme());

  button.addEventListener('click', (event) => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    withViewTransition(() => apply(next), {
      x: event.clientX || x,
      y: event.clientY || y,
    });
    writeTheme(next);
  });

  // Follow the OS only while the user hasn't chosen explicitly.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem('tokenizer.theme');
    } catch {
      /* ignore */
    }
    if (!stored) apply(event.matches ? 'dark' : 'light');
  });
}
