# Changelog

All notable changes to the `dsh-call-session` project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Host service probing (all host modules)**:
  - Cordis 4.0.5 throws `cannot get property "<name>" without inject` when an undeclared service property is read through the context proxy. `resolveWorkspaceRegistry` performed that read during `apply`, which aborted activation with `cannot get property "workspaceRegistry" without inject` and left every tool unregistered. The same crash reproduces on dsh 0.2.0 with Cordis 4.0.4, so the defect shipped latent in 0.1.9 rather than arriving with 0.2.1.
  - Every optional service lookup now goes through `readHostService`: it tries `ctx.get(name, false)` on the root context and then the local context, and falls back to a guarded property read. Affected services: `workspaceRegistry`, `agents`, `boardStore`, `callTelemetry`, `agentDefaultModel`, `sessionController`, `agentPresets`, `sessionTitle`, `sessionProjections`.
  - `getArchivedSessionIds` kept a second bare read of `ctx.archivedSessionIds` and `ctx.archivedSessions` that the first repair pass missed; `session_query` and `session_call` aborted at call time under the same error class until live tool exercise exposed it. Both reads now route through the guarded property probe.
  - Resolution order for `agents` and `workspaceRegistry` is preserved; a missing service still degrades to the previous undefined or null result.

### Added
- **Activation tests against the real Cordis runtime** (`tests/cordis-activation.test.mjs`): every other suite drives a hand-written mock context, which cannot observe the proxy traps Cordis applies to an undeclared service read. Three cases mount the plugin in a real Cordis app providing only the injected services and assert all six tools register, both provided services stay visible, and a missing optional service degrades instead of aborting. The suite reports zero registered tools against 0.1.9, so it catches the regression the fix addresses.

### Changed
- **Runtime requirement moved to the field dsh actually reads**: `engines.dsh` now sits beside `engines.node` as `>=0.2.0-rc.2 <0.3.0-0`. The previous nested `dsh.engines.dsh` was read by nothing, so 0.1.9 shipped with no enforceable runtime requirement: 0.2.1 and later resolve a plugin's dsh range from `engines.dsh` and ignore the dsh peer ranges when it is present, while 0.2.0 scans dsh peer ranges, of which this package declares none. The bound keeps the 0.2 line open and refuses future host majors up front instead of failing at runtime.
- Compatibility matrix now lists DeepSeek Harness `0.2.0-rc.2` and `0.2.1-rc.2` as verified across the Cordis `4.0.2` to `4.0.5` range.

## [0.1.9] - 2026-10-20

### Summary
Causal physical execution verification, structured error contract, ecosystem presence manifest, peer session mention trigger, and out-of-package blackboard storage release (ADR-0033 to ADR-0036). Replaces the 40ms heuristic with causal step and event proofs, standardizes structured machine error codes (ASSEMBLY, DISPATCH, PREFLIGHT, RUNTIME, TIMEOUT), intercepts calls to crashed targets before enqueueing, provides deadlock-free task report fallback to the public blackboard, introduces a two-level drill-down mention trigger, moves durable blackboard state outside the plugin package, and tightens cross-workspace admission.

### Added
- **Causal Physical Execution Verification (ADR-0036, `lib/session-call.mjs`, `lib/session-create.mjs`)**:
  - Permanently abolished the 40ms heuristic window. Physical execution confirmation requires verifying target phase step advancement (`step >= 1` and incrementing) or a new `step/start` causal event matching the dispatch.
  - Full handshake window observation: preserves the 300ms monitoring window to reliably catch asynchronous prompt assembly crashes before returning.
  - Race and concurrent task protection: prevents active tasks from triggering false-positive execution confirmations when queueing secondary calls.
