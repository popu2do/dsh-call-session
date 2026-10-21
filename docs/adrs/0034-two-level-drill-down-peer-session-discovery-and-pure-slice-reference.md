# ADR-0034: Two-Level Drill-Down Peer Session Discovery and Pure Slice Reference Contract

- **Status**: Accepted
- **Date**: 2026-10-19
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: QA, UI Reviewers, Community
- **Informed**: All Plugin Users, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
In multi-agent collaborative environments within DeepSeek Harness, users frequently manage parallel agents across multiple independent workspaces. When composing prompts or dispatching instructions, users need to reference peer sessions as read-only context slices.

Under previous single-level mention designs, typing the trigger character `@` directly dumped all historical sessions across all workspaces into a single flat candidate menu. This caused several critical failure modes:
1. **Workspace Boundary Leakage**: Sessions belonging to unrelated external repositories were intermingled with local sessions, destroying workspace boundaries and confusing users.
2. **Cognitive Clutter & Duplicate Ambiguity**: As agents frequently create sessions with identical or automated titles, users could not identify the correct target without unique identifiers.
3. **Cross-Boundary Telemetry Contamination Risk**: Users and multi-agent orchestrators feared that mentioning a peer session in the composer might inadvertently trigger an autonomous agent wakeup, dispatch a unicast call, or draw misleading call connections on the visual collaboration canvas.

### 1.2 Architectural Forces & Constraints
- **Strict Workspace Boundary Isolation**: In accordance with ADR-0003 and ADR-0013, agent reasoning and candidate discovery must respect workspace containment by default.
- **Zero Cross-Boundary Telemetry Invariant**: A composer mention is purely an editorial reference. It must never trigger physical agent wakeups, must never dispatch unicast calls, and must leave canvas activeCalls strictly equal to zero.
- **Pure Slice Reference Integrity**: The referenced session artifact passed to the LLM must consist solely of standard public session metadata and read-only text history, completely decoupled from private host runtime probes.
- **Visual Simplicity & Keyboard Usability**: The candidate menu must remain responsive, keyboard-navigable via Tab, Enter, and Escape, and avoid deeply nested micro-sections that impede rapid scanning.
- **Bilingual Localization Parity**: In accordance with ADR-0023, all menu sections, descriptions, and breadcrumb labels must be 100% symmetrically localized in Simplified Chinese and English.

---

## 2. Decision Drivers

- Driver 1: Enforce workspace containment at the composer input boundary through a structured two-level drill-down state machine.
- Driver 2: Eliminate candidate ambiguity using canonical 8-character short ID badges alongside native 3-state execution status indicators.
- Driver 3: Preserve rapid keyboard scanning by flattening session candidates inside drilled workspaces ordered strictly by native update recency.
- Driver 4: Guarantee zero cross-boundary side effects: zero agent wakeups, zero blackboard mutations, and zero collaboration canvas connection lines.
- Driver 5: Provide seamless breadcrumb navigation enabling immediate return to root workspace selection without closing the trigger menu.

---

## 3. Considered Options

### Option 1: Global Flat Session List with Prefix Filtering
- **Description**: Expose all sessions across all workspaces in one list and rely on user query typing.
- **Pros**: Minimal client code.
- **Cons**: Severe workspace leakage; candidate overload; broken isolation; unacceptable UX in multi-workspace setups.

### Option 2: Hierarchical Micro-Sections within Drilled Workspaces
- **Description**: Drill down into a workspace and group sessions into multiple micro-sections such as Peer Sessions, Subagents, and Archived Dialogues.
- **Pros**: Categorical granularity.
- **Cons**: High visual noise; breaks unified temporal recency sorting; creates keyboard navigation friction; causes empty placeholder headers when categories have no items.

### Option 3 (Chosen): Two-Level Drill-Down with Flat Recency-Ordered Sessions and Pure Slice Reference Contract
- **Description**: Level 1 exposes only workspace roots with drill flags enabled and current workspace pinned at top. Selecting a workspace drills down to Level 2, presenting a flat session list sorted strictly by latest update recency with 8-character short ID badges and native 3-state status. A breadcrumb header allows instant return to the root workspace menu. Picking a session inserts an atomic read-only chip referencing `dsh-session:<sessionId>` with zero side effects on canvas telemetry or blackboard state.
- **Pros**: Clean workspace boundaries; minimal visual cognitive load; unambiguous short ID identification; zero cross-boundary side effects; fluid keyboard navigation.
- **Cons**: Requires two-step navigation for cross-workspace session references.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Two-Level Drill-Down with Flat Recency-Ordered Sessions and Pure Slice Reference Contract.

### 4.1 Core Architectural Principles & Invariants

1. **Two-Level Drill-Down State Machine Invariant**:
   The input trigger source registered under trigger `@` and name `peer-session` operates in two distinct phases:
   - *Level 1 (Undrilled)*: Exposes solely workspace directories with folder icons, grouped under section `section.workspaces` (Chinese: 工作区, English: Workspaces). Each candidate declares `drill: true`. The current workspace is automatically pinned to index 0 with description `workspace.current` (Chinese: 当前, English: Current). Session entities are strictly forbidden from appearing at Level 1.
   - *Level 2 (Drilled)*: Triggered by user drill action or query path match. Renders a flat session list within the selected workspace without micro-sections (`section: undefined`). The current active session is strictly excluded from candidate proposals.

