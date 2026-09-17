# Changelog

All notable changes to the `dsh-call-session` project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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