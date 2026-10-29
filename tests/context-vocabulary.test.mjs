/**
 * CONTEXT.md declares a ubiquitous-language contract: each term carries an
 * _Avoid_ list of names that mean something else, or nothing at all. That list
 * is the single source; this gate reads it at runtime and refuses to keep a
 * second copy, so adding a term to CONTEXT.md is enough to enforce it.
 *
 * The scan covers every tracked text file except the two that either define the
 * vocabulary or record it historically. Two narrower concerns stay here: the
 * rendered figure copy, and the inline marker whose Chinese name is reserved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildHtml, VIEWPORT } from './helpers/render-mention-demo.mjs';
import {
  VOCABULARY_EXEMPT,
  findViolations,
  formatViolations,
  isScannedPath,
  parseAvoidTerms
} from './helpers/vocabulary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function avoidedTerms() {
  return parseAvoidTerms(readText('CONTEXT.md'));
}

function trackedTextFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((relPath) => !VOCABULARY_EXEMPT.has(relPath) && isScannedPath(relPath));
}

test('ubiquitous language: CONTEXT.md still declares an _Avoid_ list to enforce', () => {
  const terms = avoidedTerms();
  assert.ok(
    terms.length >= 30,
    'CONTEXT.md must keep declaring its _Avoid_ vocabulary, found ' + terms.length + ' terms (contract: ubiquitous language)'
  );
});

test('ubiquitous language: the matcher honours whole words, casing, and plurals', () => {
  // Synthetic terms only: the repository scan below covers this file too.
  const terms = ['flarn', '示例组件'];
  const hits = (text) => findViolations(text, terms, 'probe').map((hit) => hit.term);

  assert.deepEqual(hits('two flarns arrived'), ['flarn'], 'plural Latin term must match');
  assert.deepEqual(hits('FLARN appears'), ['flarn'], 'Latin term matching must ignore casing');
  assert.deepEqual(hits('flarnbox internals'), [], 'a longer compound word must not match');
  assert.deepEqual(hits('innerflarn internals'), [], 'a term inside a longer word must not match');
  assert.deepEqual(hits('示例组件说明'), ['示例组件'], 'Chinese term must match as a substring');
  assert.deepEqual(hits('示例组'), [], 'a partial Chinese term must not match');
});

test('ubiquitous language: no tracked text file uses an avoided term', () => {
  const terms = avoidedTerms();
  const files = trackedTextFiles();
  assert.ok(files.length > 100, 'the gate must scan the repository, found ' + files.length + ' files');

  const violations = [];
  for (const relPath of files) {
    violations.push(...findViolations(readText(relPath), terms, relPath));
  }

  assert.deepEqual(violations, [], formatViolations(violations) + ' (contract: ubiquitous language)');
});

test('ubiquitous language: the rendered figure copy respects the same vocabulary', () => {
  const terms = avoidedTerms();

  for (const locale of ['en', 'zh']) {
    const html = buildHtml(locale, VIEWPORT);
    const violations = findViolations(html, terms, locale + ' figure');
    assert.deepEqual(violations, [], formatViolations(violations) + ' (contract: ubiquitous language)');
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
