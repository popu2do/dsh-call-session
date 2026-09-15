# ADR-0011: Board List Token Governance, Exact ID Retrieval, and Prompt KV Cache Protection

- **Status**: Accepted
- **Date**: 2026-09-08
- **Deciders**: Architect, Core Engineering Team, Test & QA Lead
- **Consulted**: Multi-Agent Teams Operators, Security Reviewers
- **Informed**: All DSH Subagents, Plugin Users, Orchestrator Sessions

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

The shared blackboard (`board_post`, `board_list`, `board_clear`) serves as the passive, pull-based state store for cross-session and multi-agent coordination (ADR-0001, ADR-0002). Under `board_post`, callers can publish payloads of up to 64KB (65,536 characters) per entry.

However, operational field analysis and multi-agent execution in AgentTeams revealed three severe architectural friction points in `board_list`:

1. **Catastrophic Context Explosion via Default Content Dumping**:
   In legacy implementations, `titles_only` defaulted to `false`. When an autonomous agent invoked `board_list` (default limit: 20 entries, maximum: 100), the tool returned complete `content` strings for every post. In worst-case scenarios, a single exploratory list call injected up to 1.28MB (~300,000 to 500,000 tokens) of raw Markdown and JSON dumps directly into the LLM context window. This quickly exhausted context budgets, induced severe reasoning degradation, increased Time-To-First-Token (TTFT) latency by seconds, and incurred massive API token waste.

2. **Decoupled Notification vs. Consumption Gap (Missing Exact ID Lookup)**:
   When an agent sent a unicast message via `session_call` referencing blackboard posts (`context_post_ids: ['post-1234']`), the recipient was instructed to check the referenced item. However, `board_list` only supported collection-level filters (`topic`, `topic_prefix`, `tag`, `author`). It lacked an `id` query parameter. To inspect a single specific post, recipient agents were forced to run full-board scans or prefix queries, defeating the token savings achieved during unicast dispatch and introducing coordination bottlenecks.

3. **Server-side LLM Prompt KV Cache Eviction via Volatile Timestamps**:
   Legacy `board_list` returned dynamic relative time properties on every entry: `remainingSeconds` (recalculated every second) and `remainingMinutes`. Because `remainingSeconds` changed continuously across seconds, successive tool calls or historical message contexts never matched byte-for-byte. This directly violated **ADR-0010 Invariant 1 (Pure State Idempotency & Prompt KV Cache Protection)**, continuously busting LLM server-side prefix KV caches.

### 1.2 Architectural Forces & Constraints

- **Token Discipline & Anti-Slop (ADR-0009)**: Tool interactions must minimize unnecessary noise, prioritizing compact catalog summaries over unsolicited data dumping.
- **Zero Tool Sprawl**: Avoid creating additional tools like `board_get` or `board_read` when a unified, coherent interface (`board_list`) can handle both catalog browsing and point lookups cleanly.
- **Prompt KV Cache Stability (ADR-0010)**: Dynamic, rapidly changing relative timestamps must never leak into persistent model message histories.
- **Backward Compatibility & Explicit Intent**: Callers must always retain the option to explicitly request full content (`titles_only: false`) or lightweight titles (`titles_only: true`).

---

## 2. Decision Drivers

- **Driver 1 (Token Governance by Default)**: Establish catalog indexing as the safe default for collection queries, slashing exploratory token consumption by 85%–98%.
- **Driver 2 (Symmetric Context Handoff via Exact ID Lookup)**: Bridge `session_call` context references (`context_post_ids`) with instantaneous point retrieval by `id`.
- **Driver 3 (Context-Aware Intelligent Dispatch)**: Infer caller intent: collection queries default to lightweight summaries (`titles_only: true`), while targeted point queries default to full content retrieval (`titles_only: false`).
- **Driver 4 (Prompt KV Cache Invariant Enforcement)**: Excise volatile per-second countdowns (`remainingSeconds`) while preserving static, deterministic ISO timestamps (`createdAt`, `expiresAt`).

