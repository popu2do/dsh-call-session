# Issue #44 二级候选边界对齐验收报告

分支 `ticket/44`（worktree `.worktrees/26-t44`），基于集成分支 `feat/26-mention-parity @ db29818`。本轮只加测试，未改 `lib/`。

## 交付

| 文件 | 插入 | 说明 |
| --- | --- | --- |
| `tests/helpers/boundary-support.mjs` | +59 | 语料与宿主真值源的再导出，以及宿主拿不到时跳过 `hostTest` 的判定 |
| `tests/secondary-candidate-boundary.test.mjs` | +886 | 47 条用例，按票面边界分组 |

提交（`git log --oneline db29818..HEAD`，9 个）：

```
045c2e0 test(peer-session): pin blank truthiness against the host rule
8931385 test(peer-session): pin roster and member-id degradation
cffb631 test(peer-session): pin origin, cap and ordering boundaries
b96f45e test(peer-session): replay the reported unused Session shapes
d3d112f test(peer-session): record both verdicts for the two open divergences
46afa9c test(peer-session): pin the reported Session against the live store shapes
65a237f test(peer-session): replay live-size roster and archive shapes
dca3ebf test(peer-session): replay every boundary corpus category
cbcd1fb test(peer-session): judge a string archive list by what it hides
```

校验：`npm run --silent verify` → `tests 664 / pass 664 / fail 0`（基线 617，新增 47）；单跑本文件 `tests 47 / pass 47 / fail 0`；`git status` 干净。

## 边界覆盖

### blank 真值分歧

宿主 `dsh-client-ui-workspace/lib/client.js:966` 用 `if (session.blank && ...)`（真值），插件 `lib/client.js:3733` 用 `session.blank === true`（严格布尔）。用例把三态都钉住：

| blank | 插件可见 | 宿主可见 | 一致 |
| --- | --- | --- | --- |
| `true` | 否 | 否 | 是 |
| `1` | 是 | 否 | **否** |
| `"yes"` | 是 | 否 | **否** |

用例名：`blank true/1/"yes" records plugin and Host verdicts`。**按票面要求没有改实现**，两条不一致以"记录分歧"的形式断言（`assert.equal(pluginVisible === hostVisible, shape.agrees)`），captain 若裁定照抄宿主真值，把 `lib/client.js:3733` 的 `=== true` 去掉，这两条会自然变绿而不是变红。

### 归档筛选

- `archivedSessionIds` 为 `null` / 字符串 / 数字时插件退化为空名单、照常出候选（宿主用 `new Set(值)` 无守卫，这是插件自己要多保的契约）。
- 实尺退化：182 成员 / 618 归档，畸形名单时仍是 50 条上限、`session-live-000` 居首；数组形态仍隐藏归档成员。
- 宿主 `archivedFilter === "only"` 且组内无成员时整组跳过（`:1040`），插件二级没有该分支，用例记录这一差异。

### 成员 id / 名册

- `sessionIds` 为 `null` 或缺失：插件出空表不抛；宿主此时直接抛 `TypeError`（用例名直言两侧在名册形态上不一致）。
- `sessionIds` 指向 byId 里不存在的 id：跳过不抛，宿主同样跳过。
- 重复 id：两侧都不去重，各出两行。
- 成员行 `id` 为 `null` 或缺失：仍按 roster 键出行，`value.sessionId` 退化为空串。
- 上一轮遗留的 `sessionIds-unknown-id` / `duplicate-id` 失败是半成品断言写错，不是缺陷——本轮 `a member id missing from byId is skipped without throwing` 直接跑通，变异法也验证了这一点（见下）。

### 子代理 origin

插件 `isSubagentOrigin`（`lib/client.js:3641`）认 `origin === 'subagent'` **或** `header.origin === 'subagent'`，宿主只认 `session.origin`。四种组合都写了用例，其中两条不一致：只有 `header.origin` 说是子代理、以及两者冲突时，插件隐藏而宿主显示。这同样是 pending 裁决项，没有改实现。

### 50 条上限

默认升序 + 倒序排序后 `slice(0, 50)`：51 个成员恰好保留 50 个、第 51 个被丢；47 个可见成员全部放得下；被可见性规则过滤掉的行在截断**之前**就已移除，所以上限只统计存活行。

### updatedAt 排序

`null` / 缺失 / 非数字字符串都不抛：`null` 与缺失经 `|| 0` 落到 0 被排到后面，非数字字符串让比较得 `NaN`，`sort` 视作保持原序（名册序）。同为 `REFERENCE_NOW` 的两条成员按名册序出、重复运行顺序一致；宿主侧用例确认它按同样的名册序排序。

## blank 判据：与宿主同构，无分歧

本轮最初把插件的 `session.blank === true`（`lib/client.js:3733`）与宿主 `dsh-client-ui-workspace/lib/client.js:966` 的 `if (session.blank && ...)` 判为真值分歧，并据此写出 `blank 1`、`blank "yes"` 两条"插件显示、宿主隐藏"的记录态用例。**这个结论站不住**，理由两条。

