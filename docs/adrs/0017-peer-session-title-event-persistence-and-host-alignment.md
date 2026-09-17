# ADR-0017: Peer Session Title Event Persistence, Model Parameter Declaration, and Host Alignment Specification

- **Status**: Accepted
- **Date**: 2026-09-12
- **Deciders**: Architect, Core Maintainers, Multi-Agent Runtime Team
- **Consulted**: Code Reviewer, QA Automation Lead
- **Informed**: All DSH Agent Developers, Tool Authors

---

## 1. Context and Problem Statement

### 1.1 Background & Issues

在 `session_create` 创建同级会话（Peer Session）的机制中，存在两项与宿主设计及调用预期不一致的问题：

1. **同级会话标题在 Web GUI 中默认回退为工作区目录名**：
   - 当调用方通过 `session_create` 创建同级会话时，无论入参是否指定 `title` 或提供 `initial_message`，在 Web 界面与会话列表侧边栏中，新建的会话依然显示为工作区目录名称（例如 `dsh-call-session`）。
   - 根本原因分析：DSH 宿主前端会话列表（`dsh-api-session-controller`）通过 `displayTitleOf(title, cwd, id)` 渲染标题。若会话日志中没有记录标题，`title` 为 `undefined`，系统自动回退显示为工作目录名称（`workspaceTitleOf(cwd)`）。
   - DSH 宿主的标题管理（`@deepseek-ai/dsh-session-title`）基于纯增量事件驱动模型，标题状态由会话事件日志（Event Log）中的 `session/title` 事件投影决定。
   - `session_create` 在创建目标会话时，仅在内存中给 `targetAgent.title` 及 `targetAgent.session.title` 赋值，**未向目标会话的日志追加 `session/title` 事件**；且首条初始任务消息标记为插件源（`source.kind: 'plugin'`），被宿主内置的自动标题服务过滤（该服务仅响应 `source.kind: 'user'` 的人类输入）。因此新建会话缺少标题事件，导致前端持续显示工作区目录名。

2. **模型参数与预设参数声明缺失**：
   - ADR-0015 已定义模型参数与预设能力的继承规范（优先入参覆写 -> 其次继承创建者 -> 最后全局回退），底层逻辑也已在 `resolvePeerAgentOptions` 中实现。
   - 但在向大模型声明的工具入参 Schema 中，遗漏了 `reasoning_effort` 与 `preset` 字段的声明，且工具说明文案未明确告知“默认继承当前会话的模型参数与预设配置，除非手动指定”，导致调用方在需要差异化配置时缺乏明确指导。

### 1.2 Architectural Forces & Constraints

- **Plugin Boundary Isolation**：所有修复严格限制在当前插件代码作用域内，严禁修改任何插件外部的宿主或依赖库代码。
- **Immutable Event Log Standard**：遵循 DSH 会话日志只追加（Append-Only）原则，标题变更必须通过合法的 `session/title` 事件记录。
- **Zero Ambiguity Parameter Contract**：严格遵守 ADR-0016，入参统一为 `snake_case`，出参统一为 `camelCase`，禁止使用双轨别名。

---

## 2. Decision Drivers

- **Driver 1 (Immediate Title Visibility)**：确保通过 `session_create` 创建的新会话在 Web 界面上立即呈现确定的规范化标题，避免回退为默认工作区目录名。
- **Driver 2 (Log-Backed Durability)**：标题记录在会话事件日志中，在会话回放、持久化恢复和分页加载中均能准确还原。
- **Driver 3 (Explicit Capability Declaration)**：在工具定义中完整暴露 `model`、`reasoning_effort` 与 `preset`，并明确说明继承规则，消除调用歧义。

---

## 3. Considered Options

### Option 1: 仅依赖内存属性并期待宿主捕获（Status Quo）
- **描述**：仅设置 `targetAgent.title`，不向日志写入事件。
- **否决原因**：宿主基于 Event Log 做持久化与投影，内存赋值无法触发 `session/title` 投影更新，导致前端永久显示工作区名称。

