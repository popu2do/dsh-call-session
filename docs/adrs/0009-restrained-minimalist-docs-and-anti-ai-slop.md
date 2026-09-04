# ADR-0009: Restrained Minimalist Technical Documentation and Anti-AI-Slop Governance

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Documentation Team, Core Contributors
- **Consulted**: Open Source Developers, Plugin Community
- **Informed**: All DSH Plugin Users, Subagents, Downstream Consumers

---

## 1. Context and Problem Statement

### 1.1 Background & Friction
As `dsh-call-session` evolved into version 0.1.0, the accompanying user documentation (`README.md` and `README_ZH.md`) suffered from severe "AI slop" accumulation and marketing fluff:
- **Excessive Visual Noise**: Decorative emojis and pseudo-graphic symbols cluttering titles and tables.
- **Pretentious Jargon**: 18 pseudo-academic and politically loaded metaphors (such as "两权分立", "消息血统", "架构哲学", "原子持久化流", "物理沙箱杜绝串扰").
- **Exposing Internal Implementations**: 78 lines of internal Mermaid sequence diagrams and 20-line raw debug JSON dumps presented to end-users who only needed API contracts.
- **Patronizing & Sales Pitch Tone**: "这是个什么插件、解决什么小痛点、怎么装怎么用" and promotional buzzwords ("革命性", "开箱神器", "彻底杜绝").
- **Heading Bloat**: Verbose Chinese headings (12-16 characters) violating classical Chinese technical writing brevity.

### 1.2 Architectural Forces & Constraints
- **Cognitive Load**: Readers should establish a complete mental model within 60 seconds without wading through marketing prose.
- **Developer Respect & Equality**: Quiet, objective, peer-to-peer technical communication that respects the reader's judgment and tool choice.
- **Bilingual Symmetry**: Strict 1:1 line and structural parity between English and Chinese documentation.
- **Code-Truth Alignment**: Documentation examples must be 100% physically runnable against the actual codebase without parameter discrepancy.

---

## 2. Decision Drivers

- **Driver 1 (Radical Subtraction)**: Purge all decorative emojis, pseudo-symbols, and fragmented horizontal dividers (`---`).
- **Driver 2 (Anti-Slop & Anti-Jargon)**: Replace inflated buzzwords with concrete, standard software engineering terms.
- **Driver 3 (Chinese Heading Restraint)**: Enforce a strict limit of <= 4 characters for Chinese subheadings (`## 简介`, `## 安装`, `## 用法`, etc.).
- **Driver 4 (Domain Separation)**: Strip internal retry and debouncing implementation details from README and relocate them into ADRs.
- **Driver 5 (Verification Gates)**: All code snippets and CLI commands in docs must pass automated end-to-end execution.

---

## 3. Considered Options

### Option 1: Status Quo (Promotional AI-Generated Style)
- **Pros**: Easy to generate, visually loud.
- **Cons**: High cognitive load, condescending tone, rapidly dates the project, screams AI slop.

### Option 2: Ultra-Compressed Telegram Style (Caveman Mode)
- **Pros**: Minimizes token count by up to 75%.
- **Cons**: Unsuitable for open-source human readers; destroys prose flow, nuance, and usability.

### Option 3 (Chosen): Restrained Minimalist Technical Documentation
- **Pros**:
  - Pure plain-text Markdown without emojis or layout gimmicks.
  - Subheadings strictly <= 4 Chinese characters, adhering to classical technical aesthetics.
  - 55% reduction in size (from 537 lines down to 241 lines) with 100% preservation of technical contracts.
  - Honest, humble ecosystem comparison that recommends native DSH features first.
- **Cons**: Requires disciplined curation and automated linting/review pipelines.

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Restrained Minimalist Technical Documentation.

### 4.1 Invariants
1. **Zero Emoji Invariant**: Exactly 0 Unicode pictographs and pseudographics across all documentation.
2. **Four-Character Heading Invariant**: Level 2 and Level 3 Chinese headings must not exceed 4 characters.
3. **Plain Technical Language Invariant**: Forbid metaphorical jargon. Use "单播呼叫" (unicast call) and "共享黑板" (shared board).
4. **Architectural Separation Invariant**: Detailed state-machine diagrams and lock retry mechanisms belong in `docs/adrs/`, not in the user README.
5. **Ecosystem Modesty Invariant**: Explicitly inform users to prefer native DSH capabilities (such as built-in `subagent` process-internal delegation) for single-task delegation before introducing cross-session coordination.

### 4.2 Documentation Structural Specification

User-facing documentation (`README.md` and `README_ZH.md`) must strictly adhere to a standardized five-section layout:
1. **Overview / 简介**: Concise definition and scope of the plugin without marketing hyperbole.
2. **Installation / 安装**: Zero-friction setup via the global profile bundle (`cordis.patch.yml`).
3. **Usage / 用法**: Minimalist, copy-pasteable examples for tools and slash commands.
4. **Comparison / 对比**: Objective distinction between native process-internal `subagent` delegation and cross-session unicast/board coordination.
5. **Invariants / 规范**: Explicit system boundaries and zero-trace engineering discipline.

---

## 5. Consequences

### Positive
- Readers grasp the core utility of `dsh-call-session` in under 15 seconds.
- Tone is calm, professional, and peer-to-peer.
- Maintenance overhead is halved due to reduced surface area.
- Parameters and tool calls are physically verified and bug-free (fixed `board_list` parameter mismatch).

### Neutral
- Authors must resist the impulse to re-introduce decorative styling or conversational sales hooks during future releases.
