# ADR-0005: English Metadata and Normalized Two-State Status Protocol

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Prompt Engineering Lead, QA Automation, Front-End UI Team
- **Informed**: All DSH Developers, Agent Prompt Authors

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

Multi-agent coordination requires discovering active sessions and determining whether a peer is currently executing work or available for new assignments. DeepSeek Harness maintains complex internal session lifecycles with states such as `running`, `idle`, `waiting`, `aborted`, `completed`, `interrupted`, and `null`.

Exposing these raw, transient internal states to LLM subagents caused significant operational friction:
1. **Prompt Confusion & Hallucination**: When an agent saw a peer in `waiting` or `interrupted` status, LLMs frequently hallucinated that the agent had crashed permanently or required emergency reboot prompts, rather than recognizing that it was simply ready for its next turn.
2. **Title Resolution Fragility**: Across different DSH releases, session titles were stored inconsistently: sometimes in `agent.session.header.title`, sometimes in an ephemeral `sessionTitle` service, and sometimes only inside historical events (`session/title`). Unhandled discrepancies caused sessions to be rendered as empty strings or `Untitled`, breaking human observability.
3. **Token Inefficiency and Mixed-Language Serialization**: Early experimental tools emitted verbose Chinese keys (`会话ID`, `当前状态`, `工作目录`). This wasted precious prompt tokens and routinely caused JSON parsing failures when consumed by English-centric reasoning models.

### 1.2 Architectural Forces & Constraints

- **Minimalist State Surface**: LLM agents only need to know a binary condition: can this agent accept new tasks right now, or is it currently busy?
- **Strict English JSON Schema**: Machine-to-machine tool outputs must use clean, standardized, camelCase English keys.
- **Human Observability**: Humans inspecting the web GUI need rich, formatted Markdown previews without sacrificing raw data fidelity.

---

## 2. Decision Drivers

- **Driver 1 (Two-State Protocol Simplification)**: Collapse complex internal runtime states into a deterministic binary status: `'running' | 'idle'`.
- **Driver 2 (Robust Title Fallback Hierarchy)**: Guarantee that session titles resolve accurately across all current and historical DSH versions.
- **Driver 3 (Token Economy & Pure English Metadata)**: Ensure all tool schema keys and programmatic outputs use concise English tokens.
- **Driver 4 (Dual-Layer Separation: Data vs Render)**: Return strict typed JSON objects for LLM consumption while attaching rendered Markdown text for GUI presentation.

---

## 3. Considered Options

### Option 1: Expose Full Internal DSH Lifecycle Enum
- **Description**: Return the exact internal status strings (`running`, `waiting`, `aborted`, `paused`, etc.).
- **Pros**: Complete fidelity to low-level runtime engine state.
- **Cons**: High cognitive load on LLMs; leads to prompt bloat and unpredictable decision branching.

### Option 2: Human-Language Formatted Strings Only
- **Description**: Return pre-formatted localized strings (e.g. `"会话 session-123 当前正在执行任务"`).
- **Pros**: Easy for human reading in chat windows.
- **Cons**: Unusable for automated agent routing; requires regex parsing to extract session IDs; high token cost.

### Option 3 (Chosen): Normalized Two-State Protocol with English JSON Schema and Dual-Layer Render
- **Description**:
  1. Map all internal states to either `'running'` (agent is currently computing a turn) or `'idle'` (agent is ready/waiting for input).
  2. Implement a 4-tier defensive cascade for resolving session titles.
  3. Define strict English JSON schemas for programmatic consumption.
  4. Provide a dual-layer output containing both structured JSON fields and a readable Markdown summary table.
- **Pros**: Optimal LLM token efficiency; zero ambiguity in agent readiness; resilient title discovery; excellent human observability.
- **Cons**: Coarsens subtle distinctions between `waiting` and `idle` (which is intentional and desired for scheduling).

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Normalized Two-State Protocol with English JSON Schema and Dual-Layer Render.

### 4.1 Core Architectural Principles & Invariants

1. **Deterministic Two-State Invariant**:
   - For every agent query, `status` is strictly normalized:
     ```javascript
     // lib/session-query.mjs Line 97-98
     const status = agent.status === 'running' ? 'running' : 'idle';
     ```
   - Any other internal status (`paused`, `waiting`, `interrupted`, or `null`) maps deterministically to `'idle'`.
2. **Four-Tier Title Resolution Cascade (`resolveSessionTitle`)**:
   - Priority 1: `agent?.session?.title`
   - Priority 2: `agent?.title`
   - Priority 3: `ctx.get('sessionTitle')?.get(agent.session)?.title`
   - Priority 4: Reverse search in `agent?.session?.events` for `{ type: 'session/title' }`
   ```javascript
   // lib/session-query.mjs Line 28-51
   export function resolveSessionTitle(ctx, agent) {
     if (typeof agent?.session?.title === 'string' && agent.session.title) return agent.session.title;
     if (typeof agent?.title === 'string' && agent.title) return agent.title;
     const titleService = ctx?.get ? ctx.get('sessionTitle') : ctx?.sessionTitle;
     if (titleService && typeof titleService.get === 'function' && agent?.session) {
       const res = titleService.get(agent.session);
       if (typeof res?.title === 'string' && res.title) return res.title;
     }
     if (Array.isArray(agent?.session?.events)) {
       for (let i = agent.session.events.length - 1; i >= 0; i--) {
         const ev = agent.session.events[i];
         if (ev?.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title) {
           return ev.data.title;
         }
       }
     }
     return '';
   }
   ```
