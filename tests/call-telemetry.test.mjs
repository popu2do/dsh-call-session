import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  computeSessionShortId
} from '../lib/call-telemetry.mjs';
import { executeSessionCall } from '../lib/session-call.mjs';
import { AtomicBoardStore } from '../lib/board-store.mjs';
import { apply } from '../index.mjs';

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

function createMockCtx({
  agentsList = [],
  archivedIds = [],
  logger = silentLogger,
  callTelemetry = null,
  boardStore = null
} = {}) {
  const archivedSet = new Set(archivedIds);
  const agentMap = new Map(agentsList.map(a => [a.id, a]));
  const listeners = new Map();

  return {
    logger: (scope) => (typeof logger === 'function' ? logger(scope) : logger),
    callTelemetry: callTelemetry || null,
    boardStore: boardStore || null,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    async emit(event, ...args) {
      const handlers = listeners.get(event) || [];
      for (const h of handlers) {
        await h(...args);
      }
    },
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
      if (name === 'boardStore') return this.boardStore;
      if (name === 'callTelemetry') return this.callTelemetry;
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

test('CallTelemetryRingBuffer: 容量约束与 FIFO 淘汰机制 (ADR-0012 Invariant 3)', () => {
  const buffer = new CallTelemetryRingBuffer(10);
  assert.equal(buffer.capacity(), 10);
  assert.equal(buffer.size(), 0);

  // 写入 15 条记录
  for (let i = 1; i <= 15; i++) {
    buffer.record({
      callerSessionId: `caller-${i}`,
      targetSessionId: `target-${i}`,
      messagePayload: `Message ${i}`
    });
  }

  // 验证容量硬上限与淘汰最旧条目
  assert.equal(buffer.size(), 10);
  const records = buffer.query({ limit: 10 });
  assert.equal(records.length, 10);
  assert.equal(records[0].callerSessionId, 'caller-6');
  assert.equal(records[9].callerSessionId, 'caller-15');

  // 清空操作
  buffer.clear();
  assert.equal(buffer.size(), 0);
  assert.equal(buffer.query().length, 0);
});

test('CallTelemetryRingBuffer: 容量上下界安全钳位 (10 ~ 2000)', () => {
  const lowBuffer = new CallTelemetryRingBuffer(3);
  assert.equal(lowBuffer.capacity(), 10);

  const highBuffer = new CallTelemetryRingBuffer(5000);
  assert.equal(highBuffer.capacity(), 2000);

  const defaultBuffer = new CallTelemetryRingBuffer();
  assert.equal(defaultBuffer.capacity(), 200);
});

test('CallTelemetryRingBuffer: 记录元数据清洗与摘要截断 (<= 120 字符)', () => {
  const buffer = new CallTelemetryRingBuffer(20);
  const longText = 'A'.repeat(200);

  const rec = buffer.record({
    callerSessionId: 'sess-a',
    targetSessionId: 'sess-b',
    callerWorkspace: 'C:\\Workspace\\Project\\App',
    targetWorkspace: 'C:/Workspace/Project/App',
    messagePayload: `Line 1\n\nLine 2\t${longText}`
  });

  assert.ok(rec.id.startsWith('call-'));
  assert.equal(rec.status, 'active');
  assert.equal(rec.callType, 'task_dispatch');
  assert.equal(rec.deliveryMode, 'followup');
  assert.ok(rec.messageSnippet.length <= 120);
  assert.ok(rec.messageSnippet.endsWith('...'));
  assert.equal(rec.callerWorkspace, 'c:/Workspace/Project/App');
  assert.equal(rec.targetWorkspace, 'c:/Workspace/Project/App');
});

test('CallTelemetryRingBuffer: 工作区隔离查询与跨工程透视 (ADR-0003 & ADR-0012)', () => {
  const buffer = new CallTelemetryRingBuffer(50);
  buffer.record({
    callerSessionId: 'sess-a1',
    targetSessionId: 'sess-a2',
    callerWorkspace: 'c:/workspace/proj-a',
    targetWorkspace: 'c:/workspace/proj-a',
    messagePayload: 'proj-a internal'
  });
  buffer.record({
    callerSessionId: 'sess-b1',
    targetSessionId: 'sess-b2',
    callerWorkspace: 'c:/workspace/proj-b',
    targetWorkspace: 'c:/workspace/proj-b',
    messagePayload: 'proj-b internal'
  });
  buffer.record({
    callerSessionId: 'sess-a1',
    targetSessionId: 'sess-b1',
    callerWorkspace: 'c:/workspace/proj-a',
    targetWorkspace: 'c:/workspace/proj-b',
    messagePayload: 'cross call'
  });

  // 1. 隔离查询 proj-a: 包含内部与发往 proj-b 的跨工程调用，严格排除纯 proj-b
  const resA = buffer.query({ workspace: 'c:/workspace/proj-a', crossWorkspace: false });
  assert.equal(resA.length, 2);
  assert.ok(resA.some(r => r.messagePayload === 'proj-a internal'));
  assert.ok(resA.some(r => r.messagePayload === 'cross call'));
  assert.ok(!resA.some(r => r.messagePayload === 'proj-b internal'));

  // 2. 隔离查询 proj-b: 包含内部与接收自 proj-a 的调用，严格排除纯 proj-a
  const resB = buffer.query({ workspace: 'c:/workspace/proj-b', crossWorkspace: false });
  assert.equal(resB.length, 2);
  assert.ok(resB.some(r => r.messagePayload === 'proj-b internal'));
  assert.ok(resB.some(r => r.messagePayload === 'cross call'));
  assert.ok(!resB.some(r => r.messagePayload === 'proj-a internal'));

  // 3. 跨工程全局透视: 全部返回
  const resGlobal = buffer.query({ crossWorkspace: true });
  assert.equal(resGlobal.length, 3);
});

test('CallTelemetryRingBuffer: 会话注销级联清理 (settleSession & cleanupSession)', () => {
  const buffer = new CallTelemetryRingBuffer(50);
  buffer.record({
    callerSessionId: 'session-alpha',
    targetSessionId: 'session-beta',
    messagePayload: 'msg 1'
  });
  buffer.record({
    callerSessionId: 'session-gamma',
    targetSessionId: 'session-alpha',
    messagePayload: 'msg 2'
  });
  buffer.record({
    callerSessionId: 'session-beta',
    targetSessionId: 'session-gamma',
    messagePayload: 'msg 3'
  });

  // 1. 软清理：settleSession 将涉及 session-alpha 的调用标为 settled
  const affected = buffer.settleSession('session-alpha');
  assert.equal(affected, 2);

  const queryAll = buffer.query({ crossWorkspace: true });
  assert.equal(queryAll[0].status, 'settled');
  assert.equal(queryAll[1].status, 'settled');
  assert.equal(queryAll[2].status, 'active');

  // 2. 物理清理：cleanupSession(mode: 'purge') 抹除涉及 session-alpha 的记录
  const purged = buffer.cleanupSession('session-alpha', 'purge');
  assert.equal(purged, 2);
  assert.equal(buffer.size(), 1);
  assert.equal(buffer.query({ crossWorkspace: true })[0].messagePayload, 'msg 3');
});

test('session_call 端到端集成：执行单播时自动记录内存遥测快照', async () => {
  const caller = createMockAgent('caller-node-101', { cwd: 'c:/workspace/main', title: 'Captain' });
  const target = createMockAgent('target-node-202', { cwd: 'c:/workspace/main', title: 'Worker', status: 'running' });

  const ringBuffer = new CallTelemetryRingBuffer(50);
  const ctx = createMockCtx({
    agentsList: [caller, target],
    callTelemetry: ringBuffer
  });
  const exec = { agent: caller };

  const callRes = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-node-202',
      message: 'Deploy microservice v2',
      call_type: 'task_dispatch',
      context_post_ids: ['post-100', 'post-101']
    },
    exec
  });

  assert.equal(callRes.success, true);
  assert.equal(callRes.deliveryMode, 'steer');

  // 验证 RingBuffer 中已记录遥测
  assert.equal(ringBuffer.size(), 1);
  const [record] = ringBuffer.query({ crossWorkspace: true });
  assert.equal(record.callerSessionId, 'caller-node-101');
  assert.equal(record.targetSessionId, 'target-node-202');
  assert.equal(record.callerTitle, 'Captain');
  assert.equal(record.targetTitle, 'Worker');
  assert.equal(record.callType, 'task_dispatch');
  assert.equal(record.deliveryMode, 'steer');
  assert.deepEqual(record.contextPostIds, ['post-100', 'post-101']);
  assert.equal(record.messagePayload, 'Deploy microservice v2');
  assert.equal(record.messageSnippet, 'Deploy microservice v2');
  assert.equal(record.status, 'active');
  assert.ok(typeof record.durationMs === 'number');
});

