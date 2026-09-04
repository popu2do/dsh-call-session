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
3. 依赖其他 MCP（比如把 Memory MCP 当成临时数据中转站）。

这些做法存在严重缺陷：
- **安装维护成本高**：强迫用户额外配置外部数据库或常驻进程，与轻量插件开箱即用的原则背道而驰；
- **概念模型错配**：其他工具（如知识图谱）根本不是为高频、易逝的“任务公告牌”设计的，强行塞入会导致大量脏数据和性能瓶颈；
- **单点故障风险**：外部进程一旦崩溃或被操作系统杀掉，整个跨会话协作链条立即瘫痪。

因此，我们需要一个**完全由插件自己掌控、零外部依赖、开箱即用**的状态共享机制。

---

## 2. Decision Drivers

1. **零外部依赖（Zero External Dependency）**：用户只需加载本插件，无需安装任何数据库或第三方服务。
2. **开箱即用与高性能（High Performance）**：内存中毫秒级存取，不阻塞 Agent 工具调用。
3. **安全可靠落盘（Reliable Persistence）**：进程重启后公告状态不丢失，且必须具备坏块自愈和防并发冲突能力。
4. **纯粹性原则（No Clutter, Clean Architecture）**：坚持单一职责，不迎合错误历史路径，不搞冗余兼容包袱。

---

## 3. Considered Options

- **Option A: 强依赖外部数据库（SQLite / Redis）**
  - *缺点*：引入原生 C++ 编译依赖（Node-gyp）或外部端口监听，极易因平台环境差异导致安装失败。
- **Option B: 寄生于外部 MCP 工具做数据中转**
  - *缺点*：借用其他进程存数据属于架构反模式，数据格式别扭且容易造成内存泄漏。
- **Option C: 插件内建轻量化黑板存储引擎（AtomicBoardStore） [Selected]**
  - *优点*：由插件直接实现内存一级索引，配合 300ms 异步防抖与文件原子重命名写盘；轻量、纯粹、无任何第三方运行时依赖。

---

## 4. Decision Outcome

### 方案决策
插件彻底剔除对外部服务的任何幻想，**在插件内部完整实现一套开箱即用的轻量黑板存储引擎（`BoardStore` / `AtomicBoardStore`）**，为跨会话协同提供纯粹的状态发布与查询能力：
1. **内存直读**：所有公告保存在内存 Map 结构中，`board_list` 响应时间低于 1ms；
2. **异步原子落盘**：写操作（`board_post` / `board_clear`）经 300ms 防抖后，通过唯一临时文件与原子重命名写入同级 `board.json`；
3. **坏块自愈**：落盘前自动维护 `.bak` 镜像备份，即使意外断电损坏主文件，下次启动 100% 自动修复恢复；
4. **容量与时效治理**：内建 TTL 过期清理与 FIFO 容量淘汰机制（默认最多保留 200 条），防止无限膨胀。

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
│                         ▼ (内存 0ms 存取)                   │
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
- **极致简单**：克隆仓库即可运行，零外部配置，零额外环境依赖；
- **干净纯粹**：彻底斩断历史遗留包袱，代码逻辑清晰单向，极易审查与维护；
- **性能卓越**：不走任何外部 IPC 管道或网络协议，内存读写快如闪电。

### 权衡
- **单机作用域**：该存储局限于单台物理机/单个 DSH 实例内（符合 DSH 当前的单机运行定位）。

---

## 6. Compliance and Verification

- **纯粹性检查**：源码中不得含有任何拦截第三方遗留工具的代码（无 `tools/result` 侵入式监听）；
- **零依赖检查**：`package.json` dependencies 列表保持为空（零外部 npm 依赖）；
- **自愈功能测试**：人为破坏 `board.json` 后冷启动，断言系统能 100% 从 `.bak` 自动恢复。
