# Spec 014: 深层消息传输与因果校验规范

- **Status**: Ready for Agent
- **Label**: ready-for-agent
- **Date**: 2026-10-30
- **Governing ADRs**: ADR-0006, ADR-0010, ADR-0016, ADR-0024, ADR-0029, ADR-0031, ADR-0036
- **Glossary**: CONTEXT.md

## 背景说明

在既有实现中，跨会话消息派发与因果状态确认逻辑分散在不同模块，存在两项核心架构缺陷：

第一，握手轮询逻辑重复实现。单播调用模块 lib/session-call.mjs 与会话创建模块 lib/session-create.mjs 分别实现了一套完全相同的 15 毫秒等待轮询循环，包括起始事件快照、截止时间计算、异常扫描以及最终超时状态收敛。两处实现各自占用约 70 行样板代码，不仅产生维护负担，也在后续协议演进时容易引入行为漂移。

第二，模块职责边界倒置。lib/session-directory.mjs 本质属于会话目录与生命周期发现模块，却承载了 checkCausalRunning 与 checkCausalRunningFinal 这两项面向单次通信投递因果效应的检查函数；而 lib/native-message-transport.mjs 作为原生消息传输层，职责止步于报头装配与单次通道分发，未能提供投递后的因果确认闭环。调用方不得不自行拼接底层状态查询与因果检查函数。

## 方案设计

深层模块重构方案聚焦于通信原语的完整闭环与下沉收敛：

第一，传输层能力深层深化。将投递后的物理因果等待与状态收敛逻辑下沉至 lib/native-message-transport.mjs，新增统一的 waitForCausalExecution 原语。该函数封装 15 毫秒微轮询循环、装配期异常即刻捕获、运行态因果推进判定与超时收敛，向上层输出标准化的投递状态元组。

第二，提供复合派发与确权原语。在传输层暴露 dispatchAndVerifyNativeMessage，在执行消息分发前后自动采集基线因果指标，并根据配置无缝执行因果等待，供调度与引导层单点调用。

第三，因果检查函数物理归位与向后兼容。将 checkCausalRunning、checkCausalRunningFinal 以及相关计数提取逻辑迁移至 lib/native-message-transport.mjs。同时在 lib/session-directory.mjs 中保留同名符号重导出，确保既有外部调用方与类型定义零破坏。

第四，调用方瘦身与门面统一。重构 lib/session-call.mjs 与 lib/session-create.mjs，移除内联的重复轮询与状态判定分支，统一委托传输层提供的深层接口完成因果校验与状态归一。

## 场景故事

1. 作为单播调用模块的维护者，我希望消息派发后的因果确权逻辑由底层传输模块整体承接，使单播调用逻辑专注于参数校验、连线记录与业务调度，避免侵入底层相态轮询细节。
2. 作为会话创建模块的维护者，我希望在携带初始任务启动同级会话时，能够直接复用与单播调用完全一致的传输层确权逻辑，杜绝两处握手超时与异常捕获的行为差异。
3. 作为架构审查人员，我希望因果检查函数的物理归属与其功能职责完全匹配，即所有消息传递相关的协议校验集中于传输层，会话目录模块纯化为只关注会话发现、身份解析与相态快照。
4. 作为大模型调用方，我希望无论通过哪个工具派发任务，接收方在提示词装配崩溃时都能在握手窗口期内被确定性捕获，并收到类别、代码与上下文一致的结构化错误。
5. 作为下游测试维护者，我希望能够对深层传输层的因果等待逻辑编写独立、无副作用的单元测试，涵盖正常推进一步、多次步进、装配崩溃以及超时降级等各类边界。
6. 作为插件生态集成方，我希望 session-directory.mjs 的导出契约保持 100% 兼容，无需改动任何历史调用代码。

## 实施决策

### 接口契约

在 lib/native-message-transport.mjs 中新增如下核心导出：

