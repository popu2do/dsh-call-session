# ADR-0022: Verifiable Architecture Topology Artifacts and Agent Discipline Decoupling

- **Status**: Accepted
- **Date**: 2026-09-18
- **Deciders**: Architect, Engineering Team, Documentation Maintainers
- **Consulted**: Multi-Agent Ops, System Performance Team
- **Informed**: All Plugin Contributors, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context

随着 `dsh-call-session` 演进为覆盖前端画布、进程内单播分发、公共黑板状态存储与宿主会话调度的多子系统架构，团队需要对全局拓扑进行端到端可视化与架构归档。在此过程中暴露出两项结构性阻抗：

1. **预提交门禁目录白名单过于死板**：
   `.githooks/pre-commit` 此前配置了仅放行 `docs/(adrs/|agents/|README.md)` 的硬性白名单。由 Archify 生成的可验证架构规范文件与离线交互式 HTML 交付物缺少合法存放路径，导致提交被门禁无条件拦截。
2. **智能体文风治理规范与加载层级错位**：
   此前在 `ADR-0009` 中记录了文档防 AI Slop、去表情符号、去伪学术黑话与四字子标题规范。然而依据 Matt Pocock 的信息阶梯理论（Information Hierarchy），ADRs 属于按需惰性读取（Disclosed Reference），智能体在常规会话中根本不会主动加载 `ADR-0009`，导致文风规范在运行态对 LLM 彻底失效。

### 1.2 Architectural Forces & Constraints

- **Verifiable Topology Baseline**：架构图表必须具备机器可验证性（Archify Showcase 标准验证与交付收据），严禁提交未经检验的手写草图。
- **Zero-Trace VCS Hygiene**：自动化测试产生的临时快照与检测报告（如 `*.visual-check.*`）不得污染版本控制仓库。
- **Information Hierarchy Realignment**：对智能体的行为、文风与输出纪律必须驻留在常驻上下文（Context Load，即 `AGENTS.md`），而 ADR 仅作为历史决策证据。

---

## 2. Decision Drivers

- **Driver 1 (Legitimate Architecture Asset Ingestion)**：在 `docs/architecture/` 下合法收容机器可验证的架构源定义与交互式单文件 HTML 交付物。
- **Driver 2 (Automated Pre-Commit Whitelist Alignment)**：修正 `.githooks/pre-commit` 白名单正则，在保持严格防御的同时放行架构目录。
- **Driver 3 (Context Load Realignment for Agent Discipline)**：将冷峻客观、纯文本无括号注解、四字子标题、对齐 `CONTEXT.md` 等运行态纪律由 `ADR-0009` 正式提炼沉淀至根目录 `AGENTS.md`，确保每轮推演无条件生效。
- **Driver 4 (Historical Evidence Separation)**：明确 `docs/adrs/` 纯粹作为架构决策历史档案，消除“试图以 ADR 约束 LLM 交互”的认知偏差。

---

## 3. Considered Options

### Option 1: 将架构图视作临时产物存入 `.scratch/`
- **Pros**: 无需修改 `pre-commit` 钩子。
- **Cons**: 丢失版本控制能力，无法作为团队统一审阅与随代码演进的架构资产。

### Option 2: 在系统提示词中强制智能体每轮读取 `ADR-0009`
- **Pros**: 无需调整 `AGENTS.md`。
- **Cons**: 严重消耗上下文 Token（Context Load 膨胀），引发额外文件读取时延，且容易因注意力稀释导致执行不稳定。

### Option 3 (Chosen): 预提交白名单放行架构目录 + 运行态纪律沉淀至 `AGENTS.md`
- **Pros**:
  - 架构资产具备完整的 Git 版本追踪与 Showcase 门禁保障。
  - 临时副作用通过 `.gitignore` 干净隔离。
  - 智能体文风约束即时在根目录 `AGENTS.md` 全局生效，彻底解决 ADR 无法约束模型输出的问题。

---

## 4. Decision Outcome

1. **白名单放行**：`.githooks/pre-commit` 正则更新为 `^docs/(adrs/|agents/|architecture/|README\.md$)`。
2. **测试副作用忽略**：`.gitignore` 追加 `docs/architecture/*.visual-check.*` 规则。
3. **输出纪律提炼**：在根目录 `AGENTS.md` 设立 `## Output and Language Discipline` 专属章节，作为智能体运行态常驻准则。
4. **决策档案解耦**：`ADR-0009` 追加不变量说明，明确其作为历史决策证据的定位，操作执行委托至 `AGENTS.md`。

---

## 5. Consequences

### Positive
- 系统架构图成为仓库第一公民，具备 9 项静态约束检查门禁；
- 智能体输出文风具备常驻硬约束，即时生效且不依赖外部文件读取；
- 清理了对 ADR 消费机制的误解，符合标准工程信息阶梯。

### Neutral
- 架构变更时需同步重新运行 Archify 校验并交付 HTML 产物。
