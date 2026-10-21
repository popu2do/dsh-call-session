# 规格说明: 同级会话工作区发现与本地引用规范

## Problem Statement

用户在输入框键入 @ 符号引用同级会话时，面临界面重绘打扰与列表脏乱问题：
系统自带的原生功能会在后台向远端服务器发起全量会话查询，耗时两秒才能返回。此时两套功能产生冲突，原生慢速查询返回后会强制重绘输入菜单，将大量历史审查子任务与已终结死会话覆盖在最顶层，导致光标焦点丢失，界面剧烈闪烁，真正需要协作的同级会话被挤出视野。

## Solution

在不破坏系统自带文件搜索的前提下，由插件接管会话排位优先级与展示逻辑：
第一，保留系统原生搜文件与搜目录功能，完全不予破坏；
第二，将插件来源的优先级提升至最顶端，保证选工作区与选会话的操作永远稳居首位，光标不被抢占；
第三，用户进入具体工作区后，二级会话列表完全基于本地内存秒级解析，不发起耗时两秒的远端慢速查询，从源头切断二次重刷新；
第四，严格过滤所有跑腿子任务与已归档死会话，仅展示当前工作区内独立自治的活跃根会话；
第五，参与过单播协同的会话优先置顶，次级按最新更新时间倒序，绑定 8 位短标识徽标消歧，单帧内存耗时小于 5 毫秒并硬限 50 条。

## User Stories

1. As a collaborative developer, I want typing @ in the composer to show accessible project workspaces right at the top, so that I can pick my target workspace immediately without hunting.
2. As a project owner, I want the current project workspace automatically pinned to the very top, so that I can enter my active working directory with a single click.
3. As a developer searching files, I want native file and folder search to remain completely functional, so that my existing file reference habits are never broken.
4. As an engineer entering a workspace, I want the secondary session list to strictly exclude all internal subagents and review tasks, so that only genuine independent root sessions appear.
5. As an engineer inspecting a project, I want the secondary session list to completely filter out archived or finished sessions, so that dead tasks never clutter my active view.
6. As a multi-agent collaborator, I want peer sessions registered with call-session to be prioritized at the top of the workspace list, so that active collaborators are reachable first.
7. As a multi-session user, I want secondary sessions with the same priority sorted strictly by latest update recency, so that recently active sessions appear ahead of older ones.
8. As a developer managing parallel tasks with identical titles, I want candidate rows to display an 8-character short ID badge, so that I can tell duplicate names apart instantly.
9. As a system observer, I want candidate rows to display real-time three-state status indicators, so that I know whether each peer session is running, idle, or in an error state.
10. As a keyboard-first user, I want Tab or Enter on a workspace row to enter it smoothly and Escape to cancel without altering my text, so that I never have to touch the mouse.
11. As a multi-workspace user, I want a breadcrumb trail at the top of the list showing Workspace Root / <workspace-name>, so that I can return to the top list with one click.
12. As a composer user, I want picking a session to insert a clean inline chip showing only the chat icon and title, so that my prompt stays readable.
13. As an engineer verifying targets, I want hovering over an inserted chip to reveal a tooltip displaying workspace path, short ID, session ID, and status, so that I can check details before sending.
14. As an architect enforcing performance baselines, I want the entire workspace session lookup to run strictly in local memory within 5 milliseconds, so that the UI never stutters or re-refreshes two seconds later.
15. As an architect enforcing boundary constraints, I want text references to deliver pure read-only session state text to the model without triggering agent wakeups, so that collaboration canvas edges stay strictly at 0.
16. As a bilingual developer, I want all workspace labels, breadcrumbs, and status tags localized symmetrically in Simplified Chinese and English, so that interface copy matches my language.

## Implementation Decisions

### 优先接管

功能收敛在客户端输入源契约中，命名为 peer-session，触发字符为 @。
将插件输入源的排位权重调整为负十，确保在系统合并多个数据源时，插件的工作区入口与同级会话永远排在最顶层，光标焦点始终稳定停留在此，消除外部异步数据抢占焦点的跳动隐患。

### 原生共存

严格恪守不破坏原生的准则：
系统自带的本地文件搜索与目录钻取逻辑完全保留，不修改一行原生代码，不注入破坏性切面，两者在同一输入框内安全共存。

### 本地求值

点进工作区后，二级会话列表完全由插件从本地内存快照中同步提取：
不调用系统自带的远端会话查询接口，不向远端服务器发送任何网络请求。纯内存遍历与排序在 1 毫秒内同步落定，从源头上消除两秒后的二次重刷新现象。

### 会话清洗

对二级展开的会话实体实施多维清洗：
- 排除子会话：凡包含 parentSessionId、parentId、parentSession、拥有 subagent 标记、或标题包含审查与临时任务特征的条目，一律直接忽略；
- 排除归档会话：凡标记为 archived 或状态为 archived、dismissed、deleted 的会话，一律直接忽略。

### 确定排序

二级展开列表严格执行两级排序：
- 第一优先级：提取调用连线记录与黑板存储，凡参与过单播调用呼入呼出、发布过黑板条目、或由同级工厂创建的会话判定为已注册，优先置顶；
- 第二优先级：按会话原生最新更新时间倒序排列；
- 数量截断：展现结果上限硬性钳位在 50 条以内，保障浏览器 60 帧每秒丝滑刷新。

## Testing Decisions

### 质量标准

测试面向真实外部表现，运行于 Node VM 沙箱隔离环境中。必须验证：
- 一级列表仅展示工作区，当前工作区自动置顶；
- 二级列表排除子代理与已归档会话，仅展示活跃同级根会话；
- 协同会话优先置顶，同组内按最新时间倒序；
- 8 位规范短 ID 徽标排布整齐；
- 全流程协作看板调用连线计数严格恒等于 0。

### 测试模块

测试文件统一维护在 tests/peer-session-reference.test.mjs，复用沙箱模块加载器与隔离环境。

## Out of Scope

- 不修改或劫持系统底层的文件检索逻辑；
- 不在协作看板上为输入框文本引用绘制连线；
- 不对引用的会话进行物理生命周期干预或强制唤醒。

## Further Notes

该规范遵循智能体消费文档准则，剔除技术黑话，全面对齐 ADR-0034 决策记录与真实交互验收标准。
