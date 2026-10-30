import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PeerSessionFactory,
  PEER_SESSION_CONSTANTS,
  executeSessionCreate,
  executePeerSessionAdmissionPipeline,
  validateAndAdmit,
  provisionPeerAgent,
  bootstrapAndVerify,
  finalizeAdmission,
  checkRateLimit,
  resetRateLimits
} from '../lib/session-create.mjs';
import { SessionSafeguard } from '../lib/session-safeguard.mjs';
import { createMockAgent } from './helpers/mock-agent.mjs';
import { createMockEnvironment } from './helpers/mock-host.mjs';

test('同级会话生命周期与创建契约：初始化、标题推导与选项解析', async () => {
  PeerSessionFactory.reset();
  const { ctx } = createMockEnvironment();
  const factory = new PeerSessionFactory(ctx);
  assert.ok(factory.directory, '应该包含内部初始化的 SessionDirectory 实例');

  const caller = createMockAgent('caller-1', { options: { provider: 'test-prov', model: 'test-model' } });
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

test('会话治理安全网：滑动窗口限频与单工作区运行并发配额硬拦截', async () => {
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

test('会话治理熔断：代际深度超限 (depth >= 2) 与配额熔断', async () => {
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

test('派发模型继承与预设装配：继承调用方 LLM 配置并执行安全参数清洗', async () => {
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

test('流水线阶段 1 边界：validateAndAdmit 入参校验失败与跨工作区拦截时零租约签发', () => {
  PeerSessionFactory.reset();
  const caller = createMockAgent('caller-stage-1', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  let admitCallCount = 0;
  const mockSafeguard = {
    admit: () => {
      admitCallCount++;
      return { status: 'acquired' };
    }
  };

  const mockDirectory = {
    resolveTitle: () => 'Caller',
    resolveCwd: () => 'c:/workspace/app',
    isRegisteredWorkspace: (w) => (w === 'c:/workspace/registered' ? true : false)
  };

  const mockGateway = {
    resolveRootAgentsService: () => ({ create: async () => ({}) })
  };

  const deps = {
    safeguard: mockSafeguard,
    directory: mockDirectory,
    gateway: mockGateway
  };

  // 1. 入参非对象
  assert.throws(
    () => validateAndAdmit(deps, { args: null, exec }),
    /arguments must be an object/
  );

  // 2. 空白工作区
  assert.throws(
    () => validateAndAdmit(deps, { args: { workspace: '   ' }, exec }),
    /workspace must be a non-empty string/
  );

  // 3. 标题超长
  assert.throws(
    () => validateAndAdmit(deps, { args: { title: 't'.repeat(PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH + 1) }, exec }),
    /title exceeds maximum length/
  );

  // 4. context_post_ids 非数组
  assert.throws(
    () => validateAndAdmit(deps, { args: { context_post_ids: 'invalid-string' }, exec }),
    /context_post_ids must be an array/
  );

  // 5. 跨工作区且未在宿主注册表注册拦截
  assert.throws(
    () => validateAndAdmit(deps, { args: { workspace: 'c:/workspace/unregistered-app' }, exec }),
    /WorkspaceNotRegistered/
  );

  // 校验拦截过程中尚未签发任何准入租约
  assert.equal(admitCallCount, 0, '校验失败路径严禁签发准入租约');
  PeerSessionFactory.reset();
});

test('流水线阶段 2 边界：provisionPeerAgent 开辟异常触发准入租约原子回滚与限频配额返还', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-stage-2', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  let createAttempted = 0;
  const failingAgentsSvc = {
    list: () => [caller],
    get: () => undefined,
    create: async () => {
      createAttempted++;
      throw new Error('Host agent provisioning disk full');
    }
  };

  const ctx = {
    root: { agents: failingAgentsSvc },
    agents: failingAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? failingAgentsSvc : undefined)
  };

  await assert.rejects(
    async () => {
      await executePeerSessionAdmissionPipeline(ctx, {
        args: { title: 'Failing Provision Peer' },
        exec
      });
    },
    /Host agent provisioning disk full/
  );

  assert.equal(createAttempted, 1);

  // 验证限频配额已返还：再次合法查询限频窗口，必须处于可用相态
  const nextTimestamp = checkRateLimit('caller-stage-2');
  assert.equal(typeof nextTimestamp, 'number', '开辟失败回滚后必须完整返还限频配额');

  // 直接驱动 provisionPeerAgent 验证异常路径下先 lease.release() 再重抛
  let leaseReleaseCalled = false;
  const fakeLease = {
    title: 'Direct Provision Test',
    generation: 1,
    release: () => { leaseReleaseCalled = true; }
  };

  const mockThrowGateway = {
    resolveEffectiveModel: () => ({}),
    resolvePresetSetup: async () => ({ presetId: undefined, setup: undefined }),
    createRootAgent: async () => { throw new Error('Direct gateway exploded'); }
  };

  await assert.rejects(
    async () => {
      await provisionPeerAgent(
        { gateway: mockThrowGateway },
        {
          lease: fakeLease,
          args: {},
          callerAgent: caller,
          creatorSessionId: 'caller-stage-2',
          targetCwd: 'c:/workspace/app',
          targetWorkspace: 'c:/workspace/app',
          agentsService: failingAgentsSvc,
          exec
        }
      );
    },
    /Direct gateway exploded/
  );

  assert.equal(leaseReleaseCalled, true, 'provisionPeerAgent 异常时必须显式调用 lease.release()');
  resetRateLimits();
});

test('流水线阶段 3 边界：bootstrapAndVerify 初帧崩溃阻断提交并原子回滚准入租约', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-stage-3', { cwd: 'c:/workspace/app' });
  const exec = { agent: caller };

  // 模拟创建出的 agent 在握手窗口首帧秒崩
  const crashingAgentsSvc = {
    list: () => [caller],
    get: () => undefined,
    create: async (payload) => {
      const crashingAgent = {
        id: payload.sessionId,
        title: payload.title,
        status: 'idle',
        phase: { kind: 'idle', lastTurn: 0 },
        session: {
          id: payload.sessionId,
          events: [],
          header: { cwd: payload.cwd }
        },
        received: [],
        followup(msg) {
          this.received.push(msg);
          this.phase = { kind: 'running', turn: 1 };
          setTimeout(() => {
            this.session.events.push({
              type: 'turn/end',
              data: {
                turn: 1,
                reason: { kind: 'error', error: { message: 'First frame crashed violently', code: 'FRAME_CRASH' } }
              }
            });
            this.phase = { kind: 'idle', lastTurn: 1 };
          }, 15);
        }
      };
      return { agent: crashingAgent };
    }
  };

  const ctx = {
    root: { agents: crashingAgentsSvc },
    agents: crashingAgentsSvc,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? crashingAgentsSvc : undefined)
  };

  const res = await executePeerSessionAdmissionPipeline(ctx, {
    args: {
      title: 'Crashing Bootstrap Peer',
      initial_message: 'Begin work',
      wait_ms: 100
    },
    exec
  });

  assert.equal(res.success, false, '初帧崩溃时必须返回 success: false');
  assert.equal(res.status, 'error');
  assert.equal(res.deliveryState, 'failed');
  assert.equal(res.executionState, 'crashed');
  assert.ok(res.error, '必须包含结构化崩溃错误信息');

  // 验证配额已原子返还
  const resumedAt = checkRateLimit('caller-stage-3');
  assert.equal(typeof resumedAt, 'number', '首帧崩溃回滚后限频配额必须恢复');
  resetRateLimits();
});

test('流水线阶段 4 边界：finalizeAdmission 固化提交租约并交付严格 11 字段标准结果', () => {
  let commitCount = 0;
  const mockLease = {
    title: 'Finalized Session',
    generation: 1,
    status: 'acquired',
    commit: () => {
      commitCount++;
      mockLease.status = 'committed';
      return mockLease;
    }
  };

  const mockTargetAgent = {
    id: 'session-final-001'
  };

  const deps = {
    ctx: null,
    options: {}
  };

  const state = {
    lease: mockLease,
    targetAgent: mockTargetAgent,
    targetWorkspace: 'c:/workspace/app',
    cleanPostIds: ['post-final-1', 'post-final-2'],
    verification: {
      finalStatus: 'running',
      bootstrapPostId: 'post-bootstrap-1',
      deliveryState: 'delivered',
      executionState: 'running',
      hasInitialMessage: true
    }
  };

  const result = finalizeAdmission(deps, state);

  // 1. 验证租约确权提交
  assert.equal(commitCount, 1, '必须且仅可调用一次 commit');
  assert.equal(mockLease.status, 'committed');

  // 2. 验证结果包含严格 11 个标准字段
  const expectedFields = [
    'bootstrapPostId',
    'contextPostIds',
    'deliveryState',
    'executionState',
    'generation',
    'message',
    'sessionId',
    'status',
    'success',
    'title',
    'workspace'
  ];
  assert.deepEqual(Object.keys(result).sort(), expectedFields);

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-final-001');
  assert.equal(result.title, 'Finalized Session');
  assert.equal(result.workspace, 'c:/workspace/app');
  assert.equal(result.status, 'running');
  assert.equal(result.generation, 1);
  assert.equal(result.bootstrapPostId, 'post-bootstrap-1');
  assert.deepEqual(result.contextPostIds, ['post-final-1', 'post-final-2']);
  assert.equal(result.deliveryState, 'delivered');
  assert.equal(result.executionState, 'running');
  assert.ok(typeof result.message === 'string' && result.message.length > 0);
});

test('流水线事务屏障幂等性：同一准入租约重复 release 或 commit 后 release 无副作用与无重复返还', () => {
  const safeguard = new SessionSafeguard();
  const caller = createMockAgent('caller-barrier-idempotent');
  const agentsService = { list: () => [caller] };

  // 场景 A：多次 release 幂等性
  const leaseA = safeguard.admit({
    callerAgent: caller,
    workspace: 'c:/workspace/app-a',
    title: 'Lease A',
    agentsService
  });
  assert.equal(leaseA.status, 'acquired');

  // 第一次 release
  leaseA.release();
  assert.equal(leaseA.status, 'released');

  // 第二次与第三次 release（以及 rollback 别名）
  assert.doesNotThrow(() => leaseA.release());
  assert.doesNotThrow(() => leaseA.rollback());
  assert.equal(leaseA.status, 'released');

  // 场景 B：commit 后 release 幂等防护
  const leaseB = safeguard.admit({
    callerAgent: caller,
    workspace: 'c:/workspace/app-b',
    title: 'Lease B',
    agentsService
  });
  assert.equal(leaseB.status, 'acquired');

  leaseB.commit();
  assert.equal(leaseB.status, 'committed');

  // 已 committed 租约即使被 finally 屏障调用 release 也不得改变状态或回滚配额
  leaseB.release();
  assert.equal(leaseB.status, 'committed', '已提交租约调用 release 必须被 status 守卫无害阻断');
});
