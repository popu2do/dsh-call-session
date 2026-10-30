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

const startMarker = '// @generated-region-start';
const endMarker = '// @generated-region-end';

const isCheck = process.argv.includes('--check');

function extractGeneratedRegion(content, filePath) {
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1) {
    throw new Error(`Start marker "${startMarker}" not found in ${filePath}`);
  }
  if (endIndex === -1) {
    throw new Error(`End marker "${endMarker}" not found in ${filePath}`);
  }
  if (startIndex >= endIndex) {
    throw new Error(`Invalid markers order in ${filePath}`);
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
      console.error('Run "npm run build:canvas-geometry" to sync lib/client.js with lib/canvas-geometry.mjs.');
      process.exit(1);
    }
    console.log('✓ Canvas geometry embed check passed (no drift detected)');
    process.exit(0);
  } else {
    if (targetContent === expectedTargetContent) {
      console.log('lib/client.js already up-to-date with lib/canvas-geometry.mjs');
      process.exit(0);
    }
    fs.writeFileSync(targetPath, expectedTargetContent, 'utf8');
    console.log('Successfully embedded canvas-geometry into lib/client.js');
    process.exit(0);
  }
}

try {
  run();
} catch (err) {
  console.error('Embed script error:', err.message);
  process.exit(1);
}
