/** Light/dark theme: honours prefers-color-scheme, remembers an explicit choice. */

import { readTheme, writeTheme } from './urlstate.js';

const SUN = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="4.2" />
  <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
</svg>`;

const MOON = `
<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.4 8.4 0 1 0 10.5 10.5z" />
</svg>`;

export function initTheme(button) {
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#f6f8fb' : '#080b11');
    button.innerHTML = theme === 'dark' ? SUN : MOON;
    const next = theme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${next} theme`);
    button.title = `Switch to ${next} theme`;
  };

  apply(readTheme());

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    writeTheme(next);
  });

  // Follow the OS only while the user hasn't chosen explicitly.
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem('tokenizer.theme');
    } catch {
      /* ignore */
    }
    if (!stored) apply(event.matches ? 'light' : 'dark');
  });
}
