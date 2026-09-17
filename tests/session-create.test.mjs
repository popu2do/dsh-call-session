import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCreate,
  resolvePeerTitle,
  resetRateLimits,
  checkRateLimit,
  inspectWorkspaceActiveSessions,
  resolveDefaultModelSelection,
  resolveCallerAgentOptions,
  resolvePeerAgentOptions,
  resolvePeerPresetAndSetup,
  PEER_SESSION_CONSTANTS
} from '../lib/session-create.mjs';

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Agent',
  cwd = 'c:/workspace/project-alpha',
  generation = 0,
  options = {},
  steerFn = null,
  followupFn = null
} = {}) {
  const received = [];
  const agent = {
    id,
    status,
    title,
    generation,
    options: { ...options },
    agentOptions: { ...options },
    session: {
      id,
      title,
      header: { cwd, title },
      cwd,
      metadata: { generation },
      events: [],
      append(type, data) {
        const ev = { type, data, seq: this.events.length, time: Date.now() };
        this.events.push(ev);
        return ev;
      }
    },
    steer: steerFn || ((msg) => {
      agent.status = 'running';
      received.push({ type: 'steer', msg });
    }),
    followup: followupFn || ((msg) => {
      agent.status = 'running';
      received.push({ type: 'followup', msg });
    }),
    received
  };
  return agent;
}

function createMockCtx({
  agentsList = [],
  archivedIds = [],
  logger = null,
  boardStore = null,
  agentDefaultModel = null,
  agentPresets = null,
  sessionController = null,
  sessionTitle = null
} = {}) {
  const archivedSet = new Set(archivedIds);
  const createdAgents = [];
  const createPayloads = [];

  const agentsSvc = {
    list: () => [...agentsList, ...createdAgents],
    get: (id) => [...agentsList, ...createdAgents].find(a => a.id === id),
    create: async (options) => {
      createPayloads.push(options);
      const id = options.sessionId || `session-mock-${Math.random().toString(36).slice(2, 8)}`;
      const agent = createMockAgent(id, {
        title: options.title || options.meta?.title || '',
        cwd: options.cwd || options.meta?.cwd || 'c:/workspace/project-alpha',
        generation: options.meta?.generation || 1,
        options: options.agentOptions || {}
      });
      if (typeof options.setup === 'function') {
        await options.setup({ agent });
      }
      createdAgents.push(agent);
      return { agent };
    }
  };

  const mockCtx = {
    logger: () => ({
      debug() {},
      info() {},
      warn() {},
      error() {}
    }),
    agentDefaultModel,
    agentPresets,
    sessionController,
    sessionTitle,
    get(name) {
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: archivedSet };
      }
      if (name === 'sessionTitle') {
        return sessionTitle || {
          get: (s) => ({ title: s?.title || s?.header?.title || '' })
        };
      }
      if (name === 'agents') return agentsSvc;
      if (name === 'agentDefaultModel') return agentDefaultModel;
      if (name === 'agentPresets') return agentPresets;
      if (name === 'sessionController') return sessionController;
      return undefined;
    },
    agents: agentsSvc,
    root: {
      get: (name) => {
        if (name === 'agents') return agentsSvc;
        if (name === 'agentDefaultModel') return agentDefaultModel;
        if (name === 'agentPresets') return agentPresets;
        if (name === 'sessionController') return sessionController;
        return undefined;
      },
      agents: agentsSvc,
      agentDefaultModel,
      agentPresets,
      sessionController
    },
    boardStore,
    _createdAgents: createdAgents,
    _createPayloads: createPayloads
  };

  return mockCtx;
}

function createMockBoardStore() {
  const posts = [];
  return {
    post(entry) {
      posts.push(entry);
      return entry;
    },
    posts
  };
}

test('PEER_SESSION_CONSTANTS: 常量定义完整性', () => {
  assert.equal(PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS, 5);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_CONCURRENT_RUNNING_PEER_SESSIONS, 5);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE, 5);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_GENERATION, 2);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH, 60);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_INITIAL_MESSAGE_LENGTH, 4000);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_CONTEXT_POST_IDS, 5);
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('[SYSTEM] Test'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('[CAPTAIN] Worker'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('[ROOT] Daemon'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('[ADMIN] Auditor'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('admin: Auditor'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('system: Core'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('root: Daemon'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('captain: Leader'));
});

test('executeSessionCreate: 参数基本校验（空对象/非法数据类型/超长字符串）', async () => {
  const caller = createMockAgent('caller-root');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  // 1. 空参数校验
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: null, exec }),
    /参数必须为对象/
  );

  // 2. title 类型与长度拦截
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: { title: 12345 }, exec }),
    /title 必须为字符串/
  );
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: { title: 'a'.repeat(61) }, exec }),
    /title 超过最大长度限制/
  );

  // 3. initial_message 类型与长度拦截
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: { initial_message: 999 }, exec }),
    /initial_message 必须为字符串/
  );
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: { initial_message: 'x'.repeat(4001) }, exec }),
    /initial_message 超过最大长度限制/
  );

  // 4. context_post_ids 必须为数组
  await assert.rejects(
    () => executeSessionCreate({ ctx, args: { context_post_ids: 'not-an-array' }, exec }),
    /context_post_ids 必须为数组/
  );
});

