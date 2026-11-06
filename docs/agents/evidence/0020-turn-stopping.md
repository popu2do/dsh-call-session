# Issue #20 · turn-stopping 实机取证

本文件记录 `agent/turn-stopping` 在真实宿主进程里的行为，供守卫实现与测试引用。
取证方式：独立 headless profile（`~/.dsh/profiles/probe20`），不触碰正在使用的 Web GUI。
探针脚本是一次性的临时文件，取证结束即删，仓库里不留；下面的日志片段与复现工序才是可复核的部分，
按「复现命令」一节重跑即可得到同类事件流。

## 复现命令

profile 由 `~/.dsh/profiles/probe20/cordis.patch.yml` 直接装配，其 `dsh-call-session`
依赖以 `link:` 指向本 worktree，因此无需临时 overlay 文件。取证时只跑 headless，且用独立 profile，避免污染正在使用的 Web GUI：

```bash
WORKBUDDY_API_KEY="$(grep -oP 'WORKBUDDY_API_KEY:\s*\K\S+' ~/.dsh/.credentials.yaml)" \
node ~/.local/bin/dsh --profile probe20 headless "<任务文本>"
```

会话日志（宿主事件流）落在 `~/.dsh/sessions/<workspace>/session-*/session.v4.jsonl.zstd`，
用 `zlib.zstdDecompressSync` 解压后逐行 `JSON.parse` 即可复盘 seq 时间线。

## 四条实测路径

### 一、纯文本收尾

任务："只回复两个字：收到。"

```json
{"event":"probe/mounted","pid":47637}
{"event":"agent/status","agentId":"session-5e9ad7df-…","status":"running"}
{"event":"agent/turn-stopping","turn":1,"payloadKeys":["turn","signal","agent"],
 "agentId":"session-5e9ad7df-…","agentSessionId":"session-5e9ad7df-…",
 "agentStatus":"running","signalAborted":false,"steeringQueue":0}
{"event":"agent/status","agentId":"session-5e9ad7df-…","status":"idle"}
```

**钩子触发一次，载荷键为 `turn` / `signal` / `agent`，`signal.aborted === false`。**

### 二、工具调用收尾

任务："用 bash 执行 echo hi，然后原样回复 hi。"

与路径一相同：hooks 触发一次，`turn=1`，键集合一致，`signalAborted=false`。
说明以工具调用收尾的步骤同样会走到回合收尾钩子。

### 三、守卫 steer 之后能否保活

在钩子里对 `payload.agent` 调 `steer(buildNativeUserMessage(...))`（`callType: 'task_hard'`）：

```json
{"event":"hook","n":1,"turn":1,"aborted":false}
{"event":"steered","msg":"[Cross-Session TASK_HARD] from Probe: PROBE: 请再回复一次 OK。"}
{"event":"hook","n":2,"turn":1,"aborted":false}
```

headless 最终输出 `OK`。**同一 `turn=1` 内钩子被调用第二次，模型继续生成——steer 确实把回合顶回去了。**

### 四、用户中止

以 `agent.cancel({ kind: 'user' })` 模拟用户停止：

```json
{"event":"mounted"}
{"event":"status","status":"running"}
{"event":"cancel-issued"}
{"event":"status","status":"idle"}
```

**钩子一次都没触发**：中止路径直接让 agent 转 idle，走不到 turn-stopping。
守卫里对 `signal.aborted` 的短路因此是防御性约束（宿主升级后行为可能改变），而不是补偿一个已观测缺陷。

## 对实现的约束

1. 会话 id 只能从 `payload.agent` 解析（`agent.session.id`）；载荷里没有独立 session 字段。
2. 守卫必须在钩子内 `await agent.steer(...)` 才能真正保活；`followup` 不在该语义内。
3. 预算按 `session + turn` 计数：宿主在回合未结束时会重复调用钩子，必须逐回合重置，否则跨回合永久耗尽。
4. 消息必须用宿主认可的 `UserMessage`（`buildNativeUserMessage`）；裸对象 `{ id, role, content }`
   会让宿主抛 `Cannot read properties of undefined (reading 'kind')` 并退出。裸字符串同样不行——
   它会在回合末被宿主拼进 inbox 后崩溃，见下节实机捕获。

## 附注

取证期间生成的 `[From: … | CallType: task_dispatch]` 现象源自内存中的旧模块（Web profile 的
`node_modules/dsh-call-session` 软链到主仓库），与 worktree 源码无关；用 worktree 源码构造的
`task_hard` 消息摘要为 `[Cross-Session TASK_HARD] from …`。

## 实机捕获：催办消息的形状决定宿主能否接收

