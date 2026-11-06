#!/usr/bin/env node
/**
 * scripts/embed-canvas-geometry.mjs
 * 把 lib/client.js 里的两块生成区从源文件落地。
 *
 *   1. 几何区：lib/canvas-geometry.mjs -> lib/client.js，标记为「<BEGIN> 生成区」/「<END>」
 *   2. 本地语区：lib/locales/table.mjs 的呼叫类别段 -> lib/client.js
 *
 * 为什么需要第二块：画布是浏览器里的经典脚本，没有模块解析，共享词条只能以源码搬运的
 * 方式进产物。上一版在产物里留了只有测试沙箱才替换的占位符，真机加载直接
 * ReferenceError，整个插件注册失败。
 *
 *   node scripts/embed-canvas-geometry.mjs          执行搬运
 *   node scripts/embed-canvas-geometry.mjs --check  只做漂移检查（漂移时退出码 1）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const targetPath = path.join(projectRoot, 'lib/client.js');

const regions = [
  {
    name: 'Canvas geometry',
    sourcePath: path.join(projectRoot, 'lib/canvas-geometry.mjs'),
    buildScript: 'npm run build:canvas-geometry',
    startMarker: '// <BEGIN> lib/canvas-geometry.mjs 生成区，禁止手改',
    endMarker: '// <END>',
    stripExport: false,
    indent: ''
  },
  {
    name: 'Canvas locale',
    sourcePath: path.join(projectRoot, 'lib/locales/table.mjs'),
    buildScript: 'npm run build:canvas-locale',
    startMarker: '// <BEGIN> lib/locales/table.mjs region, do not edit by hand',
    // 结束标记用闭合斜杠形态，避免与几何区那行裸 END 混淆。
    endMarker: '// </BEGIN> lib/locales/table.mjs region',
    stripExport: true,
    // 区域嵌在 IIFE 内，整块（含两行标记）统一缩进两格。
    indent: '  '
  }
];

const isCheck = process.argv.includes('--check');

function countOccurrences(content, substring) {
  return content.split(substring).length - 1;
}

function locateRegion(content, spec) {
  const startCount = countOccurrences(content, spec.startMarker);
  if (startCount !== 1) {
    throw new Error(`${spec.name}: start marker "${spec.startMarker}" must appear exactly once (found ${startCount})`);
  }
  const endCount = countOccurrences(content, spec.endMarker);
  if (endCount !== 1) {
    throw new Error(`${spec.name}: end marker "${spec.endMarker}" must appear exactly once (found ${endCount})`);
  }

  const startIndex = content.indexOf(spec.startMarker);
  const endIndex = content.indexOf(spec.endMarker);
  if (startIndex >= endIndex) {
    throw new Error(`${spec.name}: start marker is after end marker`);
  }

  // 区域从标记所在行的行首算起，两边都按整行整块搬运。
  const lineStart = content.lastIndexOf('\n', startIndex) + 1;
  return {
    prefix: content.slice(0, lineStart),
    region: content.slice(lineStart, endIndex + spec.endMarker.length),
    suffix: content.slice(endIndex + spec.endMarker.length)
  };
}

/** 源文件区域的正文行：去标记行、去 export、按产物缩进。 */
function expectedRegionBody(spec) {
  const source = fs.readFileSync(spec.sourcePath, 'utf8');
  const parts = locateRegion(source, spec);
  const body = parts.region.slice(spec.startMarker.length, parts.region.length - spec.endMarker.length);
  const lines = body.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map(line => (spec.stripExport ? line.replace(/^export\s+/, '') : line));
}

function expectedRegion(spec) {
  return [spec.startMarker, ...expectedRegionBody(spec), spec.endMarker]
    .map(line => (line.length === 0 ? line : spec.indent + line))
    .join('\n');
}

function computeUnifiedDiff(actual, expected, fromFile, toFile) {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const hunks = ['--- ' + fromFile, '+++ ' + toFile];
  let i = 0;
  let j = 0;
  while (i < actualLines.length || j < expectedLines.length) {
    if (i < actualLines.length && j < expectedLines.length && actualLines[i] === expectedLines[j]) {
      i++;
      j++;
      continue;
    }
    const startI = i;
    const startJ = j;
    const removed = [];
    const added = [];
    while ((i < actualLines.length || j < expectedLines.length) && removed.length < 20 && added.length < 20) {
      if (i < actualLines.length && j < expectedLines.length && actualLines[i] === expectedLines[j]) break;
      if (i < actualLines.length) removed.push(actualLines[i++]);
      if (j < expectedLines.length) added.push(expectedLines[j++]);
    }
    hunks.push(`@@ -${startI + 1},${removed.length} +${startJ + 1},${added.length} @@`);
    for (const line of removed) hunks.push('-' + line);
    for (const line of added) hunks.push('+' + line);
  }
  return hunks.join('\n');
}

function run() {
  for (const spec of regions) {
    if (!fs.existsSync(spec.sourcePath)) {
      console.error(`Source file not found: ${spec.sourcePath}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(targetPath)) {
    console.error(`Target file not found: ${targetPath}`);
    process.exit(1);
  }

  const original = fs.readFileSync(targetPath, 'utf8');
  let expectedTargetContent = original;
  const drifted = [];

  for (const spec of regions) {
    const parts = locateRegion(expectedTargetContent, spec);
    const expected = expectedRegion(spec);
    if (parts.region !== expected) {
      drifted.push({ spec, actual: parts.region, expected });
      expectedTargetContent = parts.prefix + expected + parts.suffix;
    }
  }

  if (isCheck) {
    if (drifted.length === 0) {
      console.log('✓ Canvas embed check passed (geometry and locale, no drift detected)');
      process.exit(0);
    }
    for (const { spec, actual, expected } of drifted) {
      console.error(`ERROR: ${spec.name} drift detected between ${path.relative(projectRoot, spec.sourcePath)} and lib/client.js!`);
      console.error('Unified diff:');
      console.error(computeUnifiedDiff(actual, expected, 'lib/client.js', path.relative(projectRoot, spec.sourcePath)));
      console.error(`\nRun "${spec.buildScript}" to sync lib/client.js with ${path.relative(projectRoot, spec.sourcePath)}.\n`);
    }
    process.exit(1);
  }

  if (expectedTargetContent === original) {
    console.log('lib/client.js already up-to-date with generated regions');
    process.exit(0);
  }
  const tempPath = targetPath + '.tmp';
  fs.writeFileSync(tempPath, expectedTargetContent, 'utf8');
  fs.renameSync(tempPath, targetPath);
  console.log(`Successfully embedded ${drifted.map(d => d.spec.name).join(' and ')} into lib/client.js (atomic write)`);
  process.exit(0);
}

try {
  run();
} catch (err) {
  console.error('Embed script error:', err.message);
  process.exit(1);
}
