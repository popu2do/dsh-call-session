/**
 * tests/canvas-geometry-core.test.mjs
 * Comprehensive unit test suite for lib/canvas-geometry.mjs headless functions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as geom from '../lib/canvas-geometry.mjs';

test('canvas-geometry constants and configuration freeze', () => {
  assert.ok(geom.GUTTER_CONFIG);
  assert.ok(Object.isFrozen(geom.GUTTER_CONFIG));
  assert.equal(geom.GUTTER_CONFIG.NODE_RX, 96);
  assert.equal(geom.GUTTER_CONFIG.NODE_RY, 26);
  assert.equal(geom.GUTTER_CONFIG.NODE_RADIUS, 8);

  assert.ok(geom.VIEWPORT_FRAMING);
  assert.ok(Object.isFrozen(geom.VIEWPORT_FRAMING));
  assert.equal(geom.VIEWPORT_FRAMING.PADDING, 48);
  assert.equal(geom.VIEWPORT_FRAMING.MACRO_MIN_ZOOM, 0.30);
  assert.equal(geom.VIEWPORT_FRAMING.MACRO_MAX_ZOOM, 1.20);
  assert.equal(geom.VIEWPORT_FRAMING.LOCATE_MIN_ZOOM, 0.8);
  assert.equal(geom.VIEWPORT_FRAMING.LOCATE_MAX_ZOOM, 1.2);

  assert.ok(geom.CANVAS_FALLBACK_BOUNDS);
  assert.ok(Object.isFrozen(geom.CANVAS_FALLBACK_BOUNDS));
  assert.equal(geom.CANVAS_FALLBACK_BOUNDS.minX, 40);
  assert.equal(geom.CANVAS_FALLBACK_BOUNDS.minY, 24);

  assert.equal(geom.SESSION_NODE_HALF_WIDTH, 96);
  assert.equal(geom.SESSION_NODE_HALF_HEIGHT, 26);
  assert.equal(geom.SESSION_NODE_CORNER_RADIUS, 8);

  assert.ok(geom.LAYOUT_METRICS);
  assert.ok(Object.isFrozen(geom.LAYOUT_METRICS));
  assert.equal(geom.LAYOUT_METRICS.START_X, 40);
  assert.equal(geom.LAYOUT_METRICS.START_Y, 150);

  assert.ok(geom.VIEWPORT_LIMITS);
  assert.ok(Object.isFrozen(geom.VIEWPORT_LIMITS));
  assert.equal(geom.VIEWPORT_LIMITS.MIN_ZOOM, 0.25);
  assert.equal(geom.VIEWPORT_LIMITS.MAX_ZOOM, 2.5);
  assert.equal(geom.VIEWPORT_LIMITS.WHEEL_STEP, 1.1);
});

test('computeSessionShortId: normalization and prefix stripping', () => {
  assert.equal(geom.computeSessionShortId('session-da929b7d-7912-4e03-a95a-8e76231ed1b7'), 'da929b7d');
  assert.equal(geom.computeSessionShortId('SESSION-A1B2C3D4-5678-90AB'), 'a1b2c3d4');
  assert.equal(geom.computeSessionShortId('session-xyz'), 'xyz');
  assert.equal(geom.computeSessionShortId(''), 'unknown');
  assert.equal(geom.computeSessionShortId(null), 'unknown');
  assert.equal(geom.computeSessionShortId(undefined), 'unknown');
});

test('isMatchingSession: exact match, prefix stripping, and shortId comparison', () => {
  assert.equal(geom.isMatchingSession('session-abc12345', 'session-abc12345'), true);
  assert.equal(geom.isMatchingSession('session-abc12345', 'abc12345'), true);
  assert.equal(geom.isMatchingSession('abc12345-extra', 'abc12345-other', 'abc12345'), true);
  assert.equal(geom.isMatchingSession('session-abc12345', 'session-def67890'), false);
  assert.equal(geom.isMatchingSession(null, 'abc'), false);
  assert.equal(geom.isMatchingSession('abc', null), false);
});

test('measureTextWidth and truncateTextByWidth: rendered pixel width rules', () => {
  // ASCII char = 7.2, Wide char = 12.5
  assert.equal(geom.measureTextWidth('ABC'), 3 * 7.2);
  assert.equal(geom.measureTextWidth('中文'), 2 * 12.5);
  assert.equal(geom.measureTextWidth(''), 0);

  // Truncation
  assert.equal(geom.truncateTextByWidth('深度协同', 80), '深度协同');
  assert.equal(geom.truncateTextByWidth('深度思考智能体全流程协同', 80), '深度思考智...');
  assert.equal(geom.truncateTextByWidth('Session', 80), 'Session');
  assert.equal(geom.truncateTextByWidth('SessionCallDispatcherEngine', 80), 'SessionC...');
  assert.equal(geom.truncateTextByWidth('abc', 0), '...');
});

test('getEllipseIntersection and getRoundedRectIntersection: boundary tangency', () => {
  const center = { x: 100, y: 100 };
  // Right target
  const ellRight = geom.getEllipseIntersection(center.x, center.y, 250, 100, 96, 26);
  assert.equal(ellRight.x.toFixed(1), '196.0');
  assert.equal(ellRight.y.toFixed(1), '100.0');

  const rectRight = geom.getRoundedRectIntersection(center.x, center.y, 250, 100, 96, 26, 8);
  assert.equal(rectRight.x.toFixed(1), '196.0');
  assert.equal(rectRight.y.toFixed(1), '100.0');

  // Coincident points
  const same = geom.getRoundedRectIntersection(center.x, center.y, center.x, center.y, 96, 26, 8);
  assert.equal(same.x, center.x);
  assert.equal(same.y, center.y);
});

test('calculateBezierPath: self-loop, intra-column bidirectional channels, cross-column corridor', () => {
  // 1. Self loop (dx < 2 && dy < 2)
  const selfLoop = geom.calculateBezierPath(100, 100, 100, 100, 0);
  assert.ok(selfLoop.startsWith('M '));
  assert.ok(selfLoop.includes(' C '));

  // 2. Intra-column downward call (dx < 2, dy > 0): right channel
  const downCall = geom.calculateBezierPath(100, 100, 100, 250, 0);
  assert.ok(downCall.startsWith('M '));

  // 3. Intra-column upward call (dx < 2, dy < 0): left channel
  const upCall = geom.calculateBezierPath(100, 250, 100, 100, 0);
  assert.ok(upCall.startsWith('M '));

  // 4. Forward cross-column call (dx > 0)
  const fwdCall = geom.calculateBezierPath(100, 100, 400, 100, 0);
  assert.ok(fwdCall.startsWith('M '));

  // 5. Reverse cross-column call (|dx| >= 200, dx < 0): top corridor
  const revCross = geom.calculateBezierPath(400, 200, 100, 200, 0);
  assert.ok(revCross.startsWith('M '));
  assert.ok(revCross.includes('130.0')); // Top corridor y
});

test('Blackboard edge calculations: computePostEdgeCoordinates, calculateAuthorEdgePath, calculateContextEdgePath', () => {
  const sourceNode = { x: 170, y: 226 };
  const targetPost = { x: 56, y: 52 };
  const coords = geom.computePostEdgeCoordinates(sourceNode, targetPost, 0);
  assert.equal(coords.startX, sourceNode.x + 96);
  assert.equal(coords.startY, sourceNode.y);
  assert.equal(coords.gutterX, sourceNode.x + 130);
  assert.equal(coords.targetX, targetPost.x + 90);
  assert.equal(coords.targetY, targetPost.y + 48);

  const authorPath = geom.calculateAuthorEdgePath(sourceNode, targetPost, 0);
  assert.ok(authorPath.startsWith('M '));
  assert.ok(authorPath.includes(' C '));

  const contextPath = geom.calculateContextEdgePath(sourceNode, targetPost, 0);
  assert.ok(contextPath.startsWith('M '));
  assert.ok(contextPath.includes(' C '));
});

test('Viewport transformations: worldToScreen, screenToWorld, clampZoom, computeZoomAtPoint, computeDragPan, viewportTransformStyle', () => {
  const vp = { panX: 100, panY: 50, zoom: 1.5 };
  const worldPt = { x: 200, y: 100 };
  const screenPt = geom.worldToScreen(worldPt, vp);
  assert.equal(screenPt.x, 100 + 200 * 1.5);
  assert.equal(screenPt.y, 50 + 100 * 1.5);

  const backWorld = geom.screenToWorld(screenPt, vp);
  assert.equal(backWorld.x, worldPt.x);
  assert.equal(backWorld.y, worldPt.y);

  // Clamping
  assert.equal(geom.clampZoom(0.1), 0.25);
  assert.equal(geom.clampZoom(3.0), 2.5);
  assert.equal(geom.clampZoom(1.2), 1.2);

  // computeZoomAtPoint: stationary point under cursor
  const cursor = { x: 300, y: 200 };
  const factor = 1.1;
  const zoomRes = geom.computeZoomAtPoint(vp, cursor, factor);
  assert.equal(zoomRes.zoom, 1.5 * 1.1);
  // Verify point under cursor remains stationary
  const beforeWorld = geom.screenToWorld(cursor, vp);
  const afterWorld = geom.screenToWorld(cursor, { panX: zoomRes.panX, panY: zoomRes.panY, zoom: zoomRes.zoom });
  assert.ok(Math.abs(beforeWorld.x - afterWorld.x) < 0.0001);
  assert.ok(Math.abs(beforeWorld.y - afterWorld.y) < 0.0001);

  // computeDragPan
  const origin = { x: 100, y: 100, panX: 20, panY: 30 };
  const currentCursor = { x: 140, y: 160 };
  const dragRes = geom.computeDragPan(origin, currentCursor);
  assert.equal(dragRes.panX, 20 + 40);
  assert.equal(dragRes.panY, 30 + 60);

  // viewportTransformStyle
  assert.equal(
    geom.viewportTransformStyle({ panX: 120, panY: 80, zoom: 0.75 }),
    'translate3d(120px, 80px, 0px) scale(0.75)'
  );
});

test('computeContentBounds: enclosing rectangle calculation and fallback', () => {
  const emptyBounds = geom.computeContentBounds({});
  assert.deepEqual(emptyBounds, geom.CANVAS_FALLBACK_BOUNDS);

  const calculated = geom.computeContentBounds({
    workspaceBounds: [{ x: 40, y: 150, width: 260, height: 480 }],
    nodePositions: { 's1': { x: 170, y: 226 } },
    blackboardBound: { x: 40, y: 24, width: 1080, height: 96 }
  });
  assert.equal(calculated.minX, 40);
  assert.equal(calculated.minY, 24);
  assert.equal(calculated.maxX, 1120);
  assert.equal(calculated.maxY, 630);
});
