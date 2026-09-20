# ADR-0023: Bilingual Localization Architecture and Standardized English Error Protocol

- **Status**: Accepted
- **Date**: 2026-09-21
- **Deciders**: Architect, System Lead, Core Maintainers
- **Consulted**: Prompt Engineering Lead, QA Automation, Front-End UI Team
- **Informed**: All DSH Developers, Agent Prompt Authors, Downstream Orchestrators

---

## 1. Context and Problem Statement

### 1.1 Background & Operational Issues

`dsh-call-session` was initially designed with hardcoded Simplified Chinese text across tool definitions, parameter schemas, prompt injections, and runtime exceptions. As the plugin is deployed in diverse environments and accessed by multilingual reasoning models, this approach introduced significant operational friction:

1. **Tool Calling Ambiguity & Token Overhead**: Models running in English-first contexts faced degraded tool-calling comprehension and wasted context tokens due to verbose Chinese schemas.
2. **System Prompt Linguistic Fragmentation**: `usageSectionText` presented an inconsistent mix of English section headers and Chinese explanatory rules.
3. **Hardcoded Frontend Language Branches**: The Web Collaboration Canvas contained ad-hoc conditional branches (`props.locale === 'en' ? ... : ...`) and incomplete English localization.
4. **Unstructured Runtime Error Throwing**: Exceptions were thrown as arbitrary Chinese sentences (e.g. `必须提供 target_session_id 参数`), making programmatic error categorization, automated retry logic, and centralized log auditing fragile.
5. **Absence of Host Alignment**: The plugin lacked awareness of DSH Host locale preferences, ignoring user settings configured in the host Web interface.

### 1.2 Architectural Forces & Constraints

- **Minimalist Runtime Overhead**: Zero heavyweight i18n dependencies; zero impact on Node.js event loop performance.
- **Dual-Layer Separation**: Pure English machine-to-machine schemas (ADR-0005, ADR-0016) while providing localized human/agent summaries.
- **Dynamic System Prompt Agility**: Prompts must update immediately upon host setting changes without requiring plugin or process reboots.
- **Strict Backward Compatibility**: All 250 existing unit and adversarial test cases must continue to pass without regression.

---

## 2. Decision Drivers

- **Driver 1 (Standardized Machine Error Contract)**: Convert all internal exceptions into parseable, bracketed English codes (`[ErrorCode] <english explanation>`).
- **Driver 2 (Clean Single-Language Tool Injections)**: Register tool schemas in the resolved language at startup, eliminating mixed-language noise.
- **Driver 3 (Dynamic Prompt Evaluation)**: Evaluate System Prompt and author reminder text lazily per invocation using the active locale.
- **Driver 4 (Single Source of Truth in Canvas UI)**: Converge all Web visual text onto the `dsh-canvas` locale dictionary, eliminating inline ternary branches.
- **Driver 5 (Deterministic Locale Resolution)**: Cascade smoothly across Host Settings, Plugin Configuration, and Node.js Environment.

---

## 3. Considered Options

### Option 1: Static Bilingual Concatenation in Schemas
- **Description**: Include both Chinese and English in tool descriptions (e.g. `向公共黑板发布数据 / Post data to public blackboard`).
- **Pros**: Trivial implementation; single registration path.
- **Cons**: Severe prompt token waste; distracts smaller LLMs; compromises prompt quality.

### Option 2: Full Pure-English Migration
- **Description**: Convert all schemas, prompts, and UI completely to English, dropping Chinese support.
- **Pros**: Uniform codebase.
- **Cons**: Breaks existing Chinese prompt workflows and degrades user experience for Chinese-speaking operators.

### Option 3 (Chosen): Hierarchical Bilingual Localization with Standardized English Error Codes
- **Description**:
  1. Implement a 3-tier resolution hierarchy: Host Settings -> `config.locale` -> System Environment (`Intl` / `LANG`).
  2. Create modular localization catalogs in `lib/locales/` (`zh.mjs`, `en.mjs`, `index.mjs`).
  3. Register tool schemas in the resolved startup locale while evaluating System Prompts dynamically.
  4. Standardize all thrown exceptions to `[ErrorCode] <english explanation>`.
  5. Localize human-facing summaries (`message` and `output.text`) via dictionary templates.
  6. Clean up Web Canvas UI to rely exclusively on `ctx.locale.bind('dsh-canvas')`.
