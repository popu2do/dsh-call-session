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

dsh-call-session 是面向 DeepSeek Harness (DSH) 的进程内跨会话通信、同级会话编排与状态共享插件。

在多 Agent 并发运行时，插件提供以下协作能力：
- 单播呼叫：在独立运行的会话之间发起 1:1 指令派发与进度汇报，根据目标状态自适应选择运行中引导 steer 或空闲唤醒 followup。
- 同级会话：通过 `session_create` 创建同级会话，支持上下文引用挂载与配额控制。
- 共享黑板与记名提醒：提供工作区隔离的共享存储，供各会话发布与按需拉取里程碑或状态；并在模型上下文中自动挂载纯状态幂等的作者记名清理提醒，保护 LLM KV Cache。

## 安装

```bash
# 安装到指定 profile web
dsh plugin --profile web add dsh-call-session

# 查看已安装插件
dsh plugin --profile web list

# 卸载插件
dsh plugin --profile web remove dsh-call-session
```

> 注意：`--profile` 参数必须置于 `plugin` 子命令之后，如 `dsh plugin --profile web ...`。

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

对于详细测试日志、审计报告或代码变更等大文本，推荐采用两阶段协作：
1. 发送方调用 `board_post` 将大体量内容写入黑板，取得 `postId`；
2. 发送方调用 `session_call` 发送精炼指令，并在 `context_post_ids` 中附带该 `postId`；
3. 接收方收到指令后，按需通过 `board_list` 拉取完整内容。

## 工具

| 名称 | 类型 | 机制 | 说明 |
| :--- | :--- | :--- | :--- |
| `session_call` | Tool | 推送 | 1:1 单播呼叫目标会话，自适应选择 steer 或 followup |
| `session_query` | Tool | 只读 | 检索当前工作区或跨工作区的活跃与空闲会话 |
| `session_create` | Tool | 原生 | 创建同级会话，独立长期运行，不同于临时子任务 subagent |
| `board_post` | Tool | 拉取 | 向黑板发布公告或中间产物，不触发被动唤醒 |
| `board_list` | Tool | 拉取 | 查询黑板条目，支持标签、主题、id 精确查阅与 titles_only 模式 |
| `board_clear` | Tool | 管理 | 归档 dismiss 或物理删除 purge 黑板条目 |
| `/dsh-call-session` | Slash | 交互 | Web 界面快捷指令，支持无参看板摘要与带参单播呼叫 |

### session_create

创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。

核心参数：
- `title`: string，可选。同级会话标题，最大 60 字符。禁止使用特权前缀 `[SYSTEM]`、`[CAPTAIN]`、`[ROOT]`。未传时由初始消息提取 40 字符摘要，兜底为编号。
- `initial_message`: string，可选。点火初始任务指令，会话创建后立即自动投递并启动第一轮。未传则保持待命 idle。
- `context_post_ids`: string[]，可选。关联的黑板条目 ID 列表，上限 5 条，自动挂载至任务指令首部。
- `model`: string，可选。目标会话模型 ID 覆写，默认继承当前会话模型。

安全防护：
- 工作区配额：每个工作区最多保持 10 个活跃根会话，超出拦截为 QuotaExceeded。
- 限频保护：单会话每分钟最多创建 5 次，超出拦截为 RateLimitExceeded。
- 代际熔断：平级衍生代际深度硬限制为 2 代，超出拦截为 GenerationLimitExceeded。

### session_call

向目标会话发起单播调用。目标处于 `running` 状态时通过 `steer` 实时引导，处于 `idle` 状态时通过 `followup` 唤醒新轮次。

核心参数：
- `target_session_id`: string，必填。目标会话 ID 或大于等于 8 位的唯一前缀。禁止使用 `*` 或 `all` 等通配符。
- `message`: string，必填。指令或汇报文本，单次不超过 4000 字符。
- `call_type`: string，可选。意图类型，支持 `task_dispatch`、`task_report`、`notice`，默认 `task_dispatch`。
- `context_post_ids`: string[]，可选。引用的黑板条目 ID 列表。

### session_query

检索当前宿主环境中的会话列表与运行时状态。

核心参数：
- `query`: string，可选。按 Session ID 或标题模糊过滤。
- `running_only`: boolean，可选，默认 `false`。仅返回运行中会话。
- `cross_workspace`: boolean，可选，默认 `false`。是否跨工程查询。默认为 false，仅检索当前工作区。
- `limit`: integer，可选，默认 `50`。返回条数上限。

返回列表包含 `sessionId`、`title`、`status` 为 `running` 或 `idle`，以及 `cwd`。

### board_post

向公共黑板发布共享信息。操作为纯拉取模式，不触发被动唤醒。

核心参数：
- `topic`: string，必填。主题标识，如 `task:audit`、`build:artifact`。
- `content`: string，必填。内容正文，支持文本或 Markdown，最大 64KB。
- `tags`: string[]，可选。检索标签。
- `ttl`: integer，可选，默认 `3600`。过期时间，单位秒。

调用后返回唯一 `postId` 与条目元数据。

### board_list

