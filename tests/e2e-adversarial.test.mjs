import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  BoardStore,
  formatAuthorReminderText,
  normalizeWorkspace
} from '../lib/board-store.mjs';
import {
  executeSessionCreate,
  resolvePeerTitle,
  resetRateLimits,
  checkRateLimit,
  PEER_SESSION_CONSTANTS
} from '../lib/session-create.mjs';
import {
  executeSessionCall,
  dispatchNativeMessage
} from '../lib/session-call.mjs';
import { apply } from '../index.mjs';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-e2e-adv-'));
}

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Agent',
  cwd = 'c:/workspace/project-alpha',
  generation = 0,
  creatorSessionId = null,
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
      metadata: {
        generation,
        creatorSessionId
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

function createMockHarness({
  initialAgents = [],
  archivedIds = [],
  workspace = 'c:/workspace/project-alpha'
} = {}) {
  const archivedSet = new Set(archivedIds);
  const registeredAgents = new Map();
  for (const a of initialAgents) {
    registeredAgents.set(a.id, a);
  }

  const registeredContexts = new Map();
  const registeredTools = new Map();
  const registeredCommands = new Map();
  const promptSections = new Map();
  const eventHandlers = new Map();

  const agentsSvc = {
    list: () => Array.from(registeredAgents.values()),
    get: (id) => registeredAgents.get(id),
    create: async (options) => {
      const id = options.sessionId || `session-peer-${Math.random().toString(36).slice(2, 8)}`;
      const agent = createMockAgent(id, {
        title: options.title || options.meta?.title || '',
        cwd: options.cwd || options.meta?.cwd || workspace,
        generation: options.meta?.generation || 1,
        creatorSessionId: options.meta?.creatorSessionId || null
      });
      registeredAgents.set(id, agent);
      return { agent };
    }
  };

  const ctx = {
    agents: agentsSvc,
    root: {
      get: (name) => (name === 'agents' ? agentsSvc : undefined),
      agents: agentsSvc
    },
    systemPrompt: {
      context(def) {
        registeredContexts.set(def.name, def);
      },
      getContext(name) {
        return registeredContexts.get(name);
      },
      add(id, getter, options) {
        promptSections.set(id, { getter, options });
      }
    },
    tools: {
      register(tool) {
        registeredTools.set(tool.name, tool);
      },
      get(name) {
        return registeredTools.get(name);
      }
    },
    commands: {
      register(cmd) {
        registeredCommands.set(cmd.name, cmd);
      }
    },
    on(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event).push(handler);
    },
    async emit(event, ...args) {
      const handlers = eventHandlers.get(event) || [];
      for (const h of handlers) await h(...args);
    },
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
    _registeredAgents: registeredAgents,
    _archivedSet: archivedSet,
    _tools: registeredTools,
    _contexts: registeredContexts
  };

  return { ctx, agentsSvc, registeredAgents, archivedSet };
}

// ---------------------------------------------------------------------------
// Suite 1: 需求一全链路测试 (Remind Idempotency, Session Isolation, Zero Side Effects, Natural Expiration)
// ---------------------------------------------------------------------------

