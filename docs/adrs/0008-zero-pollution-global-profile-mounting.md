# ADR-0008: Zero-Pollution Global Profile Mounting and Reversible Lifecycle Management

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Architect, Engineering Team, DSH Ecosystem Team
- **Consulted**: DevOps & Platform Architects, Community Users
- **Informed**: All DSH Profile Maintainers, Downstream Subagents

---

## 1. Context and Problem Statement

### 1.1 Background & Pain Points
在 DSH 中扩展插件时，存在以下工程约束与常见问题：
1. **侵入式项目级安装**：在每个代码工程或工作区重复配置依赖，增加维护成本与版本分歧；
2. **底层代码修改**：直接修改宿主核心文件，升级版本时容易被覆盖；
3. **资源卸载泄漏**：插件热重载或停用时若未清理注册句柄或定时器，会导致常驻内存泄漏。

`dsh-call-session` 需要实现全局可用、会话环境隔离与生命周期可逆管理。

### 1.2 Architectural Forces & Constraints
- **Universal Availability**：宿主启动后，当前 DSH 实例下的任意会话均可调用 `session_call`、`session_query`、`board_*` 及 `/dsh-call-session` 命令；
- **Zero Configuration in Projects**：业务工程工作区无需额外配置文件或 node_modules；
- **Reversible Lifecycle**：插件的加载与卸载保持对偶可逆，卸载时注销所有注册句柄与定时器。

---

## 2. Decision Drivers

- **Driver 1 (Global Availability)**：用户或 Agent 在任意会话中可直接调用跨会话能力；
- **Driver 2 (Declarative Cordis Composition)**：采用 `cordis.patch.yml` 声明式切面挂载机制；
- **Driver 3 (Strict Injection Discipline)**：遵循 Cordis 服务注入规范，声明 `inject: ['agents', 'tools', 'commands']`；
- **Driver 4 (Deterministic Teardown)**：借助 `ctx.on('dispose')` 实现异步存储刷新与副作用注销。

---

## 3. Considered Options

### Option 1: Manual Project-Level Plugin Registration (Rejected)
- **Description**: 在每个业务工程的 `.reasonix` 或 `package.json` 中配置该插件。
- **Pros**: 局部隔离。
- **Cons**: 跨工作区会话无法协同，配置繁琐，增加多会话协作维护成本。

### Option 2 (Chosen): Declarative Global Profile Patch (`cordis.patch.yml`) + Fiber-Scoped Reversible Lifecycle
- **Description**: 在宿主全局 Profile（如 `~/.dsh/profiles/web/cordis.patch.yml`）中声明插入插件。插件通过声明式 `inject` 注入核心服务，并通过 Cordis Fiber 纳管生命周期副作用。
- **Pros**: 一次挂载，各工程与会话可直接调用，生命周期可逆注销。
- **Cons**: 需要宿主正确加载 Profile 层。

---

## 4. Decision Outcome

**Chosen Option**: Option 2 — Declarative Global Profile Patch + Fiber-Scoped Reversible Lifecycle.

### 4.1 Profile Bundle Patch Specification
插件通过 `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，导出标准的 Bundle Patch。
当通过 `dsh plugin --profile <name> add <spec>` 安装后，DSH 会自动将插件注册到 Profile 的 `dsh.profile.bundles` 中，并在宿主启动时自动挂载其 `cordis.patch.yml`：

```yaml
# cordis.patch.yml (Plugin Bundle Patch)
- insert:
    - id: dsh-call-session
      name: 'dsh-call-session'
      config:
        enabled: true
        debounceMs: 300
        maxCapacity: 200
