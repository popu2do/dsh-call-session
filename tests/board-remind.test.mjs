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
import { apply } from '../index.mjs';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-remind-test-'));
}

function createMockAgent(id, { cwd = 'c:/workspace/project-alpha' } = {}) {
  return {
    id,
    session: {
      id,
      header: { cwd }
    }
  };
}

function createMockContext() {
  const contexts = new Map();
  const promptSections = new Map();
  const tools = new Map();
  const commands = new Map();
  const eventHandlers = new Map();

  return {
    systemPrompt: {
      context(def) {
        contexts.set(def.name, def);
      },
      getContext(name) {
        return contexts.get(name);
      },
      add(id, getter, options) {
        promptSections.set(id, { getter, options });
      }
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
      },
      get(name) {
        return tools.get(name);
      }
    },
    commands: {
      register(cmd) {
        commands.set(cmd.name, cmd);
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
    })
  };
}

test('formatAuthorReminderText: 文本生成格式与边界处理', () => {
  // 1. 无条目或非法输入返回空字符串
  assert.equal(formatAuthorReminderText(), '');
  assert.equal(formatAuthorReminderText([]), '');
  assert.equal(formatAuthorReminderText(null), '');

  // 2. 单条条目正常格式化
  const singlePost = [{
    id: 'post-001',
    topic: 'task:audit',
    status: 'active'
  }];
  const singleText = formatAuthorReminderText(singlePost);
  assert.ok(singleText.includes('1 条尚未清理的有效条目'));
  assert.ok(singleText.includes('#post-001 (task:audit)'));
  assert.ok(singleText.includes('board_clear'));

  // 3. 多条条目（<= 3 条）全部列出
  const twoPosts = [
    { id: 'post-001', topic: 'task:audit', status: 'active' },
    { id: 'post-002', topic: 'spec:api', status: 'active' }
  ];
  const twoText = formatAuthorReminderText(twoPosts);
  assert.ok(twoText.includes('2 条尚未清理的有效条目'));
  assert.ok(twoText.includes('#post-001 (task:audit)'));
  assert.ok(twoText.includes('#post-002 (spec:api)'));

  // 4. 超过 3 条条目时截断并提示总数
  const fourPosts = [
    { id: 'p-1', topic: 't1', status: 'active' },
    { id: 'p-2', topic: 't2', status: 'active' },
    { id: 'p-3', topic: 't3', status: 'active' },
    { id: 'p-4', topic: 't4', status: 'active' }
  ];
  const fourText = formatAuthorReminderText(fourPosts);
  assert.ok(fourText.includes('4 条尚未清理的有效条目'));
  assert.ok(fourText.includes('#p-1 (t1)'));
  assert.ok(fourText.includes('#p-2 (t2)'));
  assert.ok(fourText.includes('#p-3 (t3)'));
  assert.ok(fourText.includes('等共 4 条'));
});

test('findActiveByAuthor: 检索当前会话的活跃未过期条目', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  const ws = 'c:/workspace/project-alpha';

  // 初始为空
  assert.deepEqual(store.findActiveByAuthor('session-1', ws), []);

  // 插入属于 session-1 的活跃条目
  store.post({
    id: 'post-1',
    topic: 'task:1',
    content: 'msg 1',
    authorSessionId: 'session-1',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now,
    expiresAtMs: now + 60000
  });

  // 插入属于 session-2 的活跃条目
  store.post({
    id: 'post-2',
    topic: 'task:2',
    content: 'msg 2',
    authorSessionId: 'session-2',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now + 10,
    expiresAtMs: now + 60000
  });

  // 检索 session-1
  const s1Posts = store.findActiveByAuthor('session-1', ws);
  assert.equal(s1Posts.length, 1);
  assert.equal(s1Posts[0].id, 'post-1');

  // 检索 session-2
  const s2Posts = store.findActiveByAuthor('session-2', ws);
  assert.equal(s2Posts.length, 1);
  assert.equal(s2Posts[0].id, 'post-2');

  // 检索未发布条目的 session-3
  assert.deepEqual(store.findActiveByAuthor('session-3', ws), []);

  await store.close();
});

test('会话隔离性：不同会话之间互不干扰', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  const ws = 'c:/workspace/project-alpha';

  store.post({
    id: 'post-alpha',
    topic: 'alpha:task',
    content: 'alpha content',
    authorSessionId: 'session-alpha',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now,
    expiresAtMs: now + 60000
  });

  // 验证 session-beta 绝不查到 session-alpha 的条目
  const betaActive = store.findActiveByAuthor('session-beta', ws);
  assert.equal(betaActive.length, 0);
  assert.equal(formatAuthorReminderText(betaActive), '');

  // 验证 session-alpha 能够准确查到
  const alphaActive = store.findActiveByAuthor('session-alpha', ws);
  assert.equal(alphaActive.length, 1);
  assert.equal(alphaActive[0].id, 'post-alpha');
  assert.ok(formatAuthorReminderText(alphaActive).includes('#post-alpha'));

  await store.close();
});

test('工作区隔离性 (ADR-0003)：相同 Session ID 在不同工作区相互隔离', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  const wsAlpha = 'c:/workspace/project-alpha';
  const wsBeta = 'c:/workspace/project-beta';

  store.post({
    id: 'post-in-alpha',
    topic: 'build',
    content: 'alpha build',
    authorSessionId: 'shared-session-id',
    authorWorkspace: normalizeWorkspace(wsAlpha),
    status: 'active',
    createdAtMs: now,
    expiresAtMs: now + 60000
  });

  // 在 wsBeta 工作区查询同一 Session ID 不应泄漏
  const betaFound = store.findActiveByAuthor('shared-session-id', wsBeta);
  assert.equal(betaFound.length, 0);

  // 在 wsAlpha 工作区查询正常返回
  const alphaFound = store.findActiveByAuthor('shared-session-id', wsAlpha);
  assert.equal(alphaFound.length, 1);
  assert.equal(alphaFound[0].id, 'post-in-alpha');

  await store.close();
});

