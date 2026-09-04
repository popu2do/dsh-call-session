# ADR-0003: Workspace-Scoped Isolation by Default with Cross-Workspace Opt-in

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Security Ops, Multi-Repo Maintainers
- **Informed**: All Subagents, Multi-Session Operators

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

A developer or automated CI pipeline running DeepSeek Harness frequently operates across multiple concurrent projects on the same machine. For instance, Session 1 might be auditing an authentication service in `D:/Projects/auth-svc`, while Session 2 is refactoring a database client in `D:/Projects/db-client`.

In naive shared-memory or single-board designs:
1. **Context Contamination**: When Session 1 posts an urgent architectural defect with tags `['p0', 'security']`, Session 2 calling `board_list` retrieves that item, hallucinating that the security bug applies to `db-client`.
2. **Accidental Deletion / Cross-Project Overwrite**: An agent executing cleanup or clearing a board topic (e.g. `board_clear({ topic: 'status:ready' })`) would wipe the status flags of completely unrelated repositories.
3. **Session Query Pollution**: When calling `session_query` to locate peers for task dispatch, an agent would discover 20+ active agents across 5 different client repositories, increasing cognitive load and risking sending private internal code diffs to foreign project agents.

### 1.2 Architectural Forces & Constraints

- **Multi-Tenant / Multi-Workspace Safety**: Workspaces must act as logical security and discovery boundaries by default.
- **Path Divergence on Windows & POSIX**: Paths like `D:\Projects\Auth` and `d:/projects/auth/` point to the exact same physical folder on Windows; failure to normalize leads to silent false-negative boundary mismatches.
- **Legitimate Cross-Workspace Dispatch**: Orchestrators (such as a multi-repo orchestrator or lead coordinator) must still possess the capability to observe and coordinate tasks across repositories when explicitly authorized.

---

## 2. Decision Drivers

- **Driver 1 (Hermetic Workspace Encapsulation)**: Prevent data leaks and LLM context pollution across independent project directories.
- **Driver 2 (Cross-Platform Path Normalization)**: Standardize all directory paths across operating systems to ensure reliable equality checks.
- **Driver 3 (Explicit Opt-in Cross-Project Access)**: Restrict multi-repository operations behind an explicit parameter (`cross_workspace: true`), preventing accidental global leakage.
- **Driver 4 (Non-Destructive Scoped Deletions)**: Guarantee that `board_clear` cannot inadvertently purge posts originating outside the caller's verified workspace.

---

## 3. Considered Options

### Option 1: Completely Independent Board Processes per Directory
- **Description**: Spawn a distinct DSH daemon or plugin instance per project folder, each storing `board.json` inside `.git/` or project roots.
- **Pros**: 100% physical separation.
- **Cons**: High memory and CPU overhead; impossible to perform intentional cross-repo orchestration or global multi-agent coordination.

### Option 2: Pure Namespace / Topic-Based Separation
- **Description**: Rely entirely on agents remembering to prefix topics with the repo name (e.g. `auth:task:ready`).
- **Pros**: Easy to implement; no path inspection.
- **Cons**: LLMs routinely forget prefixes or make typos; zero security against unintended clear operations; fails as a robust architecture boundary.

### Option 3 (Chosen): Path-Normalized Workspace Isolation with Explicit Cross-Workspace Opt-in
- **Description**: The plugin automatically inspects the caller's session working directory (`cwd`), canonicalizes it through `normalizeWorkspace`, and automatically filters all board posts and session queries to match that workspace. To view or dispatch across repos, the caller must explicitly specify `cross_workspace: true`.
- **Pros**: Zero cognitive burden on normal agents (isolation is automatic and fail-safe); cross-repo orchestration remains fully supported via explicit opt-in; cross-platform path quirks are safely handled.
- **Cons**: Requires caller session cwd resolution logic inside the plugin.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Path-Normalized Workspace Isolation with Explicit Opt-in.

### 4.1 Core Architectural Principles & Invariants

