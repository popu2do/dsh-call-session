# ADR-0001: Separation of Concerns - Pull-based Public Board vs Push-based Strict Unicast Call

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: QA Engineer, Multi-Agent Runtime Ops, Community Users
- **Informed**: All Plugin Users, Downstream Subagents, Session Orchestrators

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points

In multi-agent collaborative workflows orchestrated by DeepSeek Harness (DSH), autonomous subagents frequently require two distinct modes of communication:
1. **Shared State / Asynchronous Hand-off**: Exchanging context, task dependencies, audit reports, and design artifacts without demanding an immediate reaction.
2. **Direct Notification / Unicast Dispatch**: Requesting a specific agent or peer session to take immediate action, review a pull request, or resume an in-flight operation.

Historically, multi-agent frameworks often conflate these two communication paradigms into a single monolithic messaging bus or reactive event pub/sub mechanism. In our initial iterations and legacy MCP setups, publishing a status update or milestone entity to shared memory automatically dispatched notifications or triggered regex-based listeners across the runtime.

This architectural coupling produced severe operational failures in production:
- **Notification Storms ("All-Hands Awakening")**: When an agent published a progress update or intermediate milestone, every active session received an unsolicited event or prompt, causing all agents to wake up simultaneously.
- **Context Poisoning & Token Drain**: Unrelated agents had their LLM context windows flooded with irrelevant task notices, degrading reasoning quality and multiplying API token expenditures exponentially.
- **Deadlocks and Contention**: Agents competing to acknowledge broadcast messages entered infinite ping-pong loops or triggered conflicting responses.
- **Self-Loop Whispers**: Agents posting task updates frequently matched their own outbound broadcast hooks, waking themselves up in a recursive, self-referential hallucination loop.

### 1.2 Architectural Forces & Constraints

- **Strict Separation of Storage and Notification**: Reading or writing state must not trigger ambient cognitive load on passive observers.
- **Deterministic Routing**: Every active wake-up must target exactly one valid session receiver.
- **Zero Ambiguity**: Prefix matching on session identifiers must prevent false positives or collisions.
- **Resource Discipline**: Unicast dispatches must carry structured attribution, intent semantics, and bounded payload sizes.

---

## 2. Decision Drivers

- **Driver 1 (Eliminate Notification Storms)**: Guarantee that publishing state or announcements to shared memory has zero side-effects on session execution queues.
- **Driver 2 (Precision Unicast Delivery)**: Provide an explicit point-to-point wake-up mechanism with fail-fast validation against broadcast wildcards and ambiguity.
- **Driver 3 (Anti-Recursion / Loop Prevention)**: Prevent agents from invoking or waking themselves via communication primitives.
- **Driver 4 (Traceable Cross-Session Lineage)**: Link asynchronous state posts (`postId`) directly to downstream notifications via explicit reference arrays (`context_post_ids`).

---

## 3. Considered Options

### Option 1: Monolithic Reactive Event Bus (Status Quo)
- **Description**: Single channel where all state changes emit global events. Agents register filters to decide whether to consume or react.
- **Pros**: Easy to implement; mimics classical event-driven buses.
- **Cons**: High cognitive load on LLMs; filter false-positives wake up wrong agents; massive token wastage; non-deterministic execution order.

### Option 2: Polling-Only Architecture (Pure Black-Board)
- **Description**: Shared board only; eliminate all push notifications. Agents must periodically query `board_list` to discover assigned tasks or status updates.
- **Pros**: Zero unexpected wakeups; minimal complexity in message routing.
- **Cons**: High latency for interactive agent handoffs; excessive token and compute waste on continuous busy-polling; cannot support real-time team coordination.

### Option 3 (Chosen): Explicit Dual-Domain Separation — Pull Board vs Push Unicast
- **Description**: Two completely independent domains:
  1. **Board Domain (Pull)**: `board_post`, `board_list`, `board_clear` — dedicated to passive state storage with guaranteed zero wake-up side-effects.
  2. **Call Domain (Push)**: `session_call` — dedicated to strict, single-target unicast notifications with anti-ambiguity fuses, minimum prefix constraints, and self-loop guards.
- **Pros**: Clean conceptual model; eliminates broadcast cascades; predictable cost and deterministic dispatch semantics.
- **Cons**: Senders must invoke two tools if they wish to publish state AND notify a peer (post first to obtain `postId`, then call target with `context_post_ids`). This is an intentional, beneficial constraint.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Explicit Dual-Domain Separation.

### 4.1 Core Architectural Principles & Invariants

1. **Board Domain Zero-Wakeup Invariant**:
   - Calling `board_post`, `board_list`, or `board_clear` shall **never** trigger `session.prompt`, `agent.followup`, HTTP steer webhooks, or any synthetic LLM turn on any session.
   - The board acts strictly as passive memory (pull model).
2. **Strict Unicast Invariant**:
   - `session_call` requires a concrete `target_session_id`.
   - Wildcards such as `*`, `all`, `broadcast`, or empty strings are rejected with immediate failure (`DISPATCHER_CONSTANTS.TARGET_WILDCARDS`).
3. **Anti-Ambiguity Fuse**:
   - Target session prefix matching requires a minimum length of 8 characters (`DISPATCHER_CONSTANTS.LIMITS.MIN_PREFIX_LENGTH = 8`).
   - If a prefix resolves to more than one active session, the dispatch aborts immediately with an ambiguous resolution error, listing colliding candidates.
