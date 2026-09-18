# ADR-0016: Unified Parameter Naming, Session Identifier Governance, and Zero-Alias Anti-Pollution Specification

- **Status**: Accepted
- **Date**: 2026-09-11
- **Deciders**: Architect, Lead System Designer, Multi-Agent Runtime Committee
- **Consulted**: Fullstack Development Lead, Code Reviewer, QA Automation Lead
- **Informed**: All DSH Agent Developers, Tool Authors, Downstream Orchestrators

---

## 1. Context and Problem Statement

### 1.1 Background & Issues

在 `dsh-call-session` 插件早期迭代与功能演进过程中，公共黑板（Blackboard）、会话单播呼叫（Session Call）、会话查询（Session Query）以及同级会话创建（Session Create）等能力经历了多轮独立特性迭代（如 ADR-0001 关注域分离、ADR-0005 确立 English Metadata、ADR-0010 确立同级会话生命周期、ADR-0011 治理黑板 Token、ADR-0015 支持预设与模型继承）。

然而，多阶段演进导致了底层接口与技术规范文档之间出现明显的**命名差异、别名冗余与规范不一致**：

1. **入参与出参命名风格割裂与理解断层**：
   - 工具入参在不同工具间风格不纯粹：绝大多数参数使用 `snake_case`（如 `target_session_id`, `call_type`, `context_post_ids`, `initial_message`, `running_only`），但部分工具实现与类型定义中引入了 `camelCase` 入参别名（如 `session_create` 中的 `reasoningEffort`、`agentPreset`、`sessionId`，`board_list` 内部的 `topicPrefix`、`crossWorkspace`、`titlesOnly`）。
   - 工具出参遵循 ADR-0005 标准采用 `camelCase`（如 `sessionId`, `totalCount`, `activeCount`, `targetSessionId`, `callerSessionId`）。
   - 缺乏单一顶层权威规范明确界定“入参与出参的风格职责边界”，导致部分开发者与外部智能体产生困惑：为什么入参是 `target_session_id`（蛇形），出参却是 `targetSessionId`（驼峰）？出参是否也应当变为蛇形？这种职责界限的模糊引发了不必要的兼容层与试探性调用。

2. **会话核心标识符命名割裂（Session Identifier Fragmentation）**：
   - 会话标识符在链路流转中存在命名断层：
     - `session_query` 返回列表项中的属性名为 `sessionId`；
     - `session_create` 返回对象属性名为 `sessionId`；
     - `session_call` 接收的入参名为 `target_session_id`，出参属性名为 `targetSessionId` 与 `callerSessionId`；
     - `board_post` 与 `board_list` 输出中的发布者会话属性名为 `authorSessionId`。
   - 在历史草稿与部分 ADR 文档拓扑图（如 ADR-0006 §4.2）中，甚至出现了 `target_id` 这种模糊缩写；在 ADR-0001 §4.2 拓扑图中，误将 `board_clear(id)` 写为 `board_clear(post_id, topic)`。这破坏了工具调用链路的参数对称性。

3. **别名膨胀与代码污染（Alias Pollution & Technical Debt）**：
   - 为兼容调用方不同习惯，代码与类型定义中引入了大量兜底别名：
     - `lib/session-query.mjs` 与 `types/session-query.d.ts` 支持 `running_only` 与 `active_only` 双轨；
     - `lib/session-create.mjs` 与 `types/session-create.d.ts` 支持 `reasoning_effort` 与 `reasoningEffort`、`preset` 与 `agentPreset` 双轨，甚至在入参暴露 `sessionId`；
     - `lib/board-store.mjs` 支持驼峰与下划线混合选项。
   - 这种别名兼容违反了“保持代码纯粹、零残留无用逻辑、最小认知负荷”的架构纪律，增大了维护成本并阻碍了编译期严格类型检查。

### 1.2 Architectural Forces & Constraints

- **Single Source of Truth (SSOT)**：全插件所有原生工具的参数与返回值必须有且仅有一套绝对权威的命名规范。
- **Zero-Alias Anti-Pollution**：废除内部多重别名兼容逻辑，不在生产代码中保留别名兼容补丁。
- **Dual-Domain Protocol Boundary**：严格分立 Agent 提示词交互层（入参）与 Machine/Web 消费层（出参）的命名风格，不可任意混淆。
- **End-to-End Parameter Symmetry**：工具链之间传递核心实体时，语义与词根必须严格对称，确保调用参数一致。

