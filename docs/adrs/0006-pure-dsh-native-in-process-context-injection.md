# ADR-0006: Pure DSH Native In-Process Context Injection and State-Aware Dual Dispatch

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Engineering Team, DSH Ecosystem Team
- **Consulted**: Core Contributors, Community Users
- **Informed**: All Plugin Consumers, Downstream Subagents, DSH Web Interface Users

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points
在早期实现中，系统采用外部 HTTP 接口与伪报文文本进行跨会话消息传递：
1. **HTTP 请求模拟**：在 `lib/session-call.mjs` 中，通过 Node.js 原生 `fetch('http://127.0.0.1:3080/api/session.prompt')` 模拟用户输入；
2. **文本信封定界符**：使用 `buildCrossSessionNoticeText` 拼装由 `[SYSTEM: CROSS-SESSION AGENT DISPATCH]`、`From: ...`、`To: ...`、`--- DISPATCH CONTENT ---` 和 `[SYSTEM DIRECTIVE]` 组成的包装文本；
3. **用户角色伪装 (`source: { kind: 'user' }`)**：将机器间调度标记为人类用户的会话输入。

这种做法存在以下问题：
- **网络层脆弱性**：依赖硬编码 3080 端口与本地 HTTP 服务，在端口变更或多实例环境下容易失效；
- **上下文污染与 Token 增加**：每次调度在持久会话记录中注入定界符标记，增加 Token 开销并干扰模型对核心指令的注意力；
- **Web UI 视觉侵占**：标记为用户角色使调度消息在 DSH Web 前端渲染为完整对话气泡，无法使用折叠通知行。

### 1.2 Architectural Forces & Constraints
- **Zero-Network Invariant**：同一宿主进程内的会话协同不发起外部或回环 HTTP 网络请求；
- **Native Context Model**：遵循 `@deepseek-ai/dsh-llm` 的 `MessageSource` 规范声明插件源；
- **State-Awareness**：根据目标 Agent 的实时执行态（`idle` 与 `running`）分流调度策略，避免并发冲突。

---

## 2. Decision Drivers

- **Driver 1 (Eliminate External Network Hopping)**：依托 DSH 进程内内存注册表 `ctx.agents` 实现直接调用；
- **Driver 2 (Preserve Pure Context)**：去除信封定界符，保证传入模型的消息 Payload 仅包含纯文本指令；
- **Driver 3 (Native Visual Integration)**：对接 DSH Web UI 的 `ContextInjectionRow`，实现折叠插件通知形态；
- **Driver 4 (Robust State-Adaptive Dispatch)**：消除跨会话呼叫与目标正在执行思考轮次时的并发冲突。

---

## 3. Considered Options

### Option 1: Retain HTTP Prompt and Only Polish Envelope Strings (Rejected)
- **Description**: 继续保留 `fetch(/api/session.prompt)`，仅简化 `buildCrossSessionNoticeText` 中的定界符。
- **Pros**: 改动最小，无需深入探究 DSH 底层内部类。
- **Cons**: 无法解决端口硬编码、本地网络开销、无法在沙箱受限环境下运行等根本问题，依然严重违背 Cordis 插件设计哲学。

### Option 2: Pure Memory Unicast but Maintain Text Envelope (Rejected)
- **Description**: 将通信切为 `ctx.agents.get(...)`，但继续保留 RFC-822 假信封文本。
- **Pros**: 实现了内存直连。
- **Cons**: 依然未能根治上下文污染与 Token 浪费，前端依然将其当做普通文本处理，破坏了专业的多智能体协同体验。

### Option 3 (Chosen): Pure Native In-Process Direct Lookup + Semantic MessageSource + Dual-Channel Steer/Followup
- **Description**: 废除 HTTP 与定界符包装，通过 `ctx.agents.get(...)` 获取目标实例；使用 `source: { kind: 'plugin', plugin: 'dsh-call-session', form: 'notice', summary: '...' }` 封装 Payload；目标 `idle` 调用 `followup`，目标 `running` 调用 `steer`。
- **Pros**: 消除网络请求与文本包装开销，直接使用进程内内存对象，对接原生 UI 折叠通知。
- **Cons**: 需要重构 `session_call` 核心实现并废除历史辅助函数。

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Pure Native In-Process Direct Lookup + Semantic MessageSource + Dual-Channel Steer/Followup.