test('executeSessionCreate: 标题推导与特权沙箱过滤', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-root');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  // 1. 显式传入合法标题
  const res1 = await executeSessionCreate({
    ctx,
    args: { title: 'Code Refactor Worker', initial_message: 'Do refactor' },
    exec
  });
  assert.equal(res1.title, 'Code Refactor Worker');

  // 2. 特权前缀 [SYSTEM] / [CAPTAIN] / [ROOT] 过滤
  const resSys = await executeSessionCreate({
    ctx,
    args: { title: '[SYSTEM] Core Optimizer', initial_message: 'Optimize' },
    exec
  });
  assert.equal(resSys.title, 'Core Optimizer');

  const resCap = await executeSessionCreate({
    ctx,
    args: { title: '[CAPTAIN] Task Dispatcher', initial_message: 'Dispatch' },
    exec
  });
  assert.equal(resCap.title, 'Task Dispatcher');

  const resAdminColon = await executeSessionCreate({
    ctx,
    args: { title: 'admin: Secret Auditor', initial_message: 'Audit' },
    exec
  });
  assert.equal(resAdminColon.title, 'Secret Auditor');

  const resAdminBracket = await executeSessionCreate({
    ctx,
    args: { title: '[ADMIN] Super Worker', initial_message: 'Work' },
    exec
  });
  assert.equal(resAdminBracket.title, 'Super Worker');

  // 3. 仅传 [SYSTEM] 特权前缀，过滤后变为空，回退推导
  resetRateLimits();
  ctx._createdAgents.forEach(a => { a.status = 'idle'; });
  const resOnlySys = await executeSessionCreate({
    ctx,
    args: { title: '[SYSTEM]', initial_message: 'Analyze memory leak' },
    exec
  });
  assert.equal(resOnlySys.title, 'Peer: Analyze memory leak');

  // 4. 未传标题，从 initial_message 提取 40 字符并格式化为 Peer: <Summary>
  const resDerived = await executeSessionCreate({
    ctx,
    args: { initial_message: '### Implement OAuth2 token refresh pipeline for auth service' },
    exec
  });
  assert.ok(resDerived.title.startsWith('Peer: Implement OAuth2 token refresh pipeline'));
  assert.ok(resDerived.title.length <= 60);

  // 5. 标题与 initial_message 均未传，采用默认编号命名 Peer-<id>
  resetRateLimits();
  const resDefault = await executeSessionCreate({
    ctx,
    args: {},
    exec
  });
  assert.ok(/^Peer-[a-zA-Z0-9_-]{8}$/.test(resDefault.title));
});

test('executeSessionCreate: 工作区防重名拦截 ([DuplicateTitle])', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-root');
  const existing = createMockAgent('peer-existing', { title: 'Existing Worker' });
  const ctx = createMockCtx({ agentsList: [caller, existing] });
  const exec = { agent: caller };

  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Existing Worker', initial_message: 'Work' },
      exec
    }),
    /\[DuplicateTitle\]/
  );
});

test('executeSessionCreate: 工作区并发运行配额拦截 (5 个并发运行会话上限)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-root', { status: 'running' });
  // 创建 4 个同工作区运行中会话，加上 caller 共 5 个 running 状态
  const activeSessions = [caller];
  for (let i = 1; i <= 4; i++) {
    activeSessions.push(createMockAgent(`active-${i}`, {
      title: `Worker ${i}`,
      cwd: 'c:/workspace/project-alpha',
      status: 'running'
    }));
  }

  const ctx = createMockCtx({ agentsList: activeSessions });
  const exec = { agent: caller };

  // 已有 5 个运行中会话，新建应被配额拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Exceeded Worker', initial_message: 'Should fail' },
      exec
    }),
    /\[QuotaExceeded\]/
  );
});

test('executeSessionCreate: 存在 10 个空闲（idle）会话时不触发配额拦截', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-root', { status: 'running' });
  // 注入 10 个空闲（idle）会话
  const idleSessions = [caller];
  for (let i = 1; i <= 10; i++) {
    idleSessions.push(createMockAgent(`idle-${i}`, {
      title: `Idle Worker ${i}`,
      cwd: 'c:/workspace/project-alpha',
      status: 'idle'
    }));
  }

  const ctx = createMockCtx({ agentsList: idleSessions });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Allowed Worker' },
    exec
  });
  assert.equal(res.success, true);
});

test('executeSessionCreate: 工作区隔离（跨工程会话不占用配额，继承调用方 cwd）', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-alpha', { cwd: 'c:/workspace/project-alpha' });
  // 15 个属于 project-beta 的会话
  const betaSessions = [];
  for (let i = 1; i <= 15; i++) {
    betaSessions.push(createMockAgent(`beta-${i}`, {
      title: `Beta Worker ${i}`,
      cwd: 'c:/workspace/project-beta'
    }));
  }

  const ctx = createMockCtx({ agentsList: [caller, ...betaSessions] });
  const exec = { agent: caller };

  // 跨工程会话不占用 alpha 配额，应该成功创建
  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Alpha Peer Worker', initial_message: 'Start task' },
    exec
  });

  assert.equal(res.success, true);
  assert.equal(res.workspace, 'c:/workspace/project-alpha');
  assert.equal(res.title, 'Alpha Peer Worker');
});

