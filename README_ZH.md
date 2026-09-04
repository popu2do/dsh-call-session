# dsh-call-session

<p align="center">
  DeepSeek Harness (DSH) 进程内跨会话通信管道与工作区共享黑板
</p>

<p align="center">
  <a href="https://github.com/popu2do/dsh-call-session/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="./docs/adrs/README.md"><img src="https://img.shields.io/badge/ADR-Standard-green.svg" alt="ADR Architecture" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933.svg?logo=node.js&logoColor=white" alt="Node.js Version" /></a>
  <a href="https://cordis.moe"><img src="https://img.shields.io/badge/Cordis-v4.x-purple.svg" alt="Cordis" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript Strict" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_ZH.md">简体中文</a>
</p>

## 简介

dsh-call-session 是面向 DeepSeek Harness (DSH) 的进程内跨会话通信与状态共享插件。

在多 Agent 并发运行时，插件提供两类协作能力：
- 单播呼叫：在独立运行的会话之间发起 1:1 指令派发与进度汇报，根据目标状态自适应选择运行中引导（steer）或空闲唤醒（followup）。
- 共享黑板：提供工作区隔离的共享存储，供各会话发布与按需拉取里程碑、任务上下文和较大体量数据，发布操作不触发被动唤醒。

## 安装

```bash
# 安装到指定 profile（以 web 为例）
dsh plugin --profile web add dsh-call-session

# 查看已安装插件
dsh plugin --profile web list

# 卸载插件
dsh plugin --profile web remove dsh-call-session
```

> 注意：`--profile` 参数必须置于 `plugin` 子命令之后（例如 `dsh plugin --profile web ...`）。

## 用法

### 单播呼叫

通过 `session_call` 向指定会话发送指令或报告。插件在宿主进程内直接获取目标会话引用并注入原生通知：

```json
{
  "name": "session_call",
  "arguments": {
    "target_session_id": "session-be7d7578b0fe",
    "call_type": "task_dispatch",
    "message": "请复审 types/index.d.ts 中的导出规范。"
  }
}
```

### 黑板共享

通过 `board_post` 发布共享数据或阶段结果，获取唯一 `postId`；其它会话按需通过 `board_list` 查询，不产生被动唤醒：

```json
{
  "name": "board_post",
  "arguments": {
    "topic": "task:audit",
    "content": "安全审计已完成，未检出风险项。",
    "tags": ["audit", "passed"]
  }
}
```

### 协作模式

对于大文本（如详细测试日志、审计报告或代码变更），推荐采用两阶段协作：
1. 发送方调用 `board_post` 将大体量内容写入黑板，取得 `postId`；
2. 发送方调用 `session_call` 发送精炼指令，并在 `context_post_ids` 中附带该 `postId`；
3. 接收方收到指令后，按需通过 `board_list` 拉取完整内容。

## 工具

| 名称 | 类型 | 机制 | 说明 |
| :--- | :--- | :--- | :--- |
| `session_call` | Tool | 推送 | 1:1 单播呼叫目标会话，自适应选择 steer 或 followup |
| `session_query` | Tool | 只读 | 检索当前工作区（或跨工作区）的活跃与空闲会话 |
| `board_post` | Tool | 拉取 | 向工作区黑板发布公告或中间产物，零被动唤醒 |
| `board_list` | Tool | 拉取 | 查询黑板条目，支持标签、主题过滤与 titles_only 节省 Token |
| `board_clear` | Tool | 管理 | 归档（dismiss）或物理清理（purge）黑板条目 |
| `/dsh-call-session` | Slash | 交互 | Web 界面快捷指令，支持无参看板摘要与带参单播呼叫 |

### session_call

向目标会话发起单播调用。目标处于 `running` 状态时通过 `steer` 实时引导，处于 `idle` 状态时通过 `followup` 唤醒新轮次。

核心参数：
- `target_session_id` (string，必填)：目标会话 ID 或大于等于 8 位的唯一前缀。禁止使用 `*`、`all` 等通配符。
- `message` (string，必填)：指令或汇报文本，单次不超过 4,000 字符。
- `call_type` (string，可选)：意图类型，支持 `task_dispatch`、`task_report`、`notice`，默认 `task_dispatch`。
- `context_post_ids` (string[]，可选)：引用的黑板条目 ID 列表。

### session_query

检索当前宿主环境中的会话列表与运行时状态。

核心参数：
- `query` (string，可选)：按 Session ID 或标题模糊过滤。
- `running_only` (boolean，可选，默认 `false`)：仅返回运行中会话。
- `cross_workspace` (boolean，可选，默认 `false`)：是否跨工程查询。默认为 false，仅检索当前工作区。
- `limit` (integer，可选，默认 `50`)：返回条数上限。

返回列表包含 `sessionId`、`title`、`status`（规整为 `running` 或 `idle`）与 `cwd`。

### board_post

向公共黑板发布共享信息。操作为纯拉取模式，不会打断或唤醒任何会话。

核心参数：
- `topic` (string，必填)：主题标识（如 `task:audit`、`build:artifact`）。
- `content` (string，必填)：内容正文，支持文本或 Markdown，最大 64KB。
- `tags` (string[]，可选)：检索标签。
- `ttl` (integer，可选，默认 `3600`)：过期时间（秒）。

