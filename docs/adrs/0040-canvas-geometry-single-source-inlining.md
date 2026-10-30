# ADR-0040: Canvas Geometry Single-Source Headless Extraction and Inlined Deterministic Embedding

- **Status**: Accepted (Supersedes the boundary note in ADR-0027)
- **Date**: 2026-10-30
- **Deciders**: Architect, Engineering Team
- **Consulted**: Frontend Engineers, Headless Testing Leads
- **Informed**: Downstream Subagents, CI/CD Pipeline

---

## 1. Context and Problem Statement

### 1.1 Background & Root Cause
In ADR-0027 (§Option 3 Rejected), canvas geometry extraction was initially rejected because browser bundle delivery lacked a bundler and browser ESM import of local sibling modules was unsupported under the single-file distribution model (`lib/client.js`). Consequently, all canvas geometry algorithms (node coordinate calculation, layout matrix, viewport framing, Bezier paths, boundary clipping, text truncation) were tightly coupled inside `lib/client.js` and trapped inside React closure state.

This coupling caused:
1. Complete inability to unit test layout, framing, and routing geometry in headless Node.js without instantiating mock DOM sandboxes (`tests/helpers/canvas-harness.mjs`).
2. Duplicated geometry arithmetic (drag delta pan, zoom-at-point transform, tooltip projection) spread across React component handlers.
3. Violation of DRY: attempts to isolate layout led to risks of manual mirror copies which ADR-0027 strictly prohibited.

### 1.2 Supersession of ADR-0027 Boundary Note
ADR-0027 stated: "Canvas geometry calculation will not be separated into independent modules". ADR-0040 explicitly supersedes that specific non-separation boundary decision by introducing a deterministic compilation step that satisfies all constraints without introducing runtime dependencies or manual mirror copies.

---

## 2. Decision Drivers

- Driver 1: Single source of truth in `lib/canvas-geometry.mjs` with pure ES5 compatible syntax in generated region.
- Driver 2: Zero runtime overhead and zero bundler dependency: deterministic inlining via `scripts/embed-canvas-geometry.mjs`.
- Driver 3: Byte-level drift gate in CI (`npm run lint` and `npm run check`) using `--check`.
- Driver 4: Public surface stability: plugin object exports (30 keys) and `types/client.d.ts` remain unchanged.
- Driver 5: Replay golden snapshot verification (`tests/fixtures/canvas-layout-baseline.json`) to ensure zero visual regression.

---

## 3. Decision

### 3.1 Single Source Headless Module (`lib/canvas-geometry.mjs`)
Isolate pure mathematical geometry primitives, layout engines, viewport transformations, and projection helpers into `lib/canvas-geometry.mjs`. The file contains:
- Configuration and constants: `GUTTER_CONFIG`, `VIEWPORT_FRAMING`, `CANVAS_FALLBACK_BOUNDS`, `SESSION_NODE_*`, `LAYOUT_METRICS`, `VIEWPORT_LIMITS`.
- Mathematical primitives: `computeSessionShortId`, `isMatchingSession`, `measureTextWidth`, `truncateTextByWidth`, `getEllipseIntersection`, `getRoundedRectIntersection`.
- Curve path generation: `calculateBezierPath`, `computePostEdgeCoordinates`, `calculateAuthorEdgePath`, `calculateContextEdgePath`.
- Layout engines: `computeLayout`, `computeViewportFraming`, `computeContentBounds`.
- Viewport and projection helpers: `worldToScreen`, `screenToWorld`, `clampZoom`, `computeZoomAtPoint`, `computeDragPan`, `viewportTransformStyle`.

The core code resides between `// @generated-region-start` and `// @generated-region-end` in pure ES5 syntax.

### 3.2 Deterministic Build and Drift Verification
Implement `scripts/embed-canvas-geometry.mjs` to copy the exact generated region from `lib/canvas-geometry.mjs` into `lib/client.js`.
- Execution: `npm run build:canvas-geometry` embeds the slice deterministically.
- Verification: `node scripts/embed-canvas-geometry.mjs --check` fails with exit code 1 if any drift occurs.
- Package integration: `npm run lint` and `npm run check` enforce this gate prior to testing.

### 3.3 Component Closure Refactoring
Refactor React component handlers in `lib/client.js` to consume the embedded headless functions:
- Eliminate inner `getContentBounds` closure, delegate to `computeContentBounds`.
- Delegate drag pan arithmetic to `computeDragPan`.
- Delegate wheel zoom transformation to `computeZoomAtPoint`.
- Delegate surface style to `viewportTransformStyle`.
- Delegate session, post, and call edge tooltip coordinates to `worldToScreen`.

---

## 4. Consequences

### 4.1 Positive
- Pure Node.js headless testing is unlocked via `tests/canvas-geometry-core.test.mjs` and `tests/canvas-geometry-parity.test.mjs`.
- Single source of truth eliminates drift risk between headless logic and client execution.
- Golden snapshots guarantee 100% pixel-level parity with historical baselines.
- Zero extra dependencies, zero bundlers, and zero alterations to client bundle distribution contracts.

### 4.2 Trade-offs & Mitigations
- Inlining requires a pre-commit / build step (`npm run build:canvas-geometry`). Mitigated by wiring `--check` into lint gates.
