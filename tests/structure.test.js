/**
 * Static sanity checks for a no-build page.
 *
 * These run in milliseconds and catch the class of mistake that a browser
 * would otherwise reveal as "nothing happens when I click": a query for a DOM
 * id that doesn't exist in index.html, an import path that doesn't resolve, a
 * stylesheet nobody links, or a sample name the data attributes don't match.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const jsFiles = walk(join(root, 'src'));

/* ------------------------------------------------------------------------ */

test('index.html has no duplicate ids', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const seen = new Set();
  const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(duplicates, [], `duplicate ids: ${duplicates.join(', ')}`);
});

test('every id the JavaScript queries exists in index.html', () => {
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

  // Created at runtime by the app itself.
  const dynamic = new Set(['sr-live']);

  const missing = [];
  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    const selectors = [
      ...source.matchAll(/\$\('#([\w-]+)'/g),
      ...source.matchAll(/getElementById\('([\w-]+)'\)/g),
    ].map((match) => match[1]);

    for (const id of selectors) {
      if (!htmlIds.has(id) && !dynamic.has(id)) {
        missing.push(`${file.replace(root + '/', '')} → #${id}`);
      }
    }
  }

  assert.deepEqual(missing, [], `missing DOM ids:\n${missing.join('\n')}`);
});

test('every relative import resolves on disk', () => {
  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      const target = resolve(dirname(file), specifier);
      assert.ok(statSync(target, { throwIfNoEntry: false }), `unresolved import in ${file}: ${specifier}`);
    }
  }
});

test('every stylesheet and script the page links exists', () => {
  const links = [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((href) => /^(styles|src|assets)\//.test(href));

  assert.ok(links.length >= 4, 'page links its stylesheets and entry module');

  for (const link of links) {
    assert.ok(
      statSync(join(root, link), { throwIfNoEntry: false }),
      `index.html references a missing file: ${link}`,
    );
  }
});

test('sample buttons map to real sample strings', async () => {
  const { SAMPLES } = await import('../src/lib/models.js');
  const names = [...html.matchAll(/data-sample="([\w-]+)"/g)].map((match) => match[1]);

  assert.ok(names.length > 0, 'there are sample buttons in the markup');
  for (const name of names) {
    assert.ok(SAMPLES[name], `data-sample="${name}" has no entry in SAMPLES`);
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

test('no leftover references to the old script', () => {
  assert.ok(
    !/script\.js/.test(html),
    'index.html should not still load the old monolithic script.js',
  );
});
