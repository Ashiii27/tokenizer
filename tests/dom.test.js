/**
 * End-to-end DOM tests, one document at a time.
 *
 * The real models can't run in CI (they live on the Hugging Face Hub), so the
 * worker is replaced by a fake that answers with the same message protocol.
 * Everything else — the actual HTML file, the page module, the panel, the
 * client RPC, the rendering code — is the real thing.
 *
 * Each page boots in its own JSDOM: that is the point of splitting the guide,
 * and it means a page can only pass if *its own* markup supports *its own*
 * module. Booting index.html alone would not prove that tokens.html works.
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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Poll until `check()` is true — rAF cadence in jsdom is not something to guess at. */
async function waitUntil(check, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  return check();
}

const flush = async (times = 12) => {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  }
};

/* ------------------------------------------------------------------------ */
/*  The harness                                                             */
/* ------------------------------------------------------------------------ */

let bootSequence = 0;
let workerStarts = 0;

/**
 * Boot one page: fresh window, fresh globals, real markup, real entry module.
 * The module is imported with a unique query so each page gets its own instance.
 */
async function bootPage(file) {
  const html = readFileSync(join(root, file), 'utf8');
  const dom = new JSDOM(html, {
    url: `https://example.test/tokenizer/${file}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  const canvasCalls = [];
  const workers = { count: 0 };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.MutationObserver = window.MutationObserver;

  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.navigator.clipboard = { writeText: async () => {} };

  // Canvas 2D is not implemented by jsdom; record calls so the map can be checked.
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

  // Everything counts as visible, which also exercises the lazy model load.
  window.IntersectionObserver = globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
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
      workers.count += 1;
      workerStarts += 1;
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

  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));

  const entry = html.match(/<script type="module" src="([^"]+)"><\/script>/)[1];
  let bootError = null;
  try {
    await import(`../${entry}?page=${(bootSequence += 1)}`);
  } catch (error) {
    bootError = error;
  }
  await flush();

  const $ = (id) => window.document.getElementById(id);

  return {
    file,
    window,
    document: window.document,
    $,
    errors,
    bootError,
    canvasCalls,
    workers,
    text: (id) => $(id)?.textContent ?? '',
  };
}

const click = (window, node) =>
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

/* ------------------------------------------------------------------------ */
/*  Landing page                                                            */
/* ------------------------------------------------------------------------ */

test('landing — boots without starting a model worker', async () => {
  const page = await bootPage('index.html');

  assert.equal(page.bootError, null, `index.html threw: ${page.bootError?.message}`);
  assert.deepEqual(page.errors, []);
  assert.equal(page.workers.count, 0, 'the landing page downloads no models at all');
  assert.equal(page.document.documentElement.dataset.theme, 'light', 'paper is the default theme');
});

test('landing — says what it is, then gets out of the way', async () => {
  const page = await bootPage('index.html');
  const doc = page.document;

  assert.equal(doc.querySelectorAll('.hero-title .word').length, 4, 'headline is split into words');
  assert.equal(doc.querySelectorAll('.pipeline .stage').length, 4, 'four-stage pipeline');

  const cards = [...doc.querySelectorAll('.chapter-link')];
  assert.equal(cards.length, 5, 'five chapters offered');
  assert.deepEqual(
    cards.map((card) => card.getAttribute('href')),
    ['tokens.html', 'tokenizers.html', 'languages.html', 'vectors.html', 'corpus.html'],
  );

  // Nothing is hidden behind the reveal system once JS has run.
  const hidden = [...doc.querySelectorAll('.reveal')].filter(
    (node) => !node.classList.contains('is-in'),
  );
  assert.deepEqual(hidden.map((node) => node.className), [], 'every reveal became visible');

  const facts = [...doc.querySelectorAll('[data-count]')];
  assert.ok(facts.length >= 3, 'the hero carries real numbers');

  const settled = await waitUntil(() =>
    facts.every((fact) => fact.textContent === Number(fact.dataset.count).toLocaleString('en-US')),
  );
  assert.ok(
    settled,
    `counters did not finish: ${facts.map((fact) => fact.textContent).join(' / ')}`,
  );
});

/* ------------------------------------------------------------------------ */
/*  Chapter 01 — tokens                                                     */
/* ------------------------------------------------------------------------ */

test('01 tokens — chips, stats and the round-trip invariant', async () => {
  const page = await bootPage('tokens.html');
  assert.equal(page.bootError, null, `tokens.html threw: ${page.bootError?.message}`);
  const { $ } = page;

  assert.equal($('tok-status').classList.contains('is-ok'), true, 'tokenizer status is ok');
  assert.equal($('tok-btn').disabled, false, 'tokenize button enabled');
  assert.equal($('tok-results').hidden, false, 'results are visible');
  assert.ok(Number(page.text('tok-count').replace(/,/g, '')) > 5, 'token count populated');

  const chips = [...$('tok-chips').querySelectorAll('.chip')];
  assert.ok(chips.length > 5, 'chips rendered');
  assert.equal(
    chips.map((chip) => chip.dataset.raw).join(''),
    $('tok-input').value,
    'chips rejoin to the input exactly',
  );
  assert.match(page.text('tok-roundtrip'), /✓/, 'the invariant is reported in the UI');

  assert.equal($('tok-stats').querySelectorAll('.stat').length, 5, 'five stat tiles');
  assert.ok(page.text('tok-ids').startsWith('['), 'IDs rendered as JSON');
  assert.match(page.text('tok-context-text'), /\/ 1,024 tokens/);

  assert.equal(chips[0].getAttribute('tabindex'), '0', 'one tab stop');
  assert.equal(chips[1].getAttribute('tabindex'), '-1');
  assert.ok(chips[0].getAttribute('aria-label').includes('Token'));

  click(page.window, chips[0]);
  assert.match(page.text('tok-detail'), /token id/i);

  // Tints come from the stylesheet, never from inline colours.
  for (const chip of chips) {
    assert.match(chip.dataset.tint ?? '', /^[1-6]$/, 'chip has a tint index');
    assert.equal(chip.style.background, '', 'no inline colour');
  }
  for (let index = 1; index < chips.length; index += 1) {
    assert.notEqual(chips[index].dataset.tint, chips[index - 1].dataset.tint);
  }

  assert.deepEqual(page.errors, []);
});

test('01 tokens — multilingual input still round-trips (the old bug)', async () => {
  const page = await bootPage('tokens.html');
  const { $ } = page;

  $('tok-input').value = 'नमस्ते दुनिया 🌏 你好';
  $('tok-input').dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await sleep(400); // the input handler is debounced
  await flush();

  const chips = [...$('tok-chips').querySelectorAll('.chip')];
  assert.equal(chips.map((chip) => chip.dataset.raw).join(''), $('tok-input').value);
  assert.match(page.text('tok-roundtrip'), /✓/);
});

test('01 tokens — sample buttons fill the textarea, and the URL stays shareable', async () => {
  const page = await bootPage('tokens.html');
  const button = page.$('tok-input').closest('.panel').querySelector('[data-sample="multilingual"]');
  click(page.window, button);
  await flush();

  assert.match(page.$('tok-input').value, /नमस्ते/);
  const params = new URL(page.window.location.href).searchParams;
  assert.ok(params.get('t'), 'tokenization text is in the URL');
});

/* ------------------------------------------------------------------------ */
/*  Chapter 02 — tokenizers                                                 */
/* ------------------------------------------------------------------------ */

test('02 tokenizers — one column per model, specials marked', async () => {
  const page = await bootPage('tokenizers.html');
  assert.equal(page.bootError, null, `tokenizers.html threw: ${page.bootError?.message}`);
  const { $ } = page;

  $('cmp-input').value = 'Antidisestablishmentarianism costs tokens everywhere.';
  click(page.window, $('cmp-btn'));
  await flush(20);

  const columns = [...$('cmp-grid').querySelectorAll('.compare-col')];
  assert.ok(columns.length >= 2, `expected comparison columns, got ${columns.length}`);
  assert.equal($('cmp-results').hidden, false);
  assert.match(page.text('cmp-summary'), /tokens/);

  const counts = [...$('cmp-grid').querySelectorAll('.count')].map((node) => node.textContent);
  assert.ok(counts.every((count) => count !== '—'), 'every column has a token count');

  const specials = $('cmp-grid').querySelectorAll('.chip.is-special');
  assert.ok(specials.length > 0, 'special tokens are marked, not merged into the text');
  assert.match(specials[0].textContent, /\[CLS\]|\[SEP\]/);
  assert.deepEqual(page.errors, []);
});

/* ------------------------------------------------------------------------ */
/*  Chapter 03 — languages                                                  */
/* ------------------------------------------------------------------------ */

test('03 languages — a row per sample, with a cost column', async () => {
  const page = await bootPage('languages.html');
  assert.equal(page.bootError, null, `languages.html threw: ${page.bootError?.message}`);
  const { $ } = page;

  click(page.window, $('lang-btn'));
  await flush(20);

  const rows = [...$('lang-body').querySelectorAll('tr')];
  assert.ok(rows.length >= 7, `expected a row per language, got ${rows.length}`);
  assert.equal($('lang-results').hidden, false);

  const tokens = [...$('lang-body').querySelectorAll('td.num')].map((cell) => cell.textContent);
  assert.ok(tokens.some((value) => Number(value.replace(/,/g, '')) > 0), 'token counts rendered');
  assert.match(page.text('lang-note'), /tokens/);
  assert.deepEqual(page.errors, []);
});

/* ------------------------------------------------------------------------ */
/*  Chapter 04 — vectors                                                    */
/* ------------------------------------------------------------------------ */

test('04 vectors — downloading on first use, then cosine and dimensions', async () => {
  const page = await bootPage('vectors.html');
  assert.equal(page.bootError, null, `vectors.html threw: ${page.bootError?.message}`);
  const { $ } = page;

  assert.equal($('emb-btn').disabled, false, 'compare is usable immediately — it loads on demand');
  assert.equal(page.workers.count, 1, 'the worker starts, but no model is fetched yet');

  click(page.window, $('emb-btn'));
  await flush(30);

  assert.equal($('emb-results').hidden, false);
  assert.match(page.text('sim-score'), /^-?\d\.\d{4}$/);
  assert.match(page.text('sim-math'), /cos = \(A·B\)/);
  assert.match(page.text('sim-math'), /384 dimensions/);
  assert.equal($('emb-dims').querySelectorAll('.dim-row').length, 12, 'twelve contribution rows');
  assert.equal($('emb-vec-a').querySelectorAll('.dim-row').length, 64, '64 dimensions shown');

  const params = new URL(page.window.location.href).searchParams;
  assert.ok(params.get('a') && params.get('b'), 'both texts are in the URL');
  assert.deepEqual(page.errors, []);
});

test('04 vectors — the theme toggle flips the theme and persists it', async () => {
  const page = await bootPage('vectors.html');
  const before = page.document.documentElement.dataset.theme;

  click(page.window, page.$('theme-toggle'));
  const after = page.document.documentElement.dataset.theme;

  assert.notEqual(before, after);
  assert.ok(['dark', 'light'].includes(after));
  assert.equal(page.window.localStorage.getItem('tokenizer.theme'), after);
});

/* ------------------------------------------------------------------------ */
/*  Chapter 05 — corpus and map                                             */
/* ------------------------------------------------------------------------ */

test('05 corpus — the matrix, the neighbours and the map all come from one run', async () => {
  const page = await bootPage('corpus.html');
  assert.equal(page.bootError, null, `corpus.html threw: ${page.bootError?.message}`);
  const { $ } = page;

  click(page.window, $('corp-btn'));
  await flush(30);

  assert.equal($('corp-results').hidden, false);
  const lines = $('corp-input').value.split('\n').filter(Boolean).length;
  const cells = $('corp-matrix').querySelectorAll('.matrix-cell');
  assert.equal(cells.length, lines * lines, 'an n×n matrix');
  assert.equal($('corp-labels').querySelectorAll('.matrix-label').length, lines);

  const neighbours = [...$('corp-neighbours').querySelectorAll('li')];
  assert.ok(neighbours.length > 0, 'neighbours listed');
  assert.match($('corp-neighbours').textContent, /\.\d{3}/, 'scores are shown');

  click(page.window, $('corp-labels').querySelectorAll('.matrix-label')[1]);
  await flush();
  assert.match(page.text('corp-selected-label'), /^2 ·/);

  // The map is on the same page and reads the same store.
  assert.equal($('map-empty').hidden, true, 'the empty state is gone');
  assert.ok(
    page.canvasCalls.filter((call) => call[0] === 'arc').length > 0,
    'points drawn on the canvas',
  );
  assert.ok(
    page.canvasCalls.some((call) => call[0] === 'fillText'),
    'point labels drawn',
  );
  assert.match(page.text('map-explained'), /component/);
  assert.deepEqual(page.errors, []);
});

/* ------------------------------------------------------------------------ */
/*  Navigation                                                              */
/* ------------------------------------------------------------------------ */

test('every chapter marks itself in the top nav and in the rail', async () => {
  for (const file of ['tokens.html', 'tokenizers.html', 'languages.html', 'vectors.html', 'corpus.html']) {
    // eslint-disable-next-line no-await-in-loop
    const page = await bootPage(file);
    const current = [...page.document.querySelectorAll('[aria-current="page"]')];
    const hrefs = current.map((node) => node.getAttribute('href'));

    assert.ok(hrefs.length >= 2, `${file}: marked in both navs`);
    assert.ok(hrefs.every((href) => href === file), `${file}: only itself is current (${hrefs})`);
    assert.equal(
      page.document.querySelector('.pager-next')?.getAttribute('href') !== file,
      true,
      `${file}: the pager goes somewhere else`,
    );
  }
});

test('no uncaught errors on any page', async () => {
  for (const file of ['index.html', 'tokens.html', 'corpus.html']) {
    // eslint-disable-next-line no-await-in-loop
    const page = await bootPage(file);
    // eslint-disable-next-line no-await-in-loop
    await flush();
    assert.deepEqual(page.errors, [], `${file} raised an uncaught error`);
  }
});

/* ------------------------------------------------------------------------ */
/*  Chip rendering, exercised directly (no worker involved)                  */
/* ------------------------------------------------------------------------ */

test('renderChips marks fragments, whitespace and special tokens', async () => {
  const page = await bootPage('index.html');
  const { renderChips, chipsText } = await import('../src/lib/chips.js');

  const chips = renderChips({
    ids: [11, 22, 33, 44, 55],
    // a byte fragment, a space token, a newline token, plain text, a special
    texts: ['', ' ', '\n', 'dog', '[SEP]'],
    specialIds: [55],
  });
  page.document.body.append(chips);
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
