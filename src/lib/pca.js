/**
 * 2-D projection for the semantic map.
 *
 * Classical PCA would need a 384×384 covariance matrix and an eigensolver.
 * Because we only want a scatter plot of a few dozen points, we use the
 * equivalent (and far cheaper) PCoA route:
 *
 *   1. centre the n×d matrix X around its column means
 *   2. build the n×n Gram matrix K = X·Xᵀ          (n is small)
 *   3. take the top-2 eigenvectors of K by power iteration with deflation
 *   4. coordinates = v_k · √λ_k
 *
 * The result is the same 2-D embedding a PCA scatter plot shows, at O(n²d)
 * instead of O(d³), with no dependency.
 */

function gram(vectors) {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;

  const means = new Array(d).fill(0);
  for (const v of vectors) {
    for (let j = 0; j < d; j += 1) means[j] += v[j] / n;
  }

  const centered = vectors.map((v) => v.map((value, j) => value - means[j]));

  const k = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let sum = 0;
      for (let t = 0; t < d; t += 1) sum += centered[i][t] * centered[j][t];
      k[i][j] = sum;
      k[j][i] = sum;
    }
  }
  return k;
}

function multiply(matrix, vector) {
  const n = matrix.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    const row = matrix[i];
    for (let j = 0; j < n; j += 1) sum += row[j] * vector[j];
    out[i] = sum;
  }
  return out;
}

function normalizeVector(vector) {
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vector.map(() => 0) : vector.map((v) => v / norm);
}

/**
 * Dominant eigenpair of a symmetric PSD matrix via power iteration.
 * @returns {{ value: number, vector: number[] }}
 */
function powerIteration(matrix, iterations = 220) {
  const n = matrix.length;
  // Deterministic, well-spread start vector (no Math.random → reproducible).
  let vector = normalizeVector(
    Array.from({ length: n }, (_, i) => Math.sin((i + 1) * 1.7) + Math.cos((i + 1) * 0.37)),
  );

  let value = 0;
  for (let step = 0; step < iterations; step += 1) {
    const next = multiply(matrix, vector);
    value = Math.sqrt(next.reduce((s, v) => s + v * v, 0));
    if (value === 0) return { value: 0, vector: vector.map(() => 0) };
    vector = next.map((v) => v / value);
  }
  return { value, vector };
}

function deflate(matrix, { value, vector }) {
  const n = matrix.length;
  return matrix.map((row, i) =>
    row.map((cell, j) => cell - value * vector[i] * vector[j]),
  );
}

/**
 * Project vectors into 2-D.
 *
 * @param {number[][]} vectors
 * @returns {{ points: {x: number, y: number}[], explained: number[], dimensions: number }}
 */
export function pca2d(vectors) {
  const n = vectors.length;
  if (n === 0) return { points: [], explained: [0, 0], dimensions: 0 };
  if (n === 1) return { points: [{ x: 0, y: 0 }], explained: [0, 0], dimensions: vectors[0].length };

  const k = gram(vectors);
  const totalVariance = k.reduce((sum, row, i) => sum + row[i], 0);

  const first = powerIteration(k);
  const second = powerIteration(deflate(k, first));

  const scale1 = Math.sqrt(Math.max(0, first.value));
  const scale2 = Math.sqrt(Math.max(0, second.value));

  const points = Array.from({ length: n }, (_, i) => ({
    x: first.vector[i] * scale1,
    y: second.vector[i] * scale2,
  }));

  const explained = totalVariance > 0
    ? [first.value / totalVariance, second.value / totalVariance]
    : [0, 0];

  return { points, explained, dimensions: vectors[0].length };
}

/** Fit a list of 2-D points into a unit box with a small margin (for canvas). */
export function fitToBox(points, width, height, margin = 34) {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const usableW = Math.max(1, width - margin * 2);
  const usableH = Math.max(1, height - margin * 2);

  return points.map((p) => ({
    // y is flipped so the first component reads left→right and the second up.
    x: margin + ((p.x - minX) / spanX) * usableW,
    y: margin + usableH - ((p.y - minY) / spanY) * usableH,
  }));
}
