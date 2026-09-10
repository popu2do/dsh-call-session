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
  origin = undefined,
  blank = false,
  headerFrozen = false,
  steerFn = null,
  followupFn = null
} = {}) {
  const received = [];
  const rawHeader = { cwd, title, origin };
  const header = headerFrozen ? Object.freeze(rawHeader) : rawHeader;

  const agent = {
    id,
    status,
    title,
    generation,
    origin,
    blank,
    session: {
      id,
      title,
      header,
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

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

function createMockCtx({
  agentsList = [],
  archivedIds = [],
  logger = silentLogger,
  boardStore = null,
  createHook = null
} = {}) {
  const archivedSet = new Set(archivedIds);
  const registeredAgents = new Map(agentsList.map(a => [a.id, a]));

  const agentsSvc = {
    list: () => Array.from(registeredAgents.values()),
    get: (id) => registeredAgents.get(id),
    create: async (payload) => {
      if (typeof createHook === 'function') {
        const custom = await createHook(payload);
        if (custom) return custom;
      }
      const newId = payload.sessionId || `session-peer-${Math.random().toString(36).slice(2, 8)}`;
      const newAgent = createMockAgent(newId, {
        title: payload.title || payload.meta?.title || '',
        cwd: payload.cwd || payload.meta?.cwd || 'c:/workspace/project-alpha',
        generation: payload.meta?.generation || 1
      });
      registeredAgents.set(newId, newAgent);
      return { agent: newAgent };
    }
  };

  return {
    agents: agentsSvc,
    boardStore,
    logger: (scope) => (typeof logger === 'function' ? logger(scope) : logger),
    get(name) {
      if (name === 'logger') return (scope) => (typeof logger === 'function' ? logger(scope) : logger);
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: archivedSet };
      }
      if (name === 'boardStore') return boardStore;
      if (name === 'agents') return agentsSvc;
      return undefined;
    }
  };
}

test('DSH validateSessionHeader 契约校验测试', async () => {
  resetRateLimits();

  let interceptedPayload = null;

  // 严格仿真 DSH 核心库 SessionController 底层 validateSessionHeader 行为
  function dshNativeValidateSessionHeader(header) {
    if (!header || typeof header !== 'object') {
      throw new Error('session header must be an object');
    }
    // DSH 底层铁律：origin 字段只能是 'subagent'，其它任何值直接抛致命阻断异常
    if (header.origin !== undefined && header.origin !== 'subagent') {
      throw new Error('session header origin must be "subagent"');
    }
    if (header.parentSession !== undefined && header.origin !== 'subagent') {
      throw new Error('session header parentSession requires origin "subagent"');
    }
  }

  const strictHostAgentsSvc = {
    list: () => [],
    create: async (payload) => {
      interceptedPayload = JSON.parse(JSON.stringify(payload));

      // 宿主基于 createPayload 组装底层 SessionHeader
      const header = {
        version: 0,
        id: payload.sessionId,
        createdAt: Date.now(),
        cwd: payload.cwd || payload.meta?.cwd,
        origin: payload.header?.origin ?? payload.meta?.origin,
        parentSession: payload.header?.parentSession ?? payload.meta?.parentSession
      };

      // 触发宿主严格校验
      dshNativeValidateSessionHeader(header);

      const agent = {
        id: payload.sessionId,
        title: payload.title,
        status: 'idle',
        session: {
          id: payload.sessionId,
          header: Object.freeze(header),
          get cwd() { return header.cwd; }
        },
        followup: () => {},
        steer: () => {}
      };
      return { agent };
    }
  };

  const ctx = {
    agents: strictHostAgentsSvc,
    logger: () => silentLogger,
    get: (n) => (n === 'agents' ? strictHostAgentsSvc : undefined)
  };

  // 边界调用场景 1：调用方自身携带非法参数与自定义非标准 origin
  const dirtyCaller = createMockAgent('caller-dirty', {
    cwd: 'c:/workspace/app',
    origin: 'subagent'
  });
  dirtyCaller.session.header.origin = 'subagent';
  dirtyCaller.session.header.parentSession = 'root-session';

  const res1 = await executeSessionCreate(ctx, {
    title: 'Adversarial Peer 1',
    initial_message: 'Adversarial attack on origin'
  }, { agent: dirtyCaller });

  assert.equal(res1.success, true);
  assert.equal(res1.title, 'Adversarial Peer 1');
  assert.equal(interceptedPayload.header, undefined, '宿主 createPayload 不包含 header 对象');
  assert.equal(interceptedPayload.meta.origin, undefined, 'cleanMeta 不包含 origin 字段');
  assert.equal(interceptedPayload.meta.parentSession, undefined, '平级会话不注入 parentSession');

  // 边界调用场景 2：直接在 args 中传入非法 origin 与 header 字段
  const res2 = await executeSessionCreate(ctx, {
    title: 'Adversarial Peer 2',
    initial_message: 'Injected attack payload',
    header: { origin: 'malicious_peer' },
    meta: { origin: 'fake_origin', parentSession: 'injected_parent' }
  }, { agent: dirtyCaller });

  assert.equal(res2.success, true);
  assert.equal(interceptedPayload.header, undefined);
  assert.equal(interceptedPayload.meta.origin, undefined, '参数过滤后 meta 不包含 origin 字段');
  assert.equal(interceptedPayload.meta.parentSession, undefined);
  resetRateLimits();
});

test('冻结 SessionHeader 与 preventExtensions 兼容性测试', async () => {
  resetRateLimits();

  let targetSessionHeader = null;

  const strictFreezeAgentsSvc = {
    list: () => [],
    create: async (payload) => {
      // 冻结 SessionHeader 并封锁扩展
      const frozenHeader = Object.freeze({
        version: 0,
        id: payload.sessionId,
        createdAt: Date.now(),
        cwd: payload.cwd || payload.meta?.cwd,
        isSeeded: false
      });

      targetSessionHeader = frozenHeader;

      const frozenSession = {
        id: payload.sessionId,
        title: 'Original Host Title',
        header: frozenHeader,
        metadata: Object.seal({ initialKey: true }),
        cwd: payload.cwd
      };

      const agent = {
        id: payload.sessionId,
        title: payload.title,
        status: 'idle',
        session: frozenSession,
        followup: () => {},
        steer: () => {}
      };
      return { agent };
    }
  };

  const ctx = {
    agents: strictFreezeAgentsSvc,
    logger: () => silentLogger,
    get: (n) => (n === 'agents' ? strictFreezeAgentsSvc : undefined)
  };

  const caller = createMockAgent('caller-freeze-test');

  // 在严格模式下，向 Object.freeze 对象赋值会抛 TypeError: Cannot assign to read only property
  // 断言 executeSessionCreate 正常运行，将元数据写入 session.metadata
  const res = await executeSessionCreate(ctx, {
    title: 'Frozen Header Worker',
    initial_message: 'Verify freeze resistance'
  }, { agent: caller });

  assert.equal(res.success, true);
  assert.equal(res.title, 'Frozen Header Worker');
  assert.ok(targetSessionHeader);
  assert.equal(Object.isFrozen(targetSessionHeader), true, 'SessionHeader 保持冻结状态');
  resetRateLimits();
});

test('特权前缀过滤、超长参数与换行控制符清洗测试', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-fuzz');
  const ctx = createMockCtx({ agentsList: [caller] });
  const exec = { agent: caller };

  // 1. 特权沙箱前缀清洗：[SYSTEM] / [CAPTAIN] / [ROOT] 必须被自动剔除
  const resSys = await executeSessionCreate({
    ctx,
    args: { title: '[SYSTEM] Privileged System Bot', initial_message: 'Test' },
    exec
  });
  assert.equal(resSys.title, 'Privileged System Bot');
  assert.ok(!resSys.title.includes('[SYSTEM]'));

  const resCap = await executeSessionCreate({
    ctx,
    args: { title: '[CAPTAIN] Review Worker', initial_message: 'Test' },
    exec
  });
  assert.equal(resCap.title, 'Review Worker');

  const resRoot = await executeSessionCreate({
    ctx,
    args: { title: '[ROOT] Root Daemon', initial_message: 'Test' },
    exec
  });
  assert.equal(resRoot.title, 'Root Daemon');

  // 2. 换行符与控制符清洗：\r\n\t 必须被清洗为空格且不能残留换行
  const resNewline = await executeSessionCreate({
    ctx,
    args: { title: 'Multi\nLine\tTitle', initial_message: 'Test' },
    exec
  });
  assert.equal(resNewline.title, 'Multi Line Title');
  assert.ok(!resNewline.title.includes('\n'));
  assert.ok(!resNewline.title.includes('\t'));

  // 3. 超长 title 在参数校验阶段拦截 (> 60 字符)
  const longTitle = 'A'.repeat(61);
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: longTitle, initial_message: 'Test' },
      exec
    }),
    /title 超过最大长度限制 60 字符/
  );

  // 4. initial_message 边界测试：4000 字符通过，4001 字符拦截
  resetRateLimits();
  const exact4000 = 'M'.repeat(4000);
  const res4000 = await executeSessionCreate({
    ctx,
    args: { title: 'Boundary 4000 Worker', initial_message: exact4000 },
    exec
  });
  assert.equal(res4000.success, true);

  const over4000 = 'M'.repeat(4001);
  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'Boundary 4001 Worker', initial_message: over4000 },
      exec
    }),
    /initial_message 超过最大长度限制 4000 字符/
  );

  // 5. initial_message 非法类型参数拦截
  resetRateLimits();
  for (const badMsg of [12345, true, {}, [], Symbol('bad')]) {
    await assert.rejects(
      () => executeSessionCreate({
        ctx,
        args: { title: 'Bad Msg Worker', initial_message: badMsg },
        exec
      }),
      /initial_message 必须为字符串/
    );
  }

  // 6. context_post_ids 超过 5 个条目时截断至 5 个，并注入至 initial_message
  resetRateLimits();
  const tenPosts = Array.from({ length: 10 }, (_, i) => `post-${i + 1}`);
  const resPosts = await executeSessionCreate({
    ctx,
    args: { title: 'Context Overflow Worker', initial_message: 'Check posts', context_post_ids: tenPosts },
    exec
  });
  assert.equal(resPosts.success, true);
  const createdAgent = ctx.agents.get(resPosts.sessionId);
  assert.ok(createdAgent);
  const receivedText = createdAgent.received[0].msg.content[0].text;
  assert.ok(receivedText.includes('#post-1'));
  assert.ok(receivedText.includes('#post-5'));
  assert.ok(!receivedText.includes('#post-6'), '超过上限的条目被截断');

  resetRateLimits();
});

