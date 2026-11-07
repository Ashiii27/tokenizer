/**
 * Shareable state.
 *
 * Every panel's input lives in the query string, so a link like
 *   ?t=नमस्ते+दुनिया&a=...&b=...
 * reproduces exactly what someone was looking at. Inputs are also mirrored to
 * localStorage so a reload doesn't lose work.
 */

const THEME_KEY = 'tokenizer.theme';
const STORE_KEY = 'tokenizer.state';
const MAX_PARAM = 1800; // keep URLs sane and pasteable

export const PARAMS = {
  tokens: 't',
  embedA: 'a',
  embedB: 'b',
  corpus: 'c',
};

function safeGet(search) {
  const params = new URLSearchParams(search);
  const out = {};
  for (const [key, param] of Object.entries(PARAMS)) {
    const value = params.get(param);
    if (value !== null) out[key] = value.slice(0, MAX_PARAM);
  }
  return out;
}

export function readUrlState(search = window.location.search) {
  try {
    return safeGet(search);
  } catch {
    return {};
  }
}

export function readStoredState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Persist locally (cheap, synchronous) without touching the URL. */
export function persistState(patch) {
  try {
    const merged = { ...readStoredState(), ...patch };
    localStorage.setItem(STORE_KEY, JSON.stringify(merged));
  } catch {
    /* storage disabled — never fatal */
  }
}

/** Write state into the address bar without adding history entries. */
export function writeUrlState(patch, { replace = true } = {}) {
  if (!window.history?.replaceState) return;
  try {
    const params = new URLSearchParams();
    const state = { ...readUrlState(), ...patch };
    for (const [key, param] of Object.entries(PARAMS)) {
      const value = state[key];
      if (typeof value === 'string' && value.trim()) params.set(param, value.slice(0, MAX_PARAM));
    }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
    const method = replace ? 'replaceState' : 'pushState';
    window.history[method]({ ...window.history.state }, '', url);
  } catch {
    /* ignore */
  }
}

export function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function writeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
