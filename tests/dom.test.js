/**
 * End-to-end DOM test.
 *
 * The real models can't run in CI (they live on the Hugging Face Hub), so the
 * worker is replaced by a fake that answers with the same message protocol.
 * Everything else — index.html, all six panels, the client RPC, the rendering
 * code — is the real thing. This is what catches "the button does nothing".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------------ */
/*  Fixtures: a deterministic stand-in for the tokenizer and the embedder    */
/* ------------------------------------------------------------------------ */

function fakeTokenize(text) {
  const parts = text.match(/\s+|\S+/g) ?? [];
  const ids = parts.map((part, index) => 1000 + index + (part.codePointAt(0) ?? 0));
  return { ids, texts: parts, full: text, truncated: false, renderLimit: 2048, repo: 'fake' };
}

function fakeVector(text, dims = 384) {
  const vector = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const slot = (text.charCodeAt(i) * 7 + i * 13) % dims;
    vector[slot] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

/* ------------------------------------------------------------------------ */
/*  Environment                                                             */
/* ------------------------------------------------------------------------ */

const dom = new JSDOM(readFileSync(join(root, 'index.html'), 'utf8'), {
  url: 'https://example.test/tokenizer/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);

window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
window.navigator.clipboard = { writeText: async () => {} };

// Canvas 2D is not implemented by jsdom; record calls so the map can be checked.
const canvasCalls = [];
window.HTMLCanvasElement.prototype.getContext = () => ({
  setTransform: (...args) => canvasCalls.push(['setTransform', ...args]),
  clearRect: () => canvasCalls.push(['clearRect']),
  beginPath: () => canvasCalls.push(['beginPath']),
  arc: (...args) => canvasCalls.push(['arc', ...args]),
  fill: () => canvasCalls.push(['fill']),
  stroke: () => canvasCalls.push(['stroke']),
  moveTo: () => {},
  lineTo: () => {},
  fillText: (...args) => canvasCalls.push(['fillText', ...args]),
  set fillStyle(value) {
    canvasCalls.push(['fillStyle', value]);
  },
  set strokeStyle(value) {},
  set lineWidth(value) {},
  set font(value) {},
  set textAlign(value) {},
  set globalAlpha(value) {},
});

globalThis.MutationObserver = window.MutationObserver;

// Feature detection reads `window`, so the stubs must live there too.
window.IntersectionObserver = globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe(target) {
    // Everything counts as visible: this also exercises the lazy model load.
    this.callback([{ isIntersecting: true, target }], this);
  }
  disconnect() {}
  unobserve() {}
};

window.ResizeObserver = globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.Worker = class FakeWorker {
  constructor() {
    this.listeners = [];
    this.lastOp = null;
  }

  addEventListener(type, handler) {
    if (type === 'message') this.listeners.push(handler);
  }

  #emit(data) {
    for (const handler of this.listeners) handler({ data });
  }

  postMessage({ id, op, payload }) {
    this.lastOp = op;
    window.setTimeout(() => {
      try {
        if (op === 'tokenize') {
          const result = fakeTokenize(payload.text);
          result.specialIds = [1, 2];
          if (payload.addSpecialTokens) {
            result.ids = [1, ...result.ids, 2];
            result.texts = ['[CLS]', ...result.texts, '[SEP]'];
            result.full = `[CLS]${payload.text}[SEP]`;
          }
          this.#emit({ id, ok: true, result });
        } else if (op === 'load-tokenizer') {
          this.#emit({ id, ok: true, result: { repo: 'fake/gpt2', api: 'modern' } });
        } else if (op === 'load-embedder') {
          this.#emit({ id, ok: true, result: { device: 'wasm', api: 'modern' } });
        } else if (op === 'embed') {
          this.#emit({
            type: 'progress',
            stage: 'embedder',
            loaded: 12_000_000,
            total: 23_000_000,
            progress: 0.52,
            files: 4,
          });
          this.#emit({
            id,
            ok: true,
            result: {
              vectors: payload.texts.map((text) => fakeVector(text)),
              dims: 384,
              device: 'wasm',
              tokenCounts: payload.texts.map((text) => Math.ceil(text.length / 4)),
            },
          });
        } else {
          this.#emit({ id, ok: false, error: `fake worker: unknown op ${op}` });
        }
      } catch (error) {
        this.#emit({ id, ok: false, error: error.message });
      }
    }, 0);
  }

  terminate() {}
};

