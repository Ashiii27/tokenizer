/**
 * ============================================================================
 *  Model worker — every heavy thing happens here, never on the UI thread
 * ============================================================================
 *  Transformers.js is imported dynamically from a CDN inside this worker, so a
 *  slow model download or a long tokenisation never freezes the page (the old
 *  version ran it all on the main thread, which locked up mid-range phones —
 *  including the loading animation that was supposed to prove it was working).
 *
 *  Two library generations are supported so a CDN hiccup or an API change
 *  cannot take the whole demo down:
 *    • @huggingface/transformers v4  → dtype/device options, WebGPU
 *    • @xenova/transformers     v2  → quantized option, WASM only
 */

import { tokenBoundaries } from './tokens.js';

const LIBRARY_CANDIDATES = [
  { url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2', api: 'modern' },
  { url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1', api: 'modern' },
  { url: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2', api: 'legacy' },
];

/** Chips are rendered for at most this many tokens. */
export const RENDER_LIMIT = 2048;

let libPromise = null;
let api = null;
let device = 'wasm';

const tokenizers = new Map(); // repo → tokenizer
const embeddingModels = new Map(); // repo → pipeline

/* ------------------------------------------------------------------------ */
/*  Library loading                                                          */
/* ------------------------------------------------------------------------ */

async function loadLibrary() {
  if (!libPromise) {
    libPromise = (async () => {
      const failures = [];
      for (const candidate of LIBRARY_CANDIDATES) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const lib = await import(/* @vite-ignore */ candidate.url);
          api = candidate.api;
          lib.env.allowLocalModels = false;
          lib.env.useBrowserCache = true;
          post({ type: 'library', url: candidate.url, api });
          return lib;
        } catch (error) {
          failures.push(`${candidate.url} → ${error?.message ?? error}`);
        }
      }
      throw new Error(
        'Could not load Transformers.js from any CDN. Check your connection or an ad-blocker.\n' +
          failures.join('\n'),
      );
    })();
  }
  return libPromise;
}

/* ------------------------------------------------------------------------ */
/*  Messaging                                                                */
/* ------------------------------------------------------------------------ */

function post(message) {
  self.postMessage(message);
}

function reply(id, result) {
  post({ id, ok: true, result });
}

function replyError(id, error) {
  post({
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/* ------------------------------------------------------------------------ */
/*  Progress (byte-weighted)                                                 */
/* ------------------------------------------------------------------------ */

const downloads = new Map(); // file → { loaded, total }
let progressTimer = 0;

function makeProgressHandler(stage) {
  downloads.clear();

  const emit = (extra = {}) => {
    let loaded = 0;
    let total = 0;
    for (const file of downloads.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    const progress = total > 0 ? loaded / total : 0;
    post({
      type: 'progress',
      stage,
      loaded,
      total,
      progress,
      files: downloads.size,
      ...extra,
    });
  };

  return (data) => {
    if (!data || !data.status) return;

    if (data.status === 'initiate' || data.status === 'download') {
      const key = data.file ?? data.name;
      if (key && !downloads.has(key)) downloads.set(key, { loaded: 0, total: 0 });
      if (key) post({ type: 'progress-file', stage, file: key, status: data.status, progress: 0 });
      emit();
      return;
    }

    if (data.status === 'progress') {
      const key = data.file ?? data.name;
      if (key) {
        downloads.set(key, {
          loaded: data.loaded ?? 0,
          total: data.total ?? 0,
        });
        post({
          type: 'progress-file',
          stage,
          file: key,
          status: 'progress',
          progress: data.progress ?? 0,
        });
      }
      // Throttle: progress fires dozens of times a second per file.
      const now = Date.now();
      if (now - progressTimer > 60) {
        progressTimer = now;
        emit();
      }
      return;
    }

    if (data.status === 'done') {
      const key = data.file ?? data.name;
      if (key) {
        const entry = downloads.get(key) ?? { loaded: 0, total: 0 };
        downloads.set(key, { loaded: entry.total || entry.loaded, total: entry.total || entry.loaded });
        post({ type: 'progress-file', stage, file: key, status: 'done', progress: 100 });
      }
      emit();
      return;
    }

    if (data.status === 'ready') emit({ ready: true });
  };
}

/* ------------------------------------------------------------------------ */
/*  Tokenizers                                                               */
/* ------------------------------------------------------------------------ */

async function getTokenizer(repos) {
  for (const repo of repos) {
    if (tokenizers.has(repo)) return { repo, tokenizer: tokenizers.get(repo) };
  }

  const { AutoTokenizer } = await loadLibrary();
  const errors = [];

  for (const repo of repos) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const tokenizer = await AutoTokenizer.from_pretrained(repo, {
        progress_callback: makeProgressHandler('tokenizer'),
      });
      tokenizers.set(repo, tokenizer);
      return { repo, tokenizer };
    } catch (error) {
      errors.push(`${repo}: ${error?.message ?? error}`);
    }
  }

  throw new Error(`Could not load any of these tokenizers:\n${errors.join('\n')}`);
}

function decodeWith(tokenizer) {
  return (ids) =>
    tokenizer.decode(ids, {
      skip_special_tokens: false,
      clean_up_tokenization_spaces: false,
    });
}

function specialIdsOf(tokenizer) {
  // [CLS], [SEP], <|endoftext|>, <s>, … — whatever this vocabulary reserves.
  const ids = tokenizer.all_special_ids ?? [];
  return ids.filter((id) => Number.isInteger(id));
}

function tokenizeText(tokenizer, text, { addSpecialTokens = false } = {}) {
  const encoded = tokenizer(text, { add_special_tokens: addSpecialTokens });
  const ids = Array.from(encoded.input_ids.data, Number);

  const visible = ids.slice(0, RENDER_LIMIT);
  const { texts, full } = tokenBoundaries(visible, decodeWith(tokenizer));

  return {
    ids,
    texts,
    full,
    specialIds: specialIdsOf(tokenizer),
    truncated: ids.length > RENDER_LIMIT,
    renderLimit: RENDER_LIMIT,
  };
}

/* ------------------------------------------------------------------------ */
/*  Embeddings                                                               */
/* ------------------------------------------------------------------------ */

async function getEmbedder(repo) {
  if (embeddingModels.has(repo)) return embeddingModels.get(repo);

  const { pipeline } = await loadLibrary();

  const build = async (targetDevice) => {
    const options = { progress_callback: makeProgressHandler('embedder') };
    if (api === 'modern') {
      options.device = targetDevice;
      options.dtype = 'q8';
    } else {
      options.quantized = true;
    }
    return pipeline('feature-extraction', repo, options);
  };

  let embedder;
  const preferGpu = typeof self.navigator?.gpu !== 'undefined';
  try {
    embedder = await build(preferGpu ? 'webgpu' : 'wasm');
    device = preferGpu ? 'webgpu' : 'wasm';
  } catch (error) {
    if (!preferGpu) throw error;
    // WebGPU exists but this adapter/driver can't run the model — fall back.
    post({ type: 'notice', message: 'WebGPU unavailable, using WebAssembly (CPU).' });
    embedder = await build('wasm');
    device = 'wasm';
  }

  embeddingModels.set(repo, embedder);
  return embedder;
}

async function embedTexts(repo, texts) {
  const embedder = await getEmbedder(repo);
  const output = await embedder(texts, { pooling: 'mean', normalize: true });

  const dims = output.dims?.at(-1) ?? 0;
  const flat = output.data;
  const vectors = [];
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(Array.from(flat.slice(i * dims, (i + 1) * dims), Number));
  }

  // The pipeline owns the model's own tokenizer, so counting tokens costs no
  // extra download. Without it the UI cannot warn that MiniLM silently
  // truncates at 512 — and a score computed on half a document is a lie.
  let tokenCounts = null;
  try {
    const tokenizer = embedder.tokenizer;
    if (tokenizer) {
      tokenCounts = texts.map(
        (text) => Array.from(tokenizer(text, { add_special_tokens: true }).input_ids.data).length,
      );
    }
  } catch {
    tokenCounts = null;
  }

  return { vectors, dims, device, tokenCounts };
}

/* ------------------------------------------------------------------------ */
/*  RPC                                                                      */
/* ------------------------------------------------------------------------ */

const handlers = {
  async ping() {
    return { version: api ?? 'not loaded', device };
  },

  async 'load-tokenizer'({ repos }) {
    const { repo } = await getTokenizer(repos);
    return { repo, api };
  },

  async tokenize({ repos, text, addSpecialTokens = false }) {
    const { repo, tokenizer } = await getTokenizer(repos);
    return { repo, ...tokenizeText(tokenizer, text, { addSpecialTokens }) };
  },

  async 'load-embedder'({ repo }) {
    await getEmbedder(repo);
    return { device, api };
  },

  async embed({ repo, texts }) {
    return embedTexts(repo, texts);
  },
};

self.addEventListener('message', async (event) => {
  const { id, op, payload } = event.data ?? {};
  const handler = handlers[op];
  if (!handler) {
    replyError(id, new Error(`Unknown worker op: ${op}`));
    return;
  }
  try {
    reply(id, await handler(payload ?? {}));
  } catch (error) {
    replyError(id, error);
  }
});
