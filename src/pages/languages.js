/** § 03 — what one meaning costs in seven writing systems. */

import { bootChrome } from '../lib/boot.js';
import { initLanguagesPanel } from '../demos/languages-panel.js';

const { client } = bootChrome();
if (client) initLanguagesPanel({ client });
