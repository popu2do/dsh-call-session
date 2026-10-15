# ADR-0032: Initial Message Transport Header Alignment and Convergence Metadata Specification

- **Status**: Accepted
- **Date**: 2026-10-18
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Transport Maintainers, QA Reviewers, Downstream Subagents
- **Informed**: All Plugin Users

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
在 DeepSeek Harness 多智能体协作链路中，任务通常通过单播调用派发或者通过创建同级会话指派。然而在既有通信实现中，两处关键的收敛与闭环环节存在语义断裂：
1. 初始任务来源标识丢失：当发起方通过 `session_create` 并传入 `initial_message` 创建同级会话时，底层组装的初始消息仅包含黑板条目引用行与原始输入正文，未注入包含创建方会话编号与 CallType 为 task_dispatch 的传输层客观报头。新建会话在处理完任务后，无法获知应当向哪个会话回传 task_report，导致成果无法按契约向发起方收口。
2. 工具出参缺失收敛预期：当发起方调用 `session_call` 派发任务或调用 `session_create` 启动同级会话时，工具返回值仅陈述了单播管道与进程物理状态，缺乏非指令性的客观收敛预期说明，容易导致调用方模型在任务派发后误以为必须立即发起高频状态轮询。

### 1.2 Architectural Forces & Constraints
- **Deep Modules & Minimal Seams**: 消息装配与传输层报头构造应当内聚在单一基础设施接缝背后，杜绝引导层维护平行的拼接分支。
- **Zero-Envelope & Zero-Preach**: 传输层客观报头只承载结构化元数据，正文原样保留，严禁在正文中注入主观催促话术。
- **Deterministic Convergence**: 明确分派、汇报与通知的三类交互收敛规则，彻底消除盲目轮询。

---

## 2. Decision Drivers

- Driver 1: 消除 `session_create` 初始消息与 `session_call` 报文结构的不对称性，赋予新会话天然的来源感知。
- Driver 2: 保持出参结构化 JSON 规范不被破坏，以极低成本为模型提供明确的会话收敛预期。
- Driver 3: 双语提示与状态文案完全对称，严禁内联硬编码语言分支。

---

## 3. Considered Options

### Option 1: 保持正文无报头，仅在公共黑板由 session:bootstrap 公告承载来源信息
- **Pros**: 无需调整现有消息对象组装逻辑。
- **Cons**: 新会话必须主动调用 `board_list` 检索自己的启动记录，增加额外推理轮次与 Token 消耗，且在高并发创建时存在竞态不确定性。

### Option 2: 在初始消息正文末尾拼接主观催促指令
- **Pros**: 形式简单直观。
- **Cons**: 破坏 Zero-Preach 原则，大段主观指令污染正文与模型注意力，容易诱发自动确认风暴。

### Option 3 (Chosen): 传输层报头对齐与出参客观收敛元信息追加
- **Pros**: 严格复用 `buildTransportPayload` 基础设施原语，首行注入发件人编号与 CallType 为 task_dispatch；语言包出参追加客观收敛说明，成本极低且彻底遏制盲目轮询。
- **Cons**: 需要更新涉及初始消息正文比对的历史单测断言。

---

## 4. Decision Outcome

**Chosen Option**: Option 3 — 传输层报头对齐与出参客观收敛元信息追加。

### 4.1 报头规约
当 `session_create` 传入有效 `initial_message` 时，统一通过 `buildNativeUserMessage` 与 `buildTransportPayload` 组装载荷：
1. 首行注入标准报头：`[From: <callerSessionId> (<callerTitle>) | CallType: task_dispatch]`
2. 若附带黑板条目引用，第二行追加：`> Context Ref: #post-xxx`
3. 报头与正文之间通过双换行符隔离，正文逐字保留。

### 4.2 出参规约
在 `lib/locales/zh.mjs` 与 `lib/locales/en.mjs` 的 `sessionCallSuccess` 与 `sessionCreateSuccess` 中追加客观收敛说明：
- `session_call(task_dispatch)`: 追加已派发任务等待目标回传，无需重复轮询。
- `session_call(task_report)`: 追加已完成收口汇报，无需回复。
- `session_call(notice)`: 追加单向通报阅后即止，无需回复。
- `session_create`: 若包含初始任务则追加初始任务已派发等待目标回传，未包含则提示就绪待命。

---

## 5. Consequences

### 5.1 Positive Consequences
- **协作闭环确定性**: 新建同级会话处理完任务后，可精准定位发件人并以单次 `task_report` 收口。
- **遏制无效轮询**: 调用方模型在派发任务后明确获得等待回传预期，避免发起无意义的 `session_query`。
- **原语高度复用**: 消除引导层与传输层的逻辑分支漂移。

### 5.2 Negative Consequences & Mitigations
- **历史测试断言更新**: 初始消息从裸正文变为带报头正文，需同步更新单元测试断言。

---

## 6. Compliance & Validation

- 单元测试：`tests/peer-bootstrap.test.mjs`、`tests/native-message-transport.test.mjs`、`tests/i18n.test.mjs`。
- 端到端测试：`tests/session-create.test.mjs`、`tests/session-call.test.mjs`。
- 架构完整性：`tests/adr-integrity.test.mjs` 保证全量 ADR 连续性。

---

## 7. Status History & Related Artifacts

- **2026-10-18**: Proposed & Accepted.
- **Related ADRs**:
  - Related to: ADR-0001, ADR-0006, ADR-0010, ADR-0016, ADR-0023, ADR-0025, ADR-0029, ADR-0031.
- **Implementation Artifacts**:
  - `lib/native-message-transport.mjs`
  - `lib/peer-bootstrap.mjs`
  - `lib/locales/zh.mjs`
  - `lib/locales/en.mjs`
  - `lib/session-create.mjs`
