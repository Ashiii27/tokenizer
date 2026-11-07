/** Tiny DOM helpers shared by every panel. */

export const $ = (id, root = document) => root.getElementById?.(id) ?? root.querySelector(id);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Create an element.
 * el('span', { class: 'chip', 'aria-pressed': 'true' }, 'text')
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace a container's children in one shot. */
export function mount(container, ...children) {
  container.replaceChildren(...children.flat().filter(Boolean));
}

const KIND_CLASS = { loading: 'is-loading', ok: 'is-ok', bad: 'is-bad' };

export function setStatus(node, text, kind = 'loading') {
  node.classList.remove(...Object.values(KIND_CLASS));
  node.classList.add(KIND_CLASS[kind] ?? '');
  node.textContent = text;
}

export function showError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

export function hideError(node) {
  node.textContent = '';
  node.hidden = true;
}

export function describeError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error.toString === 'function') return error.toString();
  return 'Unknown error';
}

/**
 * Run an async action with a button that reports what it is doing.
 * The single place that knows how to disable/restore a button, so no panel
 * has to hand-roll it (each one did before).
 */
export async function withBusy(button, label, action) {
  const original = button.dataset.idleLabel ?? button.textContent;
  button.dataset.idleLabel = original;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/** Polite screen-reader announcement (one shared live region). */
export function announce(message) {
  let region = document.getElementById('sr-live');
  if (!region) {
    region = el('div', { id: 'sr-live', class: 'sr-only', 'aria-live': 'polite', role: 'status' });
    document.body.append(region);
  }
  region.textContent = '';
  // A fresh text node forces assistive tech to re-read identical messages.
  window.setTimeout(() => { region.textContent = message; }, 30);
}

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flash(button, 'Copied');
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const area = el('textarea', { class: 'sr-only' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy');
    area.remove();
    flash(button, ok ? 'Copied' : 'Copy failed');
    return Boolean(ok);
  }
}

function flash(button, label) {
  if (!button) return;
  const original = button.dataset.idleLabel ?? button.textContent;
  button.textContent = label;
  window.setTimeout(() => { button.textContent = original; }, 1200);
}

/** Debounce — used for live-updating inputs so we don't re-embed on every key. */
export function debounce(fn, wait = 220) {
  let timer;
  const wrapped = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => window.clearTimeout(timer);
  return wrapped;
}
