/** § 01 — tokens, IDs, and the round trip back to your text. */

import { bootChrome } from '../lib/boot.js';
import { SAMPLES, TOKENIZERS } from '../lib/models.js';
import { readUrlState, readStoredState } from '../lib/urlstate.js';
import { initTokenizePanel } from '../demos/tokenize-panel.js';

const url = readUrlState();
const stored = readStoredState();
const { client } = bootChrome();

if (client) {
  initTokenizePanel({
    client,
    model: TOKENIZERS.find((model) => model.id === 'gpt2') ?? TOKENIZERS[0],
    getInitialText: () => url.tokens ?? stored.tokens ?? SAMPLES.english,
  });
}
