/**
 * A ~30-line observable store: the corpus panel computes embeddings, the
 * semantic-map panel draws them. No framework, no rerender magic.
 */

function createStore(initial) {
  const listeners = new Set();
  let state = { ...initial };

  return {
    get state() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** texts, vectors, matrix, dims, selectedIndex */
export const corpusStore = createStore({
  texts: [],
  vectors: [],
  matrix: [],
  dims: 0,
  selectedIndex: 0,
  loading: false,
  error: '',
});
