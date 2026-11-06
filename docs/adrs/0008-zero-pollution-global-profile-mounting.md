<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0008: 零污染全局配置文件挂载与可逆生命周期管理

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Engineering Team, DSH Ecosystem Team
- **Consulted**: DevOps & Platform Architects, Community Users
- **Informed**: All DSH Profile Maintainers, Downstream Subagents

---

## 背景

### 问题背景
在 DSH 中扩展插件时，存在以下工程约束与常见问题：
1. 侵入式项目级安装：在每个代码工程或工作区重复配置依赖，增加维护成本与版本分歧。
2. 底层代码修改：直接修改宿主核心文件，升级版本时容易被覆盖。
3. 资源卸载泄漏：插件热重载或停用时若未清理注册句柄或定时器，会导致常驻内存泄漏。

本插件需要实现全局可用、会话环境隔离与生命周期可逆管理。

### 架构约束
- 全局即时可用：宿主启动后，当前 DSH 实例下的任意会话均可调用原生跨会话工具，人类用户通过 Web 协作看板进行交互。
- 业务工程零配置：业务工程工作区无需额外配置文件或本地依赖包。
- 生命周期严格对偶：插件加载与卸载保持对偶可逆，卸载时注销所有注册句柄与后台定时器。

---

## 驱动

- 全局可用保障：用户或代理在任意会话中可直接调用跨会话能力。
- 声明式切面装配：采用配置文件声明式补丁挂载机制。
- 严格服务注入纪律：遵循 Cordis 容器规范，显式声明依赖服务集合。
- 确定性清理回收：借助退出处置钩子实现异步存储刷新与副作用注销。

---

## 选型

### 方案一
手动项目级插件注册。在每个业务工程中单独声明插件配置。
- 缺陷：跨工作区会话无法协同，配置冗余繁琐，大幅增加多会话运维负担。

### 方案二
声明式全局配置文件补丁结合纤程可逆生命周期。
- 描述：在宿主全局配置文件中声明插入插件，通过声明式依赖注入核心服务，借助生命周期作用域纳管副作用。
- 优势：一次挂载全局生效，生命周期可逆注销，无污染无泄漏。
- 决策：采纳方案二。

---

## 决策

### 补丁规范
插件通过包元数据声明配置文件补丁路径，导出标准补丁片段。安装后宿主自动将插件注册到配置集合中，启动时自动挂载补丁配置：

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-call-session
      name: 'dsh-call-session'
      config:
        enabled: true
        debounceMs: 300
        maxCapacity: 200
```

用户如需自定义配置，在用户配置文件中声明属性覆盖层，无需复制插入块，避免重复注入。

### 依赖注入
插件入口必须严格声明依赖服务清单：

```javascript
export const name = 'dsh-call-session';
export const inject = ['agents', 'tools', 'systemPrompt'];
```

- `agents`：提供存活会话与代理实例索引服务。
- `tools`：提供面向大语言模型的原生工具注册服务。
- `systemPrompt`：提供面向模型注入跨会话协作指南的提示词扩展服务。原指令服务已随历史斜杠指令废止而移除。

### 资源回收
资源回收契约聚焦于对偶清理与状态刷盘：
1. 挂载退出处置回调：在插件卸载或热重载时触发异步刷盘，强行刷新所有未落盘的防抖写入并关闭底层定时器。
2. 作用域自动解绑：工具注册句柄绑定至插件运行纤程，卸载时由宿主容器自动撤销，杜绝残留句柄与内存悬挂。
3. 独立持久化路径：黑板存储默认落在宿主环境目录，不污染插件安装目录。

---

## 影响

### 正向收益
- 全局可用：新建或已有会话均可直接调用跨会话协作工具。
- 工程无污染：业务工程工作区无需任何配置文件或运行时依赖。
- 完备可测试性：自动化测试与宿主重启时，插件可干净卸载与重载，零状态残留。

### 架构代价
- 跨会话共享单一存储引擎：依赖工作区边界隔离策略，避免数据跨工程混淆，默认仅在当前工作区内隔离呈现。

---

## 验证

### 自动化集
- 声明注入断言：验证导出的服务注入清单精确包含 `agents`、`tools` 与 `systemPrompt`。
- 资源清理断言：在测试套件中触发插件卸载回调，验证防抖定时器全部清空且工具注册彻底注销。

### 审查清单
- 确保补丁语法合规，无重复嵌套插入声明。
- 确保依赖服务清单无多余或遗漏。
- 确保卸载逻辑中正确等待异步存储关闭完成。

---

## 演化

- 2026-09-04：工程团队提议并接受初始设计。
- 2026-09-10：废止斜杠指令并从注入清单中移除指令服务，保持极简服务依赖。
- 关联决策：
  - 互补：[ADR-0003](./0003-workspace-scoped-isolation-by-default.md) 工作区隔离规范
  - 互补：[ADR-0004](./0004-atomic-debounced-persistence-and-healing.md) 原子防抖持久化
  - 互补：[ADR-0006](./0006-pure-dsh-native-in-process-context-injection.md) 原生上下文注入
  - 演化：[ADR-0035](./0035-durable-blackboard-storage-outside-the-plugin-package.md) 插件包外持久化存储