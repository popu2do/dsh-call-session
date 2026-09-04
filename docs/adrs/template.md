# ADR-XXXX: [Short, Imperative Title Summarizing the Decision]

- **Status**: [Proposed | Accepted | Deprecated | Superseded by ADR-YYYY]
- **Date**: YYYY-MM-DD
- **Deciders**: [Architect, Engineering Team, Core Contributors]
- **Consulted**: [QA, Operations, Community]
- **Informed**: [All Plugin Users, Downstream Subagents]

---

## 1. Context and Problem Statement

<!--
What is the problem we are trying to solve?
What is the background, context, and operational pain points that triggered this decision?
What forces, constraints, and requirements must be considered?
-->

### 1.1 Background & Pain Points
[Describe what existed before, why it failed or caused friction, and the specific failure modes observed in production.]

### 1.2 Architectural Forces & Constraints
- **Performance & Latency**: [Constraints on response time, memory, disk I/O]
- **Reliability & Fault Tolerance**: [Resilience to crashes, lock contention, corrupted state]
- **Developer Experience & Agent Usability**: [Token cost, cognitive load, clarity of tool contracts]
- **Ecosystem & Lifecycle Alignment**: [Alignment with DSH/Cordis paradigms]

---

## 2. Decision Drivers

- Driver 1: [Primary driver, e.g. Eliminating unwanted agent wakeups and notification storms]
- Driver 2: [Secondary driver, e.g. Self-contained zero-dependency plugin architecture]
- Driver 3: [e.g. Robust cross-platform concurrency on Windows and POSIX systems]
- Driver 4: [e.g. Strict boundary isolation across multi-workspace setups]

---

## 3. Considered Options

### Option 1: [Name of Rejected Option 1]
- **Description**: [Summary of option]
- **Pros**: [What was good about it]
- **Cons**: [Why it was ultimately rejected]

### Option 2: [Name of Rejected Option 2]
- **Description**: [Summary of option]
- **Pros**: [What was good about it]
- **Cons**: [Why it was ultimately rejected]

### Option 3 (Chosen): [Name of Chosen Architecture]
- **Description**: [Summary of chosen solution]
- **Pros**: [Decisive advantages]
- **Cons**: [Accepted tradeoffs]

---

## 4. Decision Outcome

<!--
What is the exact decision made?
State the chosen direction clearly in active voice: "We will..." or "We decided to..."
Include structural boundaries, interfaces, contracts, and flow diagrams.
-->

**Chosen Option**: Option 3 — [Name of Solution].

### 4.1 Core Architectural Principles & Invariants
1. **Invariant 1**: [Explicit rule, e.g. Zero-wakeup side effect on public board operations]
2. **Invariant 2**: [Explicit rule, e.g. Mandatory unicast target with anti-ambiguity fuse]
3. **Invariant 3**: [Explicit rule, e.g. Normalized two-state status lifecycle]

### 4.2 System Architecture & Topology
```
[Ascii or Mermaid Diagram showing component interactions, data flows, and boundaries]
```

### 4.3 Interface & Protocol Contracts
[Specific tool definitions, parameters, JSON schemas, and return formats]

---

## 5. Consequences

<!--
What becomes easier or safer? What becomes harder?
List positive, negative (tradeoffs), and neutral consequences.
-->

### 5.1 Positive Consequences (Benefits)
- **Benefit 1**: [Description]
- **Benefit 2**: [Description]
- **Benefit 3**: [Description]

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **Tradeoff 1**: [Description]
  - *Mitigation*: [How we address or reduce this downside]
- **Tradeoff 2**: [Description]
  - *Mitigation*: [How we address or reduce this downside]

### 5.3 Neutral & Operational Shifts
- [Impacts on development habits, logging, telemetry, or documentation]

---

## 6. Compliance, Validation & Verification

<!--
How do we know this decision is being followed?
What automated tests, lint rules, runtime assertions, or code review checklists enforce it?
-->

### 6.1 Automated Verification Suite
- **Unit / Contract Tests**: [Specific test cases or suites that verify this ADR]
- **Integration / Smoke Tests**: [End-to-end verification]
- **Fault Injection / Boundary Tests**: [Simulated failures, bad blocks, lock contention]

### 6.2 Code Review & Maintenance Checklist
- [ ] Checklist item 1
- [ ] Checklist item 2
- [ ] Checklist item 3

---

## 7. Status History & Related Artifacts

- **YYYY-MM-DD**: Proposed by [Role/Person]
- **YYYY-MM-DD**: Accepted following team review
- **Related ADRs**:
  - Supersedes: None / [ADR-XXXX]
  - Related to: [ADR-YYYY], [ADR-ZZZZ]
- **Implementation Artifacts**:
  - Primary source: `[path/to/source.mjs]`
  - Test suites: `[path/to/test.mjs]`
