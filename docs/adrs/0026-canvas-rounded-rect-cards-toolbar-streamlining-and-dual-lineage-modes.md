# ADR-0026: Canvas Rounded Rectangle Cards, Toolbar Streamlining, and Dual Lineage Modes

- **Status**: Accepted
- **Date**: 2026-10-08
- **Deciders**: Architect, Frontend Lead, UX Reviewer
- **Consulted**: QA Automation Lead, Core Maintainers
- **Informed**: All DSH Web Users, Canvas Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Geometric Ergonomics
ADR-0012 建立了可视化协作看板，ADR-0014 与 ADR-0019 确立了通道分流走线（Channel-Split Routing）与常态按需显影（Lineage Focus）。但在实际协作演进与长标题场景中，旧版呈现方案暴露出三项显著的人机交互与视觉瓶颈：
1. **几何椭圆空间折损与标题过度截断**：
   会话节点采用几何椭圆（半轴 a=96, b=26）。椭圆四角内凹导致可用排版空间折损 21.5%。内部文本垂直偏离中轴时宽度急剧收缩，叠加当前徽标挤压，导致标题可用宽度仅 62px，长中文标题在 4~5 字内即被省略号强行截断；同时斜向连线切点在垂直偏移 y=±15px 处向内凹陷 17.6px，破坏了通道布线平直出入秩序；
2. **常态连线抑制导致的“悬停税”（Hover Tax）**：
   ADR-0019 规定的“常态历史连线零渲染”虽消除了视觉交错噪点，但导致用户在未触发悬停时完全无法感知全局通信网络全貌，必须逐个节点悬停探索，削弱了看板作为全局拓扑视图（Global Transparency）的感知效率；
3. **顶栏控制项冗余与信息层级失衡**：
   顶栏保留的【放大】【缩小】显式按钮与现代触控板/滚轮连续缩放交互冗余，侵占水平空间；同时「会话: x 运行: x 活跃调用: x 黑板条目: x」大段文字统计标签占据主栏视觉焦点，缺乏克制感。

### 1.2 Architectural Forces & Constraints
- **Invariant Geometry & Backward Compatibility**：保持槽位高度 72px、列宽 260px、外接半宽 96px、半高 26px，并保留既有 `getEllipseIntersection` 接口契约；
- **Zero-Emoji & Scoped Theme**：全量图标必须采用工程级矢量 SVG 图元，严禁 Emoji，严格收敛于看板 CSS 作用域；
- **State Persistence**：用户偏好的连线呈现模式需跨会话持久化存储在 `localStorage`；
- **Read-Only Non-Intrusive Observability**：维持看板纯内存、只读、不产生被动唤醒的观测边界。

---

## 2. Decision Drivers

- **Driver 1 (Text Legibility & Layout Utilization)**：消除标题过早截断，可用排版宽度由 62px 扩充至 160px 以上；
- **Driver 2 (Dual-Mode Lineage Flexibility)**：在极简低噪与全景拓扑全局透视之间提供低认知负荷的单键切换；
- **Driver 3 (Restrained Toolbar Density)**：移除冗余缩放按钮，将指标降级为图标化微型指示簇，释放顶栏留白呼吸空间；
- **Driver 4 (Smooth Normal Tangency)**：以圆角矩形外切封闭解保证侧向连线平直出入，消除偏角内凹畸变。

---

## 3. Considered Options

### Option 1: 仅增大椭圆半长轴至 120px
- **Pros**: 维持椭圆形状不变。
- **Cons**: 导致节点宽度超出 260px 列宽，压缩左右 Gutter 通道净空间，无法根除曲率内凹缺陷。

### Option 2: 强制常态全量渲染所有连线且不可关闭
- **Pros**: 彻底解决悬停探索问题。
- **Cons**: 多会话密集调度下退化回蜘蛛网噪点状态，违背 ADR-0019 初衷。

### Option 3 (Chosen): 圆角矩形卡片重构 + 顶栏精简 + 双模连线切换
- **Description**:
  1. 会话节点图元由 `<ellipse>` 升级为 `<rect rx="8" ry="8" width="192" height="52" x="-96" y="-26">`，采用双层栅格将标题宽度提升至 160px；
  2. 实现闭式圆角矩形外切算法 `getRoundedRectIntersection`，偏角 dy<=18px 时出入点 X 坐标恒定收敛于 cx±96px；
  3. 彻底移除顶栏【放大】与【缩小】按钮；
  4. 顶栏右侧新增连线模式切换按钮，支持「隐藏连线」（常态隐藏全量连线）与「显示连线」（0.35 细虚线常态呈现调用线与黑板连线，悬停聚焦增强）；
  5. 顶栏统计指标改造为 4 组矢量图标+紧凑数字，悬停提供详细文字 Tooltip。
- **Pros**: 兼顾全局拓扑直观性与局部细节可读性，几何与人机交互高度统一。
- **Cons**: 增加一项客户端偏好持久化状态字段。

---

## 4. Decision Outcome

**Chosen Option**: Option 3.

### 4.1 核心规范
1. **Invariant 1 (Card Dimension Invariant)**：卡片物理几何严格限定为宽 192px、高 52px、圆角 8px，中心坐标原点为 (0, 0)。
2. **Invariant 2 (Dual Lineage Modes)**：
   - `minimal`（隐藏连线模式）：未交互时会话调用线、黑板发布线与引用线常态彻底零渲染；鼠标悬停实体时按需显影关联链路；
   - `full`（显示连线模式）：常态下调用连线（含端点箭头）与黑板归属线完整绘制；鼠标悬停实体时，关联链路增强至 1.00 实线脉冲，非关联链路衰减至 0.15。
3. **Invariant 3 (Toolbar Streamlining)**：顶栏移除 Explicit Zoom 控制按钮；统计指标采用无 Emoji 矢量图标簇紧随操作按钮组。

---

## 5. Consequences

### 5.1 Positive
- 标题排版宽度由 62px 扩充至 160px，中文字符完整可见；
- 平直出入端点彻底消除 17.6px 走线内凹畸变；
- 用户可自主决定拓扑信息的呈现密度，消除悬停探索成本；
- 顶栏视觉层级清晰克制，信息干扰降至最低。

### 5.2 Negative & Mitigations
- 既有 ADR 描述中涉及“椭圆”的段落通过本文档与历史标记保持概念对齐。
