# Tokenizer & Embeddings Explainer — Review & Roadmap

This document is two things: the **code-level review of v1** (commit `0b52839` — 3 files, ~930 lines)
and the **plan that v2 implements**. Every item below carries its status so nothing quietly
disappears.

---

## 0. Status board (v2)

| # | Item | Status |
|---|---|---|
| 2.1 | Per-token decoding broken for non-ASCII (byte-level BPE) | ✅ fixed in `src/lib/tokens.js` + 8 tests |
| 2.2 | Download progress averaged per file, not per byte | ✅ fixed — real bytes, MB, ETA |
| 2.3 | Silent 512-token truncation in embeddings | ✅ fixed — counts tokens in the worker, warns in the UI |
| 2.4 | `add_special_tokens` not pinned | ✅ fixed |
| 2.5 | Similarity "maths" line printed `1.0000 × 1.0000` | ✅ fixed — real norms + top-10 contribution share |
| 2.6 | Space / newline tokens invisible | ✅ fixed — `·` and `⏎` glyphs |
| 2.7 | No context-window teaching, uncalibrated thresholds, dead code | ✅ fixed — context meter, tricky-pair presets, dead code gone |
| 3.1 | Two major versions behind on Transformers.js | ✅ **v4.3.2**, with v3 → v2 fallbacks |
| 3.2 | Inference blocked the UI thread | ✅ Web Worker (`src/lib/model-worker.js`) |
| 3.3 | Monolithic HTML + one 330-line script | ✅ modules + 3 stylesheets (no bundler — see §12) |
| 3.4 | Duplicated busy/error code, no URL state, dark only | ✅ `withBusy()`, shareable URLs, light theme |
| 4.1 | No multilingual / cost story | ✅ **Section 3** — 7 languages, cost vs English |
| 4.2 | Chips not honest about bytes or whitespace | ✅ byte fragments, glyphs, stats strip, round-trip badge |
| 4.3 | No next-token panel | ⏳ deferred — see §12 |
| 4.4 | Pair only; no corpus, no 2D map, no per-dimension contribution | ✅ **Sections 5 & 6** |
| 5 | Eager 23 MB load, no preconnect, DOM-heavy charts | ✅ lazy load, `preconnect`, canvas map |
| 6 | Accessibility gaps | ✅ skip link, roving tabindex, live regions, AA contrast, reduced motion |
| 7.1 | README was one line | ✅ full README — OG card, architecture diagram, model table, feature tour |
| 7.2 | No licence, no templates, no editor config | ✅ MIT, CONTRIBUTING, issue/PR templates |
| 7.3 | Deploy-only CI | ✅ `ci.yml` (65 tests) + deploy gated on it |
| 7.4 | No social metadata | ✅ OG/Twitter meta, 1200×630 card, sitemap, robots |
| 8 Tier 3 | BPE trainer, layer-wise view, glitch tokens, PWA, i18n | ⏳ deferred — see §12 |
| 9 | One page carried six demos and ~12 MB of model | ✅ v4 split it into six pages — see §14 |

**Test suite:** 67 tests — unit (token boundaries, cosine, PCA, formatting), static structure
(DOM ids, imports, assets), a jsdom integration test that drives all six panels against a fake
worker, and design-system guards (every custom property the scripts read must exist in the
stylesheets; no stale palette colour may survive; all six chip tints must be defined).

---

## 13. v3 — the visual identity (shipped)

The v2 page was correct and still looked like every other AI demo. v3 replaces the design language
outright rather than retuning it.

