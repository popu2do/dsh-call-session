# 协作看板界面设计与工程实现规格

- 文档版本：2.0.0
- 状态：正式设计规格（Baseline）
- 依据：老板手绘原图架构、缺陷清单（17项）及 ADR-0001 / ADR-0003 / ADR-0005 / ADR-0009 / ADR-0010 / ADR-0012
- 面向角色：前端看板工程师、宿主遥测工程师、QA 验证工程师、界面评审员、语言风格审查员

---

## 1. 概述与核心约束

### 1.1 定位与目标
协作看板（Collaboration Canvas）是 `dsh-call-session` 插件内置的全局拓扑可视化镜像。系统将老板手绘原图确立的「顶部黑板通条 + 并排竖泳道工作区 + 泳道内单列 session 椭圆 + 跨泳道有向连线 + 全图线框化低饱和虚线」信息架构完整工程化落地，修复旧版全部 17 项数据语义、渲染与交互缺陷。

### 1.2 三项铁律约束
1. **只读性约束（Strict Read-Only）**：
   看板全界面无任何数据输入框、新增/删除/修改表单、触发调用的操作按钮或会话生命周期控制组件。详情抽屉内仅允许复制只读文本。
2. **单一入口收敛（Tab Encapsulation）**：
   看板的所有 UI、画布、工具栏、浮层及抽屉必须严格收敛在 DSH Web 顶栏 `conversation.view` 的「看板」Tab 内。禁止在主会话聊天流或宿主侧弹出非受控全局浮动窗口。
3. **工程线框审美与零 Emoji（Anti-Slop & Zero-Emoji）**：
   全界面严禁使用任何 Emoji 符号与拟物装饰图形。统一采用深色冷灰底色、高信息密度、低饱和度线框（Wireframe）、等宽字体与几何描边风格。

---

## 2. 信息架构与手绘原图映射

看板信息架构严格还原手绘原图层次：

```
+---------------------------------------------------------------------------------------------------+
|  [顶部公共黑板通条] (横贯全宽，浅灰线框，高度 96px)                                                  |
|  +-------------------+  +-------------------+  +-------------------+                              |
|  | 黑板条目方块 (Active) |  | 黑板条目方块 (Arch.) |  | 黑板条目方块 (Exp.) |   ...                      |
|  +-------------------+  +-------------------+  +-------------------+                              |
+---------------------------------------------------------------------------------------------------+
          ^                          ^                         ^
          | [发布归属边]                | [上下文引用边]            |
          | (session -> post)        | (call -> post)          |
+--------------------------+  +--------------------------+  +--------------------------+
| 工作区竖泳道 1 (当前工程)   |  | 工作区竖泳道 2 (协同工作区)  |  | 工作区竖泳道 3 (协同工作区)  |
| 宽度 260px，窄竖长条       |  | 宽度 260px，窄竖长条       |  | 宽度 260px，窄竖长条       |
|                          |  |                          |  |                          |
|  (  Session 椭圆节点 1  ) |  |  (  Session 椭圆节点 3  ) |  |  (  Session 椭圆节点 5  ) |
|         rx=96, ry=26     |  |         rx=96, ry=26     |  |         rx=96, ry=26     |
|              |           |  |                          |  |                          |
|              |           |  |                          |  |                          |
|  (  Session 椭圆节点 2  ) |--+---- [跨泳道调用连线] ------->|  (  Session 椭圆节点 6  ) |
|         rx=96, ry=26     |  | (三次贝塞尔有向曲线，端点裁剪) |         rx=96, ry=26     |
|                          |  |                          |  |                          |
|  [ 单列纵向居中排列 ]      |  |  (  Session 椭圆节点 4  ) |  |  [ 单列纵向居中排列 ]      |
+--------------------------+  +--------------------------+  +--------------------------+
```

