/**
 * ============================================================================
 *  How LLMs read text — tokenization & embeddings, live in the browser
 * ============================================================================
 *  Section 1 — Tokenization:
 *      AutoTokenizer (Xenova/gpt2) turns text into token IDs.
 *
 *  Section 2 — Embeddings & similarity:
 *      feature-extraction pipeline (Xenova/all-MiniLM-L6-v2) turns text into
 *      normalized 384-dim vectors; cosine similarity = their dot product.
 *
 *  No framework, no build step. Transformers.js v2.17.2 is imported as an ES
 *  module straight from the jsDelivr CDN; model weights are fetched from the
 *  Hugging Face Hub and kept in the browser's Cache Storage.
 */

import { AutoTokenizer, pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// This page is served as plain static files — there is no local `/models/`
// directory — so always fetch model files from the Hugging Face Hub.
env.allowLocalModels = false;

/* ------------------------------------------------------------------------ */
/*  Tiny DOM helpers                                                         */
/* ------------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function setStatus(id, text, kind = 'loading') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = false;
}

function clearError(id) {
  const el = $(id);
  el.textContent = '';
  el.hidden = true;
}

function describeError(err) {
  if (err instanceof Error) return err.message;
  if (err && typeof err.toString === 'function') return err.toString();
  return 'Unknown error';
}

/** Keep the UI snappy: cap how much text we'll tokenize in one click. */
const MAX_TOKENIZE_CHARS = 5000;

/* ========================================================================== */
/*  Section 1 — Tokenization (GPT-2)                                           */
/* ========================================================================== */

/** Rotating palette so adjacent chips never share a background color. */
const CHIP_COLORS = [
  '#79c0ff', // blue
  '#ffa657', // orange
  '#7ee787', // green
  '#d2a8ff', // purple
  '#e3b341', // yellow
  '#56d4dd', // cyan
  '#ff9bce', // pink
  '#ff7b72', // red
];

let tokenizer = null;

async function initTokenizer() {
  setStatus('tok-status', 'Loading the GPT-2 tokenizer from the Hugging Face Hub…');
  try {
    tokenizer = await AutoTokenizer.from_pretrained('Xenova/gpt2');
    setStatus('tok-status', 'Tokenizer ready — Xenova/gpt2 · 50,257-token vocabulary', 'ok');
    $('tok-btn').disabled = false;
    // Show the concept immediately by tokenizing the sample text once.
    tokenize();
  } catch (err) {
    setStatus('tok-status', 'Tokenizer failed to load.', 'bad');
    showError('tok-error', `Could not load the GPT-2 tokenizer: ${describeError(err)}`);
  }
}

function tokenize() {
  clearError('tok-error');

  const text = $('tok-input').value;
  if (!text.trim()) {
    showError('tok-error', 'Type some text first — there is nothing to tokenize.');
    $('tok-input').focus();
    return;
  }
  if (text.length > MAX_TOKENIZE_CHARS) {
    showError('tok-error',
      `That's ${text.length.toLocaleString()} characters — please keep it under ` +
      `${MAX_TOKENIZE_CHARS.toLocaleString()} so the browser stays responsive.`);
    return;
  }
  if (!tokenizer) {
    showError('tok-error', 'The tokenizer is still loading — try again in a few seconds.');
    return;
  }

  const button = $('tok-btn');
  button.disabled = true;
  button.textContent = 'Tokenizing…';

  try {
    // `tokenizer(text)` encodes the string; `input_ids` is an int64 tensor
    // (BigInt64Array) holding one vocabulary ID per token.
    const { input_ids } = tokenizer(text);
    const ids = Array.from(input_ids.data, Number);

    // One colored chip per token, showing that token decoded back to text.
    const chips = document.createDocumentFragment();
    for (let i = 0; i < ids.length; i++) {
      // Decode just this ID. Spaces/newlines are kept (no punctuation
      // clean-up), so the chip shows exactly what the token represents.
      const decoded = tokenizer.decode([ids[i]], {
        skip_special_tokens: false,
        clean_up_tokenization_spaces: false,
      });

      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.backgroundColor = CHIP_COLORS[i % CHIP_COLORS.length];
      chip.textContent = decoded.length > 0 ? decoded : '(empty)';
      chip.title = `Token ID ${ids[i]} — ${JSON.stringify(decoded)}`;
      chips.appendChild(chip);
    }
    $('tok-chips').replaceChildren(chips);

    $('tok-count').textContent = String(ids.length);
    $('tok-ids').textContent = JSON.stringify(ids);
    $('tok-results').hidden = false;
  } catch (err) {
    showError('tok-error', `Tokenization failed: ${describeError(err)}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Tokenize';
  }
}

/* ========================================================================== */
/*  Section 2 — Embeddings & similarity (all-MiniLM-L6-v2)                     */
/* ========================================================================== */

let embedder = null;

/** Per-file download percentages, used to compute the overall progress bar. */
const fileProgress = new Map();

/**
 * `progress_callback` for the pipeline. Receives events like:
 *   { status: 'initiate' | 'download' | 'progress' | 'done', name, file,
 *     progress?, loaded?, total? }
 * `file` is unique per file (e.g. "onnx/model_quantized.onnx").
 */
function handleEmbedProgress(data) {
  if (!data || !data.status) return;

  const file = data.file ?? data.name ?? 'model';

  switch (data.status) {
    case 'initiate':
    case 'download':
      if (!fileProgress.has(file)) fileProgress.set(file, 0);
      break;
    case 'progress':
      fileProgress.set(file, data.progress ?? 0);
      $('emb-file').textContent = `${file} — ${(data.progress ?? 0).toFixed(1)}%`;
      break;
    case 'done':
      fileProgress.set(file, 100);
      break;
    // 'ready' arrives when the whole pipeline is constructed — handled below.
  }

  const values = [...fileProgress.values()];
  const overall = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;

  $('emb-bar').style.width = `${Math.min(100, Math.max(0, overall)).toFixed(1)}%`;
  $('emb-overall').textContent =
    `overall ${overall.toFixed(0)}% · ${values.length} file${values.length === 1 ? '' : 's'}`;
}

async function initEmbedder() {
  try {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: handleEmbedProgress,
    });
    $('emb-bar').style.width = '100%';
    $('emb-progress').hidden = true;
    setStatus('emb-status', 'Embedding model ready — 384-dim vectors, mean pooling', 'ok');
    $('emb-btn').disabled = false;
  } catch (err) {
    setStatus('emb-status', 'Embedding model failed to load.', 'bad');
    showError('emb-error', `Could not load the MiniLM embedding model: ${describeError(err)}`);
  }
}

function describeSimilarity(sim) {
  if (sim >= 0.75) return 'very similar meaning';
  if (sim >= 0.5) return 'fairly similar meaning';
  if (sim >= 0.25) return 'topically related';
  if (sim >= 0) return 'largely unrelated';
  return 'negatively related (rare)';
}

async function compare() {
  clearError('emb-error');

  const textA = $('emb-a').value;
  const textB = $('emb-b').value;

  if (!textA.trim() || !textB.trim()) {
    showError('emb-error', 'Enter text in both Text A and Text B — two vectors are needed to compare.');
    return;
  }
  if (!embedder) {
    showError('emb-error', 'The embedding model is still downloading — watch the progress bar above.');
    return;
  }

  const button = $('emb-btn');
  button.disabled = true;
  button.textContent = 'Embedding…';

  try {
    // Mean-pool the token-level outputs into one vector per text, then
    // L2-normalize it to unit length.
    const outputA = await embedder(textA, { pooling: 'mean', normalize: true });
    const outputB = await embedder(textB, { pooling: 'mean', normalize: true });
    const vecA = Array.from(outputA.data, Number);
    const vecB = Array.from(outputB.data, Number);

    // Unit vectors ⇒ dot product == cosine similarity.
    let dot = 0;
    const n = Math.min(vecA.length, vecB.length);
    for (let i = 0; i < n; i++) dot += vecA[i] * vecB[i];

    const normA = Math.sqrt(vecA.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(vecB.reduce((s, v) => s + v * v, 0));
    const similarity = dot; // == dot / (normA * normB) since norms are 1

    $('sim-score').textContent = similarity.toFixed(4);
    $('sim-label').textContent = describeSimilarity(similarity);
    // Meter is a 0→1 gauge; clamp the (rare) negative case to 0.
    $('sim-fill').style.width = `${(Math.max(0, Math.min(1, similarity)) * 100).toFixed(2)}%`;
    $('sim-math').textContent =
      `cos(A,B) = A·B / (‖A‖·‖B‖) = ${dot.toFixed(4)} / (${normA.toFixed(4)} × ${normB.toFixed(4)}) = ${similarity.toFixed(4)}`;

    renderDimensionChart(vecA);
    $('emb-results').hidden = false;
  } catch (err) {
    showError('emb-error', `Embedding or comparison failed: ${describeError(err)}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Compare';
  }
}

/**
 * Horizontal CSS bar chart of the first 64 dimensions of an embedding.
 * Positive values grow right of the zero axis, negative values grow left;
 * lengths are scaled to the max absolute value among the 64 shown dims.
 */
function renderDimensionChart(vector) {
  const dims = vector.slice(0, 64);
  const maxAbs = Math.max(1e-8, ...dims.map(Math.abs));

  const rows = document.createDocumentFragment();
  dims.forEach((value, i) => {
    const row = document.createElement('div');
    row.className = 'dim-row';

    const index = document.createElement('span');
    index.className = 'dim-idx';
    index.textContent = String(i);
    row.appendChild(index);

    const track = document.createElement('div');
    track.className = 'dim-track';
    const bar = document.createElement('div');
    bar.className = `dim-bar ${value >= 0 ? 'pos' : 'neg'}`;
    // Longest possible bar is half the track (50%), starting at the center.
    bar.style.width = `${(Math.abs(value) / maxAbs) * 50}%`;
    bar.title = `dimension ${i}: ${value.toFixed(6)}`;
    track.appendChild(bar);
    row.appendChild(track);

    const val = document.createElement('span');
    val.className = 'dim-val';
    val.textContent = `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}`;
    row.appendChild(val);

    rows.appendChild(row);
  });

  $('dim-chart').replaceChildren(rows);
}

/* ------------------------------------------------------------------------ */
/*  Wire it all up                                                           */
/* ------------------------------------------------------------------------ */

$('tok-btn').addEventListener('click', tokenize);
$('emb-btn').addEventListener('click', compare);

// Cmd/Ctrl + Enter in any textarea triggers that section's action.
function bindShortcut(textareaId, buttonId) {
  $(textareaId).addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      $(buttonId).click();
    }
  });
}
bindShortcut('tok-input', 'tok-btn');
bindShortcut('emb-a', 'emb-btn');
bindShortcut('emb-b', 'emb-btn');

// The tokenizer (small, ~1 MB) loads right away; the embedding model
// (~23 MB) downloads in the background without blocking anything. The two
// sections load — and fail — completely independently of each other.
initTokenizer();
initEmbedder();
