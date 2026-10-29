# ADR-0013: Human Canvas Global Transparency vs Agent Workspace Isolation

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Architect, Frontend Lead, Core Maintainers
- **Informed**: All Web Users, Multi-Session Operators

---

## 1. Context and Problem Statement

ADR-0003 established strict workspace isolation by default for Agent tools (`board_list`, `session_query`) to prevent LLM hallucinations and cross-repository context leakage.

When ADR-0012 introduced the Collaboration Canvas, it mechanically copied this constraint onto the human Web GUI. It added a "跨工作区拓扑" toggle button and defaulted `crossWorkspace` to `false`, hiding all external workspace columns.

This produced a fundamental architectural contradiction:
1. **Broken Information Architecture**: The canvas was explicitly designed as a horizontal multi-column layout with cross-workspace call curves. Hiding external columns by default broke the visual purpose of the canvas.
2. **Confused Target Audiences**: Workspace isolation is a guardrail for autonomous Agents, not a limitation for human observers. Forcing a human user to toggle a button to see peer projects in a bird's-eye view was an unnecessary friction.
3. **Buzzword Drift**: The data interface was labeled with marketing jargon instead of plain domain terminology ("看板数据" / "canvas data"), violating ADR-0009.

---

## 2. Decision Outcome

We explicitly decouple **Agent execution boundaries** from **human observer boundaries**:

1. **Canvas Default Global**: The canvas is an observer view for human users and displays every active workspace along with the sessions and calling edges the host reports as top level across the host. §2.2 narrows which sessions, edges and workspace columns are actually drawn.
2. **Eliminate Toggle Button**: Remove the "跨工作区拓扑" toolbar button completely. The toolbar only retains fit view, locate current session, and zoom controls.
3. **Pin Current Workspace First**: The workspace containing the user's current session is rendered as the first column on the left (marked `[Current]`), with other workspaces arranged to its right. §2.2.4 defines the only case where that column is absent: every session it held was hidden by the narrowing.
4. **Data Route Simplification**: The canvas data endpoint (`/plugins/dsh-call-session/telemetry`) eliminates the `crossWorkspace` query parameter and unconditionally returns full workspace data.
5. **Terminology Cleanup**: Standardize user-facing naming on "看板数据" / canvas data and register the retired jargon in the CONTEXT.md avoid list.
6. **Agent Sandbox Invariant**: Agent tools (`board_list`, `session_query`) strictly maintain their `cross_workspace: false` isolation default per ADR-0003.

### 2.1 Revision 2026-09-20: Viewport Fit, Clamped Session Locating, and Landed Pulse Feedback

Pinning the current workspace to the leftmost column (index 0) created an interaction defect: placing the located session node at the exact geometric center (`vw / 2, vh / 2`) shifted the leftmost column to the screen center, leaving more than 40% of the left screen blank while pushing peer workspace columns off the right edge. Invoking that single-node centering on mount also stripped users of the initial global topological overview.

1. **Initial & Resize Global Fit (全局自适应居中)**:
   - On canvas mount and upon receiving initial canvas data, the viewport unconditionally executes global fit view, framing the aggregate bounding box of the public blackboard and all workspace columns with safety padding (48px). Initial single-node centering is strictly prohibited.
   - A genuine container size change re-executes global fit view while the user has not manually taken control of the viewport; once the user has interacted, size changes never displace their view. The ResizeObserver's initial observation on `observe()` carries the current layout size, so it is not a size change; re-framing is gated on the measured size actually differing, which also lets a real resize merged into that initial observation re-frame.
   - Toolbar framing controls set the interaction flag explicitly. "Fit View" and the background double-click hand the viewport back to automatic management, so later size changes re-frame globally. "Locate Current Session" pins the viewport to the located node, so later size changes must not discard it.
2. **Clamped Viewport Centering for Locate (视口夹紧居中)**:
   - When the user clicks "定位当前会话", horizontal translation (`panX`) employs boundary clamping: if the aggregate layout width exceeds the viewport, the first column's left edge is clamped to a safety margin (48px), preventing leftward voids and maximizing visible space for peer workspaces on the right. Whenever the aggregate layout width fits inside the viewport, the layout centers as a whole instead.
   - Vertical translation (`panY`) centers on the target session node (`vh / 2`) as its baseline. Whenever the aggregate content height fits inside the viewport, `panY` is clamped so the top public blackboard (`y = 24`) and the column base both stay inside the visible area. When the column is taller than the viewport, node visibility takes precedence and the translation stays purely node-centered.
   - Zoom level preserves the user's setting, clamped to a dual-bounded safe range of `[0.8, 1.2]` (elevating sub-0.8 zoom for text readability, capping excessive zoom to preserve local topological context).
   - Translation transitions smoothly over a 320ms tween.