- **Structured Error Taxonomy & Pre-flight Interception (ADR-0036, `lib/session-directory.mjs`, `lib/session-call.mjs`)**:
  - Standardized machine error taxonomy across `ASSEMBLY`, `DISPATCH`, `PREFLIGHT`, `RUNTIME`, and `TIMEOUT`.
  - Losslessly preserves raw error stacks and messages in `error.details`.
  - Pre-flight health probing: rejects calls targeting sessions in `status === 'error'` before enqueueing with `PREFLIGHT_TARGET_IN_ERROR`.
  - Report fallback: automatically routes `task_report` calls to `report:fallback` topic on the public blackboard when the target is in error status, returning `fallbackPostId` and preventing worker deadlock.
  - Zombie session tombstone exemption in workspace inspection: permits re-creating peer sessions that crashed on step 0 without duplicate title collisions.
- **Two-Level Peer Session Mention Trigger (ADR-0034, `lib/client.js`)**:
  - Adds two-level drill-down peer session mention selector supporting Level-1 workspace filtering and Level-2 peer session drill list.
  - Encodes selected peer sessions as pure slice references (`@<title>#<shortId>`).
- **Public Surface Contract & Ecosystem Presence (ADR-0033, `presence.json`)**:
  - Establishes machine-verifiable public surface manifest with asset budget and keyword integrity tests.
- **Workspace admission for `session_create` (ADR-0003 §4.1.5, `lib/session-create.mjs`)**:
  - An explicit `workspace` outside the caller's own workspace must be registered on the host, otherwise the call is rejected with `[WorkspaceNotRegistered]` before any session, title event, or quota is consumed. A host that exposes no workspace registry fails closed with `[WorkspaceRegistryUnavailable]`. Same-workspace creation never consults the registry.

### Changed
- **Blackboard storage location (ADR-0035, `lib/board-store.mjs`)**:
  - The board file now lives at `$DSH_HOME/dsh-call-session/board.json`, defaulting to `~/.dsh/dsh-call-session/board.json`, instead of inside the installed plugin package. The first start after upgrading copies a board left in the old location without deleting the legacy file.

### Migration
- **npm installs must move `board.json` by hand before upgrading.** Installing a new version replaces the package directory outright. Copy the file out of the installed package directory first. Link installs and source checkouts are migrated automatically.

## [0.1.8] - 2026-10-18

### Summary
Cross-session lightweight handshake verification, fail-fast startup crash interception, DSH native 3-state status protocol (running | idle | error), and event-stream self-healing release (ADR-0031). Decouples delivery confirmation from physical execution status, provides sub-50ms crash interception for task dispatch and peer creation, exposes DSH native error states in session directory queries, and hardens the runtime against adversarial data corruption and mid-flight session destruction.

### Added
- **Classified Lightweight Handshake Protocol (ADR-0031, `lib/session-call.mjs`)**:
  - Added bounded 300ms light handshake verification for core task dispatch (`task_dispatch`) and peer session creation (`session_create`), intercepting startup crashes within 40ms.
  - Fail-fast structured error return (`deliveryState: 'failed'`, `executionState: 'crashed'`, `targetStatus: 'error'`) carrying normalized error message and code.
  - Graceful timeout degradation to `deliveryState: 'enqueued'` and `executionState: 'pending'` when queueing without deadlocking.
  - Zero-wait non-blocking immediate return (0ms) for progress reports (`task_report`) and status notices (`notice`).
  - Added explicit configurable `wait_ms` parameter (0 to 5000ms) with boundary clamping and type fallback.
- **Native 3-State Status Resolution & Event Self-Healing (ADR-0031, `lib/session-directory.mjs`)**:
  - Evolved session status from normalized 2-state (`running | idle`) to native 3-state: `running`, `idle`, and `error`.
  - Extracted `resolveNativeSessionStatus(agent)` inspecting native `agent.phase` and reverse-scanning `session.events` for the latest `turn/end` event.
  - Natural event-stream self-healing: subsequent successful turns append normal `turn/end` events that automatically supersede historical errors, restoring `status: 'idle'` without manual cleanup.
  - Added `errorCount` aggregate counter and per-session structured `error` field to `session_query` output.
  - Added localized Markdown table formatting with dedicated error counters and warning highlights (`lib/locales/table.mjs`).
