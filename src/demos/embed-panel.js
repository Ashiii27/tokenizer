/**
 * Panel 4 — one pair of texts, one cosine score, explained.
 *
 * Improvements over the first version:
 *   • the maths line shows real numbers (normalisation included) instead of
 *     "1.0000 × 1.0000";
 *   • the dimension chart shows the dimensions that *drive the score*, i.e.
 *     the per-dimension products, not just text A's raw vector;
 *   • a >512-token warning, because MiniLM silently truncates;
 *   • one-tap "tricky pairs" that deliberately break intuition.
 */

import { $, el, mount, setStatus, showError, hideError, withBusy, describeError, announce } from '../lib/dom.js';
import { createProgressView } from '../lib/progress.js';
import { cosine, l2norm, dot, describeSimilarity, meterFraction, topShare } from '../lib/similarity.js';
import { formatScore, formatPercent, formatCount } from '../lib/format.js';
import { EMBEDDER, DEFAULT_PAIR, TRICKY_PAIRS } from '../lib/models.js';
import { persistState, writeUrlState } from '../lib/urlstate.js';

export function initEmbedPanel({ client, initial, onNeedModel }) {
  const progress = createProgressView({
    root: $('#emb-progress'),
    bar: $('#emb-bar'),
    file: $('#emb-file'),
    meta: $('#emb-overall'),
  });

  const status = $('#emb-status');
  const error = $('#emb-error');
  const button = $('#emb-btn');
  const loadButton = $('#emb-load');
  const results = $('#emb-results');
  const inputA = $('#emb-a');
  const inputB = $('#emb-b');

  inputA.value = initial?.a ?? DEFAULT_PAIR.a;
  inputB.value = initial?.b ?? DEFAULT_PAIR.b;

  let ready = false;
  let busy = false;
  let requestSeq = 0;

  /* ---- tricky pairs ---------------------------------------------------- */
  const pairsHost = $('#emb-pairs');
  for (const pair of TRICKY_PAIRS) {
    pairsHost.append(
      el(
        'button',
        {
          class: 'btn-ghost btn-small',
          type: 'button',
          title: pair.lesson,
          onclick: () => {
            inputA.value = pair.a;
            inputB.value = pair.b;
            run();
          },
        },
        pair.label,
      ),
    );
  }

  /* ---- model loading --------------------------------------------------- */
  let loadPromise = null;

  function load() {
    if (ready) return Promise.resolve();
    if (loadPromise) return loadPromise; // one download, many callers

    loadPromise = (async () => {
      busy = true;
      hideError(error);
      progress.reset();
      setStatus(status, 'Downloading the embedding model (~23 MB the first time)…');
      loadButton.disabled = true;

      try {
        await client.embed(EMBEDDER, ['warm up']);
        ready = true;
        progress.complete();
        const device = client.device === 'webgpu' ? 'WebGPU' : 'WebAssembly (CPU)';
        setStatus(status, `Model ready — 384-dim vectors, mean pooling, running on ${device}`, 'ok');
        button.disabled = false;
        loadButton.hidden = true;
        onNeedModel?.(client.device);
      } catch (err) {
        loadPromise = null; // allow a retry
        setStatus(status, 'Embedding model failed to load.', 'bad');
        showError(error, `Could not load ${EMBEDDER.repo}: ${describeError(err)}`);
      } finally {
        busy = false;
        loadButton.disabled = false;
      }
    })();

    return loadPromise;
  }

  /* ---- compare --------------------------------------------------------- */
  async function run() {
    const a = inputA.value.trim();
    const b = inputB.value.trim();
    hideError(error);

    if (!a || !b) {
      showError(error, 'Both texts are needed — two vectors make a comparison.');
      return;
    }
    if (!ready) {
      await load();
      if (!ready) return;
    }

    persistState({ embedA: inputA.value, embedB: inputB.value });
    writeUrlState({ embedA: inputA.value, embedB: inputB.value });

    const seq = ++requestSeq;

    try {
      const result = await withBusy(button, 'Embedding…', () =>
        client.embed(EMBEDDER, [a, b]),
      );
      if (seq !== requestSeq) return;
      const [vecA, vecB] = result.vectors;
      render(a, b, vecA, vecB, { tokenCounts: result.tokenCounts });
      announce(`Cosine similarity ${formatScore(cosine(vecA, vecB))}.`);
    } catch (err) {
      showError(error, `Embedding failed: ${describeError(err)}`);
    }
  }

  function render(a, b, vecA, vecB, meta = {}) {
    const sim = cosine(vecA, vecB);
    const dotProduct = dot(vecA, vecB);
    const normA = l2norm(vecA);
    const normB = l2norm(vecB);

    $('#sim-score').textContent = formatScore(sim);
    $('#sim-label').textContent = describeSimilarity(sim);
    $('#sim-fill').style.width = `${(meterFraction(sim) * 100).toFixed(2)}%`;

    $('#sim-math').textContent =
      `cos = (A·B) / (‖A‖‖B‖) = ${formatScore(dotProduct)} / (${formatScore(normA)} × ${formatScore(
        normB,
      )}) = ${formatScore(sim)}   ·   ${vecA.length} dimensions · ` +
      `top 10 dims contribute ${formatPercent(topShare(vecA, vecB, 10), 1)} of the total`;

    $('#sim-hint').textContent =
      'Two texts embedded separately, each L2-normalised to unit length — which is why the dot product and the cosine score agree. ' +
      'Compare against the tricky pairs above: antonyms and homonyms score high too, and that is the honest limit of a single vector.';

    // Which dimensions drive the score?
    const contributions = vecA
      .map((value, dim) => ({ dim, product: value * vecB[dim], a: value, b: vecB[dim] }))
      .sort((x, y) => Math.abs(y.product) - Math.abs(x.product))
      .slice(0, 12);

    mount($('#emb-dims'), contributions.map((item) => dimRow(item.dim, item.product, 3)));
    $('#emb-a-hint').textContent =
      `Text A " ${abbreviate(a)} " → ${vecA.length} numbers between -1 and 1. Bars are scaled to the largest value among the first 64.`;

    mount(
      $('#emb-vec-a'),
      vecA.slice(0, 64).map((value, index) => dimRow(index, value, 3)),
    );

    // Silent truncation guard: MiniLM reads 512 tokens and ignores the rest.
    const counts = meta.tokenCounts;
    const truncated = counts
      ? counts.map((count, index) => ({ count, index })).filter((item) => item.count > EMBEDDER.maxTokens)
      : [];

    if (truncated.length > 0) {
      const which = truncated
        .map((item) => `Text ${item.index === 0 ? 'A' : 'B'} (${formatCount(item.count)} tokens)`)
        .join(' and ');
      $('#emb-tokens-pill').textContent = 'truncated input';
      $('#emb-tokens-pill').style.color = 'var(--neg)';
      $('#emb-tokens-pill').style.borderColor = 'var(--neg)';
      $('#sim-hint').textContent =
        `⚠ ${which} exceed${truncated.length === 1 ? 's' : ''} this model's ${formatCount(
          EMBEDDER.maxTokens,
        )}-token limit, so only the beginning was embedded — the score describes that part, not the whole text. ` +
        $('#sim-hint').textContent;
    } else if (counts) {
      $('#emb-tokens-pill').textContent = `${formatCount(vecA.length)} dims · ${counts
        .map((count) => formatCount(count))
        .join(' / ')} tokens`;
    }

    results.hidden = false;
  }

  /* ---- wiring ---------------------------------------------------------- */
  button.addEventListener('click', run);
  loadButton.addEventListener('click', () => load().then(run));

  for (const input of [inputA, inputB]) {
    input.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        run();
      }
    });
  }

  return {
    load,
    run,
    get ready() {
      return ready;
    },
    onProgress: (data) => {
      if (ready) return;
      progress.update(data);
    },
    onFileProgress: (data) => {
      if (ready) return;
      progress.setFile(data);
    },
  };
}

function dimRow(index, value, digits) {
  return el(
    'div',
    { class: 'dim-row', title: `dimension ${index}: ${value.toFixed(6)}` },
    el('span', { class: 'dim-idx' }, String(index)),
    el(
      'div',
      { class: 'dim-track' },
      el('div', {
        class: `dim-bar ${value >= 0 ? 'pos' : 'neg'}`,
        style: { width: `${Math.abs(value) * 50}%` },
      }),
    ),
    el(
      'span',
      { class: 'dim-val' },
      `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`,
    ),
  );
}

function abbreviate(text, max = 26) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
