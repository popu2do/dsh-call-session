import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
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

test('dispatchNativeMessage: 原生两态分发 (steer / followup / send)', () => {
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

  // 3. target 仅具备 send 方法时优雅降级为 followup
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
  assert.throws(() => dispatchNativeMessage(null, {}), /targetAgent 必须是有效的 Agent 实例/);
  assert.throws(() => dispatchNativeMessage({}, {}), /未提供有效的原生接收方法/);
});

test('executeSessionCall: 安全防线拦截测试 (通配符/自呼叫/超长消息/空参数)', async () => {
  const caller = createMockAgent('caller-session-12345678');
  const target = createMockAgent('target-session-87654321');
  const ctx = createMockCtx({ agentsList: [caller, target] });
  const exec = { agent: caller };

  // 1. 空参数或空 target_session_id / message 拦截
  await assert.rejects(
    () => executeSessionCall({ ctx, args: null, exec }),
    /参数必须为对象/
  );
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: '', message: 'hi' }, exec }),
    /必须提供 target_session_id/
  );
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: 'target-12345678', message: '' }, exec }),
    /必须提供非空的 message/
  );

  // 2. 严禁通配符广播 (*, all, broadcast)
  for (const wildcard of ['*', 'all', 'broadcast', 'ALL', 'Broadcast']) {
    await assert.rejects(
      () => executeSessionCall({ ctx, args: { target_session_id: wildcard, message: 'ping' }, exec }),
      /session_call 拒绝广播：禁止使用通配符/
    );
  }

  // 3. 严禁自身调用自身 (防止死循环)
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'caller-session-12345678', message: 'hello self' },
      exec
    }),
    /session_call 拒绝自呼叫：严禁调用自身 Session ID/
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
    /message 长度不能超过 4000 字符/
  );
});

test('executeSessionCall: 会话前缀解析与歧义熔断机制', async () => {
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
    /session_call 拒绝短前缀：前缀 "cluster" 长度小于 8 位/
  );

  // 2. 歧义熔断：前缀 "cluster-worker-node-alpha" 匹配到 alpha-1 和 alpha-2 两个会话
  await assert.rejects(
    () => executeSessionCall({
      ctx,
      args: { target_session_id: 'cluster-worker-node-alpha', message: 'ping' },
      exec
    }),
    /session_call 熔断保护：目标前缀 "cluster-worker-node-alpha" 匹配到 2 个活跃会话/
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
    /session_call 目标不存在：未找到匹配 "non-existent-session-id" 的活跃会话/
  );
});

test('executeSessionCall: 归档会话熔断屏蔽', async () => {
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
    /session_call 目标不存在：未找到匹配 "archived-session-33334444" 的活跃会话（或已归档）/
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

  // 检验接收到的 UserMessage 结构
  const dispatchedToIdle = idleTarget.received[0].msg;
  assert.equal(dispatchedToIdle.role, 'user');
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
  assert.equal(dispatchedToRunning.content[0].text, 'Urgent halt signal');
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

test('executeSessionCall: 规范接入 ctx.logger("dsh-call-session") 并降噪至 debug', async () => {
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
  assert.equal(captured.filter(l => l.level !== 'debug').length, 0, '禁止产生非 debug 级别的控制台噪音');
});
