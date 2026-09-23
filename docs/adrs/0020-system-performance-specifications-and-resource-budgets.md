# ADR-0020: System Performance Specifications, Resource Budgets, and Deterministic SLA Baselines

- **Status**: Accepted
- **Date**: 2026-09-18
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Systems Performance Ops, QA Automation Lead, Frontend Lead
- **Informed**: All DSH Developers, Core Maintainers, Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context

`dsh-call-session` 作为 DeepSeek Harness (DSH) 宿主进程内的会话协作扩展，贯穿了「持久化状态共享（公共黑板）」、「点对点即时调度（单播调用与同级会话）」以及「可视化全景观测（Web 看板）」三大子系统。

随着多智能体协作与多工作区运行场景的增加，系统面临潜在的性能漂移与退化风险：
1. **事件循环阻塞风险**：Node.js 单主线程模型下，如果黑板内存查询或拓扑数据序列化出现高耗时，将直接导致宿主事件循环卡顿，影响主 Agent 的实时交互；
2. **并发写磁盘 I/O 抖动与锁竞争**：多智能体协作时并发发布黑板条目，若防抖与原子重命名机制缺少耗时与聚合约束，容易在弱 I/O 或文件扫描环境下引发 I/O 竞争与锁冲突；
3. **前端渲染卡顿与 CPU 资源消耗**：Web 看板在 50+ 节点拓扑下的 SVG 走线重算若耗时超过 16ms 会导致丢帧；后台标签页常驻轮询持续消耗 CPU 资源；
4. **缺乏量化防御基线**：此前虽然各模块具备防抖、配额与截断实现，但缺少系统级的量化性能预算（Performance Budget）与确定性回归门禁。

### 1.2 Architectural Forces & Constraints

- **Single Event Loop Discipline**: 所有纯内存操作必须在个位数毫秒内完成，绝对不得霸占 Node.js 事件循环。
- **Bounded Resource Footprint**: 进程内各级缓存与状态结构必须具备明确上限，长期常驻内存（RSS）增量严格可控。
- **Non-Intrusive Observability**: Web 看板与遥测聚合必须严格保持只读，其自身开销不得扰动核心调度业务。
- **Zero-Flake CI Reliability**: 性能门禁测试必须在兼顾严格量化的同时，具备对慢速 CI 环境的防抖动冗余。

---

## 2. Decision Drivers

- **Driver 1 (Deterministic Latency SLA)**: 为黑板读取、单播投递、遥测路由制定量化 P99 延迟上限。
- **Driver 2 (I/O Coalescing & Atomicity)**: 严格落实 300ms 防抖合并落盘，单次原子重命名与备份同步控制在 50ms 内。
- **Driver 3 (Memory & Capacity Boundedness)**: 固化黑板 200 条、调用记录 200 条上限及状态感知淘汰规则，限定插件常驻内存增量 ≤ 30MB。
- **Driver 4 (60 FPS & Throttled Polling)**: 保障前端 50 节点 + 100 连线规模下单帧计算 ≤ 16ms，确立前台 1500ms / 后台 5000ms / 隐藏 5 分钟挂起的节流策略。
- **Driver 5 (Gatekeeper Integration)**: 新增可执行的性能基准测试，纳入 `npm run verify` 核心发布门禁。

---

## 3. Considered Options

### Option 1: 仅制定松散的定性建议（No Hard Baseline）
- **Description**: 仅在文档中口头要求“注意性能，避免大循环”，不设定具体毫秒指标和容量数字。
- **Cons**: 无法防御代码重构带来的隐式性能回归，无法在 CI 中自动化判定合格。

### Option 2: 激进的微秒级指标与严格硬断言
- **Description**: 要求所有内存操作 ≤ 0.5ms，CI 中超过 1ms 立即报错挂起。
- **Cons**: 在 GitHub Actions 或虚拟化慢速 CI 环境中极易因宿主 CPU 抖动引发大面积非预期测试失败（Flaky Tests）。

