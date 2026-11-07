import test from 'node:test';
import assert from 'node:assert/strict';

import {
  commonPrefixLength,
  stripIncompleteTail,
  tokenBoundaries,
  splitVisible,
  tokenStats,
  contextUsage,
  byteLength,
} from '../src/lib/tokens.js';

/* ------------------------------------------------------------------------ */
/*  A decoder that behaves exactly like a byte-level BPE decoder:            */
/*  non-streaming TextDecoder over the token's raw bytes. Incomplete UTF-8   */
/*  sequences therefore become U+FFFD — the bug this module exists to fix.   */
/* ------------------------------------------------------------------------ */

const encoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8'); // non-fatal, like Transformers.js

/** Byte-per-token "vocabulary": the worst case for multi-byte scripts. */
function byteTokens(text) {
  return [...encoder.encode(text)];
}

const decodeBytes = (ids) => textDecoder.decode(Uint8Array.from(ids));

/** The naive per-token decode the original page used. */
const naivePerToken = (ids) => ids.map((id) => textDecoder.decode(Uint8Array.from([id])));

/* ------------------------------------------------------------------------ */

test('commonPrefixLength', () => {
  assert.equal(commonPrefixLength('abc', 'abd'), 2);
  assert.equal(commonPrefixLength('abc', 'abc'), 3);
  assert.equal(commonPrefixLength('', 'abc'), 0);
  assert.equal(commonPrefixLength('नम', 'नमस्ते'), 2);
});

test('stripIncompleteTail removes only trailing replacement characters', () => {
  assert.equal(stripIncompleteTail('\uFFFD\uFFFD'), '');
  assert.equal(stripIncompleteTail('a\uFFFD'), 'a');
  assert.equal(stripIncompleteTail('a\uFFFDb'), 'a\uFFFDb');
  assert.equal(stripIncompleteTail('plain'), 'plain');
});

test('naive per-token decode really is broken for Hindi (the original bug)', () => {
  const text = 'नमस्ते';
  const ids = byteTokens(text);
  const naive = naivePerToken(ids).join('');

  assert.notEqual(naive, text, 'naive decode should not reproduce Devanagari');
  assert.ok(naive.includes('\uFFFD'), 'naive decode leaks replacement characters');
});

test('tokenBoundaries reproduces any script exactly', () => {
  const samples = [
    'The quick brown fox jumps over the lazy dog.',
    'नमस्ते दुनिया', // Devanagari
    'কৃত্রিম বুদ্ধিমত্তা', // Bengali
    'செயற்கை நுண்ணறிவு', // Tamil
    '人工智能正在改变', // Han
    'الذكاء الاصطناعي', // Arabic
    '🤖✨📈🌍', // emoji (4-byte sequences)
    'a🌏b',
    'mixed: नमस्ते + 你好 + 🌏 + ascii',
    ' leading and trailing ',
    'two\nlines\tand\ttabs',
  ];

  for (const text of samples) {
    const ids = byteTokens(text);
    const { texts, full } = tokenBoundaries(ids, decodeBytes);

    assert.equal(full, text, `decode(full) mismatch for ${JSON.stringify(text)}`);
    assert.equal(texts.length, ids.length, 'one fragment per token');
    assert.equal(texts.join(''), text, `chips must rejoin exactly for ${JSON.stringify(text)}`);
    assert.ok(!texts.join('').includes('\uFFFD'), 'no replacement characters leak into chips');
  }
});

test('tokenBoundaries attributes multi-byte characters to the completing token', () => {
  // "न" is E0 A4 A8 — three tokens, one character.
  const ids = byteTokens('न');
  const { texts } = tokenBoundaries(ids, decodeBytes);

  assert.equal(texts.length, 3);
  assert.deepEqual(texts.slice(0, 2), ['', ''], 'leading bytes carry no character yet');
  assert.equal(texts[2], 'न', 'the completing byte owns the character');
});

test('tokenBoundaries handles ASCII-per-token decoding', () => {
  const tokens = ['The', ' quick', ' brown'];
  const ids = tokens.map((_, index) => index);
  const decode = (prefix) => prefix.map((id) => tokens[id]).join('');

  const { texts, boundaries, full } = tokenBoundaries(ids, decode);
  assert.deepEqual(texts, tokens);
  assert.deepEqual(boundaries, [0, 3, 9]);
  assert.equal(full, 'The quick brown');
});

test('boundaries are monotonic and inside the string', () => {
  const text = 'नमस्ते दुनिया 🌏 hello';
  const { boundaries, full } = tokenBoundaries(byteTokens(text), decodeBytes);

  for (let i = 0; i < boundaries.length; i += 1) {
    assert.ok(boundaries[i] >= 0 && boundaries[i] <= full.length);
    if (i > 0) assert.ok(boundaries[i] >= boundaries[i - 1], 'boundaries never move backwards');
  }
});

test('empty input', () => {
  const result = tokenBoundaries([], decodeBytes);
  assert.deepEqual(result, { texts: [], boundaries: [], full: '' });
});

test('splitVisible exposes whitespace as glyphs', () => {
  assert.deepEqual(splitVisible(' hello'), [
    { text: '·', ws: true },
    { text: 'hello', ws: false },
  ]);

  assert.deepEqual(splitVisible('\n'), [{ text: '⏎', ws: true }]);
  assert.deepEqual(splitVisible(' '), [{ text: '·', ws: true }]);
  assert.deepEqual(splitVisible(''), []);
  assert.deepEqual(splitVisible('a\tb'), [
    { text: 'a', ws: false },
    { text: '⇥', ws: true },
    { text: 'b', ws: false },
  ]);
});

test('tokenStats counts code points and UTF-8 bytes', () => {
  const text = 'नमस्ते ok';
  const stats = tokenStats({ text, ids: [1, 2, 3], texts: ['न', 'म', 'स्ते ok'] });

  assert.equal(stats.tokens, 3);
  assert.equal(stats.chars, 9);
  assert.equal(stats.bytes, byteLength(text));
  assert.equal(stats.words, 2);
  assert.equal(stats.charsPerToken, 3);
  assert.equal(stats.fragments, 0);
});

test('contextUsage flags overflow', () => {
  assert.deepEqual(contextUsage(512, 1024), { ratio: 0.5, over: false, remaining: 512 });
  assert.equal(contextUsage(2048, 1024).over, true);
  assert.equal(contextUsage(10, 0).ratio, 0);
});
