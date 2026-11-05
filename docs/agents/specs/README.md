# Tickets: #20 Call Type Refactoring & Report Obligation (rewrite)

Baseline: `main @ 6a156a0`. All tickets land on `feat/20-report-obligation`.
Spec: `docs/specs/0020-call-type-refactoring-and-report-obligation.md`.

Order: **A, D, F** (parallel) → **B** (probe) → **C** (depends on B's finding) → **G**.
Do not start C before B's runtime evidence is recorded in `docs/agents/evidence/`.

| Ticket | Subject | Deps |
| --- | --- | --- |
| T-A | Single source of truth for call types; header reports the real type | — |
| T-D | Pending task ledger: record on delivery, FIFO settle, archive cascade, context injection | — |
| T-F | Canvas: active/settled edges, hard vs soft distinction, zh/en copy | — |
| T-B | Runtime probe: does the host actually dispatch `agent/turn-stopping`? | — |
| T-C | Turn-stopping guard: resolve session from payload, honour abort, per-turn budget | T-B |
| T-G | Docs: new ADR, CONTEXT.md vocabulary, CHANGELOG breaking change, legacy ADR wording | T-A..T-F |