### Option 3 (Chosen): 全链路工程务实性能预算与三倍防抖容差验证
- **Description**: 确立工程务实、可测量的分级延迟与容量基准；CI 门禁采用预热加中位数采样，并预留三倍防抖阈值。
- **Pros**: 既提供了清晰严格的架构设计红线，又保障了工程验证的绝对确定性与稳定性。

---

## 4. Decision Outcome

**Chosen Option**: Option 3。

### 4.1 Core Architectural Principles & Invariants

#### Invariant 1: 公共黑板存储性能不变量 (BoardStore Baseline)
- **读取延迟**：`board_list` 检索 100 条条目，纯内存操作耗时 P99 ≤ 5ms。
- **防抖合并**：突发写操作（如 1 秒内 50 次连续写入）必须在 300ms 防抖窗口内合并为单次落盘，严禁每次写立即触盘。
- **落盘耗时**：单次临时文件写入、原子重命名与 `.bak` 备份同步耗时 ≤ 50ms。

#### Invariant 2: 单播调用与同级会话治理不变量 (Session Call & Peer Session Baseline)
- **单播分发**：`session_call` 进程内事件投递与调度确认，耗时 P99 ≤ 2ms。
- **目录检索**：`SessionDirectory` 全量会话扫描与过滤，耗时 P99 ≤ 10ms。
- **配额拦截**：单工作区并发运行根会话达 5 个（口径与上限修订自 ADR-0021；或代际深度达 2、频控超 5次/分）时，拦截判定为同步阻断，耗时 ≤ 1ms。

#### Invariant 3: Web 看板与遥测聚合不变量 (Web Canvas & Route Baseline)
- **路由聚合**：GET `/plugins/dsh-call-session/telemetry` 快照聚合与 JSON 序列化，耗时 P99 ≤ 20ms。
- **渲染流畅度**：单画布在 50 会话节点 + 100 条调用连线规模下，单次通道分流走线与布局计算耗时 ≤ 16ms（保障 60 FPS）。
- **轮询能耗节流**：
  - 前台激活：1500ms 间隔轮询；
  - 后台/失焦：自适应降频至 5000ms 间隔；
  - 长时间隐藏：页面隐藏超过 5 分钟后完全挂起定时器，切回前台立即触发一次抓取并恢复 1500ms 轮询。

#### Invariant 4: 容量配额与状态感知淘汰不变量 (Capacity & Eviction Safeguards)
- **黑板容量**：硬上限 200 条，单条正文内容截断 64KB (65536 字符)。
- **淘汰优先级**：满额写入时执行确定性状态感知淘汰：
  `已过期 (expired) -> 已撤销 (archived) -> 最旧创建活跃条目 (createdAtMs)`
- **调用遥测缓冲区**：`CallTelemetryRingBuffer` 容量上限 200 条，单条摘要截断 120 字符，完整正文截断 8192 字符。
- **内存预算**：插件全量运行时在长周期压测下的常驻内存（RSS）增量预算上限为 ≤ 30MB。

---

### 4.2 System Architecture & Performance Boundaries

```
+-----------------------------------------------------------------------------------+
|                            DSH Host Process (Node.js)                             |
|                                                                                   |
|  [Agent / Tool Call]                                                              |
|        │                                                                          |
|        ├── board_post (In-mem Map P99 <= 5ms) ──> [Debounce 300ms] ──> Disk <= 50ms|
|        │                                                                          |
|        ├── session_call (In-proc dispatch P99 <= 2ms)                             |
|        │                                                                          |
|        └── session_create (Quota check <= 1ms, Max 10 per workspace)              |
|                                                                                   |
|  [Telemetry & Memory Buffers]                                                     |
|        ├── BoardStore Map: Max 200 items (State-Aware Eviction)                   |
|        └── CallTelemetryRingBuffer: Max 200 items (FIFO Eviction)                 |
|        * Total Process RSS Delta Budget: <= 30MB                                  |
|                                                                                   |
|  [Web Telemetry Surface]                                                          |
|        └── GET /plugins/dsh-call-session/telemetry (P99 <= 20ms)                  |
+-----------------------------------------------------------------------------------+
                                         │ HTTP (1500ms active / 5000ms hidden)
                                         ▼
+-----------------------------------------------------------------------------------+
|                            Web Browser Canvas Client                              |
|                                                                                   |
|  [Dynamic Throttling]                                                             |
|        Foreground: 1500ms ──> Hidden/Blur: 5000ms ──> Hidden >5m: Paused (0 req)  |
|                                                                                   |
|  [Layout & SVG Engine]                                                            |
|        50 Nodes + 100 Edges Gutter Routing Calculation <= 16ms (60 FPS)           |
+-----------------------------------------------------------------------------------+
```

