# ADR-0010: Dynamic Blackboard State Mirror Projection and Controlled Peer Session Lifecycle

- **Status**: Accepted
- **Date**: 2026-09-07
- **Deciders**: Architect (Mirror & Session), Engineering Team, Security Reviewer, DSH Ecosystem Team
- **Consulted**: Core Contributors, Multi-Agent Teams Reviewers
- **Informed**: All Plugin Users, Downstream Agents, DSH Web Interface Users

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points
随着 DSH 在多智能体协同（AgentTeams）及多会话自主协作场景下的深入应用，两类突出的架构阻抗逐渐显现：

1. **黑板感知困境（The Blind Spot vs Polling Storm Dilemma）**：
   - 公共黑板（`board_store`）基于纯拉取模型（ADR-0001），会话间被动通知（`session_call`）为 1:1 单播（ADR-0006）。
   - 在缺乏主动唤醒的情况下，协作者无法感知黑板上的全局任务与共享状态变动，不得不频繁调用 `board_list` 进行试探性轮询（Exploratory Polling），大幅浪费 Tool Call 轮次并拉长执行时延。
   - 若采用静态提示词注入（`systemPrompt.section`），在会话初始化后无法感知动态状态变动，频繁修改静态 section 又会触发 `system-prompt/change` 全量编译缓存穿透。
2. **易逝时间戳与 LLM Prompt Cache（KV Cache）击穿陷阱**：
   - DSH 0.1.2 的运行时上下文投影机制（`RuntimeContextProjection.project`）采用字符串全等比较（`retained.text === snapshot`）决定是否向 Session 历史追加新快照。
   - 若在动态上下文注入中包含“相对时间差”（如“2分钟前”）或“倒计时”（如“剩余58分”），自然时间流逝会导致每轮 step 比较均不相等，引发**每步追加 Snapshot 消息的雪崩效应**，彻底击穿 LLM 服务端的 KV 前缀缓存（Prompt Caching），引发首字时延（TTFT）剧烈抖动与 Token 费用数倍攀升。
3. **会话销毁后的僵尸条目（Zombie Posts）积压**：
   - 当会话归档、销毁或被终止后，其在黑板发布的临时协调条目（如进行中标记、分布式锁）长期滞留，导致存活 Agent 决策死锁或状态误判。
4. **同级会话创建能力缺失与子代理层级绑定限制**：
   - 现存的 `subagent` 工具仅支持树状父子代理派生，深度绑定于父会话的执行轮次上下文与生命周期，无法生成拥有独立执行循环、与发起方平级的根会话（Root Session）。
   - 缺乏通过工具直接编排、创建平级自治会话的受控通道。

### 1.2 Architectural Forces & Constraints
- **Zero-Latency In-Memory Execution**：所有投影与生命周期拦截必须在 DSH 进程内纯内存纳秒级完成（< 50μs），严禁外部 I/O 阻塞。
- **Prompt Cache Protection (Pure State Invariant)**：上下文投影必须保证严格的文本幂等性，杜绝易逝时间戳，最大化利用服务端 KV 前缀缓存。
- **Hermetic Workspace Scoping**：严格遵循 ADR-0003，状态后视镜与会话创建必须以工作区规范化路径为强制边界，严禁跨项目逃逸。
- **Strict Blast Radius Containment**：平级会话创建必须具备并发配额、调用限频、代际深度熔断与敏感标题过滤，杜绝 Fork Bomb。
- **Zero-External Intrusion**：100% 依托 Cordis 生命周期与 DSH 原生注册表，零修改宿主核心源码。

---

## 2. Decision Drivers

- **Driver 1 (Eliminate Exploratory Tool Polling)**：通过每轮模型决策前的状态后视镜透明感知最新事实，精简静态提示词，消除冗余的 `board_list` 轮询。
- **Driver 2 (Protect LLM KV Cache via State Idempotency)**：通过纯状态幂等表征，确保无黑板实质变更时 0 冗余快照生成、100% 命中 Prompt Caching。
- **Driver 3 (Autonomous Peer Session Orchestration)**：提供原生 `session_create` 工具，支持解耦创建独立同级根会话并完成原子化点火唤醒。
- **Driver 4 (Robust Blast Radius & Security Safeguards)**：建立工作区配额、限频、代际熔断及防伪造 Title 校验，确保系统级稳定性。
- **Driver 5 (Dual-Track Lifecycle Cascade Cleanup)**：事件驱动结合惰性自愈探针，实现会话终结时的黑板状态级联治理。

---

## 3. Considered Options

### 3.1 镜像选型
- **Option 1.1: 静态 Section 频繁覆写 (`systemPrompt.section`)**（否决）
  - *缺点*：修改静态 section 会频繁触发 `system-prompt/change` 全局事件，打碎 DSH 提示词组装流水线缓存，违背其静态配置定位。
- **Option 1.2: 引导 Agent 每轮手动调用 `board_list`**（否决）
  - *缺点*：引入大量无谓 Tool Call，单次往返增加数秒延迟与数百 Token 开销。
