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
| **ADR-0007** | Web Slash Command Integration and Visual UX Streamline | **Accepted** | 2026-09-04 | `index.mjs`, `package.json` | [0007-web-slash-command-and-visual-ux.md](./0007-web-slash-command-and-visual-ux.md) |
| **ADR-0008** | Zero-Pollution Global Profile Mounting and Reversible Lifecycle Management | **Accepted** | 2026-09-04 | `index.mjs`, `cordis.patch.yml` | [0008-zero-pollution-global-profile-mounting.md](./0008-zero-pollution-global-profile-mounting.md) |
| **ADR-0009** | Restrained Minimalist Technical Documentation and Anti-AI-Slop Governance | **Accepted** | 2026-09-04 | `README.md`, `README_ZH.md` | [0009-restrained-minimalist-docs-and-anti-ai-slop.md](./0009-restrained-minimalist-docs-and-anti-ai-slop.md) |

---

## Proposing New ADRs

When proposing a new architectural change or invariant, copy [template.md](./template.md) to `NNNN-<short-imperative-title>.md`, document your context, rationale, and consequences, and link it in the matrix above.
