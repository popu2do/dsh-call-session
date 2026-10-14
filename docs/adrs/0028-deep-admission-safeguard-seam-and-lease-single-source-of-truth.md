# ADR-0028: Deep Admission Safeguard Seam, Atomic Title Resolution, and Lease Single Source of Truth

- **Status**: Accepted
- **Date**: 2026-10-13
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Concurrency Maintainers, Directory Maintainers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents

---

## 背景

随着同级会话创建（`session_create`）在多智能体并发调度场景下的频繁调用，原有的准入防护流程暴露出接缝泄漏与编排阻抗：
调用方工厂类（`PeerSessionFactory`）在申请准入前，必须手动调用目录扫描存活会话、提取并合并在途标题集合、调用标题清洗推导函数、计算运行态会话计数，最后将这一连串派生状态反向传入准入守卫（`SessionSafeguard.admit`）。
这种浅层接缝导致标题冲突排查与租约签发之间存在并发竞争窗口，且使得调用方充斥样板编排代码，单元测试需要构造复杂的嵌套模拟对象。

## 力量

- **Deep Modules & Leverage**：遵循 `/codebase-design` 原则，追求“以极简稳定的接口暴露丰富内聚的实现行为”，最大化调用方杠杆率。
- **Locality & Seam Purity**：准入不变式（代际熔断、并发配额、滑动窗口限频、标题去重与在途登记）应当完整内聚于单一接缝内。
- **Single Source of Truth**：准入租约（`AdmissionLease`）交付的规范标题与代际深度必须作为下游根代理创建、标题事件写入及后续单播调度与黑板发布的唯一真实源。
- **Zero-Breakage Backward Compatibility**：既有底层校验方法与工厂类透传签名 100% 保持向后兼容。

---

## 动因

- 消除调用方在目录与守卫之间的 6 步手动状态预检，收敛为单一原子准入方法。
- 将特权前缀清洗、标题冲突排查、自动推导与在途登记原子绑定，彻底闭合并发竞争窗口。
- 通过租约对象直接交付合规标题与目标代际，消除下游状态分叉风险。

---

## 方案

### 方案一
维持现状，仅修补单元测试。调用方持续泄漏编排细节，并发高压下仍存在状态撕裂隐患。

### 方案二
激进删除所有底层校验方法与工厂透传方法。破坏现有依赖底层方法的单元测试契约，违背平滑演进原则。

### 方案三
选中方案：深化 SessionSafeguard.admit + 租约单一真实源 + 零破坏向后兼容。
- `admit` 升级为全自洽原子事务方法，调用方由 30 行手动编排精简为 1 步调用；
- 租约对象提供 `lease.title` 与 `lease.generation` 权威状态；
- 既有公共导出方法与工厂透传接口 100% 兼容。

---

## 决策

### 准入接缝

`SessionSafeguard.prototype.admit` 统一接收 `{ callerAgent, workspace, title, initialMessage, agentsService, archivedIds, directory }`。守卫内部自动执行代际深度核验、工作区会话扫描、在途与存活会话标题合并、特权前缀清洗与自动推导、运行态配额校验、限频预留及在途登记，直接签发携带规范状态的 `AdmissionLease`。

### 工厂收敛

`PeerSessionFactory.prototype.create` 移除外层散落的目录扫描与在途合并代码，统一通过 `lease.title` 与 `lease.generation` 编排根代理创建、标题事件追加与启动协同通知。成功时提交租约，异常时原子回滚租约。

### 基语对齐

锐化 `准入租约 / Admission Lease` 词条定义，确立其原子交付规范标题与继承代际的事务契约职责。

---

## 收益

- **模块深度与杠杆率显著提升**：调用方仅需表达意图，内部隐藏完整的不变式约束；
- **消除并发重名与竞争窗口**：在途标题与活跃标题原子校验；
- **测试表面更加坚固**：350 项全仓自动化测试与静态类型检查 100% 绿灯。

## 验证

```bash
# 全工程验证
npm run verify

# 静态类型检查
npm run typecheck
```