---

## 3. Considered Options

### Option 1: Status Quo with Hard Truncation Guard
- **Description**: Keep `titles_only: false` as default, but mechanically truncate `content` at 100 characters.
- **Pros**: Prevents multi-megabyte payloads without parameter schema changes.
- **Cons**: Irreversibly mangles structured JSON or Markdown payloads; confuses models with incomplete syntax; fails to address the root semantic distinction between browsing a catalog and reading an entity.

### Option 2: Split into Two Separate Tools (`board_list` and `board_get`)
- **Description**: Restrict `board_list` strictly to metadata/titles, and introduce a new tool `board_get({ id })` for fetching a single post by ID.
- **Pros**: Clean structural separation between collection and scalar operations.
- **Cons**: Increases plugin tool definition surface from 6 to 7 tools, adding overhead to every model system prompt; breaks downstream agent expectations; violates ADR-0009 anti-bloat principle.

### Option 3 (Chosen): Unified `board_list` with Intelligent Defaults, Exact ID Lookup, and KV Cache Protection
- **Description**:
  1. Add optional `id` parameter to `board_list`.
  2. Implement context-aware default resolution:
     - When `id` is omitted and `titles_only` is omitted: `titles_only` defaults to `true` (catalog mode).
     - When `id` is provided and `titles_only` is omitted: `titles_only` defaults to `false` (fetch mode).
     - When `titles_only` is explicitly specified (`true` or `false`), respect caller intent unconditionally.
  3. Completely eliminate `remainingSeconds` from returned post objects.
- **Pros**: Zero tool sprawl; optimizes token efficiency by default; fully resolves the `session_call` handoff gap; 100% preserves Prompt KV Cache.
- **Cons**: Requires explicit `titles_only: false` if a caller genuinely desires a batch dump of full contents.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Unified `board_list` with Intelligent Defaults, Exact ID Lookup, and KV Cache Protection.

### 4.1 Core Architectural Principles & Invariants

1. **Invariant 1 (Catalog Index by Default)**:
   A collection query (where `id` is not provided) is an index lookup. Unless `titles_only: false` is explicitly supplied, `board_list` MUST NOT return `content`.
2. **Invariant 2 (Exact Lookup with Content-Aware Fallback)**:
   When `id` is provided, `board_list` targets a specific post. In the absence of an explicit `titles_only` parameter, `titles_only` defaults to `false`, returning the full entry including `content`.
3. **Invariant 3 (Caller Intent Supremacy)**:
   If the caller explicitly provides `titles_only` (either `true` or `false`), that parameter strictly overrides any implicit defaults regardless of whether `id` is present.
4. **Invariant 4 (Prompt KV Cache Invariant & Timestamp Idempotency)**:
   Returned post objects MUST NOT contain `remainingSeconds`. Expiration time is deterministically communicated via static ISO strings (`createdAt`, `expiresAt`) and static numeric timestamps (`createdAtMs`, `expiresAtMs`).
5. **Invariant 5 (Strict Workspace Scoping for Exact Queries)**:
   Queries specifying `id` remain subject to workspace boundaries (`callerWorkspace`). If `cross_workspace: false` (default), querying an `id` belonging to a foreign workspace returns 0 matches, maintaining ADR-0003 isolation. Passing `cross_workspace: true` allows cross-workspace ID retrieval.

---

### 4.2 System Architecture & Dispatch Flow

