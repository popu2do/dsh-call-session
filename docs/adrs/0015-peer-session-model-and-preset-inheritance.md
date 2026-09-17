# ADR-0015: Peer Session Model and Preset Inheritance

- **Status**: Accepted
- **Date**: 2026-09-10
- **Deciders**: Architect, Core Maintainers
- **Informed**: All Agent Users, Multi-Session Operators

---

## 1. Context and Problem Statement

同级会话创建（`session_create`）在多 Agent 协同体系中承担了生成平级长期运行 Session 的职责。随着 DSH 引入多模型路由、不同推理强度（`reasoning_effort`）与智能体预设体系（`agentPresets` / `sessionController`），同级会话的初始化面临以下需求：
1. **模型与推理强度的一致性与覆写**：子会话应当默认继承创建方（Caller Agent）的模型规格与推理强度，并在未显式声明时回退至全局部署默认配置（`ctx.agentDefaultModel`）；同时允许用户在调用时覆写特定模型。
2. **智能体预设与环境能力的继承**：同级会话应能够继承调用方的预设能力模板或接受指定的 `preset` 标识，完成代理生命周期钩子装配，避免同级会话沦为缺少专属提示词与技能配置的空白节点。

---

## 2. Decision Outcome

我们确立以下同级会话模型与预设解析规范：

### 2.1 模型与推理强度解析层级（Model & Effort Resolution Cascade）
1. **优先级梯队**：
   - 显式覆写：优先采纳工具入参 `args.model` 与 `args.reasoning_effort`（按 ADR-0016 规范严格采用 `snake_case`，废止入参驼峰别名 `reasoningEffort`）。`args.model` 支持 `provider/model` 与纯 `model` 格式。
   - 调用方继承：未显式覆写时，优先继承调用方会话的运行时模型配置（`callerAgent.options`、`callerAgent.session.requestHeader().config`）。
   - 全局回退：调用方未绑定特定模型时，自动回退探测宿主全局默认配置（`ctx.agentDefaultModel`）。
2. **推理强度生命周期**：
   - 显式变更模型但未显式提供 `reasoning_effort` 时，不将旧模型的推理强度强制映射到新模型上（置为 `undefined`），交由底层模型适配器采纳目标模型的默认强度。

### 2.2 预设解析与生命周期钩子挂载（Preset Resolution & Setup Hooks）
1. **预设标识推导**：
   - 优先采纳 `args.preset`（按 ADR-0016 规范严格采用单数 `preset`，废止入参别名 `agentPreset`）。
   - 未指定时尝试从调用方会话元数据（`callerAgent.session.metadata.agentPreset`）或宿主注册表继承。
2. **非阻塞安全装配**：
   - 优先通过宿主 `sessionController.agents.composeAgent` 生成装配配置。
   - 备选通过 `agentPresets.resolve` 与 `agentPresets.mount` 挂载技能与环境模板。
   - 依赖项缺失或装配异常时记录调试日志并静默降级，不阻断根会话生成。

---

## 3. Consequences

### Positive
- 同级会话开箱即用，具备与调用方对齐的模型能力与预设技能。
- 规范了解析层级，避免不同模型之间的参数错配。

### Compliance Verification
- 单元测试覆盖模型继承、全局回退、入参覆写与预设装配完整分支（`tests/session-create.test.mjs`）。