---

## 2. Decision Drivers

- **Driver 1 (Eliminate Interface Ambiguity)**：确立明确的命名法则，消除 Agent 在选择工具参数时的猜测与幻觉。
- **Driver 2 (Preserve Web GUI & Machine Runtime)**：维护 ADR-0005 确立的 Machine Layer camelCase JSON Schema 铁律，保护前端协作看板（Canvas）与看板数据管道的绝对稳定。
- **Driver 3 (Purge Alias Pollution)**：在运行时代码与 `.d.ts` 中移除所有冗余兼容别名（如 `active_only`, `reasoningEffort`, `agentPreset` 等），保持接口简洁。
- **Driver 4 (Rectify Historical ADR Inconsistencies)**：出具正式修正案，纠正 ADR-0001, ADR-0005, ADR-0006, ADR-0010, ADR-0011, ADR-0015 中与现行统一规范相悖的历史笔误与模糊描述。

---

## 3. Considered Options

### Option 1: 全链路全面蛇形化（All-Snake_Case Unification）
- **描述**：将工具入参和出参全部强制统一为 `snake_case`（例如出参全部转为 `session_id`, `target_session_id`, `total_count` 等）。
- **否决原因**：
  - 严重违背 ADR-0005《English Metadata and Normalized Two-State Status Protocol》核心决策；
  - 破坏协作看板（`lib/client.js`）中数百处基于 `sessionId`、`targetSessionId`、`callerSessionId` 的响应式属性访问，引发前端异常与渲染失败；
  - 违反主流 TypeScript / JSON 领域开发惯例（JS 运行时对象原生偏好 camelCase）。

### Option 2: 全链路全面驼峰化（All-CamelCase Unification）
- **描述**：将工具入参和出参全部强制统一为 `camelCase`（例如入参变为 `targetSessionId`, `initialMessage`, `runningOnly` 等）。
- **否决原因**：
  - 违背 DSH 原生 Tool 体系普遍遵循的 POSIX / Pythonic `snake_case` 入参设计规范；
  - 与外部同类工具（如 `agent_teams_claim_task({ task_id })`、`edit({ file_path })`）的入参生态习惯割裂，破坏 LLM 调用的一致性体验。

### Option 3: 维持双轨兼容别名（Status Quo with Polyfills）
- **描述**：入参和出参同时支持 `snake_case` 与 `camelCase`（如同时返回 `sessionId` 和 `session_id`，同时接受 `running_only` 和 `active_only`）。
- **否决原因**：
  - 别名污染加剧，代码充斥 `args.a || args.b`，增加边界状态复杂度；
  - 出参双写成倍浪费 LLM 上下文 Token，破坏 ADR-0009 反臃肿与防 AI 幻觉原则。

### Option 4 (Chosen): 两层正交规约（Dual-Domain Boundary）+ 纯净零别名规范
- **描述**：
  1. **模型调用入参（Agent Tool Inputs）**：100% 严格统一为 **`snake_case`**；
  2. **机器消费出参（Tool Output Payloads）**：100% 严格统一为 **`camelCase`**；
  3. **核心实体词根**：统一使用 `session_id` (入参) / `sessionId` (出参)，结合上下文角色明确前缀；
  4. **清理兼容别名**：生产代码和类型定义中剔除兼容别名。
- **采纳优势**：
  - 契合 DSH 工具生态的入参惯例与 JS/TS/Web 前端的出参惯例；
  - 零别名、零额外 Token 损耗、100% 类型安全与全链路参数对称。

---

## 4. Decision Outcome

**Chosen Decision**: 采纳 Option 4，确立全链路正交命名技术规范。

### 4.1 核心架构不变式（Architectural Invariants）

1. **Invariant 1 (Input Snake-Case Invariant)**：
   所有向 LLM 声明与由 LLM 传入的工具入参属性名，必须无条件采用 **`snake_case`**。严禁在入参 Schema、运行时解析或 TypeScript 入参接口中引入驼峰字段或别名字段。