```
                      board_list(args)
                             │
                             ▼
              ┌───────────────────────────────┐
              │  Evaluate Explicit Parameter  │
              │  titles_only !== undefined ?  │
              └──────────────┬────────────────┘
                             │
               ┌─────────────┴─────────────┐
          Yes  │                           │  No (undefined)
               ▼                           ▼
      ┌─────────────────┐        ┌───────────────────┐
      │ Use Explicit    │        │  args.id present  │
      │ titles_only val │        │  and non-empty?   │
      └────────┬────────┘        └─────────┬─────────┘
               │                           │
               │             ┌─────────────┴─────────────┐
               │        Yes  │                           │  No
               │             ▼                           ▼
               │     titles_only = false         titles_only = true
               │      (Full Post Mode)            (Catalog Mode)
               │             │                           │
               └─────────────┼───────────────────────────┘
                             ▼
              ┌───────────────────────────────┐
              │ Query & Filter in BoardStore: │
              │ - Workspace scoping           │
              │ - ID exact match (if set)     │
              │ - Topic, prefix, tag, author  │
              └──────────────┬────────────────┘
                             ▼
              ┌───────────────────────────────┐
              │ Format Output Records:        │
              │ - Exclude remainingSeconds    │
              │ - Exclude content if          │
              │   titlesOnly === true         │
              │ - Include content if          │
              │   titlesOnly === false        │
              └───────────────────────────────┘
```

---

### 4.3 Interface & Protocol Contracts

#### 4.3.1 `index.mjs` Tool Parameter Schema
```javascript
{
  name: 'board_list',
  description: '查询公共黑板上的有效公告与共享状态。默认仅返回标题与元数据摘要（titles_only: true）；支持通过 id 精确查阅单条详情（自动包含正文）。默认仅限当前工程工作区。',
  isConcurrencySafe: true,
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '按条目唯一 ID 精确检索（如 post-1725300000000-abcd）。指定 id 时 titles_only 默认自动分流为 false 以便直取正文。'
      },
      topic: {
        type: 'string',
        description: '按完整主题过滤，例如 task:audit。'
      },
      topic_prefix: {
        type: 'string',
        description: '按主题前缀过滤，例如 task:。'
      },
      tag: {
        type: 'string',
        description: '按单个标签过滤。'
      },
      active_only: {
        type: 'boolean',
        default: true,
        description: '是否仅返回未过期且未归档的活跃记录。默认为 true。'
      },
      cross_workspace: {
        type: 'boolean',
        default: false,
        description: '是否查询所有工作区的条目。默认为 false（仅当前工作区）。'
      },
      titles_only: {
        type: 'boolean',
        default: true,
        description: '是否仅返回标题与元数据摘要（不含 content 正文）。未指定 id 时默认为 true，指定 id 时默认为 false。'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20,
        description: '返回条数限制。默认 20，最大 100。'
      }
    }
  }
}
```

#### 4.3.2 Default Resolution Logic in `BoardStore.prototype.list`
```javascript
list({
  id,
  topic,
  topicPrefix,
  topic_prefix,
  tag,
  author,
  status = 'active',
  limit = 20,
  callerWorkspace,
  workspace,
  crossWorkspace = false,
  cross_workspace = false,
  titlesOnly,
  titles_only
} = {}) {
  const explicitTitlesOnly = titlesOnly !== undefined ? titlesOnly : titles_only;
  const effectiveTitlesOnly = explicitTitlesOnly !== undefined
    ? Boolean(explicitTitlesOnly)
    : (id ? false : true);

  // Exact ID matching
  if (id) {
    const targetId = String(id).trim();
    if (post.id !== targetId) continue;
  }
  ...
}
```

#### 4.3.3 Sanitized Output Structure
When `effectiveTitlesOnly === true`:
```javascript
{
  id: p.id,
  topic: p.topic,
  title: extractTitle(p),
  tags: p.tags || [],
  authorSessionId: p.authorSessionId,
  authorTitle: p.authorTitle || '',
  createdAt: p.createdAt,
  remainingMinutes: Math.ceil(Math.max(0, (p.expiresAtMs - now) / 1000) / 60),
  status: p.status,
  metadata: p.metadata || {}
  // Notice: content and remainingSeconds are completely omitted
}
```

