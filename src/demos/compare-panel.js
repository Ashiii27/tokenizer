/**
 * Panel 2 — side-by-side tokenizer comparison.
 *
 * Each column loads independently, so one model failing (a renamed Hub repo,
 * a flaky fetch) never blanks the panel. The summary line turns the columns
 * into the number that actually matters: how much more expensive the worst
 * tokenizer is for the same text.
 */

import { $, el, mount, setStatus, showError, hideError, withBusy, describeError, announce } from '../lib/dom.js';
import { renderChips } from '../lib/chips.js';
import { formatCount, formatRatio, formatPercent } from '../lib/format.js';
import { TOKENIZERS } from '../lib/models.js';
import { persistState, writeUrlState } from '../lib/urlstate.js';

export function initComparePanel({ client, getText }) {
  const host = $('#cmp-models');
  const input = $('#cmp-input');
  const button = $('#cmp-btn');
  const loadButton = $('#cmp-load');
  const status = $('#cmp-status');
  const error = $('#cmp-error');
  const results = $('#cmp-results');
  const grid = $('#cmp-grid');
  const summary = $('#cmp-summary');

  const selected = new Set(TOKENIZERS.filter((model) => model.defaultOn).map((model) => model.id));

  /* ---- model checkboxes ------------------------------------------------ */
  for (const model of TOKENIZERS) {
    const id = `cmp-${model.id}`;
    const label = el(
      'label',
      { class: 'check', for: id, title: `${model.repo} · ${model.family} · ${formatCount(model.vocab)} tokens` },
      el('input', {
        type: 'checkbox',
        id,
        checked: selected.has(model.id),
        onchange: (event) => {
          if (event.currentTarget.checked) selected.add(model.id);
          else selected.delete(model.id);
          button.disabled = selected.size === 0;
        },
      }),
      model.label,
    );
    host.append(label);
  }

  button.disabled = selected.size === 0;

  /* ---- run ------------------------------------------------------------- */
  async function run() {
    const text = input.value;
    hideError(error);

    if (!text.trim()) {
      showError(error, 'Type something to compare first.');
      input.focus();
      return;
    }

    const models = TOKENIZERS.filter((model) => selected.has(model.id));
    if (models.length === 0) {
      showError(error, 'Pick at least one tokenizer.');
      return;
    }

    persistState({ compare: text });
    writeUrlState({});

    button.disabled = true;
    loadButton.disabled = true;
    setStatus(status, `Tokenizing with ${models.length} tokenizers…`);

    // Pre-render every column in a loading state, then fill them in.
    const columns = new Map();
    mount(grid, models.map((model) => {
      const column = buildColumn(model);
      columns.set(model.id, column);
      return column.node;
    }));
    results.hidden = false;
    summary.textContent = '';

    const counts = [];

    for (const model of models) {
      const column = columns.get(model.id);
      column.setStatus('loading…');
      try {
        // Sequential on purpose: it keeps the network sane and lets columns
        // appear one by one instead of all-or-nothing.
        // eslint-disable-next-line no-await-in-loop
        // The comparison shows what each model *receives*, so special tokens
        // ([CLS]/[SEP] for BERT, <s> for Llama, none for GPT-2) are included.
        const result = await client.tokenize(model, text, { addSpecialTokens: true });
        column.fill(result);
        counts.push({ model, tokens: result.ids.length });
      } catch (err) {
        column.fail(describeError(err));
      }
    }

    button.disabled = false;
    loadButton.disabled = false;

    if (counts.length === 0) {
      setStatus(status, 'No tokenizer could be loaded.', 'bad');
      summary.textContent = '';
      return;
    }

    setStatus(status, `Done — ${counts.length} of ${models.length} tokenizers loaded`, 'ok');

    const sorted = [...counts].sort((a, b) => a.tokens - b.tokens);
    const cheapest = sorted[0];
    const dearest = sorted[sorted.length - 1];
    summary.textContent =
      sorted.length > 1
        ? `${cheapest.model.label} needs ${formatCount(cheapest.tokens)} tokens; ${dearest.model.label} needs ${formatCount(
            dearest.tokens,
          )} — ${formatRatio(dearest.tokens / Math.max(1, cheapest.tokens), 2)} more for the same text.`
        : `${cheapest.model.label} needs ${formatCount(cheapest.tokens)} tokens for this text.`;

    announce(summary.textContent);
    loadButton.textContent = 'Reload selected tokenizers';
  }

  function buildColumn(model) {
    const countEl = el('span', { class: 'count' }, '—');
    const fill = el('div', { class: 'ratio-fill', style: { width: '0%' } });
    const statusEl = el('div', { class: 'col-status' }, `${model.family} · ${formatCount(model.vocab)} vocab`);
    const chipHost = el('div');

    const node = el(
      'div',
      { class: 'compare-col' },
      el('header', {}, el('h4', {}, model.label), el('span', { class: 'meta' }, model.era)),
      el('div', {}, countEl, el('span', { class: 'meta' }, ' tokens')),
      el('div', { class: 'ratio-track' }, fill),
      statusEl,
      chipHost,
    );

    return {
      node,
      setStatus(text, bad = false) {
        statusEl.textContent = text;
        statusEl.classList.toggle('is-bad', bad);
      },
      fail(message) {
        statusEl.classList.add('is-bad');
        statusEl.textContent = `unavailable — ${message}`;
        countEl.textContent = '—';
      },
      fill(result) {
        const tokens = result.ids.length;
        countEl.textContent = formatCount(tokens);
        statusEl.textContent = `${model.family} · ${formatCount(model.vocab)} vocab · ${formatRatio(
          tokens / Math.max(1, [...result.full].length),
          2,
        )} tokens/char`;
        chipHost.replaceChildren(
          renderChips({
            ids: result.ids,
            texts: result.texts,
            compact: true,
            specialIds: result.specialIds ?? [],
          }),
        );

        const specialCount = result.ids.filter((id) => (result.specialIds ?? []).includes(id)).length;
        if (specialCount > 0) {
          statusEl.textContent += ` · +${specialCount} special`;
        }
        chipHost.style.marginTop = '8px';

        // Bar is relative to the longest column, computed in run() via CSS var.
        fill.style.width = '100%';
        fill.dataset.tokens = String(tokens);
        rescale();
      },
    };
  }

  function rescale() {
    const fills = [...grid.querySelectorAll('.ratio-fill')];
    const max = Math.max(1, ...fills.map((f) => Number(f.dataset.tokens ?? 0)));
    for (const fill of fills) {
      const tokens = Number(fill.dataset.tokens ?? 0);
      if (!tokens) continue;
      fill.style.width = `${formatPercent(tokens / max, 1).replace('%', '')}%`;
      fill.parentElement.title = `${formatCount(tokens)} tokens (${formatPercent(tokens / max, 0)} of the largest)`;
    }
  }

  /* ---- wiring ---------------------------------------------------------- */
  button.addEventListener('click', run);
  loadButton.addEventListener('click', () => {
    if (selected.size) run();
  });

  input.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });

  // Keep the comparison in sync with panel 1 unless the user edited it here.
  let dirty = false;
  input.addEventListener('input', () => {
    dirty = true;
  });

  return {
    setText(text) {
      if (dirty || input.value === text) return;
      input.value = text;
    },
  };
}