| Area | v2 | v3 |
|---|---|---|
| Palette | near-black `#0a1017`, blue `#58a6ff`, violet glow | warm paper `#f1ece1`, ink `#16130f`, one vermilion signal `#c0380f`, six muted chip tints |
| Type | system/Inter stack | Fraunces (variable, `opsz`/`SOFT`/`WONK`) + Space Grotesk + JetBrains Mono, self-hosted, 183 KB |
| Layout | centred column, cards with soft shadows | editorial masthead, split-word hero, 4-stage pipeline diagram, full-bleed marquee, sticky numbered rail with a progress rule, hairline-ruled sections, colophon footer |
| Surfaces | glassmorphism, blur, gradients | flat paper, 1–3 px radii, hard offset shadows, corner ticks, 3.5 % grain |
| Dark theme | invert of the light one | "Night Press" — warm near-black paper, same ink and signal |
| Motion | hover transitions only | word-stagger hero, scroll reveals, count-up facts, chip stamp on deliberate tokenize, view-transition theme wipe — all disabled under `prefers-reduced-motion` |
| Tests | 55 | 65 (design-system guards added) |

Design decisions, the reference set they answer, and the numbers behind them are in
[DESIGN.md](DESIGN.md). Three bugs the redesign introduced and the tests now prevent:

1. `chips.js` still painted the old neon palette **inline**, which would have silently overridden
   every new CSS tint — chips now carry `data-tint="1..6"` and the palette lives only in CSS.
2. `map-panel.js` read `--accent` / `--text` / `--surface-3` from the old tokens, so the meaning map
   drew with hard-coded fallbacks from the deleted palette.
3. `50,257` set in Fraunces at `opsz 140` renders its comma as a full stop — numerals now use
   `opsz 26`.


---

## 1. Verdict on v1 (kept for the record)

**The core was genuinely good.** The right models for a zero-backend demo (`Xenova/gpt2` +
`all-MiniLM-L6-v2`), readable code, comments that explain *why*, per-section error handling, a
consistent visual language, no framework tax.

What held it back wasn't craft — it was scope, plus a handful of correctness details that undermined
the teaching claim. The most important one: the page said *"Concatenate the chips and you get your
original text back"*, and that was **false for any non-Latin script or emoji**. For an audience in
India that is the wrong bug to have.

---

---

## 2. Correctness bugs

### 2.1 🔴 Per-token decode is broken for non-ASCII text

`script.js:123`

```js
const decoded = tokenizer.decode([ids[i]], { skip_special_tokens: false, ... });
```

GPT-2 uses **byte-level BPE**: a single character whose UTF-8 encoding is 3 bytes (e.g. `न` =
`E0 A4 A8`) is routinely split across 2–3 tokens. Decoding one token in isolation feeds a *truncated*
byte sequence to the UTF-8 decoder, which yields `` (U+FFFD) or an empty string. So for
`नमस्ते दुनिया` you will see a row of replacement characters, and the "concatenate to get your text
back" claim collapses.

You can't fix this with `decode(ids.slice(0, i+1))` and a string diff either — adding the final byte
can retroactively change an *earlier* character, so prefixes don't line up.

**Fix — decode with a streaming `TextDecoder` over the token's bytes.** Emit only what is complete,
and let the leftover bytes ride along to the next chip:

```js
// GPT-2 maps each vocab char to one byte via bytes_to_unicode(); invert that map once.
function buildByteDecoder(unicodeToByte) {
  const map = new Map();
  for (const [b, ch] of unicodeToByte) map.set(ch, b);
  return (tokenStr) => Uint8Array.from([...tokenStr].map((ch) => map.get(ch)));
}
const byteDecoder = buildByteDecoder(tokenizer.model?.byte_decoder ?? {});

// Stream across the whole sequence so partial sequences are buffered, not mangled.
function tokenTexts(ids) {
  const stream = new TextDecoder('utf-8'); // streaming mode via {stream: true}
  const out = [];
  for (const id of ids) {
    const tok = tokenizer.decode([id], { skip_special_tokens: false,
                                         clean_up_tokenization_spaces: false });
    out.push(stream.decode(byteDecoder(tok), { stream: true }));
  }
  out.push(stream.decode()); // flush
  return out;
}
```

