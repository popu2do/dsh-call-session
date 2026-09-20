# Changelog

All notable changes to the `dsh-call-session` project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-09-21

### Summary
Bilingual localization and standardized English error protocol release. Introduces a comprehensive bilingual (English / Simplified Chinese) architecture (ADR-0023) across native tools, dynamic system prompts, and the Web Collaboration Canvas. Standardizes all runtime exception codes into machine-readable bracketed tags (`[ErrorCode]`), eliminates inline ternary locale branches in Web UI via `ctx.locale.bind('dsh-canvas')`, and enforces strict camelCase schema outputs per ADR-0005 and ADR-0016.

### Added
- **Bilingual Localization Architecture (ADR-0023)**:
  - Added modular localization catalogs under `lib/locales/` (`zh.mjs`, `en.mjs`, `index.mjs`, `table.mjs`, `types/locales.d.ts`).
  - Implemented 3-tier cascade locale resolution: explicit `config.locale` ('zh' | 'en') -> Host Settings Service preference -> Host environment auto-detection (`LANG`, `LC_ALL`, `Intl`).
  - Added dynamic System Prompt (`usageSectionText`) and blackboard reminder (`formatAuthorReminderText`) re-evaluation on turn boundaries.
  - Symmetrically aligned domain terminology in `CONTEXT.md` with canonical English identifiers for 10 core concepts.
- **Standardized English Error Protocol (ADR-0023)**:
  - Standardized all runtime exception messages across backend tools and services to canonical format: `[ErrorCode] <english explanation>`.
  - Enforced 12 standard error categories: `[InvalidParameter]`, `[TargetNotFound]`, `[SelfCallForbidden]`, `[AmbiguousPrefix]`, `[WildcardForbidden]`, `[RateLimitExceeded]`, `[GenerationLimitExceeded]`, `[QuotaExceeded]`, `[DuplicateTitle]`, `[ReservedTopic]`, `[StorageError]`, and `[ServiceUnavailable]`.
- **Peer Session Output Parity**:
  - Expanded `session_create` output schema with human/agent-readable localized summary `message` (`types/session-create.d.ts`, `lib/session-create.mjs`, `index.mjs`).

### Changed
- **Web Collaboration Canvas (`lib/client.js`)**:
  - Bound Web Canvas UI text to `ctx.locale.bind('dsh-canvas')`, eliminating all hardcoded inline ternary locale branches.
  - Implemented dynamic SVG character width estimation (`measureTextWidth`) for current session indicators and node labels.
  - Resolved visual overlap between current session badges and call count circle indicators across viewports.

### Fixed
- Fixed unhandled exception paths in `board_post` and `session_call` to guarantee standardized error code propagation.
- Fixed table summary formatting in `session_query` to prevent count distortion on truncated results.

## [0.1.3] - 2026-09-17

### Summary
Architecture hardening, performance specifications, and canvas visual restraint release. Establishes quantified deterministic performance SLAs (ADR-0020), concurrent running-only session quotas and caller model inheritance (ADR-0021), canvas motion geometric invariants and visual restraint (ADR-0018), channel-split routing geometry with on-demand lineage focus (ADR-0019), deep domain module decoupling (`SessionDirectory`, `PeerSessionFactory`, `BoardStore`), ecosystem alignment for DSH 0.1.5 (`@deepseek-ai/cordis` `^4.0.2`, `@deepseek-ai/schemastery` `^3.18.2`), and ADR-0009 writing style standard compliance.

### Added
- **Performance Budgets & SLA Gate Suite (ADR-0020)**:
  - Enforced strict P99 latency baselines across in-memory operations: blackboard query <= 5ms, unicast dispatch <= 2ms, session directory scan <= 10ms, peer session quota check <= 1ms, telemetry route snapshot aggregation <= 20ms.
  - Established process memory RSS growth budget (<= 30MB delta) and bounded cache limits.
  - Implemented throttled frontend polling with 5-minute inactive tab pausing to conserve client resources.
  - Added dedicated automated performance baseline regression test suite (`tests/performance-baseline.test.mjs`).
- **Concurrent Running-Only Quota & Dynamic Model Inheritance (ADR-0021)**:
  - Re-anchored peer session creation quota to actively running sessions (`status === 'running'`) with an upper bound of 5 (`MAX_ACTIVE_PEER_SESSIONS = 5`), preventing idle sessions from exhausting creation budgets.
  - Enabled dynamic caller model options inheritance (`model`, `reasoning_effort`, `preset`) through `PeerSessionFactory`, honoring caller runtime headers and preventing fallback degradation.
  - Added TOCTOU reservation locks for in-flight session creations across concurrent calls.
