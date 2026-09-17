# ADR-0021: Concurrent Running Quota and Model Inheritance Alignment

- **Status**: Accepted
- **Date**: 2026-09-20
- **Deciders**: Architect, Core Maintainers
- **Informed**: Multi-Session Operators

---

## 1. Context and Problem Statement

同级会话创建（`session_create`）用于派生同工作区并行会话。原实现存在两个设计与行为偏差：

1. **配额统计口径偏差**：
   原配额以工作区内未归档会话数为统计口径（上限 10 个）。已结束任务的空闲会话（`status === 'idle'`）未显式归档时持续计入配额，导致无运行负载时新会话被误拒。配额设计目标为限制同时运行的会话数量，统计口径应以正在运行（`status === 'running'`）的会话为准，并将上限收敛至 5 个。
2. **派发会话模型能力未对齐**：
   调用方运行时请求头动态指定的模型配置（如模型名称、推理强度）未完整传递给新会话，导致派发出的会话退化为全局默认配置。

---

## 2. Decision Outcome

确立以下并发配额与模型继承规范：

### 2.1 运行态并发配额与在途创建防超发

1. **配额上限调整**：
   单工作区并发运行根会话上限调整为 5：
   ```javascript
   PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS = 5;
   PEER_SESSION_CONSTANTS.MAX_CONCURRENT_RUNNING_PEER_SESSIONS = 5;
   ```
2. **配额统计与标题去重解耦**：
   在 `SessionDirectory.prototype.inspectWorkspace` 中分离统计逻辑：
   - 配额计数（`count`）：仅统计 `agent.status === 'running'` 的根会话，空闲会话与归档会话不计入。
   - 标题集合（`activeTitles`）：收集所有未归档会话标题，用于防重名推导。
3. **在途创建防超发**：
   在底层创建完成前，通过 `inFlightCreationsByWorkspace` 登记在途请求，并发计算为 `activeCount + inFlightTitles.size`。当总数达到 5 时同步拒绝：
   ```
   [QuotaExceeded] 当前工作区并发运行会话数已达上限 5，无法创建新会话。
   ```

### 2.2 派发会话模型与推理强度继承

在 `resolveCallerAgentOptions` 中建立模型配置解析链路：

1. 优先读取调用方运行时的动态请求头配置：`callerAgent.session.requestHeader?.().config`。
2. 若无动态配置，依次回退至调用方静态选项（`callerAgent.options`、`callerAgent.agentOptions`）及宿主默认配置（`ctx.agentDefaultModel`）。
3. 显式入参（`args.model`、`args.reasoning_effort`）具有最高优先级。

---

## 3. Invariants & Guardrails

- **不变量 1**：单工作区内处于 `running` 态的根会话与在途创建请求之和不超过 5。
- **不变量 2**：处于 `idle` 态的空闲会话不占用并发配额。
- **不变量 3**：未显式传参覆写时，新建会话继承调用方当前生效的模型与推理强度。

---

## 4. Consequences

### Positive
- 空闲会话不再阻塞新同级会话创建。
- 单工作区并发运行上限设为 5，有效约束并发计算资源开销。
- 新建会话自动与调用方的模型能力对齐。

### Verification Criteria
- 单元与集成测试全量通过（`tests/session-directory.test.mjs`、`tests/session-create.test.mjs`、`tests/peer-session-factory.test.mjs`、`tests/e2e-adversarial.test.mjs`）。