Then render empty chips as a "byte fragment" (see 4.2) instead of losing them.

*Acceptance test:* `Array.from(chips).map(c => c.dataset.raw).join('') === input` for
`"नमस्ते दुनिया 🌏 你好 مرحبا"`.

### 2.2 🟠 Overall download progress is byte-unweighted

`script.js:183-186` averages each file's percentage equally. The model has ~4 files, and
`onnx/model_quantized.onnx` is ~90% of the bytes — so the bar reads "75% complete" when almost
nothing has downloaded, then crawls. Use the `loaded`/`total` fields the library already sends:

```js
const files = new Map(); // file -> {loaded, total}
// on 'progress': files.set(file, {loaded: data.loaded, total: data.total});
const bytes = [...files.values()];
const loaded = bytes.reduce((s, f) => s + f.loaded, 0);
const total  = bytes.reduce((s, f) => s + f.total, 0);
const pct = total ? (loaded / total) * 100 : 0;
```

While you're there: show **MB downloaded / total**, an ETA from a rolling throughput estimate, and
switch the copy to "cached — instant on your next visit" when the model loads from Cache Storage.

### 2.3 🟠 Silent 512-token truncation in the embedding panel

MiniLM's max position embeddings = 512. Paste a long paragraph and `embedder(text, …)` silently
truncates, so the displayed vector does not represent the whole text — and the similarity score is
quietly wrong. Nothing in the UI says so.

Fix: warn based on token count, e.g. `tokenizer(text).input_ids.length > 512 → "Only the first 512
tokens are embedded"`. Bonus: show a "meaning captured" bar and a genuinely better suggestion
(chunk + mean-pool the chunk vectors) for long text.

### 2.4 🟠 `tokenizer(text)` doesn't pin `add_special_tokens`

Harmless for GPT-2 (no post-processor), but the moment you add a second tokenizer — BERT adds
`[CLS]`/`[SEP]`, many LLM tokenizers add BOS — the token count and the "you get your text back"
claim both drift. Be explicit now:

```js
const { input_ids } = tokenizer(text, { add_special_tokens: false });
```

…and then *make special tokens a toggle in the UI*, because they're worth teaching.

### 2.5 🟡 Dead / misleading math in the similarity line

`script.js:143-152` computes `normA`/`normB` purely to print `1.0000 × 1.0000`. Two problems: it's
noise, and it hides the actual pedagogical point (that normalisation is *why* the dot product equals
cosine). Better: show both, computed honestly — raw dot product, both norms, then the ratio. If the
norms aren't 1.0000, the user learns something.

### 2.6 🟡 Space-only and newline tokens are invisible

`.chip` uses `white-space: pre-wrap`, so a token that is exactly `" "` renders as blank padding, and
`\n` renders as a line break inside a chip. Both are real tokens the model sees. Render whitespace
visibly (`·` for space, `⏎` for newline, `▁` for the sentencepiece convention) and keep the true
string in `dataset.raw`.

### 2.7 🟡 Minor

- `MAX_TOKENIZE_CHARS = 5000` protects the browser but nothing teaches the **context window**. GPT-2
  is 1024 tokens; show "412 / 1024 tokens" with a fill bar and the input goes red past it.
- `describeSimilarity` thresholds (0.75 / 0.5 / 0.25) are asserted, not calibrated. Ship a
  "reference pairs" strip with known scores so users can anchor their intuition.
- `dot` loops to `Math.min(a.length, b.length)` — fine, but assert equal dims and throw instead of
  silently comparing a prefix.
- `clean_up_tokenization_spaces: false` is right; note in the UI that this is why punctuation looks
  slightly off in old tutorials.
- `env.allowLocalModels = false` is correct for Pages, but you lose the ability to self-host later;
  make it a one-line build-time flag now.

---

## 3. Stack & architecture

### 3.1 Upgrade path: `@xenova/transformers` → `@huggingface/transformers`