test('getCanvasTelemetry: 零被动唤醒验证 (ADR-0012 Invariant 2 & Gate 2)', async () => {
  let wakeCount = 0;
  const countWake = () => { wakeCount++; };

  const idle1 = createMockAgent('idle-agent-1', { status: 'idle', steerFn: countWake, followupFn: countWake, sendFn: countWake });
  const idle2 = createMockAgent('idle-agent-2', { status: 'idle', steerFn: countWake, followupFn: countWake, sendFn: countWake });
  const idle3 = createMockAgent('idle-agent-3', { status: 'idle', steerFn: countWake, followupFn: countWake, sendFn: countWake });

  const ringBuffer = new CallTelemetryRingBuffer(50);
  const ctx = createMockCtx({
    agentsList: [idle1, idle2, idle3],
    callTelemetry: ringBuffer
  });

  // 连续调用 100 次 getCanvasTelemetry
  for (let i = 0; i < 100; i++) {
    const snapshot = await getCanvasTelemetry(ctx, { crossWorkspace: true });
    assert.equal(snapshot.sessions.length, 3);
  }

  // 断言被动唤醒次数为 0
  assert.equal(wakeCount, 0, '读取画板遥测不触发 Agent 唤醒');
});

test('getCanvasTelemetry: 全景快照结构完整性与离线级联对齐', async () => {
  const agent1 = createMockAgent('agent-live-1', { status: 'running', cwd: 'c:/workspace/app', title: 'Live Agent 1' });
  const agent2 = createMockAgent('agent-live-2', { status: 'idle', cwd: 'c:/workspace/app', title: 'Live Agent 2' });

  const ringBuffer = new CallTelemetryRingBuffer(50);
  // 记录一条 live 间调用
  ringBuffer.record({
    callerSessionId: 'agent-live-1',
    targetSessionId: 'agent-live-2',
    callerWorkspace: 'c:/workspace/app',
    targetWorkspace: 'c:/workspace/app',
    messagePayload: 'live to live'
  });
  // 记录一条指向离线会话的调用
  ringBuffer.record({
    callerSessionId: 'agent-live-1',
    targetSessionId: 'agent-offline-x',
    callerWorkspace: 'c:/workspace/app',
    targetWorkspace: 'c:/workspace/app',
    messagePayload: 'live to offline'
  });

  const ctx = createMockCtx({
    agentsList: [agent1, agent2],
    archivedIds: ['agent-offline-x'],
    callTelemetry: ringBuffer
  });

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/app' });

  // 验证快照顶级结构
  assert.ok(typeof snapshot.timestamp === 'number');
  assert.equal(snapshot.currentWorkspace, 'c:/workspace/app');
  assert.equal(snapshot.sessions.length, 2);
  assert.equal(snapshot.workspaces.length, 1);
  assert.equal(snapshot.workspaces[0].isCurrent, true);
  assert.deepEqual(snapshot.workspaces[0].sessionIds, ['agent-live-1', 'agent-live-2']);

  // 验证会话指标统计
  const session1 = snapshot.sessions.find(s => s.id === 'agent-live-1');
  assert.equal(session1.stats.outboundCalls, 2);
  assert.equal(session1.stats.inboundCalls, 0);

  const session2 = snapshot.sessions.find(s => s.id === 'agent-live-2');
  assert.equal(session2.stats.outboundCalls, 0);
  assert.equal(session2.stats.inboundCalls, 1);

  // 验证调用状态自动级联对齐：指向离线会话的调用自动落定 (settled)
  assert.equal(snapshot.calls.length, 2);
  const liveCall = snapshot.calls.find(c => c.messagePayload === 'live to live');
  assert.equal(liveCall.status, 'active');

  const offlineCall = snapshot.calls.find(c => c.messagePayload === 'live to offline');
  assert.equal(offlineCall.status, 'settled');

  // 验证全局指标
  assert.equal(snapshot.metrics.totalSessions, 2);
  assert.equal(snapshot.metrics.runningSessions, 1);
  assert.equal(snapshot.metrics.activeCalls, 1);
  assert.equal(snapshot.metrics.totalPosts, 0);
});

