# ADR-0025: Peer Session Creation Host Gateway, Safeguard Lease, and Bootstrap Decoupling

- **Status**: Accepted
- **Date**: 2026-09-23
- **Deciders**: Architect, Engineering Team, Core Contributors
- **Consulted**: Host Integration Engineers, Concurrency Maintainers, QA Reviewers
- **Informed**: All Plugin Users, Downstream Agents, Web Interface Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Problem Context
session_create 作为多智能体进程内协作的核心原语，负责根据调用方指令拉起独立的同级根会话（Peer Root Session）。随着代际熔断（ADR-0010）、模型动态继承（ADR-0015）、统一命名契约（ADR-0016）、标题事件持久化（ADR-0017）以及并发运行配额（ADR-0021）的引入，lib/session-create.mjs 膨胀为 923 行的过程式单体，暴露出显著的架构摩擦与接缝泄露：

1. **宿主侵入与脆弱探测 (Host Intrusion & Leaky Seam)**：
   PeerSessionFactory 直接侵入式探测 6 个 Cordis 宿主服务（agents、agentDefaultModel、sessionController、agentPresets、sessionTitle、workspaceRegistry），并在内存中直接修改私有会话对象的属性（session.header.title、session.header.cwd、session.metadata，甚至防御性规避 Object.isFrozen）。这导致单元测试需要构造复杂的嵌套 mock 对象，一旦宿主微调私有字段或冻结策略，插件面临崩溃风险。
2. **防护策略浅层暴露 (Shallow Safeguard Facade)**：
   滑动窗口限频（sessionCreationsMap）、在途并发防超发（inFlightCreationsByWorkspace）、工作区运行态配额（MAX_ACTIVE_PEER_SESSIONS）与代际深度熔断（MAX_GENERATION）散落为 8 个静态方法挂载在工厂类上。异常时依赖零散的手动 try/catch 进行时间戳回滚，缺乏原子租约事务保障，存在配额泄漏隐患。
3. **初始启动消息与黑板通知耦合 (Entangled Bootstrap)**：
   会话创建完成后的初始指令清洗、上下文引用包装（#post-xxx）、插件消息摘要截断（120 字符限制）与公共黑板引导公告（session:bootstrap）直接内联在工厂流程中，导致工厂强依赖底层通信与存储模块。

### 1.2 Architectural Forces & Constraints
- **Deep Modules & Leverage**：遵循 codebase-design 原则，深层模块应当拥有狭窄的高杠杆接口，隐藏复杂的降级与适配细节。
- **Zero-Trace Host Boundaries**：与 DSH 宿主的交互必须收敛在单一接缝适配器内，严禁业务层直接侵入修改宿主内部私有结构。
- **Atomic Concurrency Guarantee**：配额预留、限频锁定与资源占用必须具备原子租约语义，异常时必须无损回滚。
- **100% Backward Compatibility**：保持所有既有导出方法、类契约、错误码与 TypeScript 类型定义 100% 兼容。

---

## 2. Decision Drivers

- **Driver 1 (Hermetic Host Seam)**：将 6 项宿主服务探测、属性修补与事件写入收敛至独立的宿主网关，使核心业务无需感知 Cordis 服务拓扑。
- **Driver 2 (Transactional Admission Lease)**：以租约模式封装准入防护，保证在途锁定与滑动窗口限频在创建失败时自动原子回滚。
- **Driver 3 (Separation of Bootstrap Concerns)**：将消息格式化与公共黑板公告解耦至独立的生命周期协同器。
- **Driver 4 (Radical Simplification)**：将 session-create.mjs 从 920+ 行单体精简为轻量级组合协调器。

---

## 3. Considered Options

### Option 1: 维持 920 行单体，仅增加注释与补丁
- **Pros**: 无新增模块文件。
- **Cons**: 宿主侵入点分散在各处；测试 mock 成本居高不下；配额与频次回滚依然脆弱。

### Option 2: 拆分子模块但保留直接属性篡改
- **Pros**: 拆散代码行数。
- **Cons**: 依然没有解决宿主越界与脆弱对象修改问题，接缝依然泄漏。