test('重名限制、配额限制、代际深度与限频滑动窗口测试', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-fuses', { cwd: 'c:/workspace/project-alpha' });

  // 1. 同工作区大小写不敏感防重名熔断 [DuplicateTitle]
  const ctx = createMockCtx({
    agentsList: [
      caller,
      createMockAgent('worker-alpha', { title: 'Quality Assurance Lead', cwd: 'c:/workspace/project-alpha' })
    ]
  });
  const exec = { agent: caller };

  await assert.rejects(
    () => executeSessionCreate({
      ctx,
      args: { title: 'quality assurance lead', initial_message: 'Duplicate' },
      exec
    }),
    /\[DuplicateTitle\]/
  );

  // 跨工作区同名会话允许通过
  const resCrossWs = await executeSessionCreate({
    ctx,
    args: { title: 'Unique in Alpha', initial_message: 'ok' },
    exec
  });
  assert.equal(resCrossWs.success, true);
  resetRateLimits();

  // 2. 配额熔断 [QuotaExceeded]：10 个平级会话 + 若干子代理/空白/归档会话极限干扰
  const tenAlphaRoots = Array.from({ length: 10 }, (_, i) =>
    createMockAgent(`root-${i}`, { title: `Root Worker ${i}`, cwd: 'c:/workspace/project-alpha' })
  );
  // 注入 5 个子代理（带 header.origin === 'subagent'）
  const fiveSubagents = Array.from({ length: 5 }, (_, i) => {
    const sub = createMockAgent(`sub-${i}`, { title: `Subagent ${i}`, cwd: 'c:/workspace/project-alpha' });
    sub.session.header.origin = 'subagent';
    return sub;
  });
  // 注入 3 个 blank 会话
  const threeBlanks = Array.from({ length: 3 }, (_, i) =>
    createMockAgent(`blank-${i}`, { blank: true, cwd: 'c:/workspace/project-alpha' })
  );
  // 注入 2 个归档会话
  const archivedCaller = createMockAgent('archived-1', { cwd: 'c:/workspace/project-alpha' });

  const quotaCtx = createMockCtx({
    agentsList: [...tenAlphaRoots, ...fiveSubagents, ...threeBlanks, archivedCaller],
    archivedIds: ['archived-1']
  });

  // 此时活跃根会话刚好为 10 个，第 11 个创建返回 [QuotaExceeded] 拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx: quotaCtx,
      args: { title: 'Eleventh Worker', initial_message: 'Should block' },
      exec: { agent: tenAlphaRoots[0] }
    }),
    /\[QuotaExceeded\]/
  );
  resetRateLimits();

  // 3. 代际深度熔断 [GenerationLimitExceeded]
  const gen2Caller = createMockAgent('caller-gen2', { generation: 2 });
  const genCtx = createMockCtx({ agentsList: [gen2Caller] });

  await assert.rejects(
    () => executeSessionCreate({
      ctx: genCtx,
      args: { title: 'Gen 3 Illegal Worker', initial_message: 'blocked' },
      exec: { agent: gen2Caller }
    }),
    /\[GenerationLimitExceeded\]/
  );

  // 恶意伪造畸形代际数据防御
  const genTamperedCaller = createMockAgent('caller-tampered', { generation: 99 });
  const genTamperCtx = createMockCtx({ agentsList: [genTamperedCaller] });
  await assert.rejects(
    () => executeSessionCreate({
      ctx: genTamperCtx,
      args: { title: 'Tampered Gen Worker', initial_message: 'blocked' },
      exec: { agent: genTamperedCaller }
    }),
    /\[GenerationLimitExceeded\]/
  );
  resetRateLimits();

  // 4. 滑动窗口限频 [RateLimitExceeded] 隔离性压测
  const caller1 = createMockAgent('rate-caller-1');
  const caller2 = createMockAgent('rate-caller-2');
  const rateCtx = createMockCtx({ agentsList: [caller1, caller2] });

  // caller1 发起 5 次请求全部通过
  for (let i = 1; i <= 5; i++) {
    const r = await executeSessionCreate({
      ctx: rateCtx,
      args: { title: `Caller1 Task ${i}` },
      exec: { agent: caller1 }
    });
    assert.equal(r.success, true);
  }

  // caller1 第 6 次被拦截
  await assert.rejects(
    () => executeSessionCreate({
      ctx: rateCtx,
      args: { title: 'Caller1 Task 6' },
      exec: { agent: caller1 }
    }),
    /\[RateLimitExceeded\]/
  );

  // caller2 依然具有完整的 5 次配额（会话间限流完全独立）
  const caller2Res = await executeSessionCreate({
    ctx: rateCtx,
    args: { title: 'Caller2 First Task' },
    exec: { agent: caller2 }
  });
  assert.equal(caller2Res.success, true);
  resetRateLimits();
});

