import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  buildTransportPayload,
  sanitizePostIds
} from '../lib/session-call.mjs';

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Agent',
  cwd = 'c:/workspace/app',
  steerFn = null,
  followupFn = null,
  sendFn = null
} = {}) {
  const received = [];
  return {
    id,
    status,
    title,
    session: {
      id,
      title,
      cwd
    },
    steer: steerFn || ((msg) => { received.push({ type: 'steer', msg }); }),
    followup: followupFn || ((msg) => { received.push({ type: 'followup', msg }); }),
    send: sendFn,
    received
  };
}

const HEADER_REGEX = /^\[From: .+? \(.+?\) \| CallType: (task_dispatch|task_report|notice)\](\n> Context Ref: .+?)?\n\n/;

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

function createMockCtx({ agentsList = [], archivedIds = [], logger = silentLogger } = {}) {
  const archivedSet = new Set(archivedIds);
  const agentMap = new Map(agentsList.map(a => [a.id, a]));

  return {
    logger: (scope) => (typeof logger === 'function' ? logger(scope) : logger),
    get(name) {
      if (name === 'logger') return (scope) => (typeof logger === 'function' ? logger(scope) : logger);
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: archivedSet };
      }
      if (name === 'sessionTitle') {
        return {
          get: (session) => ({ title: session?.title || '' })
        };
      }
      return undefined;
    },
    agents: {
      list: () => agentsList,
      get: (id) => agentMap.get(id),
      resume: async ({ resumeSessionId }) => {
        const found = agentMap.get(resumeSessionId);
        return found ? { agent: found } : null;
      }
    }
  };
}

test('CALL_TYPE_INTENTS 常量定义完整性', () => {
  assert.equal(CALL_TYPE_INTENTS.task_dispatch, 'TASK_DISPATCH');
  assert.equal(CALL_TYPE_INTENTS.task_report, 'TASK_REPORT');
  assert.equal(CALL_TYPE_INTENTS.notice, 'NOTICE');
});

test('dispatchNativeMessage: 状态分发 (steer / followup / send)', () => {
  // 1. target 为 running 态且具有 steer 方法 -> steer
  const runningAgent = createMockAgent('agent-running', { status: 'running' });
  const mode1 = dispatchNativeMessage(runningAgent, { role: 'user', content: [] });
  assert.equal(mode1, 'steer');
  assert.equal(runningAgent.received[0].type, 'steer');

  // 2. target 为 idle 态且具有 followup 方法 -> followup
  const idleAgent = createMockAgent('agent-idle', { status: 'idle' });
  const mode2 = dispatchNativeMessage(idleAgent, { role: 'user', content: [] });
  assert.equal(mode2, 'followup');
  assert.equal(idleAgent.received[0].type, 'followup');

  // 3. target 仅具备 send 方法时回退为 followup
  const sendOnlyAgent = {
    id: 'agent-send',
    status: 'idle',
    received: [],
    send(msg, mode, flag) {
      this.received.push({ msg, mode, flag });
    }
  };
  const mode3 = dispatchNativeMessage(sendOnlyAgent, { role: 'user', content: [] });
  assert.equal(mode3, 'followup');
  assert.equal(sendOnlyAgent.received[0].mode, 'next-turn');
  assert.equal(sendOnlyAgent.received[0].flag, true);

  // 4. 非法 agent 抛出明确异常
  assert.throws(() => dispatchNativeMessage(null, {}), /\[InvalidParameter\]/);
  assert.throws(() => dispatchNativeMessage({}, {}), /\[ServiceUnavailable\]/);
});