### 4.1 Core Architectural Invariants
1. **Invariant 1 (Zero-HTTP)**：插件源码内不出现针对宿主自身 prompt API 的 HTTP 调用；
2. **Invariant 2 (Zero-Envelope & Transport Semantic Header)**：
   - **严格区分客观报头与指令污染**：禁止伪造系统角色（如 `[SYSTEM: CROSS-SESSION...]`）或注入命令式业务指令（如 `[SYSTEM DIRECTIVE] 请立刻处理...`）。正文前注入客观传输层语义报头（Transport Semantic Header），承载发件人身份与调用类别元数据，属于基础通信设施而非指令污染；
   - **报头技术规范**：
     - 首行注入标准报头：`[From: <callerSessionId> (<callerTitle>) | CallType: <callType>]`；
     - 若携带公共黑板上下文关联，换行追加：`> Context Ref: #post-xxx, #post-yyy`；
     - 报头与原始正文之间使用空行（`\n\n`）隔离；
     - 原始正文保持原样透传，不篡改内容，不追加指令；
3. **Invariant 3 (Pure Plugin Source)**：消息源显式声明为 `{ kind: 'plugin', plugin: 'dsh-call-session', form: 'notice', summary: '...' }`；
4. **Invariant 4 (State-Adaptive Routing)**：
   - 目标为 `idle`：使用 `targetAgent.followup(userMessage)` 唤醒下一轮对话；
   - 目标为 `running`：使用 `targetAgent.steer(userMessage)` 在单步决策边界注入；
5. **Invariant 5 (Clean Transport Pipe & Zero Auto-ACK)**：
   - 插件仅作为进程内通信传输管道，不承担上层业务编排职责；
   - 禁止在插件底层引入自动确认（Auto-ACK）、自动回音或轮询守护；通信何时回复、何时收口，由双方模型依据类别语义与业务上下文自主决断；
6. **Invariant 6 (Graceful Degradation)**：
   - 当发件人 `callerSessionId` 或标题缺失时，报头降级为默认占位标识（如 `unknown-caller` 与默认标题），避免调用中断。

### 4.2 In-Memory Dispatch Topology (ADR-0016 Parameter Alignment)
```
[Caller Agent] ---> session_call(target_session_id, message, call_type, context_post_ids)
                         │
                         ▼  buildTransportPayload (with graceful fallback)
           ┌───────────────────────────────────────────────┐
           │ [From: caller-xxx (Title) | CallType: type]   │
           │ > Context Ref: #post-123 (Optional)           │
           │                                               │
           │ <rawMessage> (100% untouched)                 │
           └───────────────────────────────────────────────┘
                         │
                         ▼
         [resolveAgent(target_session_id)]
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
 target.status == 'idle'          target.status == 'running'
        │                                 │
        ▼                                 ▼
 target.followup(msg)              target.steer(msg)
 (next-turn, wakeup=true)         (next-step, wakeup=true)
        │                                 │
        └────────────────┬────────────────┘
                         ▼
           [DSH Web: ContextInjectionRow]
              (Plugin Notice 折叠条)
```

### 4.3 模式对照

| 维度 | 传输层客观报头 (Transport Semantic Header) | 指令污染反模式 (Prohibited Anti-patterns) |
|---|---|---|
| **定位** | 底层通信元数据（类比邮件报头） | 侵入式指令与催促文本 |
| **典型内容** | `[From: caller (Title) | CallType: dispatch]`、`> Context Ref: #...` | `[SYSTEM DIRECTIVE] 请立即处理并回复...`、`[SYSTEM: DISPATCH]` |
| **正文处理** | 空行隔离，消息内容逐字原样保留 | 包装、篡改或追加格式化尾部指令 |
| **语气** | 客观元数据，无人称代词，无情绪倾向 | 命令式催促、伪系统角色 |
| **规则判定** | **允许且必需 (Required)** | **严格禁止 (Prohibited)** |

#### 架构反模式清单
1. **反模式 1：伪系统指令与命令式催促**
   - 严禁在消息中注入“请立即执行”、“收到请答复”等命令式文本，不得干涉目标 Agent 的自主规划。
2. **反模式 2：底层自动确认回路（Auto-ACK Loop）**
   - 严禁在插件底层或消息接收时由基础设施自动反向调用 `session_call` 进行确认，避免引发连锁反射风暴。
