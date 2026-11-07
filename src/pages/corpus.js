/**
 * § 05 — retrieval, in one screen: the corpus panel scores every pair, the map
 * panel projects the same vectors to two dimensions. Both read one store, so
 * selecting in the matrix highlights the point on the map.
 */

import { $, setStatus } from '../lib/dom.js';
import { bootChrome, updateDeviceBadge, setEmbedderView } from '../lib/boot.js';
import { EMBEDDER, DEFAULT_CORPUS } from '../lib/models.js';
import { readUrlState, readStoredState } from '../lib/urlstate.js';
import { initCorpusPanel } from '../demos/corpus-panel.js';
import { initMapPanel } from '../demos/map-panel.js';

const url = readUrlState();
const stored = readStoredState();
const { client } = bootChrome();

if (client) {
  /**
   * This page has no embed panel, so it owns the download itself: the first
   * "Embed all" press fetches ~23 MB and every later one is instant.
   */
  async function ensureEmbedder() {
    if (client.embedderReady) return;
    setStatus(
      $('#corp-status'),
      `Downloading ${EMBEDDER.label} (~23 MB the first time, then cached)…`,
    );
    await client.loadEmbedder(EMBEDDER);
    updateDeviceBadge(client.device);
    setEmbedderView(null);
  }

  const corpusPanel = initCorpusPanel({
    client,
    ensureEmbedder,
    initial: url.corpus ?? stored.corpus ?? DEFAULT_CORPUS.join('\n'),
  });

  initMapPanel({ onSelect: (index) => corpusPanel?.select(index) });
}