test('executeSessionCall: 参数校验测试 (通配符/自呼叫/超长消息/空参数)', async () => {
  const caller = createMockAgent('caller-session-12345678');
  const target = createMockAgent('target-session-87654321');
  const ctx = createMockCtx({ agentsList: [caller, target] });
  const exec = { agent: caller };

  // 1. 空参数或空 target_session_id / message 拦截
  await assert.rejects(
    () => executeSessionCall({ ctx, args: null, exec }),
    /\[InvalidParameter\]/
  );
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: '', message: 'hi' }, exec }),
    /\[InvalidParameter\]/
  );
  // 废除别名防御：传 target_id 或 sessionId 不被识别为合法目标
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_id: 'target-12345678', message: 'hi' }, exec }),
    /\[InvalidParameter\]/
  );
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { sessionId: 'target-12345678', message: 'hi' }, exec }),
    /\[InvalidParameter\]/
  );
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: 'target-12345678', message: '' }, exec }),
    /\[InvalidParameter\]/
  );

  // 2. 通配符过滤 (*, all, broadcast)
  for (const wildcard of ['*', 'all', 'broadcast', 'ALL', 'Broadcast']) {
    await assert.rejects(
      () => executeSessionCall({ ctx, args: { target_session_id: wildcard, message: 'ping' }, exec }),
      /\[WildcardForbidden\]/
    );
  }

  // 3. 不能调用自身
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'caller-session-12345678', message: 'hello self' },
      exec
    }),
    /\[SelfCallForbidden\]/
  );

  // 4. 超长消息拦截 (> 4000 字符)
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: {
        target_session_id: 'target-session-87654321',
        message: 'A'.repeat(4001)
      },
      exec
    }),
    /\[InvalidParameter\]/
  );
});

test('executeSessionCall: 会话前缀解析与多重匹配处理', async () => {
  const caller = createMockAgent('caller-00000000');
  const sessionAlpha1 = createMockAgent('cluster-worker-node-alpha-1');
  const sessionAlpha2 = createMockAgent('cluster-worker-node-alpha-2');
  const sessionBeta = createMockAgent('cluster-worker-node-beta');

  const ctx = createMockCtx({
    agentsList: [caller, sessionAlpha1, sessionAlpha2, sessionBeta]
  });
  const exec = { agent: caller };

  // 1. 短前缀拒绝 (< 8 字符)
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'cluster', message: 'ping' },
      exec
    }),
    /\[InvalidParameter\]/
  );

  // 2. 多重匹配拒绝：前缀 "cluster-worker-node-alpha" 匹配到 alpha-1 和 alpha-2 两个会话
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'cluster-worker-node-alpha', message: 'ping' },
      exec
    }),
    /\[AmbiguousPrefix\]/
  );

  // 3. 唯一前缀 (>= 8 字符) 成功解析
  const prefixRes = await executeSessionCall({
    ctx,
    args: { target_session_id: 'cluster-worker-node-beta', message: 'ping beta' },
    exec
  });
  assert.equal(prefixRes.success, true);
  assert.equal(prefixRes.targetSessionId, 'cluster-worker-node-beta');

  // 4. 目标不存在或已被归档
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'non-existent-session-id', message: 'ping' },
      exec
    }),
    /\[TargetNotFound\]/
  );
});

test('executeSessionCall: 归档会话过滤', async () => {
  const caller = createMockAgent('caller-11112222');
  const archivedTarget = createMockAgent('archived-session-33334444');

  const ctx = createMockCtx({
    agentsList: [caller, archivedTarget],
    archivedIds: ['archived-session-33334444']
  });
  const exec = { agent: caller };

  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'archived-session-33334444', message: 'ping' },
      exec
    }),
    /\[TargetNotFound\]/
  );
});

test('executeSessionCall: 消息投递、Context Post 关联与两态分发', async () => {
  const caller = createMockAgent('caller-agent-12345', { title: 'Captain Agent' });
  const idleTarget = createMockAgent('target-idle-agent-67890', { status: 'idle', title: 'Worker Agent' });
  const runningTarget = createMockAgent('target-running-agent-67890', { status: 'running', title: 'Reviewer Agent' });

  const ctx = createMockCtx({
    agentsList: [caller, idleTarget, runningTarget]
  });
  const exec = { agent: caller };

  // 1. 呼叫 idle 会话 -> 触发 followup
  const resIdle = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-idle-agent-67890',
      message: 'Please review task #42',
      call_type: 'task_dispatch',
      context_post_ids: ['post-998', '#post-999']
    },
    exec
  });

  assert.equal(resIdle.success, true);
  assert.equal(resIdle.deliveryMode, 'followup');
  assert.equal(resIdle.targetStatus, 'idle');
  assert.equal(resIdle.callType, 'task_dispatch');
  assert.deepEqual(resIdle.contextPostIds, ['post-998', '#post-999']);

  // 检验接收到的 UserMessage 结构 (包含传输层客观报头与无损正文)
  const dispatchedToIdle = idleTarget.received[0].msg;
  assert.equal(dispatchedToIdle.role, 'user');
  assert.equal(
    dispatchedToIdle.content[0].text,
    '[From: caller-agent-12345 (Captain Agent) | CallType: task_dispatch]\n> Context Ref: #post-998, #post-999\n\nPlease review task #42'
  );
  assert.ok(dispatchedToIdle.content[0].text.includes('> Context Ref: #post-998, #post-999'));
  assert.ok(dispatchedToIdle.content[0].text.includes('Please review task #42'));
  assert.equal(dispatchedToIdle.source.kind, 'plugin');
  assert.equal(dispatchedToIdle.source.plugin, 'dsh-call-session');
  assert.ok(dispatchedToIdle.source.summary.includes('[Cross-Session TASK_DISPATCH]'));

  // 2. 呼叫 running 会话 -> 触发 steer
  const resRunning = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-running-agent-67890',
      message: 'Urgent halt signal',
      call_type: 'notice'
    },
    exec
  });

  assert.equal(resRunning.success, true);
  assert.equal(resRunning.deliveryMode, 'steer');
  assert.equal(resRunning.targetStatus, 'running');
  assert.equal(resRunning.callType, 'notice');

  const dispatchedToRunning = runningTarget.received[0].msg;
  assert.equal(
    dispatchedToRunning.content[0].text,
    '[From: caller-agent-12345 (Captain Agent) | CallType: notice]\n\nUrgent halt signal'
  );
  assert.ok(dispatchedToRunning.source.summary.includes('[Cross-Session NOTICE]'));
});