/* ------------------------------------------------------------------------ */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const flush = async (times = 12) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  }
};

const $ = (id) => window.document.getElementById(id);

let bootError = null;
const errors = [];
window.addEventListener('error', (event) => errors.push(event.message));

test('the app boots and wires every panel', async () => {
  try {
    await import('../src/main.js');
  } catch (error) {
    bootError = error;
  }
  assert.equal(bootError, null, `main.js threw during boot: ${bootError?.message}`);
  await flush();
  assert.deepEqual(errors, []);
  assert.equal(
    window.document.documentElement.dataset.theme,
    'light',
    'paper is the default theme',
  );
});

test('panel 1 — tokens, stats, chips and the round-trip invariant', async () => {
  await flush();

  assert.equal($('tok-status').classList.contains('is-ok'), true, 'tokenizer status is ok');
  assert.equal($('tok-btn').disabled, false, 'tokenize button enabled');

  assert.equal($('tok-results').hidden, false, 'results are visible');
  assert.ok(Number($('tok-count').textContent.replace(/,/g, '')) > 5, 'token count is populated');

  const chips = [...$('tok-chips').querySelectorAll('.chip')];
  assert.ok(chips.length > 5, 'chips rendered');
  assert.equal(
    chips.map((chip) => chip.dataset.raw).join(''),
    $('tok-input').value,
    'chips rejoin to the input exactly',
  );
  assert.match($('tok-roundtrip').textContent, /✓/, 'the invariant is reported in the UI');

  assert.equal($('tok-stats').querySelectorAll('.stat').length, 5, 'five stat tiles');
  assert.ok($('tok-ids').textContent.startsWith('['), 'IDs rendered as JSON');

  // Context meter reflects the GPT-2 window.
  assert.match($('tok-context-text').textContent, /\/ 1,024 tokens/);

  // Chips are keyboard-reachable and expose a roving tabindex.
  assert.equal(chips[0].getAttribute('tabindex'), '0');
  assert.equal(chips[1].getAttribute('tabindex'), '-1');
  assert.ok(chips[0].getAttribute('aria-label').includes('Token'));

  // Selecting a token fills the detail pane.
  chips[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.match($('tok-detail').textContent, /token id/i);
});

test('panel 1 — multilingual input round-trips (the old bug)', async () => {
  const input = $('tok-input');
  input.value = 'नमस्ते दुनिया 🌏 你好';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(400); // the input handler is debounced
  await flush();

  const chips = [...$('tok-chips').querySelectorAll('.chip')];
  assert.equal(chips.map((chip) => chip.dataset.raw).join(''), input.value);
  assert.match($('tok-roundtrip').textContent, /✓/);
});

test('panel 1 — sample buttons fill the textarea', async () => {
  const button = $('tok-input').closest('.panel').querySelector('[data-sample="multilingual"]');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.match($('tok-input').value, /नमस्ते/);
});

test('panel 2 — tokenizer comparison renders one column per model', async () => {
  $('cmp-input').value = 'Antidisestablishmentarianism costs tokens everywhere.';
  $('cmp-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush(20);

  const columns = [...$('cmp-grid').querySelectorAll('.compare-col')];
  assert.ok(columns.length >= 2, `expected comparison columns, got ${columns.length}`);
  assert.equal($('cmp-results').hidden, false);
  assert.match($('cmp-summary').textContent, /tokens/);

  const counts = [...$('cmp-grid').querySelectorAll('.count')].map((node) => node.textContent);
  assert.ok(counts.every((count) => count !== '—'), 'every column has a token count');

  const specials = $('cmp-grid').querySelectorAll('.chip.is-special');
  assert.ok(specials.length > 0, 'special tokens are marked, not silently merged into the text');
  assert.match(specials[0].textContent, /\[CLS\]|\[SEP\]/);
});

test('panel 3 — the language table measures every sample', async () => {
  $('lang-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush(20);

  const rows = [...$('lang-body').querySelectorAll('tr')];
  assert.ok(rows.length >= 7, `expected a row per language, got ${rows.length}`);
  assert.equal($('lang-results').hidden, false);

  const tokens = [...$('lang-body').querySelectorAll('td.num')].map((cell) => cell.textContent);
  assert.ok(tokens.some((value) => Number(value.replace(/,/g, '')) > 0), 'token counts rendered');
  assert.match($('lang-note').textContent, /tokens/);
});

test('panel 4 — cosine similarity, dimension charts and the maths line', async () => {
  await flush(20);

  assert.equal($('emb-btn').disabled, false, 'compare enabled after the model loads');
  assert.match($('emb-status').textContent, /ready/i);

  $('emb-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush(20);

  assert.equal($('emb-results').hidden, false);
  assert.match($('sim-score').textContent, /^-?\d\.\d{4}$/);
  assert.match($('sim-math').textContent, /cos = \(A·B\)/);
  assert.match($('sim-math').textContent, /384 dimensions/);

  const dims = $('emb-dims').querySelectorAll('.dim-row');
  assert.equal(dims.length, 12, 'twelve contribution rows');
  assert.equal($('emb-vec-a').querySelectorAll('.dim-row').length, 64, '64 embedding dimensions');
});

test('panel 5 — corpus matrix and nearest neighbours', async () => {
  $('corp-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush(30);

  assert.equal($('corp-results').hidden, false);
  const lines = $('corp-input').value.split('\n').filter(Boolean).length;
  const cells = $('corp-matrix').querySelectorAll('.matrix-cell');
  assert.equal(cells.length, lines * lines, 'an n×n matrix');
  assert.equal($('corp-labels').querySelectorAll('.matrix-label').length, lines);

  const neighbours = [...$('corp-neighbours').querySelectorAll('li')];
  assert.ok(neighbours.length > 0, 'neighbours listed');
  assert.match($('corp-neighbours').textContent, /\.\d{3}/, 'scores are shown');

  // Selecting a different row updates the neighbour list + the map.
  $('corp-labels').querySelectorAll('.matrix-label')[1].dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }),
  );
  await flush();
  assert.match($('corp-selected-label').textContent, /^2 ·/);
});

test('panel 6 — the map draws points on canvas', async () => {
  await flush();

  assert.equal($('map-empty').hidden, true, 'the empty state is gone');
  const arcs = canvasCalls.filter((call) => call[0] === 'arc');
  assert.ok(arcs.length > 0, 'points drawn');
  assert.ok(
    canvasCalls.some((call) => call[0] === 'fillText'),
    'point labels drawn',
  );
  assert.match($('map-explained').textContent, /component/);
});

test('theme toggle flips the document theme and persists it', async () => {
  const button = $('theme-toggle');
  const before = window.document.documentElement.dataset.theme;
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const after = window.document.documentElement.dataset.theme;

  assert.notEqual(before, after);
  assert.ok(['dark', 'light'].includes(after));
  assert.equal(window.localStorage.getItem('tokenizer.theme'), after);
});

test('URL state is written for shareable links', async () => {
  await flush();
  const params = new URL(window.location.href).searchParams;
  assert.ok(params.get('t'), 'tokenization text is in the URL');
  assert.ok(params.get('a') && params.get('b'), 'both comparison texts are in the URL');
});

test('no uncaught errors during the whole run', () => {
  assert.deepEqual(errors, []);
});


/* ------------------------------------------------------------------------ */
/*  Chip rendering, exercised directly (no worker involved)                  */
/* ------------------------------------------------------------------------ */

test('renderChips marks fragments, whitespace and special tokens', async () => {
  const { renderChips, chipsText } = await import('../src/lib/chips.js');

  const chips = renderChips({
    ids: [11, 22, 33, 44, 55],
    // a byte fragment, a space token, a newline token, plain text, a special
    texts: ['', ' ', '\n', 'dog', '[SEP]'],
    specialIds: [55],
  });
  window.document.body.append(chips);
  const nodes = [...chips.querySelectorAll('.chip')];

  assert.equal(nodes[0].classList.contains('is-fragment'), true, 'fragment chip');
  assert.equal(nodes[0].textContent, '\u25CC', 'fragment shows a dotted circle');
  assert.equal(nodes[0].dataset.raw, '', 'fragment keeps its (empty) raw text');

  assert.equal(nodes[1].querySelector('.ws')?.textContent, '\u00B7', 'space rendered as a glyph');
  assert.equal(nodes[2].querySelector('.ws')?.textContent, '\u23CE', 'newline rendered as a glyph');

  assert.equal(nodes[3].textContent, 'dog');
  assert.equal(nodes[4].classList.contains('is-special'), true, 'special token chip');

  assert.equal(chipsText(chips), ' \ndog[SEP]', 'raw text still joins cleanly');

  chips.remove();
});


/* ------------------------------------------------------------------------ */
/*  Design system: structure and motion                                      */
/* ------------------------------------------------------------------------ */

test('the design system renders its structure', () => {
  const doc = window.document;

  assert.equal(doc.querySelectorAll('.hero-title .word').length, 4, 'hero headline is split into words');
  assert.equal(doc.querySelectorAll('.pipeline .stage').length, 4, 'the pipeline has four stages');
  assert.equal(doc.querySelectorAll('.rail-list a').length, 6, 'the index lists every section');
  assert.ok(doc.querySelector('.marquee-track'), 'the marquee band is present');
  assert.ok(doc.querySelector('.grain'), 'the paper grain plate is present');

  // Self-hosted type: no third-party font request anywhere.
  const fontLinks = [...doc.querySelectorAll('link[href*="fonts."]')];
  assert.equal(fontLinks.length, 0, 'fonts are self-hosted, not fetched from Google/CDN');
  const preload = doc.querySelector('link[rel="preload"][as="font"]');
  assert.ok(preload?.href.includes('fraunces'), 'the display face is preloaded');
});

test('reveals are marked visible and never hide content when JS runs', () => {
  const doc = window.document;
  const revealed = doc.querySelector('.panel-head.reveal');
  assert.ok(revealed.classList.contains('is-in'), 'in-view reveals are shown immediately');

  // Nothing may be left invisible by the reveal system.
  const hidden = [...doc.querySelectorAll('.reveal')].filter(
    (node) => !node.classList.contains('is-in'),
  );
  assert.equal(hidden.length, 0, `${hidden.length} reveal(s) never became visible`);
});

test('the section index marks the current section', () => {
  const current = [...window.document.querySelectorAll('.rail-list a[aria-current="true"]')];
  assert.ok(current.length > 0, 'a rail link is marked current');
  assert.match(current[0].getAttribute('href'), /^#/);
});

test('the rail progress line is wired to scroll position', () => {
  const fill = window.document.getElementById('rail-fill');
  assert.ok(fill, 'progress line exists');
  assert.ok(fill.style.height !== '', 'progress line has an initial height');
});

test('hero counters finish on the real numbers', async () => {
  await sleep(1400);
  const values = [...window.document.querySelectorAll('[data-count]')].map((node) => ({
    target: node.dataset.count,
    text: node.textContent,
  }));

  for (const value of values) {
    const expected = Number(value.target).toLocaleString('en-US');
    assert.equal(value.text, expected, `counter ${value.target} should settle on ${expected}`);
  }
});


test('token chips take their colour from the stylesheet', () => {
  const chips = [...window.document.querySelectorAll('#tok-chips .chip')];
  assert.ok(chips.length > 0, 'chips were rendered');

  for (const chip of chips) {
    assert.match(chip.dataset.tint ?? '', /^[1-6]$/, 'each chip carries a tint index');
    assert.equal(chip.style.background, '', 'no inline colour — the palette lives in CSS');
  }

  // Neighbouring tokens must not share a tint, or the boundary disappears.
  for (let index = 1; index < chips.length; index += 1) {
    assert.notEqual(chips[index].dataset.tint, chips[index - 1].dataset.tint);
  }
});