### 2.1 结构层次映射
- **顶部横条**：公共黑板通条容器（Blackboard Strip），承载所有全局拉取式状态条目（`board_post`）。
- **纵向竖条**：工作区泳道（Workspace Swimlane），横向并排排列，每个泳道代表一个独立工作区目录（`cwd`）。
- **泳道内部**：单列纵向居中排列会话节点（Session Node），形态严格采用**几何椭圆**，杜绝旧版双列错位混排。
- **关系织网**：
  1. 跨泳道/同泳道会话间：绘制 `session_call` 跨节点调用连线；
  2. 会话与黑板条目间：绘制 `authorSessionId` 发布归属连线；
  3. 调用连线与黑板条目间：绘制 `contextPostIds` 上下文引用连线。

---

## 3. 五类视觉图元与几何度量规范

所有图元默认态均为**空心线框**（描边、无填充或极低饱和微透明填充）。

### 3.1 视觉参数规范矩阵

| 图元分类 | 几何特征与尺寸 (px) | 布局与间距规则 (px) | 默认态样式（低饱和虚线） | 高亮态样式（1-Hop 聚焦） | 文本排版与色值 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 顶部黑板通条** | 宽度：跟随工作区总宽（`min-width: 1080px`）；高度：`96px`；圆角：`rx=8, ry=8` | 起始坐标：`x=40, y=24`；与下方泳道纵向间距：`30px` | `fill: rgba(15, 23, 42, 0.35)`<br>`stroke: #475569`<br>`stroke-width: 1.2px`<br>`stroke-dasharray: 6 4` | `stroke: #38bdf8`<br>`stroke-width: 2.0px`<br>`stroke-dasharray: none`<br>`filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.25))` | 通条标题：`11px`，`#94a3b8`，字重 600；计数徽章：`11px`，`#38bdf8` |
| **2. 黑板条目方块** | 宽度：`180px`；高度：`48px`；圆角：`rx=6, ry=6` | 位于通条内，横向单行排列；起始：`x=56, y=52`；水平间距：`16px` | **Active**: `stroke: #64748b, 1.2px, 4 3`<br>**Archived**: `stroke: #334155, 1px, 2 3`<br>**Expired**: `stroke: #1e293b, 1px, 1 3`<br>`fill: rgba(30, 41, 59, 0.45)` | `stroke: #38bdf8`<br>`stroke-width: 1.8px`<br>`stroke-dasharray: none`<br>`fill: rgba(15, 23, 42, 0.85)` | Topic: `11px`, `#e2e8f0`, 最大宽 `110px`; 状态标签: `10px`, Active `#38bdf8` / Arch `#64748b` |
| **3. 工作区竖泳道** | 宽度：`260px`；最小高度：`480px`；圆角：`rx=10, ry=10` | 纵向起始：`y=150`；泳道间横向水平净距：`36px`；动态高度公式见 3.2 节 | **当前工作区**: `stroke: #64748b, 1.4px, 6 3, opacity: 0.75`<br>**外部工作区**: `stroke: #334155, 1.2px, 6 4, opacity: 0.45`<br>`fill: rgba(15, 23, 42, 0.2)` | `stroke: #60a5fa`<br>`stroke-width: 2.0px`<br>`stroke-dasharray: none`<br>`stroke-opacity: 0.95` | 泳道头部：高度 `38px`；文字：`12px`，字重 600，`#94a3b8`；当前工作区加注 `[Current]` |
| **4. 会话椭圆节点** | **几何椭圆**：半长轴 `rx=96px`，半短轴 `ry=26px`（外接 `192px × 52px`） | 泳道内单列纵向居中：`cx = wsX + 130`；首节点 `cy = 214`；垂直中心距：`72px`（外边缘净距 `20px`） | **Running**: `stroke: #22c55e, 1.5px, 5 3`<br>**Idle**: `stroke: #64748b, 1.2px, 4 4`<br>`fill: #090d16`（遮挡底线） | `stroke-width: 2.2px`<br>`stroke-dasharray: none`<br>**Running**: `stroke: #4ade80`<br>**Idle**: `stroke: #93c5fd`<br>扩散光晕：`drop-shadow(0 0 8px ...)` | 短码：`11px` 等宽，`#38bdf8`；标题：`12px`，`#f1f5f9`，最大渲染宽 `105px` |
| **5. 跨会话调用连线** | 有向平滑三次贝塞尔曲线；箭头 Marker：底宽 `6px`，高 `8px` | 起终点自几何中心计算，精确裁剪至椭圆轮廓（见 4.2 节） | `stroke-width: 1.2px`<br>`stroke-dasharray: 4 4`<br>**dispatch**: `#818cf8, op: 0.45`<br>**report**: `#34d399, op: 0.45`<br>**notice**: `#94a3b8, op: 0.35` | `stroke-width: 2.2px`<br>`stroke-dasharray: none`<br>`stroke-opacity: 1.0`<br>**dispatch**: `#a5b4fc`<br>**report**: `#6ee7b7`<br>**notice**: `#cbd5e1` | 悬停卡片展示详情；活跃调用流动粒子周期：`1.5s` |
| **6. 黑板发布归属边** | 平滑二次贝塞尔曲线（Session 椭圆顶部 -> Post 方块底部） | 数据来源：`post.authorSessionId == session.id` | `stroke: #64748b`<br>`stroke-width: 1.0px`<br>`stroke-dasharray: 2 4`<br>`stroke-opacity: 0.22` | `stroke: #38bdf8`<br>`stroke-width: 1.8px`<br>`stroke-dasharray: 4 2`<br>`stroke-opacity: 0.9` | 悬停在 Session 或 Post 时双向激活 |
| **7. 调用引用黑板边** | 细虚线折线/曲线（Call 连线中点 -> Post 方块底部） | 数据来源：`call.contextPostIds.includes(post.id)` | `stroke: #475569`<br>`stroke-width: 0.8px`<br>`stroke-dasharray: 2 4`<br>`stroke-opacity: 0.12` | `stroke: #fbbf24`<br>`stroke-width: 1.6px`<br>`stroke-dasharray: 3 3`<br>`stroke-opacity: 0.85` | 悬停在 Call 或对应 Post 时高亮激活 |