test('executeSessionCreate: 衍生代际深度限制 (Generation <= 2)', async () => {
  resetRateLimits();
  // 1. Root 会话 (Gen 0) -> 创建 Gen 1
  const rootAgent = createMockAgent('root-session', { generation: 0 });
  const ctx = createMockCtx({ agentsList: [rootAgent] });

  const gen1Result = await executeSessionCreate({
    ctx,
    args: { title: 'Gen 1 Worker', initial_message: 'task 1' },
    exec: { agent: rootAgent }
  });
  assert.equal(gen1Result.generation, 1);

  // 2. Gen 1 会话 -> 创建 Gen 2
  const gen1Agent = createMockAgent('gen1-session', { generation: 1 });
  const gen2Result = await executeSessionCreate({
    ctx,
    args: { title: 'Gen 2 Worker', initial_message: 'task 2' },
    exec: { agent: gen1Agent }
  });
  assert.equal(gen2Result.generation, 2);

  // 3. Gen 2 会话 -> 尝试创建 Gen 3，触发代际熔断拦截
  const gen2Agent = createMockAgent('gen2-session', { generation: 2 });
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Gen 3 Worker', initial_message: 'task 3' },
      exec: { agent: gen2Agent }
    }),
    /\[GenerationLimitExceeded\]/
  );
});

test('executeSessionCreate: 单会话限频拦截 (5 次/分钟)', async () => {
  resetRateLimits();
  const caller = createMockAgent('frequent-caller');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  // 连续创建 5 次正常通过
  for (let i = 1; i <= 5; i++) {
    await executeSessionCreate({
      ctx,
      args: { title: `Rate Limit Test ${i}` },
      exec
    });
  }

  // 第 6 次应被限频拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Rate Limit Test 6' },
      exec
    }),
    /\[RateLimitExceeded\]/
  );
  resetRateLimits();
});

test('executeSessionCreate: 初始消息分发与 Context Post 关联', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-ignite');
  const boardStore = createMockBoardStore();
  const ctx = createMockCtx({ agentsList: [caller], boardStore });
  const exec = { agent: caller };

  const result = await executeSessionCreate({
    ctx,
    args: {
      title: 'Ignition Worker',
      initial_message: 'Please process the dataset',
      context_post_ids: ['post-1001', 'post-1002']
    },
    exec,
    boardStore
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'running');
  assert.ok(result.sessionId);
  assert.ok(result.bootstrapPostId);

  // 验证目标 agent 收到初始启动消息
  const created = ctx._createdAgents.find(a => a.id === result.sessionId);
  assert.ok(created);
  assert.equal(created.received.length, 1);
  const msg = created.received[0].msg;
  assert.equal(msg.role, 'user');
  assert.ok(msg.content[0].text.includes('> Context Ref: #post-1001, #post-1002'));
  assert.ok(msg.content[0].text.includes('Please process the dataset'));
  assert.equal(msg.source.kind, 'plugin');
  assert.equal(msg.source.plugin, 'dsh-call-session');
  assert.equal(msg.source.form, 'session_create');

  // 验证黑板就绪广播
  assert.equal(boardStore.posts.length, 1);
  assert.equal(boardStore.posts[0].topic, 'session:bootstrap');
  assert.ok(boardStore.posts[0].tags.includes('bootstrap'));
});

test('executeSessionCreate: 未传 initial_message 保持 idle 待命状态', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-idle');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  const result = await executeSessionCreate({
    ctx,
    args: { title: 'Standby Worker' },
    exec
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'idle');
  assert.equal(result.title, 'Standby Worker');

  const created = ctx._createdAgents.find(a => a.id === result.sessionId);
  assert.ok(created);
  assert.equal(created.received.length, 0); // 未接收初始消息
});

test('executeSessionCreate: 支持对象签名与位置参数签名', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-sig');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  // 1. 对象签名 executeSessionCreate({ ctx, args, exec })
  const resObj = await executeSessionCreate({
    ctx,
    args: { title: 'Sig Obj Worker' },
    exec
  });
  assert.equal(resObj.success, true);

  // 2. 位置参数签名 executeSessionCreate(ctx, args, exec)
  const resPos = await executeSessionCreate(
    ctx,
    { title: 'Sig Pos Worker' },
    exec
  );
  assert.equal(resPos.success, true);
});

test('executeSessionCreate: 宿主 SessionController 契约与冻结 SessionHeader 测试', async () => {
  resetRateLimits();
  let capturedCreatePayload = null;

  // 模拟真实宿主行为：严格执行 SessionHeader 规范校验
  const realHostAgentsSvc = {
    list: () => [],
    get: () => undefined,
    create: async (payload) => {
      capturedCreatePayload = payload;
      // 真实宿主底层强校验：如果 meta 含有非 'subagent' 的 origin，抛出 DSH 官方异常
      if (payload.meta?.origin !== undefined && payload.meta?.origin !== 'subagent') {
        throw new Error('session header origin must be "subagent"');
      }

      // 真实宿主底层构造冻结的 SessionHeader
      const header = Object.freeze({
        version: 0,
        id: payload.sessionId,
        createdAt: Date.now(),
        cwd: payload.meta?.cwd,
        isSeeded: false
      });

      const mockRealAgent = {
        id: payload.sessionId,
        title: payload.title,
        status: 'idle',
        session: {
          id: payload.sessionId,
          header,
          get cwd() { return header.cwd; }
        },
        followup: () => {},
        steer: () => {}
      };

      return { agent: mockRealAgent };
    }
  };

  const mockCtx = {
    root: { agents: realHostAgentsSvc },
    agents: realHostAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? realHostAgentsSvc : undefined)
  };

  const res = await executeSessionCreate(mockCtx, {
    title: 'Minimal Contract Worker',
    initial_message: 'Verify DSH Host Contract'
  }, { agent: createMockAgent('caller-root') });

  assert.equal(res.success, true);
  assert.equal(res.title, 'Minimal Contract Worker');

  // 验证传给底层 agentsService.create 的契约：
  assert.ok(capturedCreatePayload);
  assert.equal(capturedCreatePayload.header, undefined, 'createPayload 不包含 header 字段');
  assert.equal(capturedCreatePayload.meta.origin, undefined, 'meta.origin 保持为 undefined');
  assert.equal(capturedCreatePayload.meta.parentSession, undefined, '平级独立会话不可携带 parentSession');
});

