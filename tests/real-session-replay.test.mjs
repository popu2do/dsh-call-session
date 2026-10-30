import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveNativeSessionStatus } from '../lib/session-directory.mjs';
import { executeSessionCall } from '../lib/session-call.mjs';
import { createMockAgent, silentLogger } from './helpers/mock-agent.mjs';

const REAL_ZSTD_PATH = process.env.DSH_TEST_ZSTD_PATH;

function loadRealOrFallbackEvents() {
  if (REAL_ZSTD_PATH && fs.existsSync(REAL_ZSTD_PATH)) {
    try {
      const output = execSync(`zstdcat ${REAL_ZSTD_PATH} | tail -n 120`, {
        maxBuffer: 10 * 1024 * 1024
      }).toString().trim();
      const lines = output.split('\n').filter(Boolean);
      return lines.map(line => JSON.parse(line));
    } catch {}
  }

  // 1:1 从真实物理会话账本提取的崩溃尾帧事件序列
  return [
    { type: 'step/start', seq: 2909, time: 1792470209870, data: { turn: 35, step: 1 } },
    { type: 'step/end', seq: 2910, time: 1792470209871, data: { turn: 35, step: 1 } },
    { type: 'turn/end', seq: 2911, time: 1792470209874, data: { turn: 35, reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")', code: 'UNKNOWN' } } } },
    { type: 'turn/start', seq: 2913, time: 1792470295900, data: { turn: 36 } },
    { type: 'step/start', seq: 2915, time: 1792470296195, data: { turn: 36, step: 1 } },
    { type: 'step/end', seq: 2916, time: 1792470296196, data: { turn: 36, step: 1 } },
    { type: 'turn/end', seq: 2917, time: 1792470296197, data: { turn: 36, reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")', code: 'UNKNOWN' } } } },
    { type: 'turn/start', seq: 2919, time: 1792486175170, data: { turn: 37 } },
    { type: 'step/start', seq: 2921, time: 1792486175253, data: { turn: 37, step: 1 } },
    { type: 'step/end', seq: 2922, time: 1792486175254, data: { turn: 37, step: 1 } },
    { type: 'turn/end', seq: 2923, time: 1792486175255, data: { turn: 37, reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")', code: 'UNKNOWN' } } } }
  ];
}

test('真机账本回放: 真实物理崩溃事件流推导为 error 且分类为 ASSEMBLY', () => {
  const events = loadRealOrFallbackEvents();
  assert.ok(events.length > 0, '必须加载到真实或回放事件序列');

  const realAgentMock = {
    id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
    title: '插件工具调用返回值验证 1',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
      events,
      snapshotEvents: () => events
    }
  };

  const statusRes = resolveNativeSessionStatus(realAgentMock);
  assert.equal(statusRes.status, 'error', '具有真实装配崩溃事件的会话必须解析为 error');
  assert.equal(statusRes.error.category, 'ASSEMBLY', '提示词变量缺失必须准确分类为 ASSEMBLY');
  assert.ok(statusRes.error.message.includes('prompt variable "{{model}}"'), '错误信息必须包含缺失变量名');
});

test('真机账本回放: 向真实崩溃会话发起 task_dispatch 触发前置健康阻断', async () => {
  const events = loadRealOrFallbackEvents();
  const caller = createMockAgent('caller-replay');

  let receivedCalls = [];
  const realAgentMock = {
    id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
    title: '插件工具调用返回值验证 1',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
      events,
      snapshotEvents: () => events
    },
    followup(msg) {
      receivedCalls.push(msg);
    }
  };

  const ctx = {
    agents: {
      get: (id) => (id === realAgentMock.id ? realAgentMock : (id === caller.id ? caller : null)),
      list: () => [realAgentMock, caller]
    },
    logger: () => silentLogger
  };

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: realAgentMock.id,
      message: '测试向真实故障会话发指令',
      call_type: 'task_dispatch',
      wait_ms: 500
    },
    exec: { agent: caller }
  });

  assert.equal(res.success, false, '向真实崩溃会话派发任务必须返回 false');
  assert.equal(res.deliveryState, 'failed');
  assert.equal(res.executionState, 'crashed');
  assert.equal(res.error.code, 'PREFLIGHT_TARGET_IN_ERROR');
  assert.equal(res.error.category, 'PREFLIGHT');
  assert.ok(res.error.message.includes('prompt variable "{{model}}"'), '前置阻断必须附带真实装配崩溃原因');
  assert.equal(receivedCalls.length, 0, '前置健康阻断必须拦截消息入队，目标信箱不被写入任何数据');
});

test('真机账本回放: 向真实崩溃会话发起 task_report 自动转存公共黑板', async () => {
  const events = loadRealOrFallbackEvents();
  const caller = createMockAgent('caller-replay-worker');

  const realAgentMock = {
    id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
    title: '插件工具调用返回值验证 1',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      id: 'session-8c5cbede-01ae-48fe-8e5a-3ead04a889f7',
      events,
      snapshotEvents: () => events
    }
  };

  const storedPosts = [];
  const mockBoardStore = {
    post(entry) {
      storedPosts.push(entry);
      return entry;
    }
  };

  const ctx = {
    agents: {
      get: (id) => (id === realAgentMock.id ? realAgentMock : (id === caller.id ? caller : null)),
      list: () => [realAgentMock, caller]
    },
    logger: () => silentLogger
  };

  const res = await executeSessionCall({
    ctx,
    args: {
      target_session_id: realAgentMock.id,
      message: '工作者执行成果报告正文',
      call_type: 'task_report'
    },
    exec: { agent: caller },
    options: { boardStore: mockBoardStore }
  });

  assert.equal(res.success, true, '向崩溃目标回传成果时必须降级放行返回成功');
  assert.equal(storedPosts.length, 1, '必须向公共黑板成功转存 1 条记录');
  assert.equal(storedPosts[0].topic, 'report:fallback');
  assert.ok(storedPosts[0].content.includes('工作者执行成果报告正文'));
  assert.ok(storedPosts[0].tags.includes('report'));
  assert.ok(storedPosts[0].tags.includes('fallback'));
  assert.ok(res.fallbackPostId, '出参必须携带黑板转存条目编号');
});
