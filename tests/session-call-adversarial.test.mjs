import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
} from '../lib/session-call.mjs';
import {
  executeSessionQuery
} from '../lib/session-query.mjs';
import {
  CallTelemetryRingBuffer
} from '../lib/call-telemetry.mjs';
import { createMockAgent } from './helpers/mock-agent.mjs';


function createMockCtx({
  agentsList = [],
  archivedIds = []
} = {}) {
  const agentMap = new Map(agentsList.map(a => [a.id, a]));
  const ringBuffer = new CallTelemetryRingBuffer(100);

  return {
    agents: {
      list: () => agentsList,
      get: (id) => agentMap.get(id)
    },
    archivedSessions: {
      list: () => archivedIds
    },
    callTelemetry: ringBuffer,
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: (name) => {
      if (name === 'callTelemetry') return ringBuffer;
      return undefined;
    }
  };
}

test('自呼叫与变种参数防御检查', async () => {
  const callerId = 'session-caller-12345678-abcd';
  const caller = createMockAgent(callerId);
  const targetOther = createMockAgent('session-target-87654321-wxyz');

  const ctx = createMockCtx({
    agentsList: [caller, targetOther]
  });
  const exec = { agent: caller };

  // 1.1 完全相等自呼叫
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: callerId,
        message: 'Ping self'
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[SelfCallForbidden\]/);
      return true;
    }
  );

  // 1.2 大小写混合混淆自呼叫
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: callerId.toUpperCase(),
        message: 'Ping self uppercase'
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[SelfCallForbidden\]/);
      return true;
    }
  );

  // 1.3 前缀自呼叫处理 (传入自身的 >=8 位前缀)
  const callerPrefix = callerId.slice(0, 18); // "session-caller-123"
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: callerPrefix,
        message: 'Ping self prefix attack'
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[SelfCallForbidden\]/);
      return true;
    }
  );

  // 1.4 安全核验：自呼叫全流程 caller 绝未收到任何唤醒消息
  assert.equal(caller.received.length, 0, '自呼叫拦截不触发唤醒');
});

test('通配符目标调用拦截检查', async () => {
  const caller = createMockAgent('session-caller-alpha-1234');
  const targetA = createMockAgent('session-worker-alpha-1234');
  const targetB = createMockAgent('session-worker-beta-5678');

  const ctx = createMockCtx({
    agentsList: [caller, targetA, targetB]
  });
  const exec = { agent: caller };

  // 2.1 基础通配符与大小写变种
  const wildcardTargets = [
    '*',
    '**',
    'all',
    'ALL',
    'All',
    'broadcast',
    'BROADCAST',
    '*.*',
    'session-*',
    '*worker*',
    '?',
    'session-worker-?',
    '@all',
    '@everyone'
  ];

  for (const target of wildcardTargets) {
    await assert.rejects(
      async () => {
        await executeSessionCall(ctx, {
          target_session_id: target,
          message: 'Broadcast payload'
        }, exec);
      },
      (err) => {
        assert.match(err.message, /\[WildcardForbidden\]/);
        return true;
      },
      `通配符目标 [${target}] 必须被严格拒绝`
    );
  }

  // 验证没有任何目标被错误唤醒
  assert.equal(targetA.received.length, 0);
  assert.equal(targetB.received.length, 0);
});

