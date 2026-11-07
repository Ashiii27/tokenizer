/**
 * Panel 5 — embed a whole corpus, then look at the similarity matrix.
 *
 * This is the mental model behind semantic search: embed everything, compare
 * every pair, rank by cosine. The nearest-neighbour panel is literally a
 * one-item retrieval system.
 */

import { $, el, mount, setStatus, showError, hideError, withBusy, describeError, announce } from '../lib/dom.js';
import { similarityMatrix, nearest, describeSimilarity } from '../lib/similarity.js';
import { formatScore, formatCount, truncate } from '../lib/format.js';
import { EMBEDDER, DEFAULT_CORPUS } from '../lib/models.js';
import { corpusStore } from '../lib/store.js';
import { persistState, writeUrlState } from '../lib/urlstate.js';

const MAX_ITEMS = 40;

export function initCorpusPanel({ client, ensureEmbedder, initial }) {
  const input = $('#corp-input');
  const button = $('#corp-btn');
  const reset = $('#corp-reset');
  const status = $('#corp-status');
  const error = $('#corp-error');
  const results = $('#corp-results');
  const matrixHost = $('#corp-matrix');
  const labelsHost = $('#corp-labels');
  const neighboursHost = $('#corp-neighbours');
  const countPill = $('#corp-count');
  const selectedLabel = $('#corp-selected-label');
  const matrixNote = $('#corp-matrix-note');

  input.value = initial ?? DEFAULT_CORPUS.join('\n');
  updateCount();

  function lines() {
    return input.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function updateCount() {
    const items = lines();
    countPill.textContent = `${formatCount(items.length)} text${items.length === 1 ? '' : 's'}`;
    button.disabled = items.length < 2 || items.length > MAX_ITEMS;
    if (items.length > MAX_ITEMS) {
      setStatus(status, `That is ${items.length} lines — ${MAX_ITEMS} is the limit here.`, 'bad');
    }
  }

  input.addEventListener('input', updateCount);

  async function run() {
    const texts = lines();
    hideError(error);

    if (texts.length < 2) {
      showError(error, 'Give me at least two lines — a matrix needs two rows.');
      return;
    }
    if (texts.length > MAX_ITEMS) {
      showError(error, `Please keep it to ${MAX_ITEMS} lines.`);
      return;
    }

    persistState({ corpus: input.value });
    writeUrlState({ corpus: input.value });

    corpusStore.set({ loading: true, error: '' });

    try {
      const vectors = await withBusy(button, 'Embedding…', async () => {
        setStatus(status, 'Loading the embedding model if needed…');
        await ensureEmbedder();
        setStatus(status, `Embedding ${formatCount(texts.length)} texts…`);
        const result = await client.embed(EMBEDDER, texts);
        return result.vectors;
      });

      const matrix = similarityMatrix(vectors);
      corpusStore.set({
        texts,
        vectors,
        matrix,
        dims: vectors[0]?.length ?? 0,
        selectedIndex: 0,
        loading: false,
        error: '',
      });

      render(texts, matrix);
      setStatus(status, `Embedded ${formatCount(texts.length)} texts · ${vectors[0]?.length ?? 0} dims each`, 'ok');
      results.hidden = false;
      announce(`Similarity matrix ready for ${texts.length} texts.`);
    } catch (err) {
      corpusStore.set({ loading: false, error: describeError(err) });
      setStatus(status, 'Embedding failed.', 'bad');
      showError(error, `Could not embed the corpus: ${describeError(err)}`);
    }
  }

  function render(texts, matrix) {
    const n = texts.length;

    // Row labels (also act as row selectors).
    mount(
      labelsHost,
      texts.map((text, index) =>
        el(
          'button',
          {
            class: 'matrix-label',
            type: 'button',
            title: text,
            'aria-label': `Select text ${index + 1}: ${text}`,
            onclick: () => select(index),
          },
          el('span', { class: 'idx' }, String(index + 1)),
          el('span', {}, truncate(text, 34)),
        ),
      ),
    );

    // Matrix cells.
    matrixHost.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    const cells = [];
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        const score = matrix[row][col];
        const strength = Math.max(0, Math.min(1, score));
        cells.push(
          el(
            'button',
            {
              type: 'button',
              class: 'matrix-cell',
              // The row labels are the keyboard path; 1,600 cells would be
              // 1,600 tab stops. Cells stay clickable and screen-reader visible.
              tabindex: '-1',
              title: `${row + 1} × ${col + 1} — ${formatScore(score, 3)}\n${truncate(
                texts[row],
                40,
              )}\n${truncate(texts[col], 40)}`,
              'aria-label': `Similarity between text ${row + 1} and ${col + 1}: ${formatScore(score, 3)}`,
              style: {
                background: `color-mix(in srgb, var(--signal) ${Math.round(
                  8 + strength * 88,
                )}%, var(--paper-raised))`,
                outlineColor: row === col ? 'var(--rule-2)' : undefined,
              },
              dataset: { row: String(row), col: String(col) },
              onclick: () => select(row),
            },
            score >= 0 ? score.toFixed(2).replace(/^0/, '') : score.toFixed(2),
          ),
        );
      }
    }
    mount(matrixHost, cells);

    matrixNote.textContent = `${n} × ${n} = ${formatCount(n * n)} comparisons from ${formatCount(n)} embeddings — one pass, reusable forever.`;

    select(0);
  }

  function select(index) {
    const { texts, matrix, vectors } = corpusStore.state;
    if (!matrix[index]) return;

    corpusStore.set({ selectedIndex: index });
    selectedLabel.textContent = `${index + 1} · ${truncate(texts[index], 46)}`;

    const neighbours = nearest(matrix, index, Math.min(5, texts.length - 1));
    mount(
      neighboursHost,
      neighbours.map((item, rank) =>
        el(
          'li',
          {},
          el('span', { class: 'rank' }, String(rank + 1)),
          el('span', { class: 'text', title: texts[item.index] }, truncate(texts[item.index], 70)),
          el('span', { class: 'score' }, formatScore(item.score)),
        ),
      ),
    );

    // Highlight the selected row/column.
    for (const cell of matrixHost.children) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.style.outlineColor =
        row === index || col === index ? 'var(--signal)' : 'transparent';
    }

    const best = neighbours[0];
    if (best) {
      matrixNote.textContent = `Text ${index + 1} is closest to text ${best.index + 1} (${formatScore(
        best.score,
      )} — ${describeSimilarity(best.score)}) out of ${formatCount(
        matrix.length - 1,
      )} other items. ${vectors.length ? `Each vector is ${vectors[0].length} numbers.` : ''}`;
    }
  }

  button.addEventListener('click', run);
  reset.addEventListener('click', () => {
    input.value = DEFAULT_CORPUS.join('\n');
    updateCount();
    results.hidden = true;
    setStatus(status, '');
    corpusStore.set({ texts: [], vectors: [], matrix: [], dims: 0, selectedIndex: 0 });
  });

  return { run, select };
}
