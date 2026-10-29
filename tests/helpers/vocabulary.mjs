/**
 * Vocabulary contract matchers shared by the repository gates.
 *
 * CONTEXT.md owns the single _Avoid_ list; this module only turns those terms
 * into matchers. It carries no term literals of its own, so the scan driven by
 * these helpers covers the gate as well.
 */

const LATIN_ONLY = /^[\x20-\x7E]+$/;

/** Files that define or historically record the vocabulary instead of using it. */
export const VOCABULARY_EXEMPT = new Set(['CONTEXT.md', 'CHANGELOG.md']);

const TEXT_EXTENSIONS = [
  '.md', '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx',
  '.json', '.yml', '.yaml', '.html', '.css', '.txt'
];

export function isScannedPath(relPath) {
  return TEXT_EXTENSIONS.some((ext) => relPath.endsWith(ext));
}

/** Every term CONTEXT.md tells authors not to use. */
export function parseAvoidTerms(contextText) {
  const terms = [];
  for (const line of contextText.split(/\r?\n/)) {
    const match = line.match(/^_Avoid_:\s*(.+)$/);
    if (!match) continue;
    for (const raw of match[1].split(',')) {
      const term = raw.trim();
      if (term) terms.push(term);
    }
  }
  return terms;
}

/**
 * Chinese terms match as substrings. Latin terms match whole words, so a longer
 * compound that merely ends with a term stays legal, and plurals of the term are
 * caught as well.
 */
export function termPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!LATIN_ONLY.test(term)) return new RegExp(escaped, 'gu');
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'giu');
}

/** Terms found in one document, reported per line so the gate names a location. */
export function findViolations(text, terms, label) {
  const lines = text.split(/\r?\n/);
  const violations = [];
  for (const term of terms) {
    const pattern = termPattern(term);
    for (let index = 0; index < lines.length; index++) {
      pattern.lastIndex = 0;
      if (!pattern.test(lines[index])) continue;
      violations.push({ label, line: index + 1, term, excerpt: lines[index].trim().slice(0, 120) });
    }
  }
  return violations;
}

export function formatViolations(violations) {
  const shown = violations.slice(0, 25).map(
    (v) => `${v.label}:${v.line} uses "${v.term}" -> ${v.excerpt}`
  );
  const extra = violations.length > shown.length ? `, and ${violations.length - shown.length} more` : '';
  return `${violations.length} avoided vocabulary hit(s): ${shown.join(' | ')}${extra}`;
}
