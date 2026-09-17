import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { BoardStore, normalizeExecParams } from '../lib/board-store.mjs';

function createMockAgent(id, {
  title = 'Test Agent',
  cwd = 'c:/workspace/test-project'
} = {}) {
  return {
    id,
    title,
    session: {
      header: { cwd, title },
      metadata: {}
    }
  };
}

test('BoardStore.executePost: 领域操作封装与保留主题拦截', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-op-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });

  const agent = createMockAgent('agent-1', { title: 'Worker Agent', cwd: '/workspaces/alpha' });
  const exec = { agent };

  const reservedRes = await store.executePost({
    args: { topic: 'telemetry:events', content: 'test' },
    exec
  });
  assert.equal(reservedRes.success, false);
  assert.ok(reservedRes.error.includes('保留主题'));

  const postRes = await store.executePost({
    args: {
      topic: 'task:build',
      content: 'Building frontend artifacts',
      tags: ['p0', 'frontend'],
      ttl: 1800
    },
    exec
  });
  assert.equal(postRes.success, true);
  assert.ok(postRes.postId.startsWith('post-'));
  assert.equal(postRes.topic, 'task:build');
  assert.equal(postRes.authorSessionId, 'agent-1');
  assert.equal(postRes.scope, '/workspaces/alpha');

  const stored = store.get(postRes.postId);
  assert.ok(stored);
  assert.equal(stored.content, 'Building frontend artifacts');
  assert.deepEqual(stored.tags, ['p0', 'frontend']);

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('BoardStore.executeList: 工作区作用域隔离与摘要过滤', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-op-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });

  const agentAlpha = createMockAgent('agent-a', { cwd: '/workspaces/alpha' });
  const agentBeta = createMockAgent('agent-b', { cwd: '/workspaces/beta' });

  const postAlpha = await store.executePost({
    args: { topic: 'task:alpha', content: 'Alpha content' },
    exec: { agent: agentAlpha }
  });

  const postBeta = await store.executePost({
    args: { topic: 'task:beta', content: 'Beta content' },
    exec: { agent: agentBeta }
  });

  const listAlpha = await store.executeList({
    args: {},
    exec: { agent: agentAlpha }
  });
  assert.equal(listAlpha.success, true);
  assert.equal(listAlpha.count, 1);
  assert.equal(listAlpha.posts[0].id, postAlpha.postId);
  assert.equal(listAlpha.titlesOnly, true);
  assert.equal(listAlpha.posts[0].content, undefined); // 默认摘要不返回 content

  const listCross = await store.executeList({
    args: { cross_workspace: true },
    exec: { agent: agentAlpha }
  });
  assert.equal(listCross.success, true);
  assert.equal(listCross.count, 2);

  const listDetail = await store.executeList({
    args: { id: postAlpha.postId },
    exec: { agent: agentAlpha }
  });
  assert.equal(listDetail.success, true);
  assert.equal(listDetail.count, 1);
  assert.equal(listDetail.titlesOnly, false);
  assert.equal(listDetail.posts[0].content, 'Alpha content');

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('BoardStore.executeClear: 条目与主题清理', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-op-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });

  const agent = createMockAgent('agent-clear', { cwd: '/workspaces/alpha' });
  const exec = { agent };

  const post = await store.executePost({
    args: { topic: 'task:to-clear', content: 'Will be dismissed' },
    exec
  });

  const failRes = await store.executeClear({ args: {}, exec });
  assert.equal(failRes.success, false);
  assert.ok(failRes.error.includes('必须指定 id 或 topic'));

  const clearRes = await store.executeClear({
    args: { id: post.postId, mode: 'dismiss' },
    exec
  });
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.clearedCount, 1);
  assert.equal(clearRes.action, 'archive');
  assert.equal(store.get(post.postId)?.status, 'archived');

  const afterList = await store.executeList({ args: {}, exec });
  assert.equal(afterList.count, 0);

  // 验证按 topic 批量归档且不影响其他主题
  const p1 = await store.executePost({ args: { topic: 'audit:db', content: 'DB check' }, exec });
  const p2 = await store.executePost({ args: { topic: 'audit:api', content: 'API check' }, exec });
  const pOther = await store.executePost({ args: { topic: 'task:other', content: 'Keep' }, exec });

  const topicRes = await store.executeClear({ args: { topic: 'audit' }, exec });
  assert.equal(topicRes.success, true);
  assert.equal(topicRes.clearedCount, 2);
  assert.equal(store.get(p1.postId)?.status, 'archived');
  assert.equal(store.get(p2.postId)?.status, 'archived');
  assert.equal(store.get(pOther.postId)?.status, 'active');

  // 验证 mode: 'purge' 物理删除（彻底移出存储，不保留为 archived）
  const purgeRes = await store.executeClear({ args: { id: pOther.postId, mode: 'purge' }, exec });
  assert.equal(purgeRes.success, true);
  assert.equal(purgeRes.clearedCount, 1);
  assert.equal(purgeRes.action, 'delete');
  assert.equal(store.get(pOther.postId), undefined);

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('BoardStore.getAuthorReminder: 活跃条目记名提醒封装', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-op-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });

  const agent = createMockAgent('agent-remind', { cwd: '/workspaces/alpha' });
  const exec = { agent };

  assert.equal(store.getAuthorReminder(agent), '');

  await store.executePost({
    args: { topic: 'task:deploy', content: 'Deploying service' },
    exec
  });

  const reminder = store.getAuthorReminder(agent);
  assert.ok(reminder.includes('你在公共黑板上有 1 条尚未清理的有效条目'));
  assert.ok(reminder.includes('task:deploy'));

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('normalizeExecParams: 多态参数解包与工作区解析', () => {
  const fromObj = normalizeExecParams({ args: { a: 1 }, exec: { e: 2 }, ctx: { c: 3 } });
  assert.deepEqual(fromObj.args, { a: 1 });
  assert.deepEqual(fromObj.exec, { e: 2 });
  assert.deepEqual(fromObj.ctx, { c: 3 });

  // 验证 resolveCallerDirectory 统一解析作者会话 ID、目录与工作区
  const dummyStore = Object.create(BoardStore.prototype);
  const mockAgent = createMockAgent('agent-test-dir', { cwd: '/workspaces/unified' });
  const dirInfo = dummyStore.resolveCallerDirectory(mockAgent);
  assert.equal(dirInfo.authorSessionId, 'agent-test-dir');
  assert.equal(dirInfo.callerWorkspace, '/workspaces/unified');
  assert.ok(dirInfo.directory);

  const fromPos = normalizeExecParams({ a: 1 }, { e: 2 }, { c: 3 });
  assert.deepEqual(fromPos.args, { a: 1 });
  assert.deepEqual(fromPos.exec, { e: 2 });
  assert.deepEqual(fromPos.ctx, { c: 3 });

  const fromEmpty = normalizeExecParams();
  assert.deepEqual(fromEmpty.args, {});
  assert.equal(fromEmpty.exec, undefined);
  assert.equal(fromEmpty.ctx, undefined);
});