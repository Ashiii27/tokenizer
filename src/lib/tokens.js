/**
 * ============================================================================
 *  Token text attribution — the tricky part of any tokenizer explainer
 * ============================================================================
 *
 *  GPT-2, Llama, Qwen and friends use **byte-level BPE**. A single character
 *  whose UTF-8 encoding takes 3–4 bytes (Hindi, Bengali, Tamil, Chinese,
 *  Arabic, every emoji) is routinely split across several tokens. Decoding one
 *  token in isolation therefore hands the UTF-8 decoder a *truncated* byte
 *  sequence and you get U+FFFD ("") or an empty string.
 *
 *  The fix: decode growing prefixes of the sequence and record where each
 *  token's text *starts* in the final string, then slice the final string with
 *  those boundaries. Because every chip is a contiguous slice of one string,
 *  concatenating the chips reproduces the input **exactly** — for any script.
 *
 *  Trailing replacement characters are stripped from each prefix before
 *  comparing, because an incomplete tail always decodes to U+FFFD and then
 *  disappears once the following bytes arrive.
 */

const REPLACEMENT = '\uFFFD';

/** Length of the longest common prefix of `a` and `b`. */
export function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Drop trailing U+FFFD produced by an incomplete UTF-8 sequence. */
export function stripIncompleteTail(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0xfffd) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/**
 * Split a token sequence into one text fragment per token.
 *
 * @param {number[]} ids         token ids
 * @param {(ids: number[]) => string} decode  prefix decoder (e.g. tokenizer.decode)
 * @returns {{ texts: string[], boundaries: number[], full: string }}
 */
export function tokenBoundaries(ids, decode) {
  const n = ids.length;
  if (n === 0) return { texts: [], boundaries: [], full: '' };

  const full = decode(ids);
  const boundaries = new Array(n).fill(0);

  let prevStable = '';
  for (let i = 0; i < n; i += 1) {
    const stable = stripIncompleteTail(decode(ids.slice(0, i + 1)));
    if (i > 0) {
      // A boundary only ever moves forward, and never past the final string.
      const common = commonPrefixLength(prevStable, stable);
      boundaries[i] = Math.max(boundaries[i - 1], Math.min(common, full.length));
    }
    prevStable = stable;
  }

  const texts = boundaries.map((start, i) =>
    full.slice(start, i + 1 < n ? boundaries[i + 1] : full.length),
  );

  return { texts, boundaries, full };
}

/* ------------------------------------------------------------------------ */
/*  Whitespace visibility                                                    */
/* ------------------------------------------------------------------------ */

const WHITESPACE_GLYPH = new Map([
  [' ', '\u00B7'], // · middle dot
  ['\n', '\u23CE'], // ⏎ return symbol
  ['\t', '\u21E5'], // ⇥ tab
  ['\r', '\u240D'], // ␍
  ['\u00A0', '\u2423'], // ␣ no-break space
]);

export function isWhitespace(char) {
  return WHITESPACE_GLYPH.has(char);
}

/**
 * Turn a token's raw text into displayable segments so that a token which is
 * literally a space or a newline can never look empty.
 *
 * @param {string} text
 * @returns {{ text: string, ws: boolean }[]}
 */
export function splitVisible(text) {
  const segments = [];
  let buffer = '';
  let bufferWs = false;

  const flush = () => {
    if (buffer) segments.push({ text: buffer, ws: bufferWs });
    buffer = '';
  };

  for (const char of text) {
    const ws = WHITESPACE_GLYPH.has(char);
    if (ws !== bufferWs) {
      flush();
      bufferWs = ws;
    }
    buffer += ws ? WHITESPACE_GLYPH.get(char) : char;
  }
  flush();
  return segments;
}

/* ------------------------------------------------------------------------ */
/*  Statistics                                                              */
/* ------------------------------------------------------------------------ */

const utf8 = new TextEncoder();

export function byteLength(text) {
  return utf8.encode(text).length;
}

/**
 * Summary numbers for the tokens panel.
 *
 * @param {{ text: string, ids: number[], texts: string[] }} input
 */
export function tokenStats({ text, ids, texts }) {
  const tokens = ids.length;
  const chars = [...text].length; // code points, not UTF-16 units
  const bytes = byteLength(text);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const fragments = texts.filter((t) => t === '').length;

  return {
    tokens,
    chars,
    bytes,
    words,
    fragments,
    tokensPerWord: words ? tokens / words : 0,
    charsPerToken: tokens ? chars / tokens : 0,
    bytesPerToken: tokens ? bytes / tokens : 0,
  };
}

/**
 * Longest run of tokens that still fits a model's context window.
 * Returns a 0–1+ fill ratio for the meter.
 */
export function contextUsage(tokens, contextWindow) {
  if (!contextWindow || contextWindow <= 0) return { ratio: 0, over: false, remaining: 0 };
  const ratio = tokens / contextWindow;
  return { ratio, over: tokens > contextWindow, remaining: Math.max(0, contextWindow - tokens) };
}