test('Prompt KV Cache 防御与工具集物理隔离 (ADR-0012 Invariant 4 & Gate 3)', () => {
  const registeredTools = new Map();
  const mockTools = {
    register: (tool) => { registeredTools.set(tool.name, tool); },
    get: (name) => registeredTools.get(name)
  };

  const ctx = {
    logger: () => silentLogger,
    tools: mockTools,
    commands: { register: () => {} },
    systemPrompt: { add: () => {}, context: () => {} },
    on: () => {}
  };

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'dsh-call-test-'));
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath });

  // 检验 ctx.tools 注册清单：遥测接口不暴露给大模型
  assert.ok(!registeredTools.has('getCanvasTelemetry'), '禁止将 getCanvasTelemetry 暴露为大模型工具');
  assert.ok(!registeredTools.has('call_telemetry'), '禁止将 call_telemetry 暴露为大模型工具');
  assert.ok(!registeredTools.has('canvas_telemetry'), '禁止将 canvas_telemetry 暴露为大模型工具');

  // 仅标准协作原语存在
  const allowedTools = ['board_post', 'board_list', 'board_clear', 'session_call', 'session_query', 'session_create'];
  for (const name of registeredTools.keys()) {
    assert.ok(allowedTools.includes(name), `工具 ${name} 不属于允许的 LLM 原生工具集`);
  }
});

