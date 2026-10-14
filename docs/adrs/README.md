# Architecture Decision Records

本文档归档 `dsh-call-session` 核心架构决策记录。

## 概述

架构决策记录捕获系统关键决策背景、权衡考量、不可变约束与演化关系。

## 状态

- **Accepted**: 当前生效并受代码库与自动化测试严格约束。
- **Superseded**: 已被后续深层架构决策替代，保留作为演化证据。
- **Deprecated**: 对应功能或配置已被正式废弃。
- **Proposed**: 正在设计评审中的提议。

```
[ Proposed ] ---> [ Accepted ] ──┬---> [ Deprecated ]
                                 └──-> [ Superseded by ADR-YYYY ]
```

---

## 领域

决策记录按五大子系统领域归类索引。智能体应优先查阅各领域的现行生效记录。

### 存储

公共黑板存储引擎、持久化容灾、工作区隔离与工具适配。

| ID | Title | Status | Date | Primary Anchors | Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0030** | Direct Tool Binding to BoardToolsAdapter and Pure Storage Engine Alignment | **Accepted** - Current | 2026-10-14 | `lib/tools-registry.mjs`, `lib/board-store.mjs` | [0030-direct-tool-binding-to-board-tools-adapter.md](./0030-direct-tool-binding-to-board-tools-adapter.md) |
| **ADR-0027** | Deep Module Architecture: Workspace Domain Primitive Isolation, Physical Adapter Seams, and Tools Registry Facade | **Accepted** - Current | 2026-10-10 | `lib/workspace.mjs`, `lib/board-tools-adapter.mjs` | [0027-deep-module-workspace-isolation-tools-registry-and-canvas-geometry.md](./0027-deep-module-workspace-isolation-tools-registry-and-canvas-geometry.md) |
| **ADR-0011** | Board List Token Governance, Exact ID Retrieval, and Prompt KV Cache Protection | **Accepted** - Current | 2026-09-08 | `lib/board-store.mjs` | [0011-board-list-token-governance-and-exact-retrieval.md](./0011-board-list-token-governance-and-exact-retrieval.md) |
| **ADR-0004** | Atomic Debounced Persistence Engine with Windows Lock Retries and Backup Recovery | **Accepted** - Current | 2026-09-03 | `lib/board-store.mjs` | [0004-atomic-debounced-persistence-and-healing.md](./0004-atomic-debounced-persistence-and-healing.md) |
| **ADR-0003** | Workspace-Scoped Isolation by Default with Cross-Workspace Opt-in | **Accepted** - Current | 2026-09-03 | `lib/workspace.mjs`, `lib/board-store.mjs` | [0003-workspace-scoped-isolation-by-default.md](./0003-workspace-scoped-isolation-by-default.md) |
| **ADR-0024** | Deep Module Architecture Refactoring, Shallow Query Facade Folding, and Storage-Tool Adapter Decoupling | **Accepted** - Evolved by ADR-0027, ADR-0030 | 2026-09-23 | `lib/session-directory.mjs` | [0024-deep-module-architecture-refactoring-and-shallow-facade-folding.md](./0024-deep-module-architecture-refactoring-and-shallow-facade-folding.md) |
| **ADR-0010** | Dynamic Blackboard State Mirror Projection and Controlled Peer Session Lifecycle | **Accepted** - Tool facade evolved by ADR-0027 | 2026-09-07 | `lib/board-store.mjs` | [0010-dynamic-state-mirror-and-peer-session-lifecycle.md](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md) |
| **ADR-0002** | Built-in Blackboard State Store - Zero External Dep | **Accepted** - Storage core evolved by ADR-0027 | 2026-09-03 | `lib/board-store.mjs` | [0002-builtin-blackboard-store.md](./0002-builtin-blackboard-store.md) |

### 传输

跨会话单播调用、原生消息分发、传输层报头与参数规范。

