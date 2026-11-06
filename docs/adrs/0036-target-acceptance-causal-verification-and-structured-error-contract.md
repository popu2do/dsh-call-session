<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0036: Target Acceptance Causal Verification, Graceful Fallback Safeguards, and Structured Error Contracts

- **Status**: Accepted
- **Date**: 2026-10-20
- **Deciders**: Architect, Engineering Team, Security Reviewer
- **Consulted**: Runtime Ops, Agent Developers, Multi-Agent Orchestrators
- **Informed**: All DSH Developers
- **Supersedes**: Partially amends and evolves ADR-0031
- **Evolved by**: ADR-0038

---

## 1. Context and Problem Statement

### 1.1 Background & Root Cause
In DSH multi-agent environments, `session_call` and `session_create` rely on handshake verification introduced in ADR-0031. During live production operations, a fatal prompt assembly failure where prompt variable model has no value for this assembly in session `session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7` escaped undetected. The tool returned `success: true`, `deliveryState: 'delivered'`, and misleadingly declared that the task was running with no need to poll, causing the calling agent to enter permanent deadlock.

The subsequent investigation identified the physical root causes:
1. **Phase Synchronization Asynchrony**: In DSH agent loop, the driver synchronously sets `phase.kind = 'running'` at t=0ms upon receiving a followup call, whereas asynchronous system prompt assembly in `preStep` requires 100ms to 300ms.
2. **False Stability Heuristic**: A 40ms threshold in dispatch paths exited prematurely before prompt assembly completed.
3. **Graceful Degradation Pitfall**: Unconfirmed timeouts were marked `success: true` and rendered with "no need to poll" convergence assertions.
4. **Adversarial Blindspots**: Targets already running trigger false positive confirmations at t=0ms; step 0 crashes leave zombie sessions blocking title retries; and dead targets cause task report blocking deadlocks.

---

## 2. Decision Drivers

- Driver 1: Deterministic causal execution verification eliminating false positive running assertions.
- Driver 2: Penetrating prompt assembly and runtime error capture with structured error taxonomy.
- Driver 3: Zombie session tombstone clearance preventing duplicate title retry lockouts.
- Driver 4: Task report dead-letter fallback preventing cluster deadlocks when caller crashes.
- Driver 5: Two-layer success schema decoupling mailbox enqueue from execution proof, with truthful convergence wording.

---

## 3. Decision Outcome

### 3.1 Core Invariants & Architecture Principles

#### Invariant 1: Causal Physical Execution Proof
The 40ms threshold is permanently abolished. Verification must prove causal transition into physical inference based on target pre-call state:
- **Idle Target**: Physical confirmation requires either `targetAgent.phase?.kind === 'running' && targetAgent.phase?.step >= 1`, or a new `step/start` event in `targetAgent.session.events` matching the current turn.
- **Already Running Target**: `phase.step >= 1` is already true at t=0ms. The probe must verify causal consumption of the specific dispatched message: either the message has been claimed from the next step queue and step incremented, or turn has progressed. If unconsumed within the wait budget, it converges strictly to `deliveryState: 'enqueued'`, `executionState: 'pending'`.

#### Invariant 2: Pre-flight Health Probing & Zombie Tombstone Clearance
- When target is in error status, notice and zero-wait task dispatch calls are immediately rejected with `PREFLIGHT_TARGET_IN_ERROR`.
- When session creation encounters a step 0 crash, admission lease rolls back and the unstarted agent is cleanly unregistered or tombstoned so that duplicate title checks do not block subsequent retries with corrected parameters.

#### Invariant 3: Task Report Fallback to Public Blackboard
When call type is task report targeting a session in error status, the dispatch tool does not fail-fast or crash the reporting worker. Instead, the report payload is automatically deposited onto the public blackboard under topic `report:fallback` with caller metadata. The tool returns `deliveryState: 'delivered'`, `fallbackPostId`, and `targetStatus: 'error'`, freeing the worker from deadlock.

#### Invariant 4: Two-Layer Success Schema & Truthful Convergence Wording
- `success: boolean` reflects valid message delivery into the target process mailbox.
- `executionState: 'running' | 'pending' | 'crashed' | 'unverified'` reflects physical execution status.
- When execution state is pending, convergence wording explicitly informs the caller that execution is unconfirmed and advises checking session query later. Misleading phrases asserting "no need to poll" are strictly prohibited.

#### Invariant 5: Structured Error Taxonomy & Lossless Preservation
All turn and pre-step errors are parsed into standardized uppercase snake_case codes. Raw error messages and stacks are preserved losslessly in `error.details`.

```
[ Error Categories ]
- PREFLIGHT_* : Target lookup, status health, parameter validation
- DISPATCH_*  : Process-level memory mailbox enqueue failure
- ASSEMBLY_*  : System prompt assembly, template variables, model binding
- RUNTIME_*   : Turn execution, tool initialization, runner crash
- TIMEOUT_*   : Handshake wait window expired while pending
```

---

## 4. Contract Specification

```typescript
export interface SessionErrorDetails {
  code: string;
  category: 'PREFLIGHT' | 'DISPATCH' | 'ASSEMBLY' | 'RUNTIME' | 'TIMEOUT';
  message: string;
  fatal: boolean;
  details?: Record<string, unknown>;
}

export interface SessionCallResult {
  success: boolean;
  targetSessionId?: string;
  targetTitle?: string;
  targetStatus?: 'running' | 'idle' | 'error';
  deliveryState?: 'delivered' | 'enqueued' | 'failed';
  executionState?: 'running' | 'pending' | 'crashed' | 'unverified';
  deliveryMode?: 'steer' | 'followup';
  callType?: string;
  callerSessionId?: string;
  contextPostIds?: string[];
  fallbackPostId?: string | null;
  error?: SessionErrorDetails | null;
  message?: string;
}
```

---

## 5. Consequences

- **Positive**: Eliminates blind spots for prompt assembly crashes; removes false positive running assertions; guarantees resilience against cluster deadlocks; preserves error details for calling models.
- **Tradeoff**: Calls to busy running targets may take up to the configured wait budget before returning pending if not immediately claimed. This reflects physical reality.

---

## 6. Status History & Related Artifacts

- **2026-10-20**: Accepted.
- **Amends**: ADR-0031 (Verification Heuristics and Convergence Wording).
- **Evolved by**: [ADR-0038](./0038-cold-resume-model-inheritance.md) (Resolves prompt assembly failure root cause for cold resume targets).
- **Related to**: ADR-0001, ADR-0003, ADR-0006, ADR-0010, ADR-0016, ADR-0021, ADR-0025, ADR-0028, ADR-0029, ADR-0031, ADR-0032, ADR-0038.
