# Specification: Peer Session Mention Picker

## Problem

The `@` composer trigger exposes a two-level drill-down: Level 1 lists workspaces, Level 2 lists the sessions inside one workspace. Both levels currently disagree with the surfaces the user compares them against.

**Level 1 disagrees with the left sidebar.** The plugin derives workspaces by aggregating `cwd` across `sessions.list.getSnapshot().byId`. The host sidebar instead reads the workspace roster at `workspaces.list.getSnapshot().items` and decides membership purely by `workspace.sessionIds.includes(sessionId)`, never by `cwd`. The client session snapshot only holds sessions from the storage unit of the active window, so `cwd` aggregation can only reconstruct the workspaces whose session stores are reachable from that window. Measured on a live store, five workspaces exist with 180, 52, 14, 16 and 10 sessions respectively, but `cwd` aggregation can only reconstruct the single workspace whose session store the active window already holds.

**Level 2 disagrees with the left sidebar.** The plugin's own secondary candidates are correct: measured against the live store they return exactly the `sessionIds` members that are visible, with `section` and `drill` both `undefined`. But the host reference source contributes its own session candidates to the same drill-down menu, each carrying `section: "对话"`. Those rows are not filtered by `sessionIds`, so sessions that never appear in the left sidebar appear under `对话`. The host reference source also renders a drill header whose root is `工作区` and whose tail is the drilled directory, plus directory rows carrying the `进入目录` affordance — both are file-browsing semantics leaking into a session drill-down.

**The level boundary depends on an external flag.** The two-level decision trusts the host's `drilled` flag alone. Editing the path text by hand keeps that flag false, so the menu falls back to Level 1 and shows workspace rows with the `当前` badge and `进入目录` affordance under a `工作区` heading.

**The README asset misrepresents the picker.** `assets/mention-demo.png` and `assets/mention-demo-zh.png` are rendered by `tests/helpers/render-mention-demo.mjs` from synthetic HTML, showing a `Workspace Root / dsh-call-session` drill header, five invented agent names, and a left column that matches neither the real Level 1 nor the real Level 2. The README prose additionally claims sessions the current conversation has called or exchanged messages with sort first, which contradicts ADR-0034's zero-collaborator-pinning decision.

## Solution

Bring every surface onto one membership rule and stop rendering file-browsing chrome inside the session drill-down.

1. **Level 1 reads the workspace roster.** Workspace entries come from `workspaces.list.getSnapshot().items`, the same source the sidebar reads. Ordering keeps the current workspace pinned first and the rest in roster order. Every roster entry is listed, including workspaces whose session stores are not reachable from the active window; drilling into one of those yields an empty Level 2, which is the accepted behaviour rather than a case to special-case.
2. **Membership is `sessionIds` only.** A session belongs to a workspace when `workspace.sessionIds` contains it. `cwd` never decides membership at either level.
3. **Level 2 visibility mirrors the sidebar.** A member is listed when it resolves in `sessions.byId` and passes the sidebar's own three exclusions: `origin === "subagent"` is dropped, `blank` is dropped unless it is the current session, and `archivedSessionIds` membership is dropped under the default archive filter.
4. **The session drill-down carries no file semantics.** While drilled, the plugin's native reference wrapper returns an empty array, so the host contributes neither `对话` session rows, nor the host's `工作区` drill header, nor `进入目录` directory rows. The plugin still renders its own drill header — `header.root` over the drilled workspace name, as ADR-0034 requires — so Level 2 shows that two-row header above peer-session candidates and nothing else.
5. **Drill state follows the query, not only the host flag.** A query that resolves to a known workspace is treated as Level 2 whether it arrived from a drill action or from typing, so the level boundary never collapses.
6. **The README asset is regenerated from the real structure.** The demo renders the real Level 1 (`工作区` section, workspace rows only) and the real Level 2 (`对话` section as produced by the plugin, session rows with status and short ID, no drill header, no directory rows), and the false recency claim is removed from both READMEs.

## User Stories

