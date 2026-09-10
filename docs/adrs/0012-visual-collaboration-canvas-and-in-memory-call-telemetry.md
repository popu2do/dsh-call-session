# ADR-0012: Visual Collaboration Canvas and In-Memory Call Telemetry Architecture

- **Status**: Accepted
- **Date**: 2026-09-09
- **Deciders**: Architect, Core Engineering Team, QA Automation Lead
- **Consulted**: Frontend Engineering Team, UX Reviewer, Security Auditor
- **Informed**: All Plugin Consumers, Downstream Subagents, DSH Web Users

---

## 1. Context and Problem Statement

### 1.1 Background & Observability Vacuum
`dsh-call-session` 为 DeepSeek Harness (DSH) 提供了两套核心协作原语：
1. 基于拉取（Pull）的公共黑板系统（`board_post`, `board_list`, `board_clear`，ADR-0001, ADR-0002, ADR-0004）；
2. 基于推送（Push）的严格 1:1 进程内单播调用（`session_call`，含 `steer` 与 `followup`，ADR-0001, ADR-0006）。

然而，在多智能体协作与团队编排（如 AgentTeams）复杂任务场景下，用户与开发者面临严重的**可观测性真空**（Observability Vacuum）：
- **调用痕迹瞬态丢失**：`session_call` 直接在内存中以事件方式分发至目标 Agent，调用完成后无结构化轨迹留存，无法回顾「谁调用了谁」、「何时触发了什么协作任务」；
- **全景拓扑盲区**：用户仅能在对话列表单条会话内查看折叠行通知，缺乏全局视角的协作看板，无法直观感知跨工作区、多 Agent 之间的拓扑连接度与黑板条目关联；
- **排障成本高**：发生多 Agent 死锁、调用级联风暴或任务交接断裂时，开发者只能通过零散的系统日志或人工逐个会话排查。

### 1.2 Architectural Forces & Constraints
- **Strict Read-Only Boundary**：协作看板仅作为系统的观察界面，不提供修改状态、删除记录或主动触发调用的入口。
- **Zero Passive Wake-up (ADR-0001)**：看板状态获取与遥测为只读读取，不触发 Agent 实例被动唤醒。
- **Workspace-Scoped Isolation by Default (ADR-0003)**：遥测数据与拓扑节点保持工作区边界隔离，跨工作区透视需显式声明。
- **Prompt KV Cache Invariant & Anti-Slop (ADR-0010, ADR-0011, ADR-0009)**：
  - 遥测接口不注册为大模型的 Native Tool，避免 Agent 上下文膨胀与 Prompt KV Cache 失效；
  - 遥测数据结构遵循标准英文紧凑契约，无装饰性符号与冗余元数据。
- **Bounded In-Memory Footprint & Zero Disk Contention**：瞬态调用痕迹属于遥测观测数据，容量受限，避免内存泄漏与磁盘 I/O 争用。

---

## 2. Decision Drivers

- **Driver 1 (Non-Intrusive Observability)**：在不修改 `session_call` 和 `board-store` 核心语义的前提下，构建只读遥测。
- **Driver 2 (Bounded RingBuffer Lifecycle)**：采用固定容量内存环形缓冲区（FIFO 淘汰），保证 O(1) 记录与查询性能，内存占用受控。
- **Driver 3 (Workspace Isolation Alignment)**：记录调用的发起工作区与目标工作区，遵循 ADR-0003 隔离过滤规范。
- **Driver 4 (Prompt KV Cache Defense)**：将看板遥测与 Agent LLM 工具集隔离，避免 Token 消耗与 KV Cache 抖动。
- **Driver 5 (Web Native Slot Integration)**：挂载至 DSH Web `conversation.view` 扩展插槽，提供视觉拓扑展示。

---

## 3. Considered Options

### Option 1: Append-Only Disk Persistence (`telemetry.jsonl`)
- **Description**: 每笔 `session_call` 完成后，追加写入本地 JSONL 文件。
- **Pros**: 进程重启后历史调用连线不丢失。
- **Cons**: 引入高频磁盘 I/O，在 Windows 环境下极易与 `board.json` 发生文件锁争用（违背 ADR-0004）；文件体积无限膨胀需要日志轮转器；遥测作为瞬态会话观测，落盘性价比极低。