test('短前缀与歧义前缀调用处理', async () => {
  const caller = createMockAgent('session-caller-00000001');

  // 构造两个相同前缀的活跃会话: "session-conflict-worker-1" vs "session-conflict-worker-2"
  const conflict1 = createMockAgent('session-conflict-worker-1');
  const conflict2 = createMockAgent('session-conflict-worker-2');

  // 构造一个唯一前缀会话与一个已归档会话
  const uniqueLive = createMockAgent('session-unique-worker-99');
  const archivedConflict = createMockAgent('session-unique-archived-99');

  const ctx = createMockCtx({
    agentsList: [caller, conflict1, conflict2, uniqueLive, archivedConflict],
    archivedIds: ['session-unique-archived-99']
  });
  const exec = { agent: caller };

  // 3.1 超短前缀拦截 (<8 字符)
  const shortPrefixes = ['s', 'ses', 'session', 'sess-1'];
  for (const shortPfx of shortPrefixes) {
    await assert.rejects(
      async () => {
        await executeSessionCall(ctx, {
          target_session_id: shortPfx,
          message: 'Short prefix test'
        }, exec);
      },
      (err) => {
        assert.match(err.message, /\[InvalidParameter\]/);
        return true;
      }
    );
  }

  // 3.2 多义歧义前缀多重匹配熔断 (Ambiguity Conflict)
  const ambiguousPrefix = 'session-conflict'; // >= 8 字符，匹配到 conflict1 与 conflict2
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: ambiguousPrefix,
        message: 'Ambiguous call'
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[AmbiguousPrefix\]/);
      assert.ok(err.message.includes('session-conflict-worker-1'));
      assert.ok(err.message.includes('session-conflict-worker-2'));
      return true;
    }
  );
  assert.equal(conflict1.received.length, 0);
  assert.equal(conflict2.received.length, 0);

  // 3.3 归档会话剔除与唯一活跃会话匹配
  // session-unique 匹配到 uniqueLive 和 archivedConflict，但 archived 必须自动排除，成功投递给 uniqueLive
  const okRes = await executeSessionCall(ctx, {
    target_session_id: 'session-unique',
    message: 'Hit unique live session'
  }, exec);
  assert.equal(okRes.success, true);
  assert.equal(okRes.targetSessionId, 'session-unique-worker-99');
  assert.equal(uniqueLive.received.length, 1);
  assert.equal(archivedConflict.received.length, 0);

  // 3.4 纯归档目标会话呼叫防御拦截
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: 'session-unique-archived-99',
        message: 'Call dead session'
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[TargetNotFound\]/);
      return true;
    }
  );
});

test('session_query 跨工作区隔离与查询限制', async () => {
  const wsAlpha = 'c:/workspace/project-alpha';
  const wsBeta = 'c:/workspace/project-beta';
  const wsGamma = 'c:/workspace/project-gamma';

  const callerAlpha = createMockAgent('agent-caller-alpha', { cwd: wsAlpha, title: 'Alpha Lead' });

  const agents = [
    callerAlpha,
    createMockAgent('agent-worker-alpha-1', { cwd: wsAlpha, title: 'Alpha Worker 1' }),
    createMockAgent('agent-worker-alpha-2', { cwd: wsAlpha, title: 'Alpha Worker 2' }),
    createMockAgent('agent-worker-beta-1', { cwd: wsBeta, title: 'Beta Core Engine' }),
    createMockAgent('agent-worker-beta-2', { cwd: wsBeta, title: 'Beta QA Tester' }),
    createMockAgent('agent-worker-gamma-1', { cwd: wsGamma, title: 'Gamma Ingest' })
  ];

  const ctx = createMockCtx({ agentsList: agents });
  const execAlpha = { agent: callerAlpha };

  // 4.1 默认隔离：Alpha 会话探针只能看到 Alpha 自身与同工程会话
  const queryAlpha = await executeSessionQuery(ctx, {}, execAlpha);
  assert.equal(queryAlpha.success, true);
  assert.equal(queryAlpha.count, 3, 'Alpha 工作区返回 3 个同工作区会话');

  const alphaIds = queryAlpha.sessions.map(s => s.sessionId);
  assert.ok(alphaIds.includes('agent-caller-alpha'));
  assert.ok(alphaIds.includes('agent-worker-alpha-1'));
  assert.ok(alphaIds.includes('agent-worker-alpha-2'));
  assert.ok(!alphaIds.includes('agent-worker-beta-1'), '不包含 Beta 工作区会话');
  assert.ok(!alphaIds.includes('agent-worker-gamma-1'), '不包含 Gamma 工作区会话');

  // 4.2 模糊关键词查询：试图搜索 "Beta"
  const leakAttempt = await executeSessionQuery(ctx, { query: 'Beta' }, execAlpha);
  assert.equal(leakAttempt.count, 0, '关键词匹配外部工作区标题时不返回结果');

  // 4.3 显式声明 cross_workspace: true 时的跨工作区查询
  const globalQuery = await executeSessionQuery(ctx, { cross_workspace: true }, execAlpha);
  assert.equal(globalQuery.count, 6, '显式跨工作区查询返回 6 个会话');
});