When `effectiveTitlesOnly === false`:
```javascript
{
  id: p.id,
  topic: p.topic,
  title: extractTitle(p),
  content: p.content,
  tags: p.tags || [],
  authorSessionId: p.authorSessionId,
  authorTitle: p.authorTitle || '',
  createdAt: p.createdAt,
  remainingMinutes: Math.ceil(Math.max(0, (p.expiresAtMs - now) / 1000) / 60),
  status: p.status,
  metadata: p.metadata || {}
  // Notice: remainingSeconds is omitted
}
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Token Conservation**: Catalog queries default to lightweight title summaries, avoiding unintended full-content dumps during exploratory scans.
- **Symmetric Handoff**: Sessions receiving `session_call` with `context_post_ids` can invoke `board_list({ id: '...' })` directly to retrieve the referenced payload.
- **Prompt KV Cache Stability**: Removal of `remainingSeconds` guarantees idempotent tool output across turns within the same minute, improving prompt caching hit ratios.
- **Coercion Fix**: Resolves the `!!args.titles_only` issue where `undefined` previously mapped to `false`.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Behavioral Shift for Batch Fetching**: Callers requiring full contents for multiple posts must now explicitly set `"titles_only": false`.
  - *Mitigation*: The parameter is fully documented in `README.md`, `README_ZH.md`, and the tool description.
- **Legacy Property Removal**: Code explicitly expecting `post.remainingSeconds` will receive `undefined`.
  - *Mitigation*: Audited tests and codebase; `remainingMinutes` is preserved, and static `createdAt` / `expiresAt` provide precise timestamps.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite (`tests/board-store.test.mjs` & `tests/plugin-lifecycle.test.mjs`)
1. **Default Catalog Test**: Call `store.list()` without arguments; verify `titlesOnly === true` and `posts[0].content === undefined`.
2. **Exact ID Retrieval Test**: Call `store.list({ id: targetId })`; verify `titlesOnly === false`, `posts[0].content` contains the full payload, and `posts.length === 1`.
3. **Explicit Override Test**:
   - `store.list({ id: targetId, titlesOnly: true })` -> returns title only (`content === undefined`).
   - `store.list({ titlesOnly: false })` -> returns full content for all matched posts.
4. **Cache Invariant Test**: Assert that returned post objects do not contain `remainingSeconds`.
5. **Workspace Boundary Test with ID**: Verify that querying a foreign workspace post ID with `cross_workspace: false` returns 0 results, while `cross_workspace: true` successfully retrieves it.
6. **Tool Invocation End-to-End Test**: Execute `board_list` via `ctx.tools.get('board_list').execute(...)` across all permutations and verify Schema compliance.

### 6.2 Code Review Checklist
- [x] `index.mjs`: `parameters.properties.id` declared with clear Chinese description.
- [x] `index.mjs`: `parameters.properties.titles_only.default` set to `true`.
- [x] `index.mjs`: Argument resolution avoids boolean coercion bug (`!!undefined`).
- [x] `lib/board-store.mjs`: `list()` implements `id` filter and `effectiveTitlesOnly` intelligent branching.
- [x] `lib/board-store.mjs`: `remainingSeconds` excised from returned post records.
- [x] `types/board-store.d.ts` & `types/index.d.ts`: TypeScript contracts updated to include `id` and reflect `titlesOnly` semantics.
- [x] `README.md` & `README_ZH.md`: Parameters table, descriptions, and examples aligned.

---

## 7. Status History & Related Artifacts

- **2026-09-08**: Proposed and Accepted by Architecture Review Team.
- **Related ADRs**:
  - [ADR-0001: Separation of Concerns](./0001-separation-of-concerns-board-vs-call.md)
  - [ADR-0002: Built-in Blackboard Store](./0002-builtin-blackboard-store.md)
  - [ADR-0003: Workspace-Scoped Isolation](./0003-workspace-scoped-isolation-by-default.md)
  - [ADR-0009: Restrained Minimalist Docs](./0009-restrained-minimalist-docs-and-anti-ai-slop.md)
  - [ADR-0010: Dynamic State Mirror & KV Cache Invariant](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md)
- **Primary Code Anchors**:
  - `index.mjs`
  - `lib/board-store.mjs`
  - `types/board-store.d.ts`
  - `types/index.d.ts`
  - `README.md` / `README_ZH.md`
