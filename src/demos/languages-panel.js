/**
 * Panel 3 — the same meaning in seven languages.
 *
 * English-centric tokenizers shred non-Latin scripts: Devanagari, Bengali,
 * Tamil and Han characters are 3 bytes each and often cost several tokens per
 * character. Same sentence, several times the price — that is context budget,
 * latency and API spend, not trivia.
 */

import { $, el, mount, setStatus, showError, hideError, withBusy, describeError, announce } from '../lib/dom.js';
import { formatCount, formatRatio, formatPercent } from '../lib/format.js';
import { TOKENIZERS, LANGUAGE_SAMPLES } from '../lib/models.js';
import { byteLength } from '../lib/tokens.js';

export function initLanguagesPanel({ client }) {
  const select = $('#lang-select');
  const button = $('#lang-btn');
  const status = $('#lang-status');
  const error = $('#lang-error');
  const results = $('#lang-results');
  const body = $('#lang-body');
  const note = $('#lang-note');
  const modelTag = $('#lang-model-tag');

  for (const model of TOKENIZERS) {
    select.append(
      el('option', { value: model.id }, `${model.label} — ${model.family}`),
    );
  }
  select.value = 'gpt2';
  button.disabled = false;

  select.addEventListener('change', () => {
    results.hidden = true;
    setStatus(status, '');
  });

  async function run() {
    const model = TOKENIZERS.find((item) => item.id === select.value) ?? TOKENIZERS[0];
    hideError(error);
    modelTag.textContent = model.label;

    try {
      const rows = await withBusy(button, 'Measuring…', async () => {
        setStatus(status, `Loading ${model.label} tokenizer…`);
        const measured = [];
        for (const sample of LANGUAGE_SAMPLES) {
          // eslint-disable-next-line no-await-in-loop
          const result = await client.tokenize(model, sample.text);
          measured.push({
            ...sample,
            tokens: result.ids.length,
            chars: [...sample.text].length,
            bytes: byteLength(sample.text),
            firstTokens: result.texts.slice(0, 12),
            ids: result.ids,
          });
        }
        return measured;
      });

      render(rows, model);
      setStatus(status, `Measured with ${model.label}`, 'ok');
    } catch (err) {
      setStatus(status, 'Measurement failed.', 'bad');
      showError(error, `Could not tokenize these samples: ${describeError(err)}`);
    }
  }

  function render(rows, model) {
    const english = rows.find((row) => row.code === 'en');
    const baseline = Math.max(1, english?.tokens ?? 1);
    const worst = Math.max(...rows.map((row) => row.tokens / baseline));

    mount(
      body,
      rows.map((row) => {
        const ratio = row.tokens / baseline;
        const isBaseline = row.code === 'en';
        return el(
          'tr',
          {},
          el(
            'th',
            { scope: 'row', style: { fontWeight: '600' } },
            row.label,
            el('span', { class: 'sub' }, row.note),
          ),
          el(
            'td',
            { style: { whiteSpace: 'normal', minWidth: '220px', maxWidth: '380px' } },
            row.text,
          ),
          el('td', { class: 'num' }, formatCount(row.tokens)),
          el('td', { class: 'num' }, formatCount(row.chars)),
          el('td', { class: 'num' }, formatRatio(row.chars / Math.max(1, row.tokens), 2)),
          el(
            'td',
            {},
            el(
              'div',
              { class: 'cost-bar' },
              el(
                'div',
                { class: 'track' },
                el('div', {
                  class: 'fill',
                  style: {
                    width: `${formatPercent(ratio / worst, 1).replace('%', '')}%`,
                    background: isBaseline ? 'var(--signal)' : undefined,
                  },
                }),
              ),
              el('span', { class: 'num' }, `${formatRatio(ratio, 2)}`),
            ),
          ),
        );
      }),
    );

    const dearest = [...rows].sort((a, b) => b.tokens - a.tokens)[0];
    const cheapest = [...rows].sort((a, b) => a.tokens - b.tokens)[0];
    note.textContent = `${cheapest.label} costs ${formatCount(cheapest.tokens)} tokens for this sentence; ${dearest.label} costs ${formatCount(
      dearest.tokens,
    )} — ${formatRatio(
      dearest.tokens / Math.max(1, cheapest.tokens),
      2,
    )} as many for the same meaning. Multiply by every request you serve and the "language gap" becomes a line item. ${model.family} vocabulary, ${model.repo}.`;

    results.hidden = false;
    announce(note.textContent);
  }

  button.addEventListener('click', run);

  return { run };
}