### Option 2: Global EventBus Broadcast & Reactive Subscriptions
- **Description**: 在 `executeSessionCall` 完成后向全局 EventEmitter 广播事件，前端 WebSocket 直接监听。
- **Pros**: 实时推送体验好。
- **Cons**: 违反 ADR-0001 核心原则；全局广播容易被误配的 Agent 监听器捕获，引发不可预期的级联被动唤醒；网络断连期间事件丢失，无法拉取完整全景快照。

### Option 3 (Chosen): Bounded In-Memory Ring Buffer + Read-Only Telemetry Facade + Native Web View Slot
- **Description**:
  1. 在后端实现轻量纯内存环形缓冲区 `CallTelemetryRingBuffer`（默认容量 200 条，FIFO 淘汰）；
  2. `executeSessionCall` 在投递成功后同步（或微任务异步）记录 1 条轻量遥测快照；
  3. 提供只读门面接口 `getCanvasTelemetry({ workspace, crossWorkspace, limit })` 聚合会话、黑板与连线；
  4. 遥测接口作为 Cordis 服务或内部查询暴露给 Web 前端，绝不向 Agent 暴露为 LLM Tool，捍卫 KV Cache；
  5. 前端通过 `conversation.view` 插槽挂载「看板」视图，采用 SVG + DOM 分层渲染与 RAF 节流实现 60fps。
- **Pros**: 内存开销小、无磁盘 I/O、无被动唤醒、内存占用受限、不影响 Prompt KV Cache、契合 DSH 原生扩展规范。
- **Cons**: 宿主进程重启后瞬态连线重置（拓扑自动基于存活会话与黑板重新投影，符合实时遥测预期）。

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Bounded In-Memory Ring Buffer + Read-Only Telemetry Facade + Native Web View Slot.

### 4.1 架构原则

1. **Invariant 1 (Strict Read-Only Boundary)**：
   看板与遥测服务作为只读观察者，不包含修改数据、删除会话或反向触发调用的入口。
2. **Invariant 2 (Zero Passive Wake-up Invariant)**：
   获取拓扑快照和遥测记录直接在内存中读取，不调用任何会话的 `steer`, `followup`, `send` 或触发 prompt 执行。
3. **Invariant 3 (Bounded FIFO Memory Invariant)**：
   `CallTelemetryRingBuffer` 设置容量上限（默认 200 条，配置项 `telemetryCapacity`，范围 10~2000）。当缓冲区满时，最旧记录自动弹出，防止内存无限增长。
4. **Invariant 4 (Prompt KV Cache Defense Invariant)**：
   遥测查询接口不作为 Tool 注入给智能体。保护服务端 Prefix KV Cache 幂等命中。
5. **Invariant 5 (Workspace Isolation Invariant)**：
   遥测查询默认隔离在当前工作区；只有显式传递 `cross_workspace: true` 时才返回所有工作区数据。

### 4.2 拓扑数据

