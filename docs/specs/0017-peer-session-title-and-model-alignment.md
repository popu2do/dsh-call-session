# Spec: Peer Session Title Event Persistence and Model Parameter Alignment

## Problem Statement

通过 `session_create` 创建同级会话时，存在两处与预期不符的行为：
1. **标题显示错误**：调用方即使指定了 `title` 或提供了初始任务指令，Web 界面上新建的会话依然默认显示为工作区目录名。根本原因是底层仅更新了内存对象的标题属性，未向目标会话的事件日志（Event Log）中追加 `session/title` 事件；且初始消息标记为插件来源，无法触发宿主针对人类用户消息的自动标题生成逻辑。
2. **模型参数与预设配置入参声明缺失**：虽然底层已实现模型与推理强度的继承逻辑（ADR-0015），但在工具声明（JSON Schema）中遗漏了 `reasoning_effort` 与 `preset` 字段，且说明文案未明确标注“默认继承当前会话的模型参数与预设配置，除非手动指定”。

## Solution

1. **会话标题持久化落盘**：在 `session_create` 创建目标会话后，直接向目标会话日志追加一条 `session/title` 事件（或调用 `ctx.sessionTitle.rename`），确保宿主投影服务与 Web GUI 即时显示规范化标题。
2. **补全工具入参声明**：在 `session_create` 的工具入参定义中补齐 `reasoning_effort` 与 `preset` 属性，并在描述中明确标明“默认继承当前会话的模型与预设配置，除非手动指定”。
3. **建立技术规范文档**：新建 ADR-0017《同级会话标题事件持久化与宿主日志对齐规范》（Peer Session Title Event Persistence and Host Alignment Specification）。

## User Stories

1. As a developer using peer sessions, I want newly created peer sessions to immediately display their derived or explicit titles in the GUI, so that I can easily distinguish concurrent sessions without seeing fallback workspace names.
2. As a caller agent creating a peer session, I want the new session to inherit my current model and reasoning effort settings by default, so that task execution capacity remains consistent across peer agents.
3. As a caller agent with specific model requirements, I want to explicitly specify `model`, `reasoning_effort`, and `preset` parameters when calling `session_create`, so that I can configure the target session to use specialized models or presets.
4. As a system maintainer, I want peer session titles to be persisted as append-only `session/title` log events, so that session titles survive replay, resume, persistence reload, and workspace projection.

## Implementation Decisions

- **会话标题事件追加**：
  在 `lib/session-create.mjs` 中，创建目标会话对象后，调用 `targetAgent.session.append('session/title', { title: finalTitle, messageSeqs: [], source: { kind: 'user' } })`，若宿主存在 `ctx.sessionTitle.rename` 则优先复用。
- **工具定义与类型补全**：
  在 `index.mjs` 中完善 `session_create` 的 `parameters.properties`，增加 `reasoning_effort` 和 `preset`，同步更新 `types/session-create.d.ts`。
- **文档规范**：
  创建 `docs/adrs/0017-peer-session-title-event-persistence-and-host-alignment.md`，并在 `docs/adrs/README.md` 中建立索引。

## Testing Decisions

- **测试质量原则**：仅验证外部可见行为（会话日志是否包含 `session/title` 事件、返回的元数据是否正确、模型参数是否继承或覆写），不耦合内部临时变量。
- **测试模块**：`tests/session-create.test.mjs`。
- **已有参考**：现有 `tests/session-create.test.mjs` 中关于模型继承与预设装配的单测。

## Out of Scope

- 修改宿主 `@deepseek-ai/dsh-session-title` 的内部工作逻辑。
- 改变非同级会话（人类首条消息）的标题提炼策略。

## Further Notes

- 全面遵循项目语言与代码规范，消除术语混淆与冗余别名。