### Option 3 (Chosen): 三大支柱深层模块解耦 + 原子租约模式 + 组合编排
- **Pros**:
  - DshHostGateway 提供清晰的宿主接缝与防御屏障；
  - SessionSafeguard 提供原子性租约（AdmissionLease）；
  - PeerBootstrapper 隔离初始消息与黑板协同；
  - lib/session-create.mjs 代码量大幅下降 ~65%，职责聚焦于纯粹的流程编排。

---

## 4. Decision Outcome

### 4.1 三大架构支柱

#### 支柱 1：DshHostGateway 宿主网关层 (lib/dsh-host-gateway.mjs)
- 封装 6 项 Cordis 服务探测（agents、agentDefaultModel、sessionController、agentPresets、sessionTitle、workspaceRegistry）。
- 封装 resolveEffectiveModel（支持调用方运行时请求头、静态选项及宿主默认配置三级级联回退）与 resolvePresetSetup（组合预设与 setup 链）。
- 封装 createRootAgent：安全处理深冻结对象（Object.isFrozen）、元数据清洗（剔除 parentSession/origin）与归属关联。
- 封装 appendTitleEvent（优先复用 sessionTitle.rename，回退安全追加 session/title 事件）与 attachWorkspace。
- 交付单元测试：tests/dsh-host-gateway.test.mjs。

#### 支柱 2：SessionSafeguard 会话准入防护守卫 (lib/session-safeguard.mjs)
- 集中收敛滑动窗口限频（5 次/min）、工作区并发运行配额（5 个）、在途并发防超发与代际深度熔断（<= 2 代）。
- 引入原子租约 AdmissionLease：通过 safeguard.admit() 乐观锁定配额与在途标题；创建成功后调用 lease.commit()，异常时调用 lease.release() 自动无损回滚。
- 交付单元测试：tests/session-safeguard.test.mjs。

#### 支柱 3：PeerBootstrapper 平级会话启动协同器 (lib/peer-bootstrap.mjs)
- 封装初始消息装配：formatInitialMessage（清洗换行符、首行提取、上下文引用 > Context Ref: #post-xxx 注入、120 字符摘要生成及标准 UserMessage 装配）。
- 封装消息派发：dispatchInitialMessage（安全调用 dispatchNativeMessage 并确定运行态）。
- 封装引导公告：publishBootstrapNotice（向公共黑板安全发布 session:bootstrap，设定 1 小时 TTL 与溯源元数据）。
- 交付单元测试：tests/peer-bootstrap.test.mjs。

#### 支柱 4：PeerSessionFactory 组合化重构 (lib/session-create.mjs)
- 工厂类由 923 行过程式代码重构为高内聚协调器（~340 行），通过构造函数组合网关、守卫与协同器。
- 对外完整保留全部既有静态方法与导出函数，确保 100% 平滑过渡与向后兼容。

---

## 5. Invariants & Guardrails

- **不变量 1 (Host Seam Purity)**：任何跨插件与宿主 Cordis 服务的交互必须经由 DshHostGateway，严禁业务代码直接穿透修改宿主对象。
- **不变量 2 (Atomic Lease Consistency)**：所有会话创建流程必须持有 AdmissionLease，创建异常时必须在 catch 块中执行 lease.release()。
- **不变量 3 (Quota Integrity)**：单工作区并发运行根会话上限严格受控于 5，在途创建严格纳入并发计算。
- **不变量 4 (Zero-Trace Blackboard Hygiene)**：会话就绪公告必须具备确定性过期机制，生命周期结束或测试执行前后必须无残留。

---

## 6. Consequences & Verification

### Positive
- **高内聚低耦合**：核心模块职责明确，行数下降 ~65%，模块深度与杠杆率显著提升。
- **测试隔离与可测性**：宿主网关、准入守卫与启动协同器均具备独立纯单元测试，摆脱复杂的集成 mock 依赖。
- **事务性安全**：原子租约杜绝了创建失败时的频次与在途配额泄漏。

### Negative / Tradeoffs
- 新增了 3 个物理子模块文件，增加了极轻微的模块导入开销（在 V8 启动阶段耗时 < 1ms，在预算之内）。

### Verification Criteria
- 单元与集成测试全量通过：全仓 338 项测试通过率 100%（npm test）。
- 类型检查与代码规范门禁 100% 通过（npm run verify 与 npm run typecheck）。