1. **Strict Path Normalization (`normalizeWorkspace`)**:
   - Every workspace path is transformed:
     - Backslashes `\` are replaced with forward slashes `/`.
     - Windows drive letters are converted to lowercase (`D:` -> `d:`).
     - Trailing slashes are stripped.
   ```javascript
   // lib/board-store.mjs Line 18-25
   export function normalizeWorkspace(rawPath) {
     if (!rawPath || typeof rawPath !== 'string') return '';
     let p = rawPath.trim();
     p = p.replace(/\\+/g, '/');
     p = p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
     p = p.replace(/\/+$/, '');
     return p;
   }
   ```
2. **Default Workspace Scoping for Queries**:
   - `board_list` automatically resolves `callerWorkspace = normalizeWorkspace(resolveSessionCwd(agent))`.
   - If `cross_workspace !== true`, queries evaluate:
     ```javascript
     if (callerWorkspace && post.workspace && post.workspace !== callerWorkspace) {
       return false; // Excluded from listing
     }
     ```
3. **Safe Clear Boundary**:
   - `board_clear` validates that posts targeted for deletion belong strictly to the caller's workspace unless explicit global authority is verified (`lib/board-store.mjs` Line 232-234).
4. **Session Discovery Scoping**:
   - `session_query` defaults to `cross_workspace: false`, returning only active/idle agents that share the exact normalized `cwd` (`lib/session-query.mjs` Line 107-110).

### 4.2 System Architecture & Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DSH Memory Dispatcher                           │
│                                                                        │
│                      [ Storage: board.json ]                           │
│                      [ Post A: workspace="d:/repo/auth" ]              │
│                      [ Post B: workspace="d:/repo/db"   ]              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼ [Default: cross_workspace = false]                      ▼ [Opt-in: cross_workspace = true]
┌────────────────────────────────────────┐                ┌────────────────────────────────────────┐
│     Caller CWD: "D:\Repo\Auth\"        │                │          Global Orchestrator           │
│                                        │                │                                        │
│  1. normalizeWorkspace(...)            │                │  Explicit opt-in:                      │
│     => "d:/repo/auth"                  │                │  cross_workspace: true                 │
│  2. Filtered Board Query:              │                │                                        │
│     Only Post A is returned            │                │  Unrestricted Query:                   │
│     Post B is hidden                   │                │  Both Post A and Post B returned       │
└────────────────────────────────────────┘                └────────────────────────────────────────┘
```

### 4.3 Interface & Protocol Contracts

#### `board_list` Parameters (`index.mjs` Line 517-570)
```json
{
  "cross_workspace": {
    "type": "boolean",
    "default": false,
    "description": "是否跨工作区检索。默认为 false（仅列出当前会话工作区内的黑板条目），设为 true 可检索全局所有工程的挂牌。"
  }
}
```

#### `session_query` Parameters (`index.mjs` Line 754-780)
```json
{
  "cross_workspace": {
    "type": "boolean",
    "default": false,
    "description": "是否检索非当前工作区的会话。默认 false 仅返回同工程会话。"
  }
}
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Zero Cross-Project Contamination**: Subagents working on parallel tasks in distinct repos never see foreign task items or code notices.
- **Accident-Proof Deletions**: A junior agent running `board_clear({ topic: 'temp' })` will only clear temporary markers in its own repo.
- **Cross-Platform Determinism**: Eliminates subtle Windows path bugs where uppercase drive letters or mixed slashes broke string matching.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Overlooked Global Data**: If a multi-repo orchestrator fails to pass `cross_workspace: true`, it will fail to see subagent reports across linked worktrees.
  - *Mitigation*: The `session_call` notice directive explicitly instructs recipients: `"Call board_list(cross_workspace=true) to inspect referenced board posts."`

### 5.3 Neutral & Operational Shifts
- Developers testing the plugin must ensure mock sessions provide a mock `cwd` or header structure when testing workspace isolation boundaries.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Normalization Unit Tests**: Test `normalizeWorkspace` with:
  - `C:\\Projects\\App\\` -> `c:/projects/app`
  - `/var/log/app/` -> `/var/log/app`
  - `""` or `null` -> `""`
- **Isolation Filter Tests**: Create Post 1 in `c:/repo/a` and Post 2 in `c:/repo/b`. Query from `c:/repo/a` with default settings; assert result length == 1.
- **Cross-Workspace Opt-in Tests**: Query from `c:/repo/a` with `cross_workspace: true`; assert result length == 2.
- **Clear Protection Tests**: Attempt `board_clear` from `c:/repo/a` targeting Post 2; assert deletion is rejected or leaves Post 2 intact.

### 6.2 Code Review & Maintenance Checklist
- [x] All queries checking workspace equality must route both inputs through `normalizeWorkspace`.
- [x] Defaults for `cross_workspace` must remain strictly `false`.
- [x] `board_clear` must never perform an un-scoped wipe unless caller has verified global authority.

---

## 7. Status History & Related Artifacts

- **2026-09-03**: Proposed by Architecture Team.
- **2026-09-03**: Accepted; integrated into `lib/board-store.mjs` and `lib/session-query.mjs`.
- **Related ADRs**:
  - Related to: [ADR-0001](./0001-separation-of-concerns-board-vs-call.md) (Board vs Call Separation)
  - Related to: [ADR-0005](./0005-english-metadata-and-two-state-status.md) (Normalized Two-State Protocol)
- **Implementation Artifacts**:
  - `lib/board-store.mjs` (Line 18-25, 149-153, 232-234)
  - `lib/session-query.mjs` (Line 24-26, 107-110)