test('CallTelemetryRingBuffer: 容量上限与 FIFO 溢出淘汰测试', () => {
  const buffer = new CallTelemetryRingBuffer(50);
  assert.equal(buffer.capacity(), 50);

  const startMs = Date.now();
  for (let i = 1; i <= 1000; i++) {
    buffer.record({
      callerSessionId: `caller-${i}`,
      targetSessionId: `target-${i}`,
      messagePayload: `Telemetry payload #${i}`
    });
  }
  const elapsedMs = Date.now() - startMs;

  // 验证内存占用恒定，保持上限 50
  assert.equal(buffer.size(), 50);
  // 验证 1000 次内存记录执行耗时在 100ms 内
  assert.ok(elapsedMs < 100, `1000 次写入耗时异常: ${elapsedMs}ms`);

  // 验证 FIFO 淘汰：前 950 条被移除，剩余 50 条为 caller-951 到 caller-1000
  const records = buffer.query({ limit: 50, crossWorkspace: true });
  assert.equal(records.length, 50);
  assert.equal(records[0].callerSessionId, 'caller-951');
  assert.equal(records[49].callerSessionId, 'caller-1000');
  assert.equal(records[0].messagePayload, 'Telemetry payload #951');
  assert.equal(records[49].messagePayload, 'Telemetry payload #1000');
});

test('CallTelemetryRingBuffer: 异常参数处理与 query 过滤组合', () => {
  // 1. 非法构造参数安全钳位
  const buffer = new CallTelemetryRingBuffer('invalid');
  assert.equal(buffer.capacity(), 200, '非法容量回退至默认 200');

  const negBuffer = new CallTelemetryRingBuffer(-50);
  assert.equal(negBuffer.capacity(), 10, '负数容量钳位至下限 10');

  const hugeBuffer = new CallTelemetryRingBuffer(99999);
  assert.equal(hugeBuffer.capacity(), 2000, '超大容量钳位至上限 2000');

  // 2. 非法 record 输入保护
  assert.throws(() => buffer.record(null), /entry 必须是对象/);
  assert.throws(() => buffer.record('string'), /entry 必须是对象/);

  // 3. 字段缺省值容错
  const emptyRec = buffer.record({});
  assert.equal(emptyRec.callerSessionId, 'unknown-caller');
  assert.equal(emptyRec.targetSessionId, 'unknown-target');
  assert.equal(emptyRec.callType, 'task_dispatch');
  assert.equal(emptyRec.deliveryMode, 'followup');
  assert.equal(emptyRec.messageSnippet, '');
  assert.equal(emptyRec.messagePayload, '');
  assert.equal(emptyRec.status, 'active');
  assert.deepEqual(emptyRec.contextPostIds, []);

  // 4. 多维 query 组合过滤
  const now = Date.now();
  buffer.clear();
  buffer.record({
    callerSessionId: 'sess-x',
    targetSessionId: 'sess-y',
    status: 'active',
    timestamp: now - 5000,
    messagePayload: 'old msg'
  });
  buffer.record({
    callerSessionId: 'sess-x',
    targetSessionId: 'sess-z',
    status: 'settled',
    timestamp: now - 1000,
    messagePayload: 'new settled msg'
  });
  buffer.record({
    callerSessionId: 'sess-w',
    targetSessionId: 'sess-x',
    status: 'active',
    timestamp: now,
    messagePayload: 'new active msg'
  });

  // 4.1 按 since 过滤
  const recent = buffer.query({ since: now - 2000, crossWorkspace: true });
  assert.equal(recent.length, 2);
  assert.equal(recent[0].messagePayload, 'new settled msg');
  assert.equal(recent[1].messagePayload, 'new active msg');

  // 4.2 按 sessionId (不区分大小写匹配 caller 或 target)
  const xCalls = buffer.query({ sessionId: 'SESS-X', crossWorkspace: true });
  assert.equal(xCalls.length, 3);

  const zCalls = buffer.query({ sessionId: 'sess-z', crossWorkspace: true });
  assert.equal(zCalls.length, 1);
  assert.equal(zCalls[0].messagePayload, 'new settled msg');

  // 4.3 按 status 过滤
  const activeCalls = buffer.query({ status: 'active', crossWorkspace: true });
  assert.equal(activeCalls.length, 2);

  const settledCalls = buffer.query({ status: 'settled', crossWorkspace: true });
  assert.equal(settledCalls.length, 1);

  // 4.4 limit 超界或异常参数保护
  const limitQuery1 = buffer.query({ limit: -10, crossWorkspace: true });
  assert.equal(limitQuery1.length, 3);
  const limitQuery2 = buffer.query({ limit: 1, crossWorkspace: true });
  assert.equal(limitQuery2.length, 1);
  assert.equal(limitQuery2[0].messagePayload, 'new active msg');
});