检索黑板上的有效记录。默认按当前工程工作区隔离。默认采用精简标题索引模式 `titles_only: true`，剔除 `content` 正文以节约 Token 并保护 Prompt KV 缓存。指定 `id` 进行单条精确查阅时，`titles_only` 自动分流为 `false` 以便直取完整正文。

核心参数：
- `id`: string，可选。按条目唯一 ID 精确检索，如 `post-1725300000000-abcd`。指定 `id` 时 `titles_only` 默认自动分流为 `false`。
- `topic`: string，可选。按主题完全匹配。
- `topic_prefix`: string，可选。按主题前缀匹配。
- `tag`: string，可选。按标签过滤。
- `titles_only`: boolean，可选，默认 `true`。仅返回标题与元数据，不包含 content 正文。未指定 id 时默认为 true，指定 id 时默认为 false。显式传参优先级最高。
- `cross_workspace`: boolean，可选，默认 `false`。是否跨工作区查询。
- `limit`: integer，可选，默认 `20`。返回条数上限。

调用示例：
目录查询，默认精简标题模式：
```json
{
  "name": "board_list",
  "arguments": {
    "topic": "task:audit"
  }
}
```

按 ID 精确查阅，默认返回包含 content 的完整详情：
```json
{
  "name": "board_list",
  "arguments": {
    "id": "post-1725300000000-abcd"
  }
}
```

### board_clear

清理已完成或失效的黑板记录。

核心参数：
- `id`: string，可选。按条目 ID 精确指定。
- `topic`: string，可选。按主题批量匹配。
- `mode`: string，可选，默认 `dismiss`。`dismiss` 为软归档，`purge` 为物理删除。

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

## 看板

在 DSH Web 会话视图顶部选项卡中提供看板，用于观察当前工作区的跨会话协作全景。

- 呈现内容：工作区泳道聚类、`running` 与 `idle` 两态会话节点、黑板条目及其剩余生存期、跨会话调用连线。连线按 `task_dispatch`、`task_report`、`notice` 三类意图着色，随时间衰减。
- 交互层级：悬停高亮 1-Hop 关联子图，双击展开 420px 只读详情抽屉，支持字段复制与 ESC 收起。
- 只读边界：看板不提供任何修改、删除或触发呼叫的操作，全部状态变更由 Agent 自身产生。
- 数据来源：宿主注册的只读路由 `GET /plugins/dsh-call-session/telemetry`，经 Connection 认证保护，仅接受 GET，响应不缓存。调用轨迹保存在有界内存环形缓冲区，默认容量 200 条，FIFO 淘汰，不落盘，宿主重启后瞬态连线清空。
- 无 Web 宿主的组态下插件保持工具态运行，不注册路由，不阻塞启动。

遥测不会注册为大模型工具，System Prompt 保持幂等，Prompt KV Cache 零扰动。

## 配置

插件包含默认配置，300ms 写入防抖、容量 200 条，安装后即可使用。

如需自定义，可在 `~/.dsh/profiles/web/cordis.patch.yml` 中追加属性覆盖：

```yaml
- id: dsh-call-session
  config:
    debounceMs: 500
    maxCapacity: 500
```

配置项：
- `enabled`: boolean，默认 `true`。是否启用插件。
- `debounceMs`: number，默认 `300`。黑板落盘防抖延迟，单位毫秒。
- `maxCapacity`: number，默认 `200`。黑板条目容量上限，超出后先进先出淘汰。
- `telemetryCapacity`: number，默认 `200`，范围 10 到 2000。调用遥测环形缓冲区容量上限，超出后先进先出淘汰。
- `slashCommand`: boolean，默认 `true`。是否注册 Web 斜杠指令。

## 对比

DSH 原生机制与本插件的定位及协作模型对比如下：

| 方案 | 机制类型 | 协作模型 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `subagent` | 原生内置 | 纵向父子委托，单任务派生，完成后回收 | 局部探索、代码检索、单次脚本运行等独立封闭任务。 |
| `dsh-call-session` | 扩展插件 | 横向对等协作，进程内跨会话单播与共享黑板 | 多个独立长效会话间的指令派发、状态同步，或跨会话共享中间产物。 |

### 选型

- 优先原生：单一独立封闭任务直接使用 DSH 内置的 `subagent`，生命周期由主会话管理，开箱即用无需依赖插件。
- 按需选用：当存在多个并行运行的独立顶层会话，且会话间需要传递指令或借助黑板共享大文本上下文时，选用 `dsh-call-session`。

## 架构

核心架构决策记录 ADR 见 [docs/adrs/README.md](./docs/adrs/README.md)：

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
| [ADR-0010](./docs/adrs/0010-dynamic-state-mirror-and-peer-session-lifecycle.md) | 动态状态镜像与同级会话 | Accepted | 纯状态幂等注入保护 KV Cache，同级会话配额与限频熔断 |
| [ADR-0011](./docs/adrs/0011-board-list-token-governance-and-exact-retrieval.md) | 黑板 Token 治理 | Accepted | 默认标题摘要模式，按 id 精确点查智能分流 |
| [ADR-0012](./docs/adrs/0012-visual-collaboration-canvas-and-in-memory-call-telemetry.md) | 协作看板与调用遥测 | Accepted | 有界内存环形缓冲区、只读遥测门面与原生看板视图 |

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
