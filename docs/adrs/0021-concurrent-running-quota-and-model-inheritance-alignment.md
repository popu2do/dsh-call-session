# ADR-0021: Concurrent Running Quota and Model Inheritance Alignment

- **Status**: Accepted
- **Date**: 2026-09-20
- **Deciders**: Architect, Core Maintainers
- **Informed**: Multi-Session Operators, Autonomous Agent Teams

---

## 1. Context and Problem Statement

同级会话创建（`session_create`）在多 Agent 协同体系中承担动态扩展并行工作节点的核心职责。在既有实现中，存在两个阻碍工程实用性的核心问题：

1. **配额口径误判与空闲会话阻断**：
   原系统将工作区配额定义为“未归档会话数不超过 10 个”。由于已完成执行任务的同级会话在宿主生命周期中处于 `status === 'idle'` 状态且未显式归档，导致历史累积的空闲会话持续挤占配额。当工作区累积了 10 个已停止运行的会话时，即使当前仅有 1 个正在执行的调用方，新建同级会话也会被误判拦截（`[QuotaExceeded] 当前工作区活跃同级会话数已达上限 10`）。用户明确指出该行为不符合防爆设计初衷：配额防线旨在防止 LLM 失控瞬时派生大量并发会话，应严格以**并发运行中（running）**为准，同时将并发上限收敛至更严格的 5 个。
2. **派发会话模型能力脱节**：
   当调用方在运行时经由动态请求头路由至特定高阶模型（如 `gemini-3.8-flash-high` 或伴随特定 `reasoning_effort`）时，派发出的同级会话未完全穿透继承调用方当前的实际模型配置，导致协同会话退化为低配默认模型。

---

## 2. Decision Outcome

我们确立以下并发运行配额与模型继承对齐规范：

### 2.1 基于运行态（Running-Only）的并发配额收敛与 TOCTOU 预占

1. **配额阈值收敛至 5**：
   将工作区并发会话配额从 10 降为 5：
   ```javascript
   PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS = 5;
   PEER_SESSION_CONSTANTS.MAX_CONCURRENT_RUNNING_PEER_SESSIONS = 5;
   ```
2. **配额计数与标题去重解耦（Decoupled Inspection）**：
   在 `SessionDirectory.prototype.inspectWorkspace` 中对计数口径与标题收集严格解耦：
   - **配额计数 (`count`)**：仅统计 `agent.status === 'running'` 的根会话；已完成工作的 `idle` 会话与已归档会话一律不计入并发配额。
   - **标题集合 (`activeTitles`)**：持续收集工作区内所有未归档会话的标题，以保障 Web UI 与历史会话标题命名防碰撞。
3. **并发创建预占位防范 TOCTOU 竞争 (ADR-0010 Invariant)**：
   检查并发配额时计算 `effectiveActiveCount = activeCount + inFlightTitles.size`。当 `effectiveActiveCount >= 5` 时同步抛出标准异常：
   ```
   [QuotaExceeded] 当前工作区并发运行会话数已达上限 5，无法创建新会话。
   ```

### 2.2 派发新会话的动态模型与推理强度继承管线

在 `resolveCallerAgentOptions` 中建立全链路穿透继承：

1. **动态请求头配置优先**：
   优先读取调用方会话的运行时请求头动态配置：
   `callerAgent.session.requestHeader?.().config`（包含 `provider`、`model`、`reasoning_effort` / `reasoningEffort`）。
2. **静态选项多级回退**：
   若无动态请求头，依次探测 `callerAgent.provider` / `callerAgent.model` / `callerAgent.reasoningEffort`、`callerAgent.options` 及 `callerAgent.agentOptions`。
3. **显式入参最高优先级**：
   工具调用显式传入的 `args.model` 与 `args.reasoning_effort` 始终拥有最高优先级。

---

## 3. Invariants & Guardrails

- **不变量 1 (Quota Bounded by Running)**：工作区内并发处于 `running` 态的根会话数与在途创建数之和永远不得超过 5。
- **不变量 2 (Zero Idle Starvation)**：只要并发运行会话数未达 5，即使工作区存在大量历史空闲（`idle`）会话，也绝不阻塞新会话创建。
- **不变量 3 (Model Affinity)**：在未显式传参覆写的情况下，新派发的同级会话必须 100% 继承创建方当前所使用的模型家族、模型标识及推理强度。

---

## 4. Consequences

### Positive
- 彻底解决因历史会话残留导致的虚假配额耗尽阻断。
- 并发运行上限由 10 收敛至 5，更严密地限制了 Agent 异常时的失控扩散爆炸半径。
- 协同会话自动对齐调用方的模型智能等级与推理能力。

### Verification Criteria
- 单元测试 `tests/session-directory.test.mjs`、`tests/session-create.test.mjs`、`tests/session-create-adversarial.test.mjs`、`tests/peer-session-factory.test.mjs`、`tests/e2e-adversarial.test.mjs` 全量通过（250/250）。
- 在真实 DSH 宿主环境下调用 `session_create` 执行同级会话创建验证。
