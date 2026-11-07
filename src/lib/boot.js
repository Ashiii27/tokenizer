/**
 * ============================================================================
 *  Shared chrome — everything every page needs and nothing it doesn't
 * ============================================================================
 *  A page is one idea: `bootChrome()` wires the theme, the page nav, the
 *  motion layer and the model worker; the page module then initialises the one
 *  demo it owns. That is the whole architecture. No router, no build step.
 *
 *  Only the model a page actually uses is ever downloaded: the tokenizer pages
 *  never touch the 23 MB embedder, and the embedder pages never load five
 *  tokenizers to render one sentence.
 */

import { $, setStatus, showError, describeError } from './dom.js';
import { ModelClient } from './client.js';
import { initTheme } from './theme.js';
import { initReveals, initCounters, initRailProgress } from './motion.js';

/** A demo panel that shows embedding-model download progress, if this page has one. */
let embedderView = null;

export function setEmbedderView(view) {
  embedderView = view;
}

/**
 * Bring up the chrome. Returns `{ client }`, where `client` is null when the
 * worker could not start — in that case the page shows the reason instead of
 * pretending to work.
 */
export function bootChrome({ models = true } = {}) {
  initTheme($('#theme-toggle'));
  markCurrentPage();
  initReveals();
  initCounters();
  initRailProgress();

  // The landing page runs no models: starting a worker there would fetch a
  // library and a vocabulary for a page that never tokenizes anything.
  if (!models) return { client: null };

  try {
    const client = new ModelClient({
      onProgress: (data) => {
        if (data.stage === 'embedder') embedderView?.onProgress?.(data);
      },
      onFileProgress: (data) => {
        if (data.stage === 'embedder') embedderView?.onFileProgress?.(data);
      },
      onNotice: (message) => console.info(`[models] ${message}`),
      onLibrary: showLibraryVersion,
    });
    return { client };
  } catch (error) {
    fatal(error);
    return { client: null };
  }
}

/* ------------------------------------------------------------------------ */
/*  Navigation                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Mark the link for the page you are on. The nav is repeated in every page's
 * HTML (there is no build step to share a partial), so this is the one place
 * that decides which link is "you are here".
 */
function markCurrentPage() {
  const here = currentFile();
  for (const link of document.querySelectorAll('[data-nav] a, .site-nav a, .rail-list a')) {
    const target = (link.getAttribute('href') ?? '').split('#')[0];
    if (!target) continue;
    if (target === here) link.setAttribute('aria-current', 'page');
  }
}

function currentFile() {
  const path = window.location?.pathname ?? '/';
  const file = path.split('/').filter(Boolean).pop() ?? '';
  return file.endsWith('.html') ? file : 'index.html';
}

/* ------------------------------------------------------------------------ */
/*  Badges                                                                  */
/* ------------------------------------------------------------------------ */

const VERSION = /@?[^@/]+@([\d.]+)/;

function showLibraryVersion(info) {
  const version = (info?.url ?? '').match(VERSION)?.[1] ?? '';
  const text = $('#badge-library-text');
  if (text) text.textContent = `Transformers.js ${version ? `v${version}` : ''}`.trim();
  $('#badge-library')?.classList.add('is-live');
}

/** Show where inference is actually running — the honest version of "AI powered". */
export function updateDeviceBadge(device) {
  const badge = $('#badge-device');
  if (!badge) return;
  badge.hidden = false;
  const text = $('#badge-device-text');
  if (text) text.textContent = device === 'webgpu' ? 'WebGPU acceleration' : 'WASM · CPU';
  badge.classList.toggle('is-gpu', device === 'webgpu');
}

/* ------------------------------------------------------------------------ */
/*  Fatal — say so, everywhere, instead of failing silently                  */
/* ------------------------------------------------------------------------ */

export function fatal(error) {
  const message = describeError(error);
  for (const node of document.querySelectorAll('.status')) {
    setStatus(node, 'Models unavailable', 'bad');
  }
  const host = $('#page-error');
  if (host) showError(host, message);
  else console.error(`[tokenizer] ${message}`);
}