test('超长 Payload 与异常输入边界容错', async () => {
  const caller = createMockAgent('session-caller-limit-1');
  const target = createMockAgent('session-target-limit-2');
  const ctx = createMockCtx({ agentsList: [caller, target] });
  const exec = { agent: caller };

  // 5.1 超长 Message 熔断 (>4000 字符)
  const hugeMessage = 'M'.repeat(4001);
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: 'session-target-limit-2',
        message: hugeMessage
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[InvalidParameter\]/);
      return true;
    }
  );

  // 5.2 空消息与非法类型拦截
  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: 'session-target-limit-2',
        message: '   \r\n\t  '
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[InvalidParameter\]/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: 'session-target-limit-2',
        message: 12345
      }, exec);
    },
    (err) => {
      assert.match(err.message, /\[InvalidParameter\]/);
      return true;
    }
  );

  // 5.3 畸形 context_post_ids 清洗与语义消息体生成
  const res = await executeSessionCall(ctx, {
    target_session_id: 'session-target-limit-2',
    message: 'Valid task instruction',
    context_post_ids: ['post-001', '   ', null, 'post-002', 999]
  }, exec);

  assert.equal(res.success, true);
  assert.equal(target.received.length, 1);

  const receivedMsg = target.received[0].msg;
  assert.equal(receivedMsg.role, 'user');
  const textContent = Array.isArray(receivedMsg.content)
    ? receivedMsg.content.map(c => c.text).join('')
    : String(receivedMsg.content);
  assert.ok(textContent.includes('> Context Ref: #post-001, #post-002, #999'));
  assert.ok(textContent.includes('Valid task instruction'));

  // 验证 Semantic MessageSource (DSH 格式 v4 生产者归属契约)
  assert.equal(receivedMsg.source.kind, 'plugin:dsh-call-session');
  assert.notEqual(receivedMsg.source.kind, 'plugin');
  assert.equal(receivedMsg.source.plugin, undefined);
  assert.equal(receivedMsg.source.form, 'notice');
});

test('session_call 逆境测试: 目标 followup 同步抛出致命异常时不崩溃发起方且安全返回 failed (ADR-0031)', async () => {
  const caller = createMockAgent('caller-adv-throw');
  const targetThrower = {
    id: 'target-thrower-agent-1234',
    title: 'Throwing Target',
    status: 'idle',
    received: [],
    followup() {
      throw new Error('Kernel PANIC: In-memory mailbox corrupted');
    }
  };

  const ctx = createMockCtx({ agentsList: [caller, targetThrower] });
  const exec = { agent: caller };

  // 同步抛错必须被安全拦截转化为 failed 结构化回执，严禁导致发起方进程崩溃
  const res = await executeSessionCall(ctx, {
    target_session_id: 'target-thrower-agent-1234',
    message: 'Test crash safety'
  }, exec);

  assert.equal(res.success, false);
  assert.equal(res.deliveryState, 'failed');
  assert.equal(res.executionState, 'crashed');
  assert.equal(res.error.code, 'DISPATCH_ERROR');
  assert.ok(res.error.message.includes('Kernel PANIC'));
  assert.ok(res.message.includes('单播分发失败'));
});

test('session_call 逆境测试: 握手轮询中途目标被销毁或注销时安全退出不假死 (ADR-0031)', async () => {
  const caller = createMockAgent('caller-adv-vanish');
  const targetVanishing = {
    id: 'target-vanishing-agent-5678',
    title: 'Vanishing Target',
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 0 },
    session: {
      id: 'target-vanishing-agent-5678',
      events: []
    },
    received: [],
    followup(msg) {
      this.received.push(msg);
      // 模拟在握手等待中途第 20ms 目标被宿主销毁或置空
      setTimeout(() => {
        this.session = null;
        this.phase = null;
        this.status = undefined;
      }, 20);
    }
  };

  const ctx = createMockCtx({ agentsList: [caller, targetVanishing] });
  const exec = { agent: caller };

  const res = await executeSessionCall(ctx, {
    target_session_id: 'target-vanishing-agent-5678',
    message: 'Test mid-flight vanish',
    call_type: 'task_dispatch',
    wait_ms: 100
  }, exec);

  // 必须安全退出循环，优雅判定为排队或降级，零未捕获异常
  assert.equal(res.success, true);
  assert.ok(res.deliveryState === 'enqueued' || res.deliveryState === 'delivered');
});

