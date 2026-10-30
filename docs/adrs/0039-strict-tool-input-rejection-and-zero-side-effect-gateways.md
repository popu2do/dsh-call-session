# ADR-0039: Strict Tool Input Parameter Rejection and Zero-Side-Effect Gateways

- **Status**: Accepted
- **Date**: 2026-10-30
- **Deciders**: Architect, Engineering Team
- **Consulted**: Multi-Agent Orchestrators, Runtime Ops
- **Informed**: All Plugin Users, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Root Cause
The six native tools (`board_post`, `board_list`, `board_clear`, `session_call`, `session_query`, `session_create`) accept input arguments described via JSON Schema in `lib/tools-registry.mjs`. Historically, all occurrences of `additionalProperties: false` resided exclusively on tool output schemas. Input parameter schemas omitted this constraint, allowing callers to pass undeclared or mistyped arguments without detection.

In multi-agent orchestration, an agent invoked `session_create` with an undeclared argument `cwd: "/repo/.scratch/worktrees/issue-12"` intending to pin a peer session into an isolated git worktree. Because the tool execution logic only read declared keys and the input schema lacked `additionalProperties: false`, the host silently dropped the argument. The peer session was initialized under the caller workspace root instead of the worktree, leading to concurrent mutations on the mainline checkout.

### 1.2 Architectural Forces & Constraints
- **Deterministic Failure**: Callers cannot distinguish between applied constraints and ignored constraints when unsupported parameters are silently dropped.
- **Zero Side Effects**: A rejected invocation must not leak resources, allocate titles, increment rate limits, or consume concurrent execution leases.
- **Single Source of Truth**: Hardcoded parameter whitelists risk divergence when parameters are added or renamed. The allowed parameters must derive directly from the single source of truth: the tool parameter schema.
- **Workspace Isolation Invariant**: Sessions remain bound to registered workspaces. Subdirectories and unregistered paths cannot be accepted as arbitrary working directories.

---

## 2. Decision Drivers

- Driver 1: Fail fast with standard error taxonomy `[InvalidParameter]` naming the exact offending keys.
- Driver 2: Enforce strict schema constraints `additionalProperties: false` on all native tool input definitions.
- Driver 3: Compile allowed parameter sets dynamically from schema properties to prevent maintenance divergence.
- Driver 4: Guarantee zero side effects on parameter rejection prior to entering tool business logic.

---

## 3. Considered Options

### Option 1: Strict Input Schemas Alone
Add `additionalProperties: false` exclusively to JSON Schemas and rely on the host runtime schema validator to reject unknown parameters.
- **Pros**: Minimal code footprint in the plugin.
- **Cons**: Dependent on host-level JSON Schema engine enforcement; unverified on heterogeneous host environments and fails closed if the host only validates types.

### Option 2: Pre-Validation Gate with Schema Derivation - Chosen
Declare `additionalProperties: false` on input schemas and synchronously enforce parameter constraints via `assertNoUndeclaredProperties` at tool assembly, dynamically deriving allowed parameters from `properties`.
- **Pros**: Guarantees deterministic rejection with `[InvalidParameter]` error taxonomy across all host runtimes, ensures zero side effects on quotas and leases, and avoids manual parameter whitelist duplication.
- **Cons**: Introduces a lightweight wrapper function around tool `execute`.

### Option 3: Accept cwd as a New Tool Parameter
Declare and process `cwd` in `session_create` to allow caller-specified subdirectories or worktrees.
- **Pros**: Directly accommodates subagent requests for isolated working directories.
- **Cons**: Rejected. Violates workspace isolation invariants; sessions are bound to registered workspaces, and admitting arbitrary directory paths bypasses quota tracking and workspace admission control.

---

## 4. Decision Outcome

**Chosen Option**: Option 2 - Pre-Validation Gate with Schema Derivation.

