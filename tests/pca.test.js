import test from 'node:test';
import assert from 'node:assert/strict';

import { pca2d, fitToBox } from '../src/lib/pca.js';

test('empty and single input', () => {
  assert.deepEqual(pca2d([]).points, []);
  assert.deepEqual(pca2d([[1, 2, 3]]).points, [{ x: 0, y: 0 }]);
});

test('collinear points collapse onto one component', () => {
  const { points, explained } = pca2d([
    [0, 0],
    [1, 1],
    [2, 2],
  ]);

  assert.equal(points.length, 3);
  assert.ok(explained[0] > 0.99, `first component should explain everything, got ${explained[0]}`);
  assert.ok(explained[1] < 0.01);
});

test('two separated clusters separate on the first component', () => {
  const vectors = [
    [1, 0, 0],
    [1.1, 0.05, 0],
    [0, 1, 0],
    [0.05, 1.05, 0],
  ];
  const { points, explained } = pca2d(vectors);

  assert.ok(explained[0] > 0.9);
  // The two clusters must sit on opposite sides of the first axis.
  const firstCluster = Math.sign(points[0].x);
  assert.equal(Math.sign(points[1].x), firstCluster);
  assert.equal(Math.sign(points[2].x), -firstCluster);
  assert.equal(Math.sign(points[3].x), -firstCluster);
});

test('projection is deterministic', () => {
  const vectors = [
    [0.1, 0.9, -0.2],
    [0.8, 0.1, 0.3],
    [-0.4, 0.2, 0.7],
  ];
  assert.deepEqual(pca2d(vectors), pca2d(vectors));
});

test('identical vectors do not produce NaN', () => {
  const { points, explained } = pca2d([
    [1, 1],
    [1, 1],
  ]);
  for (const point of points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'coordinates stay finite');
  }
  assert.equal(explained[0], 0);
});

test('fitToBox keeps every point inside the margin box', () => {
  const points = [
    { x: -12, y: 4 },
    { x: 0, y: 0 },
    { x: 30, y: -9 },
  ];
  const fitted = fitToBox(points, 400, 380, 34);

  for (const point of fitted) {
    assert.ok(point.x >= 34 - 1e-9 && point.x <= 400 - 34 + 1e-9, `x within bounds: ${point.x}`);
    assert.ok(point.y >= 34 - 1e-9 && point.y <= 380 - 34 + 1e-9, `y within bounds: ${point.y}`);
  }

  // The widest input must reach the horizontal edges.
  assert.ok(Math.abs(fitted[0].x - 34) < 1e-6, 'leftmost point sits on the left margin');
  assert.ok(Math.abs(fitted[2].x - (400 - 34)) < 1e-6, 'rightmost point sits on the right margin');
});

test('fitToBox handles a degenerate single dimension', () => {
  const fitted = fitToBox(
    [
      { x: 0, y: 0 },
      { x: 0, y: 5 },
    ],
    300,
    300,
    20,
  );
  for (const point of fitted) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});