1. As a collaborative developer, I want the `@` workspace list to contain exactly the workspaces the left sidebar shows, so that the two surfaces never disagree about which projects exist.
2. As a developer with several registered workspaces, I want every workspace to be listed even when its sessions live in a storage unit this window cannot read, so that the picker does not silently hide projects.
3. As a developer entering an unreachable workspace, I want an empty Level 2 rather than an error or a hidden entry, so that the interaction stays predictable.
4. As an engineer entering a workspace, I want the session list to contain exactly the members of that workspace, so that sessions belonging to another workspace never appear.
5. As a multi-session user, I want Level 2 to match the left sidebar row for row, so that what I see in `@` is what I see on the left.
6. As an engineer in the session drill-down, I want no host drill header, no `进入目录` affordance, and no directory rows, so that the two-level structure reads as workspace then session and nothing else.
7. As a developer typing a workspace path by hand, I want the menu to stay in Level 2, so that my path edit never throws me back to the workspace list.
8. As an engineer inspecting a project, I want archived and subagent sessions excluded exactly as the sidebar excludes them, so that dead tasks and internal children never clutter the list.
9. As a developer managing parallel tasks with identical titles, I want an 8-character short ID badge, so that duplicate names are distinguishable.
10. As a system observer, I want a three-state running indicator on each session row, so that I know whether a peer session is running, idle, or failed.
11. As a keyboard-first user, I want Tab or Enter to enter a workspace and Escape to cancel without altering my text, so that I never have to touch the mouse.
12. As an English locale user, I want every heading, badge, and empty state localized, so that the picker reads naturally in both locales.
13. As a documentation reader, I want the README screenshot to show what the picker actually renders, so that I can recognize the real UI when I open it.
14. As a documentation reader, I want the README prose to describe the real ordering rule, so that I am not told to expect collaborator pinning that does not exist.
15. As an infrastructure engineer, I want Level 1 and Level 2 resolution to stay inside the existing latency budget, so that composer typing never stutters.

## Implementation Decisions

### Source Contract

The capability registers a client input trigger source named `peer-session` on the `@` character with `order: -10` and `showGroupTitle: false`. The group title stays suppressed because both levels supply their own section heading through item `section` fields; suppressing it is what lets `工作区` and `对话` appear as item sections rather than duplicating a group header.

### Level 1: Roster As Truth

`candidates` reads the workspace roster once per invocation from `ctx.get('workspaces').list.getSnapshot().items`. This is the same service the plugin already consults for `archivedSessionIds`, so no new service dependency is introduced.

Each roster entry becomes one candidate carrying `section: t('section.workspaces')`, `icon: 'folder'`, and `drill: true`. The current workspace, identified by comparing the entry's `path` against the current session's `cwd`, receives the `当前` description; every other entry leaves `description` undefined.

Ordering is the current workspace pinned first followed by roster order. The previous alphabetical sort over aggregated `cwd` values is dropped, because roster order is what the sidebar renders and matching it is the point of the change.

Query filtering at Level 1 matches an entry when the lowercased query is contained in either the entry's `title` or its `path`. This preserves the ability to type a path fragment and narrow the workspace list.

### Level 2: Membership And Visibility

Drill state is resolved by `parseWorkspacePathQuery` against the current query. The parser returns a `targetWs` when the query matches a known workspace path exactly, or when the normalized query begins with a known workspace path followed by `/` or a space. Level 2 is entered when either the host reports `req.drilled === true` or the parser yields a non-empty `targetWs`. Binding the level to the parsed query rather than to the host flag alone is what keeps a hand-typed path inside Level 2.

Known workspaces for parsing are the roster paths, not aggregated `cwd` values. The current session's `cwd` remains available as a fallback target when the query names no workspace.

Member selection iterates `workspace.sessionIds` for the target workspace. A member is skipped when it does not resolve in `sessions.byId`, which is the ordinary case for workspaces whose session stores are unreachable from this window and requires no separate branch.

Visibility among resolved members applies the sidebar's three exclusions in the sidebar's order:
- `origin === 'subagent'` is dropped, matched on the session summary's `origin` field with a header-level fallback.
- `blank === true` is dropped unless the session is the current one.
- Membership in the `archivedSessionIds` roster is dropped.

The roster read degrades to an empty list when the service is missing, the field is absent, or the read throws, which keeps snapshot-field filtering as the fallback.

The current session is excluded from its own Level 2 list.

Ordering is a single tier by `updatedAt` descending with zero collaborator pinning and no cross-tier promotion. Arrival order breaks ties. The list clamps at 50 entries.

Every Level 2 candidate carries `section: undefined` and no `drill` field.

### Drill-Down Suppresses Native Reference Candidates

