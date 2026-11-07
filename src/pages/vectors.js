/** § 04 — one pair of texts, one cosine score, and the dimensions behind it. */

import { $ } from '../lib/dom.js';
import { bootChrome, setEmbedderView } from '../lib/boot.js';
import { EMBEDDER } from '../lib/models.js';
import { readUrlState, readStoredState } from '../lib/urlstate.js';
import { initEmbedPanel } from '../demos/embed-panel.js';

const url = readUrlState();
const stored = readStoredState();
const { client } = bootChrome();

if (client) {
  const panel = initEmbedPanel({
    client,
    initial: { a: url.embedA ?? stored.embedA, b: url.embedB ?? stored.embedB },
  });

  // The panel owns the download UI, so progress events are routed to it.
  setEmbedderView(panel);
  $('#emb-model-tag').textContent = `${EMBEDDER.label} · ${EMBEDDER.dimensions}d`;
}