```
+---------------------------------------------------------------------------------------------------+
| DSH Host Process (Cordis Context)                                                                 |
|                                                                                                   |
|  [ Agent / Slash / Team ]                                                                         |
|            |                                                                                      |
|            v                                                                                      |
|   executeSessionCall()                                                                            |
|            |                                                                                      |
|            +--- 1. Native Unicast (steer/followup) ---> [ Target Agent Session ]                  |
|            |                                                                                      |
|            +--- 2. Record Trace (in-memory) ----------> [ CallTelemetryRingBuffer ] (Max: 200)   |
|                                                                     ^                             |
|                                                                     |                             |
|  [ AtomicBoardStore ] <---+                                         | Read-only Query             |
|  [ SessionQuerySvc  ] <---+-- getCanvasTelemetry({ workspace }) ----+                             |
|                                         |                                                         |
|                                         v                                                         |
|          GET /plugins/dsh-call-session/telemetry (Connection fence, GET-only, no-store)           |
|                                         |                                                         |
+-----------------------------------------|---------------------------------------------------------+
                                          | Read-only Telemetry Snapshot
                                          v
+---------------------------------------------------------------------------------------------------+
| DSH Web Client (Browser)                                                                          |
|                                                                                                   |
|  ctx.slots.register({ name: 'conversation.view', id: 'canvas', label: '看板' }, CanvasView)      |
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   | L1 Macro Topology Canvas (SVG Bezier Paths + GPU translate3d DOM Nodes)                   |   |
|   |   - Workspace Bounds                                                                      |   |
|   |   - Session Nodes (running: green, idle: gray)                                            |   |
|   |   - Blackboard Hub & Posts                                                                |   |
|   |   - In-flight Animated Flow Pulses (60fps)                                                |   |
|   +-------------------------------------------------------------------------------------------+   |
|   | L2 Entity Hover Popover (150ms delay, 1-Hop Connected Graph Highlight, 20% Dim Invariant) |   |
|   +-------------------------------------------------------------------------------------------+   |
|   | L3 Slide-Over Readonly Inspector (Double-click, 420px, Key-Value, Markdown/JSON Viewer)   |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

### 4.3 接口契约

#### 4.3.1 内存缓冲

```typescript
export interface CallTelemetryRecord {
  id: string;                      // 唯一标识 (如 call-1725800000000-a1b2c3d4)
  callerSessionId: string;         // 调用方 Session ID
  callerTitle: string;             // 调用方会话标题
  callerWorkspace: string;         // 调用方工作区规范化路径
  targetSessionId: string;         // 目标方 Session ID
  targetTitle: string;             // 目标方会话标题
  targetWorkspace: string;         // 目标方工作区规范化路径
  callType: 'task_dispatch' | 'task_report' | 'notice';
  deliveryMode: 'steer' | 'followup';
  timestamp: number;               // 发生时间戳 (毫秒)
  durationMs: number;              // 执行投递耗时
  contextPostIds: string[];        // 携带引用的黑板条目 ID
  messageSnippet: string;          // 消息纯文本摘要（最多 120 字符）
  messagePayload: string;          // 完整消息内容（只读）
  status: 'active' | 'settled';    // 状态
}

export interface CallTelemetryFilter {
  workspace?: string;              // 目标工作区过滤
  crossWorkspace?: boolean;        // 是否允许跨工作区
  limit?: number;                  // 返回记录上限（默认 50，最大 200）
  since?: number;                  // 时间戳增量过滤
}

export class CallTelemetryRingBuffer {
  constructor(capacity?: number);
  record(entry: Omit<CallTelemetryRecord, 'id' | 'timestamp'> & { timestamp?: number }): CallTelemetryRecord;
  query(filter?: CallTelemetryFilter): CallTelemetryRecord[];
  clear(): void;
  size(): number;
  capacity(): number;
}
```

#### 4.3.2 聚合快照

```typescript
export interface CanvasTelemetrySnapshot {
  timestamp: number;
  currentWorkspace: string;
  workspaces: CanvasWorkspaceEntity[];
  sessions: CanvasSessionEntity[];
  posts: CanvasBoardPostEntity[];
  calls: CallTelemetryRecord[];
  metrics: {
    totalSessions: number;
    runningSessions: number;
    activeCalls: number;
    totalPosts: number;
  };
}

/**
 * 聚合全景遥测快照（只读无副作用）
 */
export function getCanvasTelemetry(
  ctx: any,
  options?: { workspace?: string; crossWorkspace?: boolean; limit?: number }
): Promise<CanvasTelemetrySnapshot>;
```

#### 4.3.3 路由契约

浏览器端看板无法直接访问宿主进程内存，遥测快照必须经由一条宿主注册的只读 HTTP 路由暴露。该路由是看板唯一的数据入口：

```javascript
export const TELEMETRY_ROUTE_PATH = '/plugins/dsh-call-session/telemetry';
export const WEB_SERVER_KEYS = ['webServer', 'httpServer'];

/** 为原生 WebServer 包裹 Connection 认证围栏 */
export function authenticatedWebRoutes(server: any, connection: () => any): AuthenticatedWebRoutes;

/** GET-only 只读处理器；非 GET 返回 405 */
export function createTelemetryHandler(ctx: any, deps?: { logger?: any }): (req, res) => Promise<void>;