`wrapNativeCandidateSource` currently forwards every request to the host implementation and post-processes the result for sidebar parity. It gains an early return: when `request.drilled === true`, it resolves to an empty array without calling the host implementation.

This removes the host's `对话` session rows, the host's `工作区` drill header, and the `进入目录` directory rows from the drilled menu in one place. The plugin's own drill header (`header.root` plus the drilled workspace name, ADR-0034) is contributed by its own `header` hook and is unaffected; what the wrapper suppresses is the host's header, not the plugin's. It stays within ADR-0041 Invariant 1, which permits replacing the reference source's candidate generator and nothing else: the trigger character, source name, slot registrations, and the restore path are untouched, and the wrapper still restores the original `candidates` on disposal.

ADR-0041 Invariant 4 requires a visible degradation when the wrapper cannot do its job. An empty array under `drilled` is a deliberate narrowing rather than a degradation, and is recorded as such so it is not mistaken for the fallback path.

### Session Row Presentation

Each row shows the session title, falling back to `Agent <shortId>` when untitled, the 8-character short ID badge, and a status dot reflecting `running`, `idle`, or the error state. Selecting a row inserts a pure slice reference `dsh-session:<id>` with `appearance: 'session'`, carrying no context and triggering no orchestration.

### Placement And Latency

Level 1 and Level 2 both resolve from in-memory snapshots with no remote query. Level 2 remains inside the 5ms budget; Level 1 remains inside 2ms.

## Testing Decisions

### Failure-First Requirement

Every new test must fail against the current implementation. The existing assertion `assert.equal(level1.length, 3, 'Level 1 must deduplicate workspaces and contain exactly 3 workspaces')` at `tests/peer-session-reference.test.mjs:177` encodes the `cwd`-aggregation defect as expected behaviour and is replaced.

### Fixtures

Fixtures must model the real data shape rather than a convenient one: `workspaces.list.getSnapshot()` returns `items` with `sessionIds`, and `sessions.list.getSnapshot()` returns `byId` together with `ids`. The previous mock returned only `byId` and defaulted the workspaces service to `{}`, which is why the defect went unnoticed.

Required fixture cases:
- Five roster items while `byId` resolves sessions for only one of them.
- A session listed in `sessionIds` whose `cwd` is absent.
- A session whose `cwd` points at workspace A while `sessionIds` places it in workspace B.
- A session in no roster, which must not appear at either level.
- A blank session that is not the current session.
- Archived sessions declared both by snapshot field and by roster id.
- A drilled workspace whose `sessionIds` are entirely unreachable, producing an empty Level 2.

### Invariants

- Level 1 candidate count equals `workspaces.items.length`.
- Level 1 contains every roster path exactly once.
- Level 1 section is `工作区` and every entry carries `drill: true`.
- The current workspace sorts first.
- Level 2 membership equals `sessionIds` intersect `byId` intersect sidebar visibility.
- Every Level 2 candidate has `section === undefined` and no `drill`.
- Level 2 never contains a subagent, an archived session, a non-current blank session, the current session itself, or a non-member.
- A hand-typed workspace path enters Level 2, producing no `工作区` heading and no `进入目录` affordance.
- With `drilled === true`, the wrapped native reference source resolves to an empty array without invoking the host generator.
- The canvas edge count stays strictly zero.

### Asset Assertions

`tests/mention-demo-asset.test.mjs` keeps pinning the demo geometry, the manifest pairing, the README bindings, and the short-ID shape. It gains assertions that the rendered demo contains the Level 1 `工作区` heading with workspace rows only, contains the Level 2 `对话` heading with session rows only, and contains no drill header, no `进入目录` label, and no directory rows.

### Test Location

Interactive behaviour lives in `tests/peer-session-reference.test.mjs`. Host contract drift lives in `tests/host-candidate-contract.test.mjs`. The demo asset contract stays in `tests/mention-demo-asset.test.mjs`.

## Out of Scope

- Replacing remote session queries anywhere in DSH.
- File system indexing or changes to file reference behaviour outside the drilled state.
- Modifying host shell or native reference picker source outside plugin boundaries.
- Introducing collaborator pinning or any ordering rule beyond single-tier recency.
- Changing the two-level structure itself: Level 1 lists workspaces, Level 2 lists the sessions inside one workspace.
- Cross-store writes or reads performed specifically to populate an unreachable workspace's Level 2.
