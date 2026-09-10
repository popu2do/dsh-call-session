# Changelog

All notable changes to the `dsh-call-session` project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Credential Scanning & Commit Hooks**:
  - `.githooks/pre-commit` scans staged content for credentials, then runs `npm run verify`.
  - `.githooks/commit-msg` enforces the Conventional Commits convention.
  - `scripts/scan-secrets.mjs` matches issuer-specific key formats (AWS, GitHub, npm, Slack, Google, LLM providers, JWT, private key blocks) and credential-shaped assignments, with `secret-scan:allow` line waivers. No external dependency.
  - `npm install` points `core.hooksPath` at `.githooks/` through `scripts/install-hooks.mjs`.
  - CI `Secret Scan` job reuses the same scanner across all tracked files and validates pull request commit messages.
- **Adversarial Test Suites (`tests/`)**: coverage for wildcard and self-call guards, session creation limits, telemetry ring buffer truncation and prototype pollution, and canvas read-only invariants.

### Changed
- **Session Call Guards (`lib/session-call.mjs`)**: wildcard detection now covers `*`, `?`, `@all`, and `@everyone`; self-call protection extends to ambiguous prefix matches that resolve only to the caller.
- Line endings pinned to LF through `.gitattributes` so hook shebangs survive Windows checkouts.

### Fixed
- **Blackboard Store (`lib/board-store.mjs`)**: orphaned temp files left by abnormal exits are cleaned on startup, and the flush timer no longer races with an in-flight flush during close.

## [0.1.1] - 2026-09-09

### Summary
Maintenance and feature release introducing Visual Collaboration Canvas, lightweight read-only Web telemetry routing, peer root session orchestration (`session_create`), board token governance, and pure-state idempotent author reminders.

### Added
- **Visual Collaboration Canvas (`lib/client.js`)**:
  - Web GUI conversation view extension tab「看板」(`conversation.view`, id: `canvas`, order: 15).
  - Multi-workspace swimlane clustering, session state nodes (`running` and `idle`), and blackboard hubs.
  - Three-state time-decayed call edge rendering (`task_dispatch`, `task_report`, `notice`) with smooth Bezier curves.
  - 60fps GPU acceleration via `translate3d`, `will-change`, and layout containment.
  - L3 read-only inspector drawer with field copy, ESC dismissal, and zero-mutation guarantee.
- **Read-Only Telemetry Web Surface (`lib/web-telemetry-route.mjs`)**:
  - Host route `GET /plugins/dsh-call-session/telemetry` protected by Connection authentication fence (503/401/403).
  - Strict read-only GET-only enforcement (non-GET intercepted with 405 Method Not Allowed).
  - In-memory bounded ring buffer (`CallTelemetryRingBuffer`, default capacity 200, range 10-2000, FIFO eviction).
  - Zero disk I/O, zero passive wake-ups, and graceful fallback in webless profiles.
- **Native Peer Root Session Orchestration (`session_create`)**:
  - Creation of independent root sessions directly in the current workspace with non-blocking fire-and-forget ignition.
  - Reverse disambiguation semantic anchoring to clarify intent and prevent improper use of `subagent`.
  - Resource safeguards: workspace quota (10 active root sessions), rate limiting (5 creates/min per session), and generation cutoff (`Generation <= 2`).
  - Automatic `session:bootstrap` blackboard post publication and context reference mounting.
- **Board Token Governance & Exact ID Retrieval (ADR-0011)**:
  - Default `titles_only: true` for catalog queries, eliminating bulky `content` to conserve LLM tokens and protect KV cache.
  - Exact ID point retrieval (`id`) with automatic smart diversion to `titles_only: false` while respecting explicit caller intent.
  - Complete elimination of volatile `remainingSeconds` to maintain prompt prefix stability.
- **Pure-State Idempotent Author Reminder (ADR-0010)**:
  - Dynamic author cleaning reminder mounted in `systemPrompt.context` (`board:remind`, order: 130).
  - Pure state-idempotent formatting without volatile timestamps, ensuring 100% byte-for-byte cache invariance.
- **Architecture Decision Records**:
  - Added ADR-0010, ADR-0011, ADR-0012, and Collaboration Canvas PRD.

### Security & Governance
- **Zero-Trace Workspace Discipline**:
  - Strict isolation and ignore rules for runtime artifacts (`.dsh-vision-toolkit/`).
  - Zero unmanaged disk artifacts, zero console pollution in production paths, and complete test suite cleanup.
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
