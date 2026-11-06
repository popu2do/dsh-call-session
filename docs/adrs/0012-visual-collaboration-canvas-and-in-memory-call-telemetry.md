<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0012: Visual Collaboration Canvas and In-Memory Call Telemetry Architecture

- **Status**: Accepted (Workspace isolation superseded by ADR-0013; canvas geometry evolved by ADR-0014, ADR-0018, ADR-0019, ADR-0026)
- **Date**: 2026-09-09
- **Deciders**: Architect, Core Engineering Team, QA Automation Lead
- **Consulted**: Frontend Engineering Team, UX Reviewer, Security Auditor
- **Informed**: All Plugin Consumers, Downstream Subagents, DSH Web Users

> **架构演化**：
> - 工作区边界：由 [ADR-0013](./0013-human-canvas-global-transparency-vs-agent-workspace-isolation.md) 全局透明度替代；
> - 外侧布线与主题：由 [ADR-0014](./0014-canvas-gutter-routing-and-scoped-theme-parity.md) 规约；
> - 动效令牌与几何不变式：由 [ADR-0018](./0018-canvas-motion-and-visual-restraint.md) 规约；
> - 双通道分流走线：由 [ADR-0019](./0019-channel-split-routing-and-lineage-on-demand-focus.md) 确立；
> - 圆角矩形卡片：由 [ADR-0026](./0026-canvas-rounded-rect-cards-toolbar-streamlining-and-dual-lineage-modes.md) 演进；
> - 领域词汇：严格遵循 CONTEXT.md 规约，使用 看板数据 与 调用连线，替换非标术语。

---

## 背景

### 痛点
插件为系统提供了两套核心协作原语：
1. 基于拉取的公共黑板，涵盖 board_post、board_list、board_clear；
2. 基于推送的严格 1 对 1 进程内单播调用 session_call。

在多智能体协作与团队编排场景下，系统缺乏全局直观透视：
- 调用痕迹瞬态丢失：单播调用直接在内存中以事件方式分发至目标智能体，调用完成后无结构化轨迹留存，无法回顾调用关系与协作任务；
- 全景拓扑盲区：用户仅能在对话列表单条会话内查看折叠行通知，缺乏全局视角的协作看板，无法直观感知跨工作区与多智能体之间的拓扑连接度及黑板条目关联；
- 排障成本高：发生多智能体协作死锁、调用级联或任务交接断裂时，开发者只能通过零散的系统日志或人工逐个会话排查。

### 约束
- 严格只读边界：协作看板仅作为系统的观察界面，不提供修改状态、删除记录或主动触发调用的入口；
- 零被动唤醒：看板状态获取与调用记录读取均为只读，绝不触发智能体实例被动唤醒；
- 提示词缓存防护：看板数据接口不注册为大模型的原生工具，避免智能体上下文膨胀与提示词前缀缓存失效；
- 受控内存占用与零磁盘争用：瞬态调用痕迹属于看板数据，容量受限，避免内存泄漏与磁盘文件锁争用。

---

## 动因

- 非侵入可观测性：在不修改单播调用和黑板存储核心语义的前提下，构建纯只读看板数据视图；
- 有界环形生命周期：采用固定容量内存环形缓冲区，保证先进先出淘汰与常数时间记录查询，控制内存开销；
- 工作区边界对齐：记录调用的发起工作区与目标工作区，遵循工作区隔离过滤规范；
- 提示词缓存保护：将看板数据与智能体工具集隔离，避免令牌消耗与提示词缓存失效；
- 网页原生插槽集成：挂载至网页扩展插槽，提供视觉拓扑展示。

---

## 方案

### 方案一
每笔单播调用完成后追加写入本地 JSONL 文件。
- 收益：进程重启后历史调用连线不丢失。
- 弊端：引入高频磁盘操作，易发生文件锁争用，文件体积膨胀且瞬态调用落盘性价比极低。

### 方案二
在单播调用完成后向全局事件发射器广播事件，前端直接监听。
- 收益：实时推送体验直接。
- 弊端：全局广播容易被误配的智能体监听器捕获，引发级联被动唤醒，且断网期间事件丢失无法拉取完整全景快照。

### 方案三
内建有界内存环形缓冲区，暴露只读门面接口，由网页视图插槽拉取渲染。
- 收益：内存开销低、零磁盘争用、无被动唤醒、不影响提示词缓存、契合原生扩展规范。
- 弊端：宿主进程重启后瞬态连线重置，拓扑自动基于存活会话与黑板重新投影，符合实时观测预期。

---

## 决策

采纳方案三：采用有界内存环形缓冲区与只读看板数据门面。

### 原则

1. 严格只读边界：看板与调用记录服务作为只读观察者，不包含修改数据、删除会话或反向触发调用的入口；
2. 零被动唤醒不变式：获取拓扑快照和调用记录直接在内存中读取，不调用任何会话的调度接口或触发提示词执行；
3. 有界内存不变式：环形缓冲区设置容量上限，默认 200 条，满额时最旧记录自动弹出，防止内存无限增长；
4. 提示词缓存防护不变式：调用记录查询接口不作为工具注入给智能体，保护服务端前缀缓存命中；
5. 工作区隔离不变式：调用记录查询默认隔离在当前工作区，仅在显式请求跨工作区时返回全局视图。

