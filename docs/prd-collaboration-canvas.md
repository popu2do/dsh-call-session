# 协作看板需求规范

- 文档状态：评审通过
- 版本：1.0.0
- 责任人：系统架构师
- 评审人：UX 评审专员
- 面向角色：前端工程师、后端工程师、测试工程师

## 概述

### 背景

DSH 多会话与多智能体协作包含两类通信机制：
1. 基于拉取的公共黑板共享状态：`board_post`、`board_list`、`board_clear`；
2. 基于推送的 1:1 进程内单播调用：`session_call`，包含 `steer` 与 `followup`。

既往会话交互缺乏全局拓扑展示。为降低协作排障成本，系统引入只读拓扑观察看板。

### 目标

1. 全局可见：直观呈现各工作区、活跃与空闲会话节点、黑板枢纽以及调用连线。
2. 纯粹只读：作为监控透镜，不提供修改、删除或主动触发指令的操作能力。
3. 稳定帧率：平移、缩放、聚焦与连线动态粒子流动过程中保持稳定 60fps。
4. 规范对齐：符合 ADR-0001 零被动唤醒、ADR-0003 工作区隔离、ADR-0005 状态规范、ADR-0009 简洁文档与 ADR-0010 缓存幂等要求。

## 原则

### 只读边界

- 看板定位为系统的只读观察镜像。
- 看板内不提供修改黑板数据、发送 `session_call`、中断或创建会话的操作按钮与交互输入框。
- 详情抽屉中所有字段均为只读展示，仅提供复制到剪贴板功能。

### 零唤醒

- 前端画板的拓扑展示与状态刷新依赖纯拉取模型与只读内存镜像流。
- 画板打开、刷新或查询不触发任何会话的被动唤醒。
- 遥测数据在 `executeSessionCall` 与 `AtomicBoardStore` 正常执行路径中异步记录，对主通信链路无侵入、无阻塞。

### 作用域

- 看板默认以当前会话所在工作区为初始拓扑集群。
- 提供跨工作区透视开关，允许按需透视跨工作区调用与黑板交互。

### 缓存幂等

- 遥测暴露的数据结构严格对齐标准英文元数据契约，字段紧凑稳定。
- 画板遥测采集引擎不修改智能体上下文提示词，避免 Token 膨胀。

### 视觉规范

- 界面零 Emoji 装饰，不使用伪图形元素。
- 采用冷色调工程布局，统一信息密度与排版层次。

## 架构

协作看板采用三级信息架构：

```
[ L1 拓扑层 ] ─── 鼠标悬停 ───> [ L2 聚焦层 ] ─── 双击实体 ───> [ L3 抽屉层 ]
  - 工作区集群划分                      - 节点关联网状高亮                 - 会话深度元数据
  - 会话节点 running 与 idle           - 非关联实体 20% 透明衰减           - 黑板条目全文字段
  - 黑板枢纽与条目散列                  - 悬停浮层卡片 150ms 触发          - 调用载荷只读检查
  - 动态调用连线                        - 连线动态粒子流动                  - 字段只读复制
```

### 拓扑层

- 挂载位置：集成在 DSH Web 客户端主会话区域顶栏视图切换器中，注册为 `conversation.view` 插槽，Tab 标识为看板。
- 视口与画布：支持二维画布空间。采用力导向自适应布局，中央为公共黑板枢纽，外围根据工作区聚类散列各会话节点。
- 视觉图元：
  1. 工作区边界：浅灰半透明容器，附带工作区目录名称标签。
  2. 会话节点：胶囊微卡片，展示会话 8 位唯一短码、截断标题与状态指示灯，绿色为 running，灰色为 idle。
  3. 黑板枢纽：六边形或圆角中心磁贴，展示黑板条目总数与活跃数，外围环绕散列活跃条目徽章。
  4. 调用连线：有向平滑贝塞尔曲线，箭头指示流向。按 callType 着色：task_dispatch 为蓝紫，task_report 为绿，notice 为青灰。线路上带有平滑移动的动态粒子。
- 画布工具栏：
  - 左上角：工作区筛选器、重置居中、缩放百分比。
  - 右下角：微型鹰眼地图、性能监测与节点统计。

### 聚焦层

- 悬停网络高亮：光标悬停在会话节点上时，计算 1-Hop 邻接子图。关联节点与连线保持 100% 不透明度并加粗，非关联元素在 180ms 内线性衰减至 20% 透明度。
- 悬停浮层卡片：悬停超过 150ms 触发弹出轻量浮层，离开节点后 100ms 自动淡出。
  - 会话浮层内容：Session ID 与状态、完整标题、工作目录绝对路径、调用指标统计（发起数、接收数、最近调用时间）。
  - 连线浮层内容：调用类型与交付模式、发起方与接收方、关联 postIds 计数、触发时间与耗时。
  - 黑板浮层内容：Post ID 与 Topic、Tags 标签栏、剩余生存时间、正文前 60 字符预览。

