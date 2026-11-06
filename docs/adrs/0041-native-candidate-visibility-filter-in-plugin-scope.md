<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0041: Native Candidate Visibility Filter Inside Plugin Scope

- **Status**: Accepted
- **Date**: 2026-10-29
- **Deciders**: Architect, Engineering Team
- **Consulted**: QA, UI Reviewers
- **Informed**: All Plugin Users, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
The host renders three session listings from one session store, each applying its own visibility rule.

- The left sidebar drops every subagent session at the top of its visibility predicate, so a session created by another session never appears there.
- The composer `@` reference candidates skip only the session under composition; `dsh-session-reference` never inspects origin or parentage, so every subagent session of every session enters the candidate window and lands in the conversation section.
- The plugin's own second-level drill-down carried a stricter predicate of its own invention: six inference rules on titles, parentage and depth on top of `origin`, so it hid sessions the sidebar still lists. This ADR replaces that predicate with the sidebar predicate as well.

On a workspace holding 916 sessions of which 757 are subagent sessions, the candidate window of 50 filled with 42 subagent rows and 12 of them sat at the head of the menu. The user reads that as the plugin leaking sessions it created; the leak is entirely on the host `@` side, which has no such predicate to reuse.

The host package is upstream and may not be edited. The plugin must therefore either reproduce the predicate under its own ownership or leave the menu dirty.

### 1.2 Architectural Forces & Constraints
- **Upstream Immutability**: Host packages are read-only dependencies. Any repair ships inside the plugin or not at all.
- **Reuse Before Rewrite**: ADR-0017 and ADR-0025 establish that a host capability is reused through its public interface first, and ADR-0034 already reuses the host's native recency ordering for candidates.
- **Host Strictness Variance**: ADR-0037 requires optional host surfaces to be probed and to degrade instead of throwing.
- **Zero Cross-Boundary Effects**: ADR-0034 forbids a mention from waking agents or drawing telemetry; a filter must stay a pure read-side projection.
- **Traceable Failure Surface**: A fix that silently stops filtering is worse than one that visibly degrades.

---

## 2. Decision Drivers

- Driver 1: Make the `@` menu agree with the sidebar without owning a second full candidate pipeline.
- Driver 2: Keep the repair inside the plugin package so a published release carries it.
- Driver 3: Bound the fields the plugin depends on to the smallest observable surface.

---

## 3. Considered Options

### Option 1: Copy the Host Candidate Pipeline
- **Description**: Reimplement the candidate query, ordering, rendering and selection inside the plugin and stop using the host `@` source.
- **Pros**: Total behavioral ownership; no dependency on host internals.
- **Cons**: The host `@` source still renders its own group, so the dirty menu survives untouched. A full reimplementation also duplicates ordering, recency projection and row formatting, and drifts on every host release.

### Option 2: Runtime Filter Over the Host Source
- **Description**: Locate the host `reference` source in the trigger roster and wrap its `candidates` result with the sidebar predicate.
- **Pros**: One predicate over `origin` alone; selection, rendering and ordering stay native; the fix ships inside the plugin.
- **Cons**: Depends on the host source being named `reference` on trigger `@` and on candidate rows carrying a decodable `dsh-session:` mention. A host rename disables the filter.

### Option 3: Report Upstream and Accept the Menu
- **Description**: File the inconsistency with the host and change nothing locally.
- **Pros**: Zero maintenance.
- **Cons**: No effect for the current user; the inconsistency is a defect of the host candidate query, not of the plugin.

---

## 4. Decision Outcome

**Chosen Option**: Option 2 — Runtime Filter Over the Host Source.

### 4.1 Core Architectural Invariants
1. **Invariant 1 (Ownership)**: The plugin reads the host roster through `inputTriggers.live.sources` and replaces only the `candidates` function of the host `@` `reference` source. No host file, configuration or package byte changes.
2. **Invariant 2 (Predicate Parity)**: A candidate is dropped when its session carries `origin: "subagent"` or is identified as archived (via snapshot `archived` flags, statuses, or host workspace `archivedSessionIds` roster), exactly as the sidebar decides. A live session carrying a parent but no subagent origin stays visible, because the sidebar lists it too. The children of the session under composition are dropped as well: the sidebar never lists them and the plugin menu carries no subagent section.
   - **Invariant 2a (Ordering Parity)**: The surviving session rows are reordered by native recency descending (`updatedAt || createdAt || 0`), matching the sidebar order. Non-session rows keep their host slots.
3. **Invariant 3 (Single Wrapping)**: Each host source is wrapped at most once per client module instance, enforced by a weak set, so repeated installs cannot stack filters.
4. **Invariant 4 (Degradation)**: A missing roster, a malformed mention, an unknown row shape or a throwing predicate returns the host rows unchanged. The filter never throws into the host fetch path.
5. **Invariant 5 (No Rewrite)**: The plugin does not decode host session identifiers through host internals; it decodes the base64url payload of the mention with a local decoder.
6. **Invariant 6 (Restorable Wrapper)**: The replacement is scoped to the host source object and reversible: the activation disposer restores the original `candidates` function whenever the live property still holds the wrapper, and never overwrites a host function installed afterwards. No prototype, global or module export is touched, so the CONTEXT.md `Avoid` entry for in-process monkey patching is honoured through object-local, restorable substitution authorized here.
7. **Invariant 7 (Unknown Rows Stay)**: A candidate row whose session is absent from the local session snapshot carries no readable origin, so it is kept rather than guessed away, and it keeps its host slot instead of joining the recency sort. The sidebar keeps such rows too; the filter drops only rows it can positively identify as subagent sessions.

### 4.2 Failure Surface
The filter depends on two host facts: the source identity `@` plus `reference`, and candidate rows carrying `{kind:"session", mention:"@[label](dsh-session:<base64url>)"}`. If either changes, the menu returns to today's behavior with no exception and no partial state, and one console warning records the degradation. Drift is pinned by tests/host-candidate-contract.test.mjs, which asserts both facts against the installed host package and skips when that install is unreachable, so a host upgrade that renames the source or the scheme fails the suite instead of silently disabling the filter.

### 4.3 Consequences
- **Positive**: The menu and the sidebar agree; no host file is touched; host upgrades need review only when those two facts change.
- **Negative**: The plugin now holds one behavioral dependency on host runtime shape. The predicate is duplicated by necessity, not by preference, and must be re-diffed against the sidebar on host upgrades.
- **Neutral**: The host's own `对话` section keeps its remaining content; the plugin gains no new section and no new copy.

---

## 5. Verification

- A suite passing a fabricated host source proves three outcomes at once: every subagent row disappears, a parented session without subagent origin survives, and non-session rows plus malformed rows pass through unchanged in their original slots.
- The same suite asserts a single invocation of the host `candidates` per fetch and no wrapper stacking across repeated installs.
- The sandbox suite runs with neither `atob` nor `Buffer` available, so a decoder that depends on either fails there.