test('session_call: 遥测写入异常隔离', async () => {
  const caller = createMockAgent('caller-node-safe', { cwd: 'c:/workspace/app', title: 'Caller' });
  const target = createMockAgent('target-node-safe', { cwd: 'c:/workspace/app', title: 'Target', status: 'idle' });

  // 构造一个在 record 时抛出异常的 Mock RingBuffer
  const faultRingBuffer = {
    record: () => {
      throw new Error('Simulated RingBuffer Telemetry Hardware Failure');
    }
  };

  const ctx = createMockCtx({
    agentsList: [caller, target],
    callTelemetry: faultRingBuffer
  });

  const exec = { agent: caller };

  // session_call 捕获遥测异常，不阻断单播通信
  const callRes = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-node-safe',
      message: 'Critical production instruction',
      call_type: 'task_dispatch'
    },
    exec
  });

  assert.equal(callRes.success, true);
  assert.equal(callRes.deliveryMode, 'followup');
  assert.equal(target.received.length, 1);
  const receivedText = target.received[0].msg?.content?.[0]?.text || '';
  assert.ok(receivedText.includes('Critical production instruction'), '单播正文应正确投递');
});

test('session_call: call_type、deliveryMode 与复杂文本/黑板引用的完整录制', async () => {
  const caller = createMockAgent('agent-src', { cwd: 'C:\\workspace\\mainapp', title: 'Source Agent' });
  const target = createMockAgent('agent-dst', { cwd: 'c:/workspace/mainapp', title: 'Destination Agent', status: 'running' });

  const ringBuffer = new CallTelemetryRingBuffer(50);
  const ctx = createMockCtx({
    agentsList: [caller, target],
    callTelemetry: ringBuffer
  });

  // 测试 task_report、换行符清洗与多条黑板引用
  const multilineMessage = `Title: Progress Report\n\n- Task 1: Complete\r\n- Task 2: In Review\t[Done]`;
  await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'agent-dst',
      message: multilineMessage,
      call_type: 'task_report',
      context_post_ids: ['post-01', '  post-02  ', '']
    },
    exec: { agent: caller }
  });

  assert.equal(ringBuffer.size(), 1);
  const [rec] = ringBuffer.query({ crossWorkspace: true });
  assert.equal(rec.callType, 'task_report');
  assert.equal(rec.deliveryMode, 'steer'); // running target -> steer
  assert.equal(rec.messagePayload, multilineMessage);
  assert.ok(!rec.messageSnippet.includes('\n'), 'Snippet 换行符应被替换为空格');
  assert.deepEqual(rec.contextPostIds, ['post-01', 'post-02'], '无效与空白的 PostId 需被安全过滤');

  // 测试位置参数签名兼容 executeSessionCall(ctx, args, exec)
  await executeSessionCall(ctx, {
    target_session_id: 'agent-dst',
    message: 'Notice call',
    call_type: 'notice'
  }, { agent: caller });

  assert.equal(ringBuffer.size(), 2);
  const calls = ringBuffer.query({ crossWorkspace: true });
  assert.equal(calls[1].callType, 'notice');
});

test('多工作区边界隔离：三工程交叉调用与 Windows 路径反斜杠规约 (ADR-0003 & ADR-0012)', () => {
  const buffer = new CallTelemetryRingBuffer(50);

  // wsA: c:/work/proj-alpha (测试用反斜杠与大写盘符写入)
  // wsB: c:/work/proj-beta
  // wsC: c:/work/proj-gamma
  buffer.record({
    callerSessionId: 'sess-a1',
    targetSessionId: 'sess-a2',
    callerWorkspace: 'C:\\work\\proj-alpha',
    targetWorkspace: 'C:\\work\\proj-alpha\\',
    messagePayload: 'alpha internal'
  });
  buffer.record({
    callerSessionId: 'sess-a1',
    targetSessionId: 'sess-b1',
    callerWorkspace: 'c:/work/proj-alpha',
    targetWorkspace: 'c:/work/proj-beta',
    messagePayload: 'alpha to beta'
  });
  buffer.record({
    callerSessionId: 'sess-b1',
    targetSessionId: 'sess-c1',
    callerWorkspace: 'c:/work/proj-beta',
    targetWorkspace: 'c:/work/proj-gamma',
    messagePayload: 'beta to gamma'
  });

  // 1. 在 proj-alpha 视界查询（使用小写 POSIX 路径）
  const qAlpha = buffer.query({ workspace: 'c:/work/proj-alpha', crossWorkspace: false });
  assert.equal(qAlpha.length, 2);
  assert.ok(qAlpha.some(r => r.messagePayload === 'alpha internal'));
  assert.ok(qAlpha.some(r => r.messagePayload === 'alpha to beta'));
  assert.ok(!qAlpha.some(r => r.messagePayload === 'beta to gamma'), 'proj-gamma 隔离阻断');

  // 2. 在 proj-beta 视界查询（使用大写 Windows 反斜杠）
  const qBeta = buffer.query({ workspace: 'C:\\work\\proj-beta', crossWorkspace: false });
  assert.equal(qBeta.length, 2);
  assert.ok(qBeta.some(r => r.messagePayload === 'alpha to beta'));
  assert.ok(qBeta.some(r => r.messagePayload === 'beta to gamma'));
  assert.ok(!qBeta.some(r => r.messagePayload === 'alpha internal'), 'proj-alpha internal 隔离阻断');

  // 3. 在 proj-gamma 视界查询
  const qGamma = buffer.query({ workspace: 'c:/work/proj-gamma', crossWorkspace: false });
  assert.equal(qGamma.length, 1);
  assert.equal(qGamma[0].messagePayload, 'beta to gamma');

  // 4. 在无关工程 proj-delta 视界查询
  const qDelta = buffer.query({ workspace: 'c:/work/proj-delta', crossWorkspace: false });
  assert.equal(qDelta.length, 0);

  // 5. 跨工程全局透视 (crossWorkspace: true)
  const qGlobal = buffer.query({ crossWorkspace: true });
  assert.equal(qGlobal.length, 3);
});