2. **Invariant 2 (Output Camel-Case Invariant)**：
   所有工具执行返回给调用方（大模型及宿主运行时）的 JSON 对象顶层及嵌套属性名，必须无条件采用标准英文 **`camelCase`**。严禁在出参中混入蛇形字段（严禁返回 `session_id`、`total_count` 等）。

3. **Invariant 3 (Zero-Alias Anti-Pollution Invariant)**：
   生产代码（`lib/*.mjs`）与工具入口（`index.mjs`）严禁保留用于兼容历史错误的别名逻辑（如 `args.active_only || args.running_only`、`args.reasoningEffort || args.reasoning_effort` 等）。非法入参必须被严格模式或 Schema 校验阻断。

4. **Invariant 4 (Session Identifier Role-Root Invariant)**：
   会话标识符实体词根必须为 `session_id`（入参）与 `sessionId`（出参），禁止缩写为 `id` 或 `target_id`：
   - 目标会话：入参统一为 `target_session_id`，出参统一为 `targetSessionId`；
   - 发起方会话：出参统一为 `callerSessionId`；
   - 发布者会话：出参统一为 `authorSessionId`；
   - 独立/本体会话：出参统一为 `sessionId`。

---

### 4.2 六大原生工具权威参数契约总表

#### 1. `session_query`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明与废除别名 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `query` | `string` | 否 | - | 模糊搜索关键词（匹配 Session ID 或 Title） |
| **入参** | `running_only` | `boolean` | 否 | `false` | 仅返回处于 running 状态的会话。**废除 `active_only` 别名** |
| **入参** | `cross_workspace` | `boolean` | 否 | `false` | 是否跨工作区全局查询 |
| **入参** | `top_level_only` | `boolean` | 否 | `true` | 是否仅列出顶层会话（排除子代理） |
| **入参** | `limit` | `integer` | 否 | `50` | 返回条数上限（1~100） |
| **出参** | `success` | `boolean` | 是 | - | 执行是否成功 |
| **出参** | `count` | `integer` | 是 | - | 本次实际返回会话数量 |
| **出参** | `totalCount` | `integer` | 是 | - | 匹配到的总会话数量（严禁 `total_count`） |
| **出参** | `activeCount` | `integer` | 是 | - | 处于 running 状态的会话数（严禁 `active_count`） |
| **出参** | `idleCount` | `integer` | 是 | - | 处于 idle 状态的会话数（严禁 `idle_count`） |
| **出参** | `scope` | `string` | 是 | - | 生效作用域（规范化工作区路径或 `'global'`） |
| **出参** | `sessions` | `SessionInfo[]` | 是 | - | 结构化会话明细列表（各项见下表） |

> **`SessionInfo` 明细项契约**：
> - `sessionId`: `string`（当前会话全局唯一 ID，严禁 `session_id`）
> - `title`: `string`（人类可读标题）
> - `status`: `'running' | 'idle'`（两态规范化状态）
> - `workspace`: `string`（工作区绝对规范化路径）
> - `cwd`: `string`（工作目录路径，同 workspace）
> - `isCurrent`: `boolean`（是否为发起查询的当前会话，严禁 `is_current`）

---

#### 2. `session_call`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明与废除别名 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `target_session_id` | `string` | **是** | - | 目标会话 ID 或 >=8 位唯一前缀。**禁止 `target_id` / `sessionId`** |
| **入参** | `message` | `string` | **是** | - | 任务指令、汇报或通知内容（1~4000 字符） |
| **入参** | `call_type` | `string` | 否 | `'task_dispatch'` | `'task_dispatch' | 'task_report' | 'notice'` |
| **入参** | `context_post_ids` | `string[]` | 否 | `[]` | 关联公共黑板条目 ID 列表（严禁 `contextPostIds`） |
| **出参** | `success` | `boolean` | 是 | - | 单播调用是否成功 |
| **出参** | `targetSessionId` | `string` | 否 | - | 实际命中的目标 Session ID（严禁 `target_session_id`） |
| **出参** | `targetTitle` | `string` | 否 | - | 目标会话人类可读标题 |
| **出参** | `targetStatus` | `string` | 否 | - | 目标会话执行状态（`'running' | 'idle'`） |
| **出参** | `deliveryMode` | `string` | 否 | - | 原生分发模式（`'steer' | 'followup'`） |
| **出参** | `callType` | `string` | 否 | - | 本次呼叫意图分类 |
| **出参** | `callerSessionId` | `string` | 否 | - | 发起方 Session ID |
| **出参** | `contextPostIds` | `string[]` | 否 | - | 成功挂载的黑板条目 ID 列表 |
| **出参** | `message` | `string` | 否 | - | 人类可读执行描述 |
| **出参** | `error` | `string` | 否 | - | 失败错误原因描述 |