test('inspectWorkspaceActiveSessions: 准确识别真实宿主下 session.header.origin 为 subagent 的子代理', () => {
  const rootAgent = createMockAgent('root-session', { cwd: 'c:/workspace/app', status: 'running' });

  // 真实宿主生成的子代理：agent 属性本身无 origin，但 session.header.origin === 'subagent'
  const subagentWithHeader = {
    id: 'subagent-1',
    status: 'idle',
    session: {
      id: 'subagent-1',
      header: Object.freeze({
        version: 0,
        id: 'subagent-1',
        origin: 'subagent',
        parentSession: 'root-session',
        cwd: 'c:/workspace/app'
      })
    }
  };

  const agentsSvc = {
    list: () => [rootAgent, subagentWithHeader]
  };

  const { count, activeTitles } = inspectWorkspaceActiveSessions(
    agentsSvc,
    'c:/workspace/app',
    new Set(),
    {}
  );

  // subagent 必须被过滤排除，只有 rootAgent 计入
  assert.equal(count, 1, '子代理被过滤排除，活跃会话计数为 1');
  assert.ok(activeTitles.has(rootAgent.title.toLowerCase()));
});

test('executeSessionCreate: 参数校验与配额失败不消耗限频配额', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-rate-check', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };
  const ctx = createMockCtx();

  // 连续发起 10 次非法参数请求（例如 title 类型错误）
  for (let i = 0; i < 10; i++) {
    await assert.rejects(
      async () => {
        await executeSessionCreate({
          ctx,
          args: { title: 12345 },
          exec
        });
      },
      /session_create: title 必须为字符串/
    );
  }

  // 发起一次合法创建请求，应当顺利通过，证明此前失败未消耗限频
  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Valid Worker' },
    exec
  });
  assert.equal(res.success, true);
  assert.equal(res.title, 'Valid Worker');
});

test('resolvePeerTitle: 特权前缀全量清洗与身份伪造防范 (ADR-0010)', () => {
  assert.equal(resolvePeerTitle({ title: 'admin: database_migrator' }), 'database_migrator');
  assert.equal(resolvePeerTitle({ title: 'system: worker_node' }), 'worker_node');
  assert.equal(resolvePeerTitle({ title: '[ADMIN] supervisor' }), 'supervisor');
  assert.equal(resolvePeerTitle({ title: '[SYSTEM] daemon' }), 'daemon');
  assert.equal(resolvePeerTitle({ title: 'root: worker' }), 'worker');
  assert.equal(resolvePeerTitle({ title: 'captain: leader' }), 'leader');
  assert.equal(resolvePeerTitle({ title: '[CAPTAIN] chief' }), 'chief');
  assert.equal(resolvePeerTitle({ title: '[ROOT] superuser' }), 'superuser');
});

test('executeSessionCreate: 在途创建登记防范并发请求突破上限 (ADR-0010)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-toctou', { cwd: 'c:/workspace/app', status: 'running' });
  const exec = { agent: caller };

  // 现有 4 个运行中会话 (caller + 3 peers)
  const existingAgents = [caller];
  for (let i = 1; i <= 3; i++) {
    existingAgents.push(createMockAgent(`peer-${i}`, { cwd: 'c:/workspace/app', title: `Peer ${i}`, status: 'running' }));
  }

  // 模拟慢速创建，延迟 30ms 返回
  const slowAgentsSvc = {
    list: () => existingAgents,
    get: (id) => existingAgents.find(a => a.id === id),
    create: async (payload) => {
      await new Promise(r => setTimeout(r, 30));
      const newAgent = createMockAgent(payload.sessionId, { cwd: payload.cwd, title: payload.title, status: 'running' });
      existingAgents.push(newAgent);
      return { agent: newAgent };
    }
  };

  const ctx = {
    root: { agents: slowAgentsSvc },
    agents: slowAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? slowAgentsSvc : undefined)
  };

  // 同时并发发起两个创建请求：总数 4 + 2 = 6 > 5，第二个并发请求必须被 QuotaExceeded 拒绝
  const [res1, res2] = await Promise.allSettled([
    executeSessionCreate({ ctx, args: { title: 'Concurrent Worker 1' }, exec }),
    executeSessionCreate({ ctx, args: { title: 'Concurrent Worker 2' }, exec })
  ]);

  const fulfilled = [res1, res2].filter(r => r.status === 'fulfilled');
  const rejected = [res1, res2].filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, '只能有一个创建成功');
  assert.equal(rejected.length, 1, '第二个并发请求必须因配额超限失败');
  assert.match(rejected[0].reason.message, /\[QuotaExceeded\]/);
});

