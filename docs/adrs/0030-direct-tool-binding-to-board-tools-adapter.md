# ADR-0030: Direct Tool Binding to BoardToolsAdapter and Pure Storage Engine Alignment

- **Status**: Accepted
- **Date**: 2026-10-14
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Storage Maintainers, Tool Authors, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents

---

## 背景

随着系统在 ADR-0024 与 ADR-0027 中物理抽离了 `BoardToolsAdapter`，存储引擎在代码组织上逐步分离了工具执行职责。
然而在生产运行主链路上，工具注册模块 `lib/tools-registry.mjs` 依然绑定 `BoardStore` 实例，三大黑板工具（`board_post`、`board_list`、`board_clear`）通过调用存储引擎原型上的透传门面间接执行；同时系统提示词中的记名提醒（`board:remind`）也通过存储引擎中转。这导致存储引擎内部仍需保留多语言字典组装与提示词拼装门面，未能充分纯化。

## 力量

- **Deep Modules & Leverage**：遵循 `/codebase-design` 原则，追求“以极简稳定的接口暴露丰富内聚的实现行为”，最大化适配器接缝杠杆率。
- **Locality & Seam Purity**：数据持久化（存储引擎）与工具入参解包/提示词适配（工具适配器）应当各司其职，阻断中间人转发。
- **Zero-Trace & Anti-Duplication**：生产主链路直接跨越真实功能接缝，消除无实质价值的代理调用。
- **Zero-Breakage Backward Compatibility**：既有存储引擎原型上的门面方法 100% 保持向后兼容。

---

## 动因

- 消除工具注册层对存储引擎门面方法的间接中转，使工具直接绑定工具适配器。
- 解除存储引擎对系统提示词记名提醒的直接参与，使 `boardStore` 聚焦纯内存与持久化底座。
- 完整保留历史调用签名，确保全仓既有测试无损平滑过渡。

---

## 方案

### 方案一
维持现状，继续由存储引擎作为中间人转调适配器。存在不必要的代理开销与职责发散。

### 方案二
物理删除存储引擎上的全部 6 个门面方法。破坏历史单元测试与第三方直接调用契约，不符合平滑演进原则。

### 方案三
选中方案：工具注册层直接绑定适配器 + 记名提醒解耦 + 存储引擎保留兼容代理。
- `registerNativeTools` 支持直接注入 `BoardToolsAdapter`；
- 三大黑板工具直接调用适配器的 `executePost`、`executeList` 与 `executeClear`；
- `board:remind` 直接对接适配器的 `getAuthorReminder`；
- `BoardStore` 原型门面方法全量保留，内部继续代理给适配器。

---

## 决策

### 工具绑定

`lib/tools-registry.mjs` 的 `buildToolDefinitions` 与 `registerNativeTools` 支持优先接收显式传入的 `boardToolsAdapter`（缺省时自动回退）。三大黑板工具的 `execute` 钩子全面直调适配器方法，切断对存储引擎门面的调用。

### 提醒解耦

插件入口 `index.mjs` 在生命周期 `apply` 中显式实例化 `BoardToolsAdapter`，向系统提示词注册 `board:remind` 上下文时直接调用 `boardToolsAdapter.getAuthorReminder(context?.agent, ctx, config)`，并将适配器实例传递至工具注册层。

### 存储纯化

`lib/board-store.mjs` 中的 `executePost`、`executeList`、`executeClear`、`getAuthorReminder`、`getMessages`、`resolveCallerContext` 明确作为向后兼容门面维持导出，存储引擎在生产主链路纯化为纯数据存取与持久化核心。

---

## 收益

- **架构接缝高度纯粹**：工具层直接对接适配层，消除中间人代码异味；
- **职责边界保持清晰**：存储引擎解耦所有大模型提示词拼接与多语言渲染逻辑；
- **全仓回归零破坏**：356 项全仓自动化测试与静态类型检查 100% 绿灯。

## 验证

```bash
# 全工程验证
npm run verify

# 静态类型检查
npm run typecheck
```