- **Truthful Delivery Semantics & Tool Registry Schemas (`lib/tools-registry.mjs`, `lib/locales/`)**:
  - Decoupled tool return values by eliminating false `status: 'running'` assertions, introducing explicit `deliveryState` and `executionState` dimensions.
  - Purged misleading "successfully called" claims in Chinese and English catalogs in favor of truthful queue and execution confirmation notes.
  - Updated tool schemas for `session_call` and `session_create` with `deliveryState`, `executionState`, `error`, and `wait_ms`.
  - Updated `session_query` output schema to validate `status` against `['running', 'idle', 'error']`.
- **Initial Message Transport Header & Convergence Metadata (ADR-0032, `lib/native-message-transport.mjs`, `lib/peer-bootstrap.mjs`, `lib/locales/`)**:
  - Aligned `session_create` initial message payload with standard transport semantic headers carrying caller session id, title, and `CallType: task_dispatch`, providing peer sessions with deterministic caller attribution for `task_report` closeouts.
  - Added fallback defaulting empty or whitespace caller identifiers to `DEFAULT_BOOTSTRAP_CALLER_ID` (`'root-session'`).
  - Appended objective convergence status hints to `sessionCallSuccess` and `sessionCreateSuccess` across Chinese and English catalogs, suppressing blind polling.
  - Synchronized `hasInitialMessage` metadata across execution and registry render seams.
- **Peer Creation Model Synchronization (`lib/dsh-host-gateway.mjs`)**:
  - Synchronized inherited and overridden model options to `sessionController.agents.selectForNextRequest` and fallback `model/selection` event logging, preventing host defaults from overriding peer session configurations.
- **Adversarial & Destructive Hardening**:
  - Hardened `resolveNativeSessionStatus` against malformed events, nulls, missing reasons, and non-object errors.
  - Distinguished user cancellations (`reason.kind === 'aborted'`) from actual crashes, preventing cancellation false alarms.
  - Safe error recovery on mid-flight session destruction or synchronous target agent dispatch throws (`DISPATCH_ERROR`).
  - Stress-tested double-fault peer creation to guarantee zero lease, quota, or rate-limit leakage.
  - Expanded test suite from 361 to 385 automated tests passing with zero failures.

## [0.1.7] - 2026-10-10

### Summary
DeepSeek Harness 2.0 (0.2.x) runtime compatibility, collaboration canvas redesign, and deep lineage analysis release. Fully adapts to DSH 2.0 host slot supervision and HMR invariants, redesigns session cards to 192x52 rounded rectangles with closed-form outer-tangent edge routing (ADR-0026), streamlines the canvas toolbar with localStorage-persisted dual lineage toggle (minimal/full), adopts pure vector SVG icons (zero emoji), and extracts the pure `analyzeLineage` graph traversal module.

### Added
- **DeepSeek Harness 2.0 (0.2.x) Runtime Compatibility**:
  - Aligned with DSH 2.0 (`@deepseek-ai/dsh` `0.2.0-rc.2`) `SlotErrorBoundary` host supervision: preserved direct functional component registration (`CanvasView`) in `ctx.slots.register('conversation.view', ...)` without class component wrappers, preventing permanent slot abdication.
  - Guarded React Hook baseline topology against HMR index drift across live reloads (useState 1..8, 19 useRefs, useState 9, useRef 20, useState 10, useState 11 edgeMode, 4 useEffects).
  - Updated compatibility matrix in `README.md` and `README_ZH.md` to formally document verified support for DSH 2.0 (`0.2.0-rc.2`).
  - Added automated `RELEASE_NOTES.md` extraction in release CI workflow to synchronize release notes from `CHANGELOG.md` to GitHub Releases.