| ID | Title | Status | Date | Primary Anchors | Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0029** | Consolidated Native Message Transport and Bootstrap Facade Folding | **Accepted** - Current | 2026-10-14 | `lib/native-message-transport.mjs`, `lib/session-call.mjs` | [0029-consolidated-native-message-transport-and-bootstrap-facade-folding.md](./0029-consolidated-native-message-transport-and-bootstrap-facade-folding.md) |
| **ADR-0016** | Unified Parameter Naming, Session Identifier Governance, and Zero-Alias Anti-Pollution Specification | **Accepted** - Current | 2026-09-11 | `lib/session-call.mjs`, `lib/tools-registry.mjs` | [0016-unified-parameter-naming-and-session-id-standard.md](./0016-unified-parameter-naming-and-session-id-standard.md) |
| **ADR-0006** | Pure DSH Native In-Process Context Injection and State-Aware Dual Dispatch | **Accepted** - Transport unified by ADR-0029 | 2026-09-04 | `lib/session-call.mjs` | [0006-pure-dsh-native-in-process-context-injection.md](./0006-pure-dsh-native-in-process-context-injection.md) |
| **ADR-0001** | Separation of Concerns: Pull-based Public Board vs Push-based Strict Unicast Call | **Accepted** - Transport superseded by ADR-0006, ADR-0029 | 2026-09-03 | `lib/session-call.mjs`, `index.mjs` | [0001-separation-of-concerns-board-vs-call.md](./0001-separation-of-concerns-board-vs-call.md) |

### 准入

对等会话创建、宿主网关抽象、并发配额守护与双态状态规约。

| ID | Title | Status | Date | Primary Anchors | Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0028** | Deep Admission Safeguard Seam, Atomic Title Resolution, and Lease Single Source of Truth | **Accepted** - Current | 2026-10-13 | `lib/session-safeguard.mjs`, `lib/session-create.mjs` | [0028-deep-admission-safeguard-seam-and-lease-single-source-of-truth.md](./0028-deep-admission-safeguard-seam-and-lease-single-source-of-truth.md) |
| **ADR-0025** | Peer Session Creation Host Gateway, Safeguard Lease, and Bootstrap Decoupling | **Accepted** - Current | 2026-09-23 | `lib/dsh-host-gateway.mjs`, `lib/session-safeguard.mjs` | [0025-peer-session-creation-gateway-safeguard-and-bootstrap-decoupling.md](./0025-peer-session-creation-gateway-safeguard-and-bootstrap-decoupling.md) |
| **ADR-0021** | Concurrent Running Quota and Model Inheritance Alignment | **Accepted** - Current | 2026-09-20 | `lib/session-safeguard.mjs` | [0021-concurrent-running-quota-and-model-inheritance-alignment.md](./0021-concurrent-running-quota-and-model-inheritance-alignment.md) |
| **ADR-0005** | English Metadata and Normalized Two-State Status Protocol | **Accepted** - Current | 2026-09-03 | `lib/session-directory.mjs` | [0005-english-metadata-and-two-state-status.md](./0005-english-metadata-and-two-state-status.md) |
| **ADR-0008** | Zero-Pollution Global Profile Mounting and Reversible Lifecycle Management | **Accepted** - Current | 2026-09-04 | `cordis.patch.yml`, `index.mjs` | [0008-zero-pollution-global-profile-mounting.md](./0008-zero-pollution-global-profile-mounting.md) |
| **ADR-0017** | Peer Session Title Event Persistence, Model Parameter Declaration, and Host Alignment Specification | **Accepted** - Title resolution superseded by ADR-0028 | 2026-09-12 | `lib/session-create.mjs` | [0017-peer-session-title-event-persistence-and-host-alignment.md](./0017-peer-session-title-event-persistence-and-host-alignment.md) |
| **ADR-0015** | Peer Session Model and Preset Inheritance | **Accepted** - Gateway creation evolved by ADR-0025 | 2026-09-10 | `lib/session-create.mjs` | [0015-peer-session-model-and-preset-inheritance.md](./0015-peer-session-model-and-preset-inheritance.md) |

### 看板

全局拓扑视图、通道分流走线、Gutter 通道与圆角矩形卡片规范。

