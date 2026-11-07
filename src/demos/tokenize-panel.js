/**
 * Panel 1 — tokenization.
 *
 * Shows the token chips, the IDs, per-token detail, and a context-window
 * meter. Also verifies the round-trip invariant (chips → original text) in
 * the UI, because that invariant is exactly what used to break on Hindi,
 * Chinese and emoji.
 */

import { $, el, mount, setStatus, showError, hideError, withBusy, copyText, describeError, debounce, announce } from '../lib/dom.js';
import { renderChips, chipsText } from '../lib/chips.js';
import { tokenStats, contextUsage, byteLength } from '../lib/tokens.js';
import { formatCount, formatRatio } from '../lib/format.js';
import { SAMPLES } from '../lib/models.js';
import { persistState, writeUrlState } from '../lib/urlstate.js';

const MAX_CHARS = 6000;

export function initTokenizePanel({ client, model, getInitialText, onTextChange }) {
  const input = $('#tok-input');
  const button = $('#tok-btn');
  const status = $('#tok-status');
  const error = $('#tok-error');
  const results = $('#tok-results');
  const chipsHost = $('#tok-chips');
  const statsHost = $('#tok-stats');
  const detail = $('#tok-detail');
  const ids = $('#tok-ids');
  const count = $('#tok-count');
  const roundTrip = $('#tok-roundtrip');
  const contextFill = $('#tok-context-fill');
  const contextText = $('#tok-context-text');
  const contextNote = $('#tok-context-note');

  let last = null;
  let loading = false;
  let requestSeq = 0;
  const defaultHint = $('#tok-hint').textContent;

  /* ---- load ------------------------------------------------------------ */
  setStatus(status, 'Loading the GPT-2 tokenizer…');

  (async () => {
    try {
      loading = true;
      await client.loadTokenizer(model);
      loading = false;
      const size = formatCount(model.vocab);
      setStatus(status, `Tokenizer ready — ${model.repo} · ${size}-token vocabulary`, 'ok');
      button.disabled = false;
      if (!input.value.trim()) input.value = getInitialText();
      if (input.value.trim()) run();
    } catch (err) {
      loading = false;
      setStatus(status, 'Tokenizer failed to load.', 'bad');
      showError(error, `Could not load the tokenizer: ${describeError(err)}`);
    }
  })();

  /* ---- tokenize -------------------------------------------------------- */
  async function run() {
    const text = input.value;
    hideError(error);

    if (!text.trim()) {
      showError(error, 'Type some text first — there is nothing to tokenize.');
      input.focus();
      return;
    }
    if (text.length > MAX_CHARS) {
      showError(
        error,
        `That is ${formatCount(text.length)} characters. Please stay under ${formatCount(
          MAX_CHARS,
        )} so the page keeps up.`,
      );
      return;
    }

    persistState({ tokens: text });
    writeUrlState({ tokens: text });
    onTextChange?.(text);

    // Live typing fires requests faster than the worker can answer; only the
    // newest one is allowed to touch the DOM.
    const seq = ++requestSeq;

    try {
      const result = await withBusy(button, 'Tokenizing…', () => client.tokenize(model, text));
      if (seq !== requestSeq) return;
      last = result;
      render(result, text);
      announce(`Tokenized into ${formatCount(result.ids.length)} tokens.`);
    } catch (err) {
      showError(error, `Tokenization failed: ${describeError(err)}`);
    }
  }

  function render(result, text) {
    const stats = tokenStats({ text, ids: result.ids, texts: result.texts });
    const usage = contextUsage(result.ids.length, model.context);

    mount(
      statsHost,
      stat('tokens', formatCount(stats.tokens)),
      stat('characters', formatCount(stats.chars)),
      stat('bytes (UTF-8)', formatCount(stats.bytes)),
      stat('tokens / word', stats.words ? formatRatio(stats.tokensPerWord, 2) : '—'),
      stat('chars / token', formatRatio(stats.charsPerToken, 2)),
    );

    count.textContent = formatCount(result.ids.length);

    let selected = -1;
    const chips = renderChips({
      ids: result.ids,
      texts: result.texts,
      onSelect: (index) => {
        selected = index;
        showDetail(result, index);
      },
    });
    mount(chipsHost, chips);

    // The invariant the old implementation silently broke.
    const rebuilt = chipsText(chips);
    const matches = rebuilt === result.full;
    roundTrip.textContent = matches
      ? `✓ chips rejoin to exactly ${formatCount([...rebuilt].length)} characters`
      : '⚠ chips do not rejoin cleanly';
    roundTrip.style.color = matches ? 'var(--ok)' : 'var(--bad)';

    $('#tok-hint').textContent = result.truncated
      ? `Showing the first ${formatCount(result.renderLimit)} of ${formatCount(
          result.ids.length,
        )} tokens — the count and the IDs below are complete.`
      : defaultHint;

    ids.textContent = JSON.stringify(result.ids);

    contextFill.style.width = `${Math.min(100, usage.ratio * 100).toFixed(1)}%`;
    contextFill.classList.toggle('is-over', usage.over);
    contextText.textContent = usage.over
      ? `${formatCount(result.ids.length)} / ${formatCount(model.context)} tokens — over the limit`
      : `${formatCount(result.ids.length)} / ${formatCount(model.context)} tokens`;
    contextNote.textContent = usage.over
      ? `${formatCount(result.ids.length - model.context)} tokens would be dropped`
      : `${formatCount(usage.remaining)} tokens left · ${model.label} context window`;

    detail.textContent = 'Select a token above to see its ID, bytes and position.';
    results.hidden = false;
    if (selected >= 0) showDetail(result, selected);
  }

  function showDetail(result, index) {
    const text = result.texts[index] ?? '';
    const id = result.ids[index];
    const bytes = byteLength(text);
    const isFragment = text === '';

    mount(
      detail,
      el(
        'dl',
        {},
        el('dt', {}, 'index'),
        el('dd', {}, `${formatCount(index)} of ${formatCount(result.ids.length - 1)}`),
        el('dt', {}, 'token id'),
        el('dd', {}, String(id)),
        el('dt', {}, 'text'),
        el('dd', {}, isFragment ? '(byte fragment — no character yet)' : JSON.stringify(text)),
        el('dt', {}, 'bytes'),
        el('dd', {}, `${bytes} byte${bytes === 1 ? '' : 's'} · ${[...text].length} character${
          [...text].length === 1 ? '' : 's'
        }`),
        el('dt', {}, 'status'),
        el(
          'dd',
          {},
          isFragment
            ? `this token carries part of a UTF-8 character; token ${formatCount(index + 1)} completes it`
            : 'complete character sequence',
        ),
      ),
    );
  }

  /* ---- wiring ---------------------------------------------------------- */
  button.addEventListener('click', run);

  input.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      button.click();
    }
  });

  // Live tokenization: cheap because the tokenizer lives in the worker.
  input.addEventListener(
    'input',
    debounce(() => {
      if (!loading && input.value.trim() && input.value.length <= MAX_CHARS) run();
    }, 320),
  );

  for (const sample of document.querySelectorAll('[data-sample]')) {
    sample.addEventListener('click', () => {
      input.value = SAMPLES[sample.dataset.sample] ?? '';
      run();
    });
  }

  $('#tok-copy').addEventListener('click', (event) => {
    if (last) copyText(JSON.stringify(last.ids), event.currentTarget);
  });

  return {
    get text() {
      return last?.full ?? input.value;
    },
  };
}

function stat(label, value) {
  return el('div', { class: 'stat' }, el('dt', {}, label), el('dd', {}, value));
}