- **Rounded Card Geometry & Closed-Form Outer-Tangent Routing (ADR-0026)**:
  - 192x52 rounded card geometry with canonical `rx=8`, `ry=8` corner radii, expanding title layout width to 160px.
  - Mathematical closed-form outer-tangent ray-to-rounded-rectangle intersection for straight edge routing, eliminating 17.6px inward notch distortion.
  - Gutter channel isolation: outer-column bypass routes for inter-column and intra-column calls without central column penetration.
  - Dedicated routing geometry test suite extensions (`tests/canvas-geometry-routing.test.mjs`).
- **Streamlined Toolbar & Dual Lineage Mode (ADR-0026)**:
  - Streamlined top toolbar by removing redundant zoom buttons in favor of natural wheel/gesture zoom while retaining macro fit-view and session locating.
  - Dual lineage rendering modes: minimal (`minimal` / default focus on 1-hop lineage with zero static edge noise) and full (`full` / show all inter-session lines).
  - Browser `localStorage` persistence (`dsh_canvas_edge_mode_v1`) preserving mode selection across reloads.
  - Pure vector SVG icons across all canvas controls, replacing emoji glyphs.
- **Deep Lineage Analysis Module (`lib/client.js`, `types/client.d.ts`)**:
  - Extracted pure graph traversal engine `analyzeLineage` from the `CanvasView` rendering tree for deterministic 1-hop ancestor and descendant lineage resolution.
  - Exported complete TypeScript declarations and types in `types/client.d.ts`.
  - Preserved strict React Hook ordering and functional component slot seams.
- **Opt-in Cross-Workspace Peer Session Creation (ADR-0010)**:
  - Supported explicit `args.workspace` in `session_create` with independent target workspace quota accounting and directory attachment.

### Changed
- Refactored `CanvasView` toolbar styling with unified CSS variable tokens and light/dark theme surface adaptability.
- Updated domain terminology across `types/*.d.ts` and JSDoc annotations to align strictly with `CONTEXT.md` (看板数据, 公共黑板, 调用连线).

## [0.1.6] - 2026-09-23

### Summary
Deep module architecture refactoring and peer session creation decoupling release. Folds shallow facade modules, separates storage engine from tool execution, extracts pure mathematical geometric routing and viewport clamping, and decouples the 920-line `session_create` monolith into a hermetic DSH host gateway, transactional admission safeguard lease, and peer bootstrap lifecycle coordinator (ADR-0024 & ADR-0025).

### Added
- **DSH Host Gateway (`lib/dsh-host-gateway.mjs`, ADR-0025)**:
  - Encapsulates Cordis host service discovery (`agents`, `agentDefaultModel`, `sessionController`, `agentPresets`, `sessionTitle`, `workspaceRegistry`).
  - Hermetic `createRootAgent` shielding deep-frozen host objects (`Object.isFrozen`) and stripping parent session origin metadata.
  - Three-tier model cascade resolution (`resolveEffectiveModel`) and composition setup hook chaining (`resolvePresetSetup`).
  - Durable `session/title` event persistence and workspace attachment helpers.
  - Added dedicated unit test suite (`tests/dsh-host-gateway.test.mjs`, 18 tests).
- **Session Admission Safeguard (`lib/session-safeguard.mjs`, ADR-0025)**:
  - Concentrates sliding-window rate limiting (5/min), concurrent running quota (max 5 per workspace), and generation depth cutoff (<= 2).
  - Transactional `AdmissionLease` with optimistic in-flight reservation, `lease.commit()`, and zero-leak automatic `lease.release()` rollback.
  - Added dedicated unit test suite (`tests/session-safeguard.test.mjs`, 9 tests).
- **Peer Session Bootstrapper (`lib/peer-bootstrap.mjs`, ADR-0025)**:
  - Extracted initial task message formatting, context reference normalization (`#post-xxx`), 120-character summary truncation, and safe non-blocking dispatch.
  - Public blackboard lifecycle bootstrap announcement (`session:bootstrap`) with 1-hour TTL and origin metadata.
  - Added dedicated unit test suite (`tests/peer-bootstrap.test.mjs`, 16 tests).