test('executeSessionCall: 兼容多重调用传参签名 executeSessionCall(ctx, args, exec)', async () => {
  const caller = createMockAgent('caller-sig-test-1111');
  const target = createMockAgent('target-sig-test-2222');
  const ctx = createMockCtx({ agentsList: [caller, target] });

  // 传统位置参数签名调用
  const res = await executeSessionCall(ctx, {
    target_session_id: 'target-sig-test-2222',
    message: 'test positional signature'
  }, { agent: caller });

  assert.equal(res.success, true);
  assert.equal(res.targetSessionId, 'target-sig-test-2222');
});

test('executeSessionCall: 接入 ctx.logger("dsh-call-session") 并记录 debug 日志', async () => {
  const caller = createMockAgent('caller-logger-1111');
  const target = createMockAgent('target-logger-2222', { status: 'idle' });

  const captured = [];
  let loggerScope = null;
  const mockLogger = {
    debug(...args) { captured.push({ level: 'debug', args }); },
    info(...args) { captured.push({ level: 'info', args }); },
    warn(...args) { captured.push({ level: 'warn', args }); },
    error(...args) { captured.push({ level: 'error', args }); }
  };

  const ctx = {
    logger: (scope) => {
      loggerScope = scope;
      return mockLogger;
    },
    agents: {
      list: () => [caller, target],
      get: (id) => (id === target.id ? target : (id === caller.id ? caller : null))
    }
  };

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-logger-2222',
      message: 'Testing logger integration'
    },
    exec: { agent: caller }
  });

  assert.equal(res.success, true);
  assert.equal(loggerScope, 'dsh-call-session');
  assert.ok(captured.some(l => l.level === 'debug' && l.args[0]?.includes('Successfully dispatched')));
  assert.equal(captured.filter(l => l.level !== 'debug').length, 0, '不产生非 debug 级别的输出日志');
});

test('buildTransportPayload: 标准参数生成标准客观报头与双换行正文', () => {

  // 1. task_dispatch 场景
  const payload1 = buildTransportPayload('Dispatch task #1', {
    callerSessionId: 'session-alpha-12345678',
    callerTitle: 'Coordinator',
    callType: 'task_dispatch'
  });
  assert.equal(payload1, '[From: session-alpha-12345678 (Coordinator) | CallType: task_dispatch]\n\nDispatch task #1');
  assert.match(payload1, HEADER_REGEX);

  // 2. task_report 场景
  const payload2 = buildTransportPayload('Task result delivered', {
    callerSessionId: 'session-beta-87654321',
    callerTitle: 'Worker Agent',
    callType: 'task_report'
  });
  assert.equal(payload2, '[From: session-beta-87654321 (Worker Agent) | CallType: task_report]\n\nTask result delivered');
  assert.match(payload2, HEADER_REGEX);

  // 3. notice 场景
  const payload3 = buildTransportPayload('System status update', {
    callerSessionId: 'session-gamma-11223344',
    callerTitle: 'Monitor',
    callType: 'notice'
  });
  assert.equal(payload3, '[From: session-gamma-11223344 (Monitor) | CallType: notice]\n\nSystem status update');
  assert.match(payload3, HEADER_REGEX);
});