/** 懒加载挂载；无 Web 宿主时保持 tool-only 静默降级 */
export function installTelemetryWebSurface(ctx: any, deps?: { logger?: any }): {
  tryRegister(): boolean;
  registered(): boolean;
};
```

路由不变式：

- **认证围栏强制**：原生 WebServer 路由不继承 Connection 的认证语义，因此每个请求先经 `connection.requestRejection(req)` 校验。Connection 服务缺失返回 503，未授权返回 401，越权返回 403，围栏之前绝不序列化任何工作区状态；
- **GET-only 只读**：仅接受 GET；`POST`/`PUT`/`PATCH`/`DELETE`/`HEAD`/`OPTIONS` 一律返回 405 并携带 `allow: GET`。绝不提供任何写入、清理或触发单播的路由；
- **无缓存响应**：响应头固定 `cache-control: no-store`，避免过期拓扑被浏览器缓存复用；
- **懒加载与降级**：通过 `ctx.get('webServer') ?? ctx.get('httpServer')` 探针获取宿主服务，缺失时直接返回并监听 `internal/service` 事件补挂载。Headless 组态下插件保持 tool-only，不阻塞启动；
- **生命周期自动摘除**：注册经 `ctx.effect` 挂载，插件卸载时路由随之移除；
- **错误不泄漏**：聚合异常统一降级为 500 `telemetry unavailable`，绝不将内部堆栈或路径写入响应体。

#### 4.3.4 扩展契约
在 Web 运行时，插件入口通过 `conversation.view` 注册看板选项卡，并从上述规范路由拉取快照：
```javascript
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'canvas',
  order: 15,
  label: () => '看板',
  inject: (sessionId) => ({
    sessionId,
    fetchTelemetry: (options) => fetch('/plugins/dsh-call-session/telemetry?' + query).then(res => res.json())
  })
}, CanvasViewComponent));
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **只读可观测性**：呈现多 Agent 交互拓扑与黑板状态，辅助多智能体协作排障；
- **无状态破坏风险**：纯只读透视，无反向控制渠道，避免会话或黑板数据误删；
- **无被动唤醒**：遥测读取完全依赖内存镜像，符合 ADR-0001 架构底线；
- **不影响 Prompt KV Cache**：遥测服务不暴露为 LLM Tool，系统提示词不变，保持首字响应性能；
- **恒定内存消耗**：环形缓冲区大小受限（默认 200），内存占用受控，无磁盘 I/O 阻塞。

### 5.2 Negative Consequences & Mitigations
- **瞬态调用在宿主重启后清空**：
  - *Mitigation*: 会话实体与黑板条目通过原有机制保留与持久化，拓扑图基于存活状态重新投影。调用连线作为瞬态遥测流动，重启后重置。
- **高频调用时的前端渲染负载**：
  - *Mitigation*: 执行 RAF 批量合并调度与视口裁剪，连线粒子动效采用 GPU CSS 合成。

---

## 6. Verification and Compliance Gates

1. **RingBuffer 单元测试**：
   - 验证边界容量约束，测试 250 次写入后容量恒定为 200，并正确 FIFO 淘汰最旧数据；
   - 验证工作区隔离过滤正确性，验证 `crossWorkspace: false` 阻断非本工程记录。
2. **Zero-Wakeup 验证**：
   - 在有 3 个处于 idle 状态的会话时，连续调用 100 次 `getCanvasTelemetry()`，验证 3 个会话的被动唤醒次数为 0。
3. **KV Cache 验证**：
   - 检查 Agent `tools` 列表与 System Prompt，确认无新增 LLM 遥测工具，保证提示词指纹幂等。
4. **端到端链路验证**：
   - 断言前端请求路径与宿主注册路径字符串完全一致，防止链路断裂；
   - 验证认证围栏在 Connection 缺失（503）、未授权（401）、越权（403）三态下均在处理器执行前拦截；
   - 验证非 GET 方法一律 405 拦截，响应头携带 `allow: GET`；
   - 验证无 Web 宿主时 `installTelemetryWebSurface` 返回未注册且不抛错，插件保持 tool-only；
   - 验证 `internal/service` 事件在服务后绑定时能够补挂载，且重复调用幂等不重复注册。
