import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSessionCall } from '../lib/session-call.mjs';
import { createMockAgent, silentLogger } from './helpers/mock-agent.mjs';

function createMockCtx(agentsList = []) {
  const registered = new Map(agentsList.map(a => [a.id, a]));
  return {
    agents: {
      list: () => Array.from(registered.values()),
      get: (id) => registered.get(id) || null
    },
    logger: () => silentLogger
  };
}

test('因果确权: 40毫秒内处于 running 但无步数推进时决不提前退出假确权', async () => {
  const caller = createMockAgent('caller-causal-1');
  let loopPolledCount = 0;

  const targetZeroStep = {
    id: 'target-zero-step',
    title: 'Zero Step Worker',
    status: 'running',
    phase: { kind: 'running', turn: 1, step: 0 },
    session: { id: 'target-zero-step', events: [] },
    received: [],
    followup(msg) {
      this.received.push(msg);
    }
  };

  const ctx = createMockCtx([caller, targetZeroStep]);
  const startTime = Date.now();

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-zero-step',
      message: 'Task step zero test',
      call_type: 'task_dispatch',
      wait_ms: 120
    },
    exec: { agent: caller }
  });

  const duration = Date.now() - startTime;
  assert.ok(duration >= 100, `必须持续观察至窗口期满，实际等待 ${duration}ms，不能在40ms提前退出`);
});

test('因果确权: 步进为零且在第85毫秒发生延迟崩溃时能够被完整截获', async () => {
  const caller = createMockAgent('caller-causal-2');

  const targetDelayedCrash = {
    id: 'target-delayed-crash',
    title: 'Delayed Crash Worker',
    status: 'idle',
    phase: { kind: 'idle' },
    session: { id: 'target-delayed-crash', events: [] },
    received: [],
    followup(msg) {
      this.received.push(msg);
      this.phase = { kind: 'running', turn: 1, step: 0 };
      // 模拟宿主时序：在第 85 毫秒发生装配期异常
      setTimeout(() => {
        this.session.events.push({
          type: 'turn/end',
          data: {
            turn: 1,
            reason: {
              kind: 'error',
              error: {
                message: 'prompt variable "{{model}}" has no value for this assembly',
                code: 'UNKNOWN'
              }
            }
          }
        });
        this.status = 'idle';
        this.phase = { kind: 'idle' };
      }, 85);
    }
  };

  const ctx = createMockCtx([caller, targetDelayedCrash]);

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-delayed-crash',
      message: 'Run delayed crash',
      call_type: 'task_dispatch',
      wait_ms: 300
    },
    exec: { agent: caller }
  });

  assert.equal(res.success, false, '延迟装配崩溃必须被截获并返回 false');
  assert.equal(res.deliveryState, 'failed');
  assert.equal(res.executionState, 'crashed');
  assert.equal(res.error.category, 'ASSEMBLY');
  assert.ok(res.error.message.includes('prompt variable "{{model}}"'), '错误中必须无损保留装配异常详情');
});

test('因果确权: 目标处于并发运行态时，未产生当前调用因果步数推进时防范伪确权', async () => {
  const caller = createMockAgent('caller-causal-3');

  // 目标正处于上一个并发长任务中，步数已经达到 5
  const targetBusyRunning = {
    id: 'target-busy-running',
    title: 'Busy Worker',
    status: 'running',
    phase: { kind: 'running', turn: 1, step: 5 },
    session: {
      id: 'target-busy-running',
      events: [
        { type: 'step/start', data: { step: 1 } },
        { type: 'step/start', data: { step: 2 } },
        { type: 'step/start', data: { step: 3 } },
        { type: 'step/start', data: { step: 4 } },
        { type: 'step/start', data: { step: 5 } }
      ]
    },
    received: [],
    followup(msg) {
      this.received.push(msg);
      // 消息入信箱排队，但上一个长任务未结束，step 依然维持为 5，未生成新步骤事件
    }
  };

  const ctx = createMockCtx([caller, targetBusyRunning]);
  const startTime = Date.now();

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-busy-running',
      message: 'Enqueue secondary task',
      call_type: 'task_dispatch',
      wait_ms: 100
    },
    exec: { agent: caller }
  });

  const duration = Date.now() - startTime;
  assert.ok(duration >= 90, `必须等待满窗口，实际等待 ${duration}ms，不能在第0毫秒误判已确权`);
  assert.equal(res.deliveryState, 'enqueued', '并发长任务未轮到新任务时必须如实返回排队状态');
  assert.equal(res.executionState, 'pending', '执行状态必须为 pending，绝非伪确权 running');
});

test('因果确权: 目标新产生步骤事件时即刻完成真确权并放行', async () => {
  const caller = createMockAgent('caller-causal-4');

  const targetHealthy = {
    id: 'target-healthy-step',
    title: 'Healthy Step Worker',
    status: 'idle',
    phase: { kind: 'idle' },
    session: { id: 'target-healthy-step', events: [] },
    received: [],
    followup(msg) {
      this.received.push(msg);
      this.phase = { kind: 'running', turn: 1, step: 1 };
      // 推进步骤事件
      this.session.events.push({ type: 'step/start', data: { step: 1 } });
    }
  };

  const ctx = createMockCtx([caller, targetHealthy]);

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: 'target-healthy-step',
      message: 'Run normal task',
      call_type: 'task_dispatch',
      wait_ms: 300
    },
    exec: { agent: caller }
  });

  assert.equal(res.deliveryState, 'delivered');
  assert.equal(res.executionState, 'running');
  assert.equal(res.targetStatus, 'running');
});