test('session_call 边界测试: 极值与异常 wait_ms (0, 负数, 溢出, NaN) 安全处理 (ADR-0031)', async () => {
  const caller = createMockAgent('caller-adv-boundary');
  const target = createMockAgent('target-adv-boundary', { status: 'idle' });
  const ctx = createMockCtx({ agentsList: [caller, target] });
  const exec = { agent: caller };

  // 1. wait_ms = 0：零等待绕过
  const start0 = Date.now();
  const res0 = await executeSessionCall(ctx, {
    target_session_id: 'target-adv-boundary',
    message: 'Zero wait test',
    call_type: 'task_dispatch',
    wait_ms: 0
  }, exec);
  const dur0 = Date.now() - start0;
  assert.equal(res0.success, true);
  assert.equal(res0.deliveryState, 'enqueued');
  assert.ok(dur0 < 25, 'wait_ms: 0 耗时必须低于 25ms');

  // 2. wait_ms 负数：安全钳位为 0
  const resNeg = await executeSessionCall(ctx, {
    target_session_id: 'target-adv-boundary',
    message: 'Negative wait test',
    call_type: 'task_dispatch',
    wait_ms: -500
  }, exec);
  assert.equal(resNeg.success, true);
  assert.equal(resNeg.deliveryState, 'enqueued');

  // 3. wait_ms 非法类型 (NaN 与 字符串)：安全回退
  const resNan = await executeSessionCall(ctx, {
    target_session_id: 'target-adv-boundary',
    message: 'NaN wait test',
    call_type: 'task_dispatch',
    wait_ms: NaN
  }, exec);
  assert.equal(resNan.success, true);
});

test('session_call 逆境测试: 历史陈旧错误与当前轮次严格隔离，不产生误拦截 (ADR-0031)', async () => {
  const caller = createMockAgent('caller-adv-history');
  // 目标在历史多轮发生过 3 次崩溃，但当前处于就绪状态
  const targetHistory = {
    id: 'target-history-agent-9999',
    title: 'Historical Error Worker',
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 3 },
    session: {
      id: 'target-history-agent-9999',
      events: [
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'Old err 1' } } } },
        { type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { message: 'Old err 2' } } } },
        { type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { message: 'Old err 3' } } } }
      ]
    },
    received: [],
    followup(msg) {
      this.received.push(msg);
      // 本轮正常拉起并维持 running
      this.phase = { kind: 'running', turn: 4 };
    }
  };

  const ctx = createMockCtx({ agentsList: [caller, targetHistory] });
  const exec = { agent: caller };

  const res = await executeSessionCall(ctx, {
    target_session_id: 'target-history-agent-9999',
    message: 'Run turn 4 normally',
    call_type: 'task_dispatch',
    wait_ms: 100
  }, exec);

  // 验证当前轮次未发生新报错，决不能被历史旧报错误杀为 crashed
  assert.equal(res.success, true);
  assert.equal(res.deliveryState, 'delivered');
  assert.equal(res.executionState, 'running');
  assert.equal(res.targetStatus, 'running');
});

test('session_call 并发竞态测试: 多调用方同时发起 task_dispatch 轻量握手无状态踩踏 (ADR-0031)', async () => {
  const caller1 = createMockAgent('caller-race-1');
  const caller2 = createMockAgent('caller-race-2');
  const caller3 = createMockAgent('caller-race-3');

  const sharedTarget = {
    id: 'shared-race-target-agent',
    title: 'Shared Race Target',
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 0 },
    session: {
      id: 'shared-race-target-agent',
      events: []
    },
    received: [],
    followup(msg) {
      this.received.push(msg);
      this.phase = { kind: 'running', turn: this.received.length };
    }
  };

  const ctx = createMockCtx({ agentsList: [caller1, caller2, caller3, sharedTarget] });

  // 3 个调用方并发调用同一目标
  const results = await Promise.all([
    executeSessionCall(ctx, { target_session_id: 'shared-race-target-agent', message: 'Task 1' }, { agent: caller1 }),
    executeSessionCall(ctx, { target_session_id: 'shared-race-target-agent', message: 'Task 2' }, { agent: caller2 }),
    executeSessionCall(ctx, { target_session_id: 'shared-race-target-agent', message: 'Task 3' }, { agent: caller3 })
  ]);

  for (const r of results) {
    assert.equal(r.success, true);
    assert.equal(r.executionState, 'running');
  }
  assert.equal(sharedTarget.received.length, 3);
});
