# ADR-0006: Pure DSH Native In-Process Context Injection and State-Aware Dual Dispatch

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Engineering Team, DSH Ecosystem Team
- **Consulted**: Core Contributors, Community Users
- **Informed**: All Plugin Consumers, Downstream Subagents, DSH Web Interface Users

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points
在跨会话主动呼叫能力演进的早期阶段，由于缺乏对 DSH 原生消息模型（`UserMessage` / `MessageSource`）与 `ReactLoopAgent` 进程内调度生命周期的深入剖析，系统走上了一条严重的“外围拼接歪路”：
1. **HTTP 伪造 Prompt 请求**：在 `lib/session-call.mjs` 中，通过 Node.js 原生 `fetch('http://127.0.0.1:3080/api/session.prompt')` 模拟浏览器人类用户的打字行为；
2. **RFC-822 假信封与文本定界符**：使用 `buildCrossSessionNoticeText` 拼装由 `[SYSTEM: CROSS-SESSION AGENT DISPATCH]`、`From: ...`、`To: ...`、`--- DISPATCH CONTENT ---` 和 `[SYSTEM DIRECTIVE]` 组成的伪报文文本；
3. **假扮人类用户角色 (`source: { kind: 'user' }`)**：将机器间调度包装为人类用户的会话输入。

这种做法引发了严重后果：
- **网络层脆弱性**：依赖硬编码 3080 端口与本地 HTTP 服务，在反向代理、端口变更或多实例宿主环境下频繁失败；
- **上下文污染与 Token 浪费**：每次调度在持久会话记录中注入数百个无意义的定界符标记，导致目标 Agent 的长窗口记忆发生语义退化与幻觉模仿；
- **Web UI 视觉侵占**：伪装为用户角色使调度消息被 DSH Web 前端渲染为巨大的对话气泡，无法利用 DSH 原生折叠插件通知流。

### 1.2 Architectural Forces & Constraints
- **Zero-Network Invariant**：同一宿主进程内的会话协同严禁发起任何外部或回环 HTTP 网络请求；
- **Native Context Model**：必须严格遵循 `@deepseek-ai/dsh-llm` 的 `MessageSource` 规范声明插件源；
- **State-Awareness**：必须根据目标 Agent 的实时执行态（`idle` vs `running`）智能选择调度策略，杜绝竞态与阻塞。

---

## 2. Decision Drivers

- **Driver 1 (Eliminate External Network Hopping)**：100% 依托 DSH 进程内内存注册表 `ctx.agents` 实现纳秒级直连；
- **Driver 2 (Preserve Pure Context)**：坚决剥离所有假信封定界符，保证传入模型的消息 Payload 纯洁无瑕；
- **Driver 3 (Native Visual Integration)**：全面对接 DSH Web UI 的 `ContextInjectionRow`，实现低干扰、可折叠的插件通知形态；
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
- **Description**: 全面推翻 HTTP 与定界符，通过 `ctx.agents.get(...)` 获取目标实例；使用 `source: { kind: 'plugin', plugin: 'dsh-call-session', form: 'notice', summary: '...' }` 封装纯净 Payload；目标 `idle` 调 `followup`，目标 `running` 调 `steer`。
- **Pros**: 彻底实现 0 网络请求、0 文本假面具、0 人类伪装。性能提升数千倍，内存与 UI 完美自洽。
- **Cons**: 需要重构 `session_call` 核心实现并废除历史辅助函数。

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — Pure Native In-Process Direct Lookup + Semantic MessageSource + Dual-Channel Steer/Followup.

### 4.1 Core Architectural Invariants
1. **Invariant 1 (Zero-HTTP)**：插件源码内绝对不出现任何针对宿主自身 prompt API 的 HTTP 调用；
2. **Invariant 2 (Zero-Envelope)**：`content[0].text` 只包含纯粹的调用消息，禁止拼装 RFC-822 或定界符；
3. **Invariant 3 (Pure Plugin Source)**：消息源必须显式声明为 `{ kind: 'plugin', plugin: 'dsh-call-session', form: 'notice', summary: '...' }`；
4. **Invariant 4 (State-Adaptive Routing)**：
   - 目标为 `idle`：使用 `targetAgent.followup(userMessage)`；
   - 目标为 `running`：使用 `targetAgent.steer(userMessage)` 在 step boundary 安全注入。

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
- **亚微秒级延迟**：由网络 TCP 握手 + HTTP 报文解析的 20~50ms 降至微秒级内存调用；
- **零上下文与记忆污染**：目标 LLM 看到的是纯净任务指令，历史记录不包含任何文本标记干扰；
- **Web 体验卓越**：在 Web 界面呈现为优雅的折叠通知行，点击展开后可查验原始指令，保持对话流干净清爽；
- **鲁棒的并发安全性**：通过 `steer` 支持目标执行过程中的安全引导，不再导致状态死锁。

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **向下兼容性**：旧版本中若有依赖正则解析 `[SYSTEM: CROSS-SESSION` 的特定 Prompt 将无法匹配。
  - *Mitigation*: 现代 Agent 均依赖标准的 Tool Call 语义与纯文本指令，本次重构是向标准规范的正式对齐，无需保留反模式的旧兼容。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **网络零调用检查**：单元测试断言 `session_call` 执行全过程无任何 `fetch` 或网络 I/O；
- **文本信封零残留**：验证目标 Agent 接收到的 `userMessage.content[0].text` 与输入 `message` 严格一致；
- **消息源强类型检查**：断言 `userMessage.source` 具有正确的 `kind: 'plugin'` 与 `form: 'notice'`；
- **双态分支测试**：分别模拟目标处于 `idle` 与 `running`，断言分别触发 `followup` 与 `steer`。

### 6.2 Review Checklist
- [ ] `lib/session-call.mjs` 中彻底删除 `fetch`、`resolveHostEndpoint`；
- [ ] 彻底删除 `buildCrossSessionNoticeText` 函数；
- [ ] 移除 `targetAgent.send(userMessage, 'next-turn', true)` 的裸调，改用规范的 `followup` / `steer` 双态调度。

---

## 7. Status History & Related Artifacts

- **2026-09-04**: Proposed & Accepted by Engineering Team
- **Related ADRs**:
  - Supersedes: 废除 ADR-0001 中关于 HTTP 触发与文本报文生成的残留实现描述
  - Related to: ADR-0007 (Web Slash Command), ADR-0008 (Global Profile Mounting)
- **Implementation Artifacts**:
  - `lib/session-call.mjs`
  - `index.mjs`