test('executeSessionCreate: 底层 agentsService.create 抛错时不扣除限频配额', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-b3', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  let failCount = 0;
  const failingAgentsSvc = {
    list: () => [caller],
    get: () => undefined,
    create: async () => {
      failCount++;
      throw new Error('Host system internal error: disk full');
    }
  };

  const ctx = {
    root: { agents: failingAgentsSvc },
    agents: failingAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? failingAgentsSvc : undefined)
  };

  // 连续让底层抛错 6 次（超过每分钟 5 次的限频阈值）
  for (let i = 0; i < 6; i++) {
    await assert.rejects(
      async () => {
        await executeSessionCreate({
          ctx,
          args: { title: `Retry Worker ${i}` },
          exec
        });
      },
      /Host system internal error/
    );
  }
  assert.equal(failCount, 6);

  // 恢复底层服务成功创建
  failingAgentsSvc.create = async (payload) => {
    const successAgent = createMockAgent(payload.sessionId, { cwd: payload.cwd, title: payload.title });
    return { agent: successAgent };
  };

  // 第 7 次调用应当正常成功，证明前 6 次底层抛错完全没有消耗限频配额
  const successRes = await executeSessionCreate({
    ctx,
    args: { title: 'Eventual Worker' },
    exec
  });
  assert.equal(successRes.success, true);
  assert.equal(successRes.title, 'Eventual Worker');
});

test('executeSessionCreate: 乐观预留与失败回滚保障 6 请求限频拦截 (ADR-0010 Invariant 3)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-concurrent-rate', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  const fastAgentsSvc = {
    list: () => [caller],
    get: () => undefined,
    create: async (payload) => {
      return { agent: createMockAgent(payload.sessionId, { cwd: payload.cwd, title: payload.title }) };
    }
  };

  const ctx = {
    root: { agents: fastAgentsSvc },
    agents: fastAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? fastAgentsSvc : undefined)
  };

  // 同一 caller 连续发起 5 个创建请求，全部成功
  for (let i = 1; i <= 5; i++) {
    const res = await executeSessionCreate({
      ctx,
      args: { title: `Rate Worker ${i}` },
      exec
    });
    assert.equal(res.success, true);
  }

  // 第 6 个请求必须被限频机制拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Rate Worker 6' },
      exec
    }),
    /\[RateLimitExceeded\]/
  );
});

test('resolveCallerAgentOptions: 正确解析 callerAgent.options 与 requestHeader 动态配置', () => {
  // 1. 标准 callerAgent.options 包含 provider、model 与 reasoningEffort
  const caller1 = {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high',
      reasoningEffort: 'high',
      customFlag: true
    }
  };
  const res1 = resolveCallerAgentOptions(caller1);
  assert.equal(res1.provider, 'easy-cliproxyapi-vision');
  assert.equal(res1.model, 'gemini-3.8-flash-high');
  assert.equal(res1.reasoningEffort, 'high');
  assert.equal(res1.customFlag, true);

  // 2. 回退 agentOptions 与 session.agentOptions
  const caller2 = {
    agentOptions: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet'
    }
  };
  const res2 = resolveCallerAgentOptions(caller2);
  assert.equal(res2.provider, 'anthropic');
  assert.equal(res2.model, 'claude-3-5-sonnet');

  const caller3 = {
    session: {
      agentOptions: {
        provider: 'openai',
        model: 'gpt-4o'
      }
    }
  };
  const res3 = resolveCallerAgentOptions(caller3);
  assert.equal(res3.provider, 'openai');
  assert.equal(res3.model, 'gpt-4o');

  // 3. requestHeader().config 覆盖最新运行配置
  const caller4 = {
    options: {
      provider: 'old-p',
      model: 'old-m'
    },
    session: {
      requestHeader: () => ({
        config: {
          provider: 'updated-p',
          model: 'updated-m',
          reasoningEffort: 'low'
        }
      })
    }
  };
  const res4 = resolveCallerAgentOptions(caller4);
  assert.equal(res4.provider, 'updated-p');
  assert.equal(res4.model, 'updated-m');
  assert.equal(res4.reasoningEffort, 'low');

  // 4. 空 caller 返回空对象
  assert.deepEqual(resolveCallerAgentOptions(null), {});
  assert.deepEqual(resolveCallerAgentOptions(undefined), {});
});

test('resolveDefaultModelSelection: 正确从 ctx.agentDefaultModel 提取默认模型配置', () => {
  // 1. currentSelection() 方法提取
  const ctx1 = {
    agentDefaultModel: {
      currentSelection: () => ({
        provider: 'default-prov',
        model: 'gemini-3.8-flash-high',
        reasoningEffort: 'high'
      })
    }
  };
  const sel1 = resolveDefaultModelSelection(ctx1);
  assert.equal(sel1.provider, 'default-prov');
  assert.equal(sel1.model, 'gemini-3.8-flash-high');
  assert.equal(sel1.reasoningEffort, 'high');

  // 2. ctx.get('agentDefaultModel') 或 root 访问
  const ctx2 = {
    get: (name) => (name === 'agentDefaultModel' ? {
      current: { provider: 'root-prov', model: 'default-m' }
    } : undefined)
  };
  const sel2 = resolveDefaultModelSelection(ctx2);
  assert.equal(sel2.provider, 'root-prov');
  assert.equal(sel2.model, 'default-m');

  // 3. ctx 无 agentDefaultModel 时安全返回空对象
  assert.deepEqual(resolveDefaultModelSelection({}), {});
  assert.deepEqual(resolveDefaultModelSelection(null), {});
});

