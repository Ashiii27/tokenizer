/**
 * ============================================================================
 *  How LLMs read text — entry point
 * ============================================================================
 *  Wiring only: theme, nav, model lifecycle, and the six panels. Each panel
 *  owns its own DOM and errors, so one broken model can never blank the page.
 */

import { $, setStatus, showError, describeError } from './lib/dom.js';
import { ModelClient } from './lib/client.js';
import { initTheme } from './lib/theme.js';
import { readUrlState, readStoredState } from './lib/urlstate.js';
import { SAMPLES, TOKENIZERS, EMBEDDER, DEFAULT_CORPUS } from './lib/models.js';

import { initTokenizePanel } from './demos/tokenize-panel.js';
import { initComparePanel } from './demos/compare-panel.js';
import { initLanguagesPanel } from './demos/languages-panel.js';
import { initEmbedPanel } from './demos/embed-panel.js';
import { initCorpusPanel } from './demos/corpus-panel.js';
import { initMapPanel } from './demos/map-panel.js';

const url = readUrlState();
const stored = readStoredState();

let client = null;
let comparePanel = null;
let embedPanel = null;
let corpusPanel = null;

initTheme($('#theme-toggle'));
initSectionNav();

try {
  client = new ModelClient({
    onProgress: (data) => {
      if (data.stage === 'embedder') embedPanel?.onProgress(data);
    },
    onFileProgress: (data) => {
      if (data.stage === 'embedder') embedPanel?.onFileProgress(data);
    },
    onNotice: (message) => console.info(`[models] ${message}`),
    onLibrary: (info) => {
      const version = info.url.match(/\/@?[^@/]+@([\d.]+)/)?.[1] ?? '';
      $('#badge-library-text').textContent = `Transformers.js ${version ? `v${version}` : ''}`.trim();
      $('#badge-library').classList.add('is-live');
    },
  });
} catch (error) {
  fatal(error);
}

if (client) boot();

function boot() {
  /* ---- panel 1: tokens ------------------------------------------------- */
  const tokenizerModel = TOKENIZERS.find((model) => model.id === 'gpt2') ?? TOKENIZERS[0];

  initTokenizePanel({
    client,
    model: tokenizerModel,
    getInitialText: () => url.tokens ?? stored.tokens ?? SAMPLES.english,
    onTextChange: (text) => comparePanel?.setText(text),
  });

  /* ---- panel 2: tokenizer comparison ----------------------------------- */
  comparePanel = initComparePanel({ client });
  const compareInput = $('#cmp-input');
  compareInput.value = url.tokens ?? stored.tokens ?? SAMPLES.multilingual;

  /* ---- panel 3: languages ---------------------------------------------- */
  initLanguagesPanel({ client });

  /* ---- panel 4: embeddings --------------------------------------------- */
  embedPanel = initEmbedPanel({
    client,
    initial: {
      a: url.embedA ?? stored.embedA,
      b: url.embedB ?? stored.embedB,
    },
    onNeedModel: (device) => updateDeviceBadge(device),
  });
  $('#emb-model-tag').textContent = `${EMBEDDER.label} · ${EMBEDDER.dimensions}d`;

  /* ---- panel 5: corpus -------------------------------------------------- */
  corpusPanel = initCorpusPanel({
    client,
    ensureEmbedder: () => embedPanel.load(),
    initial: url.corpus ?? stored.corpus ?? DEFAULT_CORPUS.join('\n'),
  });

  /* ---- panel 6: map ---------------------------------------------------- */
  initMapPanel({ onSelect: (index) => corpusPanel?.select(index) });

  watchForEmbeddingPanels();
}

/* ------------------------------------------------------------------------ */
/*  Model lifecycle                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Load the embedding model the first time a panel that needs it becomes
 * visible — never on page load, so a visitor who only wants the tokenizer
 * spends ~1 MB instead of ~24 MB.
 */
function watchForEmbeddingPanels() {
  const targets = [$('#embeddings'), $('#corpus'), $('#map')].filter(Boolean);
  if (!('IntersectionObserver' in window) || targets.length === 0) return;

  let triggered = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (triggered) return;
      if (!entries.some((entry) => entry.isIntersecting)) return;

      if (navigator.connection?.saveData) {
        setStatus(
          $('#emb-status'),
          'Data Saver is on — press "Load embedding model" when you want the download.',
        );
        return;
      }

      triggered = true;
      observer.disconnect();
      // Load, then show a first comparison so the panel is never empty.
      embedPanel?.load().then(() => embedPanel?.run());
    },
    { rootMargin: '200px 0px', threshold: 0.05 },
  );

  for (const target of targets) observer.observe(target);
}

function updateDeviceBadge(device) {
  const badge = $('#badge-device');
  if (!badge) return;
  badge.hidden = false;
  $('#badge-device-text').textContent = device === 'webgpu' ? 'WebGPU acceleration' : 'WASM · CPU';
  badge.classList.toggle('is-gpu', device === 'webgpu');
}

/* ------------------------------------------------------------------------ */
/*  Section nav                                                              */
/* ------------------------------------------------------------------------ */

function initSectionNav() {
  const links = [...document.querySelectorAll('.section-nav a')];
  if (!links.length || !('IntersectionObserver' in window)) return;

  const byId = new Map(links.map((link) => [link.getAttribute('href').slice(1), link]));

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = byId.get(entry.target.id);
        if (!link || !entry.isIntersecting) continue;
        for (const other of links) other.removeAttribute('aria-current');
        link.setAttribute('aria-current', 'true');
      }
    },
    { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
  );

  for (const id of byId.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
}

/* ------------------------------------------------------------------------ */
/*  Fatal — a worker that cannot start should say so, everywhere             */
/* ------------------------------------------------------------------------ */

function fatal(error) {
  const message = describeError(error);
  for (const id of ['tok-status', 'emb-status', 'cmp-status', 'lang-status', 'corp-status']) {
    const node = document.getElementById(id);
    if (node) setStatus(node, 'Models unavailable', 'bad');
  }
  showError($('#tok-error'), message);
}
