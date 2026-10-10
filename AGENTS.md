# Agent Guidelines

## Repository Discipline

- **Headings**: Chinese subheadings <= 4 characters (`## 概述`, `## 安装`, `## 验证`).
- **Domain vocabulary**: Consult `CONTEXT.md` as single source of truth; strictly obey the `Avoid` list.
- **Live verification**: Mock tests do not constitute live proof. Live acceptance requires physical disk artifacts, matching tool return values, and live host state.

## Agent Skills

- **Issue tracker**: GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels**: Canonical 5-label vocabulary. See `docs/agents/triage-labels.md`.
- **Domain docs**: Root `CONTEXT.md` and `docs/adrs/`. See `docs/agents/domain.md`.