test('端到端生命周期总线级联清理测试 (Cordis session/archive, session/remove, workspaceRegistry, dispose)', async () => {
  const eventMap = new Map();
  const registryEvents = new Map();

  const mockWorkspaceRegistry = {
    on(event, handler) {
      if (!registryEvents.has(event)) registryEvents.set(event, []);
      registryEvents.get(event).push(handler);
    },
    emit(event, ...args) {
      for (const h of registryEvents.get(event) || []) h(...args);
    },
    archivedSessionIds: new Set()
  };

  const mockCtx = {
    logger: () => silentLogger,
    tools: { register: () => {}, get: () => {} },
    commands: { register: () => {} },
    systemPrompt: { add: () => {}, context: () => {} },
    on(event, handler) {
      if (!eventMap.has(event)) eventMap.set(event, []);
      eventMap.get(event).push(handler);
    },
    async emit(event, ...args) {
      for (const h of eventMap.get(event) || []) await h(...args);
    },
    get(name) {
      if (name === 'workspaceRegistry') return mockWorkspaceRegistry;
      return undefined;
    }
  };

  // 应用插件初始化
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'dsh-call-test-'));
  const storagePath = path.join(tmpDir, 'board.json');
  apply(mockCtx, { telemetryCapacity: 50, storagePath });

  const ringBuffer = mockCtx.callTelemetry;
  assert.ok(ringBuffer instanceof CallTelemetryRingBuffer);
  assert.equal(ringBuffer.capacity(), 50);

  // 录入测试调用
  ringBuffer.record({ callerSessionId: 'sess-arch-1', targetSessionId: 'sess-worker-1', messagePayload: 'call 1' });
  ringBuffer.record({ callerSessionId: 'sess-arch-2', targetSessionId: 'sess-worker-2', messagePayload: 'call 2' });
  ringBuffer.record({ callerSessionId: 'sess-arch-3', targetSessionId: 'sess-worker-3', messagePayload: 'call 3' });
  ringBuffer.record({ callerSessionId: 'sess-worker-1', targetSessionId: 'sess-worker-2', messagePayload: 'call 4' });

  assert.equal(ringBuffer.size(), 4);

  // 1. 触发 workspaceRegistry.archiveSession 级联
  mockWorkspaceRegistry.emit('archiveSession', 'sess-arch-1');
  const [c1] = ringBuffer.query({ sessionId: 'sess-arch-1', crossWorkspace: true });
  assert.equal(c1.status, 'settled', 'workspaceRegistry 触发 settle');

  // 2. 触发 ctx session/archive (字符串参数)
  await mockCtx.emit('session/archive', 'sess-arch-2');
  const [c2] = ringBuffer.query({ sessionId: 'sess-arch-2', crossWorkspace: true });
  assert.equal(c2.status, 'settled', 'ctx session/archive 触发 settle');

  // 3. 触发 ctx session/remove (对象参数 { id })
  await mockCtx.emit('session/remove', { id: 'sess-arch-3' });
  const [c3] = ringBuffer.query({ sessionId: 'sess-arch-3', crossWorkspace: true });
  assert.equal(c3.status, 'settled', 'ctx session/remove 触发 settle');

  // 未受影响的调用依然为 active
  const [c4] = ringBuffer.query({ sessionId: 'sess-worker-1', status: 'active', crossWorkspace: true });
  assert.equal(c4.messagePayload, 'call 4');

  // 4. 触发 ctx dispose 清空
  await mockCtx.emit('dispose');
  assert.equal(ringBuffer.size(), 0, 'dispose 之后清空调用遥测缓存');
});

