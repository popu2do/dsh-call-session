<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0021: 运行态并发配额与模型继承对齐

- **Status**: Accepted
- **Date**: 2026-09-20
- **Deciders**: Architect, Core Maintainers
- **Informed**: Multi-Session Operators

---

## 背景

同级会话创建用于派生同工作区并行会话。原实现存在两个设计与行为偏差：

1. 配额统计口径偏差：
   原配额以工作区内未归档会话数为统计口径，上限为 10 个。已结束任务的空闲会话未显式归档时持续计入配额，导致无运行负载时新会话被误拒。配额设计目标为限制同时运行的会话数量，统计口径应以正在运行的运行态会话为准，并将上限收敛至 5 个。
2. 派发会话模型能力未对齐：
   派发方运行时请求头动态指定的模型配置，如模型名称与推理强度未完整传递给新会话，导致派发出的会话退化为全局默认配置。

---

## 决策

### 配额防超

1. 配额上限调整：
   单工作区并发运行根会话上限调整为 5 个硬限制。
2. 配额统计与标题去重解耦：
   在会话目录扫描中明确分离统计逻辑：
   - 配额计数：仅统计状态为 running 的根会话，空闲会话与归档会话不计入并发配额。
   - 标题集合：收集所有未归档存活会话标题，用于防重名推导。
3. 在途创建防超发：
   在底层创建完成前，登记在途请求，并发计算为运行态会话数与在途标题数之和。当总数达到 5 时同步拒绝创建并抛出配额超限错误。

### 模型继承

建立多级模型配置解析链路：
1. 优先读取派发方运行时的动态请求头配置。
2. 若无动态配置，依次回退至派发方静态模型选项及宿主默认配置。
3. 显式入参具有最高优先级，覆盖继承配置。

---

## 约束

- 约束一：单工作区内处于 running 态的根会话与在途创建请求之和严格不超过 5。
- 约束二：处于 idle 态的空闲存活会话不占用并发运行配额。
- 约束三：未显式传参覆写时，新建会话完整继承派发方当前生效的模型与推理强度。

---

## 影响

### 正向收益
- 空闲会话不再阻塞新同级会话创建，消除虚假配额耗尽。
- 单工作区并发运行上限严格收敛为 5，有效约束计算资源开销。
- 新建会话自动与派发方的模型能力对齐，杜绝协同能力断层。

### 验证标准
- 单元与集成测试全量覆盖配额统计、空闲状态放行、在途防超发与多级模型继承链路。

---

## 演化

- 2026-09-20：确立运行态并发配额为 5 与派发模型继承规范。
- 关联决策：
  - 演进：[ADR-0025](./0025-peer-session-creation-gateway-safeguard-and-bootstrap-decoupling.md) 宿主网关与安全租约模式
  - 演进：[ADR-0028](./0028-deep-admission-safeguard-seam-and-lease-single-source-of-truth.md) 深层准入防护接缝与原子租约管理
  - 关联：[ADR-0015](./0015-peer-session-model-and-preset-inheritance.md) 同级会话模型与预设继承
  - 关联：[ADR-0038](./0038-cold-resume-model-inheritance.md) 冷恢复模型继承与提示词装配韧性