- **Pros**: Optimal token efficiency; instant responsiveness to UI language switches; deterministic error recovery; zero external dependencies.
- **Cons**: Requires maintaining parallel localization catalogs.

---

## 4. Decision Outcome

Accepted as the definitive localization architecture for `dsh-call-session`.

### 4.1 Canonical Error Codes

- `[InvalidParameter]`: Missing, invalid, or out-of-bounds input arguments.
- `[TargetNotFound]`: Target session ID or prefix cannot be matched or resolved.
- `[SelfCallForbidden]`: Attempting to execute a unicast call targeting the caller session.
- `[AmbiguousPrefix]`: Session prefix matches multiple active sessions.
- `[WildcardForbidden]`: Attempting wildcard dispatch in unicast calls.
- `[RateLimitExceeded]`: Peer session creation rate exceeds quota.
- `[GenerationLimitExceeded]`: Peer session derivation depth reaches ceiling.
- `[QuotaExceeded]`: Concurrent running sessions reach budget.
- `[DuplicateTitle]`: Peer session title collides with an active session.
- `[ReservedTopic]`: Attempting to persist reserved telemetry topic to blackboard.
- `[StorageError]`: Persistence or JSON serialization failure.
- `[ServiceUnavailable]`: Required host capability or agent service unmounted or unavailable.

### 4.2 Primary Code Anchors

- `lib/locales/index.mjs`: Hierarchical locale resolver and dictionary loader.
- `lib/locales/zh.mjs`: Simplified Chinese localization catalog.
- `lib/locales/en.mjs`: English localization catalog.
- `types/locales.d.ts`: Strict TypeScript contract for dictionary parity.
- `index.mjs`: Tool registration dispatch, dynamic prompt hooks, and `config.locale` schema.
- `lib/client.js`: SSOT Canvas dictionary alignment.
- `lib/session-call.mjs`, `lib/session-create.mjs`, `lib/session-directory.mjs`, `lib/board-store.mjs`: Standardized error code enforcement.

### 4.3 Amendments to Prior ADRs

- **Amendment to ADR-0016 (§4.2 & §4.3.2)**: Formally amends the `session_create` output schema to declare optional `message` (`string`, human/agent-readable localized execution summary), maintaining full camelCase naming parity across all tool outputs.
---

## 5. Consequences

### 5.1 Positive Consequences

- **Optimal Prompt Token Density**: Clean single-language tool schemas and system prompts eliminate mixed-language clutter and context wastage.
- **Deterministic Machine Observability**: Bracketed pure-English error codes (`[ErrorCode]`) enable reliable regex parsing, automated error classification, and cluster logging.
- **Immediate Frontend Synchronicity**: Web Canvas UI text updates instantly via `dsh-canvas` dictionaries without requiring process restarts.
- **Zero-Dependency Architecture**: Pure in-memory dictionary resolution avoids introducing bulky third-party i18n runtimes into Node.js event loops.

### 5.2 Negative Consequences & Accepted Tradeoffs

- **Parallel Catalog Maintenance**: Adding or revising a native tool requires updating both `zh.mjs` and `en.mjs` catalogs with 1:1 parity enforced at compile time by TypeScript definitions.

---

## 6. Compliance and Verification

- **Automated Catalog Parity**: `tests/i18n.test.mjs` verifies exact key alignment between `zh` and `en` catalogs across tools, parameters, and messages.
- **Dynamic Language Switching**: Tests assert that switching host settings preference immediately updates dynamically rendered system prompt and context reminder text.
- **Canonical Error Code Verification**: Test suite verifies that all thrown exceptions adhere to the `[ErrorCode]` regex pattern.
- **Regression Baseline**: Full legacy test suite verifies zero functional regression under default locale.

---

## 7. History and Notes

- 2026-09-21: Initial draft proposed and accepted following architecture review and two-axis code review convergence.