### 3.2 泳道高度与通条宽度计算公式
- **泳道动态高度**：
  $$H_{\text{swimlane}} = \max\left(480, 76 + N_{\text{sessions}} \times 72 + 24\right)\quad (\text{单位: px})$$
- **黑板通条宽度**：
  $$W_{\text{blackboard}} = \max\left(1080, N_{\text{workspaces}} \times (260 + 36) - 36 + 80\right)\quad (\text{单位: px})$$

---

## 4. 关系边生成与裁剪算法规范

### 4.1 三类关系边生成规范
前端从遥测快照消费三类实体关系并建立拓扑图模型：

1. **调用连线（Session-to-Session Call Edge）**：
   - 数据源：`snapshot.calls` 数组中每条记录。
   - 发起端点：`call.callerSessionId`；接收端点：`call.targetSessionId`。
   - 存在性判定：当 caller 或 target 任一方不在可视节点列表中时，依然保留连线并连接到占位端点或标记为离线。
2. **黑板发布归属边（Session-to-Post Author Edge）**：
   - 数据源：`snapshot.posts` 中每条条目的 `post.authorSessionId`。
   - 起点：发布者 Session 节点坐标；终点：目标 Post 方块底部坐标。
   - 过滤规则：仅当 `authorSessionId` 匹配当前可视区域内的某个 Session 实体时生成边。
3. **调用引用黑板边（Call-to-Post Context Edge）**：
   - 数据源：`snapshot.calls` 中每条记录的 `call.contextPostIds` 数组。
   - 起点：调用连线中点控制坐标 $(P_{cx}, P_{cy})$；终点：被引用的 `post.id` 对应方块底部中点。
   - 默认显示策略：默认态保持极弱可见性（透明度 0.12），悬停对应 Call 连线或 Post 时完全高亮（透明度 0.85）。

### 4.2 椭圆边界精确裁剪算法（Boundary Clipping）
严禁连线端点直接取节点几何中心导致连线或箭头 Marker 埋入椭圆内部。