2. **Two-Tier Prioritization & Subagent/Archived Exclusion Invariant**:
   - *Subagent & Archived Exclusion*: In accordance with ADR-0010 and ADR-0024, subagents (sessions with `origin: 'subagent'`, parentSession/parentId references, delegation depth > 0, or internal pipeline task titles) and archived/terminated sessions are strictly excluded from Level 2 proposals. Only independent, active top-level root sessions are admitted.
   - *Two-Tier Ordering*: Sessions displayed in Level 2 are sorted with deterministic two-tier prioritization:
     1. First priority: Collaborator sessions registered with `dsh-call-session` (sessions having inbound/outbound calls in telemetry, active blackboard posts, or created as peer sessions) are pinned at the top.
     2. Second priority: Sessions are sorted by native recency descending (`updatedAt || createdAt || 0`). Recent active collaborators appear at the very top.

3. **Canonical 8-Character Short ID Badge Invariant**:
   Every session candidate displays a canonical short ID formatted as `#xxxxxxxx` (exactly 9 characters beginning with `#` followed by 8 lowercase alphanumeric characters). The label presents the session title, gracefully falling back to `Agent #xxxxxxxx` if the title is absent. The candidate description presents the native 3-state execution status (`session.running`, `session.idle`, `session.error`, or `session.offline`).

4. **Breadcrumb Return Navigation Invariant**:
   When drilled, the source header hook publishes a two-crumb trail: `crumb.root` (Chinese: 工作区根目录, English: Workspace Root) and the drilled workspace name. Activating the root crumb returns `@` with `continue: true`, cleanly resetting the trigger back to Level 1.

5. **Zero Cross-Boundary Side-Effect Invariant**:
   Throughout candidate discovery, drill-down, query filtering, session selection, chip insertion, and codec serialization:
   - Call telemetry `activeCalls` remains strictly 0;
   - Zero call telemetry records are appended (`calls.length === 0`);
   - Zero blackboard posts are created or mutated (`posts.length === 0`);
   - Zero unicast calls or agent wakeups are dispatched.
   The collaboration canvas topology remains completely unperturbed.

6. **Pure Slice Reference Contract**:
   Session selection produces an insert action referencing `dsh-session:<sessionId>` with appearance `session`. The text delivered to the language model consists strictly of public session status and read-only message history slices. No private host objects, internal tokens, or unverified memory contexts are probed or leaked.

7. **Bilingual Localization Invariant**:
   In strict compliance with ADR-0023, all dictionary keys (`section.workspaces`, `crumb.root`, `workspace.current`, `session.running`, `session.idle`, `session.error`, `session.offline`) are defined symmetrically across Chinese and English dictionaries with zero missing keys.

8. **UI Frame Budget & Deterministic Performance SLA Invariant**:
   In accordance with ADR-0020, candidate resolution executes 100% in-memory with zero disk I/O and zero network fetch during keystroke autocomplete. Level 1 workspace discovery latency P99 <= 2ms; Level 2 session filtering and two-tier ranking latency P99 <= 5ms. Returned candidate sets are strictly clamped to a maximum of 50 items to ensure butter-smooth 60fps rendering without UI frame drops.

### 4.2 System Architecture & Topology

```
User types '@' in Composer
        │
        ▼
Level 1: Workspace Discovery
┌──────────────────────────────────────────────────────────┐
│ [Folder] current-repo           (当前 / Current) [Drill] │
│ [Folder] external-service-a                      [Drill] │
│ [Folder] external-service-b                      [Drill] │
└──────────────────────────────────────────────────────────┘
        │
        │ User presses Enter/Tab on workspace
        ▼
Level 2: Drilled Workspace Sessions
┌──────────────────────────────────────────────────────────┐
│ Crumb: [工作区根目录 / Workspace Root] / current-repo    │
├──────────────────────────────────────────────────────────┤
│ #a1b2c3d4  Architecture Coordinator (运行中 / Running)  │
│ #e5f67890  Automated Test Runner    (就绪 / Idle)        │
│ #12345678  Linter Auditor           (异常 / Error)       │
└──────────────────────────────────────────────────────────┘
        │
        │ User picks session
        ▼
Chip Inserted into Composer:
  Insert payload: {
    source: 'peer-session',
    ref: 'dsh-session:session-uuid',
    label: 'Architecture Coordinator',
    appearance: 'session'
  }
        │
        ▼
Invariant Verification:
  telemetry.activeCalls === 0   (Canvas edges untouched)
  blackboard.posts.length === 0 (Blackboard untouched)
  unicastCalls.length === 0     (No agent wakeup)
```

---

## 5. Consequences & Compliance

### 5.1 Positive Consequences
- Cognitive clarity: Users navigate directly through familiar workspace boundaries.
- Disambiguation: 8-character canonical badges guarantee distinct visual markers even when duplicate session titles exist.
- Topological purity: Canvas call telemetry remains 100% faithful to actual physical agent calls without ghost edges created by input references.
- Security and isolation: Read-only slices prevent accidental privilege escalation or unauthorized cross-agent command execution.

### 5.2 Negative Consequences & Mitigations
- Referencing a session in another workspace requires drilling into that workspace first.
  - *Mitigation*: The root breadcrumb and query-based filtering allow rapid switching and instantaneous keyboard completion.