---

#### 3. `session_create`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明与废除别名 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `title` | `string` | 否 | 推导 | 会话标题（1~60 字符，过滤特权前缀） |
| **入参** | `initial_message` | `string` | 否 | - | 可选初始任务指令（<=4000 字符） |
| **入参** | `context_post_ids` | `string[]` | 否 | `[]` | 可选关联的黑板条目 ID 列表（最多 5 个） |
| **入参** | `model` | `string` | 否 | 继承 | 可选覆写模型 ID（支持 `provider/model` 格式） |
| **入参** | `reasoning_effort` | `string` | 否 | 继承 | 可选推理强度。**废除 `reasoningEffort` 别名** |
| **入参** | `preset` | `string` | 否 | 继承 | 可选智能体预设 ID。**废除 `agentPreset` 别名** |
| **入参** | `workspace` | `string` | 否 | `callerWorkspace` | 可选目标工作区规范化路径。缺省时继承调用方工作区（ADR-0003 默认安全策略，区别于 ADR-0008 架构零污染硬约束） |
| *排除* | *(sessionId)* | - | - | - | **从入参定义移除，禁止作为工具参数传参** |
| **出参** | `success` | `boolean` | 是 | - | 会话创建是否成功 |
| **出参** | `sessionId` | `string` | 否 | - | 新建平级会话全局唯一 ID（严禁 `session_id`） |
| **出参** | `title` | `string` | 否 | - | 会话规范化标题 |
| **出参** | `workspace` | `string` | 否 | - | 规范化工作区绝对路径 |
| **出参** | `status` | `string` | 否 | - | 会话初始状态（`'running' | 'idle'`） |
| **出参** | `generation` | `number` | 否 | - | 会话代际深度 |
| **出参** | `bootstrapPostId` | `string | null` | 否 | - | 就绪公告关联黑板条目 ID |
| **出参** | `contextPostIds` | `string[]` | 否 | - | 成功关联挂载的黑板 ID 列表 |
| **出参** | `error` | `string` | 否 | - | 失败错误原因描述 |

---

#### 4. `board_post`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `topic` | `string` | **是** | - | 主题/业务分类（1~128 字符，拦截保留域） |
| **入参** | `content` | `string` | **是** | - | 消息主体正文（最大 64KB） |
| **入参** | `tags` | `string[]` | 否 | `[]` | 检索标签列表（最多 10 个） |
| **入参** | `ttl` | `integer` | 否 | `3600` | 生存时间（秒，0~86400） |
| **入参** | `metadata` | `object` | 否 | `{}` | 可选结构化扩展元数据键值对 |
| **出参** | `success` | `boolean` | 是 | - | 发布是否成功 |
| **出参** | `postId` | `string` | 否 | - | 生成的条目唯一 ID（严禁 `post_id`） |
| **出参** | `topic` | `string` | 否 | - | 条目所属主题 |
| **出参** | `authorSessionId`| `string` | 否 | - | 发布者 Session ID（严禁 `author_session_id`） |
| **出参** | `createdAt` | `string` | 否 | - | 创建时间（ISO 8601，严禁 `created_at`） |
| **出参** | `expiresAt` | `string` | 否 | - | 到期时间（ISO 8601，严禁 `expires_at`） |
| **出参** | `scope` | `string` | 否 | - | 可见性作用域 |
| **出参** | `message` | `string` | 否 | - | 人类可读提示信息 |
| **出参** | `error` | `string` | 否 | - | 失败错误原因描述 |

---

