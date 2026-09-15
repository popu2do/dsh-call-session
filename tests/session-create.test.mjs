import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCreate,
  resolvePeerTitle,
  resetRateLimits,
  checkRateLimit,
  inspectWorkspaceActiveSessions,
  PEER_SESSION_CONSTANTS
} from '../lib/session-create.mjs';

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Agent',
  cwd = 'c:/workspace/project-alpha',
  generation = 0,
  steerFn = null,
  followupFn = null
} = {}) {
  const received = [];
  const agent = {
    id,
    status,
    title,
    generation,
    session: {
      id,
      title,
      header: { cwd, title },
      cwd,
      metadata: { generation }
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
  boardStore = null
} = {}) {
  const archivedSet = new Set(archivedIds);
  const createdAgents = [];

  const agentsSvc = {
    list: () => [...agentsList, ...createdAgents],
    get: (id) => [...agentsList, ...createdAgents].find(a => a.id === id),
    create: async (options) => {
      const id = options.sessionId || `session-mock-${Math.random().toString(36).slice(2, 8)}`;
      const agent = createMockAgent(id, {
        title: options.title || options.meta?.title || '',
        cwd: options.cwd || options.meta?.cwd || 'c:/workspace/project-alpha',
        generation: options.meta?.generation || 1
      });
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
    get(name) {
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: archivedSet };
      }
      if (name === 'sessionTitle') {
        return {
          get: (s) => ({ title: s?.title || s?.header?.title || '' })
        };
      }
      if (name === 'agents') return agentsSvc;
      return undefined;
    },
    agents: agentsSvc,
    root: {
      get: (name) => (name === 'agents' ? agentsSvc : undefined),
      agents: agentsSvc
    },
    boardStore,
    _createdAgents: createdAgents
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
  assert.equal(PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS, 10);
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

test('executeSessionCreate: 工作区配额拦截 (10 个活跃根会话上限)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-root');
  // 创建 9 个同工作区活跃会话，加上 caller 共 10 个
  const activeSessions = [caller];
  for (let i = 1; i <= 9; i++) {
    activeSessions.push(createMockAgent(`active-${i}`, {
      title: `Worker ${i}`,
      cwd: 'c:/workspace/project-alpha'
    }));
  }

  const ctx = createMockCtx({ agentsList: activeSessions });
  const exec = { agent: caller };

  // 已有 10 个，新建应被配额拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Exceeded Worker', initial_message: 'Should fail' },
      exec
    }),
    /\[QuotaExceeded\]/
  );
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

  // 验证目标 agent 收到点火消息
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
  const rootAgent = createMockAgent('root-session', { cwd: 'c:/workspace/app' });

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

test('executeSessionCreate: 并发创建预占位防范 TOCTOU 竞争突破上限 (ADR-0010)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-toctou', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  // 现有 9 个活跃会话
  const existingAgents = [caller];
  for (let i = 1; i <= 8; i++) {
    existingAgents.push(createMockAgent(`peer-${i}`, { cwd: 'c:/workspace/app', title: `Peer ${i}` }));
  }

  // 模拟慢速创建，延迟 30ms 返回
  const slowAgentsSvc = {
    list: () => existingAgents,
    get: (id) => existingAgents.find(a => a.id === id),
    create: async (payload) => {
      await new Promise(r => setTimeout(r, 30));
      const newAgent = createMockAgent(payload.sessionId, { cwd: payload.cwd, title: payload.title });
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

  // 同时并发发起两个创建请求：总数 9 + 2 = 11 > 10，第二个并发请求必须被 QuotaExceeded 拒绝
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

test('executeSessionCreate: 乐观预留与失败回滚保障并发 6 请求限频拦截 (ADR-0010 Invariant 3)', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-concurrent-rate', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  // 模拟慢速异步创建，使并发请求在等待底层返回期间重叠
  const slowAgentsSvc = {
    list: () => [caller],
    get: () => undefined,
    create: async (payload) => {
      await new Promise(r => setTimeout(r, 25));
      return { agent: createMockAgent(payload.sessionId, { cwd: payload.cwd, title: payload.title }) };
    }
  };

  const ctx = {
    root: { agents: slowAgentsSvc },
    agents: slowAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? slowAgentsSvc : undefined)
  };

  // 同一 caller 瞬间并发发起 6 个创建请求
  const promises = [];
  for (let i = 1; i <= 6; i++) {
    promises.push(
      executeSessionCreate({
        ctx,
        args: { title: `Concurrent Rate Worker ${i}` },
        exec
      })
    );
  }

  const results = await Promise.allSettled(promises);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 5, '每分钟最多只允许创建 5 次，必须恰好 5 个成功');
  assert.equal(rejected.length, 1, '第 6 个并发请求必须被限频机制同步拦截');
  assert.match(rejected[0].reason.message, /\[RateLimitExceeded\]/);
});