| ID | Title | Status | Date | Primary Anchors | Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0026** | Canvas Rounded Rectangle Cards, Toolbar Streamlining, and Dual Lineage Modes | **Accepted** - Current | 2026-10-08 | `lib/client.js`, `types/client.d.ts` | [0026-canvas-rounded-rect-cards-toolbar-streamlining-and-dual-lineage-modes.md](./0026-canvas-rounded-rect-cards-toolbar-streamlining-and-dual-lineage-modes.md) |
| **ADR-0019** | Channel-Split Routing, Lineage On-Demand Focus, and Port Non-Interference Geometry | **Accepted** - Current | 2026-09-17 | `lib/client.js` | [0019-channel-split-routing-and-lineage-on-demand-focus.md](./0019-channel-split-routing-and-lineage-on-demand-focus.md) |
| **ADR-0018** | Canvas Motion Token, Geometric Invariant, and Visual Restraint Specification | **Accepted** - Current | 2026-09-17 | `lib/client.js` | [0018-canvas-motion-and-visual-restraint.md](./0018-canvas-motion-and-visual-restraint.md) |
| **ADR-0014** | Canvas Gutter Routing, Lineage Focus, and Scoped Theme Parity | **Accepted** - Current | 2026-09-10 | `lib/client.js` | [0014-canvas-gutter-routing-and-scoped-theme-parity.md](./0014-canvas-gutter-routing-and-scoped-theme-parity.md) |
| **ADR-0013** | Human Canvas Global Transparency vs Agent Workspace Isolation | **Accepted** - Current | 2026-09-10 | `lib/client.js`, `lib/web-telemetry-route.mjs` | [0013-human-canvas-global-transparency-vs-agent-workspace-isolation.md](./0013-human-canvas-global-transparency-vs-agent-workspace-isolation.md) |
| **ADR-0012** | Visual Collaboration Canvas and In-Memory Call Telemetry Architecture | **Accepted** - Workspace isolation superseded by ADR-0013 | 2026-09-09 | `lib/call-telemetry.mjs`, `lib/client.js` | [0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md](./0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md) |
| **ADR-0007** | Web Slash Command Integration and Visual UX Streamline | **Superseded by ADR-0012** | 2026-09-04 | `index.mjs` | [0007-web-slash-command-and-visual-ux.md](./0007-web-slash-command-and-visual-ux.md) |

### 治理

文档治理防注水、架构拓扑解耦、性能 SLA 基线与双语规范。

| ID | Title | Status | Date | Primary Anchors | Document |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADR-0023** | Bilingual Localization Architecture and Standardized English Error Protocol | **Accepted** - Current | 2026-09-21 | `lib/locales/index.mjs`, `lib/client.js` | [0023-bilingual-localization-and-english-error-standardization.md](./0023-bilingual-localization-and-english-error-standardization.md) |
| **ADR-0022** | Verifiable Architecture Topology Artifacts and Agent Discipline Decoupling | **Accepted** - Current | 2026-09-18 | `AGENTS.md`, `docs/architecture/` | [0022-verifiable-architecture-topology-and-agent-discipline-decoupling.md](./0022-verifiable-architecture-topology-and-agent-discipline-decoupling.md) |
| **ADR-0020** | System Performance Specifications, Resource Budgets, and Deterministic SLA Baselines | **Accepted** - Current | 2026-09-18 | `lib/board-store.mjs`, `lib/call-telemetry.mjs` | [0020-system-performance-specifications-and-resource-budgets.md](./0020-system-performance-specifications-and-resource-budgets.md) |
| **ADR-0009** | Restrained Minimalist Technical Documentation and Anti-AI-Slop Governance | **Accepted** - Current | 2026-09-04 | `README.md`, `AGENTS.md` | [0009-restrained-minimalist-docs-and-anti-ai-slop.md](./0009-restrained-minimalist-docs-and-anti-ai-slop.md) |

---

## 模板

新增决策请参考 [template.md](./template.md)。
