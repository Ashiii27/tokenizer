# Contributing

Thanks for looking. This is a teaching page: correctness beats features, and a wrong explanation is
worse than a missing one.

## Getting set up

```bash
git clone https://github.com/Ashiii27/tokenizer.git
cd tokenizer
npm install          # jsdom, for the DOM test — it is the only dependency
npm test             # 67 tests
python3 -m http.server 8080
```

The page must be served over HTTP: ES modules and Web Workers do not run from `file://`.

## Ground rules

1. **No build step, no framework.** Plain ES modules and CSS. If a change needs a bundler, it
   probably belongs in a different project.
2. **Keep the pure logic pure.** Anything worth testing—token boundaries, cosine similarity, PCA,
   formatting—lives in `src/lib/` with no DOM and no model dependency.
3. **Every new panel needs a test.** `tests/dom.test.js` drives the real markup against a fake
   worker; add your panel there so "the button does nothing" can't ship.
4. **Never claim something the code doesn't do.** If the UI says chips reproduce your text, there is
   a test asserting it for Devanagari, Han, Arabic and emoji.
5. **Accessibility is not a follow-up task.** New controls need a label, a focus style, and keyboard
   operation.

## Adding a tokenizer

Everything is driven by the registry in [`src/lib/models.js`](src/lib/models.js). Add an entry:

```js
{
  id: 'my-model',
  label: 'My Model',
  repo: 'Xenova/my-model',
  alts: ['onnx-community/my-model'],   // tried in order if the repo moves
  family: 'byte-level BPE',
  vocab: 32000,
  context: 4096,
  era: '2025 · family',
  byteLevel: true,
  defaultOn: false,
}
```

Only `tokenizer.json` (plus small config files) is fetched — never weights. If the repo has no
`tokenizer.json`, the panel will show that column as unavailable rather than breaking, but please
check that it loads before opening a pull request.

## What is most wanted

- A **next-token probabilities** panel from a small causal LM (closes the loop to prediction).
- **Build-a-tokenizer**: train BPE merges in the browser and diff against GPT-2.
- More languages in the cost table, with native-speaker review of the translations.
- Lighthouse and `axe` results from real devices — especially low-end Android.

## Commit style

Short imperative subject, one idea per commit, body explaining *why* when it isn't obvious.
