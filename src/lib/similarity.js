/**
 * Similarity maths — pure functions, no DOM, no model dependency.
 * Everything here is unit-tested in tests/similarity.test.js.
 */

/** Dot product of two equal-length vectors (throws on a length mismatch). */
export function dot(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`dot(): vector length mismatch (${a.length} vs ${b.length})`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function l2norm(a) {
  return Math.sqrt(dot(a, a));
}

/** Scale a vector to unit length; returns a copy (all zeros stays as-is). */
export function normalize(a) {
  const norm = l2norm(a);
  if (norm === 0) return a.slice();
  return a.map((v) => v / norm);
}

export function mean(...vectors) {
  if (vectors.length === 0) return [];
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < out.length; i += 1) out[i] += v[i];
  }
  return out.map((v) => v / vectors.length);
}

/**
 * Cosine similarity, computed honestly: even when the inputs are already unit
 * vectors we divide by the norms, so the UI can show the real numbers.
 */
export function cosine(a, b) {
  const denominator = l2norm(a) * l2norm(b);
  if (denominator === 0) return 0;
  return dot(a, b) / denominator;
}

/* ------------------------------------------------------------------------ */
/*  Explaining the score                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Which dimensions actually drive the dot product?
 * Returns every dimension's contribution `a_i * b_i`, sorted by |contribution|.
 */
export function contributions(a, b) {
  if (a.length !== b.length) {
    throw new RangeError('contributions(): vector length mismatch');
  }
  return a
    .map((value, dim) => ({ dim, a: value, b: b[dim], product: value * b[dim] }))
    .sort((x, y) => Math.abs(y.product) - Math.abs(x.product));
}

/** Share of the total dot product contributed by the top-k dimensions. */
export function topShare(a, b, k = 10) {
  const sorted = contributions(a, b);
  const total = sorted.reduce((sum, c) => sum + c.product, 0);
  const top = sorted.slice(0, k).reduce((sum, c) => sum + c.product, 0);
  if (total === 0) return 0;
  return top / total;
}

/** Full n×n similarity matrix for a list of (already normalized) vectors. */
export function similarityMatrix(vectors) {
  return vectors.map((row) => vectors.map((col) => cosine(row, col)));
}

/**
 * Most similar items to `index`, excluding itself.
 * @returns {{ index: number, score: number }[]}
 */
export function nearest(matrix, index, limit = 3) {
  const row = matrix[index];
  if (!row) return [];
  return row
    .map((score, i) => ({ index: i, score }))
    .filter((item) => item.index !== index)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

/** Human label for a MiniLM-style cosine score. */
export function describeSimilarity(sim) {
  if (sim >= 0.85) return 'near duplicate meaning';
  if (sim >= 0.7) return 'very similar meaning';
  if (sim >= 0.5) return 'fairly similar meaning';
  if (sim >= 0.3) return 'topically related';
  if (sim >= 0.1) return 'loosely related';
  if (sim >= -0.05) return 'largely unrelated';
  return 'opposed / unrelated (rare)';
}

/**
 * Meter fill for a cosine score. The gauge runs 0 → 1; the (rare) negative
 * case is clamped to 0 and spelled out in text instead.
 */
export function meterFraction(sim) {
  return Math.max(0, Math.min(1, sim));
}
