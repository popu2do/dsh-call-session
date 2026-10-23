import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

/**
 * dsh reads a plugin's dsh requirement from `engines.dsh` and, only when that
 * field is absent, from its `@deepseek-ai/dsh*` peer ranges. A nested
 * `dsh.engines` block is read by nothing: not the loader, the installer, or
 * the market.
 */
function unmetRequirements(fields, runtimeVersion) {
  const engines = Object.hasOwn(fields, 'engines') ? fields.engines : {};
  if (Object.hasOwn(engines, 'dsh')) {
    return satisfiesRange(runtimeVersion, engines.dsh) ? {} : { 'engines.dsh': engines.dsh };
  }
  if (!Object.hasOwn(fields, 'peerDependencies')) return {};
  const unmet = {};
  for (const [name, range] of Object.entries(fields.peerDependencies)) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue;
    if (!satisfiesRange(runtimeVersion, range)) unmet[name] = range;
  }
  return unmet;
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim());
  if (!match) throw new Error('unsupported version: ' + text);
  return { numbers: [+match[1], +match[2], +match[3]], prerelease: match[4] ? match[4].split('.') : [] };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const numeric = /^\d+$/.test(a) && /^\d+$/.test(b);
    if (numeric) return Number(a) < Number(b) ? -1 : 1;
    if (/^\d+$/.test(a) !== /^\d+$/.test(b)) return /^\d+$/.test(a) ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function satisfiesRange(runtimeVersion, range) {
  return range.trim().split(/\s+/).every((comparator) => {
    if (comparator.startsWith('>=')) return compareVersions(runtimeVersion, comparator.slice(2)) >= 0;
    if (comparator.startsWith('<')) return compareVersions(runtimeVersion, comparator.slice(1)) < 0;
    throw new Error('unsupported range: ' + range);
  });
}

test('清单声明顶层 engines.dsh', () => {
  assert.equal(typeof manifest.engines?.dsh, 'string', 'engines.dsh 必须与 engines.node 同级声明');
  assert.equal(manifest.dsh?.engines, undefined, 'dsh.engines 是无效字段，任何读取方都不会读取');
});

test('engines.dsh 覆盖 README 声明的受支持区间', () => {
  assert.equal(manifest.engines.dsh, '>=0.2.0-rc.2 <0.3.0-0');
});

test('兼容判定：0.2.x 全部通过，0.1.x 与 0.3.0 起被拒', () => {
  for (const runtime of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.2']) {
    assert.deepEqual(unmetRequirements(manifest, runtime), {}, runtime + ' 应判定兼容');
  }
  for (const runtime of ['0.1.5-rc.2', '0.3.0-rc.1', '0.3.0']) {
    assert.deepEqual(unmetRequirements(manifest, runtime), { 'engines.dsh': '>=0.2.0-rc.2 <0.3.0-0' }, runtime + ' 应被拒');
  }
});

test('声明 engines.dsh 后不再回落到 peerDependencies 判定', () => {
  const withPeers = {
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh-session': '^9.0.0' }
  };
  assert.deepEqual(unmetRequirements(withPeers, '0.2.1-rc.2'), {}, 'engines.dsh 独占判定');
});
