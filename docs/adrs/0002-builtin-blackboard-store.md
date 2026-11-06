<!--
ADR Writing Guidelines (writing-for-agents):
1. Focus on architectural intent, forces, decisions, and invariants.
2. Avoid code dumps that duplicate live code.
3. Keep prose dense, factual, and scannable without parenthetical annotations.
4. If writing in Chinese, ensure all subheadings are <= 4 characters.
-->
# ADR-0002: 内建黑板状态存储与零外部依赖

- **Status**: Accepted (Storage core evolved by ADR-0027 and ADR-0030)
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineer, User
- **Consulted**: Core DSH Engine Team
- **Informed**: All DSH Profile Plugin Maintainers

> **架构演化**：纯存储引擎 `BoardStore` 与工具适配 `BoardToolsAdapter` 的物理隔离在 [ADR-0027](./0027-deep-module-workspace-isolation-tools-registry-and-canvas-geometry.md) 与 [ADR-0030](./0030-direct-tool-binding-to-board-tools-adapter.md) 中确立。

---

## 背景

在多智能体跨会话协同场景中，系统面临核心问题：多个会话与智能体之间如何高效共享协作状态、张贴公共事实或发布待办任务。

初期曾考量以下途径：
1. 要求用户在本地额外安装部署独立数据库；
2. 依赖外部第三方云服务或集中式状态服务；
3. 依赖外部模型上下文协议工具作为临时中转。

这些途径存在明显局限：
- 部署与运维成本高，增加环境配置复杂度；
- 知识图谱等外部工具并非为高频任务公告设计，引入非必要字段与索引开销；
- 外部进程异常将引发级联故障，破坏跨会话协作链条。

因此，系统亟需内建零外部依赖的轻量化状态共享机制。

---

## 动因

- **零外部依赖**：加载插件即开即用，无需外部数据库或第三方常驻进程。
- **内存读写性能**：内存直读存取，避免阻塞智能体工具调用循环。
- **可靠落盘自愈**：进程重启状态不丢，具备镜像备份恢复与并发写盘防护。
- **单一职责解耦**：保持架构边界清晰，阻断外部冗余依赖侵入。

---

## 选型

### 方案一
- **强依赖外部数据库**：如 SQLite 或 Redis。
- **缺点**：引入原生编译依赖或网络端口监听，跨平台环境容易构建失败。

### 方案二
- **依赖外部工具中转**：如外部上下文协议服务。
- **缺点**：引入跨进程强耦合，数据格式转换复杂且存在资源泄漏风险。

### 方案三
- **内建轻量黑板存储引擎**：选中方案。
- **优点**：由插件在进程内实现内存一级索引，配合 300 毫秒异步防抖与原子重命名写盘，零第三方运行时依赖。

---

## 决策

### 方案

插件内部实现轻量黑板存储引擎 `BoardStore`，为跨会话协同提供状态发布与查询能力：
1. **内存直读**：所有条目保存在内存结构中，`board_list` 响应低于 1 毫秒；
2. **异步原子落盘**：写操作经 300 毫秒防抖后，通过唯一临时文件与原子重命名写入持久化文件；
3. **备份自愈**：落盘前维护镜像备份，主文件损坏时下次启动自动从备份恢复；
4. **容量与时效治理**：内建生存时间清理与先进先出淘汰机制，默认保留上限 200 条，杜绝数据无限膨胀。

### 拓扑

```text
┌─────────────────────────────────────────────────────────────┐
│                      dsh-call-session                       │
│                                                             │
│   Native Tools:                                             │
│   - board_post(topic, content, tags, ttl)                   │
│   - board_list(topic, tag, active_only, cross_workspace)    │
│   - board_clear(id, topic, mode)                            │
│                         │                                   │
│                         ▼                                   │
│         ┌───────────────────────────────┐                   │
│         │     BoardStore (In-Memory)    │                   │
│         └───────────────┬───────────────┘                   │
│                         │                                   │
│                         ▼ (300ms 防抖 + 原子重命名)         │
│         ┌───────────────────────────────┐                   │
│         │   board.json (+ board.json.bak)                   │
│         └───────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 收益

### 收益
- **部署即用**：零外部配置，无附加环境与依赖要求；
- **控制流简洁**：状态流转单向清晰，易于维护与审计；
- **极低访问延迟**：内存直接存取，消除进程间通信与网络开销。

### 权衡
- **单机作用域**：状态存储限定在单台物理机与单一宿主实例进程内。

---

## 验证

- **零依赖门禁**：`package.json` 的 dependencies 列表保持为空；
- **自愈恢复断言**：测试套件注入损坏的持久化文件，验证冷启动能自动从镜像备份自愈恢复；
- **非侵入验证**：源码无第三方工具拦截与侵入式监听。