3. **Macro Framing Zoom Floor (宏观取景缩放下限)**:
   - Global fit view honors a readability floor of `0.30`. Topologies whose aggregate extent would require a smaller scale than the floor overflow the viewport rather than shrinking node labels below legibility. Overflow stays symmetric because the viewport remains anchored on the aggregate content centre. This is a deliberate trade-off: the canvas guarantees readable session identity over complete containment, and the user recovers the remainder by panning, zooming, or locating a session.
4. **Landed Pulse Feedback (落点脉冲)**:
   - Upon arriving at the target session node, a 1.2s dual-cycle soft breathing pulse is triggered via the scoped `.dsh-canvas-node-locating` class (`@keyframes dshLocatePulse`, two 600ms cycles starting after the 320ms translation tween). Conforming to ADR-0018, the animation changes stroke opacity only; geometric scale and translation transforms are strictly forbidden, and no glow or shadow is animated.
5. **Silent External Session Switching**:
   - When the host-injected `sessionId` changes, the canvas silently updates the node highlight border and `[Current]` badge without displacing the user's viewport. A current session that the narrowing of §2.2.6 hides gets no badge at all.

### 2.2 Revision 2026-10-29: Top-Level Session Visibility on the Canvas

The canvas treated every session in the payload as a collaboration peer, so delegated workers that the host derives from session origin (subagents and blank sessions) appeared as ordinary nodes in the same columns as human-directed sessions. The payload carried an `isTopLevel` flag that the client never read, and the host itself only derived it for live agents: endpoints synthesised from call records were hardcoded top level, and archived sessions never produced a row for the flag to describe. Both sides are corrected here.

1. **Visible Session Set**: The canvas renders only sessions whose payload `isTopLevel` is not `false`; a missing flag means top level, so every session the host emits must carry the flag. The windowed set is drawn from two host sources, since a hidden endpoint can also survive only as a stored origin on a call record (§2.2.7); the client therefore removes the union of both. Title heuristics stay confined to the peer-session roster and never decide canvas visibility.
2. **Single Filtered Set**: The toolbar counters (session total, running total, active calls) and the layout geometry both consume the same filtered session and call lists, so the canvas cannot report an entity it does not draw.
3. **No Dangling Edges**: A call whose caller or target is hidden is dropped together with its edge. Filtering endpoints alone is insufficient because the layout engine re-materialises archived, offline, or settled call endpoints (a settled call carries both titles) as virtual offline nodes, which would leak a hidden worker back onto the canvas. Blackboard entries keep rendering; only the author edge disappears when the author is hidden.
4. **Workspace Columns Follow Drawn Sessions**: Columns derive from the sessions that survive filtering, so a workspace whose only sessions are hidden yields no column. Narrowing is the only reason a column can disappear: the current workspace column is dropped only when it held live sessions and all of them were hidden, while a workspace that had no live session to begin with keeps its empty column exactly as before this revision. A payload containing no hidden session therefore renders the same columns as it did before. When nothing survives filtering at all, the empty current workspace column is the only orientation anchor left on an otherwise blank board. Sessions, edges and counters share one filtered set; the workspace columns follow it except in the two cases named in this paragraph, both of which the route and the layout keep.
5. **Host-Side Narrowing**: The route narrows sessions, calls, per-session call statistics and workspace entries before serialising, so a client that reads raw payload fields cannot resurrect a hidden worker. The client keeps an equivalent re-filter over the same two sources as defence in depth: it is unreachable while the host narrows first, and it must never be the only narrowing.
6. **Current Session Not Exempted**: When the calling session is itself non-top-level, the canvas draws the remaining top-level sessions, marks no node as current, and falls back to macro framing. Exempting it would reinstate the visibility this decision removes.
7. **Endpoint Origin Outlives Liveness**: A call record stores whether each endpoint was non-top-level when the call happened. Synthetic endpoints materialised from records whose agent has since left the live roster inherit that stored origin instead of assuming top level, otherwise an archived worker returns to the canvas on the next frame. The narrowing set therefore reads both sources, and the stored origin applies to every endpoint id it covers, including one that still has a live row: a record marking an endpoint non-top-level hides it even when its live row says otherwise, because the row's flag only describes the current turn while the record proves what the endpoint was. Blackboard entries carry only an author title and id, no origin, so an author absent from the roster is never synthesised into a session: the entry always renders and the author edge simply has no endpoint to attach to.

