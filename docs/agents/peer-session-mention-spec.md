# Peer Session Mention Specification

## Problem Statement

When referencing a peer session by typing `@` in the composer, users face disruption from UI redraws and noisy candidate lists:
The host default session query issues an unconstrained remote query across all workspaces that takes up to two seconds to return. When that slow remote fetch completes, it forces a redraw over the candidate menu, obscuring the target with internal subagents and terminated dead sessions. This drops cursor focus, causes layout jitter, and pushes the intended peer session out of view.

## Solution

Without modifying native file search, the plugin controls session candidate ranking and presentation:
1. Native file and folder search remain functional and intact.
2. The plugin candidate source sets its priority order to `-10`, ensuring workspace entry points and peer sessions lead the candidate list so focus is never stolen.
3. Once a workspace is selected, the secondary session list resolves synchronously from local memory in under 5ms, avoiding slow remote queries and subsequent redraws.
4. Internal subagent delegations and archived dead sessions are filtered out, displaying only autonomous root sessions within the workspace.
5. Sessions with active collaboration are ranked ahead, followed by update recency descending, with an 8-character canonical short ID badge for disambiguation, capped at 50 entries.

## User Stories

1. As a collaborative developer, I want typing `@` in the composer to show accessible project workspaces right at the top, so that I can pick my target workspace immediately without hunting.
2. As a project owner, I want the current project workspace automatically pinned to the very top, so that I can enter my active working directory with a single click.
3. As a developer searching files, I want native file and folder search to remain completely functional, so that my existing file reference habits are never broken.
4. As an engineer entering a workspace, I want the secondary session list to strictly exclude all internal subagents and review tasks, so that only genuine independent root sessions appear.
5. As an engineer inspecting a project, I want the secondary session list to completely filter out archived or finished sessions, so that dead tasks never clutter my active view.
6. As a multi-agent collaborator, I want peer sessions registered with call-session to be prioritized at the top of the workspace list, so that live collaborators are reachable first.
7. As a multi-session user, I want secondary sessions with the same priority sorted strictly by latest update recency, so that sessions updated most recently appear ahead of older ones.
8. As a developer managing parallel tasks with identical titles, I want candidate rows to display an 8-character short ID badge, so that I can tell duplicate names apart instantly.
9. As a system observer, I want candidate rows to display real-time three-state status indicators, so that I know whether each peer session is running, idle, or in an error state.
10. As a keyboard-first user, I want Tab or Enter on a workspace row to enter it smoothly and Escape to cancel without altering my text, so that I never have to touch the mouse.
11. As a multi-workspace user, I want a drill header at the top of the list showing Workspace Root / <workspace-name>, so that I can return to the top list with one click.
12. As a composer user, I want picking a session to insert a clean inline chip showing only the chat icon and title, so that my prompt stays readable.
13. As an engineer verifying targets, I want hovering over an inserted chip to reveal a tooltip displaying workspace path, short ID, session ID, and status, so that I can check details before sending.
14. As an architect enforcing performance baselines, I want the entire workspace session lookup to run strictly in local memory within 5 milliseconds, so that the UI never stutters or re-refreshes two seconds later.
15. As an architect enforcing boundary constraints, I want text references to deliver pure read-only session state text to the model without triggering agent wakeups, so that collaboration canvas edges stay strictly at 0.
16. As a bilingual developer, I want all workspace labels, drill headers, and status tags localized symmetrically in Simplified Chinese and English, so that interface copy matches my language.

## Implementation Decisions

### Priority Override

The capability integrates via the client input trigger contract under source name `peer-session` with trigger character `@`.
The plugin sets source `order: -10` so workspace entry points and peer sessions consistently lead merged candidate lists, maintaining stable keyboard focus against asynchronous remote insertions.

### Native Coexistence

Native file search and directory traversal remain untouched. Zero native code is monkey-patched, and both candidate types coexist safely in the same composer menu.

### In-Memory Resolution

Upon workspace drill-down, the secondary session list is extracted synchronously from the local memory snapshot:
Zero remote session queries are dispatched over the network. Synchronous iteration and ranking complete in under 1ms, preventing deferred UI repaints.

### Session Sanitization

Candidate sessions undergo multi-dimensional filtering:
- Exclude subagents: Any session carrying `parentSessionId`, `parentId`, `parentSession`, an `origin: 'subagent'` flag, or review task markers is excluded.
- Exclude archived sessions: Any session marked `archived` or in status `archived`, `dismissed`, or `deleted` is excluded.
- Exclude rostered archived sessions: When the host `workspaces` service provides an `archivedSessionIds` roster in its snapshot, matching sessions are excluded from Level 2 expansion and Level 1 workspace convergence.
- Degradation contract: When the `workspaces` service is absent, lacks the roster field, or throws on read, the roster is treated as empty, degrading gracefully to snapshot-field filtering.
- Workspace convergence: Workspaces left with only rostered archived sessions do not appear at Level 1. Workspaces with live sessions remain visible, and the current workspace remains pinned.

### Deterministic Ranking

Level 2 candidates follow strict two-tier ordering:
- Tier 1: Collaborating sessions (participated in unicast calls, blackboard posts, or created via peer factory) are registered and prioritized first.
- Tier 2: Sorted by native `updatedAt` timestamp descending.
- Window cap: Results are clamped to 50 items to sustain 60fps rendering performance.

## Testing Decisions

### Verification Invariants

Tests execute in an isolated Node VM sandbox verifying real user-facing behavior:
- Level 1 displays only workspace entries with plain text section `Workspaces` (`工作区`), current workspace pinned at top.
- Level 2 excludes subagents and archived sessions, exposing only active peer root sessions.
- Collaborating sessions lead, followed by update recency descending.
- Canonical 8-character short ID badges are aligned.
- Collaboration canvas edge count remains strictly 0.

### Test Location

Automated tests are maintained in `tests/peer-session-reference.test.mjs` using the shared sandbox module harness.

## Out of Scope

- Modifying or intercepting host file search logic.
- Drawing canvas calling edges for composer inline text references.
- Triggering physical lifecycle wakeups or notifications on referenced sessions.

## References

Governed by agent documentation discipline, aligned with architectural decision record ADR-0034.