设椭圆中心为 $(C_x, C_y)$，半长轴 $a = 96$，半短轴 $b = 26$。连线另一端点（或贝塞尔控制点）为 $(T_x, T_y)$。
连线向量分量为 $\Delta x = T_x - C_x$，$\Delta y = T_y - C_y$。
向量与椭圆轮廓方程 $\frac{x^2}{a^2} + \frac{y^2}{b^2} = 1$ 的交点比例因子 $t$ 计算如下：

$$t = \frac{1}{\sqrt{\left(\frac{\Delta x}{a}\right)^2 + \left(\frac{\Delta y}{b}\right)^2}}$$

- **起点实际裁剪坐标**：$(C_{x1} + t_1 \cdot \Delta x_1, C_{y1} + t_1 \cdot \Delta y_1)$。
- **终点实际裁剪坐标**：$(C_{x2} - t_2 \cdot \Delta x_2, C_{y2} - t_2 \cdot \Delta y_2)$。
- **箭头 Marker 停靠**：SVG Marker 定义 `refX = 6, refY = 3`，尖端精确外切于终点裁剪坐标。

---

## 5. 排版、文本截断与字体规范

### 5.1 文本截断规则（基于渲染像素宽度）
废除按字符数 `slice(0, 14)` 硬截断的错误逻辑。中文字符物理宽度约为英文字符的 1.8~2.0 倍，必须基于**像素渲染宽度**截断并添加省略号 `...`。

1. **节点标题（Session Title）**：
   - 容器分配最大宽度：`105px`。
   - 样式声明：`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 105px;`（在 SVG 中使用等价的基于宽度估算算法：英文字符 `7.2px`，中文字符 `12.5px`，预留 `16px` 省略号空间）。
2. **黑板条目主题（Post Topic）**：
   - 容器分配最大宽度：`110px`。
   - 规则同上，超出自动截断并展示 `...`，完整内容通过悬停 Tooltip 呈现。
3. **短码（Short ID）**：
   - 严格定长 `8` 字符，无需截断，容器预留固定宽度 `64px`。

### 5.2 跨平台等宽字体栈规范
针对 Windows 系统下 `ui-monospace` 意外回退至粗衬线字体（如 Courier/Times）的渲染缺陷，全局统一字体栈：

```css
/* 代码、ID、短码与度量数字字体栈 */
--dsh-font-mono: 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Consolas, 'Courier New', monospace;

/* 界面标题、标签与说明文字字体栈 */
--dsh-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

严禁单独声明裸 `ui-monospace`。

---

## 6. 数据语义与宿主遥测契约规范

对应缺陷清单第 1、2、3、4、5 条，由宿主侧 `lib/call-telemetry.mjs` 统一处理，前端直接消费规范字段。

### 6.1 会话唯一短码（Short ID）
- **根因**：DSH 会话 ID 形如 `session-550e8400-e29b-41d4-a716-446655440000`，而 AgentTeams 成员 ID 为裸 `uuid`。若直接 `slice(0, 8)`，前者全部变成无意义的 `session-`。
- **算法规则**：
  ```javascript
  function computeSessionShortId(rawId) {
    if (!rawId || typeof rawId !== 'string') return 'unknown';
    const stripped = rawId.replace(/^session-/i, '').replace(/[^a-zA-Z0-9]/g, '');
    return stripped.slice(0, 8).toLowerCase() || 'unknown';
  }
  ```
- **输出契约**：遥测快照中每个 `CanvasSessionEntity` 增加只读字段 `shortId: string`（8位小写字母/数字）。

### 6.2 会话展示标题与系统文案回退
- **根因**：AgentTeams 会话初始标题直接暴露系统入场文案 `You have joined the team "..." as a member...`。
- **回退规则**：
  1. 命中系统文案特征时（正则 `/joined the team|wait for an automatic assignment|system-reminder/i`）或标题为空时，触发清洗；
  2. 若 `agentType` / `role` 存在且非 `'agent'`，回退显示为角色名称（如 `界面设计规格师` 或 `architect`）；
  3. 若角色不存在或为默认值，回退显示为 `Agent <shortId>`。

### 6.3 黑板条目三态模型与 TTL 语义
废除单一 `isDismissed: boolean` 压平方式，状态严格细分为三态：
1. `status: 'active'`：正常活跃条目，处于有效 TTL 周期内。
2. `status: 'archived'`：主动被 `board_clear` 软删除/归档的条目。
3. `status: 'expired'`：达到 TTL 时间自然过期的条目。

**TTL 语义约束**：
- 对于 `archived` 与 `expired` 条目，`ttlRemainingMs` 归零（或为 `0`）。
- 界面在非 active 条目上严禁显示「有效剩余 Xh Ym」，转而展示状态标签「已撤销」或「已过期」。

### 6.4 统一黑板统计计数口径
- **计数统一**：顶部黑板通条标题 `blackboard.hub` 旁计数值，与右上角全局指标 `metrics.totalPosts`，必须统一为**活跃黑板条目数**（`status === 'active'`）。
- 任何界面位置严禁出现包含已撤销条目的全量长度与过滤后计数的同屏矛盾。

---

## 7. 分级交互体系规范（L1 / L2 / L3）

交互划分为互不干扰的三级深度：

```
[ L1 默认静态层 ] ── (悬停 150ms) ──> [ L2 1-Hop 聚焦层 ] ── (双击 dblclick) ──> [ L3 420px 只读抽屉 ]
  - 全图线框虚线                        - 关联节点/边实线高亮                - 字段结构化展示
  - 低饱和度底噪                        - 非关联元素 0.18s 衰减至 20%        - 复制只读值
  - 维持 60fps                         - 轻量浮层 Tooltip 呈现             - ESC / 空白关闭