test('需求一端到端：跨会话多轮对话状态幂等性 (ADR-0010 Invariant 1)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const { ctx } = createMockHarness();
  apply(ctx, {
    enabled: true,
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const remindContext = ctx._contexts.get('board:remind');
  assert.ok(remindContext, 'board:remind 必须成功注册至 systemPrompt.context');

  const sessionAlpha = createMockAgent('session-alpha');
  const sessionBeta = createMockAgent('session-beta');
  const boardPostTool = ctx.tools.get('board_post');

  // Alpha 发布有效条目
  const alphaPost = await boardPostTool.execute({
    topic: 'task:audit',
    content: 'Alpha 任务进行中'
  }, { agent: sessionAlpha });

  assert.ok(alphaPost?.postId);

  // 1. 模拟连续 50 轮对话 step，断言文本一致（无时间戳/易逝数据，保护 KV Cache）
  const initialText = remindContext.text({ agent: sessionAlpha });
  assert.ok(initialText.includes('1 条尚未清理的有效条目'));
  assert.ok(initialText.includes(alphaPost.postId));
  assert.ok(initialText.includes('task:audit'));

  for (let step = 1; step <= 50; step++) {
    const stepText = remindContext.text({ agent: sessionAlpha });
    assert.strictEqual(stepText, initialText, `Step ${step} 文本应与初始文本一致`);
  }

  // 2. Beta 在同一工作区发布 5 条条目，Alpha 的提醒依然保持幂等
  for (let i = 1; i <= 5; i++) {
    await boardPostTool.execute({
      topic: 'task:feature',
      content: `Beta 任务 ${i}`
    }, { agent: sessionBeta });
  }

  const alphaTextAfterBetaPosts = remindContext.text({ agent: sessionAlpha });
  assert.strictEqual(alphaTextAfterBetaPosts, initialText, '其他会话发布条目不影响 Alpha 的提醒文本');

  // 3. Beta 的提醒文本仅包含 Beta 自身条目，前 3 条展示并附带总数提示
  const betaText = remindContext.text({ agent: sessionBeta });
  assert.ok(betaText.includes('5 条尚未清理的有效条目'));
  assert.ok(!betaText.includes(alphaPost.postId), 'Beta 的提醒中不出现 Alpha 的条目');
  assert.ok(betaText.includes('等共 5 条'));

  await ctx.emit('dispose');
});

test('需求一端到端：条目清理消除与自然过期 (TTL Expiration)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const { ctx } = createMockHarness();
  apply(ctx, {
    enabled: true,
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const remindContext = ctx._contexts.get('board:remind');
  const sessionAlpha = createMockAgent('session-alpha');
  const boardPostTool = ctx.tools.get('board_post');
  const boardClearTool = ctx.tools.get('board_clear');

  // 1. 发布一条常规条目
  const normalPost = await boardPostTool.execute({
    topic: 'task:dev',
    content: '开发中'
  }, { agent: sessionAlpha });

  const text1 = remindContext.text({ agent: sessionAlpha });
  assert.ok(text1.includes('1 条尚未清理的有效条目'));

  // 2. 清理条目 (dismiss) -> 提醒立即变为空字符串 (0 token)
  await boardClearTool.execute({ id: normalPost.postId, mode: 'dismiss' }, { agent: sessionAlpha });
  const textAfterDismiss = remindContext.text({ agent: sessionAlpha });
  assert.strictEqual(textAfterDismiss, '', '条目 dismiss 标记归档后提醒为空');

  // 3. 自然过期底层校验：超时条目自然失效，无需额外销毁逻辑
  const memStore = new BoardStore({
    storagePath: null,
    debounceMs: 0,
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  });
  const pastMs = Date.now() - 5000;
  memStore.post({
    id: 'post-expired',
    topic: 'task:temp',
    content: '临时条目已超时',
    authorSessionId: sessionAlpha.id,
    authorWorkspace: 'c:/workspace/project-alpha',
    scope: 'c:/workspace/project-alpha',
    status: 'active',
    createdAtMs: pastMs - 10000,
    expiresAtMs: pastMs
  });

  const matched = memStore.findActiveByAuthor(sessionAlpha.id, 'c:/workspace/project-alpha');
  assert.strictEqual(matched.length, 0, '自然过期条目被 findActiveByAuthor 自动过滤为 0');
  assert.strictEqual(formatAuthorReminderText(matched), '', '过期条目提醒返回空字符串');

  await ctx.emit('dispose');
});

// ---------------------------------------------------------------------------
// Suite 2: 需求二并发与边界测试 (10-Active Quota Interception, Rate Limit, Boundary Titles, Orphan Prevention)
// ---------------------------------------------------------------------------

test('需求二端到端：活跃会话达配额上限拦截与配额释放', async () => {
  resetRateLimits();
  const initialAgent = createMockAgent('root-session', { cwd: 'c:/workspace/project-alpha' });
  const { ctx } = createMockHarness({ initialAgents: [initialAgent] });

  // 初始工作区已有 1 个活跃会话 (root-session)
  // 模拟多个不同会话发起创建（以避开单会话 5次/分 的限频，纯粹针对工作区 10 个配额硬防线对抗）
  const createdSessions = [];

  for (let i = 1; i <= 9; i++) {
    const callerId = `caller-session-${i}`;
    const caller = createMockAgent(callerId, { cwd: 'c:/workspace/project-alpha' });
    const res = await executeSessionCreate(ctx, {
      title: `Peer Worker ${i}`,
      initial_message: `Start step ${i}`
    }, { agent: caller });

    assert.equal(res.success, true);
    assert.equal(res.title, `Peer Worker ${i}`);
    createdSessions.push(res.sessionId);
  }

  // 此时工作区活跃会话数已达到 1 + 9 = 10 个硬上限
  // 第 11 个会话创建必须被 [QuotaExceeded] 拦截
  const overflowCaller = createMockAgent('caller-overflow', { cwd: 'c:/workspace/project-alpha' });
  await assert.rejects(
    async () => {
      await executeSessionCreate(ctx, {
        title: 'Peer Worker 11',
        initial_message: 'Should be rejected'
      }, { agent: overflowCaller });
    },
    (err) => {
      assert.ok(err.message.includes('[QuotaExceeded]'), `应抛出 [QuotaExceeded]，实际为: ${err.message}`);
      assert.ok(err.message.includes('已达上限 10'));
      return true;
    }
  );

  // 验证孤儿防范：被拦截的会话绝未遗留在 agents 服务中
  const liveCount = ctx.agents.list().length;
  assert.equal(liveCount, 10, '活跃会话总数保持为 10');

  // 模拟归档其中 1 个会话，释放 1 个配额
  const archivedId = createdSessions[0];
  ctx._archivedSet.add(archivedId);

  // 再次尝试创建，应成功占用释放出来的配额
  const retryRes = await executeSessionCreate(ctx, {
    title: 'Peer Worker 11 Recovered',
    initial_message: 'Should succeed after quota released'
  }, { agent: overflowCaller });

  assert.equal(retryRes.success, true);
  assert.equal(retryRes.title, 'Peer Worker 11 Recovered');
});

test('需求二端到端：单会话限频拦截与时间窗口恢复', async () => {
  resetRateLimits();
  const { ctx } = createMockHarness();
  const caller = createMockAgent('caller-rapid-fire');

  // 同一会话快速创建 5 次
  for (let i = 1; i <= 5; i++) {
    const res = await executeSessionCreate(ctx, {
      title: `Rapid Session ${i}`
    }, { agent: caller });
    assert.equal(res.success, true);
  }

  // 第 6 次在同一分钟内发起，触发 [RateLimitExceeded] 拦截
  await assert.rejects(
    async () => {
      await executeSessionCreate(ctx, {
        title: 'Rapid Session 6'
      }, { agent: caller });
    },
    (err) => {
      assert.ok(err.message.includes('[RateLimitExceeded]'), `应抛出 [RateLimitExceeded]，实际为: ${err.message}`);
      assert.ok(err.message.includes('限制为 5 次/分钟'));
      return true;
    }
  );

  // 模拟 60 秒后窗口滑动
  resetRateLimits();
  const recoveredRes = await executeSessionCreate(ctx, {
    title: 'Rapid Session 6 After Reset'
  }, { agent: caller });
  assert.equal(recoveredRes.success, true);
});

test('需求二端到端：代际深度限制 (Generation <= 2) 与因果链路追踪元数据', async () => {
  resetRateLimits();
  const { ctx } = createMockHarness();

  // Root Agent: Gen 0
  const rootAgent = createMockAgent('root-agent', { generation: 0 });

  // 1. Root 创建 Gen 1
  const res1 = await executeSessionCreate(ctx, {
    title: 'Gen 1 Peer'
  }, { agent: rootAgent });
  assert.equal(res1.generation, 1);

  const gen1Agent = ctx.agents.get(res1.sessionId);
  assert.ok(gen1Agent);
  assert.equal(gen1Agent.session.metadata.generation, 1);
  assert.equal(gen1Agent.session.metadata.creatorSessionId, 'root-agent');
  assert.equal(gen1Agent.session.metadata.origin, 'peer_created');

  // 2. Gen 1 创建 Gen 2
  const res2 = await executeSessionCreate(ctx, {
    title: 'Gen 2 Peer'
  }, { agent: gen1Agent });
  assert.equal(res2.generation, 2);

  const gen2Agent = ctx.agents.get(res2.sessionId);
  assert.ok(gen2Agent);
  assert.equal(gen2Agent.session.metadata.generation, 2);
  assert.equal(gen2Agent.session.metadata.creatorSessionId, gen1Agent.id);

  // 3. Gen 2 尝试派生 Gen 3 -> 触发代际深度熔断 [GenerationLimitExceeded]
  await assert.rejects(
    async () => {
      await executeSessionCreate(ctx, {
        title: 'Gen 3 Peer Attempt'
      }, { agent: gen2Agent });
    },
    (err) => {
      assert.ok(err.message.includes('[GenerationLimitExceeded]'), `应拦截 Gen 3 派生: ${err.message}`);
      assert.ok(err.message.includes('已达上限 2'));
      return true;
    }
  );
});

test('需求二边界测试：空消息、长消息、特殊字符与特权前缀过滤', () => {
  const activeTitles = new Set(['existing session']);

  // 1. 空消息、纯空白消息 -> 降级为 Peer-<8位UUID>
  const t1 = resolvePeerTitle({ title: '', initial_message: '', activeTitles });
  assert.match(t1, /^Peer-[a-z0-9]{8}/i);

  const t2 = resolvePeerTitle({ title: '   ', initial_message: '   \r\n\t  ', activeTitles });
  assert.match(t2, /^Peer-[a-z0-9]{8}/i);

  // 2. 特权前缀剥离沙箱 ([SYSTEM], [CAPTAIN], [ROOT])
  const tPriv1 = resolvePeerTitle({ title: '[SYSTEM] Core Watchdog', activeTitles });
  assert.equal(tPriv1, 'Core Watchdog');

  const tPriv2 = resolvePeerTitle({ title: '[captain] Team Leader', activeTitles });
  assert.equal(tPriv2, 'Team Leader');

  const tPriv3 = resolvePeerTitle({ title: '[ROOT] System Superuser', activeTitles });
  assert.equal(tPriv3, 'System Superuser');

  // 若特权前缀剥离后为空，回退到 initial_message 推导
  const tPrivEmpty = resolvePeerTitle({
    title: '[SYSTEM]',
    initial_message: 'Audit security logs now',
    activeTitles
  });
  assert.equal(tPrivEmpty, 'Peer: Audit security logs now');

  // 3. 4000 字符长消息与特殊符号摘要截断测试
  const longMessage = '### **Analysis Task**: Perform deep security verification for multi-agent architecture.\n\n' + 'X'.repeat(3900);
  const tLong = resolvePeerTitle({ initial_message: longMessage, activeTitles });
  assert.ok(tLong.startsWith('Peer: Analysis Task'));
  assert.ok(tLong.length <= PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH);

  // 4. 重复推导标题自动编号消歧（特殊字符如 # 会被过滤替换）
  const initialMsg = 'Review pull request 1024';
  const tColl1 = resolvePeerTitle({ initial_message: initialMsg, activeTitles });
  assert.equal(tColl1, 'Peer: Review pull request 1024');

  activeTitles.add(tColl1.toLowerCase());
  const tColl2 = resolvePeerTitle({ initial_message: initialMsg, activeTitles });
  assert.equal(tColl2, 'Peer: Review pull request 1024 (2)');

  activeTitles.add(tColl2.toLowerCase());
  const tColl3 = resolvePeerTitle({ initial_message: initialMsg, activeTitles });
  assert.equal(tColl3, 'Peer: Review pull request 1024 (3)');

  // 5. 显式重复标题拦截
  assert.throws(
    () => resolvePeerTitle({ title: 'existing session', activeTitles }),
    /\[DuplicateTitle\]/
  );
});

// ---------------------------------------------------------------------------
// Suite 3: 双需求协同流转端到端闭环测试 (Peer Creation + Blackboard + Remind + Session Call)
// ---------------------------------------------------------------------------

test('端到端全链路联动：创建同级会话、黑板任务派发、记名提醒隔离与单播通知', async (t) => {
  resetRateLimits();
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const rootAgent = createMockAgent('session-captain', {
    title: 'Captain',
    cwd: 'c:/workspace/project-alpha'
  });
  const { ctx } = createMockHarness({ initialAgents: [rootAgent] });
  apply(ctx, {
    enabled: true,
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const remindContext = ctx._contexts.get('board:remind');
  const boardPostTool = ctx.tools.get('board_post');
  const boardClearTool = ctx.tools.get('board_clear');
  const sessionCreateTool = ctx.tools.get('session_create');
  const sessionCallTool = ctx.tools.get('session_call');

  assert.ok(remindContext);
  assert.ok(boardPostTool);
  assert.ok(boardClearTool);
  assert.ok(sessionCreateTool);
  assert.ok(sessionCallTool);

  // Step 1: Captain 发布任务条目到黑板
  const postRes = await boardPostTool.execute({
    topic: 'task:dispatch',
    content: '请协助执行单元测试对抗验证',
    tags: ['p0', 'urgent']
  }, { agent: rootAgent });

  assert.ok(postRes?.postId);
  const taskId = postRes.postId;

  // Step 2: 验证 Captain 的 System Prompt 注入了记名提醒
  const captainRemind1 = remindContext.text({ agent: rootAgent });
  assert.ok(captainRemind1.includes('1 条尚未清理的有效条目'));
  assert.ok(captainRemind1.includes(taskId));

  // Step 3: Captain 创建同级 Worker 会话，挂载 taskId 作为 Context Ref
  const createRes = await sessionCreateTool.execute({
    title: 'Worker E2E',
    initial_message: '开始执行 E2E 对抗测试任务',
    context_post_ids: [taskId]
  }, { agent: rootAgent });

  assert.equal(createRes.success, true);
  assert.equal(createRes.status, 'running');
  assert.ok(createRes.bootstrapPostId, '应发布 session:bootstrap 就绪广播');
  const bootstrapId = createRes.bootstrapPostId;

  const workerAgent = ctx.agents.get(createRes.sessionId);
  assert.ok(workerAgent);

  // Step 4: 校验 Worker 接收到的点火指令携带了 Context Ref
  assert.equal(workerAgent.received.length, 1);
  const ignitionMsg = workerAgent.received[0].msg;
  const ignitionText = ignitionMsg.content[0].text;
  assert.ok(ignitionText.includes(`> Context Ref: #${taskId}`));
  assert.ok(ignitionText.includes('开始执行 E2E 对抗测试任务'));

  // Step 5: 校验 Worker 的记名提醒目前为空（隔离性：只提醒当前会话自己发布的条目）
  const workerRemind1 = remindContext.text({ agent: workerAgent });
  assert.strictEqual(workerRemind1, '', 'Worker 尚未发布条目时提醒为空');

  // Step 6: Worker 执行完毕，向黑板发布成果条目
  const resultRes = await boardPostTool.execute({
    topic: 'artifact:report',
    content: '测试报告：全部通过，0 缺陷',
    tags: ['report', 'passed']
  }, { agent: workerAgent });

  assert.ok(resultRes?.postId);
  const resultId = resultRes.postId;

  // Step 7: 校验双方记名提醒的独立隔离状态
  const captainRemind2 = remindContext.text({ agent: rootAgent });
  const workerRemind2 = remindContext.text({ agent: workerAgent });

  // Captain 看到自己的任务条目与创建派生发布的 bootstrap 条目
  assert.ok(captainRemind2.includes(taskId), 'Captain 看到自己的任务条目');
  assert.ok(captainRemind2.includes(bootstrapId), 'Captain 看到自己派生产生的 bootstrap 条目');
  assert.ok(!captainRemind2.includes(resultId), 'Captain 不应在提醒中看到 Worker 的成果条目');

  // Worker 只看到自己的成果条目
  assert.ok(workerRemind2.includes(resultId), 'Worker 只看到自己的成果条目');
  assert.ok(!workerRemind2.includes(taskId), 'Worker 不应在提醒中看到 Captain 的条目');

  // Step 8: Worker 通过 session_call 单播通知 Captain 任务完成
  const callRes = await sessionCallTool.execute({
    target_session_id: rootAgent.id,
    call_type: 'task_report',
    message: '测试已完成，请验收。',
    context_post_ids: [resultId]
  }, { agent: workerAgent });

  assert.equal(callRes.success, true);
  assert.equal(callRes.targetSessionId, rootAgent.id);

  // 校验 Captain 收到单播消息
  assert.ok(rootAgent.received.length >= 1);
  const reportMsg = rootAgent.received[rootAgent.received.length - 1].msg;
  const reportText = reportMsg.content[0].text;
  assert.ok(reportText.includes(`> Context Ref: #${resultId}`));
  assert.ok(reportText.includes('测试已完成，请验收。'));

  // Step 9: Captain 清理自己的任务条目与 bootstrap 条目
  await boardClearTool.execute({ id: taskId, mode: 'dismiss' }, { agent: rootAgent });
  // 清理完 taskId 后，Captain 还剩 bootstrapId
  const captainRemindPartial = remindContext.text({ agent: rootAgent });
  assert.ok(captainRemindPartial.includes(bootstrapId));

  // Captain 继续清理 bootstrap 条目
  await boardClearTool.execute({ id: bootstrapId, mode: 'dismiss' }, { agent: rootAgent });
  const captainRemind3 = remindContext.text({ agent: rootAgent });
  assert.strictEqual(captainRemind3, '', 'Captain 全部清理后其提醒为空');

  // Worker 的提醒保持完好
  const workerRemind3 = remindContext.text({ agent: workerAgent });
  assert.ok(workerRemind3.includes(resultId), 'Worker 提醒依然有效');

  // Step 10: Worker 清理成果条目
  await boardClearTool.execute({ id: resultId, mode: 'purge' }, { agent: workerAgent });
  const workerRemind4 = remindContext.text({ agent: workerAgent });
  assert.strictEqual(workerRemind4, '', 'Worker 清理后其提醒为空');

  // 此时全系统无遗留未处理提醒，0 Token 额外开销
  assert.strictEqual(remindContext.text({ agent: rootAgent }), '');
  assert.strictEqual(remindContext.text({ agent: workerAgent }), '');

  await ctx.emit('dispose');
});

// ---------------------------------------------------------------------------
// Suite 4: 异常与容错测试 (Robustness & Fault Tolerance)
// ---------------------------------------------------------------------------

test('异常处理：agents.create 失败、点火消息分发异常与黑板发布降级', async () => {
  resetRateLimits();

  // 1. 点火分发失败时安全捕获，降级为 status: 'idle'，不导致整体创建异常中断
  const faultyAgent = createMockAgent('faulty-target', {
    followupFn: () => {
      throw new Error('Connection reset during ignition');
    }
  });

  const agentsSvcWithFaulty = {
    list: () => [faultyAgent],
    get: (id) => (id === faultyAgent.id ? faultyAgent : null),
    create: async () => ({ agent: faultyAgent })
  };

  const harnessCtx = {
    agents: agentsSvcWithFaulty,
    root: { agents: agentsSvcWithFaulty },
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (n) => (n === 'agents' ? agentsSvcWithFaulty : undefined)
  };

  const resIgnitionFail = await executeSessionCreate(harnessCtx, {
    title: 'Faulty Session',
    initial_message: 'Should catch ignition error'
  }, { agent: createMockAgent('caller-1') });

  assert.equal(resIgnitionFail.success, true);
  assert.equal(resIgnitionFail.status, 'idle', '点火异常时应降级为 idle 待命状态');

  // 2. 黑板发布异常时不阻断会话创建
  const mockBoardStoreWithFail = {
    post: () => {
      throw new Error('Disk full during bootstrap notice');
    }
  };

  const resBoardFail = await executeSessionCreate({
    ...harnessCtx,
    boardStore: mockBoardStoreWithFail
  }, {
    title: 'Board Fail Session'
  }, { agent: createMockAgent('caller-2') });

  assert.equal(resBoardFail.success, true);
  assert.equal(resBoardFail.bootstrapPostId, null, '黑板发布失败时 bootstrapPostId 为 null');
});
