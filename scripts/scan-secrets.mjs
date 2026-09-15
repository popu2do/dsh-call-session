#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// High-confidence rules match a credential's issuer-specific shape and are never
// waived by placeholder heuristics. Heuristic rules match an assignment of an
// opaque literal to a credential-shaped name and tolerate obvious placeholders.
const RULES = [
  { id: 'private-key', label: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, strict: true },
  { id: 'aws-access-key', label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/g, strict: true },
  { id: 'github-token', label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, strict: true },
  { id: 'npm-token', label: 'npm access token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, strict: true },
  { id: 'slack-token', label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, strict: true },
  { id: 'google-api-key', label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35,}/g, strict: true },
  { id: 'llm-api-key', label: 'LLM provider API key', pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/g, strict: true },
  { id: 'jwt', label: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, strict: true },
  {
    id: 'assigned-credential',
    label: 'Hardcoded credential assignment',
    pattern: /(?:api[_-]?key|apikey|secret|token|password|passwd|credential)["'\s]*[:=]\s*["'`]([^"'`\n]{12,})["'`]/gi,
    strict: false,
  },
];

const PLACEHOLDER = /example|placeholder|your[_-]?|dummy|fake|sample|redacted|changeme|^\s*$|\*{4}|x{6}|\.\.\.|^<.+>$|^\$\{|^process\.env\.|^import\.meta\.env\./i;
const ALLOW_MARKER = 'secret-scan:allow';
const MAX_BYTES = 1024 * 1024;

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'ENOENT' || (typeof err.message === 'string' && err.message.includes('spawnSync git')))) {
      return null;
    }
    throw err;
  }
}

function walkFiles(dir = '.', baseDir = dir) {
  const IGNORED = new Set(['.git', 'node_modules', '.agent-teams', 'dist', '.temp']);
  let result = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name)) {
          result = result.concat(walkFiles(path.join(dir, entry.name), baseDir));
        }
      } else if (entry.isFile()) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        result.push(rel);
      }
    }
  } catch {
    // ignore
  }
  return result;
}

function stagedPaths() {
  const out = git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']);
  if (out === null) {
    return walkFiles('.');
  }
  return out.split('\0').filter(Boolean);
}

function trackedPaths() {
  const out = git(['ls-files', '-z']);
  if (out === null) {
    return walkFiles('.');
  }
  return out.split('\0').filter(Boolean);
}

function readStaged(filePath) {
  try {
    const out = git(['show', `:${filePath}`]);
    if (out !== null) return Buffer.isBuffer(out) ? out : Buffer.from(out);
  } catch {
    // fallback to filesystem
  }
  if (fs.existsSync(filePath)) {
    try {
      return fs.readFileSync(filePath);
    } catch {
      return null;
    }
  }
  return null;
}

function mask(value) {
  const text = String(value);
  if (text.length <= 12) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-2)} (${text.length} chars)`;
}

function scan(path, buffer) {
  if (!buffer || buffer.length > MAX_BYTES) return [];
  if (buffer.includes(0)) return [];

  const findings = [];
  const lines = buffer.toString('utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const captured = match[1] ?? match[0];
        if (!rule.strict && PLACEHOLDER.test(captured)) continue;
        findings.push({ path, line: index + 1, rule, sample: mask(captured) });
      }
    }
  });

  return findings;
}

const args = process.argv.slice(2);
const useStaged = args.includes('--staged');
const useAll = args.includes('--all');

let targets;
if (useStaged) targets = stagedPaths();
else if (useAll) targets = trackedPaths();
else targets = args.filter(a => !a.startsWith('--'));

const findings = targets.flatMap(path => {
  const buffer = useStaged ? readStaged(path) : (fs.existsSync(path) ? fs.readFileSync(path) : null);
  return scan(path, buffer);
});

if (findings.length === 0) {
  console.log(`secret-scan: clean (${targets.length} file${targets.length === 1 ? '' : 's'})`);
  process.exit(0);
}

console.error(`secret-scan: ${findings.length} potential credential${findings.length === 1 ? '' : 's'} found\n`);
for (const { path, line, rule, sample } of findings) {
  console.error(`  ${path}:${line}  [${rule.id}] ${rule.label}`);
  console.error(`    ${sample}`);
}
console.error(`
Remove the credential and load it from the environment instead.
A genuine false positive can be waived with a trailing "${ALLOW_MARKER}" comment on that line.`);
process.exit(1);
