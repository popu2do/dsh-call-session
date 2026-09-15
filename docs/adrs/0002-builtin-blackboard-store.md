# ADR-0002: Built-in Lightweight Blackboard Store

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: Architect, Engineer, User
- **Consulted**: Core DSH Engine Team
- **Informed**: All DSH Profile Plugin Maintainers

---

## 1. Context and Problem Statement

在开发多 Agent 跨会话协同插件时，我们面临一个核心问题：**多个会话和 Agent 之间如何共享工作状态、张贴公共公告或发布待办任务？**

初期曾设想过几种常见做法：
1. 要求用户在本地另外安装配置 Redis 或 SQLite 等独立数据库；
2. 依赖外部的第三方云服务或复杂的集中式状态服务；
3. 依赖其他 MCP，例如将 Memory MCP 作为临时数据中转站。

这些做法存在局限：
- **安装维护成本高**：需要额外配置外部数据库或常驻进程，增加部署复杂度；
- **概念模型错配**：知识图谱等工具并非为高频任务公告设计，引入非必要字段与索引开销；
- **故障联动风险**：外部进程异常将影响跨会话协作链条。

因此，需要建立零外部依赖的状态共享机制。

---

## 2. Decision Drivers

1. **零外部依赖（Zero External Dependency）**：加载插件即可运行，不依赖外部数据库或第三方服务。
2. **读写性能（High Performance）**：内存直读存取，不阻塞 Agent 工具调用。
3. **可靠落盘（Reliable Persistence）**：进程重启后状态不丢失，具备备份恢复与并发写盘能力。
4. **单一职责（Clean Architecture）**：保持架构边界清晰，不引入无关兼容代码。

---

## 3. Considered Options

- **Option A: 强依赖外部数据库（SQLite / Redis）**
  - *缺点*：引入原生 C++ 编译依赖（Node-gyp）或外部端口监听，极易因平台环境差异导致安装失败。
- **Option B: 寄生于外部 MCP 工具做数据中转**
  - *缺点*：借用其他进程存数据属于架构反模式，数据格式别扭且容易造成内存泄漏。
- **Option C: 插件内建轻量化黑板存储引擎（AtomicBoardStore） [Selected]**
  - *优点*：由插件直接实现内存一级索引，配合 300ms 异步防抖与文件原子重命名写盘，无第三方运行时依赖。

---

## 4. Decision Outcome

### 方案决策
**插件内部实现轻量黑板存储引擎（`BoardStore` / `AtomicBoardStore`）**，为跨会话协同提供状态发布与查询能力：
1. **内存直读**：所有公告保存在内存 Map 结构中，`board_list` 响应低于 1ms；
2. **异步原子落盘**：写操作（`board_post` / `board_clear`）经 300ms 防抖后，通过唯一临时文件与原子重命名写入同级 `board.json`；
3. **备份自愈**：落盘前维护 `.bak` 镜像备份，当主文件损坏时，下次启动自动从备份恢复；
4. **容量与时效治理**：内建 TTL 过期清理与 FIFO 容量淘汰机制（默认最多保留 200 条），防止数据无限膨胀。

### 架构拓扑

```text
┌─────────────────────────────────────────────────────────────┐
│                   dsh-call-session (插件自身)                │
│                                                             │
│   Native Tools:                                             │
│   - board_post(topic, content, tags, ttl)                   │
│   - board_list(topic, tag, active_only, cross_workspace)    │
│   - board_clear(id, topic, mode)                            │
│                         │                                   │
│                         ▼ (内存直读)                        │
│         ┌───────────────────────────────┐                   │
│         │   AtomicBoardStore (In-Memory)│                   │
│         └───────────────┬───────────────┘                   │
│                         │                                   │
│                         ▼ (300ms 防抖 + 原子写盘)            │
│         ┌───────────────────────────────┐                   │
│         │   board.json (+ board.json.bak)                   │
│         └───────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Consequences

### 收益
- **部署简便**：克隆仓库即可运行，无需外部配置与额外环境依赖；
- **结构清晰**：逻辑单向清晰，易于审查与维护；
- **读写低时延**：无外部 IPC 管道或网络协议开销，内存直接读写。

### 权衡
- **单机作用域**：存储局限于单台物理机与单个 DSH 实例内。

---

## 6. Compliance and Verification

- **边界检查**：源码中不含有拦截第三方工具的代码，不使用 `tools/result` 侵入式监听；
- **零依赖检查**：`package.json` 的 dependencies 列表保持为空；
- **自愈功能测试**：模拟损坏 `board.json` 后冷启动，断言系统能从 `.bak` 自动恢复。
