# ADR-0029: Consolidated Native Message Transport and Bootstrap Facade Folding

- **Status**: Accepted
- **Date**: 2026-10-14
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Transport Maintainers, Dispatch Engineers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents

---

## 背景

随着跨会话单播调用（`session_call`）与同级会话创建（`session_create`）的演进，系统在消息组装与通道派发上存在两份平行的传输层报头构造逻辑：
单播调用与启动协同分别实现了 `UserMessage` 结构组装、摘要截断（120 字符）与基于状态的分发通道选择。此外，`lib/peer-bootstrap.mjs` 中定义了持有 8 个纯转发方法的浅层空心包装类 `PeerBootstrapper`，产生重复代码与维护阻抗。

## 力量

- **Deep Modules & Leverage**：遵循 `/codebase-design` 原则，追求“以极简稳定的接口暴露丰富内聚的实现行为”，最大化通信原语复用率。
- **Locality & Seam Purity**：通信协议、传输层报头构造与状态感知通道选择应当内聚在单一基础设施接缝背后。
- **Zero-Trace & Anti-Duplication**：坚决消除重复的报文拼装与空心转发类。
- **Zero-Breakage Backward Compatibility**：既有模块导出符号与类方法 100% 保持向后兼容。

---

## 动因

- 消除单播调用与启动协同之间重复的报文构造与摘要截断逻辑。
- 统一黑板条目引用的清洗规约，杜绝引用格式漂移。
- 折叠无实质状态的浅层包装类 `PeerBootstrapper` 为轻量门面。

---

## 方案

### 方案一
维持现状，两处各自维护报文拼装。重复代码持续存在，格式漂移隐患未除。

### 方案二
直接删除 `peer-bootstrap.mjs` 并破坏既有接口。破坏历史单元测试契约，不符合平滑演进原则。

### 方案三
选中方案：提炼深层原生消息传输层 + 业务模块对接 + 门面化折叠 + 零破坏向后兼容。
- 新增 `lib/native-message-transport.mjs` 承载统一消息装配与通道投递；
- `lib/session-call.mjs` 纯化为调度编排，既有符号重定向重导出；
- `PeerBootstrapper` 折叠为纯兼容门面，核心路径直连深层协同函数。

---

## 决策

### 传输接缝

新增 `lib/native-message-transport.mjs`，暴露统一通信原语：
- `generateMessageId`：生成消息唯一标识；
- `sanitizeContextPostIds`（及别名 `sanitizePostIds`）：规范化去重黑板条目编号；
- `buildTransportPayload`：组装客观身份报头与 `> Context Ref: ...` 引用，正文逐字保留；
- `buildNativeUserMessage`：原子装配标准 `UserMessage`，严格执行 120 字符摘要截断；
- `dispatchNativeMessage`：基于目标运行态自适应执行 `steer` 或 `followup` 通道分发。

### 单播对接

`lib/session-call.mjs` 移除内置的报头与对象构造函数，全面引入并向后兼容重导出传输层符号。`executeSessionCall` 聚焦于目标匹配、状态查询与调用连线内存快照记录。

### 协同折叠

`lib/peer-bootstrap.mjs` 内部切断自写的报头拼接，直接复用 `buildNativeUserMessage` 与 `dispatchNativeMessage`。`PeerBootstrapper` 类维持为纯转发门面，生产路径直通深层协同函数 `bootstrapPeerSession`。

### 基语固化

在 `CONTEXT.md` 协作原语章节新增 `传输层报头 / Transport Semantic Header` 词条，固化客观报头语法、黑板引用规约与正文零篡改原则。

---

## 收益

- **消息传输装配职责规范收敛**：跨会话消息装配逻辑集中于单一深层模块；
- **消除重复与浅层空心类**：减少数十行重复样板，提升局部性与杠杆率；
- **全仓回归零破坏**：358 项自动化测试与静态类型检查 100% 绿灯。

## 验证

```bash
# 全工程验证
npm run verify

# 静态类型检查
npm run typecheck
```