---

## 5. Consequences

### 5.1 Positive Consequences
- 建立了完备可量化的系统性能边界，明确各模块的性能责任；
- 防抖合并与状态感知淘汰机制有效防止了高并发下的磁盘 I/O 过载与内存泄漏；
- 降频轮询与挂起机制有效降低看板页面长时间开启时的客户端 CPU 与网络占用；
- 门禁自动化使得任何性能退化在 PR / 提交阶段即可被直接拦截。

### 5.2 Negative Consequences & Mitigations
- **Tradeoff 1**: 性能测试包含少量延迟采样，轻微增加测试总时长（~300ms）。
  - *Mitigation*: 仅在核心操作执行 3 次预热与 10 次采样，测试仍控制在亚秒级内跑完。
- **Tradeoff 2**: 黑板淘汰策略会丢弃超过 200 条的数据。
  - *Mitigation*: 优先淘汰过期和已撤销条目，已完结任务自动让位，保护有效业务上下文。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite

性能规范由 `tests/performance-baseline.test.mjs` 实施全量自动化覆盖，纳入 `npm run verify`：
1. **BoardStore 性能验证**：
   - 100 条数据读取耗时中位数验证（断言 ≤ 15ms，基准 5ms）；
   - 50 次连续并发写合并落盘计数验证（断言仅触发 1 次原子磁盘写入）；
   - 状态感知淘汰顺序验证（过期 -> 归档 -> 最早）；
2. **调度与配额验证**：
   - `session_call` 内存调度耗时中位数验证（断言 ≤ 6ms，基准 2ms）；
   - `SessionDirectory` 全量扫描耗时中位数验证（断言 ≤ 30ms，基准 10ms）；
   - 配额超额同步拦截耗时验证（断言 ≤ 3ms，基准 1ms）；
3. **遥测路由与内存验证**：
   - 遥测快照序列化耗时中位数验证（断言 ≤ 60ms，基准 20ms）；
   - 大量操作后常驻内存 RSS 增量检查（断言 ≤ 30MB）；
4. **客户端降频逻辑验证**：
   - 前台 1500ms、后台 5000ms、隐藏超 5 分钟清除定时器的状态转换逻辑断言。

---

## 7. Status History & Related Artifacts

- **2026-09-18**: Proposed & Accepted following full-tier performance baseline consensus.
- **Related ADRs**:
  - Related to: [ADR-0004](./0004-atomic-debounced-persistence-and-healing.md) (Persistence & Windows Locks)
  - Related to: [ADR-0010](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md) (KV Cache & Session Lifecycle)
  - Related to: [ADR-0012](./0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md) (Canvas & Telemetry)
  - Related to: [ADR-0018](./0018-canvas-motion-and-visual-restraint.md) (Motion & 60 FPS)
  - Related to: [ADR-0019](./0019-channel-split-routing-and-lineage-on-demand-focus.md) (Channel-Split Routing)
- **Implementation Artifacts**:
  - `lib/board-store.mjs`
  - `lib/call-telemetry.mjs`
  - `lib/session-create.mjs`
  - `lib/session-directory.mjs`
  - `lib/client.js`
  - `tests/performance-baseline.test.mjs`