The package was renamed and is now at v4.3.2. v2 gets no new models and no WebGPU. Migration is
small for this app:

```js
import { AutoTokenizer, pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
```

Key wins and API changes to expect: `device: 'webgpu'` with automatic WASM fallback,
`dtype: 'q4'|'q8'|'fp32'` replacing `quantized: true`, `onnx-community/*` model repos as the
canonical names (`Xenova/*` still resolves), `progress_callback` unchanged, and
`env.backends.onnx.wasm.numThreads` available if you later add COOP/COEP headers.

Feature-detect and degrade, don't gate:

```js
const device = (await (async () => {
  try { return (await navigator.gpu?.requestAdapter()) ? 'webgpu' : 'wasm'; }
  catch { return 'wasm'; }
})());
```

### 3.2 Get inference off the main thread

Right now `pipeline(...)` and every `embedder()` call run on the UI thread. On a mid-range Android
phone a batch of embeddings freezes the page for seconds — and the "loading" pulsing dot freezes with
it, which looks broken. Move both models into a **Web Worker** with a tiny promise-based RPC
(`{id, op, payload}` in, `{id, result|error}` out). Bonus: the progress callbacks can drive the bar
from the worker via `postMessage`. This is ~80 lines and it's the difference between "demo" and
"product" on mobile.

### 3.3 Add a build step (Vite + TypeScript), keep zero-backend

The repo currently leans on "no build step" as a virtue, but by the time you have 5 demos, shared
utilities (`cosine`, `pca`, `formatBytes`), and multi-model loading, a single 600-line HTML file with
370 lines of inline CSS will fight you. Vite gives you: TS type-checking against `@huggingface/transformers`
types, tree-shaken bundle, hashed assets, `import.meta.env` flags, HMR, and a `dist/` you can point
GitHub Pages at. It still deploys as static files.

Suggested layout:

```
src/
  main.ts
  styles/
    tokens.css            # design tokens only (:root vars, type scale, spacing)
    base.css
  lib/
    model-worker.ts       # Web Worker: tokenize + embed RPC
    models.ts             # registry: id, repo, size, context, tokenizer family
    cosine.ts             # + pca.ts, knn.ts, bpE.ts
    bpe.ts                # tiny trainable BPE for the "build your own tokenizer" demo
    dom.ts                # $, setStatus, showError
  demos/
    tokenize/   index.ts  render.ts
    compare/    index.ts  render.ts      # multi-tokenizer race
    embed/      index.ts  render.ts      # corpus explorer
    space/      index.ts  render.ts      # 2D projection
  index.html
tests/
  unit/ cosine.test.ts  bpe.test.ts  format.test.ts
  e2e/  smoke.spec.ts                  # Playwright, models mocked from fixtures
```

### 3.4 Component hygiene

- **CSS**: 370 lines live in `<style>`. Extract to files; keep the design-token block as the single
  source of truth. Add a light theme — `color-scheme: dark` is hard-coded at `index.html:22`, which
  is an accessibility complaint waiting to happen for users with astigmatism.
- **Duplication**: `tokenize()` and `compare()` each hand-roll the same
  disable-button → try → catch → finally dance. One `withBusy(button, label, fn)` helper removes it.
- **Colour**: the 8-colour chip palette (`#e3b341` yellow with `#0a0e14` text) needs a contrast
  audit; run the palette through WCAG AA (4.5:1 for body text). Also, colour alone distinguishes
  adjacent tokens — add a subtle alternating border for colour-blind users.
- **State**: nothing is in the URL. Encode `?text=…&a=…&b=…&model=…` with
  `history.replaceState` so a comparison is shareable, and persist via `localStorage`. This is the
  cheapest virality feature you can build.

---

## 4. Teaching quality (the part that matters most)

The current page explains **what** tokens and vectors are. It doesn't yet explain **why anyone
cares**. Three cheap additions fix that:

