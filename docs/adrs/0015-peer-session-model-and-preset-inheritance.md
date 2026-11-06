<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0015: 同级会话模型与预设继承

- **Status**: Accepted - Gateway creation evolved by ADR-0025
- **Date**: 2026-09-10
- **Deciders**: Architect, Core Maintainers
- **Informed**: All Agent Users, Multi-Session Operators

---

## 背景

同级会话创建工具用于派生长期运行的平级会话。随着宿主引入多模型路由、不同推理强度与智能体预设体系，同级会话的初始化面临以下需求：
1. 模型与推理强度的一致性与覆写：子会话默认继承派发方的模型规格与推理强度，未显式声明时回退至全局默认配置；允许调用时显式覆写特定模型。
2. 智能体预设与环境能力的继承：同级会话继承派发方的预设能力模板或接受指定的预设标识完成装配，避免同级会话缺少必要的提示词与技能配置。

---

## 决策

### 解析层级
1. 优先级顺序：
   - 显式覆写：优先采纳工具入参 `model` 与 `reasoning_effort`，入参遵循 snake_case 规范。`model` 支持包含提供商前缀的完整标识与纯模型名。
   - 派发继承：未显式覆写时，优先继承派发方会话的运行时请求头与模型选项配置。
   - 全局回退：派发方未绑定特定模型时，自动回退探测宿主全局默认配置。
2. 推理强度生命周期：
   - 显式变更模型但未显式提供推理强度时，不将旧模型的推理强度强制映射到新模型上，置为未定义并交由底层模型适配器采纳目标模型的默认强度。

### 钩子挂载
1. 预设标识推导：
   - 优先采纳入参显式声明的预设字段。
   - 未指定时尝试从派发方会话元数据或宿主预设注册表继承。
2. 非阻塞安全装配：
   - 优先通过宿主代理控制器生成装配配置。
   - 备选通过预设服务解析与挂载技能及环境模板。
   - 依赖项缺失或装配异常时记录调试日志并静默降级，不阻断根会话生成。

---

## 影响

### 正向收益
- 同级会话创建后可直接运行，具备与派发方一致的模型能力与预设配置。
- 确立清晰的优先级解析层级，避免不同模型之间的参数错配与能力撕裂。

### 合规验证
- 单元测试覆盖模型继承、全局回退、入参覆写与预设装配完整分支。

---

## 演化

- 2026-09-10：确立同级会话模型与预设继承基线。
- 关联决策：
  - 演化：[ADR-0021](./0021-concurrent-running-quota-and-model-inheritance-alignment.md) 运行态并发配额与模型继承对齐
  - 演化：[ADR-0025](./0025-peer-session-creation-gateway-safeguard-and-bootstrap-decoupling.md) 宿主网关解耦与安全租约
  - 演化：[ADR-0038](./0038-cold-resume-model-inheritance.md) 冷恢复模型继承与提示词装配韧性