```

> **配置规范**：无需将 `- insert:` 块手动复制到 Profile 根目录的 `cordis.patch.yml` 中，避免重复注入。若需自定义配置，在 Profile 的 `cordis.patch.yml` 中声明属性覆盖层：
> ```yaml
> # ~/.dsh/profiles/web/cordis.patch.yml (用户自定义配置覆盖)
> - id: dsh-call-session
>   config:
>     debounceMs: 500
>     maxCapacity: 500
> ```

### 4.2 Declarative Dependency Injection Specification
插件入口文件 `index.mjs` 必须严格导出服务依赖注入清单：

```javascript
export const name = 'dsh-call-session';
export const inject = ['agents', 'tools', 'commands'];

export function apply(ctx, config = {}) {
  // 核心业务挂载...
}

export default {
  name,
  inject,
  apply
};
```

- **`agents`**：提供 `ctx.agents` 服务（进程内活跃 Agent 实例索引）；
- **`tools`**：提供 `ctx.tools.register` 服务（面向模型的 Native Tool 挂载）；
- **`commands`**：提供 `ctx.commands.register` 服务（面向 Web 用户的 Slash Command 挂载）。

### 4.3 Lifecycle Disposal & Resource Recycling Contract
```javascript
export function apply(ctx, config = {}) {
  const logger = ctx.logger ? ctx.logger('dsh-call-session') : noopLogger;

  // 1. 初始化带 300ms 防抖的原子黑板存储
  const boardStore = new AtomicBoardStore({
    storageDir: __dirname,
    fileName: 'board.json',
    debounceMs: config.debounceMs || 300,
    maxCapacity: config.maxCapacity || 200,
    logger
  });

  // 2. 挂载退出处置回调 (Disposer)
  ctx.on('dispose', async () => {
    logger.debug?.('[dsh-call-session] Disposing plugin, flushing pending writes...');
    try {
      // 强制刷盘并关闭防抖定时器
      await boardStore.close();
    } catch (err) {
      logger.warn?.(`[dsh-call-session] Error during dispose: ${err?.message || err}`);
    }
  });

  // 3. 工具与命令注册（自动纳管至当前 Fiber 上下文）
  // 当插件卸载时，Cordis 自动注销 ctx.tools.register 与 ctx.commands.register 产生的句柄
}
```

---

## 5. Consequences

### 5.1 Positive Consequences (Benefits)
- **全局可用**：新建或已有会话均可调用工具与 `/dsh-call-session` 命令；
- **工程无污染**：业务工程工作区无需额外配置文件或 node_modules；
- **可测试性与热重载**：在自动化测试或宿主重启时，插件可正常卸载与重载，无残留副作用。

### 5.2 Negative Consequences (Tradeoffs & Mitigations)
- **多会话共享单一 BoardStore**：
  - *Mitigation*: 通过 ADR-0003（默认物理工作区逻辑隔离）确保看板数据不会跨工程串扰，只有显式声明 `cross_workspace: true` 才能穿透全局。

---

## 6. Compliance, Validation & Verification

### 6.1 Automated Verification Suite
- **声明注入断言**：测试验证导出的 `inject` 数组精确包含 `['agents', 'tools', 'commands']`；
- **Dispose 清理断言**：在单元测试中调用插件卸载 Disposer，验证：
  1. `boardStore` 防抖定时器已清空；
  2. `ctx.tools` 中 `session_call` / `board_*` 注册已被移除；
  3. `ctx.commands` 中 `dsh-call-session` 注册已被注销。

### 6.2 Review Checklist
- [ ] 检查 `cordis.patch.yml` 格式合规性；
- [ ] 确保 `inject` 清单无遗漏；
- [ ] 确保在 `dispose` 事件中安全执行了 `await boardStore.close()`。

---

## 7. Status History & Related Artifacts

- **2026-09-04**: Proposed & Accepted by Engineering Team
- **Related ADRs**:
  - Complements: ADR-0006 (Native Context Injection), ADR-0007 (Web Slash Command), ADR-0003 (Workspace Isolation), ADR-0004 (Atomic Persistence)
- **Implementation Artifacts**:
  - `index.mjs`
  - `cordis.patch.yml`