调用后返回唯一 `postId` 与条目元数据。

### board_list

检索黑板上的有效记录。默认按当前工程工作区隔离。

核心参数：
- `topic` (string，可选)：按主题完全匹配。
- `topic_prefix` (string，可选)：按主题前缀匹配。
- `tag` (string，可选)：按标签过滤。
- `titles_only` (boolean，可选，默认 `false`)：仅返回标题与元数据，不包含 content 正文，大幅节约 Token。
- `cross_workspace` (boolean，可选，默认 `false`)：是否跨工作区查询。
- `limit` (integer，可选，默认 `20`)：返回条数上限。

调用示例：
```json
{
  "name": "board_list",
  "arguments": {
    "topic": "task:audit",
    "titles_only": true
  }
}
```

### board_clear

清理已完成或失效的黑板记录。

核心参数：
- `id` (string，可选)：按条目 ID 精确指定。
- `topic` (string，可选)：按主题批量匹配。
- `mode` (string，可选，默认 `dismiss`)：`dismiss` 为软归档，`purge` 为物理删除。

调用示例：
```json
{
  "name": "board_clear",
  "arguments": {
    "topic": "task:audit",
    "mode": "dismiss"
  }
}
```

## 指令

在 DSH Web 界面中可直接使用 `/dsh-call-session` 斜杠命令：
- 查看摘要：输入 `/dsh-call-session`，输出当前工作区黑板条目列表；
- 单播呼叫：输入 `/dsh-call-session <sessionId> <message>`，向指定会话发送消息。

## 配置

插件包含默认配置（300ms 写入防抖、容量 200 条），安装后即可使用。

如需自定义，可在 `~/.dsh/profiles/web/cordis.patch.yml` 中追加属性覆盖：

```yaml
- id: dsh-call-session
  config:
    debounceMs: 500
    maxCapacity: 500
```

配置项：
- `enabled` (boolean，默认 `true`)：是否启用插件。
- `debounceMs` (number，默认 `300`)：黑板落盘防抖延迟（毫秒）。
- `maxCapacity` (number，默认 `200`)：黑板条目容量上限，超出后先进先出淘汰。
- `slashCommand` (boolean，默认 `true`)：是否注册 Web 斜杠指令。

## 对比

DSH 原生机制与本插件的定位及协作模型对比如下：

| 方案 | 机制类型 | 协作模型 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `subagent` | 原生内置 | 纵向父子委托（单任务派生，完成后回收） | 局部探索、代码检索、单次脚本运行等独立封闭任务。 |
| `dsh-call-session` | 扩展插件 | 横向对等协作（进程内跨会话单播与共享黑板） | 多个独立长效会话间的指令派发、状态同步，或跨会话共享中间产物。 |

### 选型

- 优先原生：单一独立封闭任务直接使用 DSH 内置的 `subagent`，生命周期由主会话管理，开箱即用无需依赖插件。
- 按需选用：当存在多个并行运行的独立顶层会话，且会话间需要传递指令或借助黑板共享大文本上下文时，选用 `dsh-call-session`。

## 架构

核心架构决策记录（ADR）见 [docs/adrs/README.md](./docs/adrs/README.md)：

| 编号 | 主题 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| [ADR-0001](./docs/adrs/0001-separation-of-concerns-board-vs-call.md) | 黑板与单播职责划分 | Accepted | 拉取式黑板与 1:1 单播，避免广播风暴 |
| [ADR-0002](./docs/adrs/0002-builtin-blackboard-store.md) | 内建黑板存储 | Accepted | 内存主索引加本地持久化，无外部数据库依赖 |
| [ADR-0003](./docs/adrs/0003-workspace-scoped-isolation-by-default.md) | 默认工作区隔离 | Accepted | 基于代码根目录隔离条目，支持受控跨工程查询 |
| [ADR-0004](./docs/adrs/0004-atomic-debounced-persistence-and-healing.md) | 防抖原子写盘与恢复 | Accepted | 300ms 防抖、临时文件替换与 .bak 容灾恢复 |
| [ADR-0005](./docs/adrs/0005-english-metadata-and-two-state-status.md) | 两态状态模型 | Accepted | 会话状态规整为 running 与 idle |
| [ADR-0006](./docs/adrs/0006-pure-dsh-native-in-process-context-injection.md) | 原生进程内上下文注入 | Accepted | 宿主直连与原生通知源标记 |
| [ADR-0007](./docs/adrs/0007-web-slash-command-and-visual-ux.md) | Web 斜杠指令 | Accepted | 提供 /dsh-call-session 指令与低干扰通知呈现 |
| [ADR-0008](./docs/adrs/0008-zero-pollution-global-profile-mounting.md) | Profile 切面挂载 | Accepted | 声明式挂载与生命周期纳管 |
| [ADR-0009](./docs/adrs/0009-restrained-minimalist-docs-and-anti-ai-slop.md) | 克制文档与反AI堆料 | Accepted | 零Emoji、纯净减法与<=4字小标题 |

## 测试

基于 Node.js 原生测试驱动器构建：

```bash
# 运行单元测试
npm test

# 代码检查
npm run lint

# 发布前完整校验
npm run verify
```

## 许可

本项目采用 [MIT License](./LICENSE) 协议。