- **Canvas Motion Token & Geometric Invariants (ADR-0018)**:
  - Enforced strict ban on CSS `transform: scale` / geometric mutation on SVG topological edge paths, preventing visual dislocation.
  - Added independent breathing keyframes (`@keyframes dshPulseEdge`, `@keyframes dshPulseEdgeLight`) with opacity and stroke-width restraint.
  - Ensured full WCAG 2.1 AA contrast compliance and suppressed drop-shadow bloom in light mode.
  - Added `prefers-reduced-motion` accessibility support scoped under `.dsh-canvas-container`.
- **Channel-Split Routing & Lineage On-Demand Focus (ADR-0019)**:
  - Separated upstream and downstream vertical routing channels for intra-column session calls to eliminate edge crossover and S-curve clutter.
  - Introduced discrete channel offset clamping and concentric clearance geometry preventing overlapping edge lines.
  - Implemented on-demand lineage focus: suppressed inactive history edge lines by default with active hover/focus highlighting.
  - Added ultra-compact single-line capsule tooltips avoiding obstruction of adjacent node cards and ports.
  - Enforced strict layout invariants: 16px header spacing and 72px vertical node distribution steps.
- **Deep Module Architecture**:
  - `SessionDirectory` (`lib/session-directory.mjs`, `types/session-directory.d.ts`): encapsulated session discovery, metadata parsing, workspace isolation, target resolution, and running status inspection.
  - `PeerSessionFactory` (`lib/session-create.mjs`): isolated peer session creation lifecycle, quota validation, rate limiting, and model resolution.
  - `BoardStore` domain operation methods (`executePost`, `executeList`, `executeClear`, `getAuthorReminder`, `formatAuthorReminderText`).

### Changed
- **Ecosystem Baseline & Compatibility**:
  - Upgraded peer and dev dependencies to DSH 0.1.5 host baseline: `@deepseek-ai/cordis: ^4.0.2`, `@deepseek-ai/schemastery: ^3.18.2`.
  - Updated compatibility matrix in README and README_ZH for verified DSH 0.1.5 host distributions.
- **Writing & Terminology Standards (ADR-0009)**:
  - Purged marketing jargon and hyperbolic terminology across documentation, ADRs, source comments, and test descriptions in adherence to ADR-0009 and Matt Pocock writing standards.

### Fixed
- Fixed `BoardStore.executeList` error branch return contract to strictly adhere to ADR-0016 §4.2 schema specifications (`success`, `count`, `posts`).
- Clamped routing channel offsets to prevent bounding box clipping in multi-session topologies.

## [0.1.2] - 2026-09-16

### Summary
Feature and architecture alignment release introducing the Transport Semantic Header (`buildTransportPayload`) and Category Semantic Contract for peer-to-peer session communication, resolving the identity blindness and dead-wait stalemates while strictly upholding the Zero-Envelope and Zero-Preach invariants of ADR-0006.

### Added
- **Transport Semantic Header (`buildTransportPayload`)**:
  - Automatically prepends an objective header `[From: <callerSessionId> (<callerTitle>) | CallType: <callType>]` to the user message content during `session_call`.
  - Supports optional context reference line `> Context Ref: #post-xxx, #post-yyy` when blackboard posts are attached.
  - 100% verbatim retention of original message content without trimming, formatting manipulation, or nanny instruction injection.
  - Comprehensive graceful degradation: missing caller metadata falls back smoothly to `unknown-caller`, default `Session` title, and safe `task_dispatch` category.
  - Full TypeScript types exported via `types/session-call.d.ts` and `types/index.d.ts`.
- **Category Semantic Contract & Autonomous Closure Protocol**:
  - Enforces three explicit call categories (`task_dispatch`, `task_report`, `notice`) in `usageSectionText` and tool schema.
  - Empowers recipient and caller LLMs to autonomously determine collaboration convergence without low-level auto-ACK loops or intrusive state-machine polling.

### Changed
- **ADR-0006 Revision**: Clarified the boundaries of Zero-Envelope to distinguish between pure transport-layer metadata (infrastructure) and business instruction pollution (anti-pattern).
## [0.1.1] - 2026-09-15