- **Option 1.3 (Chosen): DSH 原生 `systemPrompt.context` 动态注入结合纯状态幂等投影**
  - *优点*：原生支持 per-step 动态求值；通过去除易逝时间戳保证文本幂等性，与 `RuntimeContextProjection` 完美契合，兼顾即时性与 KV 缓存保护。

### 3.2 会话选型
- **Option 2.1: 改造 `subagent` 工具增加 sibling 模式**（否决）
  - *缺点*：`dsh-tool-subagent` 深度耦合并发控制、父子调用栈与代理存储，强行改造成平级根会话会破坏其既有契约。
- **Option 2.2: 通过本地 HTTP API 调用 `/api/session.create`**（否决）
  - *缺点*：违反 ADR-0006 不变量（Zero-HTTP），存在端口硬编码、认证与网络脆性。
- **Option 2.3 (Chosen): 原生 Cordis 进程内调用 `ctx.root.agents.create`**
  - *优点*：通过 `ctx.root` 解耦父子作用域，创建标准独立 Root Session，内存纳秒级执行，天然无缝对接 `session_query`、`session_call` 与黑板体系。

---

## 4. Decision Outcome

**Chosen Decision**: 实施方案 Option 1.3（基于 `systemPrompt.context` 的纯状态后视镜与级联清理）与 Option 2.3（基于 `ctx.root.agents.create` 的受控同级会话创建接口）。

### 4.1 核心规范

1. **Invariant 1 (Pure State Idempotency & Cache Protection)**：
   状态后视镜文本严禁输出任何易逝动态时间（如 `remainingSeconds`、`X 分钟前`、`Date.now()`）。过期条目仅在内存求值时布尔静默过滤。仅当黑板发生离散的实体增删改或状态迁移时，投影文本才改变，确保非变更状态下 100% 命中服务端 Prompt KV Cache。
2. **Invariant 2 (Strict Workspace Encapsulation)**：
   状态后视镜严格基于 `resolveSessionCwd(context.agent)` 过滤当前工作区条目；`session_create` 强制继承创建者的规范化工作区路径，严禁跨越工程边界。
3. **Invariant 3 (Bounded Blast Radius)**：
   同一工作区活跃 Root Session 硬配额为 10；单会话创建限频 5 次/分钟；平级派生代际深度上限为 2（Generation <= 2，拒绝第 3 代递归衍生），杜绝 Fork Bomb。
4. **Invariant 4 (Title Integrity & Anti-Spoofing)**：
   会话标题强制过滤 `[SYSTEM]`、`[CAPTAIN]`、`[ROOT]` 等特权伪造前缀，禁止重名，未提供时由初始消息提取并规范化为 `Peer: <Summary>`。
5. **Invariant 5 (Dual-Track Cascaded Cleanup)**：
   兼备事件监听（`workspaceRegistry.archiveSession`、`dispose`）与状态后视镜查询时的惰性自愈探针（`ctx.agents.get`），实现分级清理（dismiss 软归档 / purge 物理抹除 / deliverable-retention 成果免死）。
6. **Invariant 6 (Atomic Fire-and-Forget Ignition)**：
   `session_create` 完成平级会话创建与首条指令挂载后，通过 `followup()` 异步点火，立即返回会话句柄元数据，严禁同步阻塞等待对端执行。

---

### 4.2 架构拓扑

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                 DeepSeek Harness Host                   │
                     └────────────────────────────┬────────────────────────────┘
                                                  │
                 ┌────────────────────────────────┴────────────────────────────────┐
                 ▼                                                                 ▼
   [ Dynamic State Mirror ]                                         [ Peer Session Creation ]
  (systemPrompt.context: 130)                                         (Tool: session_create)
                 │                                                                 │
                 ▼                                                                 ▼
      assembleContextFor(agent)                                         ctx.root.agents.create
                 │                                                                 │
    ┌────────────┴────────────┐                                        ┌───────────┴───────────┐
    ▼                         ▼                                        ▼                       ▼
Active Posts (Memory)   Anti-Snapshot-Storm                      Quota & Rate Check     Sandboxed Context
(CWD Filtered, Top 3~5) (Pure State Idempotency)                 (Max 10, Gen <= 2)     (Workspace Invariant)
    │                         │                                        │                       │
    └────────────┬────────────┘                                        └───────────┬───────────┘
                 ▼                                                                 ▼
      [LLM Step Injection]                                            [New Root Session Spawned]
 (0 Token Storm / 100% KV Cache)                                                   │
                                                                                   ▼
                                                                     targetAgent.followup(initMsg)
                                                                       (Fire-and-Forget Ignition)
                                                                                   │
                                                                                   ▼
                                                                       board_post('session:bootstrap')
