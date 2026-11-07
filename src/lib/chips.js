/**
 * Token chip rendering.
 *
 * Three rules the first version of this page got wrong:
 *   1. a token whose text is a space or a newline must be *visible*;
 *   2. a token that only carries part of a multi-byte character must not be
 *      silently dropped — it is shown as a dashed fragment chip, and the
 *      fragment's real (partial) text stays in `data-raw` so that joining
 *      every chip reproduces the input exactly;
 *   3. 1,000 chips must not become 1,000 tab stops — the row uses a roving
 *      tabindex, so Tab enters the row once and arrows move inside it.
 */

import { el } from './dom.js';
import { splitVisible } from './tokens.js';

export const CHIP_COLORS = [
  '#79c0ff',
  '#ffab70',
  '#8ce99a',
  '#d0bfff',
  '#ffd43b',
  '#66d9e8',
  '#faa2c1',
  '#ffa8a8',
];

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * @param {object} options
 * @param {number[]} options.ids
 * @param {string[]} options.texts     one fragment per token (may be '')
 * @param {number} [options.offset]    index offset for multi-tokenizer views
 * @param {boolean} [options.compact]
 * @param {boolean} [options.color]    rotate the palette (default true)
 * @param {number[]} [options.specialIds] ids the tokenizer reserves for
 *   control tokens ([CLS], [SEP], <|endoftext|>) — drawn as hollow chips
 *   because they are *added* by the tokenizer, not present in your text.
 * @param {(index: number, chip: HTMLElement) => void} [options.onSelect]
 */
export function renderChips({
  ids,
  texts,
  offset = 0,
  compact = false,
  color = true,
  specialIds = [],
  onSelect,
}) {
  const wrap = el('div', { class: `chips${compact ? ' is-compact' : ''}` });
  const fragment = document.createDocumentFragment();
  const specials = new Set(specialIds);

  ids.forEach((id, index) => {
    const text = texts[index] ?? '';
    const isFragment = text === '' && !specials.has(id);
    const isSpecial = specials.has(id);
    const chip = el('button', {
      type: 'button',
      class: `chip${isFragment ? ' is-fragment' : ''}${isSpecial ? ' is-special' : ''}`,
      'aria-pressed': 'false',
      tabindex: index === 0 ? '0' : '-1',
      'aria-label': isSpecial
        ? `Special token ${id}: ${JSON.stringify(text)}`
        : isFragment
          ? `Token ${id}: byte fragment, the character completes in the next token`
          : `Token ${id}: ${JSON.stringify(text)}`,
      dataset: { raw: text, id: String(id), index: String(index + offset) },
    });

    if (isSpecial) {
      chip.append(text === '' ? '(special)' : text);
      chip.title = `Token ${id} — a special token the tokenizer adds, not part of your text`;
    } else if (isFragment) {
      chip.append('\u25CC'); // ◌ dotted circle — "a character is forming"
      chip.title = `Token ${id} — carries bytes only; the character completes in the next token`;
    } else {
      if (color) chip.style.background = CHIP_COLORS[Math.abs(index + offset) % CHIP_COLORS.length];
      for (const segment of splitVisible(text)) {
        if (segment.ws) {
          chip.append(el('span', { class: 'ws', 'aria-hidden': 'true' }, segment.text));
        } else {
          chip.append(segment.text);
        }
      }
      chip.title = `Token ${id} — ${JSON.stringify(text)}`;
    }

    chip.addEventListener('click', () => {
      const pressed = chip.getAttribute('aria-pressed') === 'true';
      for (const other of wrap.children) other.setAttribute('aria-pressed', 'false');
      chip.setAttribute('aria-pressed', String(!pressed));
      onSelect?.(index, chip);
    });

    fragment.append(chip);
  });

  wrap.append(fragment);

  // Roving tabindex + arrow-key navigation.
  wrap.addEventListener('keydown', (event) => {
    if (!ARROW_KEYS.has(event.key)) return;
    const chips = [...wrap.children];
    const current = chips.indexOf(document.activeElement);
    if (current === -1) return;
    let next = current;
    if (event.key === 'ArrowRight') next = Math.min(chips.length - 1, current + 1);
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = chips.length - 1;
    if (next === current) return;
    event.preventDefault();
    chips[current].setAttribute('tabindex', '-1');
    chips[next].setAttribute('tabindex', '0');
    chips[next].focus();
    onSelect?.(next, chips[next]);
  });

  return wrap;
}

/** Text of every chip, in order — used by the "concatenate me" invariant check. */
export function chipsText(wrap) {
  return [...wrap.querySelectorAll('.chip')].map((chip) => chip.dataset.raw ?? '').join('');
}