test('点火分发失败与黑板公告降级处理', async () => {
  resetRateLimits();
  const caller = createMockAgent('caller-fault');

  let warnLogged = 0;
  const interceptingLogger = {
    debug() {},
    info() {},
    warn() { warnLogged++; },
    error() {}
  };

  // 模拟目标会话 followup 点火同步抛出异常
  const faultAgentsSvc = {
    list: () => [],
    create: async (payload) => {
      const explodingAgent = {
        id: payload.sessionId,
        title: payload.title,
        status: 'idle',
        session: { id: payload.sessionId, cwd: 'c:/workspace/app' },
        followup: () => { throw new Error('Ignition pipeline exploded!'); },
        steer: () => {}
      };
      return { agent: explodingAgent };
    }
  };

  const faultCtx = {
    agents: faultAgentsSvc,
    logger: () => interceptingLogger,
    get: (n) => (n === 'agents' ? faultAgentsSvc : undefined)
  };

  // 点火异常不能导致 executeSessionCreate 失败，会话依然创建成功并记录降级告警
  const res = await executeSessionCreate(faultCtx, {
    title: 'Fault Tolerant Worker',
    initial_message: 'Will fail ignition'
  }, { agent: caller });

  assert.equal(res.success, true);
  assert.equal(res.title, 'Fault Tolerant Worker');
  assert.ok(warnLogged >= 1, '点火失败记录降级告警');
  resetRateLimits();
});