### 4.1 The multilingual / cost panel — highest value per line of code

Put the same sentence in English, Hindi, Bengali, Chinese, Japanese and Arabic, run all of them
through the tokenizer, and show tokens-per-word and cost per 1M chars side by side. Hindi and Tamil
typically consume 2–5× the tokens of English for the same content; that's not trivia, it's a real
economic and fairness story (context windows, API bills, latency) and it lands hard with an Indian
audience. You already have every primitive needed — this is a table and a `fetch`-free loop.

### 4.2 Make the chips honest

- Show whitespace as `·` / `⏎` / `▁` (see 2.6).
- Two view modes: **byte view** (each chip is its raw bytes, reveals why `न` splits) and **text view**.
- A "bytes → tokens" reveal for a single word, animated.
- Token count, character count, bytes, and tokens/char ratio as a stats strip. People screenshot
  stats strips.

### 4.3 Close the loop: tokens → vectors → *next token*

The page stops at embeddings, which is where most explainers stop and where most confusion starts.
A third panel that runs a small causal LM (`onnx-community/SmolLM2-135M-Instruct-ONNX` or similar,
~100 MB q4 — fine behind a "load model" click) showing top-5 next-token probabilities for a prompt
does more for intuition than any diagram. It also finally justifies the tokenization panel: you can
literally show that the same prompt tokenized two ways gives different continuations.

### 4.4 Embedding panel upgrades

- **Corpus, not a pair.** Accept N texts (textarea, one per line), compute the N×N cosine matrix,
  render a heatmap, and show nearest neighbours per item. This is the mental model behind RAG, and
  RAG is what people actually want to understand.
- **Show the dot product per dimension.** The current chart plots `A` only. Plot
  `A_i × B_i` contributions sorted descending — the top 5 dimensions are responsible for most of the
  score. That's the "aha" the current chart doesn't deliver.
- **2D map.** PCA (you can do 384→2 with a 30-line power-iteration SVD, no dependency) then canvas
  scatter with hover labels. Add "type a new sentence, watch it land near its semantic neighbours".
- **Contrastive gotchas.** Curate pairs that break naive intuition: `hot`/`cold` ≈ 0.65,
  `happy`/`unhappy` ≈ 0.6, `bank`(river)/`bank`(money) ≈ 0.7. Antonyms and homonyms are close in
  embedding space — saying so out loud is what separates a good explainer from a bad one.
- **Model comparison.** `all-MiniLM-L6-v2` (384d) vs `bge-small-en-v1.5` (384d) vs
  `multilingual-e5-small` (384d, multilingual) on the same pair. Show that "similarity" is
  model-relative; cross-model scores are not comparable.

---

## 5. Performance

| Item | Now | Do |
|---|---|---|
| Bundle | CDN ESM, unpinned integrity | Vite build, self-host or pin + `integrity` where possible |
| Model load | Both models eagerly on `DOMContentLoaded` (~23 MB before the user does anything) | Lazy-load per panel on first interaction / `IntersectionObserver`; respect `navigator.connection.saveData` |
| Inference | Main thread | Web Worker (3.2); WebGPU when available |
| Cache | Cache Storage by default | Show "cached", plus optional "prefetch model" button and a `ServiceWorker` for the app shell |
| Layout | 384 bar rows would be 384 DOM nodes if you show all dims | Canvas for anything > ~200 elements; the current 64 is fine |
| Fonts/meta | No `preconnect` | `<link rel="preconnect" href="https://cdn.jsdelivr.net">` and `https://huggingface.co` |

Also: `import()` the pipeline lazily so the tokenizer panel is interactive in <1s while the 23 MB
model streams in the background (you already do this conceptually; make it intentional and visible
with a "model downloads only when you open this panel" promise).

---

## 6. Accessibility