复现：worktree 源码经 probe20 profile 的 `dsh-call-session` 软链进真实 dsh 宿主，调用方会话建对等会话后投递 `task_hard`，对等会话被要求拒绝汇报。

### 字符串载荷（修复前）

```
25 assistant/message turn 2 step 1  TEXT: 拒绝汇报
26 step/end
27 agent/inbox/spliced target=next-step inserted=["[Task Hard Obligation] You have pending hard collaboration tasks from Defy20 …"]
28 agent/inbox/spliced target=next-step removedCount=1 inserted=[]
29 turn/end reason={"kind":"error","error":{"message":"Cannot read properties of undefined (reading 'kind')","code":"UNKNOWN"}}
```

`agent.steer(string)` 的字符串被原样拼进 inbox（`inserted` 是裸字符串，不是消息对象），宿主渲染阶段取 `message.kind` 时崩溃，整个回合以 UNKNOWN 结束，该会话此后不再响应任何入站消息。

### 原生 UserMessage 载荷（修复后）

```
25 assistant/message turn 2 step 1  TEXT: 拒绝汇报
26 step/end
27 agent/inbox/spliced target=next-step inserted=[{"id":"4238cb45-…","role":"user","content":[{"type":"text","text":"[From: session-dc326b8d… (Chase20) | CallType: notice]\n\n[Task Hard Obligation] …"}]}]
28 agent/inbox/spliced target=next-step removedCount=1 inserted=[]
29 step/start turn 2 step 2
30 user/message id=4238cb45-…
```

`inserted` 里是带 `id/role/content` 的完整消息对象，`step/start` 出现在 splice 之后，回合被真正续命且没有错误 `turn/end`。`28 removedCount:1` 两版都有，是宿主把 next-step 暂存项并入队列的正常动作，不是撤回。

### 遗留观察

续命后模型停在文本输出，本 profile 的模型在该场景下未继续调用工具。验收结论以宿主侧事件（`step/start`、`user/message`、无错误 `turn/end`）为准，不以对端是否真的汇报为准。同一子会话在后续回合仍正常投递并以 `reason={"kind":"completed"}` 结束，说明修复前是硬错误、修复后会话保持健康。

## 实机捕获：账本记在哪一侧决定谁会收到催办

复现：调用方会话用 `session_create` 建对等会话，随即投递一条 `task_hard`，然后按指令结束本轮。对等会话侧能正常自回 `task_report`（投递链路通），但两边的会话事件流里都找不到任何 `[Task Hard Obligation]` 注入。

当时以为根因在账本方向，于是试过让 `getPendingTasksForSession` 同时匹配 `targetSessionId` 与 `callerSessionId`（"发起方也是当事人"）。这条改动后来被推翻：义务只落在收件方身上，发起方只是在等结果，把它也拉进账本会让守卫追着发起方要它汇报自己正在等的事。

现在 `lib/call-telemetry.mjs:246` 的 `getPendingTasksForSession` 只按 `targetSessionId` 过滤，1:1 结项先按「发件方 = 回执接收方」配对，再在配对范围内严格先进先出。所以本条实机现象的诚实结论是：账本方向没有缺陷，守卫当时不催办是因为该场景里的发起方并没有欠账；守卫到底会不会在真机上催办，仍只认宿主事件。

## 测试替身的教训

`tests/helpers/mock-agent.mjs` 的 `steer`/`followup` 原先接受任意值，"守卫调用了 steer"这条断言在纯字符串载荷下依然通过，而真实宿主直接崩。现改为 `assertNativeUserMessage`：非对象、缺 `id`、`role` 非 `user`、`content` 为空或非 text 分片一律抛 `TypeError`。

## T-C 验收：红绿对照

逐条把守卫的一项约束改回缺陷版本，跑 `node --test tests/report-obligation.test.mjs`，确认对应用例转红，再恢复源码确认全绿。

| 约束 | 缺陷注入 | 转红的用例 |
| --- | --- | --- |
| 中止回合必须放行 | 删掉 `if (payload?.signal?.aborted) return;` | 7 |
| 每回合 3 次催办预算 | 把 `if (sent >= MAX_REPORT_REMINDERS)` 改成恒假 | 8 |
| 只催 `task_hard` | 把过滤条件放宽成 `callType !== 'task_report'` | 5、6 |
| 必须以 UserMessage 投递 | `agent.steer(reminder)` 传裸字符串 | 5、6、7、8、9、11 |

四项注入全部转红，恢复源码后 11/11 通过。第 5、6 项（会话解析、可单独驱动）由 5、6 号用例覆盖：它们用真实载荷形状 `{ turn, signal, agent }` 调用处理器并断言 steer 被调用。
