# Changelog

All notable changes to the `dsh-call-session` project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
  - Production-grade English `README.md` and Simplified Chinese `README_ZH.md` with Mermaid sequence diagrams, configuration references, and realistic JSON Tool Call examples.
- **Architecture Decision Record (ADR) Suite**:
  - Comprehensive ADR matrix (ADR-0001 through ADR-0008) tracking invariants and architectural decisions.
- **CI/CD & Open Source Governance**:
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`) testing Node.js 20, 22, and 24 across Ubuntu and Windows runners.
  - Community documentation: `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates.

### Security
- **Self-Loop Prevention Fuse**: Immediate rejection when an agent attempts to call its own session ID.
- **Broadcast Interception**: Safety fuse blocking wildcard broadcast operations (`*`, `all`, `broadcast`).
- **Prefix Disambiguation Fuse**: Fails fast with informative candidate listings if a shortened session ID matches multiple active sessions.
- **Input & Payload Bounds**: Strict validation bounds (4,000 characters for unicast messages, 64KB for blackboard posts).
- **Atomic Persistence & Backup Recovery**: Safe atomic file writes using temporary file swaps and `.bak` mirror backups to prevent write corruption.