test('resolvePeerAgentOptions: callerAgent.options 继承 (gemini-3.8-flash-high 与 reasoningEffort)', () => {
  // 核心 Bug 场景验证：调用方运行 gemini-3.8-flash-high，未显式覆写 model 时必须完整继承
  const callerAgent = {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high',
      reasoningEffort: 'high'
    }
  };

  const options = resolvePeerAgentOptions({
    callerAgent,
    model: undefined
  });

  assert.equal(options.provider, 'easy-cliproxyapi-vision');
  assert.equal(options.model, 'gemini-3.8-flash-high');
  assert.equal(options.reasoningEffort, 'high');
  assert.ok(options.model, '确保 model 变量有值，防止 prompt 模板渲染 {{model}} 崩溃');
});

test('resolvePeerAgentOptions: ctx.agentDefaultModel 回退逻辑', () => {
  // 调用方无 options 时，回退到 ctx.agentDefaultModel
  const ctx = {
    agentDefaultModel: {
      currentSelection: () => ({
        provider: 'fallback-provider',
        model: 'fallback-model',
        reasoningEffort: 'low'
      })
    }
  };

  const options = resolvePeerAgentOptions({
    ctx,
    callerAgent: null,
    model: undefined
  });

  assert.equal(options.provider, 'fallback-provider');
  assert.equal(options.model, 'fallback-model');
  assert.equal(options.reasoningEffort, 'low');
});

test('resolvePeerAgentOptions: callerAgent 优先级高于 ctx.agentDefaultModel', () => {
  const ctx = {
    agentDefaultModel: {
      currentSelection: () => ({
        provider: 'default-provider',
        model: 'default-model',
        reasoningEffort: 'low'
      })
    }
  };
  const callerAgent = {
    options: {
      provider: 'caller-provider',
      model: 'caller-model',
      reasoningEffort: 'high'
    }
  };

  const options = resolvePeerAgentOptions({
    ctx,
    callerAgent,
    model: undefined
  });

  assert.equal(options.provider, 'caller-provider');
  assert.equal(options.model, 'caller-model');
  assert.equal(options.reasoningEffort, 'high');
});

test('resolvePeerAgentOptions: args.model 模型覆写与推理强度生命周期', () => {
  const callerAgent = {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high',
      reasoningEffort: 'high'
    }
  };

  // 1. 覆写为不同模型且未指定 effort：继承 provider，重置 reasoningEffort（避免不兼容模型报错）
  const opt1 = resolvePeerAgentOptions({
    callerAgent,
    model: 'claude-3-5-sonnet'
  });
  assert.equal(opt1.provider, 'easy-cliproxyapi-vision');
  assert.equal(opt1.model, 'claude-3-5-sonnet');
  assert.equal(opt1.reasoningEffort, undefined);

  // 2. 显式覆写同名模型：保留原有 reasoningEffort
  const opt2 = resolvePeerAgentOptions({
    callerAgent,
    model: 'gemini-3.8-flash-high'
  });
  assert.equal(opt2.provider, 'easy-cliproxyapi-vision');
  assert.equal(opt2.model, 'gemini-3.8-flash-high');
  assert.equal(opt2.reasoningEffort, 'high');

  // 3. 显式提供 reasoningEffort：无论模型是否变更均生效
  const opt3 = resolvePeerAgentOptions({
    callerAgent,
    model: 'o3-mini',
    reasoningEffort: 'medium'
  });
  assert.equal(opt3.provider, 'easy-cliproxyapi-vision');
  assert.equal(opt3.model, 'o3-mini');
  assert.equal(opt3.reasoningEffort, 'medium');
});

test('resolvePeerAgentOptions: args.model 支持 provider/model 与 provider:model 格式解析', () => {
  const callerAgent = {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high'
    }
  };

  // 1. 斜杠格式 provider/model
  const optSlash = resolvePeerAgentOptions({
    callerAgent,
    model: 'anthropic/claude-3-opus'
  });
  assert.equal(optSlash.provider, 'anthropic');
  assert.equal(optSlash.model, 'claude-3-opus');

  // 2. 冒号格式 provider:model
  const optColon = resolvePeerAgentOptions({
    callerAgent,
    model: 'openai:gpt-4o-mini'
  });
  assert.equal(optColon.provider, 'openai');
  assert.equal(optColon.model, 'gpt-4o-mini');
});

test('resolvePeerPresetAndSetup: 预设解析与 sessionController/agentPresets setup 钩子挂载', async () => {
  // 1. sessionController.agents.composeAgent 存在时
  let installSelectionCalled = false;
  let presetsMountCalled = false;
  let mountedPresetId = null;

  const mockSessionController = {
    agents: {
      composeAgent: async (presetId) => ({
        agentPreset: presetId || 'coding-v1',
        setup: async (agentCtx) => {
          installSelectionCalled = true;
          mountedPresetId = presetId || 'coding-v1';
          presetsMountCalled = true;
        }
      })
    }
  };

  const callerWithPreset = {
    session: {
      metadata: { agentPreset: 'engineer-preset' }
    }
  };

  const { presetId, setup } = await resolvePeerPresetAndSetup({
    ctx: { sessionController: mockSessionController },
    callerAgent: callerWithPreset
  });

  assert.equal(presetId, 'engineer-preset');
  assert.ok(typeof setup === 'function');

  await setup({ agent: { id: 'test' } });
  assert.equal(installSelectionCalled, true);
  assert.equal(presetsMountCalled, true);
  assert.equal(mountedPresetId, 'engineer-preset');

  // 2. 仅 agentPresets 存在时
  let directMountCalled = false;
  const mockAgentPresets = {
    resolve: async (id) => ({ id: id || 'default-preset' }),
    mount: async (agentCtx, id) => {
      directMountCalled = true;
    }
  };

  const resDirect = await resolvePeerPresetAndSetup({
    ctx: { agentPresets: mockAgentPresets },
    callerAgent: null
  });

  assert.equal(resDirect.presetId, 'default-preset');
  await resDirect.setup({});
  assert.equal(directMountCalled, true);
});

