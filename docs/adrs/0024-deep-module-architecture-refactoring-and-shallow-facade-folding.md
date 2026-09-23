# ADR-0024: Deep Module Architecture Refactoring, Shallow Query Facade Folding, and Storage-Tool Adapter Decoupling

- **Status**: Accepted
- **Date**: 2026-09-23
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Canvas Engineers, Telemetry Engineers, Directory Maintainers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents, Web Interface Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
随着 `dsh-call-session` 在前端协作画布、进程内单播分发、公共黑板状态存储与多会话调度场景下的演进，系统的模块深度与测试表面暴露出四个维度的浅层散弹化与职责倒置阻抗：

1. **Canvas 视图大单体杂糅 (lib/client.js)**：
   3200+ 行的单体 IIFE 将贝塞尔通道分流走线算法（ADR-0014/0019）、视口双向限位居中与缩放钳位算法（ADR-0018）、落点脉冲动效状态机与 DOM/React 视图渲染紧密耦合。导致纯几何与视口不变式无法脱离 DOM 容器独立验证，单元测试不得不依赖脆弱的正则表达式与 DOM 伪造对象。
2. **会话查询浅层模块中转 (lib/session-query.mjs)**：
   原 `lib/session-query.mjs` 仅 80 行，接口与内部实现近乎 1:1，其本质只是重新导出 `lib/session-directory.mjs` 的内部函数并包裹一层计数统计。调用方与测试在两个文件间反复跳跃，割裂了会话发现与查询的局部性。
3. **黑板存储引擎与工具执行门面耦合 (lib/board-store.mjs)**：
   `BoardStore` 原本设计为内存 Map、FIFO 淘汰与原子防抖落盘的纯存储引擎，但直接混入了 `executePost`、`executeList`、`executeClear`、`getAuthorReminder` 等 Cordis 工具调用参数解包与多语言文案渲染逻辑，职责外溢。
4. **环形缓冲区遥测倒置依赖全局业务数据源 (lib/call-telemetry.mjs)**：
   `CallTelemetryRingBuffer` 作为高性能有限内存 FIFO 队列，却在同文件中承载了 300+ 行全景拓扑数据聚合逻辑（`getCanvasTelemetry`），反向引入对 `board-store` 与 `session-directory` 的倒置依赖。

### 1.2 Architectural Forces & Constraints
- **Deep Modules & Leverage**：遵循 `/codebase-design` 原则，追求“以极简稳定的接口暴露丰富内聚的实现行为”，最大化调用方与测试的杠杆率。
- **Locality & Seam Purity**：同一领域的逻辑必须内聚在一处，存储、几何计算与快照观察者各司其职，杜绝倒置依赖。
- **Zero-Breakage Backward Compatibility**：既有公共导出符号、工具调用签名与测试用例契约必须 100% 保持向后兼容。
- **Deterministic Test Surface**：核心数学与拓扑算法必须具备脱离浏览器环境独立快速回归的机器测试表面。

---

## 2. Decision Drivers

- **Driver 1 (Eliminate Fragile DOM-Tied Testing)**：将 Canvas 纯数学几何路由与视口限位算法提炼为纯函数，建立原生测试套件，彻底解除单元测试对 DOM 运行时的束缚。
- **Driver 2 (Pass the Deletion Test for Shallow Facades)**：折叠无实质抽象深度的 `session-query.mjs`，消除跨层符号重导出，将会话查询与过滤直接内聚于 `SessionDirectory`。
- **Driver 3 (Pure State Storage vs Tool Adaptation)**：将工具执行逻辑解耦为独立的 `BoardToolsAdapter`，让 `BoardStore` 回归纯粹的进程内持久化存储核心。
- **Driver 4 (Topological Observer Realignment)**：将全景快照数据汇聚（`getCanvasTelemetry`）重构为 Web 路由协作层的只读观察者，解耦底座环形队列。

---

## 3. Considered Options

### Option 1: 维持现状，仅修补单元测试
- **Pros**: 零架构改动成本。
- **Cons**: `lib/client.js` 的几何与视口测试依然脆弱；查询与存储接口持续越界混杂，架构信噪比不断劣化。