test('getCanvasTelemetry: 多 Agent 拓扑聚合与并发查询不唤醒 Agent', async () => {
  let wakeEvents = 0;
  const spyWake = () => { wakeEvents++; };

  // 创建 12 个各种状态的 Agent
  const agents = [];
  for (let i = 1; i <= 12; i++) {
    const isRunning = i <= 4;
    const isSubagent = i > 10;
    agents.push({
      id: `node-agent-${i}`,
      status: isRunning ? 'running' : 'idle',
      origin: isSubagent ? 'subagent' : 'root',
      session: {
        id: `node-agent-${i}`,
        title: `Worker Node ${i}`,
        cwd: i % 2 === 0 ? 'c:/workspace/proj-even' : 'c:/workspace/proj-odd'
      },
      steer: spyWake,
      followup: spyWake,
      send: spyWake
    });
  }

  const ringBuffer = new CallTelemetryRingBuffer(100);
  // 注入跨节点调用
  ringBuffer.record({
    callerSessionId: 'node-agent-1',
    targetSessionId: 'node-agent-2',
    callerWorkspace: 'c:/workspace/proj-odd',
    targetWorkspace: 'c:/workspace/proj-even',
    messagePayload: '跨工程分发任务'
  });

  const ctx = createMockCtx({
    agentsList: agents,
    callTelemetry: ringBuffer
  });

  // 并发执行 200 次 getCanvasTelemetry 查询
  const promises = [];
  for (let j = 0; j < 200; j++) {
    promises.push(getCanvasTelemetry(ctx, { crossWorkspace: true }));
  }
  const snapshots = await Promise.all(promises);

  // 验证快照一致性
  assert.equal(snapshots.length, 200);
  const snap = snapshots[0];
  assert.equal(snap.sessions.length, 12);
  assert.equal(snap.metrics.totalSessions, 12);
  assert.equal(snap.metrics.runningSessions, 4);
  assert.equal(snap.metrics.activeCalls, 1);

  // 验证被动唤醒次数为 0
  assert.equal(wakeEvents, 0, '并发遥测查询不产生被动唤醒');
});

test('内存遥测操作延迟验证', () => {
  const buffer = new CallTelemetryRingBuffer(100);

  // 连续记录 5,000 条调用
  const start = Date.now();
  for (let i = 0; i < 5000; i++) {
    buffer.record({
      callerSessionId: `caller-${i % 20}`,
      targetSessionId: `target-${i % 20}`,
      callerWorkspace: 'c:/workspace/alpha',
      targetWorkspace: 'c:/workspace/beta',
      messagePayload: `Performance payload ${i}`
    });
  }

  // 执行多工作区查询
  for (let k = 0; k < 100; k++) {
    buffer.query({ workspace: 'c:/workspace/alpha', crossWorkspace: false, limit: 50 });
  }
  const totalDuration = Date.now() - start;

  // 5,000 次写入与 100 次过滤查询耗时验证
  assert.ok(totalDuration < 150, `内存遥测操作耗时在预期范围内，当前耗时: ${totalDuration}ms`);
  assert.equal(buffer.size(), 100);
});

test('computeSessionShortId: 规范化 8 位会话短码单元测试 (session- 前缀与裸 uuid 两种形态)', () => {
  // 1. session- 前缀标准形态
  assert.equal(
    computeSessionShortId('session-da929b7d-7912-4e03-a95a-8e76231ed1b7'),
    'da929b7d'
  );
  // 大小写混合与大写 session- 前缀
  assert.equal(
    computeSessionShortId('SESSION-A1B2C3D4-E5F6-7890-ABCD-EF1234567890'),
    'a1b2c3d4'
  );
  // 短于 8 位的 session- 前缀
  assert.equal(computeSessionShortId('session-abc'), 'abc');

  // 2. 裸 uuid 形态 (无 session- 前缀)
  assert.equal(
    computeSessionShortId('da929b7d-7912-4e03-a95a-8e76231ed1b7'),
    'da929b7d'
  );
  assert.equal(
    computeSessionShortId('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'),
    'a1b2c3d4'
  );
  assert.equal(computeSessionShortId('148cf8bd15154caa'), '148cf8bd');
  assert.equal(computeSessionShortId('xyz123'), 'xyz123');

  // 3. 异常边界输入
  assert.equal(computeSessionShortId(null), 'unknown');
  assert.equal(computeSessionShortId(undefined), 'unknown');
  assert.equal(computeSessionShortId(''), 'unknown');
  assert.equal(computeSessionShortId(123456), 'unknown');
  assert.equal(computeSessionShortId('session-'), 'unknown');
  assert.equal(computeSessionShortId('---___---'), 'unknown');
});