#### 5. `board_list`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明与废除别名 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `id` | `string` | 否 | - | 按条目唯一 ID 精确点查。有值时 `titles_only` 默认为 false |
| **入参** | `topic` | `string` | 否 | - | 完整主题过滤 |
| **入参** | `topic_prefix` | `string` | 否 | - | 主题前缀过滤。**内部废除 `topicPrefix` 别名** |
| **入参** | `tag` | `string` | 否 | - | 单个标签过滤 |
| **入参** | `active_only` | `boolean` | 否 | `true` | 是否仅返回有效活跃条目 |
| **入参** | `cross_workspace`| `boolean` | 否 | `false` | 是否跨工作区检索。**内部废除 `crossWorkspace` 别名** |
| **入参** | `titles_only` | `boolean` | 否 | 智能分流 | 是否仅返回标题摘要。**内部废除 `titlesOnly` 别名** |
| **入参** | `limit` | `integer` | 否 | `20` | 返回条数上限（1~100） |
| **出参** | `success` | `boolean` | 是 | - | 查询是否成功 |
| **出参** | `count` | `integer` | 是 | - | 返回条目数量 |
| **出参** | `scope` | `string` | 是 | - | 生效作用域 |
| **出参** | `titlesOnly` | `boolean` | 是 | - | 实际生效的摘要模式（严禁 `titles_only`） |
| **出参** | `posts` | `Array` | 是 | - | 条目列表（包含 `authorSessionId`, `createdAt`, `expiresAt` 等） |

---

#### 6. `board_clear`
| 类别 | 规范参数名 | 数据类型 | 必须 | 默认值 | 语义说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **入参** | `id` | `string` | 否* | - | 目标条目 ID（与 `topic` 二选一） |
| **入参** | `topic` | `string` | 否* | - | 目标主题（与 `id` 二选一） |
| **入参** | `mode` | `string` | 否 | `'dismiss'` | 清理模式：`'dismiss'` 软归档，或 `'purge'` 物理删除 |
| **出参** | `success` | `boolean` | 是 | - | 清理是否成功 |
| **出参** | `clearedCount` | `number` | 是 | - | 实际受影响条目数（严禁 `cleared_count`） |
| **出参** | `action` | `string` | 否 | - | 执行的具体动作类型（`'archive' | 'delete'`） |
| **出参** | `message` | `string` | 否 | - | 结果提示文本 |
| **出参** | `error` | `string` | 否 | - | 失败原因描述 |

---

### 4.3 跨工具参数流转模型（End-to-End Linkage Pipeline）

```
                     [ session_query ]
                             │
                             ▼ 出参: sessionId
                   { sessionId: "session-abc12345" }
                             │
                             │ (对称输入：target_session_id = sessionId)
                             ▼
                     [ session_call ]
                   target_session_id: "session-abc12345"
                             │
                             ▼ 出参: targetSessionId, callerSessionId
                   { targetSessionId, callerSessionId, deliveryMode: "followup" }
```

```
                     [ board_post ]
                             │
                             ▼ 出参: postId
                   { postId: "post-1725300000-xyz" }
                             │
                             │ (关联传递：context_post_ids = [postId])
                             ▼
               [ session_call / session_create ]
                   context_post_ids: ["post-1725300000-xyz"]
                             │
                             │ (对端点查：id = postId)
                             ▼
                     [ board_list ]
                   id: "post-1725300000-xyz"
```

---

## 5. ADR 规范文档审查与修正案（ADR Review & Amendment Schedule）

对照本技术规范，对既有 ADR 形成如下强制修正决议：

1. **ADR-0001 修正案**：
   - §4.2 拓扑图勘误：将 `board_clear(post_id, topic)` 纠正为 `board_clear(id, topic, mode)`；
   - §4.3.1 接口契约修正：移除 `board_list` 入参中的驼峰字段 `authorSessionId`，明确入参统一为 `snake_case`；
   - 增加 §4.4：明确阐述“模型入参采用 `snake_case`，机器出参采用 `camelCase`”的架构分层不变式。

2. **ADR-0005 修正案**：
   - §1.2 & §4.1 核心原则补充：说明 ADR-0005 确立的 `camelCase English JSON Schema` 专指出参（Machine Layer Return Values）；
   - §4.3 补充说明：明确与入参 `snake_case` 的正交协作边界，入参面向 LLM 自然指令，出参面向结构化运行时消费；
   - 废止任何在 `session_query` 入参中支持 `active_only` 的说明，固化入参为 `running_only`。

