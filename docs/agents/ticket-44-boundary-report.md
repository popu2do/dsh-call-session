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

## 真实缺陷 `session-6b440cb0`

### 1. 真实摘要形状复现

用真实 UUID 形状 id 与 `coldUntitledRow()`（无 title、无 message）构造 byId 行，`isSidebarVisibleSession` **会漏它**——但漏的原因不是 `blank === true`，而是**这一行根本没有 `blank` 字段**。`undefined === true` 为假，判据放行。用例 `the reported Session is hidden by the summary and offered by the client row` 同时断言：`'blank' in storeRow === false`、插件放行、标签是 `Agent #6b440cb0`（即报告里看到的"裸 id"）、并且因为 `seq === 0`、`updatedAt` 最大而落在最前。

### 2. blank 缺失时放行、宿主不放行？

**分两种形态，结论不同，必须分开看：**

- 若宿主给的是**摘要行**（`summaryFor` / `summarizeCold`），`blank` 恒为布尔，报告那条会话的冷投影 `blank: true`（`~/.dsh/storages/session_projcache/sessions/session-6b440cb0-....json` 的 `sessionListMetadata.val = {"blank":true,"lastPromptAt":null}`），宿主的 `sessionVisible` 也会隐藏它——**此时没有分歧**，插件漏掉它是因为它读到的行没有该字段。
- 若宿主给的是**没有 blank 字段的行**，宿主的 `sessionVisible` 同样放行（用例 `the Host keeps the same untitled Session, so the row alone explains nothing` 钉死：`visible === true`）。所以单凭"blank 缺失"复现不出"宿主隐藏而插件显示"。

也就是说，blank 缺失这条边界**不是**一条现存的可观测分歧，用例把它固定在"两侧都放行"这一事实上，防止将来有人误以为改 `=== true` 就能修掉这条真实缺陷。

### 3. 是否需要改实现

**需要，但不该改 `blank === true`。** 证据链：

- `dsh-api-session-controller/lib/index.js:1949` `summaryFor` → `blank: metadata?.blank ?? session.seq === 0`；`:1999` `summarizeCold` → `blank: metadata?.blank ?? false`。两者都产出布尔。
- `dsh-api-session-controller/lib/client.js:4149-4215` 的 `projectList` 只在 manager 条目存在时写 `blank: entry.blank`；对**从未被打开过**的成员，条目没有 `blank` 字段，插件读到的 byId 行就缺这个字段。
- `manager.js:697-710` 的 `buildListSnapshot` 才重新派生：`blank: this.effectiveBlank(summary) && metadata?.blank !== false`，`effectiveBlank = summary.blank && !engagedSessions.has(id)`。

所以真正缺的是"客户端行上的 blank 派生"。若要修，改点在 `lib/client.js:3729` 的 `isSidebarVisibleSession`（二级候选与 `alignNativeCandidatesWithSidebar` 共用），可考虑对"无 title 且无 `blank` 字段"另设兜底，或改读 manager 派生的行。**影响面**：二级候选菜单、原生包装层的对齐，以及所有依赖该判据的可见性结论；且与"照抄宿主真值"的裁决耦合，属于口径变更，本轮按票面要求只记录不动手。

另一个需要更正的事实：报告说"显示裸 id 所以 blank 为假"，这个推断不成立。宿主 `sessionTitle`（`dsh-client-ui-workspace/lib/client.js:998`）对 blank 行返回空串占位，只有非 blank 行才显示 title；而插件的 `Agent #6b440cb0` 正是 `formatCandidateShortId` 对无 title 行的回落。两者并存不矛盾。

## 变异法

每次改坏 `lib/client.js` 后跑单文件，`git checkout -- lib/client.js` 恢复：

| 改坏点 | 变红用例 |
| --- | --- |
| `blank === true` → 真值判断 | 4 条（blank 1 / "yes" 记录项 + 真实空会话 blank 1 / "yes"） |
| `isSubagentOrigin` 的 `header.origin` 兜底 `return false` | 2 条 |
| 上限 `> 50` → `> 60` | 2 条（截断位置、只统计存活行） |
| `sessionsById[sKey]` 改成一解析不到就抛 | 2 条（byId miss、畸形 sessionIds 语料重放） |
| `sessionRecency` 去掉 `|| 0` | 1 条（updatedAt 缺失保持名册序） |

**如实交代三处改坏后仍全绿（弱覆盖）**：

1. `resolveArchivedSessionIds`（`lib/client.js:3722-3723`）去掉 `Array.isArray` 守卫——因为 `isSidebarVisibleSession`（`:3734`）自己还有一层 `Array.isArray` 兜底，双重守卫删一处不改变行为。
2. 二级候选的 `memberIds` 守卫改成 `|| []`——`null`/`undefined` 两条分支结果等价。
3. 归档名单为字符串时，守卫删与不删都全放行：`:3734` 的 `Array.isArray` 先拦掉字符串，`indexOf` 永不执行。相应的字符串用例钉的是"不漏放可见成员"的现实行为，不是守卫本身。

## 待裁决

1. **blank**：插件严格布尔 vs 宿主真值判断，是否照抄宿主。
2. **origin**：插件 `header.origin` 兜底是否保留（当前与宿主不一致的两条）。
3. **真实缺陷**：是否改 `isSidebarVisibleSession` 为"无 title 且缺 blank 字段"兜底隐藏，以及是否改为读取 manager 派生行——影响二级候选与原生包装层两处。
