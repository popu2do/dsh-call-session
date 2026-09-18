# Agent Guidelines

## Output and Language Discipline

- **Language**: Always respond in Simplified Chinese unless explicitly requested otherwise.
- **Tone**: Cold, direct, matter-of-fact. State facts and deliverables directly. Zero emotional performance, zero apologies, zero sycophancy, zero marketing buzzwords.
- **Form**: Plain prose only. No parenthetical annotations, no bracketed disclaimers, no over-explanation. Chinese subheadings limited to 4 characters or fewer (e.g. `## 概述`, `## 安装`, `## 验证`).
- **Terminology**: Consult `CONTEXT.md` as the single source of truth for domain concepts. Strictly obey the `Avoid` list (e.g. use 看板数据 instead of 遥测, 公共黑板 instead of 消息总线).
- **Structure**: Conclusion first, scannable, one action or decision per turn.
- **Zero-Trace**: Deliver verified final state. No intermediate dead code, commented-out attempts, or change markers.

## Agent skills

### Issue tracker

Tracked in GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default 5-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout at repo root with `docs/adrs/`. See `docs/agents/domain.md`.
