<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0042: 呼叫类型重构与汇报义务协议

- **Status**: Accepted
- **Date**: 2026-11-03
- **Deciders**: Architect, Engineering Team
- **Consulted**: Core Contributors
- **Informed**: All Plugin Users, Downstream Subagents

---

## 概述

跨会话单播通信中，原有呼叫类型存在语义模糊、闭环责任缺失与连线衰减误导等缺陷。本文档确立全新的四态呼叫类型枚举（`notice`、`task_soft`、`task_hard`、`task_report`），彻底废弃并拒绝原 `task_dispatch`；引入内存未结任务账本（Pending Task Ledger）与严格 1:1 先进先出（FIFO）结算机制；在会话每步执行前注入系统上下文提醒，并在轮次结束时通过停机拦截守卫阻断未履约的 `task_hard` 提早退出；在看板中将未履约连线维持流动脉冲，直至汇报落定后平滑衰减。

---

## 背景

在先前的跨会话单播协作实现中，存在以下架构问题：
1. **呼叫意图混淆**：`task_dispatch` 承担了从建议、轻量通知到强约束子任务的多重语义，接收方无法通过类型区分自身是否负有必须回传成果的硬性义务，经常导致协作半途截断或接收方直接停机。
2. **闭环状态不可追溯**：调用内存环形缓冲区仅记录静态调用事件，未跟踪跨会话任务的待办状态与生命周期，无法得知某次任务派发是否已收到对等答复。
3. **静默遗忘与提前退出**：当接收方智能体在多步执行后忘记回传成果时，宿主无感知，智能体可能直接输出纯文本后结束轮次，导致发起方无限期盲等。
4. **看板视觉误导**：先前的连线衰减逻辑纯粹基于时间窗口，即便派发的任务尚未完成，连线也在 15 秒后直接消失或弱化为静态虚线，失去了作为协作看板的过程指示意义。

---

## 驱动

- **类型语义正交**：彻底分离单向知悉、弹性任务、强制任务与结果闭环，杜绝歧义。
- **确定性闭环契约**：单任务单汇报（1:1 FIFO），以最小心智负担保障职责清晰与账本自愈。
- **零侵入上下文提醒**：复用原生 `systemPrompt.context`（如 `task:remind`），在每步推理前让智能体保持义务上下文，杜绝提示词硬编码。
- **强屏障防丢单**：对 `task_hard` 施加轮次停机拦截，未履约前强制追问，并在预算耗尽后优雅兜底。
- **看板态射映射真实**：视觉连线生命周期与真实履约状态完全绑定，未结任务持续脉冲流动，汇报到达后淡化衰减。

---

## 选型

### 方案一
- **描述**：允许旧有的 `task_dispatch` 作为 `task_soft` 的别名共存。
- **缺陷**：造成契约漂移与历史包袱，调用方继续滥用模糊语义，破坏新协议的确定性要求。

### 方案二
- **描述**：在 `task_report` 中传入关联的任务 ID 数组，支持多任务合并汇报或部分结算。
- **缺陷**：大幅增加智能体认知负荷与参数编排复杂度，多智能体协议极易因 ID 错漏引发卡死。

### 方案三
- **入选**：严格正交四态与 1:1 FIFO 结算。
- **描述**：入参严格限定为 `notice | task_soft | task_hard | task_report`，彻底拒绝 `task_dispatch`；引入内存轻量队列，`task_report` 按 FIFO 自动结算单一未结任务；结合前置上下文与停机守卫形成双重保障。
- **优势**：极简透明，模型零配置即可天然闭环；彻底消除遗留歧义。

---

## 决策

### 原语

`session_call` 入参 `call_type` 严格限定为四态：
- `notice`：单向状态通报，纯通知属性，无汇报义务，接收方无需回复。
- `task_soft`：弹性任务。派发建议、前置准备或轻量任务，接收方通过单次 `task_report` 结算；每步前获得上下文提示，但不强制拦截停机。
- `task_hard`：强制任务。派发具有明确汇报义务的硬性任务，接收方若在未交付 `task_report` 的情况下尝试结束轮次，将被停机守卫拦截。
- `task_report`：任务成果汇报。严格按 FIFO 闭环未结任务队列中的首个匹配项，接收方归档，无需回复。

任何传入 `task_dispatch` 的调用均被参数校验拦截，抛出 `[InvalidParameter] session_call: task_dispatch is deprecated. Use notice, task_soft, task_hard, or task_report.`。

### 账本

调用内存环形缓冲区（CallTelemetryRingBuffer）维护会话维度的内存未结任务账本 `_pendingTasks`：
1. **入队记录**：当单播调用类型为 `task_soft` 或 `task_hard` 且投递成功时，记录包含 `taskId`、`callerSessionId`、`targetSessionId`、`callType`、`contentSnippet`、`timestamp` 与 `isHard` 的任务项。
2. **先进先出结算**：当接收方调用 `session_call` 且类型为 `task_report` 时，从该会话作为目标的所有未结任务中查找最先派发的一项，将其标记为 `settled` 并记入结算时间与汇报编号。
3. **会话级联清理**：当会话归档或销毁时，自动从账本中移除以该会话为发件人或接收人的未结项，杜绝内存泄漏。

### 守卫

结合原生宿主机制构建双重推进防护：
1. **执行前上下文注入**：注册 `systemPrompt.context` 提供者 `task:remind`。当会话存在未结任务时，在每步执行前动态注入待履约任务清单与发件人指示；若无待办则返回空串，不消耗上下文。
2. **轮次停机拦截守卫**：监听宿主 `agent/turn-stopping` 事件。当会话仍有未结 `task_hard` 且未达到防死锁预算上限（默认 3 次）时，取消停机动作并通过 `agent.steer` 注入催办指令，强行拉起新步进要求智能体履约；预算耗尽时放行停机并记录告警。

### 动效

看板拓扑连线视觉状态与未结账本严格联动：
1. **脉冲保持**：只要存在未结的 `task_soft` 或 `task_hard`，调用连线的不透明度恒定维持 1.0，虚线保持流动（`dsh-flow-edge`）。`task_hard` 呈现专属琥珀色箭头标示。
2. **履约衰减**：一旦收到对应 `task_report`，调用状态由 `active` 转为 `settled`，流动停止并进入常规平滑时间衰减，常态下抑制冗余静态连线。

---

## 影响

### 正向

- 多智能体协作链路具备端到端闭环确认机制，彻底解决子任务派发后无音讯丢单问题。
- 四态语义职责清晰，提示词与语言包规范统一。
- 研发与运维人员可在看板上一眼识别在途阻塞任务（持续流动的脉冲连线与琥珀色硬任务）。

### 权衡

- 彻底拒绝旧有 `task_dispatch`，所有调用方测试与下游脚本必须完成迁移。
- 增加了宿主 `agent/turn-stopping` 监听，需要严格控制催办重试预算以防不可恢复的死循环。

---

## 验证

- 单元测试 `tests/report-obligation.test.mjs` 覆盖全部 5 核心场景：Schema 拒绝、任务账本 1:1 FIFO 结算、级联清理、`task:remind` 上下文注入、`agent/turn-stopping` 停机拦截与预算耗尽放行。
- 现有全量回归测试套件（557 项测试）通过率 100%，无破坏性回退。
