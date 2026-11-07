/**
 * Static sanity checks for a no-build, multi-page site.
 *
 * Six documents share one vocabulary of ids, one stylesheet and one set of
 * modules. Nothing here needs a browser, and everything here is the class of
 * mistake a browser would otherwise reveal as "nothing happens when I click":
 * an id a page module queries but the page doesn't contain, an import path
 * that doesn't resolve, a chapter nobody links to, or chrome that has drifted
 * between pages because there is no build step to share a partial.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHAPTER_PAGES = [
  'tokens.html',
  'tokenizers.html',
  'languages.html',
  'vectors.html',
  'corpus.html',
];
const PAGES = ['index.html', ...CHAPTER_PAGES];

const pageHtml = new Map(PAGES.map((page) => [page, readFileSync(join(root, page), 'utf8')]));
const html = pageHtml.get('index.html'); // landing page, used by several checks below

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const jsFiles = walk(join(root, 'src'));
const jsSource = (file) => readFileSync(file, 'utf8');

const idsIn = (source) => new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/** The ids a module and everything it imports (transitively) queries. */
function idsQueriedBy(entryFile, seen = new Set(), ids = new Set()) {
  const file = resolve(root, entryFile);
  if (seen.has(file)) return ids;
  seen.add(file);

  const source = jsSource(file);
  for (const match of source.matchAll(/\$\('#([\w-]+)'/g)) ids.add(match[1]);
  for (const match of source.matchAll(/getElementById\('([\w-]+)'\)/g)) ids.add(match[1]);

  for (const match of source.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
    idsQueriedBy(resolve(dirname(file), match[1]), seen, ids);
  }
  return ids;
}

const entryOf = (source) =>
  source.match(/<script type="module" src="([^"]+)"><\/script>/)?.[1] ?? null;

/* ------------------------------------------------------------------------ */
/*  Every page is a well-formed document in the same family                  */
/* ------------------------------------------------------------------------ */

test('every page has one <main>, one <h1> and a module entry point', () => {
  for (const page of PAGES) {
    const source = pageHtml.get(page);

    assert.equal((source.match(/<main\b/g) ?? []).length, 1, `${page}: exactly one <main>`);
    assert.equal((source.match(/<h1\b/g) ?? []).length, 1, `${page}: exactly one <h1>`);

    const entry = entryOf(source);
    assert.ok(entry, `${page}: loads a module entry point`);
    assert.ok(existsSync(join(root, entry)), `${page}: ${entry} exists`);
  }
});

