/**
 * CONTEXT.md declares a ubiquitous-language contract: each term carries an
 * _Avoid_ list of names that mean something else, or nothing at all. No other
 * file reads that list, so it stays declarative unless this one enforces it.
 *
 * The second concern is narrower: a correct word spent on the wrong thing.
 * CONTEXT.md binds the canonical short ID to "session candidates and
 * 引用图元", so the word denotes the inline marker and not a figure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHtml, VIEWPORT } from './helpers/render-mention-demo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const README_FILES = ['README.md', 'README_ZH.md'];

// ADR-0033 4.4 fixes the content contract for the reference showcase, so the
// prose it prescribes answers to the same vocabulary as the READMEs.
const AUTHORED_ADR = 'docs/adrs/0033-public-surface-contract.md';

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

/** Every term CONTEXT.md tells authors not to use. */
function avoidedTerms() {
  const terms = [];
  for (const line of readText('CONTEXT.md').split(/\r?\n/)) {
    const match = line.match(/^_Avoid_:\s*(.+)$/);
    if (match) terms.push(...match[1].split(',').map((term) => term.trim()).filter(Boolean));
  }
  return terms;
}

test('ubiquitous language: CONTEXT.md still declares an _Avoid_ list to enforce', () => {
  const terms = avoidedTerms();
  assert.ok(
    terms.length >= 30,
    'CONTEXT.md must keep declaring its _Avoid_ vocabulary, found ' + terms.length + ' terms (contract: ubiquitous language)'
  );
});

test('ubiquitous language: shipping documentation uses none of the avoided terms', () => {
  const terms = avoidedTerms();

  for (const relPath of [...README_FILES, AUTHORED_ADR]) {
    const body = readText(relPath);
    const used = terms.filter((term) => body.includes(term));

    assert.deepEqual(
      used,
      [],
      relPath + ' must not use terms CONTEXT.md marks as avoid, found: ' + used.join(', ') +
        ' (contract: ubiquitous language)'
    );
  }
});

test('ubiquitous language: the rendered figure copy respects the same vocabulary', () => {
  const terms = avoidedTerms();

  for (const locale of ['en', 'zh']) {
    const html = buildHtml(locale, VIEWPORT);
    const used = terms.filter((term) => html.includes(term));

    assert.deepEqual(
      used,
      [],
      locale + ' figure copy must not use terms CONTEXT.md marks as avoid, found: ' + used.join(', ') +
        ' (contract: ubiquitous language)'
    );
  }
});

test('ubiquitous language: 引用图元 stays reserved for the composer chip', () => {
  // The collision can only happen in Chinese prose. CONTEXT.md itself is exempt
  // because it is where the term is defined.
  const body = readText('README_ZH.md');
  const withoutCompound = body.split('引用图元').join('');

  assert.ok(
    withoutCompound.includes('图元') === false,
    'README_ZH.md may use 图元 only inside 引用图元; a bare 图元 means the term was spent on something else ' +
      '(contract: ubiquitous language)'
  );
  assert.ok(
    body.includes('图元'),
    'README_ZH.md must mention the inline reference marker (contract: ubiquitous language)'
  );
});