### 抽屉层

- 触发与形态：在任意实体上双击，右侧滑出宽度 420px 只读详情抽屉。遮罩层不拦截画布背景观察，点击抽屉外部或按下 ESC 键即时收起。
- 抽屉结构：
  - 顶栏：实体类型标签、实体短标识、一键复制按钮、关闭按钮。
  - 主体：核心基础元数据、关联关系网、载荷与正文内容只读展示。

## 模型

前端看板拓扑系统消费的标准 TypeScript 数据模型接口规范：

### 类型定义

```typescript
/**
 * 规范化会话运行状态，对齐两态协议
 */
export type CanvasSessionState = 'running' | 'idle';

/**
 * 跨会话调用意图类型
 */
export type CanvasCallType = 'task_dispatch' | 'task_report' | 'notice';

/**
 * 原生单播底层交付模式
 */
export type CanvasDeliveryMode = 'steer' | 'followup';

/**
 * 工作区聚类实体
 */
export interface CanvasWorkspaceEntity {
  id: string;                      // 规范化绝对路径字符串
  name: string;                    // 目录基名
  isCurrent: boolean;              // 是否为当前会话所在工作区
  sessionIds: string[];            // 该工作区包含的会话 ID 列表
}

/**
 * 会话视觉节点实体
 */
export interface CanvasSessionEntity {
  id: string;                      // 会话唯一 ID
  title: string;                   // 会话展示标题
  workspace: string;               // 所属工作区根路径
  state: CanvasSessionState;       // running | idle
  isTopLevel: boolean;             // 是否为根会话
  agentType?: string;              // 智能体类型标识
  createdAt?: number;              // 创建时间戳
  lastActiveAt?: number;           // 最近活跃时间戳
  stats: {
    outboundCalls: number;         // 发出的调用总数
    inboundCalls: number;          // 接收的调用总数
    postsCount: number;            // 发布的黑板条目数
  };
}

/**
 * 黑板公告条目实体
 */
export interface CanvasBoardPostEntity {
  id: string;                      // 条目 ID
  topic: string;                   // 业务主题命名空间
  tags: string[];                  // 检索标签
  authorSessionId: string;         // 发布者 Session ID
  workspace: string;               // 归属工作区
  createdAt: number;               // 发布时间戳
  expiresAt: number;               // 过期时间戳
  ttlRemainingMs: number;          // 剩余生存毫秒数
  content: string;                 // 完整正文内容
  metadata?: Record<string, unknown>; // 扩展元数据
  isDismissed: boolean;            // 是否已被软删除
}

/**
 * 跨会话调用连线实体
 */
export interface CanvasCallEdgeEntity {
  id: string;                      // 唯一调用追踪 ID
  callerSessionId: string;         // 发起者会话 ID
  targetSessionId: string;         // 目标接收会话 ID
  callType: CanvasCallType;        // 意图类型
  deliveryMode: CanvasDeliveryMode;// 交付模式
  timestamp: number;               // 发生时间戳
  durationMs?: number;             // 执行耗时
  contextPostIds: string[];        // 关联引用的黑板条目 ID
  messageSnippet: string;          // 消息摘要前 120 字符
  messagePayload: string;          // 完整消息内容，只读
  status: 'active' | 'settled';    // 状态: 活跃中或已落定
}

/**
 * 看板遥测全景快照数据结构
 */
export interface CanvasTelemetrySnapshot {
  timestamp: number;
  currentWorkspace: string;
  workspaces: CanvasWorkspaceEntity[];
  sessions: CanvasSessionEntity[];
  posts: CanvasBoardPostEntity[];
  calls: CanvasCallEdgeEntity[];
  metrics: {
    totalSessions: number;
    runningSessions: number;
    activeCalls: number;
    totalPosts: number;
  };
}
```

## 交互

### 画布控制

1. 缩放：
   - 滚轮上下滚动触发以光标为中心的平滑缩放；
   - 缩放区间限制在 0.25x 到 2.5x；
   - 缩放时保持文字清晰与连线抗锯齿，不产生字体模糊。
2. 平移：
   - 鼠标中键按下拖拽，或按住键盘 Space 键加鼠标左键拖拽；
   - 在画布空白区域直接左键拖拽平移画布；
   - 惯性平移平滑衰减，微阻尼系数 0.92。
3. 自适应居中：
   - 双击画布空白区域或点击工具栏居中按钮，以 300ms 缓动平滑聚焦包含所有活动节点的包围盒，预留 48px 视口边距。

### 节点拖拽

- 用户可左键按住拖拽单个节点微调位置。
- 拖拽过程中，所有与该节点相连的贝塞尔曲线以 60fps 实时重算控制点。
- 拖拽释放后，节点固定于目标坐标，不因力导向微扰产生意外跳跃。

