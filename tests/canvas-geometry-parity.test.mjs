/**
 * tests/canvas-geometry-parity.test.mjs
 * Parity verification between lib/canvas-geometry.mjs and lib/client.js exports/behaviors.
 * Verifies:
 *   1. Golden snapshot replay on both lib/canvas-geometry.mjs and lib/client.js
 *   2. Identity equality of shared functions between modules
 *   3. No drift between embedded region and standalone single source module
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as geom from '../lib/canvas-geometry.mjs';
import { loadClientBundle } from './helpers/canvas-harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fixturePath = path.join(rootDir, 'tests/fixtures/canvas-layout-baseline.json');
const goldenFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('Parity: Golden snapshot replay yields 100% identical results on both geom and client plugin', () => {
  const plugin = loadClientBundle();

  // Test all layoutCases
  for (const c of goldenFixture.layoutCases) {
    const geomResult = geom.computeLayout(...c.args);
    const clientResult = plugin.computeLayout(...c.args);

    assert.deepEqual(
      JSON.parse(JSON.stringify(geomResult)),
      c.expected,
      `geom mismatch for layout case: ${c.name}`
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(clientResult)),
      c.expected,
      `client mismatch for layout case: ${c.name}`
    );
  }

  // Test all framingCases
  for (const c of goldenFixture.framingCases) {
    const geomResult = geom.computeViewportFraming(c.options);
    const clientResult = plugin.computeViewportFraming(c.options);

    assert.deepEqual(
      JSON.parse(JSON.stringify(geomResult)),
      c.expected,
      `geom mismatch for framing case: ${c.name}`
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(clientResult)),
      c.expected,
      `client mismatch for framing case: ${c.name}`
    );
  }
});

test('Parity: Mathematical primitives and curve paths are identical', () => {
  const plugin = loadClientBundle();

  // 1. Session matching
  const matchingCases = [
    ['session-abc12345', 'session-abc12345'],
    ['session-abc12345', 'abc12345'],
    ['abc12345-extra', 'abc12345-other', 'abc12345'],
    ['session-abc12345', 'session-def67890']
  ];
  for (const mc of matchingCases) {
    assert.equal(geom.isMatchingSession(...mc), plugin.isMatchingSession(...mc));
  }

  // 2. Truncate text
  const textCases = [
    { text: '深度协同', maxW: 80 },
    { text: '深度思考智能体全流程协同', maxW: 80 },
    { text: 'SessionCallDispatcherEngine', maxW: 80 },
    { text: 'DSH协同画布Canvas拓扑分析', maxW: 80 },
    { text: '', maxW: 80 }
  ];
  for (const tc of textCases) {
    assert.equal(
      geom.truncateTextByWidth(tc.text, tc.maxW),
      plugin.truncateTextByWidth(tc.text, tc.maxW)
    );
  }

  // 3. Bezier path calculations
  const bezierCases = [
    [100, 100, 100, 100, 0],   // self loop
    [100, 100, 100, 250, 0],   // intra-column down
    [100, 250, 100, 100, 1],   // intra-column up
    [100, 100, 400, 100, 0],   // forward cross
    [400, 200, 100, 200, 0]    // reverse cross
  ];
  for (const bc of bezierCases) {
    assert.equal(
      geom.calculateBezierPath(...bc),
      plugin.calculateBezierPath(...bc)
    );
  }

  // 4. Rounded rect intersection
  const intersectCases = [
    [100, 100, 250, 100, 96, 26, 8],
    [100, 100, 100, 250, 96, 26, 8],
    [100, 100, 200, 200, 96, 26, 8]
  ];
  for (const ic of intersectCases) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(geom.getRoundedRectIntersection(...ic))),
      JSON.parse(JSON.stringify(plugin.getRoundedRectIntersection(...ic)))
    );
  }

  // 5. Post edge calculations
  const sourceNode = { x: 170, y: 226 };
  const targetPost = { x: 56, y: 52 };
  assert.deepEqual(
    JSON.parse(JSON.stringify(geom.computePostEdgeCoordinates(sourceNode, targetPost, 0))),
    JSON.parse(JSON.stringify(plugin.computePostEdgeCoordinates(sourceNode, targetPost, 0)))
  );
  assert.equal(
    geom.calculateAuthorEdgePath(sourceNode, targetPost, 0),
    plugin.calculateAuthorEdgePath(sourceNode, targetPost, 0)
  );
  assert.equal(
    geom.calculateContextEdgePath(sourceNode, targetPost, 0),
    plugin.calculateContextEdgePath(sourceNode, targetPost, 0)
  );
});

test('Parity: Byte-level generated region identity between canvas-geometry and client.js', () => {
  const geomSource = fs.readFileSync(path.join(rootDir, 'lib/canvas-geometry.mjs'), 'utf8');
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib/client.js'), 'utf8');

  const startMarker = '// <BEGIN> lib/canvas-geometry.mjs 生成区，禁止手改';
  const endMarker = '// <END>';

  const geomStart = geomSource.indexOf(startMarker);
  const geomEnd = geomSource.indexOf(endMarker, geomStart);
  const geomRegion = geomSource.slice(geomStart, geomEnd + endMarker.length);

  const clientStart = clientSource.indexOf(startMarker);
  const clientEnd = clientSource.indexOf(endMarker, clientStart);
  const clientRegion = clientSource.slice(clientStart, clientEnd + endMarker.length);

  assert.equal(geomRegion, clientRegion, 'Generated region must be byte-for-byte identical');
});