### 4.1 Core Architectural Principles & Invariants
1. **Invariant 1**: All six native tool definitions in `buildToolDefinitions` declare `additionalProperties: false` on their input parameters schema.
2. **Invariant 2**: Synchronous parameter validation executes before entering business logic, guaranteeing zero side effects on rejected calls.
3. **Invariant 3**: Allowed parameter names compile dynamically from `tool.parameters.properties` into a `Set`, eliminating scattered manual whitelists.
4. **Invariant 4**: Workspace isolation remains strictly enforced; subdirectories are rejected as invalid targets.

### 4.2 System Architecture & Topology
```
Caller Invocation (args)
           │
           ▼
┌────────────────────────────────────────┐
│ buildToolDefinitions Wrapper           │
│                                        │
│  assertNoUndeclaredProperties(args)   │
│  allowedSet = properties.keys          │
└──────────────────┬─────────────────────┘
                   │
         Pass      │      Undeclared Key
     ┌─────────────┴─────────────┐
     ▼                           ▼
┌──────────────┐        ┌───────────────────────────────┐
│ Tool Execute │        │ Throw [InvalidParameter]      │
│ (Core Logic) │        │ (Zero Side Effects Guaranteed)│
└──────────────┘        └───────────────────────────────┘
```

### 4.3 Interface & Protocol Contracts
Upon detecting any undeclared key, the tool throws an `Error` formatted as:
`[InvalidParameter] <tool_name>: undeclared parameter(s) not allowed: <keys>.`

---

## 5. Consequences

### 5.1 Positive Consequences
- Callers and subagents immediately discover typos or unsupported arguments instead of silently executing under unintended semantics.
- Security and isolation boundaries are maintained; agents cannot bypass workspace scoping via unvetted arguments.
- Dynamic derivation from `tool.parameters.properties` prevents schema-code drift.

### 5.2 Negative Consequences - Tradeoffs & Mitigations
- **Tradeoff 1**: Callers passing legacy extraneous fields that were previously ignored will receive `[InvalidParameter]` errors.
  - *Mitigation*: Callers must align their invocations with the declared schema contract.
- **Tradeoff 2**: Tool assembly wraps `execute` with a lightweight check.
  - *Mitigation*: The allowed keys are pre-compiled into a `Set` at assembly time for O(1) membership lookups.

### 5.3 Neutral & Operational Shifts
- Documentation and locale definitions explicitly reflect parameter constraints and workspace scoping.

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Unit / Contract Tests**: `tests/strict-tool-args.test.mjs` verifies that:
  - All six tools declare `additionalProperties: false` and reject unknown keys with `[InvalidParameter]`.
  - Rejection of `session_create` produces zero side effects on leases, title reservations, and created sessions.
  - Declared parameters for all six tools execute without regressions.
- **Integrity Tests**: `tests/adr-integrity.test.mjs` ensures ADR-0039 adheres to repository document naming conventions and registry indexes.

### 6.2 Code Review & Maintenance Checklist
- [x] Input schema declares `additionalProperties: false` on all native tools.
- [x] Allowed parameter keys derive dynamically from `tool.parameters.properties` without hardcoded duplicates.
- [x] Pre-validation gate executes synchronously before state mutation or resource allocation.
- [x] Tests cover rejection, zero side-effects, and declared parameter passthrough.

---

## 7. Status History & Related Artifacts

- **2026-10-30**: Proposed and accepted to address Issue #14 silent parameter drops.
- **Related ADRs**:
  - Related to: ADR-0016: Unified Parameter Naming, Session Identifier Governance, and Zero-Alias Anti-Pollution Specification
  - Related to: ADR-0023: Bilingual Localization Architecture and Standardized English Error Protocol
  - Related to: ADR-0025: Peer Session Creation Host Gateway, Safeguard Lease, and Bootstrap Decoupling
  - Related to: ADR-0036: Target Acceptance Causal Verification, Graceful Fallback Safeguards, and Structured Error Contracts
- **Implementation Artifacts**:
  - Primary source: `lib/tools-registry.mjs`
  - Localization sources: `lib/locales/en.mjs`, `lib/locales/zh.mjs`
  - Test suites: `tests/strict-tool-args.test.mjs`