1. waitForCausalExecution(targetAgent, options)
   入参 options 规格：
   - waitMs：最大等待毫秒数，支持 0 至 5000 范围，默认由相态或事件存在性推导（300 毫秒或 0 毫秒）
   - pollIntervalMs：轮询探测步进间隔，默认为 15 毫秒
   - initialTargetRunning：投递前目标是否已处于运行态
   - initialStepCount：投递前 targetAgent.phase.step
   - initialStepStartCount：投递前 step/start 事件数量
   - initialTurnCount：投递前 targetAgent.phase.turn
   - initialTurnEndCount：投递前 turn/end 事件数量
   - resolveStatus：状态解析器注入函数，默认使用 resolveNativeSessionStatus
   返回值格式：
   - deliveryState：取值为 delivered、enqueued 或 failed
   - executionState：取值为 running、pending、crashed 或 unverified
   - executionError：分类错误对象或 null
   - finalStatus：目标最终相态（running、idle 或 error）

2. dispatchAndVerifyNativeMessage(targetAgent, userMessage, options)
   入参：
   - targetAgent：目标会话实例
   - userMessage：DSH 原生消息对象
   - options：包含 waitMs 等校验参数的配置对象
   执行流：
   - 自动在分发前抓取 targetAgent 的 events 快照与 turn、step、turnEnd 计数
   - 调用 dispatchNativeMessage(targetAgent, userMessage) 执行原生通道分发
   - 若 waitMs 大于 0，调用 waitForCausalExecution 并返回复合结果
   - 若 waitMs 为 0 或不支持等待，返回默认的 delivered 与 unverified 状态

3. checkCausalRunning 与 checkCausalRunningFinal
   从 lib/session-directory.mjs 完整搬迁至 lib/native-message-transport.mjs，维持完全一致的函数签名与判定逻辑。

### 模块解耦

1. lib/session-directory.mjs：
   - 移除 checkCausalRunning、checkCausalRunningFinal 与 extractCausalCounters 的物理实现；
   - 通过 import 从 ./native-message-transport.mjs 导入并重新 export 该两项函数；
   - 下沉 resolveNativeSessionStatus 与 classifyError 至 native-message-transport.mjs（阻断与 session-directory 循环依赖），由 session-directory 重新导出。

2. lib/session-call.mjs：
   - 从 ./native-message-transport.mjs 导入 waitForCausalExecution 或 dispatchAndVerifyNativeMessage；
   - 移除内联的 70 余行 while 轮询与计数器比对代码；
   - 将 task_dispatch 分支下的握手判定替换为对深层传输层接口的单点调用。

3. lib/session-create.mjs：
   - 从 ./native-message-transport.mjs 导入 waitForCausalExecution 或 dispatchAndVerifyNativeMessage；
   - 移除同级会话创建后内联的 70 余行重复轮询逻辑；
   - 统一收敛为对传输层原语的调用。

4. 类型定义同步：
   - 更新 lib/native-message-transport.d.ts，补全新增导出符号与接口定义；
   - 保持 types/session-directory.d.ts 对 checkCausalRunning 等函数的声明有效性。

## 测试策略

### 核心覆盖

1. 传输层因果等待独立单测：
   - 验证目标正常推进时（phase.step 自 0 变 1，或新增 step/start 事件），在等待窗口内成功确权并返回 running；
   - 验证目标初始已处于 running 时，需观测到步进计数增加才签发因果确权；
   - 验证目标在装配期抛出错误时（新增 turn/end 且其 reason 为 error），即刻中断轮询并返回 crashed 状态与分类错误；
   - 验证等待超时时，平滑收敛为 enqueued 与 pending 状态；
   - 验证 waitMs 为 0 时直接退出不产生无效延时。

2. 兼容性与集成回归：
   - 运行 tests/native-message-transport.test.mjs，验证新接口；
   - 运行 tests/session-directory.test.mjs，验证重导出符号可用性；
   - 运行 tests/session-call.test.mjs 与 tests/session-create.test.mjs，确保现有 106 个端到端用例 100% 绿灯无回归；
   - 执行静态类型检查与代码风格检查。

## 范围边界

1. 不修改 DSH 宿主内部的 phase 流转机制与事件分发调度器。
2. 不调整看板对会话与调用连线的渲染算法与数据结构。
3. 不变更传输层报头的格式与序列化规约。
4. 不破坏任何既有模块导出的公共方法签名与返回值字段命名。

## 补充说明

本规格实施后，跨会话调用的底层时序流将由统一的传输基础设施完全闭环，彻底消除由于各业务模块自行实现轮询而带来的潜在竞争与时序差异。