### Option 2: 将初始任务消息强制伪造成人类消息（`source.kind: 'user'`）
- **描述**：将初始任务指令的来源改为人类用户，触发宿主内置的 `dsh-session-title-first-prompt-llm` 自动提炼标题。
- **否决原因**：
  - 破坏调用溯源语义（该消息确实是由插件协同分发的，伪造成用户消息会破坏审计与安全边界）；
  - 自动提炼具有异步延迟和不确定性，无法保证调用方显式传入的 `title` 得到优先保障。

### Option 3 (Chosen): 直接追加 `session/title` 日志事件 + 完善 Schema 声明
- **描述**：
  1. `session_create` 在创建目标会话后，通过目标会话句柄向事件日志直接追加 `session/title` 事件（`session.append('session/title', ...)`），若宿主存在 `ctx.sessionTitle.rename` 则优先复用；
  2. 在 `index.mjs` 中补全 `reasoning_effort` 与 `preset` 的 Schema 定义与描述，同步更新类型定义。
- **采纳优势**：
  - 符合 DSH 日志事件设计规范；
  - 标题即时生效并持久化到事件日志；
  - 作用域严格收敛在插件内部。

---

## 4. Decision Outcome

**Chosen Decision**: 采纳 Option 3。

### 4.1 核心架构不变式（Architectural Invariants）

1. **Invariant 1 (Title Event Persistence Invariant)**：
   `session_create` 在创建目标同级会话后，必须确保目标会话事件日志中存在一条对应的 `session/title` 事件。
   - 若宿主注册了 `sessionTitle` 服务且支持 `rename`，优先调用 `ctx.sessionTitle.rename(targetSession, finalTitle)`；
   - 若未加载该服务，则直接调用 `targetSession.append('session/title', { title: finalTitle, messageSeqs: [], source: { kind: 'user' } })`，确保日志中具备标准标题事件。

2. **Invariant 2 (Model & Effort Inheritance and Override Invariant)**：
   同级会话创建时，默认继承创建方当前使用的模型（`model`）、推理强度（`reasoning_effort`）及预设（`preset`）。当调用方显式传入参数时，覆盖对应配置。

3. **Invariant 3 (Strict Input Schema & Naming Invariant)**：
   工具入参遵循 ADR-0016 规范，明确声明 `title`、`initial_message`、`context_post_ids`、`model`、`reasoning_effort`、`preset`，严禁引入驼峰别名。

---

### 4.2 数据流拓扑

```
                     [ session_create(title, model, ...) ]
                                       │
                                       ▼
                     resolvePeerTitle / resolvePeerAgentOptions
                                       │
                                       ▼
                           agentsService.create(...)
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   targetAgent.session 创建就绪 │
                       └───────────────┬───────────────┘
                                       │
                                       ▼ (Invariant 1)
                     session.append('session/title', { title: finalTitle })
                                       │
                                       ▼
                     dispatchNativeMessage(targetAgent, initialMessage)
                                       │
                                       ▼
                     前端与会话列表即时感知 session/title，正确显示 finalTitle
```

---

## 5. Consequences

### 5.1 Positive Consequences
- 新建的同级会话在 Web 界面和侧边栏中立即呈现清晰准确的标题，不再回退显示工作区目录名。
- 调用方可以灵活选择继承创建者模型或指定专属模型与推理强度。
- 遵循 DSH 规范，日志事件具备完整回放与持久化能力。

### 5.2 Verification Suite
- `tests/session-create.test.mjs`：增加断言验证新建会话日志包含 `session/title` 事件，验证模型继承与入参覆写。
- `tests/session-create-adversarial.test.mjs`：覆盖异常边界。

---

## 6. Status History & Related Artifacts

- **2026-09-12**: Proposed and Accepted.
- **Related ADRs**:
  - Amends & Complements: [ADR-0010](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md)
  - Amends & Complements: [ADR-0015](./0015-peer-session-model-and-preset-inheritance.md)
  - Follows: [ADR-0016](./0016-unified-parameter-naming-and-session-id-standard.md)
- **Primary Implementation Files**:
  - `lib/session-create.mjs`
  - `index.mjs`
  - `types/session-create.d.ts`
  - `tests/session-create.test.mjs`