test('条目清理后提醒自动消失：board_clear 归档与物理删除生效', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  const ws = 'c:/workspace/project-alpha';

  store.post({
    id: 'post-clear-test',
    topic: 'task:temp',
    content: 'temp work',
    authorSessionId: 'session-worker',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now,
    expiresAtMs: now + 60000
  });

  // 清理前有提醒
  let active = store.findActiveByAuthor('session-worker', ws);
  assert.equal(active.length, 1);
  assert.notEqual(formatAuthorReminderText(active), '');

  // 1. 测试归档清理 (dismiss / archive)
  store.clear({ id: 'post-clear-test', action: 'archive' });
  active = store.findActiveByAuthor('session-worker', ws);
  assert.equal(active.length, 0);
  assert.equal(formatAuthorReminderText(active), '');

  // 2. 重新发布并测试物理删除 (purge / delete)
  store.post({
    id: 'post-purge-test',
    topic: 'task:purge',
    content: 'purge work',
    authorSessionId: 'session-worker',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now,
    expiresAtMs: now + 60000
  });
  active = store.findActiveByAuthor('session-worker', ws);
  assert.equal(active.length, 1);

  store.clear({ id: 'post-purge-test', action: 'delete' });
  active = store.findActiveByAuthor('session-worker', ws);
  assert.equal(active.length, 0);
  assert.equal(formatAuthorReminderText(active), '');

  await store.close();
});

test('自然过期适配：条目超时失效后提醒自动消除', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  const ws = 'c:/workspace/project-alpha';

  // 插入已过期的条目（模拟 TTL 超过当前时间）
  store.post({
    id: 'post-expired',
    topic: 'task:expired',
    content: 'expired content',
    authorSessionId: 'session-ttl',
    authorWorkspace: normalizeWorkspace(ws),
    status: 'active',
    createdAtMs: now - 10000,
    expiresAtMs: now - 1000 // 已经过期 1 秒
  });

  // 自动识别为 expired 并过滤掉
  const active = store.findActiveByAuthor('session-ttl', ws);
  assert.equal(active.length, 0);
  assert.equal(formatAuthorReminderText(active), '');

  // 验证 store 中条目状态被更新为 expired
  const post = store.get('post-expired');
  assert.equal(post.status, 'expired');

  await store.close();
});

test('纯状态幂等性：提醒文本不含动态时间戳且生成结果一致 (ADR-0010 Invariant 1)', () => {
  const posts = [
    { id: 'post-fix-1', topic: 'fix:auth', status: 'active' },
    { id: 'post-fix-2', topic: 'refactor:db', status: 'active' }
  ];

  // 1. 验证提醒文本绝不包含任何易逝动态时间戳
  const text = formatAuthorReminderText(posts);
  assert.equal(/(\d{4}-\d{2}-\d{2}|remaining|\d+m\b|\d+s\b|ago|分钟前|秒前)/i.test(text), false);

  // 2. 模拟连续 10 步 LLM reasoning step，在黑板状态不变时文本一致
  const stepOutputs = [];
  for (let step = 0; step < 10; step++) {
    stepOutputs.push(formatAuthorReminderText(posts));
  }

  for (let i = 1; i < stepOutputs.length; i++) {
    assert.equal(stepOutputs[i], stepOutputs[0], `第 ${i} 步生成的文本与第 0 步一致`);
  }
});

test('apply: 在 systemPrompt.context 中正确注册 board:remind 并实现端到端注入', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockContext();
  const storagePath = path.join(tmpDir, 'board.json');

  apply(ctx, {
    storagePath,
    debounceMs: 50,
    remindContextOrder: 130
  });

  // 1. 验证 context 注册元数据
  const remindContext = ctx.systemPrompt.getContext('board:remind');
  assert.ok(remindContext, '应注册 board:remind 上下文注入');
  assert.equal(remindContext.order, 130);
  assert.equal(typeof remindContext.text, 'function');

  // 2. 当前会话无条目时，调用返回空字符串
  const agent1 = createMockAgent('agent-1', { cwd: 'c:/workspace/proj' });
  assert.equal(remindContext.text({ agent: agent1 }), '');

  // 3. 通过 board_post 插入条目
  const boardPostTool = ctx.tools.get('board_post');
  await boardPostTool.execute({
    topic: 'task:deploy',
    content: 'deploying service'
  }, { agent: agent1 });

  // 4. 再次获取 context，应当包含提醒
  const injectedText = remindContext.text({ agent: agent1 });
  assert.ok(injectedText.includes('1 条尚未清理的有效条目'));
  assert.ok(injectedText.includes('task:deploy'));
  assert.ok(injectedText.includes('board_clear'));

  // 5. 换一个会话查询，应当为空（隔离性）
  const agent2 = createMockAgent('agent-2', { cwd: 'c:/workspace/proj' });
  assert.equal(remindContext.text({ agent: agent2 }), '');

  // 6. agent1 调用 board_clear 清理条目
  const boardClearTool = ctx.tools.get('board_clear');
  await boardClearTool.execute({
    topic: 'task:deploy',
    mode: 'dismiss'
  }, { agent: agent1 });

  // 7. 清理后提醒立即消失
  assert.equal(remindContext.text({ agent: agent1 }), '');

  await ctx.emit('dispose');
});
