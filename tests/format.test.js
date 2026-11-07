import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCount,
  formatBytes,
  formatScore,
  formatRatio,
  formatPercent,
  formatDuration,
  pluralize,
  truncate,
  clamp,
  makeRateEstimator,
} from '../src/lib/format.js';

test('formatCount', () => {
  assert.equal(formatCount(1234), '1,234');
  assert.equal(formatCount(1.6), '2');
  assert.equal(formatCount(1234.567, 2), '1,234.57');
  assert.equal(formatCount(NaN), '—');
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(23 * 1024 * 1024), '23.0 MB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(-1), '—');
});

test('formatScore / formatRatio / formatPercent', () => {
  assert.equal(formatScore(0.82345), '0.8235');
  assert.equal(formatScore(0.82345, 3), '0.823');
  assert.equal(formatRatio(2.345), '2.35×');
  assert.equal(formatPercent(0.5), '50.0%');
  assert.equal(formatPercent(0.5, 0), '50%');
  assert.equal(formatScore(Infinity), '—');
});

test('formatDuration', () => {
  assert.equal(formatDuration(0.2), 'less than a second');
  assert.equal(formatDuration(12.4), '12s');
  assert.equal(formatDuration(80), '1m 20s');
  assert.equal(formatDuration(-5), '—');
});

test('pluralize + truncate + clamp', () => {
  assert.equal(pluralize(1, 'token'), '1 token');
  assert.equal(pluralize(2, 'token'), '2 tokens');
  assert.equal(pluralize(0, 'file'), '0 files');
  assert.equal(truncate('hello world', 8), 'hello w…');
  assert.equal(truncate('short', 20), 'short');
  assert.equal(truncate('a\nb', 10), 'a b');
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
});

test('makeRateEstimator smooths throughput and ignores rewinds', () => {
  const update = makeRateEstimator({ smoothing: 0.5 });

  assert.equal(update(0, 0), 0);
  assert.equal(update(1000, 1000), 1000, 'first sample sets the rate (1 KB/s)');
  assert.equal(update(2000, 2000), 1000, 'steady rate stays steady');
  // A backwards jump must not produce a negative rate.
  assert.ok(update(500, 3000) >= 0);
});