### Summary
Feature and production release introducing the Visual Collaboration Canvas (PRD 2.0.0 & ADR-0012), lightweight read-only Web telemetry routing, peer root session orchestration (`session_create`), board token governance, pure-state idempotent author reminders, and ADR-0005 dual-layer query rendering.

### Added
- **Visual Collaboration Canvas (`lib/client.js`)**:
  - Conversation view extension tab「看板」(`conversation.view`, id: `canvas`, order: 15).
  - Multi-workspace swimlanes with full session visibility (including idle and newly created sessions).
  - Three-state time-decayed call edge rendering (`task_dispatch`, `task_report`, `notice`) with smooth Bezier paths and elliptical outer-clipping tangent markers.
  - L3 read-only inspection drawer with backdrop mask (`.dsh-canvas-drawer-mask`), field copy, ESC dismissal, and zero-mutation guarantee.
  - 60fps GPU acceleration via `translate3d`, `will-change`, and layout containment.
  - Safety exclusion padding (`padding-right: 76px !important;`) avoiding host GUI overlay controls.
  - Non-blocking 1.5s background polling with blur/focus backoff and zero passive wake-ups.
- **Read-Only Telemetry Web Surface (`lib/web-telemetry-route.mjs`)**:
  - Host route `GET /plugins/dsh-call-session/telemetry` protected by Connection authentication fence (503/401/403).
  - Strict read-only GET-only enforcement (non-GET intercepted with 405 Method Not Allowed).
  - In-memory bounded ring buffer (`CallTelemetryRingBuffer`, default capacity 200, range 10-2000, FIFO eviction).
  - Zero disk I/O, zero passive wake-ups, and graceful fallback in webless profiles.
- **Native Peer Root Session Orchestration (`session_create`)**:
  - In-process independent root session creation via `agentsService.create`.
  - TOCTOU workspace reservation locks (`inFlightCreationsByWorkspace`) preventing concurrent quota race conditions.
  - Resource safeguards: workspace quota (10 active root sessions), generation cutoff (`Generation <= 2`), and sliding-window rate limiting (5/min with optimistic reserve and rollback).
  - Privileged prefix stripping (`[SYSTEM]`, `admin:`, etc.) and title deduplication.
  - Automatic `session:bootstrap` blackboard post publication and context reference mounting.
- **Board Token Governance & Exact ID Retrieval (ADR-0011)**:
  - Default `titles_only: true` for catalog queries, eliminating bulky `content` to conserve LLM tokens and protect KV cache.
  - Exact ID point retrieval (`id`) with automatic smart diversion to `titles_only: false` while respecting explicit caller intent.
  - Complete elimination of volatile `remainingSeconds` to maintain prompt prefix stability.
- **Pure-State Idempotent Author Reminder (ADR-0010)**:
  - Dynamic author cleaning reminder mounted in `systemPrompt.context` (`board:remind`, order: 130).
  - Pure state-idempotent formatting without volatile timestamps, ensuring 100% byte-for-byte cache invariance.
- **Session Query Dual-Layer Rendering (`lib/session-query.mjs`, ADR-0005)**:
  - Structured metadata schema containing `totalCount`, `activeCount`, `idleCount`, `workspace`, and `isCurrent`.
  - Markdown summary table rendering for dual-layer inspection.
- **Architecture Decision Records**:
  - Added ADR-0010, ADR-0011, ADR-0012, and Collaboration Canvas PRD.
- **Credential Scanning & Commit Hooks**:
  - Pre-commit credential scanner (`scripts/scan-secrets.mjs`) and Conventional Commits enforcement (`scripts/check-commit-msg.mjs`).
  - Adversarial test suites covering wildcard guards, self-calls, and canvas read-only invariants.

### Changed
- **KISS Title Resolution Simplification (`lib/call-telemetry.mjs`, `lib/client.js`)**:
  - Simplified title resolution: explicit valid title priority with `Agent <shortId>` fallback, eliminating brittle regexes and event-stream backtraces.
  - Eliminated redundant frontend title sanitizer `isCleanDisplayTitle`.
- **Session Call Guards (`lib/session-call.mjs`)**: wildcard detection now covers `*`, `?`, `@all`, and `@everyone`; self-call protection extends to ambiguous prefix matches that resolve only to the caller.

### Fixed
- Unified blackboard metric counts to active entries (`status === 'active'`) across canvas ribbon and telemetry headers.
- Fixed canvas bounding box calculation for true auto-fit centering.
- Fixed virtual call endpoint title rendering and `session.offline` lifecycle consumption.
- Orphaned temporary files left by abnormal exits cleaned on startup, and flush timer race conditions eliminated during store close.