---

## 3. Consequences

### Positive
- The canvas multi-column workspace layout architecture works immediately upon opening without manual interaction, always offering a bird's-eye view.
- Human users immediately perceive all concurrent agent activities across repositories, minus delegated workers whose presence the host keeps internal (§2.2).
- Locating the current session no longer creates a massive void on the left or pushes peer columns off-screen.
- Contextual continuity is preserved by clamping zoom rather than hardcoding `zoom = 1.0`.
- 1.2s landed pulse provides instant visual acquisition without disorienting geometric jumps.
- Codebase removes redundant state, URL query parsing, and toolbar button handlers.

### Negative & Mitigations
- Environments with very wide topologies still require panning or zooming to inspect distant columns. The clamped session locator and fit view controls keep the relevant neighbourhood reachable.
- The macro framing zoom floor means extremely large topologies are not fully contained on first paint. Mitigated by the global overview remaining anchored on the blackboard and first columns, which are the highest-value anchors.

---

## 4. Compliance & Verification

1. **Mount Invariant**: `tests/client.test.mjs` verifies that initial telemetry triggers global fit view without biasing the viewport to column 0.
2. **Resize Refit Invariant**: Tests verify that after the host switches the current session, a genuine container size change still re-executes global fit view while the user has not manually taken control, and that the observer's initial observation never displaces the viewport.
3. **Clamping Invariant**: Tests assert that locating a session in column 0 when content width exceeds viewport bounds clamps `panX` to the left safety padding and prevents large empty margins.
4. **Zoom Invariant**: Tests verify that locate operations clamp zoom into `[0.8, 1.2]` while preserving in-range user zoom, and that macro framing never drops below the `0.30` floor.
5. **Landed Pulse & Motion Invariant**: Tests verify that `.dsh-canvas-node-locating` is applied to the located node only, that `@keyframes dshLocatePulse` carries no geometric scale or transform mutations, and that `prefers-reduced-motion` freezes it (per ADR-0018).
6. **Visibility Invariant**: `tests/canvas-subagent-visibility.test.mjs` verifies that a non-top-level session produces no node, that an all-top-level payload renders node-for-node through the unchanged layout engine so its node count and spacing match the engine's own output, that session counters exclude hidden sessions, that active and settled calls plus author edges touching a hidden endpoint render nothing, that a workspace holding only hidden sessions yields no column, that a current workspace that kept an empty column from the host still renders it, that a hidden current session is neither re-drawn nor marked, and that node spacing invariants survive the narrowing.
7. **Host Narrowing Invariant**: `tests/web-canvas-route.test.mjs` verifies that the serialised snapshot carries no non-top-level session or call, that its metrics count only drawn entities, that a workspace is dropped only when the sessions it held were all hidden, that per-session call statistics exclude calls touching a hidden endpoint, that a synthetic endpoint whose agent left the roster inherits the origin stored on the call record, that a current workspace with no live session keeps its empty column as before, and that the empty anchor column survives when nothing is visible at all.

---

## 5. Status History & Related Artifacts

- **2026-09-10**: Accepted by Architect, Frontend Lead, Core Maintainers
- **2026-09-20**: §2.1 revised viewport fit, clamped locating and landed pulse feedback
- **2026-10-29**: §2.2 revised canvas visibility to top-level sessions only
- **2026-10-29**: §2.3 replaced retired jargon for canvas view data with 看板数据 across the body; retired jargon stays registered in the CONTEXT.md avoid list
- **Revision history**: §2.1 (2026-09-20) and §2.2 (2026-10-29) were revised in place; this decision has no successor ADR
- **Related ADRs**:
  - Supersedes: Workspace isolation for the human canvas (ADR-0012, see `docs/adrs/README.md`)
  - Related to: ADR-0003, ADR-0012, ADR-0018
- **Implementation Artifacts**:
  - Primary source: `lib/client.js`, `lib/web-telemetry-route.mjs`
  - Test suites: `tests/canvas-subagent-visibility.test.mjs`, `tests/web-canvas-route.test.mjs`