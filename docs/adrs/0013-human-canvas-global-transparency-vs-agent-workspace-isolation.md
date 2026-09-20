# ADR-0013: Human Canvas Global Transparency vs Agent Workspace Isolation

- **Status**: Accepted (Amended: Viewport Fit and Clamped Session Locating)
- **Date**: 2026-09-10 (Updated: 2026-09-20)
- **Deciders**: Architect, Frontend Lead, Core Maintainers
- **Informed**: All Web Users, Multi-Session Operators

---

## 1. Context and Problem Statement

ADR-0003 established strict workspace isolation by default for Agent tools (`board_list`, `session_query`) to prevent LLM hallucinations and cross-repository context leakage.

When ADR-0012 introduced the Collaboration Canvas, it mechanically copied this constraint onto the human Web GUI. It added a "跨工作区拓扑" toggle button and defaulted `crossWorkspace` to `false`, hiding all external workspace columns.

This produced a fundamental architectural contradiction:
1. **Broken Information Architecture**: The canvas was explicitly designed as a horizontal multi-column layout with cross-workspace call curves. Hiding external columns by default broke the visual purpose of the canvas.
2. **Confused Target Audiences**: Workspace isolation is a guardrail for autonomous Agents, not a limitation for human observers. Forcing a human user to toggle a button to see peer projects in a bird's-eye view was an unnecessary friction.
3. **Buzzword Drift**: The data interface was labeled with marketing jargon ("telemetry" / "遥测") instead of plain domain terminology ("看板数据" / "canvas data"), violating ADR-0009.
4. **Locate Session Asymmetry & Viewport Distortion**: Pinning the current workspace to the leftmost column (index 0) created an interaction defect when locating the current session: naively placing the session node at the exact geometric center (`vw / 2, vh / 2`) shifted the leftmost column to the screen center, leaving >40% of the left screen completely blank while pushing peer workspace columns off the right edge. Furthermore, invoking this single-node centering on mount stripped users of the initial global topological overview.

---

## 2. Decision Outcome

We explicitly decouple **Agent execution boundaries** from **human observer boundaries**, and standardize canvas viewport and session locating geometry:

1. **Canvas Default Global**: The canvas is an observer view for human users and defaults to displaying all active workspaces, sessions, and calling edges across the host.
2. **Eliminate Toggle Button**: Remove the "跨工作区拓扑" toolbar button completely. The toolbar only retains fit view, locate current session, and zoom controls.
3. **Pin Current Workspace First**: The workspace containing the user's current session is always rendered as the first column on the left (marked `[Current]`), with other workspaces arranged to its right.
4. **Data Route Simplification**: The canvas data endpoint (`/plugins/dsh-call-session/telemetry`) eliminates the `crossWorkspace` query parameter and unconditionally returns full workspace data.
5. **Terminology Cleanup**: Discontinue the use of "遥测" in user-facing contexts, standardizing on "看板数据".
6. **Agent Sandbox Invariant**: Agent tools (`board_list`, `session_query`) strictly maintain their `cross_workspace: false` isolation default per ADR-0003.
7. **Initial & Resize Global Fit (全局自适应居中)**:
   - On canvas mount and upon receiving initial canvas data, the viewport unconditionally executes global fit view (`fitView(false, 'macro')`), framing the aggregate bounding box of the public blackboard and all workspace columns with safety padding (48px). Initial single-node centering is strictly prohibited.
8. **Clamped Viewport Centering for Locate (视口夹紧居中)**:
   - When the user clicks "定位当前会话", horizontal translation (`panX`) employs boundary clamping: if the aggregate layout width exceeds the viewport, the first column's left edge is clamped to a safety margin (48px), preventing leftward voids and maximizing visible space for peer workspaces on the right. Whenever the aggregate layout width fits inside the viewport, the layout centers as a whole instead.
   - Vertical translation (`panY`) centers on the target session node (`vh / 2`) as its baseline. Whenever the aggregate content height fits inside the viewport, `panY` is clamped so the top public blackboard (`y = 24`) and the column base both stay inside the visible area. When the column is taller than the viewport, node visibility takes precedence and the translation stays purely node-centered.
   - Zoom level preserves user setting, clamped to a dual-bounded safe range of `[0.8, 1.2]` (elevating sub-0.8 zoom for text readability and capping excessive zoom to preserve local topological context).
   - Translation transitions smoothly over a 320ms tween.
9. **Landed Pulse Feedback (落点脉冲)**:
   - Upon arriving at the target session node, a 1.2s dual-cycle soft breathing pulse is triggered via the scoped `.dsh-canvas-node-locating` class (`@keyframes dshLocatePulse`, two 600ms cycles starting after the 320ms translation tween). Conforming to ADR-0018, the animation modifies opacity only, with geometric scale/translation transforms strictly forbidden.
10. **Silent External Session Switching**:
    - When the host-injected `sessionId` changes, the canvas silently updates the node highlight border and `[Current]` badge without displacing the user's viewport.

---

## 3. Consequences

### Positive
- The canvas multi-column workspace layout architecture works immediately upon opening without manual interaction, always offering a bird's-eye view.
- Human users immediately perceive all concurrent agent activities across repositories.
- Locating the current session no longer creates a massive void on the left or pushes peer columns off-screen.
- Contextual continuity is preserved by clamping zoom rather than hardcoding `zoom = 1.0`.
- 1.2s landed pulse provides instant visual acquisition without disorienting geometric jumps.
- Codebase removes redundant state, URL query parsing, and toolbar button handlers.

### Negative & Mitigations
- Environments with very wide topologies still require panning/zooming to inspect distant columns, fully mitigated by the clamped session locator and fit view controls.

---

## 4. Compliance & Verification

1. **Mount Invariant**: `tests/client.test.mjs` verifies that initial telemetry triggers global fit view without biasing the viewport to column 0.
2. **Clamping Invariant**: Tests assert that locating a session in column 0 when content width exceeds viewport bounds clamps `panX` to the left safety padding and prevents large empty margins.
3. **Zoom Invariant**: Tests verify that locate operations clamp zoom into `[0.8, 1.2]` while preserving in-range user zoom.
4. **Landed Pulse & Motion Invariant**: Tests verify that `.dsh-canvas-node-locating` is applied to the located node only, that `@keyframes dshLocatePulse` carries no geometric scale or transform mutations, and that `prefers-reduced-motion` freezes it (per ADR-0018).