- **Pure Canvas Geometry & Viewport Clamping Modules (`lib/client.js`, ADR-0024)**:
  - Extracted pure mathematical geometry routing (ellipse intersection, self-loops, channel-split routing, blackboard gutter).
  - Viewport dual-clamping and macro framing algorithms decoupled from React/DOM runtime.
  - Added dedicated unit test suites (`tests/canvas-geometry-routing.test.mjs`, `tests/canvas-viewport-clamping.test.mjs`).

### Changed
- Re-architected `PeerSessionFactory` (`lib/session-create.mjs`) from a 923-line procedural monolith into a lean ~340-line composition coordinator.
- Folded shallow `session-query.mjs` facade directly into `SessionDirectory.prototype.query` while maintaining 100% backward-compatible re-exports.
- Decoupled `BoardToolsAdapter` from `BoardStore` to isolate tool parsing and reserved topic filtering from the pure storage engine.
- Realigned `CallTelemetryRingBuffer` to eliminate static ESM circular dependencies and inverted data source imports.

### Fixed
- Fixed rate limit and in-flight creation state leaks on session creation failures via atomic `AdmissionLease`.
- Fixed terminology breaches and duplicate rate limiting implementations identified in code review.
- Fixed in-flight reservation accounting for untitled session creation requests with orthogonal leaseId tracking.

## [0.1.5] - 2026-09-21

### Summary
Canvas viewport clamping and landed pulse release. Resolves visual distortion and topological imbalance when locating the current session by replacing rigid geometric centering with clamped viewport framing and bounded vertical centering. Adds non-deforming landed pulse feedback, eliminates auto-framing on external session switches, restores container resize reframing, and unifies client test harness sandboxes and traversal utilities.

### Added
- **Clamped Viewport Framing Engine (ADR-0013)**:
  - Extracted pure `computeViewportFraming` engine shared by macro fit view and clamped session locating.
  - Horizontal boundary clamping: pins column 0 to 48px safety margin when total content width exceeds viewport, centering otherwise.
  - Vertical bounded centering: centers target node while clamping top blackboard and column base inside visible area when layout fits vertically.
  - Zoom range preservation: clamps locate zoom to `[0.8, 1.2]`, respecting user zoom within range.
  - Readability zoom floor: enforces `0.30` lower bound on global macro framing to preserve session title legibility on wide topologies.
  - Exported canonical `SESSION_NODE_HALF_WIDTH` (96) and `SESSION_NODE_HALF_HEIGHT` (26) constants and named types `CanvasBounds` and `ViewportFraming`.
- **Landed Pulse Visual Feedback (ADR-0013 & ADR-0018)**:
  - 1.2s dual-cycle breathing animation on the located session ellipse using `stroke-opacity` (1.0 -> 0.25 -> 1.0) without geometric distortion.
  - Timed 320ms delay matching `VIEWPORT_TWEEN_MS` transition duration.
  - Frozen under `@media (prefers-reduced-motion: reduce)`.
- **Centralized Test Harness (`tests/helpers/canvas-harness.mjs`)**:
  - Unified VM sandbox execution via `loadClientInSandbox` and `readClientSource`.
  - Consolidated virtual DOM traversal via `findNodeById` and `findVNodes`.
  - Added deterministic React mock runtime `createCanvasRuntime` with `useEffect` dependency and cleanup lifecycle support.

### Changed
- Initial canvas mount and container resize execute global macro fit view framing all workspaces and public blackboard; single-node centering on mount removed.
- External `sessionId` changes silently migrate node highlight and `[Current]` badge without displacing viewport pan or zoom.
- `package.json` distribution file list updated to include showcase assets and metadata.

### Fixed
- Fixed viewport hijacking on session switch caused by ResizeObserver initial observation callbacks.
- Fixed container resize detection to track both width and height changes.
- Fixed toolbar button interaction state semantics so manual fit view resets auto-framing while locating pins the view.

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