3. **反模式 3：底层轮询守护与状态机**
   - 严禁在插件底层轮询目标会话状态等待回复，严禁硬编码对话轮次计数器；通信流程由双方模型根据语义决定是否结束。

### 4.4 意图收敛

在系统提示词与工具契约中明确三类调用意图的结束规则：

| 呼叫意图 (`call_type`) | 语义定位 | 交互结束规则 (Convergence Rule) |
|---|---|---|
| `task_dispatch` | 任务派发、行动建议或前置请求 | 接收方处理后，仅在需要回传产物或结论时以单次 `task_report` 答复；无需返回结果则不回复。 |
| `task_report` | 任务结果汇报、产物交付或答复 | 表示当前协作单元已收口。发起方接收后归档，无需回复。 |
| `notice` | 单向状态通报或客观知悉 | 纯通知属性，阅后即止，接收方不调用 `session_call` 发起回复。 |

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **低延迟调用**：消除网络 TCP 握手与 HTTP 解析开销，直接使用进程内调用；
- **来源与意图明确**：通过客观报头透传发件人身份与分类意图，避免回复目标缺失或意图不明；
- **语义收敛**：确立 dispatch / report / notice 的交互语义，避免无限循环与双向等待；
- **正文保持无损**：原始消息内容原样保留，不拼接额外指令；
- **界面展现紧凑**：Web 界面呈现为折叠通知行，展开后可查看原始指令与报头，减少视觉干扰；
- **并发安全**：通过 `steer` 支持目标执行过程中的安全引导，避免状态冲突。

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **正文前置包含元数据**：接收端正文包含 1~2 行元数据。
  - *Mitigation*: 采用中括号与引用语法隔离，模型可将报头与后续正文自然区分。
- **旧测试断言变更**：针对裸消息正文的全等断言需更新为报头正则加正文校验。
  - *Mitigation*: 同步更新单元测试断言，验证报头格式与正文无损。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **网络零调用检查**：单元测试断言 `session_call` 执行过程无 `fetch` 或网络 I/O；
- **报头技术格式检查**：断言目标接收到的首行严格匹配 `^\[From: .+? \(.+?\) \| CallType: (task_dispatch|task_report|notice)\]` 正则；
- **上下文引用语法检查**：若携带 `context_post_ids`，断言换行追加 `> Context Ref: #...` 引用行；
- **原始正文无损检查**：断言报头双换行后紧接的内容与入参 `message` 逐字完全相等；
- **优雅降级容错检查**：发件人上下文缺失或未定义时，断言报头安全回退至 `unknown-caller` 与默认标题，不抛出异常；
- **消息源类型检查**：断言 `userMessage.source` 具有正确的 `kind: 'plugin'` 与 `form: 'notice'`；
- **双态分支测试**：分别模拟目标处于 `idle` 与 `running`，断言分别触发 `followup` 与 `steer`。

### 6.2 Review Checklist
- [ ] `lib/session-call.mjs` 抽象 `buildTransportPayload` 纯函数，包含报头注入与正文组装；
- [ ] `lib/session-call.mjs` 针对未解析或空白 `callerSessionId` / `callerTitle` 实施优雅降级；
- [ ] `index.mjs` 的 `usageSectionText` 与 `session_call` Schema 完整补充三类意图与结束规则；
- [ ] 无任何业务指令或催促文本注入；
- [ ] 无底层轮询、无底层自动 ACK 机制；
- [ ] 全量回归测试 100% 通过。

---

## 7. Status History & Related Artifacts

- **2026-09-04**: Proposed & Accepted by Engineering Team (Initial In-Process Direct Lookup)
- **2026-09-15**: Clarified & Revised by Architect (Clarify Zero-Envelope vs Transport Semantic Header, Specify Objective Headers, Define Convergence Contracts, Anti-patterns, and Graceful Degradation)
- **Related ADRs**:
  - Supersedes: 废除 ADR-0001 中关于 HTTP 触发与文本报文生成的残留实现描述
  - Related to: ADR-0007 (Web Slash Command - Superseded), ADR-0008 (Global Profile Mounting), ADR-0010 (State Idempotency), ADR-0012 (Call Telemetry & Canvas Isolation)
- **Implementation Artifacts**:
  - `lib/session-call.mjs`
  - `index.mjs`
  - `tests/session-call.test.mjs`