test('getCanvasTelemetry: 黑板条目状态三态区分与 metrics 计数口径一致性 (无矛盾断言)', async () => {
  const agent = createMockAgent('session-agent-01', { status: 'running', cwd: 'c:/workspace/app' });
  const ringBuffer = new CallTelemetryRingBuffer(10);
  const now = Date.now();

  const mockBoardStore = {
    list: () => [
      // 1. 活跃未过期条目 1
      {
        id: 'post-act-1',
        topic: 'task:build',
        tags: ['ci'],
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 60000,
        expiresAtMs: now + 3600000,
        content: 'Build in progress',
        status: 'active'
      },
      // 2. 活跃未过期条目 2
      {
        id: 'post-act-2',
        topic: 'task:lint',
        tags: ['qa'],
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 30000,
        expiresAtMs: now + 1800000,
        content: 'Lint passed',
        status: 'active'
      },
      // 3. 自然到期过期条目 (status 为 active 但 expiresAtMs < now)
      {
        id: 'post-exp-natural',
        topic: 'task:old',
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 7200000,
        expiresAtMs: now - 1000,
        content: 'Old notice',
        status: 'active'
      },
      // 4. 显式已过期条目
      {
        id: 'post-exp-explicit',
        topic: 'task:expired',
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 3600000,
        expiresAtMs: now + 10000,
        content: 'Explicitly expired',
        status: 'expired'
      },
      // 5. 已撤销/归档条目 1 (status: archived)
      {
        id: 'post-archived-1',
        topic: 'task:archived',
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 10000,
        expiresAtMs: now + 3600000,
        content: 'Archived post',
        status: 'archived'
      },
      // 6. 已撤销/软删除条目 2 (status: dismissed)
      {
        id: 'post-dismissed-2',
        topic: 'task:dismissed',
        authorSessionId: 'session-agent-01',
        authorWorkspace: 'c:/workspace/app',
        createdAtMs: now - 10000,
        expiresAtMs: now + 3600000,
        content: 'Dismissed post',
        status: 'dismissed'
      }
    ]
  };

  const ctx = createMockCtx({
    agentsList: [agent],
    callTelemetry: ringBuffer,
    boardStore: mockBoardStore
  });

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/app' });

  // 1. 快照包含全部 6 条帖子实体
  assert.equal(snapshot.posts.length, 6);

  // 2. 状态严格分类为 active、expired、archived
  const activePosts = snapshot.posts.filter(p => p.status === 'active');
  const expiredPosts = snapshot.posts.filter(p => p.status === 'expired');
  const archivedPosts = snapshot.posts.filter(p => p.status === 'archived');

  assert.equal(activePosts.length, 2, '活跃条目数量应为 2');
  assert.equal(expiredPosts.length, 2, '过期条目数量应为 2 (含自然过期与显式过期)');
  assert.equal(archivedPosts.length, 2, '撤销归档条目数量应为 2 (含 archived 与 dismissed)');

  // 3. 核心口径一致性断言：同一快照内 metrics 与 posts 筛选结果严格无矛盾
  assert.equal(
    snapshot.metrics.totalPosts,
    activePosts.length,
    'metrics.totalPosts 必须严格等于 active 状态条目数，不包含过期和归档条目'
  );
  assert.equal(
    snapshot.metrics.activePosts,
    activePosts.length,
    'metrics.activePosts 必须严格等于 active 状态条目数'
  );
  assert.notEqual(
    snapshot.metrics.totalPosts,
    snapshot.posts.length,
    '存在过期与归档条目时，metrics.totalPosts 决不能等于 posts.length (防止语义矛盾)'
  );

  // 4. 剩余 TTL 与 isDismissed 标记断言
  for (const post of activePosts) {
    assert.ok(post.ttlRemainingMs > 0, `活跃条目 ${post.id} 的 ttlRemainingMs 应大于 0`);
    assert.equal(post.isDismissed, false, `活跃条目 ${post.id} 的 isDismissed 应为 false`);
  }
  for (const post of expiredPosts) {
    assert.equal(post.ttlRemainingMs, 0, `过期条目 ${post.id} 的 ttlRemainingMs 必须归零`);
    assert.equal(post.isDismissed, true, `过期条目 ${post.id} 的 isDismissed 必须为 true`);
  }
  for (const post of archivedPosts) {
    assert.equal(post.ttlRemainingMs, 0, `撤销条目 ${post.id} 的 ttlRemainingMs 必须归零`);
    assert.equal(post.isDismissed, true, `撤销条目 ${post.id} 的 isDismissed 必须为 true`);
  }
});