test('executeSessionCreate 端到端: callerAgent.options 继承到新会话且 targetAgent.options 完整挂载', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-options', {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high',
      reasoningEffort: 'high'
    }
  });
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Child Worker With Options' },
    exec
  });

  assert.equal(res.success, true);

  // 验证传给底层 create 的 payload 中的 agentOptions
  assert.equal(ctx._createPayloads.length, 1);
  const payload = ctx._createPayloads[0];
  assert.deepEqual(payload.agentOptions, {
    provider: 'easy-cliproxyapi-vision',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high'
  });

  // 验证创建出来的 targetAgent 拥有正确的 options 与 model，保证 {{model}} 变量不为 undefined
  const targetAgent = ctx._createdAgents.find(a => a.id === res.sessionId);
  assert.ok(targetAgent);
  assert.equal(targetAgent.options.provider, 'easy-cliproxyapi-vision');
  assert.equal(targetAgent.options.model, 'gemini-3.8-flash-high');
  assert.equal(targetAgent.options.reasoningEffort, 'high');
});

test('executeSessionCreate 端到端: ctx.agentDefaultModel 优雅回退与 args.model 覆写', async () => {
  resetRateLimits();
  const callerNoOptions = createMockAgent('caller-no-options');
  const agentDefaultModel = {
    currentSelection: () => ({
      provider: 'fallback-prov',
      model: 'fallback-model',
      reasoningEffort: 'low'
    })
  };
  const ctx = createMockCtx({
    agentsList: [callerNoOptions],
    agentDefaultModel
  });
  const exec = { agent: callerNoOptions };

  // 1. 无 caller.options 且无 args.model -> 回退到 agentDefaultModel
  const resFallback = await executeSessionCreate({
    ctx,
    args: { title: 'Fallback Worker' },
    exec
  });
  assert.equal(resFallback.success, true);
  const payload1 = ctx._createPayloads[0];
  assert.deepEqual(payload1.agentOptions, {
    provider: 'fallback-prov',
    model: 'fallback-model',
    reasoningEffort: 'low'
  });

  // 2. 传入 args.model 并指定 provider -> 覆写 provider 与 model
  resetRateLimits();
  const resOverride = await executeSessionCreate({
    ctx,
    args: {
      title: 'Override Worker',
      model: 'custom-provider/custom-model',
      reasoning_effort: 'high'
    },
    exec
  });
  assert.equal(resOverride.success, true);
  const payload2 = ctx._createPayloads[1];
  assert.deepEqual(payload2.agentOptions, {
    provider: 'custom-provider',
    model: 'custom-model',
    reasoningEffort: 'high'
  });
});

test('executeSessionCreate 端到端: agentPreset 挂载与 setup 钩子执行完整链路', async () => {
  resetRateLimits();
  let setupExecuted = false;
  let mountedPreset = null;

  const agentPresets = {
    resolve: async (id) => ({ id: id || 'system-default-preset' }),
    mount: async (agentCtx, id) => {
      setupExecuted = true;
      mountedPreset = id;
    }
  };

  const callerWithPreset = createMockAgent('caller-preset', {
    options: {
      provider: 'easy-cliproxyapi-vision',
      model: 'gemini-3.8-flash-high'
    }
  });
  callerWithPreset.session.metadata.agentPreset = 'custom-preset-v2';

  const ctx = createMockCtx({
    agentsList: [callerWithPreset],
    agentPresets
  });
  const exec = { agent: callerWithPreset };

  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Preset Worker' },
    exec
  });

  assert.equal(res.success, true);
  assert.equal(setupExecuted, true, 'setup 钩子必须在创建过程中被执行');
  assert.equal(mountedPreset, 'custom-preset-v2', '正确继承 caller 的 agentPreset');

  const payload = ctx._createPayloads[0];
  assert.equal(payload.meta.agentPreset, 'custom-preset-v2');
  assert.ok(typeof payload.setup === 'function');

  const targetAgent = ctx._createdAgents.find(a => a.id === res.sessionId);
  assert.equal(targetAgent.session.metadata.agentPreset, 'custom-preset-v2');
});

test('executeSessionCreate 端到端: args.preset 与 args.reasoning_effort 规范入参生效，且入参 sessionId 被忽略 (ADR-0016)', async () => {
  resetRateLimits();
  let mountedPreset = null;
  const agentPresets = {
    resolve: async (id) => ({ id: id || 'default' }),
    mount: async (agentCtx, id) => {
      mountedPreset = id;
    }
  };

  const caller = createMockAgent('caller-standard', {
    options: { provider: 'custom-prov', model: 'custom-mod' }
  });
  const ctx = createMockCtx({
    agentsList: [caller],
    agentPresets
  });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: {
      title: 'Spec Compliance Worker',
      preset: 'standard-preset-v1',
      reasoning_effort: 'high',
      sessionId: 'illegal-injected-id',
      context_post_ids: ['post-test-1', '#post-test-2']
    },
    exec
  });

  assert.equal(res.success, true);
  assert.notEqual(res.sessionId, 'illegal-injected-id', '入参 sessionId 必须被彻底忽略并内部唯一生成');
  assert.ok(res.sessionId.startsWith('session-'));
  assert.equal(mountedPreset, 'standard-preset-v1', '入参 preset 必须正确挂载');
  assert.deepEqual(res.contextPostIds, ['post-test-1', 'post-test-2'], '出参 contextPostIds 必须以驼峰字段正常返回');

  const payload = ctx._createPayloads[0];
  assert.equal(payload.agentOptions.reasoningEffort, 'high', '入参 reasoning_effort 必须正确透传至 agentOptions');
});

