/** § 02 — the same sentence through five vocabularies. */

import { $ } from '../lib/dom.js';
import { bootChrome } from '../lib/boot.js';
import { SAMPLES } from '../lib/models.js';
import { readUrlState, readStoredState } from '../lib/urlstate.js';
import { initComparePanel } from '../demos/compare-panel.js';

const url = readUrlState();
const stored = readStoredState();
const { client } = bootChrome();

if (client) {
  initComparePanel({ client });
  $('#cmp-input').value = url.tokens ?? stored.tokens ?? SAMPLES.multilingual;
}