- `color-scheme: dark` forced; no light mode, no `prefers-color-scheme` support.
- Chips are hover-only (`title`, `cursor: default`) — not focusable, so keyboard users can't inspect
  token IDs. Make them `<button tabindex="0">` with a detail pane, or add a proper `<table>` of
  token / ID / bytes below.
- Everything is distinguished by colour (chips, positive/negative bars). Add a pattern or a sign.
- `aria-live="polite"` on the status lines is right, but the *results* appearing are announced to
  nobody. Add a single politely-live summary per panel ("Tokenized: 17 tokens").
- `prefers-reduced-motion`: the meter/bar transitions and the pulsing dot should be disabled.
- No `<main>` landmark issue (there is one, good), but there's no skip link and headings jump from
  `h1` to `h2` inside `h2`-less sections — actually fine; the `.step` numbers are decorative and
  should be `aria-hidden`.
- Run `axe-core` in CI and keep it at zero violations.

---

## 7. Repo, docs, DevOps

### 7.1 README is empty — this is your biggest loss per minute spent

`README.md` is a single line: `# tokenizer`. For a showcase repo that's the difference between
"portfolio piece" and "someone's scratch folder". It needs:

1. One-sentence pitch + **live demo link** (the Pages URL).
2. An animated GIF or 3 screenshots of the three panels.
3. "What you'll learn in 2 minutes" — 4 bullets.
4. Architecture diagram: browser → Transformers.js → ONNX Runtime (WASM/WebGPU) → HF Hub → Cache
   Storage.
5. Model table: repo id, size, params, context, dims, licence.
6. How it works (short), how to run (`npx serve` — no build needed today), how to deploy.
7. Repo layout and the tech choices with reasons ("why in-browser? privacy, zero cost, offline").
8. Credits (Transformers.js, HF Hub) and licence.

### 7.2 Missing repo furniture

`LICENSE` (MIT — without it nobody can legally reuse this), `CONTRIBUTING.md`, issue/PR templates,
`.editorconfig`, `.gitignore`, `.nvmrc`, `package.json` with scripts, and a `docs/` folder for
longer write-ups. `.github/` currently only has the deploy workflow.

### 7.3 CI/CD

`deploy.yml` works but is deploy-only. Split into:

- `ci.yml` on PRs: install → typecheck → lint (ESLint + Prettier) → unit tests (Vitest) → build →
  Playwright smoke test with **model files mocked from fixtures** (otherwise every CI run downloads
  23 MB from the Hub and flakes when the CDN hiccups) → `axe` accessibility check → Lighthouse CI
  budget (perf ≥ 95 on the app shell).
- `deploy.yml`: `workflow_run` after CI on `main`, upload `dist/` (not `.`) — right now `path: .`
  ships the whole repo including docs and workflows to Pages.
- Add caching for `~/.cache/huggingface` in CI and a monthly scheduled job that just verifies the
  pinned model repos still resolve (they do get renamed/removed).

### 7.4 Deployment notes

- GitHub Pages can't set security headers, so you can't do COOP/COEP → no `SharedArrayBuffer` →
  no WASM multi-threading. Either accept single-threaded WASM (current) or move to Cloudflare
  Pages/Netlify/Vercel where you can set the two headers and gain real multithreaded speed.
- Add `<link rel="canonical">`, Open Graph + Twitter card meta, a 1200×630 OG image, and a
  `sitemap.xml`. A good OG image is worth thousands of impressions when this gets shared.

---

## 8. Taking it to the next level — three tiers

### Tier 1 — "Make it correct and credible" (~2–3 days)

Fix §2.1–2.6, upgrade to Transformers.js v4, write the README + licence, add Vitest tests for
`cosine`/formatting/byte-decoding, add `ci.yml` with lint + test, ship OG meta. **Outcome:** a repo
you can put on a CV today with no asterisks.

### Tier 2 — "Make it a lab, not a demo" (~1–2 weeks)

