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
3. **Buzzword Drift**: The data interface was labeled with marketing jargon ("telemetry" / "遥测") instead of plain domain terminology ("看板数据" / "canvas data"), violating ADR-0009.

---

## 2. Decision Outcome

We explicitly decouple **Agent execution boundaries** from **human observer boundaries**:

1. **Canvas Default Global**: The canvas is an observer view for human users and defaults to displaying all active workspaces, sessions, and calling edges across the host.
2. **Eliminate Toggle Button**: Remove the "跨工作区拓扑" toolbar button completely. The toolbar only retains fit view, locate current session, and zoom controls.
3. **Pin Current Workspace First**: The workspace containing the user's current session is always rendered as the first column on the left (marked `[Current]`), with other workspaces arranged to its right.
4. **Data Route Simplification**: The canvas data endpoint (`/plugins/dsh-call-session/telemetry`) eliminates the `crossWorkspace` query parameter and unconditionally returns full workspace data.
5. **Terminology Cleanup**: Discontinue the use of "遥测" in user-facing contexts, standardizing on "看板数据".
6. **Agent Sandbox Invariant**: Agent tools (`board_list`, `session_query`) strictly maintain their `cross_workspace: false` isolation default per ADR-0003.

---

## 3. Consequences

### Positive
- The canvas multi-column workspace layout architecture works immediately upon opening without manual interaction.
- Human users immediately perceive all concurrent agent activities across repositories.
- Codebase removes redundant state, URL query parsing, and toolbar button handlers.

### Negative
- Environments with a very large number of concurrent workspaces may have wide horizontal canvases, mitigated by existing fit view and current session locator.
