import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

/**
 * ADR-0041 4.2: the @ candidate filter depends on two host facts. A host upgrade
 * that changes either one silently returns the menu to its unfiltered behavior,
 * so both are pinned here and re-checked whenever the host install is reachable.
 */
const requireFn = createRequire(import.meta.url);

function resolveHostPackageDir(packageName) {
  const candidates = [];
  const explicitRoot = process.env.DSH_HOST_ROOT;
  if (explicitRoot) {
    candidates.push(path.join(explicitRoot, 'node_modules', '@deepseek-ai', packageName));
    candidates.push(path.join(explicitRoot, '@deepseek-ai', packageName));
  }
  try {
    candidates.push(path.dirname(requireFn.resolve(`@deepseek-ai/dsh/node_modules/@deepseek-ai/${packageName}/package.json`)));
  } catch {
    // Host install not listed as a dependency; fall back to the global layout below.
  }
  const globalRoots = [
    path.join(os.homedir(), '.local', 'lib', 'node_modules'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules'
  ];
  for (const globalRoot of globalRoots) {
    candidates.push(path.join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', packageName));
  }
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function readHostFile(packageName, relativePath) {
  const dir = resolveHostPackageDir(packageName);
  if (!dir) return null;
  const file = path.join(dir, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

test('Peer Session Reference: Host @ source identity stays trigger @ with name reference', (t) => {
  const source = readHostFile('dsh-client-ui-reference', 'lib/client.js');
  if (source === null) {
    t.skip('DSH host install not reachable; run with DSH_HOST_ROOT to pin the contract');
    return;
  }
  const sourceBlock = /trigger:\s*"@",\s*name:\s*"reference"/u.test(source);
  assert.ok(sourceBlock, 'Host @ source must stay identified by trigger "@" and name "reference"');
});

test('Peer Session Reference: Host session mention scheme stays dsh-session', (t) => {
  const index = readHostFile('dsh-session-reference', 'lib/index.js');
  if (index === null) {
    t.skip('DSH host install not reachable; run with DSH_HOST_ROOT to pin the contract');
    return;
  }
  assert.match(index, /SESSION_REFERENCE_SCHEME\s*=\s*"dsh-session:"/u, 'Host session mention scheme must stay dsh-session');
});
