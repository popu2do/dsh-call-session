<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0027: 深层模块架构、工作区基语隔离、物理适配接缝与工具注册门面

- **Status**: Accepted (Geometry boundary superseded by ADR-0040)
- **Date**: 2026-10-10
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Canvas Engineers, Telemetry Engineers, Directory Maintainers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents, Web Interface Maintainers

> **演化注意**：关于画布几何不拆分的边界裁决已被 [ADR-0040](./0040-canvas-geometry-single-source-inlining.md) 显式替代，通过无头提取与内联嵌入达成单一事实源。

---

## 背景

随着系统多智能体协作生态的发展，系统在模块深度、局部性与测试表面上暴露出深层阻抗：

1. **工作区基语寄生反向泄漏**：
   `normalizeWorkspace` 作为首要协作原语，此前定义于黑板存储模块中。导致调用记录有限队列、单播调用、会话治理等异构子模块被迫反向导入黑板存储引擎，形成虚假依赖环与概念倒置。
2. **黑板存储引擎与工具执行适配器单体混居**：
   ADR-0024 逻辑上划分了存储引擎与工具适配器，但在物理层面二者仍混居在同一个千行单体文件中。存储引擎被迫引入会话目录与多语言国际化依赖，且充斥大量透传门面方法。
3. **插件入口原生工具声明样板淹没**：
   插件入口文件中超过六成均为六大原生工具重复冗长的模式声明与渲染模板，且执行分发方式碎片化，入口模块缺乏杠杆率。

---

## 力量

- **深层模块与杠杆率**：遵循代码设计原则，追求以极小稳定的接口暴露丰富内聚的实现行为，最大化调用方杠杆率。
- **局部性与接缝纯度**：同一领域的逻辑必须内聚于一处，存储、领域基语与工具适配各司其职。
- **零破坏向后兼容**：既有公共导出符号、工具调用签名与测试用例契约百分之百保持向后兼容。
- **零构建与防重复**：坚决避免为了形式上的纯函数拆分而在无前端打包工具环境下产生双份平行算法镜像代码。

---

## 决策

### 支柱

#### 基语

- 提炼 `normalizeWorkspace` 与 `isSameWorkspace` 纯领域函数至独立工作区模块 `lib/workspace.mjs`。
- 调用记录、单播调用、会话创建等消费模块直接导入工作区模块，阻断对黑板存储的寄生引用。
- 黑板存储模块保留别名重导出，维持百分之百向后兼容。

#### 适配

- 将工具适配器、参数规范化、保留主题拦截与作者提醒格式化物理抽取至独立模块 `lib/board-tools-adapter.mjs`。
- 黑板存储纯化为仅接受结构化入参的纯内存数据结构、容量淘汰与防抖原子持久化引擎，移除对会话目录与多语言的直接依赖。
- 黑板存储内部维持默认适配器实例，保持既有方法签名向后兼容。

#### 门面

- 提炼深层工具注册模块 `lib/tools-registry.mjs`，对外暴露单一极简接口 `registerNativeTools` 与 `buildToolDefinitions`。
- 插件入口大幅收敛，消除四百余行重复样板，入口纯化为生命周期胶水。

#### 边界

- **画布几何拆分之否决研判**：经审查，在无前端打包工具的前提下，从单体脚本中抽离平行的几何文件会创造数百行无真实调用的镜像代码副本，产生严重的代码重复异味与双端逻辑漂移风险。
- **裁决**：画布纯几何算法维持内聚在客户端脚本中并由虚拟机契约进行严密验收，不建立脱节的孤立镜像模块。该非拆分裁决后续由 ADR-0040 通过单源码无头提取与内联生成正式演化替代。

---

## 收益

- **架构拓扑纯度大幅提升**：内存有限队列阻断对持久化存储的寄生依赖；
- **文件与接口体积剧烈精简**：入口文件缩减超六成，存储引擎体积大幅缩减；
- **消除代码异味与重复**：拒绝无构建打通的虚假解耦副本，保持单一事实源；
- **零破坏平滑过渡**：全仓自动化测试百分之百通过，静态检查与类型检查零报错。

---

## 验证

```bash
# 全工程验证
npm run verify

# 静态类型检查
npm run typecheck
```