test('executeSessionCreate: 目标会话日志中直接追加 session/title 事件 (ADR-0017)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-title-test', {
    options: { provider: 'test-prov', model: 'test-model' }
  });
  const ctx = createMockCtx({
    agentsList: [caller]
  });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Explicit Worker Title' },
    exec
  });

  assert.equal(res.success, true);
  const targetAgent = ctx._createdAgents.find(a => a.id === res.sessionId);
  assert.ok(targetAgent, '目标 agent 必须已创建');
  assert.ok(Array.isArray(targetAgent.session.events), 'session.events 必须为数组');

  const titleEvent = targetAgent.session.events.find(e => e.type === 'session/title');
  assert.ok(titleEvent, '目标会话日志中必须包含 session/title 事件');
  assert.equal(titleEvent.data.title, 'Explicit Worker Title', 'session/title 事件标题必须与推导标题一致');
  assert.equal(titleEvent.data.source.kind, 'user');
});

test('executeSessionCreate: 未传 title 时将推导标题追加为 session/title 事件 (ADR-0017)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-derived-title-test', {
    options: { provider: 'test-prov', model: 'test-model' }
  });
  const ctx = createMockCtx({
    agentsList: [caller]
  });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: { initial_message: 'Audit security logs and reporting' },
    exec
  });

  assert.equal(res.success, true);
  const targetAgent = ctx._createdAgents.find(a => a.id === res.sessionId);
  assert.ok(targetAgent);

  const titleEvent = targetAgent.session.events.find(e => e.type === 'session/title');
  assert.ok(titleEvent, '推导标题必须写入 session/title 事件');
  assert.equal(titleEvent.data.title, 'Peer: Audit security logs and reporting');
});

test('executeSessionCreate: 优先使用 sessionTitle.rename 服务追加标题事件 (ADR-0017)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-service-rename-test', {
    options: { provider: 'test-prov', model: 'test-model' }
  });
  let renameCalledWith = null;
  const sessionTitle = {
    rename: (session, title) => {
      renameCalledWith = { session, title };
      if (session && typeof session.append === 'function') {
        session.append('session/title', {
          title,
          messageSeqs: [],
          source: { kind: 'user' }
        });
      }
    }
  };

  const ctx = createMockCtx({
    agentsList: [caller],
    sessionTitle
  });
  const exec = { agent: caller };

  const res = await executeSessionCreate({
    ctx,
    args: { title: 'Service Renamed Worker' },
    exec
  });

  assert.equal(res.success, true);
  assert.ok(renameCalledWith, 'ctx.sessionTitle.rename 必须被优先调用');
  assert.equal(renameCalledWith.title, 'Service Renamed Worker');

  const targetAgent = ctx._createdAgents.find(a => a.id === res.sessionId);
  const titleEvent = targetAgent.session.events.find(e => e.type === 'session/title');
  assert.ok(titleEvent);
  assert.equal(titleEvent.data.title, 'Service Renamed Worker');
});

test('executeSessionCreate: reasoning_effort 与 preset 参数继承与显式覆写专项测试 (ADR-0015 & ADR-0017)', async () => {
  resetRateLimits();

  const caller = createMockAgent('caller-inheritance', {
    options: {
      provider: 'default-provider',
      model: 'default-model',
      reasoningEffort: 'medium'
    }
  });
  caller.session.metadata.agentPreset = 'inherited-preset';

  let capturedPreset = null;
  const agentPresets = {
    resolve: async (id) => ({ id: id || 'system-preset' }),
    mount: async (agentCtx, id) => {
      capturedPreset = id;
    }
  };

  const ctx = createMockCtx({
    agentsList: [caller],
    agentPresets
  });
  const exec = { agent: caller };

  // 1. 默认情况：未传 reasoning_effort 与 preset，必须完整继承 caller 的参数
  const resInherited = await executeSessionCreate({
    ctx,
    args: { title: 'Inherited Worker' },
    exec
  });
  assert.equal(resInherited.success, true);
  const payloadInherited = ctx._createPayloads[0];
  assert.equal(payloadInherited.agentOptions.reasoningEffort, 'medium', '默认继承 caller 的 reasoningEffort');
  assert.equal(capturedPreset, 'inherited-preset', '默认继承 caller 的 agentPreset');

  // 2. 显式覆写：指定 reasoning_effort 与 preset 时，成功覆写而不继承
  resetRateLimits();
  const resOverridden = await executeSessionCreate({
    ctx,
    args: {
      title: 'Overridden Worker',
      reasoning_effort: 'high',
      preset: 'custom-override-preset'
    },
    exec
  });
  assert.equal(resOverridden.success, true);
  const payloadOverridden = ctx._createPayloads[1];
  assert.equal(payloadOverridden.agentOptions.reasoningEffort, 'high', '显式传入 reasoning_effort 覆盖 caller 设置');
  assert.equal(capturedPreset, 'custom-override-preset', '显式传入 preset 覆盖 caller 设置');
});
