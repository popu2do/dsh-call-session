#!/usr/bin/env node
/**
 * scripts/embed-canvas-geometry.mjs
 * Deterministically embeds the generated region from lib/canvas-geometry.mjs into lib/client.js
 * Supports:
 *   node scripts/embed-canvas-geometry.mjs           (performs embedding)
 *   node scripts/embed-canvas-geometry.mjs --check   (verifies no drift, exit code 1 if drifted)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourcePath = path.join(projectRoot, 'lib/canvas-geometry.mjs');
const targetPath = path.join(projectRoot, 'lib/client.js');

const startMarker = '// <BEGIN> lib/canvas-geometry.mjs 生成区，禁止手改';
const endMarker = '// <END>';

const isCheck = process.argv.includes('--check');

function computeUnifiedDiff(actual, expected, fromFile, toFile) {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const diffHunks = [];
  diffHunks.push('--- ' + fromFile);
  diffHunks.push('+++ ' + toFile);

  let i = 0;
  let j = 0;
  while (i < actualLines.length || j < expectedLines.length) {
    if (i < actualLines.length && j < expectedLines.length && actualLines[i] === expectedLines[j]) {
      i++;
      j++;
    } else {
      const startI = Math.max(0, i - 2);
      const startJ = Math.max(0, j - 2);
      let diffActual = [];
      let diffExpected = [];
      while ((i < actualLines.length || j < expectedLines.length) && (diffActual.length < 20 || diffExpected.length < 20)) {
        if (i < actualLines.length && j < expectedLines.length && actualLines[i] === expectedLines[j]) {
          break;
        }
        if (i < actualLines.length) {
          diffActual.push(actualLines[i]);
          i++;
        }
        if (j < expectedLines.length) {
          diffExpected.push(expectedLines[j]);
          j++;
        }
      }
      diffHunks.push('@@ -' + (startI + 1) + ',' + diffActual.length + ' +' + (startJ + 1) + ',' + diffExpected.length + ' @@');
      for (const line of diffActual) diffHunks.push('-' + line);
      for (const line of diffExpected) diffHunks.push('+' + line);
      break;
    }
  }
  return diffHunks.join('\n');
}

function countOccurrences(content, substring) {
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

function extractGeneratedRegion(content, filePath) {
  const startCount = countOccurrences(content, startMarker);
  const endCount = countOccurrences(content, endMarker);

  if (startCount === 0) {
    throw new Error(`Start marker "${startMarker}" not found in ${filePath}`);
  }
  if (startCount > 1) {
    throw new Error(`Duplicate start marker "${startMarker}" (${startCount} occurrences) in ${filePath}`);
  }
  if (endCount === 0) {
    throw new Error(`End marker "${endMarker}" not found in ${filePath}`);
  }
  if (endCount > 1) {
    throw new Error(`Duplicate end marker "${endMarker}" (${endCount} occurrences) in ${filePath}`);
  }

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex >= endIndex) {
    throw new Error(`Invalid markers order in ${filePath}: start marker at ${startIndex} is after end marker at ${endIndex}`);
  }

  // Extract from startMarker line to endMarker line inclusive
  const region = content.slice(startIndex, endIndex + endMarker.length);
  return {
    prefix: content.slice(0, startIndex),
    region: region,
    suffix: content.slice(endIndex + endMarker.length)
  };
}

function run() {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Source file not found: ${sourcePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(targetPath)) {
    console.error(`Target file not found: ${targetPath}`);
    process.exit(1);
  }

  const sourceContent = fs.readFileSync(sourcePath, 'utf8');
  const targetContent = fs.readFileSync(targetPath, 'utf8');

  const sourceParts = extractGeneratedRegion(sourceContent, sourcePath);
  const targetParts = extractGeneratedRegion(targetContent, targetPath);

  const expectedTargetContent = targetParts.prefix + sourceParts.region + targetParts.suffix;

  if (isCheck) {
    if (targetParts.region !== sourceParts.region) {
      console.error('ERROR: Canvas geometry drift detected between lib/canvas-geometry.mjs and lib/client.js!');
      console.error('Unified diff:');
      console.error(computeUnifiedDiff(targetParts.region, sourceParts.region, 'lib/client.js', 'lib/canvas-geometry.mjs'));
      console.error('\nRun "npm run build:canvas-geometry" to sync lib/client.js with lib/canvas-geometry.mjs.');
      process.exit(1);
    }
    console.log('✓ Canvas geometry embed check passed (no drift detected)');
    process.exit(0);
  } else {
    if (targetContent === expectedTargetContent) {
      console.log('lib/client.js already up-to-date with lib/canvas-geometry.mjs');
      process.exit(0);
    }
    const tempPath = targetPath + '.tmp';
    fs.writeFileSync(tempPath, expectedTargetContent, 'utf8');
    fs.renameSync(tempPath, targetPath);
    console.log('Successfully embedded canvas-geometry into lib/client.js (atomic write)');
    process.exit(0);
  }
}

try {
  run();
} catch (err) {
  console.error('Embed script error:', err.message);
  process.exit(1);
}
