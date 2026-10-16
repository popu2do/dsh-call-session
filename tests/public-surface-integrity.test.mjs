/**
 * Public Surface Integrity: presence manifest, asset budgets, sanitization and documentation invariants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'presence.json');

// Published surface: the nine root documents and manifests, every file under docs/ and
// every file under .github/. Source and test fixtures are deliberately out of the scan set.
const ROOT_SURFACE_FILES = [
  'README.md',
  'README_ZH.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'DESIGN.md',
  'SECURITY.md',
  'presence.json',
  'package.json',
];
const SURFACE_DIRS = ['docs', '.github'];

// Disclosure rule classes 1 to 3 apply to the whole published surface.
const UNIX_HOME_PATH = /\/(?:home|Users)\/[A-Za-z0-9._-]+\//;
const WINDOWS_USER_PATH = /[A-Za-z]:[\\/]{1,2}Users[\\/][^\\/\s"']+/i;
// A full four-octet RFC1918 address, so a version string such as "10.0.0" is not a match.
const PRIVATE_HOST = /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|(?<![A-Za-z0-9._-])[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:internal|local)\b/i;

// Disclosure rule classes 1 to 3 cover the published surface; class 4 covers the two
// records where a contributor identity would be written: the catalog records and the registry.
const IDENTITY_SURFACE_FILES = ['presence.json', 'docs/agents/ecosystem-presence.md'];
const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// A mention starts the word and is not a path segment or a package scope, so
// 'actions/checkout@v4' and '@scope/package' are not mentions.
const AT_HANDLE = /(?:^|[^A-Za-z0-9_./@-])@[A-Za-z0-9][A-Za-z0-9_-]{1,38}(?![A-Za-z0-9_/-])/;
const EMOJI = /\p{Extended_Pictographic}/u;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

let manifestCache;

function loadManifest() {
  if (manifestCache === undefined) {
    manifestCache = { value: null, error: 'unreadable' };
    try {
      manifestCache.value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      manifestCache.error = err.message;
    }
  }
  return manifestCache;
}

function requireManifest() {
  const { value, error } = loadManifest();
  assert.ok(
    value !== null,
    'presence.json must exist and parse as JSON at the repository root (contract: public surface manifest); ' + error
  );
  return value;
}

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function collectFiles(dir) {
  const collected = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collected.push(...collectFiles(full));
    else if (entry.isFile()) collected.push(full);
  }
  return collected;
}

function collectSurfaceFiles() {
  const collected = [];
  for (const name of ROOT_SURFACE_FILES) {
    assert.ok(
      fs.existsSync(path.join(rootDir, name)),
      name + ' must exist on the published surface (contract: disclosure sanitization)'
    );
    collected.push(name);
  }
  for (const dir of SURFACE_DIRS) {
    const full = path.join(rootDir, dir);
    assert.ok(
      fs.existsSync(full),
      dir + '/ must exist on the published surface (contract: disclosure sanitization)'
    );
    for (const file of collectFiles(full)) {
      collected.push(path.relative(rootDir, file).split(path.sep).join('/'));
    }
  }
  return collected;
}

function parseHeadings(text) {
  const h2 = [];
  const h3 = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = line.match(/^(#{2,3})\s+(.*?)\s*$/);
    if (!match) continue;
    if (match[1] === '##') h2.push(match[2]);
    else h3.push(match[2]);
  }
  return { h2, h3 };
}

test('presence manifest: positioning, keywords, asset budgets and catalog records are complete', () => {
  const manifest = requireManifest();

  for (const language of ['en', 'zh']) {
    const value = manifest.positioning ? manifest.positioning[language] : undefined;
    assert.ok(
      typeof value === 'string' && value.trim().length > 0,
      'presence.json positioning.' + language + ' must be a non-empty string (contract: manifest completeness)'
    );
  }

  assert.ok(
    typeof manifest.packageDescription === 'string' && manifest.packageDescription.trim().length > 0,
    'presence.json packageDescription must be a non-empty string (contract: manifest completeness)'
  );

  assert.ok(
    Array.isArray(manifest.keywords),
    'presence.json keywords must be an array of discovery terms (contract: manifest completeness)'
  );
  assert.ok(
    manifest.keywords.length >= 8,
    'presence.json keywords must declare at least 8 terms, found ' + manifest.keywords.length + ' (contract: manifest completeness)'
  );
  const seenKeywords = new Set();
  for (const keyword of manifest.keywords) {
    assert.ok(
      typeof keyword === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(keyword),
      'presence.json keyword "' + keyword + '" must be a lowercase hyphenated term (contract: keyword vocabulary)'
    );
    assert.ok(
      !seenKeywords.has(keyword),
      'presence.json keyword "' + keyword + '" must not repeat (contract: keyword vocabulary)'
    );
    seenKeywords.add(keyword);
  }

  assert.ok(
    manifest.assets && typeof manifest.assets === 'object',
    'presence.json assets must declare the tracked asset budgets (contract: asset budget)'
  );
  for (const [name, budget] of Object.entries(manifest.assets)) {
    assert.ok(
      budget && typeof budget.format === 'string' &&
        Number.isInteger(budget.minBytes) && Number.isInteger(budget.maxBytes),
      'presence.json assets["' + name + '"] must declare format, minBytes and maxBytes (contract: asset budget)'
    );
    assert.ok(
      budget.minBytes > 0 && budget.minBytes < budget.maxBytes,
      'presence.json assets["' + name + '"] must satisfy 0 < minBytes < maxBytes (contract: asset budget)'
    );
  }

  assert.ok(
    Array.isArray(manifest.catalogs) && manifest.catalogs.length > 0,
    'presence.json catalogs must record each ecosystem catalog (contract: catalog registry)'
  );
  manifest.catalogs.forEach((catalog, index) => {
    assert.ok(
      catalog && typeof catalog.id === 'string' && catalog.id.length > 0 &&
        typeof catalog.requirement === 'string' && catalog.requirement.length > 0 &&
        typeof catalog.submittedCopy === 'string' &&
        typeof catalog.submissionRef === 'string' &&
        typeof catalog.status === 'string' && catalog.status.length > 0 &&
        typeof catalog.lastVerified === 'string',
      'presence.json catalogs[' + index + '] must declare id, requirement, submittedCopy, submissionRef, status and lastVerified (contract: catalog registry)'
    );
    assert.ok(
      catalog.status !== 'listed' || catalog.submittedCopy.trim().length > 0,
      'presence.json catalogs[' + index + '].submittedCopy must be non-empty while status is "listed" (contract: catalog registry)'
    );
    assert.ok(
      CALENDAR_DATE.test(catalog.lastVerified) && !Number.isNaN(Date.parse(catalog.lastVerified)),
      'presence.json catalogs[' + index + '].lastVerified "' + catalog.lastVerified +
        '" must match YYYY-MM-DD (contract: catalog registry)'
    );
  });
});

test('presence manifest: every declared asset exists, matches its format signature and stays within its byte budget', () => {
  const manifest = requireManifest();
  const entries = Object.entries(manifest.assets || {});
  assert.ok(
    entries.length > 0,
    'presence.json assets must declare at least one tracked asset (contract: asset budget)'
  );

  for (const [name, budget] of entries) {
    const assetPath = path.join(rootDir, name);
    assert.ok(
      fs.existsSync(assetPath),
      name + ' must exist at the repository root (contract: asset budget)'
    );

    const size = fs.statSync(assetPath).size;
    assert.ok(
      size >= budget.minBytes && size <= budget.maxBytes,
      name + ' byte size ' + size + ' must stay within [' + budget.minBytes + ', ' + budget.maxBytes +
        '] (contract: asset byte budget)'
    );

    if (budget.format === 'png') {
      const header = Buffer.alloc(PNG_SIGNATURE.length);
      const fd = fs.openSync(assetPath, 'r');
      try {
        fs.readSync(fd, header, 0, header.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      assert.ok(
        header.equals(PNG_SIGNATURE),
        name + ' must start with the PNG signature (contract: asset format signature)'
      );
    }
  }
});

test('public surface sanitization: the credential scanner reports no findings across tracked files', () => {
  const result = spawnSync(process.execPath, ['scripts/scan-secrets.mjs', '--all'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const output = ((result.stdout || '') + (result.stderr || '')).trim();
  assert.equal(
    result.status,
    0,
    'scripts/scan-secrets.mjs --all must exit 0 for every tracked file (contract: credential sanitization); ' + output
  );
});

test('public surface sanitization: the published surface exposes no developer-local path or private host name', () => {
  const surfaceRules = [
    { label: 'a Unix absolute home path', pattern: UNIX_HOME_PATH },
    { label: 'a Windows user-directory path', pattern: WINDOWS_USER_PATH },
    { label: 'a private host name', pattern: PRIVATE_HOST },
  ];

  for (const relPath of collectSurfaceFiles()) {
    readText(relPath).split(/\r?\n/).forEach((line, index) => {
      for (const rule of surfaceRules) {
        const match = line.match(rule.pattern);
        assert.ok(
          match === null,
          match === null ? '' : relPath + ':' + (index + 1) + ' exposes ' + rule.label + ' "' + match[0] +
            '" (contract: disclosure sanitization)'
        );
      }
    });
  }
});

test('public surface sanitization: the catalog records and the registry expose no personal account identifier', () => {
  const identityRules = [
    { label: 'an e-mail address', pattern: EMAIL_SHAPE },
    { label: 'an at-handle mention', pattern: AT_HANDLE },
  ];

  for (const relPath of IDENTITY_SURFACE_FILES) {
    assert.ok(
      fs.existsSync(path.join(rootDir, relPath)),
      relPath + ' must exist on the published surface (contract: disclosure sanitization)'
    );
    readText(relPath).split(/\r?\n/).forEach((line, index) => {
      for (const rule of identityRules) {
        const match = line.match(rule.pattern);
        assert.ok(
          match === null,
          match === null ? '' : relPath + ':' + (index + 1) + ' exposes ' + rule.label + ' "' + match[0] +
            '" (contract: disclosure sanitization)'
        );
      }
    });
  }
});

test('documentation invariants: bilingual READMEs stay emoji-free with restrained headings and aligned structure', () => {
  const documents = ['README.md', 'README_ZH.md'];
  const h2Counts = new Map();

  for (const relPath of documents) {
    const text = readText(relPath);

    const emoji = text.match(EMOJI);
    assert.ok(
      emoji === null,
      relPath + ' must contain zero emoji (contract: zero emoji invariant)' +
        (emoji === null ? '' : '; found "' + emoji[0] + '"')
    );

    const { h2, h3 } = parseHeadings(text);
    h2Counts.set(relPath, h2.length);

    for (const heading of [...h2, ...h3]) {
      if (!CJK.test(heading)) continue;
      assert.ok(
        [...heading].length <= 4,
        relPath + ' heading "' + heading + '" must not exceed 4 characters (contract: four-character Chinese subheading invariant)'
      );
    }
  }

  assert.equal(
    h2Counts.get('README.md'),
    h2Counts.get('README_ZH.md'),
    'README.md and README_ZH.md must declare the same number of level-2 headings (contract: bilingual structural parity); found ' +
      h2Counts.get('README.md') + ' and ' + h2Counts.get('README_ZH.md')
  );
});

test('positioning copy: each README tagline states the manifest claim for its language', () => {
  const manifest = requireManifest();
  const documents = [
    { language: 'en', relPath: 'README.md' },
    { language: 'zh', relPath: 'README_ZH.md' },
  ];

  for (const { language, relPath } of documents) {
    const positioning = manifest.positioning ? manifest.positioning[language] : undefined;
    assert.ok(
      typeof positioning === 'string' && positioning.trim().length > 0,
      'presence.json positioning.' + language + ' must be a non-empty string (contract: positioning copy)'
    );
    assert.ok(
      readText(relPath).includes(positioning),
      relPath + ' must state presence.json positioning.' + language + ' verbatim (contract: positioning copy)'
    );
  }
});

test('first screen: each README carries its canvas demonstration within demoMaxLine and keeps its anchor section', () => {
  const manifest = requireManifest();
  const firstScreen = manifest.firstScreen || {};
  const documents = [
    { language: 'en', relPath: 'README.md' },
    { language: 'zh', relPath: 'README_ZH.md' },
  ];

  for (const { language, relPath } of documents) {
    const entry = firstScreen[language] || {};
    assert.ok(
      typeof entry.demoRef === 'string' && entry.demoRef.length > 0,
      'presence.json firstScreen.' + language + '.demoRef must name the demonstration asset (contract: first-screen demonstration)'
    );
    assert.ok(
      Number.isInteger(entry.demoMaxLine) && entry.demoMaxLine > 0,
      'presence.json firstScreen.' + language + '.demoMaxLine must be a positive line number (contract: first-screen demonstration)'
    );

    const lines = readText(relPath).split(/\r?\n/);
    const demoLine = lines.findIndex((line) => line.includes(entry.demoRef)) + 1;
    assert.ok(
      demoLine > 0,
      relPath + ' must reference ' + entry.demoRef + ' (contract: first-screen demonstration)'
    );
    assert.ok(
      demoLine <= entry.demoMaxLine,
      relPath + ' must place ' + entry.demoRef + ' at or before line ' + entry.demoMaxLine +
        ', found line ' + demoLine + ' (contract: first-screen demonstration)'
    );
    assert.ok(
      fs.existsSync(path.join(rootDir, entry.demoRef)),
      entry.demoRef + ' referenced by ' + relPath + ' must exist at the repository root (contract: first-screen demonstration)'
    );

    assert.ok(
      typeof entry.anchor === 'string' && entry.anchor.length > 0,
      'presence.json firstScreen.' + language + '.anchor must name the first-screen section heading (contract: first-screen anchor)'
    );
    const anchorLine = lines.findIndex((line) => line.trim() === entry.anchor) + 1;
    assert.ok(
      anchorLine > 0,
      relPath + ' must contain the "' + entry.anchor + '" section (contract: first-screen anchor)'
    );
    assert.ok(
      anchorLine <= entry.demoMaxLine,
      relPath + ' must place the "' + entry.anchor + '" section at or before line ' + entry.demoMaxLine +
        ', found line ' + anchorLine + ' (contract: first-screen anchor)'
    );
  }

  const heroRef = './assets/hero.png';
  assert.ok(
    Object.keys(manifest.assets || {}).includes('assets/hero.png'),
    'presence.json assets must declare ' + heroRef + ' (contract: first-screen hero binding)'
  );
  assert.ok(
    readText('README.md').includes(heroRef),
    'README.md must reference ' + heroRef + ', the bounded hero asset, so no declared budget is unbound (contract: first-screen hero binding)'
  );
});

test('repository metadata intent: the manifest declares the host-side description, topics and social preview', () => {
  const manifest = requireManifest();
  const repository = manifest.repository;

  assert.ok(
    repository && typeof repository === 'object' && !Array.isArray(repository),
    'presence.json repository must declare the host-side metadata intent (contract: repository metadata)'
  );
  assert.equal(
    repository.description,
    manifest.packageDescription,
    'presence.json repository.description must equal packageDescription, the single authored description (contract: repository metadata)'
  );

  assert.ok(
    Array.isArray(repository.topics),
    'presence.json repository.topics must be an array of discovery topics (contract: repository metadata)'
  );
  assert.deepEqual(
    repository.topics,
    manifest.keywords,
    'presence.json repository.topics must equal the authored keywords (contract: repository metadata)'
  );
  const seenTopics = new Set();
  for (const topic of repository.topics) {
    assert.ok(
      typeof topic === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic),
      'presence.json repository topic "' + topic + '" must be a lowercase hyphenated term (contract: repository metadata)'
    );
    assert.ok(
      !seenTopics.has(topic),
      'presence.json repository topic "' + topic + '" must not repeat (contract: repository metadata)'
    );
    seenTopics.add(topic);
  }

  const socialPreview = repository.socialPreview;
  assert.ok(
    socialPreview && typeof socialPreview === 'object' && !Array.isArray(socialPreview),
    'presence.json repository.socialPreview must record the share card status (contract: repository metadata)'
  );
  assert.ok(
    typeof socialPreview.status === 'string' && socialPreview.status.trim().length > 0,
    'presence.json repository.socialPreview.status must be a non-empty string (contract: repository metadata)'
  );
  assert.ok(
    CALENDAR_DATE.test(socialPreview.verifiedOn) && !Number.isNaN(Date.parse(socialPreview.verifiedOn)),
    'presence.json repository.socialPreview.verifiedOn "' + socialPreview.verifiedOn +
      '" must match YYYY-MM-DD (contract: repository metadata)'
  );
});

test('metadata alignment: package.json description and keywords agree with the presence manifest', () => {
  const manifest = requireManifest();
  const pkg = JSON.parse(readText('package.json'));

  assert.equal(
    pkg.description,
    manifest.packageDescription,
    'package.json description must equal presence.json packageDescription (contract: metadata alignment)'
  );

  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
  for (const keyword of manifest.keywords || []) {
    assert.ok(
      keywords.includes(keyword),
      'package.json keywords must include presence.json keyword "' + keyword + '" (contract: metadata alignment)'
    );
  }
});

