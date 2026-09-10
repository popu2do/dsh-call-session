# ADR-0007: Web Slash Command Integration and Visual UX Streamline

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Engineering Team, DSH Ecosystem Team
- **Consulted**: Web Frontend Team, Community Users
- **Informed**: All Plugin Consumers, DSH Web Interface Users

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points
在既往设计中，`dsh-call-session` 试图在 npm `package.json` 中声明 `bin: { "dsh-call-session": "bin/dsh-call-session.mjs" }`，提供一个面向操作系统的外部 CLI 命令行工具。
这种设计带来了显著的产品形态撕裂与工程弊端：
1. **外部独立进程断链**：CLI 运行于 DSH 主进程外部，无法感知或直接获取宿主内存中的 `ctx.agents` 实例列表，只能再次退化为依赖本地 HTTP 网络端口；
2. **割裂人类交互体验**：人类用户在 DSH Web GUI 界面交互时，需要额外打开系统终端输入复杂的命令参数才能向 Agent 发消息，严重背离了现代 Web AI IDE 的沉浸式交互范式；
3. **缺少宿主级命令提示与语法补全**：外部 CLI 无法利用 DSH Web 输入框原生的 Slash Command 智能联想机制；
4. **视觉侵占与格式错乱**：由于缺乏统一的 UI 展现规范，早期的跨会话交互在 Web 界面被误当做普通用户打字消息，破坏了界面美感与专业性。

### 1.2 Architectural Forces & Constraints
- **In-Process Command Boundary**：面向用户的交互命令运行在 DSH 宿主进程内部，由 `ctx.commands` 服务直接驱动；
- **Clean Package Topology**：Cordis 插件保持高内聚，专注于宿主能力扩展，去除独立的外部 CLI 包装；
- **Visual Integration**：跨会话调度的轨迹展示符合 DSH Web 原生折叠通知行契约。

---

## 2. Decision Drivers

- **Driver 1 (Unified Web User Experience)**：用户在 DSH Web 输入框通过 `/dsh-call-session` 向协作会话发起调度；
- **Driver 2 (Eliminate Bin Baggage)**：从 `package.json` 中移除 `bin` 字段与外部脚本，精简 Cordis 插件代码结构；
- **Driver 3 (Native Slash Command Autocomplete)**：接入 DSH 的输入提示与补全机制（`ctx.commands.register`）；
- **Driver 4 (Visual Harmony)**：配合 DSH 的 `ContextInjectionRow` 提供单行折叠通知与即时反馈。

---

## 3. Considered Options

### Option 1: Maintain Both External CLI and Web Slash Command (Rejected)
- **Description**: 在保留 `bin` 脚本的同时增加 Web Slash Command。
- **Pros**: 兼顾可能的外部终端脚本调用需求。
- **Cons**: 维护两套通信链路，增加代码冗余与网络维护成本。

### Option 2 (Chosen): Eliminate Standalone CLI and Unify on Native Slash Command `/dsh-call-session`
- **Description**: 废除 `bin` 脚本，使用 DSH 原生 `ctx.commands.register` 注册全局斜杠命令，打通 Web 输入框与进程内调度。
- **Pros**: 进程内单链路闭环，消除外部进程开销与网络依赖。
- **Cons**: 外部脚本无法直接通过系统 PATH 调用 `dsh-call-session`，需通过 DSH 原生接口或工具调用。

---

## 4. Decision Outcome

**Chosen Option**: Option 2 — Eliminate Standalone CLI and Unify on Native Slash Command `/dsh-call-session`.

### 4.1 Slash Command Registration Specification
在插件入口 `index.mjs` 中通过 `ctx.commands.register` 挂载命令：

```javascript
ctx.commands.register({
  name: 'dsh-call-session',
  description: '向指定活跃会话发起 DSH 原生跨会话调度呼叫',
  input: {
    hint: '<target_session_id> <message>'
  },
  handler(invocation) {
    const raw = invocation.rawInput.trim();
    if (!raw) {
      return {
        kind: 'error',
        text: '用法错误：请提供目标 Session ID 与消息内容。示例：/dsh-call-session session-xyz 请查阅 PR'
      };
    }

    const firstSpaceIndex = raw.search(/[\t\n\r ]/u);
    if (firstSpaceIndex === -1) {
      return {
        kind: 'error',
        text: '用法错误：缺少消息内容。示例：/dsh-call-session <target_session_id> <message>'
      };
    }

    const targetSessionId = raw.slice(0, firstSpaceIndex).trim();
    const message = raw.slice(firstSpaceIndex).trim();

    try {
      const callerAgent = invocation.agent;
      const result = executeSessionCall(
        ctx,
        {
          target_session_id: targetSessionId,
          message,
          call_type: 'notice'
        },
        { agent: callerAgent }
      );

      return {
        kind: 'success',
        text: `已通过原生单播 (${result.deliveryMode}) 成功呼叫会话 [${result.targetSessionId}]`
      };
    } catch (error) {
      return {
        kind: 'error',
        text: `跨会话呼叫失败: ${error?.message || error}`
      };
    }
  }
});
```

### 4.2 Visual Trajectory Contract (Web UI Presentation)
目标会话接收到该消息后，DSH Web GUI 基于消息源中的 `kind: 'plugin'` 与 `form: 'notice'` 渲染为：
- **指示行**：`dsh-call-session • [Cross-Session NOTICE] from <Caller>: <Summary>`
- **状态属性**：`data-context-source="true"`，带折叠展开标记；
- **展开区**：展示原始 `message` 内容，字体采用等宽代码块排版，无额外定界符包装。

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **Web Slash Command 提示**：用户在 Web 输入框输入 `/` 即可检索 `/dsh-call-session` 及其参数提示；
- **插件体积缩减**：`package.json` 不再包含 `bin` 字段，精简依赖与构建产物；
- **视觉层级分明**：调度通知呈现为插件通知行，不占用普通对话气泡。

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **外部 Shell 无法直接调用**：
  - *Mitigation*: 外部系统可通过宿主开放接口触发，或在会话内通过工具调度。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **Package 清理检查**：测试断言 `package.json` 中 `bin` 字段为 `undefined`；
- **命令注册与解析测试**：模拟调用 Slash Command 注册器，传入正常与缺损参数，验证参数解析与错误提示响应；
- **执行闭环测试**：验证 `/dsh-call-session` 触发后直接调用进程内 `executeSessionCall`。

### 6.2 Review Checklist
- [ ] 清理 `package.json` 中的 `bin` 声明；
- [ ] 移除源码树中历史残留的 `bin/` 目录；
- [ ] `index.mjs` 中正确挂载 `/dsh-call-session` 命令；
- [ ] 确认注入消息在 Web 端展现为标准的插件折叠行。

---

## 7. Status History & Related Artifacts

- **2026-09-04**: Proposed & Accepted by Engineering Team
- **Related ADRs**:
  - Complements: ADR-0006 (Native Context Injection), ADR-0008 (Global Profile Mounting)
- **Implementation Artifacts**:
  - `index.mjs`
  - `package.json`