test('no page has duplicate ids', () => {
  for (const page of PAGES) {
    const ids = [...pageHtml.get(page).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    assert.deepEqual(duplicates, [], `${page}: duplicate ids ${duplicates.join(', ')}`);
  }
});

test('every id a page module queries exists on that page', () => {
  // Created at runtime by the app itself.
  const dynamic = new Set(['sr-live']);

  for (const page of PAGES) {
    const ids = idsIn(pageHtml.get(page));
    const missing = [];
    for (const id of idsQueriedBy(entryOf(pageHtml.get(page)))) {
      if (!ids.has(id) && !dynamic.has(id)) missing.push(`#${id}`);
    }
    assert.deepEqual(missing, [], `${page} is missing ${missing.join(', ')}`);
  }
});

test('the shared chrome is identical across every page', () => {
  const chrome = (source) => ({
    nav: [...source.matchAll(/class="site-nav"[\s\S]*?<\/nav>/g)]
      .map((m) => [...m[0].matchAll(/href="([^"]+)"/g)].map((h) => h[1]).join(','))[0],
    wordmark: /class="wordmark"/.test(source),
    theme: /id="theme-toggle"/.test(source),
    colophon: /class="colophon"/.test(source),
    skip: /class="skip-link"/.test(source),
    noscript: /<noscript>/.test(source),
    grain: /class="grain"/.test(source),
    error: /id="page-error"/.test(source),
  });

  const reference = chrome(pageHtml.get('index.html'));
  for (const page of PAGES.slice(1)) {
    assert.deepEqual(chrome(pageHtml.get(page)), reference, `${page} chrome drifted from index.html`);
  }

  // …and the nav actually lists every chapter, in order.
  assert.equal(
    reference.nav,
    CHAPTER_PAGES.join(','),
    'the top nav links every chapter exactly once, in reading order',
  );
});

test('the chapter index appears on every chapter page', () => {
  for (const page of CHAPTER_PAGES) {
    const source = pageHtml.get(page);
    const rail = source.match(/class="rail-list"[\s\S]*?<\/ol>/)?.[0] ?? '';
    const hrefs = [...rail.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, CHAPTER_PAGES, `${page}: the index lists every chapter`);

    // The current chapter is the only one marked.
    const current = [...source.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map((m) => m[1]);
    assert.ok(current.includes(page), `${page}: marks itself in the chrome`);
  }
});

test('every chapter is reachable from the landing page', () => {
  for (const page of CHAPTER_PAGES) {
    assert.ok(html.includes(`href="${page}"`), `index.html links ${page}`);
  }
  assert.ok(html.includes('class="chapter-grid"'), 'the landing page carries the chapter list');
});

test('the pager never dead-ends', () => {
  for (const page of CHAPTER_PAGES) {
    const source = pageHtml.get(page);
    const pager = source.match(/<nav class="pager"[\s\S]*?<\/nav>/)?.[0] ?? '';
    const hrefs = [...pager.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs.length, 2, `${page}: has a previous and a next link`);
    for (const href of hrefs) {
      assert.ok(PAGES.includes(href), `${page}: pager target ${href} is a real page`);
    }
  }
});

/* ------------------------------------------------------------------------ */
/*  Modules, assets and data                                               */
/* ------------------------------------------------------------------------ */

test('every relative import resolves on disk', () => {
  for (const file of jsFiles) {
    for (const match of jsSource(file).matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
      const target = resolve(dirname(file), match[1]);
      assert.ok(
        statSync(target, { throwIfNoEntry: false }),
        `unresolved import in ${basename(file)}: ${match[1]}`,
      );
    }
  }
});

test('every stylesheet and script a page links exists', () => {
  for (const page of PAGES) {
    const links = [...pageHtml.get(page).matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((href) => /^(styles|src|assets)\//.test(href));

    assert.ok(links.length >= 5, `${page} links its stylesheets, fonts and entry module`);
    for (const link of links) {
      assert.ok(existsSync(join(root, link)), `${page} references a missing file: ${link}`);
    }
  }
});

test('every page shares the same stylesheets', () => {
  const ref = [...pageHtml.get('index.html').matchAll(/href="(styles\/[\w.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ref, ['styles/tokens.css', 'styles/base.css', 'styles/components.css']);
  for (const page of PAGES.slice(1)) {
    const own = [...pageHtml.get(page).matchAll(/href="(styles\/[\w.]+)"/g)].map((m) => m[1]);
    assert.deepEqual(own, ref, `${page} loads a different stylesheet set`);
  }
});

test('sample buttons map to real sample strings', async () => {
  const { SAMPLES } = await import('../src/lib/models.js');

  for (const page of PAGES) {
    const names = [...pageHtml.get(page).matchAll(/data-sample="([\w-]+)"/g)].map((m) => m[1]);
    for (const name of names) {
      assert.ok(SAMPLES[name], `${page}: data-sample="${name}" has no entry in SAMPLES`);
    }
  }
});

test('the tokenizer registry is internally consistent', async () => {
  const { TOKENIZERS, EMBEDDER, LANGUAGE_SAMPLES } = await import('../src/lib/models.js');

  assert.ok(TOKENIZERS.length >= 4);
  assert.equal(new Set(TOKENIZERS.map((model) => model.id)).size, TOKENIZERS.length, 'unique ids');

  for (const model of TOKENIZERS) {
    assert.ok(model.repo.includes('/'), `${model.id} has a Hub repo`);
    assert.ok(model.vocab > 1000, `${model.id} declares a vocabulary size`);
    assert.ok(model.context > 0, `${model.id} declares a context window`);
    assert.ok(Array.isArray(model.alts), `${model.id} declares fallback repos`);
  }

  assert.equal(EMBEDDER.dimensions, 384);
  assert.ok(LANGUAGE_SAMPLES.length >= 5);
  assert.equal(LANGUAGE_SAMPLES[0].code, 'en', 'English is the cost baseline');
});

test('the old single-page entry point is gone', () => {
  for (const page of PAGES) {
    assert.ok(!/src\/main\.js/.test(pageHtml.get(page)), `${page} still loads src/main.js`);
    assert.ok(!/script\.js/.test(pageHtml.get(page)), `${page} still loads script.js`);
  }
  assert.equal(existsSync(join(root, 'src', 'main.js')), false, 'src/main.js was removed');
});

test('the sitemap lists every page', () => {
  const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  for (const page of PAGES) {
    const url = page === 'index.html' ? '' : page;
    assert.ok(sitemap.includes(url === '' ? 'tokenizer/</loc>' : `tokenizer/${url}`), `sitemap is missing ${page}`);
  }
});

/* ------------------------------------------------------------------------ */
/*  Design-system integrity                                                 */
/* ------------------------------------------------------------------------ */

const cssSource = ['tokens.css', 'base.css', 'components.css']
  .map((name) => readFileSync(join(root, 'styles', name), 'utf8'))
  .join('\n');

test('every custom property the scripts read is defined in the stylesheets', () => {
  const defined = new Set([...cssSource.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  // set by script at runtime, so they have no declaration to find
  const runtime = new Set(['--animate', '--vt-x', '--vt-y', '--i']);

  const missing = [];
  for (const file of jsFiles) {
    for (const [, name] of jsSource(file).matchAll(/(--[a-z][a-z0-9-]+)/g)) {
      if (!defined.has(name) && !runtime.has(name)) missing.push(`${name} (${basename(file)})`);
    }
  }

  assert.deepEqual([...new Set(missing)], [], 'undefined custom properties');
});

test('the chip palette is defined for all six tints', () => {
  for (let tint = 1; tint <= 6; tint += 1) {
    assert.match(cssSource, new RegExp(`\\[data-tint="${tint}"\\]`), `tint ${tint} has a rule`);
  }
});

test('no stale palette colours survive from the previous design', () => {
  const stale = ['#58a6ff', '#1f6feb', '#79c0ff', '#8ce99a', '#0a1017', '--accent', '--surface-3'];
  for (const file of jsFiles) {
    const source = jsSource(file);
    for (const token of stale) {
      assert.ok(!source.includes(token), `${basename(file)} still references ${token}`);
    }
  }
});

test('every class the page chrome uses is styled', () => {
  const required = [
    'site-nav',
    'sn-num',
    'sn-label',
    'try',
    'try-list',
    'page-notes',
    'pager',
    'pager-link',
    'chapter-grid',
    'chapter-link',
    'chapter-num',
    'chapter-title',
    'chapter-dek',
    'chapter-meta',
    'chapter-arrow',
    'cost-note',
    'chapter-rule',
    'page-error',
    'hero-cta',
    'btn-primary',
  ];
  for (const name of required) {
    assert.ok(cssSource.includes(`.${name}`), `.${name} has no rule`);
  }
});

test('fonts are self-hosted and licensed', () => {
  const fontDir = join(root, 'assets', 'fonts');
  const files = readdirSync(fontDir);
  for (const face of ['fraunces', 'space-grotesk', 'jetbrains-mono']) {
    assert.ok(files.some((f) => f.startsWith(face) && f.endsWith('.woff2')), `${face} woff2 present`);
  }
  assert.equal(files.filter((f) => f.startsWith('LICENSE-')).length, 3, 'one licence per face');

  for (const page of PAGES) {
    assert.ok(
      !pageHtml.get(page).includes('fonts.googleapis.com'),
      `${page} loads a third-party font CDN`,
    );
  }

  // `woff2-variations` is a legacy descriptor that some browsers reject outright,
  // which would silently drop the whole type system back to Georgia.
  const tokens = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8');
  assert.ok(!tokens.includes('woff2-variations'), 'font src uses the portable woff2 descriptor');
});