### Security & Governance
- **Zero-Trace Workspace Discipline**:
  - Strict isolation and ignore rules for runtime artifacts.
  - Zero unmanaged disk artifacts, zero console pollution in production paths, zero emoji (ADR-0009), and complete test suite cleanup.
- **KV Cache Defense (ADR-0012 Invariant 4)**:
  - Telemetry and canvas interfaces strictly excluded from LLM tools and system prompts.

## [0.1.0] - 2026-09-02

### Summary
Initial production release of `dsh-call-session`, providing native in-process cross-session communication, structured agent coordination, and a public blackboard for DeepSeek Harness (DSH).

### Added
- **Cordis Native Dependency Injection**: Full integration with Cordis v4 microkernel (`ctx.agents`, `tools`, `commands`, `systemPrompt`).
- **Strongly-Typed Configuration Schema**: Exported `Config` schema via `@deepseek-ai/schemastery` supporting `enabled`, `storagePath`, `debounceMs`, `maxCapacity`, `promptSectionOrder`, and `slashCommand`.
- **Strict 1:1 In-Process Unicast (`session_call`)**:
  - Direct memory access via `ctx.agents.get()`.
  - State-aware dual dispatch: real-time non-blocking in-flight steering (`steer`) for running agents, and new-turn wake-up (`followup`) for idle agents.
  - DSH-native `MessageSource` injection (`kind: 'plugin'`, `form: 'notice'`) with authentic message provenance.
  - Context referencing via `context_post_ids` for compact directive transmission without inlining bulky text payloads.
- **Workspace-Scoped Session Discovery (`session_query`)**:
  - Strict two-state normalization to `running` and `idle`.
  - Workspace directory scoping by default with explicit cross-workspace traversal (`cross_workspace: true`).
  - Session matching supporting unique prefix disambiguation (>= 8 characters).
- **Zero-Wakeup Public Blackboard (`board_post`, `board_list`, `board_clear`)**:
  - Pure pull-based asynchronous milestone and state sharing with zero passive wake-ups.
  - High-efficiency `titles_only` digest mode saving up to 85% LLM tokens.
  - Granular post management supporting soft-archive (`dismiss`) and physical removal (`purge`).
- **Web Slash Command (`/dsh-call-session`)**:
  - Interactive Web GUI command supporting empty-argument board digest rendering and parameterized unicast dispatch.
  - Visual presentation in Web UI via native folded `ContextInjectionRow`.
- **Declarative Profile Bundle Integration (`cordis.patch.yml`)**:
  - Standard DSH bundle patch manifest for automatic profile mounting via `dsh plugin --profile <name> add`.
- **TypeScript Type Definitions (`types/`)**:
  - Complete `.d.ts` type declarations (`types/index.d.ts`, `types/board-store.d.ts`, `types/session-call.d.ts`, `types/session-query.d.ts`) enabling full IDE intellisense and strict `tsc --noEmit` validation.
- **Automated Test Suite (`tests/`)**:
  - Lightweight automated test suites using `node:test` and `node:assert/strict` covering Blackboard CRUD, concurrency, debounce, `.bak` crash recovery, unicast dispatch, security fuses, session discovery, and lifecycle disposal.
- **Bilingual Documentation**:
  - Production-grade English `README.md` and Simplified Chinese `README_ZH.md` with configuration references and realistic JSON Tool Call examples.
- **Architecture Decision Record (ADR) Suite**:
  - Comprehensive ADR matrix (ADR-0001 through ADR-0009) tracking invariants and architectural decisions.
- **CI/CD & Open Source Governance**:
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`) testing Node.js 20, 22, and 24 across Ubuntu and Windows runners.
  - Community documentation: `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates.

### Security
- **Self-Loop Prevention Fuse**: Immediate rejection when an agent attempts to call its own session ID.
- **Broadcast Interception**: Safety fuse blocking wildcard broadcast operations (`*`, `all`, `broadcast`).
- **Prefix Disambiguation Fuse**: Fails fast with informative candidate listings if a shortened session ID matches multiple active sessions.
- **Input & Payload Bounds**: Strict validation bounds (4,000 characters for unicast messages, 64KB for blackboard posts).
- **Atomic Persistence & Backup Recovery**: Safe atomic file writes using temporary file swaps and `.bak` mirror backups to prevent write corruption.