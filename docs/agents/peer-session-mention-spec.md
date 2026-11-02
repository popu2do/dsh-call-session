# Specification: Peer Session Mention Picker

## Problem
The host default session query issues a two-second asynchronous query when listing sessions. If the user invokes the mention picker and selects a workspace before that query finishes, the results arrive late, wipe out the current candidate list, reset the menu state, and steal cursor focus. Furthermore, native mention candidate listings include internal subagents and archived sessions, diverging from the left workspace sidebar view.

## Solution

Without modifying native file search, the plugin controls session candidate ranking and presentation:
1. Native file and folder search remain functional and intact.
2. The plugin candidate source sets its priority order to `-10`, ensuring workspace entry points and peer sessions lead the candidate list so focus is never stolen.
3. Once a workspace is selected, the secondary session list resolves synchronously from local memory in under 5ms, avoiding slow remote queries and subsequent redraws.
4. Internal subagents are strictly excluded by origin flag parity with the sidebar, and archived sessions are filtered out via both snapshot fields and the host workspace roster.
5. Secondary sessions follow native update recency descending with zero collaborator pinning, bound with an 8-character canonical short ID badge for disambiguation, capped at 50 entries.

## User Stories

1. As a collaborative developer, I want typing `@` in the composer to show accessible project workspaces right at the top, so that I can pick my target workspace immediately without hunting.
2. As a project owner, I want the current project workspace automatically pinned to the very top, so that I can enter my active working directory with a single click.
3. As a developer searching files, I want native file and folder search to remain completely functional, so that my existing file reference habits are never broken.
4. As an engineer entering a workspace, I want the secondary session list to strictly exclude all internal subagents by origin, so that only genuine independent root sessions appear.
5. As an engineer inspecting a project, I want the secondary session list to completely filter out archived or finished sessions, so that dead tasks never clutter my active view.
6. As a multi-agent collaborator, I want every peer session to appear in the same update-time order as the left sidebar with no session promoted above its recency, so that what I see in @ matches what I see on the left.
7. As a multi-session user, I want secondary sessions with the same priority sorted strictly by latest update recency, so that sessions with newer updates appear ahead of older ones.
8. As a developer managing parallel tasks with identical titles, I want candidate rows to display an 8-character short ID badge, so that I can tell duplicate names apart instantly.
9. As a system observer, I want candidate rows to display real-time three-state status indicators, so that I know whether each peer session is running, idle, or in an error state.
10. As a keyboard-first user, I want Tab or Enter on a workspace row to enter it smoothly and Escape to cancel without altering my text, so that I never have to touch the mouse.
11. As a developer mentioning an agent, I want selecting a session to insert a pure slice reference markdown link, so that no heavy context or orchestration side effects are triggered.
12. As an English locale user, I want all drill headers, badges, and empty states rendered in natural English, so that my internationalization experience remains seamless.
13. As a developer working in a single-session workspace, I want secondary drill-down to show a clean empty state rather than breaking, so that the interaction is always predictable.
14. As an infrastructure engineer, I want all candidate parsing and filtering bounded under 5ms, so that composer typing never stutters or drops frames.

## Implementation Decisions

### Priority Override

The capability integrates via the client input trigger contract under source name `peer-session` with trigger character `@`.
The plugin sets source `order: -10` so workspace entry points and peer sessions consistently lead merged candidate lists, maintaining stable keyboard focus against asynchronous remote insertions.

### Native Coexistence

Strictly adhere to non-destructive coexistence with host primitives:
Native file and folder search remain functional and intact without host file modifications.
The host reference candidate source is locally filtered in-scope per ADR-0041: only the source's candidate generator is intercepted to drop subagents and align recency ordering. Trigger character, name, section title, and slot registrations remain unchanged, and the wrapper detaches cleanly upon disposal.

### In-Memory Resolution

Upon workspace drill-down, the secondary session list is extracted synchronously from the local memory snapshot:
Zero remote session queries are dispatched over the network. Synchronous iteration and ranking complete in under 1ms, preventing deferred UI repaints.

### Session Sanitization

Candidate sessions undergo multi-dimensional filtering:
- Exclude subagents: Parity with sidebar logic reading `origin === 'subagent'` exclusively, regardless of parentage metadata. Current session own children are excluded alike, removing artificial subagent section pollution.
- Exclude archived sessions: Any session marked `archived` or in status `archived`, `dismissed`, or `deleted` is excluded.
- Exclude rostered archived sessions: When the host `workspaces` service provides an `archivedSessionIds` roster in its snapshot, matching sessions are excluded from Level 2 expansion and Level 1 workspace convergence.
- Degradation contract: When the `workspaces` service is absent, lacks the roster field, or throws on read, the roster is treated as empty, degrading gracefully to snapshot-field filtering.
- Workspace convergence: Workspaces left with only rostered archived sessions do not appear at Level 1. Workspaces with live sessions remain visible, and the current workspace remains pinned.

### Deterministic Ranking

Level 2 candidates follow single-tier ordering:
- Ordering: Sorted strictly by native update timestamp descending, matching the workspace sidebar. Entries with matching timestamps maintain arrival sequence.
- Window cap: Clamped to 50 items to sustain 60fps rendering performance.

## Testing Decisions

### Verification Invariants

Tests execute in an isolated Node VM sandbox verifying real user-facing behavior:
- Level 1 displays only workspace entries with plain text section `Workspaces` (`工作区`), current workspace pinned at top.
- Level 2 excludes subagents and archived sessions, exposing only active peer root sessions.
- Level 2 orders sessions by update recency descending with zero collaborator pinning.
- Canonical 8-character short ID badges are aligned.
- Collaboration canvas edge count remains strictly 0.

### Test Location

Automated tests are maintained in `tests/peer-session-reference.test.mjs` (user interaction sandbox test) and `tests/host-candidate-contract.test.mjs` (host contract drift verification).

## Out of Scope

- Remote session query replacement across the entire DSH system.
- File system indexing or file reference modifications.
- Modifications to the host shell or native reference picker code outside plugin boundaries.