- **Tokenizer comparison race**: pick 2–4 tokenizers (GPT-2, Llama-3, Qwen2.5, BERT) → same text,
  side-by-side chips, token counts, and a compression-ratio bar chart. This single screen is the
  feature people will share. Load tokenizers (~1 MB each) on demand.
- **Corpus embedding explorer**: N texts → similarity matrix heatmap + nearest neighbours + stats.
- **2D semantic map** with PCA and live "drop a new sentence in" interaction.
- **Multilingual/cost panel** (§4.1).
- **Shareable URL state** + localStorage + copy/download buttons.
- **Web Worker** inference, WebGPU where available, lazy model loading, byte-accurate progress.
  **Outcome:** something you can demo in an interview and answer "what did you build?" for five
  minutes without repeating yourself.

### Tier 3 — "Make it a reference" (~1 month)

- **Build-a-tokenizer**: implement BPE training in the browser (`bpe.ts`). Paste a corpus, watch
  merges happen step by step, adjust vocab size, then tokenize with *your* tokenizer and compare to
  GPT-2. Nothing else on the web does this interactively and well.
- **Full pipeline narrative**: tokens → vectors → attention → next-token probabilities, using a tiny
  LM. Add a slider over layers showing how cosine similarity between two sentences *grows* through
  the stack (`output_hidden_states`) — a genuinely novel visualization.
- **Named failure modes**: glitch tokens (SolidGoldMagikarp), the "how many r's in strawberry"
  letter-counting failure, token-boundary sensitivity, why `2+2` and `2 + 2` tokenize differently.
  Each is one card with a live tokenization underneath.
- **Multilingual depth**: Devanagari/Bengali/Tamil byte-splitting close-up with a byte-level
  animation — likely the most-quoted panel, and none of the big explainers cover it.
- **Offline PWA** + i18n (at minimum en/hi) + light theme.
- **Blog post** with screenshots, cross-posted to r/MachineLearning / HN / X, plus a short
  "how I built this in the browser" write-up. The post is what turns the repo into traffic.

---

## 9. Sequencing (suggested)

```
Week 1   §2 bug fixes · v4 upgrade · README · LICENSE · Vitest + CI          → Tier 1 done
Week 2   Web Worker + lazy load + WebGPU + weighted progress + URL state
Week 3   Multi-tokenizer comparison panel (the flagship)
Week 4   Corpus explorer: matrix, kNN, PCA map · share buttons
Week 5   Multilingual/cost panel · whitespace/byte views · a11y pass
Week 6   Polish: OG image, PWA, Lighthouse, blog post, launch
```

## 10. How you'll know it worked

- 0 `axe` violations, Lighthouse perf ≥ 95 on the shell.
- Interactive in <1.5 s on a throttled 3G profile (tokenizer panel alone).
- Every panel works with Hindi + emoji input, and `join(chips) === input` passes as a unit test.
- Embedding batch of 10 texts completes in <300 ms on WebGPU, no dropped frames.
- A stranger can open the link, understand the point in 60 s, and find a share URL that reproduces
  exactly what they were looking at.

---

## 11. Quick-win checklist (all shipped in v2)

- [x] Fix per-token decoding (`TextDecoder` streaming) — §2.1
- [x] `add_special_tokens: false` made explicit — §2.4
- [x] Byte-weighted download progress + MB readout — §2.2
- [x] Warn on >512-token embedding truncation — §2.3
- [x] Render spaces/newlines visibly — §2.6
- [x] Context-window meter (1024 for GPT-2)
- [x] Upgrade to `@huggingface/transformers@4.3.2`
- [x] Extract CSS, add light theme + `prefers-color-scheme`
- [x] Make chips keyboard-focusable
- [x] README + LICENSE + OG image
- [x] `withBusy()` helper, delete dead math line
- [x] `ci.yml` with lint + tests, deploy `dist/`
- [x] URL state + localStorage
- [x] `preconnect` to jsDelivr + HF