test('buildTransportPayload: 带 Context Ref 时换行追加引用且格式化 # 前缀', () => {

  // 带单个与多个 context_post_ids，支持带或不带 # 前缀
  const payload = buildTransportPayload('Please review findings', {
    callerSessionId: 'caller-session-99999999',
    callerTitle: 'Lead Architect',
    callType: 'task_dispatch',
    cleanPostIds: ['post-101', '#post-102', '  post-103  ']
  });

  const expected = '[From: caller-session-99999999 (Lead Architect) | CallType: task_dispatch]\n> Context Ref: #post-101, #post-102, #post-103\n\nPlease review findings';
  assert.equal(payload, expected);
  assert.match(payload, HEADER_REGEX);
});

test('buildTransportPayload: 回退机制 (参数缺省、空串、非法类型)', () => {
  // 1. 无第二个参数或空对象
  const p1 = buildTransportPayload('Hello fallback');
  assert.equal(p1, '[From: unknown-caller (Session) | CallType: task_dispatch]\n\nHello fallback');

  const p2 = buildTransportPayload('Hello fallback', {});
  assert.equal(p2, '[From: unknown-caller (Session) | CallType: task_dispatch]\n\nHello fallback');

  // 2. 空白字符串与非法 callType 回退
  const p3 = buildTransportPayload('Fallback with spaces', {
    callerSessionId: '   ',
    callerTitle: '',
    callType: 'unsupported_call_type',
    cleanPostIds: []
  });
  assert.equal(p3, '[From: unknown-caller (Session) | CallType: task_dispatch]\n\nFallback with spaces');

  // 3. null / undefined 字段容错
  const p4 = buildTransportPayload('Fallback with nulls', {
    callerSessionId: null,
    callerTitle: null,
    callType: null,
    cleanPostIds: null
  });
  assert.equal(p4, '[From: unknown-caller (Session) | CallType: task_dispatch]\n\nFallback with nulls');
});

test('buildTransportPayload: 原始正文 100% 逐字无损与禁止指令污染 (Zero-Envelope & Zero-Preach)', () => {
  // 验证不被 trim 篡改、多行与特殊控制符无损保留
  const complexRaw = '  \tLeading space and multi-line\nLine 2 with symbols: !@#$%^&*()_+\n\nLine 4 ending space  ';
  const payload = buildTransportPayload(complexRaw, {
    callerSessionId: 'caller-verbatim-test',
    callerTitle: 'Verbatim Tester',
    callType: 'notice'
  });

  const expectedHeader = '[From: caller-verbatim-test (Verbatim Tester) | CallType: notice]\n\n';
  assert.ok(payload.startsWith(expectedHeader));
  assert.equal(payload.slice(expectedHeader.length), complexRaw);

  // 严禁指令污染
  assert.ok(!payload.includes('[SYSTEM DIRECTIVE]'));
  assert.ok(!payload.includes('[SYSTEM:'));
  assert.ok(!payload.includes('请立即'));
  assert.ok(!payload.includes('收到请'));
});

