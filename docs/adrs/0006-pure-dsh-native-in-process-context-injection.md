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
2. **Invariant 2 (Zero-Envelope)**：`content[0].text` 只包含调用消息本身，不拼装额外信封定界符；
3. **Invariant 3 (Pure Plugin Source)**：消息源显式声明为 `{ kind: 'plugin', plugin: 'dsh-call-session', form: 'notice', summary: '...' }`；
4. **Invariant 4 (State-Adaptive Routing)**：
   - 目标为 `idle`：使用 `targetAgent.followup(userMessage)`；
   - 目标为 `running`：使用 `targetAgent.steer(userMessage)` 在 step boundary 注入。

### 4.2 In-Memory Dispatch Topology
```
[Caller Agent] ---> session_call(target_id, message)
                         │
                         ▼
             [ctx.agents.get(target_id)]
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

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **低延迟调用**：消除网络 TCP 握手与 HTTP 解析开销，采用进程内内存调用；
- **纯净上下文**：目标 LLM 接收直接任务指令，不包含信封定界符干扰；
- **界面展现清晰**：在 Web 界面呈现为折叠通知行，点击展开后可查验原始指令，减少对话流信息干扰；
- **并发安全性**：通过 `steer` 支持目标执行过程中的安全引导，避免状态冲突。

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **向下兼容性**：旧实现中若有依赖正则解析 `[SYSTEM: CROSS-SESSION` 的 Prompt 将无法匹配。
  - *Mitigation*: 新实现对齐 Tool Call 与纯文本指令规范，不再支持旧定界符。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **网络零调用检查**：单元测试断言 `session_call` 执行过程无 `fetch` 或网络 I/O；
- **文本信封清理检查**：验证目标 Agent 接收到的 `userMessage.content[0].text` 与输入 `message` 一致；
- **消息源类型检查**：断言 `userMessage.source` 具有正确的 `kind: 'plugin'` 与 `form: 'notice'`；
- **双态分支测试**：分别模拟目标处于 `idle` 与 `running`，断言分别触发 `followup` 与 `steer`。

### 6.2 Review Checklist
- [ ] `lib/session-call.mjs` 中删除 `fetch` 与 `resolveHostEndpoint`；
- [ ] 删除 `buildCrossSessionNoticeText` 函数；
- [ ] 移除 `targetAgent.send(userMessage, 'next-turn', true)` 的裸调，改用规范的 `followup` 与 `steer` 双态调度。

---

## 7. Status History & Related Artifacts

- **2026-09-04**: Proposed & Accepted by Engineering Team
- **Related ADRs**:
  - Supersedes: 废除 ADR-0001 中关于 HTTP 触发与文本报文生成的残留实现描述
  - Related to: ADR-0007 (Web Slash Command), ADR-0008 (Global Profile Mounting)
- **Implementation Artifacts**:
  - `lib/session-call.mjs`
  - `index.mjs`
