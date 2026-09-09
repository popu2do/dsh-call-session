import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCreate,
  resolvePeerTitle,
  resetRateLimits,
  checkRateLimit,
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

  // 3. 仅传 [SYSTEM] 特权前缀，过滤后变为空，回退推导
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

test('executeSessionCreate: 工作区配额拦截 (10 个活跃根会话上限 [QuotaExceeded])', async () => {
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

test('executeSessionCreate: 衍生代际深度熔断 (Generation <= 2 [GenerationLimitExceeded])', async () => {
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

test('executeSessionCreate: 单会话限频拦截 (5 次/分钟 [RateLimitExceeded])', async () => {
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

test('executeSessionCreate: 异步非阻塞点火与 Context Post 关联挂载 (Fire-and-Forget)', async () => {
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