### 拓扑

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

### 契约

#### 缓冲

> 演进说明：task_dispatch 历史类型已废弃，现役取值为 notice、task_soft、task_hard、task_report，见 ADR-0042。

```typescript
export interface CallTelemetryRecord {
  id: string;                      // 唯一标识如 call-1725800000000-a1b2c3d4
  callerSessionId: string;         // 调用方 Session ID
  callerTitle: string;             // 调用方会话标题
  callerWorkspace: string;         // 调用方工作区规范化路径
  targetSessionId: string;         // 目标方 Session ID
  targetTitle: string;             // 目标方会话标题
  targetWorkspace: string;         // 目标方工作区规范化路径
  callType: 'task_dispatch' | 'task_report' | 'notice';
  deliveryMode: 'steer' | 'followup';
  timestamp: number;               // 发生时间戳
  durationMs: number;              // 执行投递耗时
  contextPostIds: string[];        // 携带引用的黑板条目 ID
  messageSnippet: string;          // 消息纯文本摘要
  messagePayload: string;          // 完整消息内容
  status: 'active' | 'settled';    // 状态
}

export interface CallTelemetryFilter {
  workspace?: string;              // 目标工作区过滤
  crossWorkspace?: boolean;        // 是否允许跨工作区
  limit?: number;                  // 返回记录上限
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

#### 快照

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

export function getCanvasTelemetry(
  ctx: any,
  options?: { workspace?: string; crossWorkspace?: boolean; limit?: number }
): Promise<CanvasTelemetrySnapshot>;
```

#### 路由

浏览器端看板无法直接访问宿主进程内存，调用记录快照经由宿主注册的只读 HTTP 路由暴露：

```javascript
export const TELEMETRY_ROUTE_PATH = '/plugins/dsh-call-session/telemetry';
export const WEB_SERVER_KEYS = ['webServer', 'httpServer'];

export function authenticatedWebRoutes(server: any, connection: () => any): AuthenticatedWebRoutes;
export function createTelemetryHandler(ctx: any, deps?: { logger?: any }): (req, res) => Promise<void>;
export function installTelemetryWebSurface(ctx: any, deps?: { logger?: any }): {
  tryRegister(): boolean;
  registered(): boolean;
};
```

路由规约：
- 认证围栏强制：每个请求先经认证围栏校验，服务缺失返回 503，未授权返回 401，越权返回 403，校验通过前不序列化工作区状态；
- 只读限制：仅接受 GET 请求，其余方法一律返回 405 并携带允许头部，不提供写入或清理路由；
- 禁用缓存响应：响应头固定声明不进行缓存，避免过期拓扑被浏览器复用；
- 懒加载与降级：通过探针获取宿主服务，缺失时保持无界面模式静默降级；
- 生命周期自动摘除：服务注册随插件卸载自动移除；
- 错误不泄漏：聚合异常统一降级为 500 状态，不将内部调用栈或敏感路径写入响应体。

#### 扩展

在网页运行时，插件入口通过会话视图插槽挂载看板选项卡并拉取快照：

```javascript
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'canvas',
  order: 15,
  label: () => '看板',
  inject: (sessionId) => ({
    sessionId,
    fetchTelemetry: (options) => fetch('/plugins/dsh-call-session/telemetry').then(res => res.json())
  })
}, CanvasViewComponent));
```

---

## 收益

### 收益
- 只读可观测性：呈现多智能体交互拓扑与黑板状态，辅助多智能体协作排障；
- 无状态破坏风险：纯只读透视，无反向控制渠道，避免会话或黑板数据误删；
- 无被动唤醒：调用记录读取依赖内存镜像，符合架构规范；
- 保护前缀缓存：看板数据服务不暴露为智能体工具，系统提示词不变，保持首字响应性能；
- 恒定内存消耗：环形缓冲区大小受限，内存占用受控，无磁盘阻塞。

### 权衡
- 瞬态调用重启清空：会话实体与黑板条目通过原有机制持久化，拓扑图基于存活状态重新投影，调用连线作为瞬态数据流动在重启后重置；
- 高频调用渲染开销：执行批量合并调度与视口裁剪，连线粒子动效采用硬件加速图层合成。

---

## 验证

1. 环形缓冲测试：验证容量硬约束与先进先出淘汰行为，以及工作区隔离过滤正确性；
2. 零唤醒验证：对空闲会话连续读取看板快照，验证被动唤醒计数保持为零；
3. 提示词缓存验证：核验智能体工具清单与系统提示词，确认未引入新增提示词工具；
4. 端到端链路验证：核对路由路径一致性、认证围栏拦截状态码、非 GET 请求阻断及服务后绑定时的补挂载行为。

---

## 演进

### 措辞
1. 正文中该视图数据的历史混用词汇统合为 看板数据 与 调用记录，各项不变式、容量、路由与标识符保持不变；
2. 历史术语登记于 CONTEXT.md 规避列表，由词汇门禁统一核验。
