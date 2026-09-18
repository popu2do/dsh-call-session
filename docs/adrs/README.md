# Architecture Decision Records (ADRs)

This directory contains the formal **Architecture Decision Records (ADRs)** for `dsh-call-session`, structured according to standard Architecture Decision Records (ADRs).

## What is an ADR?

An Architecture Decision Record (ADR) captures a significant architectural decision along with its context, considered options, consequences, and verification criteria.

## ADR Lifecycle & Statuses

ADRs transition through the following states:

- **Proposed**: Under active design review or discussion.
- **Accepted**: Approved and actively enforced in the codebase.
- **Deprecated**: Formally retired because the feature is no longer supported.
- **Superseded**: Replaced by a newer architectural decision (linked via `Superseded by ADR-YYYY`).

```
[ Proposed ] ---> [ Accepted ] ──┬---> [ Deprecated ]
                                 └──-> [ Superseded by ADR-YYYY ]
```

---

## Architectural Decision Matrix

| ID | Title | Status | Date | Primary Code Anchors | Document Links |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0001** | Separation of Concerns: Pull-based Public Board vs Push-based Strict Unicast Call | **Accepted** *(Transport superseded by ADR-0006)* | 2026-09-03 | `index.mjs`, `lib/session-call.mjs` | [0001-separation-of-concerns-board-vs-call.md](./0001-separation-of-concerns-board-vs-call.md) |
| **ADR-0002** | Built-in Blackboard State Store (Zero External Dep) | **Accepted** | 2026-09-03 | `index.mjs`, `lib/board-store.mjs` | [0002-builtin-blackboard-store.md](./0002-builtin-blackboard-store.md) |
| **ADR-0003** | Workspace-Scoped Isolation by Default with Cross-Workspace Opt-in | **Accepted** | 2026-09-03 | `lib/board-store.mjs`, `lib/session-query.mjs` | [0003-workspace-scoped-isolation-by-default.md](./0003-workspace-scoped-isolation-by-default.md) |
| **ADR-0004** | Atomic Debounced Persistence Engine with Windows Lock Retries and Backup Recovery | **Accepted** | 2026-09-03 | `lib/board-store.mjs` (`AtomicBoardStore`) | [0004-atomic-debounced-persistence-and-healing.md](./0004-atomic-debounced-persistence-and-healing.md) |
| **ADR-0005** | English Metadata and Normalized Two-State Status Protocol | **Accepted** | 2026-09-03 | `lib/session-query.mjs`, `index.mjs` | [0005-english-metadata-and-two-state-status.md](./0005-english-metadata-and-two-state-status.md) |
| **ADR-0006** | Pure DSH Native In-Process Context Injection and State-Aware Dual Dispatch | **Accepted** | 2026-09-04 | `lib/session-call.mjs`, `index.mjs` | [0006-pure-dsh-native-in-process-context-injection.md](./0006-pure-dsh-native-in-process-context-injection.md) |
| **ADR-0007** | Web Slash Command Integration and Visual UX Streamline | **Superseded** *(Retired)* | 2026-09-04 | `index.mjs`, `package.json` | [0007-web-slash-command-and-visual-ux.md](./0007-web-slash-command-and-visual-ux.md) |
| **ADR-0008** | Zero-Pollution Global Profile Mounting and Reversible Lifecycle Management | **Accepted** | 2026-09-04 | `index.mjs`, `cordis.patch.yml` | [0008-zero-pollution-global-profile-mounting.md](./0008-zero-pollution-global-profile-mounting.md) |
| **ADR-0009** | Restrained Minimalist Technical Documentation and Anti-AI-Slop Governance | **Accepted** | 2026-09-04 | `README.md`, `README_ZH.md`, `AGENTS.md` | [0009-restrained-minimalist-docs-and-anti-ai-slop.md](./0009-restrained-minimalist-docs-and-anti-ai-slop.md) |
| **ADR-0010** | Dynamic Blackboard State Mirror Projection and Controlled Peer Session Lifecycle | **Accepted** | 2026-09-07 | `index.mjs`, `lib/board-store.mjs`, `lib/session-create.mjs` | [0010-dynamic-state-mirror-and-peer-session-lifecycle.md](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md) |
| **ADR-0011** | Board List Token Governance, Exact ID Retrieval, and Prompt KV Cache Protection | **Accepted** | 2026-09-08 | `index.mjs`, `lib/board-store.mjs`, `types/board-store.d.ts` | [0011-board-list-token-governance-and-exact-retrieval.md](./0011-board-list-token-governance-and-exact-retrieval.md) |
| **ADR-0012** | Visual Collaboration Canvas and In-Memory Call Telemetry Architecture | **Accepted** *(Workspace isolation superseded by ADR-0013)* | 2026-09-09 | `lib/call-telemetry.mjs`, `lib/web-telemetry-route.mjs`, `lib/client.js`, `lib/session-call.mjs`, `index.mjs` | [0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md](./0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md) |
| **ADR-0013** | Human Canvas Global Transparency vs Agent Workspace Isolation | **Accepted** | 2026-09-10 | `lib/client.js`, `lib/call-telemetry.mjs`, `lib/web-telemetry-route.mjs` | [0013-human-canvas-global-transparency-vs-agent-workspace-isolation.md](./0013-human-canvas-global-transparency-vs-agent-workspace-isolation.md) |
| **ADR-0014** | Canvas Gutter Routing, Lineage Focus, and Scoped Theme Parity | **Accepted** | 2026-09-10 | `lib/client.js` | [0014-canvas-gutter-routing-and-scoped-theme-parity.md](./0014-canvas-gutter-routing-and-scoped-theme-parity.md) |
| **ADR-0015** | Peer Session Model and Preset Inheritance | **Accepted** | 2026-09-10 | `lib/session-create.mjs`, `types/session-create.d.ts` | [0015-peer-session-model-and-preset-inheritance.md](./0015-peer-session-model-and-preset-inheritance.md) |
| **ADR-0016** | Unified Parameter Naming, Session Identifier Governance, and Zero-Alias Anti-Pollution Specification | **Accepted** | 2026-09-11 | `index.mjs`, `lib/session-call.mjs`, `lib/session-create.mjs`, `lib/session-query.mjs` | [0016-unified-parameter-naming-and-session-id-standard.md](./0016-unified-parameter-naming-and-session-id-standard.md) |
| **ADR-0017** | Peer Session Title Event Persistence, Model Parameter Declaration, and Host Alignment Specification | **Accepted** | 2026-09-12 | `index.mjs`, `lib/session-create.mjs`, `types/session-create.d.ts` | [0017-peer-session-title-event-persistence-and-host-alignment.md](./0017-peer-session-title-event-persistence-and-host-alignment.md) |
| **ADR-0018** | Canvas Motion Token, Geometric Invariant, and Visual Restraint Specification | **Accepted** | 2026-09-17 | `lib/client.js` | [0018-canvas-motion-and-visual-restraint.md](./0018-canvas-motion-and-visual-restraint.md) |
| **ADR-0019** | Channel-Split Routing, Lineage On-Demand Focus, and Port Non-Interference Geometry | **Accepted** | 2026-09-17 | `lib/client.js` | [0019-channel-split-routing-and-lineage-on-demand-focus.md](./0019-channel-split-routing-and-lineage-on-demand-focus.md) |
| **ADR-0020** | System Performance Specifications, Resource Budgets, and Deterministic SLA Baselines | **Accepted** | 2026-09-18 | `lib/board-store.mjs`, `lib/call-telemetry.mjs`, `lib/client.js`, `tests/performance-baseline.test.mjs` | [0020-system-performance-specifications-and-resource-budgets.md](./0020-system-performance-specifications-and-resource-budgets.md) |
| **ADR-0021** | Concurrent Running Quota and Model Inheritance Alignment | **Accepted** | 2026-09-20 | `lib/session-directory.mjs`, `lib/session-create.mjs` | [0021-concurrent-running-quota-and-model-inheritance-alignment.md](./0021-concurrent-running-quota-and-model-inheritance-alignment.md) |
| **ADR-0022** | Verifiable Architecture Topology Artifacts and Agent Discipline Decoupling | **Accepted** | 2026-09-18 | `.githooks/pre-commit`, `AGENTS.md`, `docs/architecture/` | [0022-verifiable-architecture-topology-and-agent-discipline-decoupling.md](./0022-verifiable-architecture-topology-and-agent-discipline-decoupling.md) |

---

## Proposing New ADRs

When proposing a new architectural change or invariant, copy [template.md](./template.md) to `NNNN-<short-imperative-title>.md`, document your context, rationale, and consequences, and link it in the matrix above.