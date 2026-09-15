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

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Agent',
  cwd = 'c:/workspace/project-alpha',
  isSubagent = false
} = {}) {
  const received = [];
  return {
    id,
    status,
    title,
    session: {
      id,
      title,
      cwd,
      header: Object.freeze({
        version: 0,
        id,
        cwd,
        origin: isSubagent ? 'subagent' : undefined
      })
    },
    received,
    steer(msg) {
      received.push({ method: 'steer', msg });
    },
    followup(msg) {
      received.push({ method: 'followup', msg });
    },
    send(msg) {
      received.push({ method: 'send', msg });
    }
  };
}

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
      assert.match(err.message, /不能调用自身 Session ID/);
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
      assert.match(err.message, /不能调用自身 Session ID/);
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
      assert.match(err.message, /不能调用自身 Session ID/);
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
        assert.match(err.message, /不支持通配符/);
        return true;
      },
      `通配符目标 [${target}] 必须被严格拒绝`
    );
  }

  // 验证没有任何目标被误广播唤醒
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
        assert.match(err.message, /前缀.*长度小于 8 位/);
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
      assert.match(err.message, /匹配到 2 个活跃会话/);
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
      assert.match(err.message, /未找到匹配.*活跃会话.*已被归档/);
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
      assert.match(err.message, /message 长度不能超过 4000 字符/);
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
      assert.match(err.message, /必须提供非空的 message 参数/);
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
      assert.match(err.message, /必须提供非空的 message 参数/);
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

  // 验证 Semantic MessageSource
  assert.equal(receivedMsg.source.plugin, 'dsh-call-session');
  assert.equal(receivedMsg.source.form, 'notice');
  assert.equal(receivedMsg.source.kind, 'plugin');
});