### Option 2: 激进重构并破坏既有导出路径（删除 session-query.mjs）
- **Pros**: 彻底消除冗余文件。
- **Cons**: 破坏现有外部可能依赖的 `import { executeSessionQuery } from './lib/session-query.mjs'` 路径及历史测试引用，违背平滑演进原则。

### Option 3 (Chosen): 四大支柱深层模块提炼 + 零破坏向后兼容重导出
- **Pros**:
  - 核心逻辑深度内聚，杠杆率与局部性最大化；
  - 提炼出的模块具备独立且干净的纯单元测试；
  - 历史导出文件（如 `session-query.mjs`、`call-telemetry.mjs`）保留薄重导出门面，全仓 294 项既有测试 100% 绿灯无感过渡。

---

## 4. Decision Outcome

### 4.1 四大重构架构支柱

#### 支柱 1：Canvas 纯数学几何路由与视口限位控制器 (lib/client.js)
- 提炼椭圆外切点方程（半轴 a=96, b=26）、自环调用顶部出入（y-75）、同列双通道分流走线（下行右出右进、上行左出左进，区间 [106, 126]px）、跨列三段复合贝塞尔通道横跨（y<=130）及黑板外轨专属通道（[130, 136]px）为无状态纯计算实现。
- 提炼视口自适应双向 padding (48px)、定位取景双向夹紧（[0.80, 1.20]）、水平首列对齐与垂直黑板优先保护算法。
- 交付专属测试套件：`tests/canvas-geometry-routing.test.mjs`（10 项）与 `tests/canvas-viewport-clamping.test.mjs`（5 项）。

#### 支柱 2：SessionDirectory 查询折叠与浅层门面收拢 (lib/session-directory.mjs)
- `SessionDirectory` 新增 `.query(args, exec)` 原生实例方法与 `executeSessionQuery` 顶层导出，原生封装入参规范化、作用域隔离、归档过滤与状态汇总。
- `lib/session-query.mjs` 彻底折叠为自 `session-directory.mjs` 的转发重导出，实现删除测试中的逻辑收口，消除双重跳转。

#### 支柱 3：BoardStore 存储纯化与 BoardToolsAdapter 门面解耦 (lib/board-store.mjs)
- `BoardStore` 纯化为仅关注内存 Map、FIFO 淘汰、原子防抖落盘与备份恢复的纯存储引擎。
- 抽离 `BoardToolsAdapter` 承载参数规范化（`normalizeExecParams`）、保留主题拦截（`isReservedTopic`）、作者工作区上下文解析与多语言文案拼接。
- `BoardStore` 内部持有默认适配器实例，保持既有 `store.executePost/executeList/executeClear` 方法签名向后兼容。

#### 支柱 4：全景拓扑快照聚合逻辑剥离 (lib/web-telemetry-route.mjs)
- `getCanvasTelemetry` 汇聚实现移入 `lib/web-telemetry-route.mjs`，作为观察者协同消费会话目录、黑板存储与单播调用记录。
- `lib/call-telemetry.mjs` 纯化为零业务依赖的内存 FIFO 环形缓冲区，并保留向后兼容的只读符号重导出。

---

## 5. Consequences & Verification

### 5.1 Positive Consequences
- **模块深度显著提升**：核心领域模型接口紧凑，底层隐藏完备的计算与校验逻辑；
- **测试表面更加坚固**：纯数学与纯存储模块脱离 DOM 与复杂环境，测试速度从秒级降至毫秒级；
- **零痕迹演进**：全仓 294 项自动化测试全部通过，Lint 与 TypeScript 类型检查零报错。

### 5.2 Verification Commands
```bash
# 验证 Canvas 纯几何与视口限位不变式
node --test tests/canvas-*.test.mjs

# 验证 SessionDirectory 查询折叠与向后兼容性
node --test tests/session-query.test.mjs tests/session-directory.test.mjs

# 验证黑板存储与独立工具适配器契约
node --test tests/board-operations.test.mjs

# 验证全景拓扑快照聚合与 Web 路由解耦
node --test tests/call-telemetry.test.mjs tests/web-telemetry-route.test.mjs

# 全工程验证
npm run verify
```
