import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dot,
  l2norm,
  normalize,
  mean,
  cosine,
  contributions,
  topShare,
  similarityMatrix,
  nearest,
  describeSimilarity,
  meterFraction,
} from '../src/lib/similarity.js';

test('dot product and norms', () => {
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  assert.equal(l2norm([3, 4]), 5);
  assert.equal(l2norm([0, 0]), 0);
  assert.throws(() => dot([1, 2], [1, 2, 3]), RangeError);
});

test('normalize returns a unit vector and does not mutate', () => {
  const source = [3, 4];
  const unit = normalize(source);
  assert.deepEqual(source, [3, 4]);
  assert.ok(Math.abs(l2norm(unit) - 1) < 1e-12);
  assert.deepEqual(normalize([0, 0]), [0, 0]);
});

test('mean', () => {
  assert.deepEqual(mean([1, 2], [3, 4]), [2, 3]);
  assert.deepEqual(mean([]), []);
});

test('cosine: identity, orthogonality, opposition', () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([0, 0], [1, 1]), 0, 'zero vector degrades to 0, not NaN');
  assert.ok(Math.abs(cosine([1, 2, 3], [4, 5, 6]) - 0.974631846) < 1e-6);
});

test('cosine is invariant to scale — that is the whole point', () => {
  const a = [0.2, -0.5, 0.9];
  assert.ok(Math.abs(cosine(a, a.map((v) => v * 10)) - 1) < 1e-12);
});

test('contributions are sorted by absolute impact and sum to the dot product', () => {
  const a = [0.5, -0.2, 0.1];
  const b = [0.4, 0.3, -0.9];
  const list = contributions(a, b);

  // products: 0.20 (dim 0), -0.06 (dim 1), -0.09 (dim 2) → by |product|: 0, 2, 1
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((item) => item.dim), [0, 2, 1]);
  assert.deepEqual(
    list.map((item) => Number(item.product.toFixed(4))),
    [0.2, -0.09, -0.06],
  );
  const total = list.reduce((sum, item) => sum + item.product, 0);
  assert.ok(Math.abs(total - dot(a, b)) < 1e-12);
});

test('topShare reports how concentrated the score is', () => {
  const a = [1, 0, 0, 0];
  const b = [1, 0, 0, 0];
  assert.equal(topShare(a, b, 1), 1);

  const c = [0.5, 0.5, 0.5, 0.5];
  assert.ok(Math.abs(topShare(c, c, 2) - 0.5) < 1e-12);
});

test('similarityMatrix is symmetric with a unit diagonal', () => {
  const vectors = [normalize([1, 2, 0]), normalize([2, 1, 0]), normalize([0, 0, 1])];
  const matrix = similarityMatrix(vectors);

  assert.equal(matrix.length, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(matrix[i][i] - 1) < 1e-12);
    for (let j = 0; j < 3; j += 1) {
      assert.ok(Math.abs(matrix[i][j] - matrix[j][i]) < 1e-12);
    }
  }
  assert.ok(matrix[0][1] > matrix[0][2], 'closer vectors score higher');
});

test('nearest skips the item itself and sorts', () => {
  const matrix = [
    [1, 0.8, 0.2],
    [0.8, 1, 0.1],
    [0.2, 0.1, 1],
  ];
  assert.deepEqual(nearest(matrix, 0, 2), [
    { index: 1, score: 0.8 },
    { index: 2, score: 0.2 },
  ]);
  assert.deepEqual(nearest(matrix, 99), []);
});

test('describeSimilarity is monotonic', () => {
  const values = [1, 0.9, 0.75, 0.55, 0.35, 0.15, 0, -0.2];
  const labels = values.map(describeSimilarity);
  const order = [
    'near duplicate meaning',
    'near duplicate meaning',
    'very similar meaning',
    'fairly similar meaning',
    'topically related',
    'loosely related',
    'largely unrelated',
    'opposed / unrelated (rare)',
  ];
  assert.deepEqual(labels, order);
});

test('meterFraction clamps to the 0..1 gauge', () => {
  assert.equal(meterFraction(1), 1);
  assert.equal(meterFraction(0.25), 0.25);
  assert.equal(meterFraction(-0.3), 0);
  assert.equal(meterFraction(2), 1);
});