test('executeSessionCall: 端到端消息格式断言测试 (三大 call_type、Context Ref、回退处理与全量返回契约)', async () => {

  const caller = createMockAgent('caller-e2e-12345678', { title: 'Captain Master' });
  const targetIdle = createMockAgent('target-e2e-idle-11111111', { status: 'idle', title: 'Target Worker' });
  const targetRunning = createMockAgent('target-e2e-running-22222222', { status: 'running', title: 'Target Reviewer' });

  const ctx = createMockCtx({
    agentsList: [caller, targetIdle, targetRunning]
  });

  // 1. task_dispatch 端到端调用
  const dispatchRes = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-e2e-idle-11111111',
      message: 'Dispatch task #100',
      call_type: 'task_dispatch',
      context_post_ids: ['post-abc']
    },
    exec: { agent: caller }
  });

  assert.equal(dispatchRes.success, true);
  assert.equal(dispatchRes.targetSessionId, 'target-e2e-idle-11111111');
  assert.equal(dispatchRes.targetTitle, 'Target Worker');
  assert.equal(dispatchRes.targetStatus, 'idle');
  assert.equal(dispatchRes.deliveryMode, 'followup');
  assert.equal(dispatchRes.callType, 'task_dispatch');
  assert.equal(dispatchRes.callerSessionId, 'caller-e2e-12345678');
  assert.deepEqual(dispatchRes.contextPostIds, ['post-abc']);
  assert.ok(dispatchRes.message.includes('task_dispatch'));

  const msg1 = targetIdle.received[targetIdle.received.length - 1].msg;
  assert.match(msg1.content[0].text, HEADER_REGEX);
  assert.equal(
    msg1.content[0].text,
    '[From: caller-e2e-12345678 (Captain Master) | CallType: task_dispatch]\n> Context Ref: #post-abc\n\nDispatch task #100'
  );
  assert.ok(msg1.source.summary.includes('[Cross-Session TASK_DISPATCH]'));

  // 2. task_report 端到端调用
  const reportRes = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-e2e-running-22222222',
      message: 'Report result of task #100',
      call_type: 'task_report'
    },
    exec: { agent: caller }
  });

  assert.equal(reportRes.success, true);
  assert.equal(reportRes.deliveryMode, 'steer');
  assert.equal(reportRes.callType, 'task_report');
  const msg2 = targetRunning.received[targetRunning.received.length - 1].msg;
  assert.match(msg2.content[0].text, HEADER_REGEX);
  assert.equal(
    msg2.content[0].text,
    '[From: caller-e2e-12345678 (Captain Master) | CallType: task_report]\n\nReport result of task #100'
  );
  assert.ok(msg2.source.summary.includes('[Cross-Session TASK_REPORT]'));

  // 3. 无 exec.agent 时的回退调用
  const fallbackRes = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-e2e-idle-11111111',
      message: 'Anonymous call message'
    },
    exec: {}
  });

  assert.equal(fallbackRes.success, true);
  assert.equal(fallbackRes.callerSessionId, 'unknown-caller');
  assert.equal(fallbackRes.callType, 'task_dispatch');
  const msg3 = targetIdle.received[targetIdle.received.length - 1].msg;
  assert.equal(
    msg3.content[0].text,
    '[From: unknown-caller (Session) | CallType: task_dispatch]\n\nAnonymous call message'
  );
});
test('executeSessionCall: 端到端全链路正文 100% 逐字无损保留 (带代码缩进与空白)', async () => {
  const caller = createMockAgent('caller-verbatim-1111');
  const target = createMockAgent('target-verbatim-2222');
  const ctx = createMockCtx({ agentsList: [caller, target] });

  const rawWithIndentation = '  \n  function test() {\n    return 42;\n  }\n  ';
  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-verbatim-2222',
      message: rawWithIndentation,
      call_type: 'task_dispatch'
    },
    exec: { agent: caller }
  });

  assert.equal(res.success, true);
  const dispatched = target.received[0].msg;
  const expectedHeader = '[From: caller-verbatim-1111 (Test Agent) | CallType: task_dispatch]';
  assert.equal(dispatched.content[0].text, `${expectedHeader}\n\n${rawWithIndentation}`);
  assert.ok(dispatched.content[0].text.endsWith(rawWithIndentation), '正文尾随空格与换行 100% 逐字保留');
  assert.ok(dispatched.content[0].text.includes('\n\n' + rawWithIndentation), '报头与正文严格以双换行隔离');
});

test('executeSessionCall: 进程内原生分发网络零调用验证 (ADR-0006 §6.1)', async () => {
  const caller = createMockAgent('caller-nofetch-1111');
  const target = createMockAgent('target-nofetch-2222');
  const ctx = createMockCtx({ agentsList: [caller, target] });

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('网络调用被严格禁止！');
  };

  try {
    const res = await executeSessionCall({
      ctx,
      args: {
        target_session_id: 'target-nofetch-2222',
        message: 'Pure in-process dispatch'
      },
      exec: { agent: caller }
    });
    assert.equal(res.success, true);
    assert.equal(fetchCalled, false, 'session_call 执行过程严禁发起任何外部或回环 HTTP 请求');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sanitizePostIds: 关联黑板 ID 清洗、去重与边界容错', () => {
  assert.deepEqual(sanitizePostIds(null), []);
  assert.deepEqual(sanitizePostIds(undefined), []);
  assert.deepEqual(sanitizePostIds('invalid'), []);
  assert.deepEqual(sanitizePostIds(['post-1', 'post-2', 'post-1', '  post-2  ', '#', '']), ['post-1', 'post-2']);
  assert.deepEqual(sanitizePostIds(['#post-a', '#post-b', '#post-a']), ['#post-a', '#post-b']);
});