## 12. Deliberately not shipped

Four things from the plan were left out on purpose — each would either have shipped unverifiable
code or traded away the property that makes this repo work (it is static files, and it explains
itself without a build step).

### 12.1 A build step (Vite + TypeScript)

§3.3 argued for one. v2 instead uses **plain ES modules with a strict module boundary**:
`src/lib/` is pure logic, `src/demos/` is DOM, `src/lib/model-worker.js` is inference. The benefit a
bundler would add here is marginal (the app is ~60 KB of hand-written JS), while the cost is real:
no `git clone && serve`, no "why is my file not updating", no lockfile drift for a page whose whole
identity is *open it and it works*. The 55-test suite covers what a type checker would have caught
most of (DOM ids, import paths, message protocol shape). If the panel count doubles again, revisit
this — the migration is mechanical.

### 12.2 Next-token probabilities (a small causal LM)

The one feature I'd most like to add, and the one that can't be verified from this environment: it
needs a ~100 MB generation model, and shipping a panel whose model id I cannot confirm resolves
would be exactly the failure mode the rest of this repo guards against. The design is ready:
add a `text-generation` branch to the worker, run one forward pass, softmax the last position's
logits, render the top five. It belongs behind its own opt-in button.

### 12.3 BPE trainer, layer-wise similarity, glitch tokens, PWA, UI i18n

All still on the roadmap (Tier 3 in §8), all additive. The BPE trainer is the highest-value item and
the most work: `src/lib/bpe.js` + a merge-animation UI + tests.

### 12.4 COOP/COEP headers for multi-threaded WASM

GitHub Pages cannot set them, so `SharedArrayBuffer` is unavailable and WASM inference stays
single-threaded. Moving to Cloudflare Pages or Netlify would unlock both headers and a measurable
speed-up. Documented rather than done, because it changes where the project is hosted.

---

## 14. v4 — six pages instead of one long scroll (shipped)

The v3 page was finally worth looking at, and it was still too much: one document carried a hero,
six demos, six explanations and every model the project owns. A first-time reader had to scroll past
four panels to learn what the fifth was, and the page fetched the 23 MB embedder whether you wanted it
or not.

It is now six documents: `index.html` plus one page per idea (`tokens`, `tokenizers`, `languages`,
`vectors`, `corpus`). The map moved into the corpus chapter, where it belongs — it is the same data
seen from above, not a separate subject.

| Concern | v3 | v4 |
|---|---|---|
| Structure | one 573-line document | landing page (301 lines) + five chapters (208–250 lines each) |
| Media on load | worker + tokenizer + lazy 23 MB embedder | landing page downloads **nothing**; each chapter loads only its own model |
| Navigation | in-page anchors | masthead chapter nav + per-page index rail + prev/next pager |
| Explanation | one `panel-sub` paragraph per demo | two-sentence intro, a *try this* list, then a *what you're looking at* note |
| Dead ends | none | none — every chapter links forward |
| Tests | 65, one big DOM boot | 67, and a harness that boots **each page in its own JSDOM** |

Three structural guarantees now enforced by `tests/structure.test.js`, because with no build step
the chrome is repeated in six files and will drift:

1. The masthead nav, wordmark, theme toggle, colophon, skip link and error slot must be **identical**
   on every page, and the nav must list the chapters in reading order.
2. Every id that a page's module graph queries must exist **on that page** — the graph is walked from
   the `<script type="module">` tag, so a panel that moves pages takes its requirements with it.
3. Every chapter must appear in the landing page's chapter list and in every page's index rail, and
   every pager must point at a real page.

`tests/dom.test.js` was rebuilt around `bootPage(file)`: each page boots in a fresh JSDOM with a fake
worker, and the assertions for a panel only pass if *that page's markup* supports *that page's
module*. Booting `index.html` alone would prove nothing about whether `tokens.html` works.