第一，客户端行上的 `blank` 是派生值，恒为布尔。`dsh-api-session-controller/lib/client.js:4158` 写 `blank: entry.blank`，`entry.blank` 来自 `:3593` 的 `this.effectiveBlank(summary) && metadata?.blank !== false`；`effectiveBlank`（`lib/types/client/sessions/manager.js:219-221`）定义为 `summary.blank && !this.engagedSessions.has(sessionId)`。三者串起来，插件读到的 byId 行上 `blank` 只可能是 `true` 或 `false`，不会是 `1` 或 `"yes"`。那两条用例喂的形状在真实快照里不存在。

第二，"宿主 `sessionVisible` 会放行缺 `blank` 的行"这个结论来自只传两个参数的探针。宿主签名是 `sessionVisible(session, current, archived, archivedFilter)`，`archivedFilter` 未定义时走 `switch` 的 `default` 分支直接 `assertNever$1` 抛出 `unreachable variant: undefined`。带全四个参数（`new Set()` 与 `'default'`）重测，得到：

| `blank` | 非当前会话 | 当前会话 |
| --- | --- | --- |
| `true` | 隐藏 | 显示 |
| `false` | 显示 | 显示 |
| 缺失 | 显示 | 显示 |

与插件 `session.blank === true && session.id !== currentSessionId` 逐格一致。判据**不需要改**，`=== true` 保留。

## 真实缺陷 `session-6b440cb0` 的成因

会话本身是真的：`~/.dsh/sessions/--home-dev-code-TSPR-dsh-call-session--/session-6b440cb0-.../session.v4.jsonl.zstd` 解码后只有 session / permission / sandbox / approval 四行，没有 message、没有 title，是建立后未使用的空会话；它在工作区 `sessionIds` 里，不在归档名单。

宿主会隐藏它：冷投影 `~/.dsh/storages/session_projcache/sessions/session-6b440cb0-....json` 的 `sessionListMetadata.val` 是 `{"blank":true,"lastPromptAt":null}`，经 `effectiveBlank` 得 `blank === true`，`sessionVisible` 在非当前时返回 false。

插件却把它列进二级菜单，且显示 `Agent #6b440cb0` 这种裸短 id 回落。差别不在 `blank` 判据，而在**两边读的不是同一份快照**：宿主侧栏走 `groupByWorkspace(list, ...)`，`list` 是 `projectList()` 投影出来的 `{ids, byId}`；插件二级走 `workspace.sessionIds` 再查 `sessions.list.getSnapshot().byId`。若这条会话在插件读到的快照里 `blank` 不是 `true`（例如行来自另一条派生路径），判据就放行它。

这条**不是** `blank` 缺失导致的，必须原地更正：仓库里曾有"缺 `blank` 字段所以放行"的推断，与上表第三行矛盾——缺字段时宿主也放行，两侧一致，复现不出截图里的差异。

## 变异法

| 改坏点 | 变红用例 |
| --- | --- |
| `blank === true` → 真值判断 | 4 条（blank 1 / "yes" 记录项 + 真实空会话 blank 1 / "yes"） |
| `isSubagentOrigin` 的 `header.origin` 兜底 `return false` | 3 条 |
| 上限 `> 50` → `> 60` | 2 条 |
| `sessionsById[sKey]` 改成一解析不到就抛 | 2 条 |
| `sessionRecency` 去掉 `|| 0` | 1 条 |

captain 独立复跑：`blank === true` → 真值判断时 `tests 664 / pass 660 / fail 4`；`header.origin` 兜底移除时 `661 / 3 fail`；两次均 `git checkout -- lib/client.js` 复原。改坏点删除后全仓 664 / 0。

**如实交代三处改坏后仍全绿（弱覆盖）**：

1. `resolveArchivedSessionIds`（`lib/client.js:3722-3723`）去掉 `Array.isArray` 守卫——`isSidebarVisibleSession`（`:3734`）自带同名守卫，双重兜底。
2. 二级 `memberIds` 守卫改成 `|| []`——`null`/undefined 两分支等价。
3. 归档名单为字符串时，`:3734` 先拦掉字符串，`indexOf` 永不执行。

## 待裁决

1. **origin**：插件 `isSubagentOrigin`（`lib/client.js:3641`）认 `header.origin === 'subagent'`，宿主只认 `session.origin`。只有 `header.origin` 说是子代理、以及两者冲突两种情形，插件隐藏而宿主显示。是否保留这一兜底。
2. **真实缺陷**：`session-6b440cb0` 在插件快照上的 `blank` 实际取值待实测；定位后再决定改 `isSidebarVisibleSession` 还是改快照读取口径。

## 归档筛选与其余边界

- `archivedSessionIds` 为 `null` / 字符串 / 数字时插件退化为空名单、照常出候选（宿主 `new Set(值)` 无守卫）。
- 实尺退化：182 成员 / 618 归档，畸形名单时仍是 50 条上限、`session-live-000` 居首。
- 宿主 `archivedFilter === "only"` 且组内无成员时整组跳过（`:1040`），插件二级无该分支。
- `sessionIds` 为 `null` 或缺失：插件出空表不抛，宿主抛 `TypeError`。
- 成员 id 在 byId 中缺失：跳过不抛，宿主同样跳过。重复 id 两侧都不去重。
- 50 条上限在可见性过滤之后截断；`updatedAt` 为 `null`/缺失经 `|| 0` 排后，非数字字符串得 `NaN` 保持名册序。
