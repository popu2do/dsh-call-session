import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const START = '// <BEGIN> lib/locales/table.mjs region, do not edit by hand';
const END = '// </BEGIN> lib/locales/table.mjs region';

function regionOf(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  assert.ok(start >= 0, 'the locale region start marker is present');
  assert.ok(end > start, 'the locale region end marker follows the start marker');
  return text.slice(start, end + END.length);
}

function runEmbed(...args) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(projectRoot, 'scripts/embed-canvas-geometry.mjs'), ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('Canvas locale region: the shipped bundle carries no placeholder tokens', () => {
  const clientText = readFileSync(path.join(projectRoot, 'lib/client.js'), 'utf8');
  // 上一版 __MIRROR__ 只有测试沙箱会替换，真机加载直接 ReferenceError，插件注册失败。
  assert.equal(clientText.includes('__MIRROR__'), false, 'the shipped bundle must not carry placeholder tokens');
  assert.equal(clientText.includes('__localeMirror__'), false, 'the shipped bundle must not carry sandbox-only tokens');
});

test('Canvas locale region: the bundle matches the shared table line for line', () => {
  const source = regionOf(readFileSync(path.join(projectRoot, 'lib/locales/table.mjs'), 'utf8'));
  // 产物里的区域整行缩进两格，取区域时先去掉这两格再比。
  const bundle = regionOf(readFileSync(path.join(projectRoot, 'lib/client.js'), 'utf8'))
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n');
  const expected = source
    .split('\n')
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');
  assert.equal(bundle, expected, 'lib/client.js is a verbatim搬運 of lib/locales/table.mjs');
});

test('Canvas locale region: --check passes on the checked-in bundle', () => {
  const result = runEmbed('--check');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no drift detected/);
});