```

---

### 4.3 接口契约

#### 4.3.1 状态镜像
- **注册位置**：`ctx.systemPrompt.context`
- **排序权重**：`130`（紧随 `SUBAGENT_DELEGATION: 120` 之后，作为环境事实层）
- **数据结构契约**：
  ```markdown
  [Active Blackboard State Mirror]
  - [#post-17253000-abcd] (task:audit) AuditorA: Security audit failed on token validation [tags: p0, blocked]
  - [#post-17253000-ef01] (spec:api) Architect: ADR-0010 specification confirmed [tags: ready]
  ```
- **熔断与容量控制**：
  - 条目数上限：最多 3~5 条当前工作区活跃条目；
  - 标题摘要截断：单条标题严格截断至 60 字符；
  - 字符与 Token 预算：总长度硬上限 800 字符（约 100~250 Tokens）；
  - 空状态：无活跃条目时返回空字符串 `''`，DSH 自动略过，达成 0 Token 零开销。

#### 4.3.2 会话创建
- **Tool 名称**：`session_create`
- **描述**：`创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。`
- **输入参数（Parameters Schema）**：
  ```json
  {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 60,
        "description": "同级会话的人类可读标题。禁止特权前缀与换行符。"
      },
      "initial_message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4000,
        "description": "点火初始任务指令，会话创建后立即自动投递并启动第一轮。"
      },
      "context_post_ids": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 5,
        "description": "可选关联的黑板条目 ID，将自动挂载至初始任务指令首部。"
      },
      "model": {
        "type": "string",
        "description": "可选覆写目标会话所使用的模型 ID。默认继承当前会话模型。"
      }
    },
    "required": ["initial_message"]
  }
  ```
- **返回值结构（Return Schema）**：
  ```json
  {
    "success": true,
    "sessionId": "session-12345678-abcd-ef01",
    "title": "Peer: Data Migration Worker",
    "workspace": "d:/Users/ASHH/Documents/CodePR/TSPR/dsh-call-session",
    "status": "running",
    "generation": 1,
    "bootstrapPostId": "post-1788770000-boot"
  }
  ```

---

## 5. Consequences

### 5.1 Positive Consequences
- **彻底消除试探性工具调用**：Agent 在每轮执行前均能在上下文后视镜中纵览全局活跃状态，消除盲目 `board_list` 轮询，单轮端到端响应耗时减少 30%~50%。
- **完美保护服务端 Prompt 缓存**：纯状态幂等投影消除了快照雪崩效应，维持了 LLM 稳定的 Prompt 前缀缓存，降低 Token 成本。
- **破除多智能体拓扑局限**：突破传统树状父子 Subagent 嵌套约束，支持在统一工程工作区内编排平级根会话网络。
- **高弹性爆炸半径防护**：配额限制、频次滑动窗口与代际熔断共同筑起多道防火墙，保证复杂衍生场景下的宿主稳定。
- **全生命周期自愈与审计追踪**：双轨级联清理根治了僵尸黑板条目，资产豁免保护防止了团队协作成果丢失。

### 5.2 Negative Consequences & Mitigations
- **配额上限约束**：单工作区最多同时存在 10 个活跃平级根会话。
  - *缓解措施*：会话完成使命后，可通过常规归档（`workspaceRegistry.archiveSession`）释放配额槽位。
- **代际派生限制**：平级衍生深度硬限制为 2 代。
  - *缓解措施*：绝大多数合理架构仅需 1~2 层编排；更复杂的深层分工应由 AgentTeams 队长统筹，而非无限随意派生。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **后视镜幂等性与快照防雪崩测试**：
  - 断言连续多个执行 step 且黑板无变更时，`systemPrompt.context` 返回字符串绝对全等；
  - 验证 `RuntimeContextProjection.project` 不产生新的 `user/message`。
- **工作区绝对隔离测试**：
  - 模拟多工作区会话，断言后视镜与 `session_create` 绝不串透不同工作区的数据与路径。
- **爆炸半径安全断言**：
  - 配额饱和后调用 `session_create`，断言立即抛出 `[QuotaExceeded]`；
  - 模拟 Generation 2 再次创建，断言拦截代际穿透；
  - 尝试使用 `[SYSTEM]` 伪造标题，断言被沙箱强制重命名或拦截。
- **生命周期级联清理测试**：
  - 会话归档后，断言其所发条目从活跃列表和后视镜中消失；
  - 带有 `artifact` 标签的条目保持存在并打标作者已离线。

---

## 7. Status History & Related Artifacts

- **2026-09-07**: Proposed following comprehensive multi-agent architectural review.
- **2026-09-07**: Accepted following full compliance review and passing e2e adversarial test suite.
- **Related ADRs**:
  - Extends: ADR-0001 (Board vs Call Separation), ADR-0003 (Workspace Scoped Isolation), ADR-0006 (Native In-Process Context Injection)
  - Complements: ADR-0004 (Atomic Persistence Engine), ADR-0008 (Global Profile Mounting)
- **Primary Implementation Anchors**:
  - `index.mjs` (SystemPrompt Context Hook, Tool Registration)
  - `lib/board-store.mjs` (Cascade Cleanup, Mirror Projection Formatter)
  - `lib/session-create.mjs` (New Engine: Quota, Title Sanitizer, Fire-and-Forget Ignition)
  - `lib/session-query.mjs` (Active Quota Calculation & Lifecycle Probes)
