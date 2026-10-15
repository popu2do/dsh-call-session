# ADR-0031: Cross-Session Handshake Verification, Classified Wait Contracts, and Native 3-State Status Protocol

- **Status**: Accepted
- **Date**: 2026-10-18
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Plugin Developers, Runtime Ops, Agent Authors
- **Informed**: All DSH Developers, Multi-Agent Orchestrators

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
In multi-agent collaborative environments within DeepSeek Harness, calling sessions invoke `session_create` and `session_call` to dispatch tasks. Historically, under ADR-0005 and ADR-0006, unicast dispatch called in-memory `agent.followup` or `agent.steer`, both of which immediately return `void` after queuing into memory. Tools immediately responded to the calling LLM with `success: true` and optimistic `status: 'running'`.

This design caused severe failures during runtime instability and plugin development:
1. **False Execution Guarantees**: Calling LLMs conflated queue delivery with physical inference. When peer agents failed on step 0 due to plugin exceptions or context limits, calling agents hallucinated that work was actively progressing.
2. **Crash Blindness**: DSH agent-loop catches unhandled turn errors, writes a `turn/end error` event, and resets the target agent to `idle`. Calling agents received no signal or error return.
3. **Status Masking**: Under ADR-0005, all non-running agents were collapsed to `idle`. Probing with `session_query` returned `idle`, indistinguishable from healthy readiness.

### 1.2 Architectural Forces & Constraints
- **Zero-Invasion Invariant**: State verification must use DSH native runtime surfaces (`agent.phase` and `session.events`) without daemon processes or monkey-patches.
- **Latency Budget**: Handshake waits must be bounded within 300ms, fail-fast on startup crashes, and avoid blocking LLM tool calls.
- **Strict Boundary Isolation**: Session failures must be contained within the affected session; no error pollution on the public blackboard or unconstrained reverse wake-ups.

---

## 2. Decision Drivers

- Driver 1: Fail-fast interception of startup and plugin crashes within milliseconds.
- Driver 2: Truthful return schemas separating mailbox enqueueing from physical execution verification.
- Driver 3: DSH native 3-state resolution (`running | idle | error`) with natural event-stream self-healing.
- Driver 4: Classified wait contracts preventing non-critical calls from blocking.

---

## 3. Considered Options

### Option 1: Status Quo (Fire-and-Forget + Two-State Status)
- Pros: Zero latency.
- Cons: Hides crashes; LLM misreports success; unviable under unstable environments.

### Option 2: Active Reverse Alarm via Public Blackboard or Push Notice
- Pros: Immediate notification to callers.
- Cons: Pollutes public blackboard; reverse wake-ups trigger cascading alarm storms.

### Option 3 (Chosen): Classified Lightweight Handshake + Native 3-State Protocol
- Pros: Catches early crashes in under 50ms; native event derivation self-heals on subsequent successful turns; zero blackboard pollution.
- Cons: Introduces a bounded 300ms light wait on task dispatch.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Classified Lightweight Handshake + Native 3-State Protocol.

### 4.1 Core Architectural Principles & Invariants
1. **Classified Wait Contract**: `session_create` and `session_call(task_dispatch)` wait up to 300ms for physical execution confirmation; `task_report` and `notice` return immediately with zero wait.
2. **Native 3-State Status**: Status resolves to `running`, `idle`, or `error`. When idle, the latest `turn/end` event in `session.events` determines if an error occurred.
3. **Natural Event-Stream Healing**: If an errored session later completes a normal turn, the new normal event naturally supersedes the error without manual cleanup.
4. **Decoupled Delivery Semantics**: Return payloads replace false `running` with explicit `deliveryState` and `executionState`.

### 4.2 System Architecture & Topology
```
Caller Tool Call (task_dispatch)
  │
  ├─► Enqueue to targetAgent.inbox & trigger wakeDriver()
  │
  └─► Handshake Monitor (300ms window)
        │
        ├─► [Target crashes within window]
        │     Latest turn/end has reason.kind === 'error'
        │     ──► Fail-fast return: { success: false, executionState: 'crashed', error }
        │
        ├─► [Target phase.kind === 'running']
        │     ──► Confirmed return: { success: true, executionState: 'running' }
        │
        └─► [Timeout expires while queued]
              ──► Downgraded return: { success: true, deliveryState: 'enqueued', executionState: 'pending' }
```

### 4.3 Interface & Protocol Contracts
- `deliveryState`: `'delivered' | 'enqueued' | 'failed'`
- `executionState`: `'running' | 'pending' | 'crashed' | 'unverified'`
- `status`: `'running' | 'idle' | 'error'`
- `error`: `{ message: string, code?: string } | null`

---

## 5. Consequences

### 5.1 Positive Consequences
- Intercepts plugin and startup crashes in under 50ms.
- LLMs receive truthful execution proofs and stop hallucinating false progress.
- Status queries expose actionable error summaries directly from DSH native logs.

### 5.2 Negative Consequences & Mitigations
- *Tradeoff*: Task dispatch adds up to 300ms light wait.
  - *Mitigation*: Non-critical calls (notice, task_report) remain non-blocking (0ms); wait duration is configurable via `wait_ms`.

---

## 6. Compliance & Validation

- Unit and contract tests in `tests/session-call.test.mjs`, `tests/session-create.test.mjs`, and `tests/session-directory.test.mjs`.
- Prototype verification benchmark in `.scratch/prototypes/handshake-verification-prototype.mjs`.

---

## 7. Status History & Related Artifacts

- **2026-10-18**: Accepted.
- **Supersedes**: ADR-0005 (Normalized Two-State Status Protocol).
- **Related to**: ADR-0001, ADR-0006, ADR-0010, ADR-0016, ADR-0023, ADR-0025, ADR-0029.
