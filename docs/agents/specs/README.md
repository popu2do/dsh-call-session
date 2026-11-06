# Tickets: #20 Call Type Refactoring & Report Obligation (rewrite)

Baseline: `main @ 6a156a0`. All tickets landed on `feat/20-report-obligation`, since squashed into `main`.
Spec: issue #20 的正文（ADR-0042 记录被采纳的决策），实机取证见 `docs/agents/evidence/0020-turn-stopping.md`。

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