4. **Self-Call Guard**:
   - An agent is strictly forbidden from calling its own `callerSessionId`. Self-directed calls throw `DispatchError: Self-call prohibited`.

### 4.2 System Architecture & Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DSH Multi-Agent Environment                         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
       ┌─────────────────────────────┴─────────────────────────────┐
       │                                                           │
       ▼ [PULL DOMAIN: Passive State]                              ▼ [PUSH DOMAIN: Active Notification]
┌─────────────────────────────────────────┐                 ┌─────────────────────────────────────────┐
│              Board Domain               │                 │               Call Domain               │
│                                         │                 │                                         │
│   • board_post(topic, content, ...)     │                 │   • session_call(target, message, ...)  │
│   • board_list(topic, tags, ...)        │                 │   • session_query(status, filter)       │
│   • board_clear(post_id, topic)         │                 │                                         │
│                                         │                 │   Guards:                               │
│   Guarantees:                           │                 │   - Minimum prefix length >= 8          │
│   - In-memory atomic state              │                 │   - No wildcards (*, all, broadcast)    │
│   - Zero wakeup side-effects            │                 │   - Anti-ambiguity collision fuse       │
│   - Clean query isolation               │                 │   - Self-call rejection                 │
└───────────────────┬─────────────────────┘                 └───────────────────┬─────────────────────┘
                    │                                                           │
                    ▼                                                           ▼
         ┌──────────────────────┐                                    ┌──────────────────────┐
         │  board.json (.bak)   │                                    │ Target Agent Session │
         │  (Atomic Store)      │                                    │ (Native Direct Steer)│
         └──────────────────────┘                                    └──────────────────────┘
```

### 4.3 Interface & Protocol Contracts

#### Board Domain Tools (`index.mjs`)
- `board_post({ topic: string, content: string, tags?: string[], ttl?: number, metadata?: object }) => { success: boolean, postId: string, topic: string, ... }`
- `board_list({ topic?: string, tags?: string[], authorSessionId?: string, cross_workspace?: boolean, ... }) => { count: number, posts: object[] }`
- `board_clear({ id?: string, topic?: string, callerWorkspace?: string }) => { success: boolean, clearedCount: number, message: string }`

#### Call Domain Tool (`index.mjs` & `lib/session-call.mjs`)
- `session_call({ target_session_id: string, message: string, call_type?: "task_dispatch" | "task_report" | "notice", context_post_ids?: string[] }) => { success: boolean, targetSessionId: string, deliveredChannels: string[], noticeText: string }`

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Eliminated Cascading Token Costs**: Eradicated spurious agent wakeups; token consumption during multi-agent collaboration reduced to purposeful interactions.
- **Deterministic Workflows**: Multi-step orchestrations can reliably await subagent completion through point-to-point task dispatches and structured `task_report` replies.
- **Clear Separation of Concerns**: Developers and LLMs understand intuitively whether an action publishes durable state or requests an immediate turn.

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Two-Step Publishing for Notifications**: If an agent must post 10KB of audit data and notify the lead, it must call `board_post` first to get a `postId`, then call `session_call` with `context_post_ids: [postId]`.
  - *Mitigation*: The `session_call` prompt template automatically instructs the recipient to read `board_list(cross_workspace=true)` for referenced post IDs.
- **Stricter Prefix Requirements**: Users cannot pass 4-character shorthand session IDs.
  - *Mitigation*: The 8-character floor completely eliminates collision hazards in high-concurrency environments.

### 5.3 Neutral & Operational Shifts
- Agents must be instructed in system prompts to check the board when referenced via `context_post_ids`, rather than expecting complete payload dumps inside unicast notification messages.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Zero-Wakeup Verification**: Contract tests assert that after calling `board_post`, `ctx.agents` triggers 0 events on unrelated sessions.
- **Wildcard Rejection Tests**: Calling `session_call` with `*`, `all`, or empty string throws an invalid parameter error.
- **Prefix Collision Tests**: Mocking two sessions with prefix `session-abc...` confirms that calling `session_call("session-abc")` halts and returns candidate collision diagnostics.
- **Self-Call Tests**: Attempting `session_call` targeting the caller's own session ID throws an explicit self-call exception.

### 6.2 Code Review & Maintenance Checklist
- [x] All Board Domain tools (`board_*`) must not access agent messaging or prompt APIs.
- [x] All Call Domain tools (`session_call`) must validate target arguments against `DISPATCHER_CONSTANTS.TARGET_WILDCARDS`.
- [x] Target resolution must invoke `DISPATCHER_CONSTANTS.LIMITS.MIN_PREFIX_LENGTH` check before matching.

---

## 7. Status History & Related Artifacts

- **2026-09-03**: Proposed by Architecture Team.
- **2026-09-03**: Accepted after multi-agent stress testing on DSH v3.5.
- **Related ADRs**:
  - Related to: [ADR-0002](./0002-builtin-blackboard-store.md) (Built-in Blackboard State Store)
  - Related to: [ADR-0003](./0003-workspace-scoped-isolation-by-default.md) (Workspace Isolation)
- **Implementation Artifacts**:
  - Primary source: `index.mjs` (Line 376-750)
  - Call routing: `lib/session-call.mjs` (Line 20, 80-140)
