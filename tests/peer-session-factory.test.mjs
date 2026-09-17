import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PeerSessionFactory,
  PEER_SESSION_CONSTANTS,
  executeSessionCreate
} from '../lib/session-create.mjs';

function createMockAgent(id, {
  status = 'idle',
  title = 'Parent Agent',
  cwd = 'c:/workspace/project-alpha',
  generation = 0,
  options = { provider: 'test-prov', model: 'test-model' }
} = {}) {
  const received = [];
  const agent = {
    id,
    status,
    title,
    generation,
    options,
    session: {
      header: { cwd, title },
      metadata: { generation },
      append: async () => {},
      messages: []
    },
    steer(msg) {
      received.push({ type: 'steer', msg });
      return Promise.resolve();
    },
    followup(msg) {
      received.push({ type: 'followup', msg });
      return Promise.resolve();
    },
    _received: received
  };
  return agent;
}

function createMockEnvironment(agentList = []) {
  const list = [...agentList];
  const mockAgentsService = {
    create: async (payload) => {
      const target = createMockAgent(payload.sessionId, {
        title: payload.title,
        cwd: payload.cwd,
        generation: payload.meta?.generation ?? 1,
        options: payload.agentOptions
      });
      list.push(target);
      return target;
    },
    list: () => list
  };

  const mockCtx = {
    root: {
      agents: mockAgentsService
    },
    agents: mockAgentsService,
    get: (key) => {
      if (key === 'agents') return mockAgentsService;
      return undefined;
    }
  };

  return { ctx: mockCtx, agentsService: mockAgentsService, list };
}

test('PeerSessionFactory: 实例化与核心生命周期接口', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const factory = new PeerSessionFactory(ctx);
  assert.ok(factory.directory, '应该包含内部初始化的 SessionDirectory 实例');

  const caller = createMockAgent('caller-1');
  const result = await factory.create({
    args: {
      title: 'Peer Worker',
      initial_message: 'Do some work'
    },
    exec: {
      agent: caller
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.title, 'Peer Worker');
  assert.equal(result.status, 'running');
  assert.equal(result.generation, 1);
  assert.ok(result.sessionId.startsWith('session-'));

  // 标题推导能力内聚在工厂上
  const derivedTitle = PeerSessionFactory.resolveTitle({
    initialMessage: 'Fix navigation bar bug'
  });
  assert.equal(derivedTitle, 'Peer: Fix navigation bar bug');

  // 模型选项推导能力内聚在工厂上
  const agentOpts = PeerSessionFactory.resolveAgentOptions({
    callerAgent: caller,
    model: 'custom-model'
  });
  assert.equal(agentOpts.model, 'custom-model');
  assert.equal(agentOpts.provider, 'test-prov');

  PeerSessionFactory.reset();
});

test('PeerSessionFactory: 限频与并发配额校验', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const factory = new PeerSessionFactory(ctx);
  const caller = createMockAgent('caller-rate');

  // 正常创建 5 次
  for (let i = 0; i < PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE; i++) {
    const res = await factory.create({
      args: { title: `Worker ${i}` },
      exec: { agent: caller }
    });
    assert.equal(res.success, true);
  }

  // 第 6 次应该触发 RateLimitExceeded
  await assert.rejects(
    async () => {
      await factory.create({
        args: { title: 'Worker Overflow' },
        exec: { agent: caller }
      });
    },
    /RateLimitExceeded/
  );

  // reset 后应该可以重新创建
  PeerSessionFactory.reset();
  const resAfterReset = await factory.create({
    args: { title: 'Worker After Reset' },
    exec: { agent: caller }
  });
  assert.equal(resAfterReset.success, true);
});

test('PeerSessionFactory: 代际深度与工作区配额拦截', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const factory = new PeerSessionFactory(ctx);

  // 代际深度 >= 2 拦截
  const gen2Caller = createMockAgent('caller-gen2', { generation: 2 });
  await assert.rejects(
    async () => {
      await factory.create({
        args: { title: 'Child of Gen2' },
        exec: { agent: gen2Caller }
      });
    },
    /GenerationLimitExceeded/
  );

  // 工作区并发运行配额达到上限 5 个拦截
  const env10 = createMockEnvironment();
  const caller0 = createMockAgent('caller-quota', { status: 'running' });
  for (let i = 0; i < PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS; i++) {
    env10.list.push(createMockAgent(`existing-${i}`, {
      title: `Existing ${i}`,
      cwd: 'c:/workspace/project-alpha',
      status: 'running'
    }));
  }
  const factory10 = new PeerSessionFactory(env10.ctx);
  await assert.rejects(
    async () => {
      await factory10.create({
        args: { title: 'Exceeding Session' },
        exec: { agent: caller0 }
      });
    },
    /QuotaExceeded/
  );
});

test('PeerSessionFactory: 模型继承、预设与参数清洗', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const factory = new PeerSessionFactory(ctx);

  const callerWithEffort = createMockAgent('caller-effort', {
    options: {
      provider: 'openai',
      model: 'gpt-4o',
      reasoningEffort: 'high'
    }
  });

  // 显式覆写 provider/model，推理强度应被清空（跨模型不继承）
  const overrideRes = await factory.create({
    args: {
      title: 'Override Model Session',
      model: 'anthropic/claude-3-5-sonnet',
      context_post_ids: ['#post-123', 'post-456']
    },
    exec: { agent: callerWithEffort }
  });

  assert.equal(overrideRes.success, true);
  assert.deepEqual(overrideRes.contextPostIds, ['post-123', 'post-456']);

  PeerSessionFactory.reset();
});

test('executeSessionCreate: 保持向后兼容性，完整委托至 PeerSessionFactory', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const caller = createMockAgent('caller-legacy');

  // 支持对象签名
  const res1 = await executeSessionCreate({
    ctx,
    args: { title: 'Legacy Object Call' },
    exec: { agent: caller }
  });
  assert.equal(res1.success, true);
  assert.equal(res1.title, 'Legacy Object Call');

  // 支持多参数位置签名
  const res2 = await executeSessionCreate(
    ctx,
    { title: 'Legacy Positional Call' },
    { agent: caller }
  );
  assert.equal(res2.success, true);
  assert.equal(res2.title, 'Legacy Positional Call');
});
