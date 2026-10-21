# ADR-0027: Deep Module Architecture: Workspace Domain Primitive Isolation, Physical Adapter Seams, and Tools Registry Facade

- **Status**: Accepted
- **Date**: 2026-10-10
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Canvas Engineers, Telemetry Engineers, Directory Maintainers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents, Web Interface Maintainers

---

## 背景

随着 `dsh-call-session` 多智能体协作生态的发展，系统在模块深度（Module Depth）、局部性（Locality）与测试表面（Test Surface）上暴露出深层阻抗：

1. **Workspace 领域基语寄生反向泄漏**：
   `normalizeWorkspace` 作为首要协作原语，此前定义于 `lib/board-store.mjs` 中。导致纯内存环形缓冲区 `call-telemetry.mjs`、单播调用 `session-call.mjs`、会话治理 `session-safeguard.mjs` 等 8 个异构子模块被迫反向导入黑板存储引擎，形成虚假依赖环与概念倒置。
2. **黑板存储引擎与工具执行适配器单体混居**：
   ADR-0024 逻辑上划分了 `BoardStore` 与 `BoardToolsAdapter`，但在物理层面二者仍混居在同一个 1069 行的文件中。存储引擎被迫引入 `SessionDirectory` 与 `locales` 国际化依赖，且充斥大量透传门面方法。
3. **插件入口原生工具 Schema 声明样板淹没**：
   插件入口 `index.mjs`（729 行）中超过 440 行（>60%）全为 6 大原生工具重复冗长的 Schema 声明与渲染模板，且执行分发方式碎片化（4 种异构调用路径），入口模块缺乏杠杆率。

---

## 力量

- **Deep Modules & Leverage**：遵循 `/codebase-design` 原则，追求“以极小稳定的接口暴露丰富内聚的实现行为”，最大化调用方杠杆率。
- **Locality & Seam Purity**：同一领域的逻辑必须内聚于一处，存储、领域基语与工具适配各司其职。
- **Zero-Breakage Backward Compatibility**：既有公共导出符号、工具调用签名与测试用例契约必须 100% 保持向后兼容。
- **Zero-Build & Anti-Duplication**：坚决避免为了形式上的纯函数拆分而在无前端打包工具环境下产生双份平行算法镜像代码（违背 DRY 与造成逻辑漂移）。

---

## 决策

### 支柱

#### 基语

- 提炼 `normalizeWorkspace`、`isSameWorkspace` 纯领域函数至 `lib/workspace.mjs`。
- `call-telemetry.mjs`、`session-call.mjs`、`session-create.mjs` 等 8 个消费模块直接导入 `workspace.mjs`，阻断对黑板存储的寄生引用。
- `board-store.mjs` 保留别名重导出，维持 100% 向后兼容。

#### 适配

- 将 `BoardToolsAdapter`、`normalizeExecParams`、`isReservedTopic`、`getReservedTopicErrorMessage`、`formatAuthorReminderText` 物理抽取至独立模块 `lib/board-tools-adapter.mjs`。
- `BoardStore` 纯化为仅接受结构化入参的纯内存 Map、FIFO 淘汰与防抖原子持久化引擎，移除对 `SessionDirectory` 与 `locales` 的直接依赖。
- `BoardStore` 内部维持默认适配器实例，保持既有方法签名向后兼容。

#### 门面

- 提炼深层工具注册模块 `lib/tools-registry.mjs`，对外暴露单一极简接口 `registerNativeTools(ctx, options)` 与 `buildToolDefinitions`。
- 入口 `index.mjs` 从 729 行大幅收敛至 261 行，消除 440+ 行重复样板，入口纯化为生命周期胶水。

#### 边界

- **画布几何拆分之否决研判**：经审查，在无前端打包工具（Rollup/esbuild）的前提下，从单体 `lib/client.js` 中抽离平行的 `canvas-geometry.mjs` 会创造 500+ 行无真实调用的镜像代码副本，产生严重的 Duplicated Code 异味与双端逻辑漂移风险。
- **裁决**：画布纯几何算法维持内聚在 `lib/client.js` 中并由 Node VM 契约进行严密验收，不建立脱节的孤立镜像模块。

---

## 收益

- **架构拓扑纯度大幅提升**：内存环形队列阻断对持久化存储的寄生依赖；
- **文件与接口体积剧烈精简**：`index.mjs` 缩减 64%，`board-store.mjs` 缩减 33%；
- **消除代码异味与重复**：拒绝无构建打通的虚假解耦副本，保持单一真源；
- **零破坏平滑过渡**：全仓自动化测试 100% 绿灯通过，Lint 与 TypeScript 类型检查零报错。

---

## 验证

```bash
# 全工程验证
npm run verify

# 静态类型检查
npm run typecheck
```
