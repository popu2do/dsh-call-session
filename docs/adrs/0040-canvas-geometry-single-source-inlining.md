<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
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
ADR-0027 stated: "Canvas geometry calculation will not be separated into independent modules". ADR-0040 explicitly supersedes that specific non-separation boundary decision by introducing a single source module (`lib/canvas-geometry.mjs`) combined with a deterministic build-time inlining step and byte-level drift gate. This satisfies all constraints without introducing runtime bundlers or manual mirror copies.

---

## 2. Decision Drivers

- Driver 1: Single source of truth in `lib/canvas-geometry.mjs` with pure ES5 compatible syntax in generated region.
- Driver 2: Zero runtime overhead and zero bundler dependency: deterministic inlining via `scripts/embed-canvas-geometry.mjs`.
- Driver 3: Byte-level drift gate in CI (`npm run lint` and `npm run verify`) using `--check`.
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

The core code resides between markers:
`// <BEGIN> lib/canvas-geometry.mjs 生成区，禁止手改`
and
`// <END>`
in pure ES5 syntax.

### 3.2 Deterministic Build and Drift Verification
Implement `scripts/embed-canvas-geometry.mjs` to copy the exact generated region from `lib/canvas-geometry.mjs` into `lib/client.js`.
- Execution: `npm run build:canvas-geometry` embeds the slice deterministically via atomic file write (`.tmp` file followed by rename).
- Verification: `node scripts/embed-canvas-geometry.mjs --check` outputs unified diff and fails with exit code 1 if any drift occurs.
- Package integration: `npm run lint` and `npm run verify` enforce this gate prior to testing.

### 3.3 Component Closure Refactoring
Refactor React component handlers in `lib/client.js` to consume the embedded headless functions:
- Eliminate inner `getContentBounds` closure, delegate to `computeContentBounds`.
- Delegate drag pan arithmetic to `computeDragPan`.
- Delegate wheel zoom transformation to `computeZoomAtPoint` with `VIEWPORT_LIMITS.WHEEL_STEP`.
- Delegate surface style to `viewportTransformStyle`.
- Delegate session, post, and call edge tooltip coordinates to `worldToScreen`.

---

## 4. Consequences and Cost Analysis

### 4.1 Positive
- Pure Node.js headless testing is unlocked via `tests/canvas-geometry-core.test.mjs` and `tests/canvas-geometry-parity.test.mjs`.
- Single source of truth eliminates drift risk between headless logic and client execution.
- Golden snapshots guarantee 100% pixel-level parity with historical baselines.
- Zero extra dependencies, zero bundlers, and zero alterations to client bundle distribution contracts.

### 4.2 Explicit Costs and Scope Decisions
In accordance with architectural review discipline, this architecture accepts three concrete costs and documents one key scope decision:
1. **Lint comparison overhead**: `npm run lint` adds a mandatory byte-level comparison step between the standalone source and embedded target file, with unified diff generation upon mismatch.
2. **Dual-text, single-editable maintenance discipline**: The repository maintains two physical copies of the geometry text (`lib/canvas-geometry.mjs` and the embedded zone in `lib/client.js`), but only the single-source file is editable. Manual edits to the generated block in `lib/client.js` are strictly prohibited and trapped by CI gates.
3. **Package and client.js line-count increase as accepted architecture cost**: The standalone source file `lib/canvas-geometry.mjs` adds approximately 890 lines of source code, and embedding the full headless pure mathematics engine (comprehensive JSDocs, defensive argument validation, extracted viewport conversions and boundary engines) into `lib/client.js` results in a net line count increase in `lib/client.js` (from baseline 3916 to ~4050 lines). This increase is explicitly accepted as an architecture trade-off for headless testability, single-source truth, and zero runtime bundler dependencies.
4. **Scope decision on workspace node & topology helpers (M1)**: While `createDefaultWorkspaceNode`, `promoteWorkspaceToFirst`, and `extractWorkspaceName` manipulate workspace node structures and list ordering rather than pure pixel trigonometry, they provide the structural foundation consumed directly by `computeLayout`. Consolidating them into the single-source `lib/canvas-geometry.mjs` engine ensures that `computeLayout` can be executed autonomously in headless test environments without relying on ambient browser closures or duplicate implementations outside the generated region in `lib/client.js`.

### 4.3 Rollback Path
If this deterministic inlining architecture ever needs to be decommissioned:
1. Delete `lib/canvas-geometry.mjs`, `scripts/embed-canvas-geometry.mjs`, and `build:canvas-geometry` script in `package.json`.
2. Remove `node scripts/embed-canvas-geometry.mjs --check` from the `lint` command in `package.json`.
3. In `lib/client.js`, simply strip the `// <BEGIN> ...` and `// <END>` markers and retain the inlined functions as regular handwritten source code.
4. Because the public interface (`types/client.d.ts`, plugin dictionary keys, runtime behavior) remains identical, rolling back to purely handwritten code incurs zero breaking changes and zero downstream disruption.