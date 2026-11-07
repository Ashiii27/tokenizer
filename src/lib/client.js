/**
 * Promise-based RPC over the model worker, plus the main thread's view of
 * "which models are loaded, how far along is the download".
 */

export class ModelClient {
  constructor({ onProgress, onFileProgress, onNotice, onLibrary } = {}) {
    this.onProgress = onProgress;
    this.onFileProgress = onFileProgress;
    this.onNotice = onNotice;
    this.onLibrary = onLibrary;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Set(); // tokenizer ids already loaded
    this.embedderReady = false;
    this.device = 'wasm';

    try {
      this.worker = new Worker(new URL('./model-worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      throw new Error(
        'This page needs file:// access replaced by a real server, or your browser blocked the worker. ' +
          `Run "python3 -m http.server" in the project folder. (${error.message})`,
      );
    }

    this.worker.addEventListener('message', (event) => this.#handleMessage(event.data));
    this.worker.addEventListener('error', (event) => {
      const message = event.message ?? 'Model worker crashed';
      for (const [, entry] of this.pending) entry.reject(new Error(message));
      this.pending.clear();
    });
  }

  #handleMessage(data) {
    if (!data) return;

    if (data.type === 'progress') {
      this.onProgress?.(data);
      return;
    }
    if (data.type === 'progress-file') {
      this.onFileProgress?.(data);
      return;
    }
    if (data.type === 'notice') {
      this.onNotice?.(data.message);
      return;
    }
    if (data.type === 'library') {
      this.onLibrary?.(data);
      return;
    }

    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error));
  }

  request(op, payload = {}, { timeout = 0 } = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = timeout
        ? window.setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`Timed out after ${Math.round(timeout / 1000)}s: ${op}`));
          }, timeout)
        : 0;

      this.pending.set(id, {
        resolve: (value) => {
          if (timer) window.clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          if (timer) window.clearTimeout(timer);
          reject(error);
        },
      });

      this.worker.postMessage({ id, op, payload });
    });
  }

  /* ---- convenience wrappers ------------------------------------------- */

  async tokenize(model, text, { addSpecialTokens = false } = {}) {
    const result = await this.request('tokenize', {
      repos: [model.repo, ...(model.alts ?? [])],
      text,
      addSpecialTokens,
    });
    this.ready.add(model.id);
    return result;
  }

  async loadTokenizer(model) {
    if (this.ready.has(model.id)) return { repo: model.repo };
    const result = await this.request('load-tokenizer', {
      repos: [model.repo, ...(model.alts ?? [])],
    });
    this.ready.add(model.id);
    return result;
  }

  async embed(model, texts) {
    const result = await this.request(
      'embed',
      { repo: model.repo, texts },
      { timeout: 180000 },
    );
    this.embedderReady = true;
    this.device = result.device ?? this.device;
    return result;
  }

  dispose() {
    this.worker?.terminate();
    this.pending.clear();
  }
}