3. **ADR-0006 修正案**：
   - §4.2 流程图拓扑勘误：将 `session_call(target_id, message, call_type, context_post_ids)` 纠正为标准参数名 `session_call(target_session_id, message, call_type, context_post_ids)`，消除 `target_id` 别名。

4. **ADR-0010 修正案**：
   - §4.3.2 参数契约修正：将 `session_create` 参数声明全面升级为本规范定义的标准 `snake_case`（含 `reasoning_effort` 与 `preset`）；
   - 正式声明 `session_create` 不接收外部传入的 `sessionId` 入参（会话 ID 一律由引擎生成）；
   - 确立出参标准为 camelCase（`sessionId`, `workspace`, `status`, `generation`, `bootstrapPostId`, `contextPostIds`）。

5. **ADR-0011 修正案**：
   - §4.3.2 逻辑修正：明确 `board_list` 入参严格收敛为 `snake_case`（`id`, `topic`, `topic_prefix`, `tag`, `active_only`, `cross_workspace`, `titles_only`, `limit`）；
   - 宣告废止代码层对 `topicPrefix`、`crossWorkspace`、`titlesOnly` 的冗余别名读取。

6. **ADR-0015 修正案**：
   - §2.1 & §2.2 契约修正：明确工具入参命名严格对齐 `args.reasoning_effort` 与 `args.preset`；
   - 废止 `reasoningEffort` 与 `agentPreset` 在入参层面的双轨别名。

---

## 6. Consequences

### 6.1 Positive Consequences (Benefits)
- **消除全链路认知负荷**：所有工具入参统一为 `snake_case`，出参统一为 `camelCase`，规则简明确定，无特例，无割裂。
- **清理冗余兼容代码**：移除所有双轨别名读取，消除潜在分支漏洞，提升 TypeScript 类型安全与编译期确定性。
- **保护前端与看板数据系统**：明确固化 `sessionId`、`targetSessionId`、`callerSessionId` 出参，协作看板与看板数据管道稳定兼容。
- **参数链路对称流转**：从会话发现到单播呼叫，再到黑板引用，参数命名对称一致。

### 6.2 Implementation Directives (Handoff to Task 2 & Downstream)
- **Task 2 (fullstack-dev)**：
  - 依照本规范清理 `lib/session-call.mjs`, `lib/session-create.mjs`, `lib/session-query.mjs`, `index.mjs`；
  - 移除 `args.active_only`、`args.reasoningEffort`、`args.agentPreset` 以及入参 `args.sessionId` 兼容逻辑；
  - 同步更新 `types/session-call.d.ts`, `types/session-create.d.ts`, `types/session-query.d.ts`, `types/index.d.ts`，移除无用别名字段；
  - 执行 `npm run lint` 与 `npm run typecheck` 确保类型 100% 对齐。
- **Task 3 (fullstack-dev)**：
  - 更新测试套件中显式使用废除别名的测试用例，全量回归验证 193+ 测试。
- **Task 4 (code-reviewer)**：
  - 对照本 ADR 逐项审查代码改造与别名清理的完整性。
- **Task 5 (fullstack-dev)**：
  - 依据 §5 修正案内容，更新 ADR-0001/0005/0006/0010/0011/0015 并同步至 3080 运行时。

---

## 7. Status History & Related Artifacts

- **2026-09-11**: Proposed and Accepted by Architecture Lead as part of `spec-unification-team` Task 1.
- **Related ADRs**:
  - Amends & Unifies: [ADR-0001](./0001-separation-of-concerns-board-vs-call.md)
  - Amends & Complements: [ADR-0005](./0005-english-metadata-and-two-state-status.md)
  - Amends: [ADR-0006](./0006-pure-dsh-native-in-process-context-injection.md)
  - Amends: [ADR-0010](./0010-dynamic-state-mirror-and-peer-session-lifecycle.md)
  - Amends: [ADR-0011](./0011-board-list-token-governance-and-exact-retrieval.md)
  - Amends: [ADR-0015](./0015-peer-session-model-and-preset-inheritance.md)
- **Primary Implementation Files**:
  - `index.mjs`
  - `lib/session-call.mjs`
  - `lib/session-create.mjs`
  - `lib/session-query.mjs`
  - `types/*.d.ts`