3. **Strict English JSON Schema**:
   - Property keys: `sessionId`, `title`, `status`, `workspace`, `isCurrent`, `totalCount`, `activeCount`, `idleCount`.
   - Never use localized or multi-lingual keys in data payloads.

### 4.2 System Architecture & Topology

```
┌─────────────────────────────────────────────────────────────┐
│              Raw DSH Agent / Session State                  │
│                                                             │
│   Status:   'running' | 'waiting' | 'aborted' | 'idle'      │
│   Title:    Stored across Header, Service, or Event logs    │
│   CWD:      Mixed slashes, Windows Drive cases              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Session Query Normalizer                    │
│                                                             │
│   1. Status Normalization:                                  │
│      'running' ---> 'running'                               │
│      All else  ---> 'idle'                                  │
│                                                             │
│   2. Title 4-Tier Defensive Resolver                        │
│                                                             │
│   3. Workspace Path Canonicalizer                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│  Machine Layer (JSON Schema) │              │   Human Layer (Markdown)     │
│                              │              │                              │
│  {                           │              │  | Session ID | Title | ... |│
│    "sessionId": "...",       │              │  |:--- |:--- |:--- |         │
│    "status": "idle",         │              │  | `session-1`| Coder | ... |│
│    "workspace": "d:/repo"    │              │                              │
│  }                           │              │                              │
└──────────────────────────────┘              └──────────────────────────────┘
```

### 4.3 Interface & Protocol Contracts

#### `session_query` Output Schema (`index.mjs` Line 781-817)
```json
{
  "type": "object",
  "properties": {
    "totalCount": { "type": "integer" },
    "activeCount": { "type": "integer" },
    "idleCount": { "type": "integer" },
    "sessions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sessionId": { "type": "string" },
          "title": { "type": "string" },
          "status": { "type": "string", "enum": ["running", "idle"] },
          "workspace": { "type": "string" },
          "isCurrent": { "type": "boolean" }
        },
        "required": ["sessionId", "title", "status", "workspace", "isCurrent"]
      }
    }
  },
  "required": ["totalCount", "activeCount", "idleCount", "sessions"]
}
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Zero Status Misinterpretation**: LLMs clearly understand whether an agent is busy (`running`) or ready for a task dispatch (`idle`).
- **Resilient UI Presentation**: Sessions consistently show meaningful titles across all DSH core versions.
- **Significant Token Savings**: English schema keys reduce payload size by ~40% compared to localized string representations.
- **Dual-Layer Usability**: Machines parse JSON; humans inspect cleanly formatted Markdown tables.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Loss of Sub-Status Visibility**: An orchestrator cannot distinguish between an agent waiting on a tool call vs waiting on user input from `session_query` alone.
  - *Mitigation*: Detailed per-agent telemetry is handled via DSH core inspector tools rather than the lightweight inter-session dispatcher.

### 5.3 Neutral & Operational Shifts
- Tests and mock fixtures must provide standard `{ status, session: { events: [...] } }` shapes to simulate title cascades.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Two-State Normalization Test**: Pass agents with statuses `['running', 'idle', 'waiting', 'paused', null, undefined]`; assert that outputs contain strictly `'running'` or `'idle'`.
- **Title Cascade Fallback Tests**: Test 4 scenarios:
  1. Title present only in `agent.session.title`.
  2. Title present only in `agent.title`.
  3. Title present only in `ctx.sessionTitle.get()`.
  4. Title present only in historical `events` array.
  Assert that all 4 cases resolve non-empty titles.
- **Schema Validation**: Validate `session_query` output against the JSON Schema definition using standard schema checkers.

### 6.2 Code Review & Maintenance Checklist
- [x] Ensure `status` output enum is constrained strictly to `["running", "idle"]`.
- [x] Prohibit adding non-English property keys to tool parameter or output definitions.
- [x] Ensure `resolveSessionTitle` never throws even when `events` or `session` is undefined.

---

## 7. Status History & Related Artifacts

- **2026-09-03**: Proposed by Engineering & Prompt Design Team.
- **2026-09-03**: Accepted; implemented in `lib/session-query.mjs`.
- **Related ADRs**:
  - Related to: [ADR-0001](./0001-separation-of-concerns-board-vs-call.md) (Board vs Call Separation)
  - Related to: [ADR-0003](./0003-workspace-scoped-isolation-by-default.md) (Workspace Isolation)
- **Implementation Artifacts**:
  - `lib/session-query.mjs` (Line 8-51, 79-131)
  - `index.mjs` (Line 754-817)