```

### 7.1 L1 默认态（Canvas View）
- 初始所有泳道、节点、连线以浅灰虚线（`dasharray`）呈现。
- 支持画布拖拽平移与滚轮平滑缩放。
- **单击控制**：单击实体仅为选中态聚焦（或取消聚焦）；**严格禁止单击触发抽屉弹出**。
- **拖拽防误触**：指针按下到抬起欧式距离大于 `3px` 时判定为画布平移，不触发任何点击交互。

### 7.2 L2 聚焦层（1-Hop Focus & Tooltip）
- **触发时机**：光标停留在任意实体（Session、Post、Call 连线）上方停留时间 $\ge 150\text{ms}$ 时激活；光标移出实体后保持 $100\text{ms}$ 缓冲，随后在 $180\text{ms}$ 内平滑恢复。
- **1-Hop 关联高亮范围**：
  - 若悬停在 Session 节点 $S$：
    1. 节点 $S$ 本身转为实线高亮并增加外发光；
    2. 与 $S$ 直接相连的所有 Call 连线转为高亮实线（不透明度 1.0）；
    3. 上述 Call 连线另一端的对端 Session 节点转为高亮实线；
    4. 由 $S$ 发布的 Post 方块以及连接两者的归属边转为高亮实线；
    5. 画布上所有其余非关联图元在 $180\text{ms}$ 内过渡至 `opacity: 0.20`。
- **浮层 Tooltip 规范**：
  - 弹出位置：紧贴实体上方或下方 `8px`，带有 `z-index: 100`。
  - 内容结构：
    - Session：短码、完整标题（无截断）、所属工作区、收发调用总数；
    - Call 连线：调用意图标签（`dispatch`/`report`/`notice`）、交付模式（`steer`/`followup`）、耗时 `durationMs`、引用 Post 数量；
    - Post：Topic 全称、完整 Tags、发布者短码、有效剩余时间（仅 active）。

### 7.3 L3 抽屉层（Read-Only Inspector Drawer）
- **唤出方式**：**必须双击（dblclick）** 节点、连线或黑板条目触发唤出。
- **几何尺寸**：右侧固定抽屉，宽度 `420px`，高度 100%，遮罩层为半透明黑色 `rgba(0, 0, 0, 0.4)`，不阻断画布整体观察。
- **关闭途径**：
  1. 点击抽屉右上角关闭按钮；
  2. 按下键盘 `Escape` 键；
  3. 单击抽屉外部的透明遮罩区域。
- **黑板实体抽屉内容治理**：
  - 彻底废除 `JSON.stringify(posts)` 裸数据倾倒。
  - 黑板条目详情必须渲染结构化列表：Post ID、Topic、Tags 徽章、发布者 ID、创建时间、状态徽章、正文文本块（带复制按钮）。

---

## 8. 画布视口、变焦与自适应包围盒

### 8.1 以光标为锚点的滚轮缩放算法
严禁以固定 $(0, 0)$ 点进行缩放导致画布内容脱离视口。

设当前平移量为 $(P_x, P_y)$，当前缩放系数为 $Z$。
鼠标光标在画布容器内的视口相对坐标为 $(M_x, M_y)$。
滚轮向下放大步长因子 $k = 1.1$，滚轮向上缩小步长因子 $k = 1 / 1.1$。
新缩放系数截断在 $[0.25, 2.5]$ 区间：$Z_{\text{new}} = \text{clamp}(Z \times k, 0.25, 2.5)$。

新的平移补偿量计算公式如下：

$$P_{x,\text{new}} = M_x - (M_x - P_x) \times \frac{Z_{\text{new}}}{Z}$$

$$P_{y,\text{new}} = M_y - (M_y - P_y) \times \frac{Z_{\text{new}}}{Z}$$

### 8.2 自适应居中（Fit View）算法
点击工具栏「自适应居中」按钮或双击空白背景触发：

1. **计算全量包围盒**：
   遍历当前可视的所有工作区泳道、黑板通条以及会话节点，求出外接矩形：$[X_{\min}, Y_{\min}, X_{\max}, Y_{\max}]$。
   包围盒内容宽 $W_c = X_{\max} - X_{\min}$，内容高 $H_c = Y_{\max} - Y_{\min}$。
2. **计算视口安全区域**：
   设视口总宽高为 $W_v, H_v$，四周预留安全边距 `padding = 48px`。
   可用宽高：$W_{\text{avail}} = W_v - 96$，$H_{\text{avail}} = H_v - 96$。
3. **计算最佳缩放与平移**：
   $$Z_{\text{fit}} = \text{clamp}\left(\min\left(\frac{W_{\text{avail}}}{W_c}, \frac{H_{\text{avail}}}{H_c}\right), 0.30, 1.20\right)$$
   $$P_{x,\text{fit}} = \frac{W_v - W_c \times Z_{\text{fit}}}{2} - X_{\min} \times Z_{\text{fit}}$$
   $$P_{y,\text{fit}} = \frac{H_v - H_c \times Z_{\text{fit}}}{2} - Y_{\min} \times Z_{\text{fit}}$$
4. **缓动生效**：采用 `cubic-bezier(0.25, 1, 0.5, 1)` 缓动曲线在 `300ms` 内平滑过渡生效。

---

## 9. 渲染性能与动效生命周期防御

### 9.1 SVG 状态指示灯动画修复
- **根因**：`.dsh-pulse-dot` 关键帧使用 `transform: scale(...)` 作用于 SVG `<circle>`，因缺少 `transform-box: fill-box`，在 Chrome/Webkit 中变换原点相对于整个全屏 SVG 视口，导致呼吸灯被甩出节点与泳道。
- **CSS 必须修复项**：
  ```css
  .dsh-pulse-dot {
    transform-box: fill-box !important;
    transform-origin: center !important;
    animation: dsh-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  ```

### 9.2 宿主悬浮控件避让安全区
- **根因**：DSH Web 宿主界面在右上角常驻圆形悬浮操作按钮，导致看板右上角统计徽章被遮挡截断。
- **布局防线**：看板顶栏与工具栏容器必须在右侧增加安全避让区：
  ```css
  .dsh-canvas-toolbar {
    padding-right: 76px !important; /* 彻底避让宿主右上角圆形控件 */
  }
  ```

### 9.3 渲染循环防抖与 RAF 帧管理
- **消除全量重绘**：遥测轮询（`fetchTelemetry`）获取数据后，前端比对 `snapshot.timestamp` 与实体校验和；若无拓扑变动，禁止触发整树 DOM 重算。
- **RAF 动画帧防泄漏**：画布平移（`onMouseMove`）采用 `requestAnimationFrame` 驱动时，必须严格保留 `animFrameId`；在注册下一帧前必须调用 `cancelAnimationFrame(animFrameId)`，严禁未完成帧在事件循环中积压。

---

## 10. 文案体系与国际化字典对齐

文案遵循 ADR-0009 反 AI 腔与极简工程审美，中英文字典必须严格**一一对称**。

| 字典键名 (Key) | 中文文案 (zh) | 英文文案 (en) | 语义与应用位置 |
| :--- | :--- | :--- | :--- |
| `view.canvas` | 看板 | Canvas | 顶栏 Tab 标识名称 |
| `empty.title` | 协作看板就绪 | Collaboration Canvas Ready | 空态画布居中大标题（彻底修复中英不对齐） |
| `empty.desc` | 暂无活跃会话或黑板条目，发起调用或发布条目后在此呈现。 | No active sessions or blackboard posts. Content will appear here once calls are made or posts are published. | 空态说明辅助文案 |
| `session.offline` | 会话已离线 | Session Offline | 调用指向已销毁会话时的警告标签 |
| `blackboard.hub` | 公共黑板 | Blackboard | 顶部通条区域标识 |
| `blackboard.empty`| 暂无活跃条目 | No active posts | 顶部通条无条目时的占位文案 |
| `status.active` | 活跃 | Active | 黑板条目活跃状态标签 |
| `status.archived` | 已撤销 | Archived | 黑板条目被撤销状态标签 |
| `status.expired` | 已过期 | Expired | 黑板条目自然过期状态标签 |
| `drawer.readonlyBadge` | 只读 | Read-Only | 详情抽屉顶部身份徽章 |
| `drawer.copied` | 已复制 | Copied | 复制成功反馈提示 |

---

## 11. 缺陷对策闭环追踪表 (17/17)

| 缺陷编号 | 问题分类 | 缺陷现象与根因 | 规格对策与量化指标 | 归属执行方 |
| :---: | :--- | :--- | :--- | :---: |
| **1** | 数据语义 | `sid.slice(0,8)` 导致前缀全为 `session-`，裸 uuid 导致形态分裂 | 统一由宿主生成 `shortId`，剥离 `session-` 后取 8 位小写十六进制（第 6.1 节） | backend / t2 |
| **2** | 数据语义 | 顶部通条与右上角徽章黑板计数口径不一致 | 统一统计口径为 `status === 'active'` 活跃条目数，两处数字严格相等（第 6.4 节） | backend / t2 |
| **3** | 数据语义 | 已撤销条目（archived）仍显示「有效剩余 1h 0m」 | 区分 active/archived/expired 三态；非 active 条目 TTL 归零并显示「已撤销」（第 6.3 节） | backend / t2 |
| **4** | 数据语义 | 节点标题直接暴露 AgentTeams 入场系统文案 | 过滤入场文案，按角色名优先、`Agent <shortId>` 保底回退（第 6.2 节） | backend / t2 |
| **5** | 文案风格 | `session.offline` 未使用；`empty.title` 中英文语义不一致 | 中英文字典一一精确对齐，消费 `session.offline` 标签（第 10 节） | linguist / t7 |
| **6** | 界面渲染 | `.dsh-pulse-dot` 缺少 `transform-box: fill-box` 导致动画甩出泳道 | CSS 补全 `transform-box: fill-box !important`，原点居中（第 9.1 节） | frontend / t3 |
| **7** | 界面渲染 | 右上角徽章被 DSH Web 宿主圆形悬浮控件遮挡 | 工具栏右侧增加 `padding-right: 76px` 安全避让区（第 9.2 节） | frontend / t3 |
| **8** | 界面渲染 | 文本硬截断 `slice(0,14)` 导致中文溢出、英文腰斩 | 基于渲染像素宽度自适应截断，预留 `105px` 并增加省略号 `...`（第 5.1 节） | frontend / t3 |
| **9** | 界面渲染 | `ui-monospace` 在 Windows 上回退至粗衬线字体 | 规范字体栈为 JetBrains Mono / Cascadia Code / Consolas 序列（第 5.2 节） | frontend / t3 |
| **10** | 界面渲染 | 连线起终点取几何中心，Marker 箭头埋入椭圆内部 | 引入椭圆边界精确裁剪算法，连线端点与箭头外切于椭圆边缘（第 4.2 节） | frontend / t3 |
| **11** | 交互行为 | 单击与双击混用，拖拽平移松手误触弹出 420px 抽屉 | 严格区分单击（选中）与双击（抽屉）；设置 `3px` 平移位移抑制阈值（第 7.1/7.3 节） | frontend / t3 |
| **12** | 交互行为 | L2 聚焦层缺失，无轻量悬停浮层卡片 | 增加 L2 浮层 Tooltip（150ms 触发，100ms 缓冲，180ms 衰减）（第 7.2 节） | frontend / t3 |
| **13** | 交互行为 | 缩放以 `(0, 0)` 为原点导致画布内容飞出视口 | 实现以光标为锚点的矩阵缩放与平移补偿算法（第 8.1 节） | frontend / t3 |
| **14** | 交互行为 | 「重置视口」仅重置为固定坐标，非 Fit View | 计算全量可视元素包围盒，自适应居中并预留 48px 边距（第 8.2 节） | frontend / t3 |
| **15** | 交互行为 | 点击黑板 hub 把 posts 数组 JSON 裸串倒进抽屉正文 | 抽屉针对实体类型定制结构化卡片排版，禁止裸数据倾倒（第 7.3 节） | frontend / t3 |
| **16** | 性能调度 | 3 秒全量重绘整棵 SVG；拖拽平移 RAF 帧积压堆叠 | 引入数据校验和跳过无效重绘；平移管理 `animFrameId` 及时 `cancel`（第 9.3 节） | frontend / t3 |
| **17** | 信息架构 | 缺失发布归属边与上下文引用边，仅剩孤立点线 | 完整生成并渲染 session→post 归属边与 call→post 引用边（第 4.1 节） | frontend / t3 |

---

## 12. 质量验收基准（QA Checklist）

下游验证工程师（qa）与界面评审员（reviewer）需依据以下可量化指标进行逐项断言验收：

1. **图元尺寸量化**：
   - 会话椭圆半长轴严格为 `96px`，半短轴严格为 `26px`；
   - 泳道宽度严格为 `260px`，泳道间横向间距严格为 `36px`；
   - 泳道内会话节点必须为单列纵向居中排布，水平偏离度为 0。
2. **三类关系边完整性**：
   - 验证 `authorSessionId` 成功生成指向黑板方块的二次曲线；
   - 验证 `contextPostIds` 成功生成指向关联黑板方块的上下文虚线；
   - 验证连线端点与椭圆边缘精确相切，在放大 200% 下无嵌入椭圆现象。
3. **交互分级与时序**：
   - 悬停触发时间必须严格受限于 `150ms` 延迟防抖；
   - 1-Hop 高亮时，非关联图元必须在 `180ms` 内过渡到 `0.20` 不透明度；
   - 单击节点不得打开抽屉，双击节点必须在 `240ms` 内滑出 `420px` 抽屉。
4. **视口变换验证**：
   - 滚轮缩放时光标指向的画布空间点坐标在缩放前后保持物理重合；
   - 点击自适应居中后，所有图元完整容纳在视口内且外围边距不小于 `48px`。
5. **合规性验证**：
   - 全局静态代码扫描与 DOM 检查中 Emoji 正则匹配计数为 0；
   - 全界面无任何 `<input>`、`<textarea>` 或可编辑 contenteditable 元素；
   - `npm run lint` 与 `npm test` 100% 保持通过。