### 抽屉交互

- 双击节点或连线打开抽屉。
- 关闭途径：点击抽屉右上角关闭图标、按下键盘 Escape 或单击画布空白背景区域。
- 抽屉内代码与文本块支持点击一键复制，并在右上方弹出已复制反馈，展示 1.2 秒后淡出。

## 动效

### 动效曲线

| 场景 | 动画机制 | 持续时间 | 缓动曲线 |
| :--- | :--- | :--- | :--- |
| 节点背景高亮衰减 | opacity, filter | 180ms | cubic-bezier(0.16, 1, 0.3, 1) |
| 实体选中聚焦 | transform: scale(), box-shadow | 200ms | cubic-bezier(0.16, 1, 0.3, 1) |
| 抽屉滑入滑出 | transform: translateX() | 240ms | cubic-bezier(0, 0, 0.2, 1) |
| 画布自适应重置居中 | Viewport Matrix Interpolation | 300ms | cubic-bezier(0.25, 1, 0.5, 1) |
| 连线动态粒子移动 | SVG stroke-dashoffset 线性循环 | 1.5s / 周期 | linear 无限循环 |

### 渲染分层

采用分层渲染架构，避免引入第三方大型图表库：
1. 背景与连线层：使用单个全屏 SVG 容器承载工作区外框与连线，贝塞尔曲线采用原生 SVG path 矢量光栅化，动态虚线流动采用 SVG 原生 stroke-dasharray 配合 CSS 关键帧驱动 stroke-dashoffset 卸载给 GPU 合成。
2. 节点与交互层：节点采用绝对定位的轻量 DOM 元素渲染，位移限定在 transform: translate3d，使用 CSS contain: layout style 与 will-change: transform 隔离渲染上下文。
3. 顶层浮层与抽屉：抽屉与浮层挂载在独立层级，脱离画布变换坐标系。

### 性能防御

1. 视口裁剪：画布平移或缩放超出视口范围的节点与连线动态跳过渲染，维持稳定 DOM 节点数。
2. 帧调度防抖：遥测数据存入前端待合并缓冲队列，在 requestAnimationFrame 统一聚合提交，每秒最多触发 60 次拓扑计算。
3. 内存环形截断：后端遥测与前端连线列表设置 200 条上限，FIFO 淘汰，防止内存泄漏。

## 异常

1. 会话异常终止或丢失：当调用连线指向的会话已销毁或不在活跃列表中时，目标节点标为已离线，连线变为半透明虚线，并在 Tooltip 中提示会话已结束。
2. 超长标题文本截断：会话标题在节点内单行省略，最大宽度限制为 140px，完整标题通过 Hover 卡片展示。
3. 黑板条目批量过期：超过 TTL 的条目在拓扑上自动淡出，渐隐动画 300ms，不留悬空孤立节点。
4. 极端密集拓扑重叠：力导向布局内置节点斥力碰撞检测，碰撞半径为节点对角线加 32px，防止多会话节点物理重叠。

## 验收

1. 只读性验收：全站无编辑输入框、状态更改按钮或主动触发调用功能，抽屉内仅具备复制能力。
2. 性能与帧率验收：在 20 个会话节点、50 条连线拓扑下，平移、缩放与悬停动画的 Chrome DevTools Performance 记录稳定维持在 55 到 60fps，主线程长任务为 0。
3. 架构合规验收：符合 ADR-0001 规范，停留于看板页面 5 分钟，后台 Agent 被动唤醒次数严格为 0。
4. 规范完备性：分级定义详尽，视觉实体数据模型类型定义严谨无歧义。

## 评审

- 评审结论：通过
- 评审专员：ux-reviewer

### 只读审查

1. 坚守纯粹监控透镜定位，无修改黑板条目、触发调用或管理会话的冗余按钮。
2. 抽屉仅保留一键复制功能，不包含输入表单与提交动作。
3. 节点拖拽约束为本地视口瞬态状态，不产生后端写调用或状态持久化。

### 视觉审查

1. 落实 ADR-0009 工程美学，不使用 Emoji 装饰与拟物设计。
2. 拓扑层、聚焦层与详情抽屉渐进下钻层次明确，防范视觉信息过载。
3. 静态空闲连线默认采用 1px 低饱和度半透明细线，仅在聚焦或存在实时调用脉冲时激活高亮。

### 动效审查

1. 选用原生 SVG 连线加 CSS transform3d 硬件加速 DOM 节点与独立抽屉分层架构，规避第三方图表库体积膨胀与主线程阻塞。
2. 明确引入视口裁剪、RAF 批量合并调度与 200 条环形缓冲区，性能防御边界完备。
3. 双击唤起抽屉时立即禁用 150ms 延时的悬停浮层，防止遮挡；拖拽节点过程仅更新当前 DOM 与相连 SVG Path 控制点，不触发全局力导向排版重算。
