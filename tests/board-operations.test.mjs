import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { BoardStore, BoardToolsAdapter, normalizeExecParams } from '../lib/board-store.mjs';

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
  assert.ok(reservedRes.error.includes('[ReservedTopic]'));

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
  assert.equal(listAlpha.scope, '/workspaces/alpha');
  assert.equal(listAlpha.titlesOnly, true);
  assert.equal(listAlpha.posts[0].id, postAlpha.postId);
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
  assert.ok(failRes.error.includes('[InvalidParameter]'));

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

  // 验证 mode: 'purge' 物理删除（移出存储，不保留为 archived）
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
  const store = new BoardStore({ storagePath, debounceMs: 0, config: { locale: 'zh' } });

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

  const dummyStore = Object.create(BoardStore.prototype);
  const mockAgent = createMockAgent('agent-test-dir', { title: 'Worker Alpha', cwd: '/workspaces/unified' });
  const dirInfo = dummyStore.resolveCallerContext(mockAgent);
  assert.equal(dirInfo.authorSessionId, 'agent-test-dir');
  assert.equal(dirInfo.authorTitle, 'Worker Alpha');
  assert.equal(dirInfo.callerWorkspace, '/workspaces/unified');

  const fromPos = normalizeExecParams({ a: 1 }, { e: 2 }, { c: 3 });
  assert.deepEqual(fromPos.args, { a: 1 });
  assert.deepEqual(fromPos.exec, { e: 2 });
  assert.deepEqual(fromPos.ctx, { c: 3 });

  const fromEmpty = normalizeExecParams();
  assert.deepEqual(fromEmpty.args, {});
  assert.equal(fromEmpty.exec, undefined);
  assert.equal(fromEmpty.ctx, undefined);
});

test('BoardStore.executeList: 异常分支返回值严格符合 ADR-0016 §4.2 必须出参契约', async () => {
  const badStore = Object.create(BoardStore.prototype);
  badStore.list = () => { throw new Error('底层查询模拟异常'); };
  badStore.resolveCallerContext = () => ({ callerWorkspace: '/workspaces/mock' });
  badStore.logger = { debug() {} };

  const failRes = await badStore.executeList({ args: { cross_workspace: false, titles_only: false } });
  assert.equal(failRes.success, false);
  assert.equal(failRes.count, 0);
  assert.equal(typeof failRes.scope, 'string');
  assert.equal(failRes.scope, '/workspaces/mock');
  assert.equal(typeof failRes.titlesOnly, 'boolean');
  assert.equal(failRes.titlesOnly, false);
  assert.deepEqual(failRes.posts, []);
  assert.ok(failRes.error.includes('底层查询模拟异常'));

  const failGlobal = await badStore.executeList({ args: { cross_workspace: true } });
  assert.equal(failGlobal.scope, 'global');
  assert.equal(failGlobal.titlesOnly, true);
});

test('BoardToolsAdapter: 独立实例化与门面完整契约 (executePost / executeList / executeClear / getAuthorReminder)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-adapter-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });
  const adapter = new BoardToolsAdapter(store, { config: { locale: 'zh' } });

  // 1. 验证 store._adapter 默认为 BoardToolsAdapter 实例
  assert.ok(store._adapter instanceof BoardToolsAdapter);
  assert.equal(store._adapter.store, store);

  const agentAlpha = createMockAgent('agent-alpha', { title: 'Alpha Worker', cwd: '/workspaces/proj-a' });
  const agentBeta = createMockAgent('agent-beta', { title: 'Beta Worker', cwd: '/workspaces/proj-b' });

  // 2. adapter.executePost 发布条目并验证返回值结构与消息双语渲染
  const postRes = await adapter.executePost({
    args: {
      topic: 'task:compile',
      content: 'Compile source files',
      tags: ['compile', 'p1'],
      ttl: 600
    },
    exec: { agent: agentAlpha }
  });
  assert.equal(postRes.success, true);
  assert.ok(postRes.postId.startsWith('post-'));
  assert.equal(postRes.topic, 'task:compile');
  assert.equal(postRes.authorSessionId, 'agent-alpha');
  assert.equal(postRes.scope, '/workspaces/proj-a');
  assert.ok(postRes.message.includes('已发布条目'));

  // 验证底层纯存储已包含该条目
  const rawPost = store.get(postRes.postId);
  assert.ok(rawPost);
  assert.equal(rawPost.content, 'Compile source files');

  // 3. adapter.executeList 验证工作区过滤与 crossWorkspace
  const listAlpha = await adapter.executeList({
    args: {},
    exec: { agent: agentAlpha }
  });
  assert.equal(listAlpha.success, true);
  assert.equal(listAlpha.count, 1);
  assert.equal(listAlpha.scope, '/workspaces/proj-a');

  const listBeta = await adapter.executeList({
    args: {},
    exec: { agent: agentBeta }
  });
  assert.equal(listBeta.count, 0);

  const listCross = await adapter.executeList({
    args: { cross_workspace: true },
    exec: { agent: agentBeta }
  });
  assert.equal(listCross.count, 1);

  // 4. adapter.getAuthorReminder 验证作者提醒生成
  const reminder = adapter.getAuthorReminder(agentAlpha);
  assert.ok(reminder.includes('你在公共黑板上有 1 条尚未清理的有效条目'));
  assert.ok(reminder.includes('task:compile'));

  // 5. adapter.executeClear 验证条目归档清理
  const clearRes = await adapter.executeClear({
    args: { id: postRes.postId, mode: 'dismiss' },
    exec: { agent: agentAlpha }
  });
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.clearedCount, 1);
  assert.equal(clearRes.action, 'archive');
  assert.ok(clearRes.message.includes('已归档 1 条'));
  assert.equal(store.get(postRes.postId)?.status, 'archived');

  // 6. 清理后提醒为空
  assert.equal(adapter.getAuthorReminder(agentAlpha), '');

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('BoardToolsAdapter: 保留主题拦截与入参防御', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-adapter-err-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });
  const adapter = new BoardToolsAdapter(store);
  const agent = createMockAgent('agent-err', { cwd: '/workspaces/err' });

  // 1. 保留主题拦截
  const resReserved = await adapter.executePost({
    args: { topic: 'telemetry:metrics', content: 'telemetry data' },
    exec: { agent }
  });
  assert.equal(resReserved.success, false);
  assert.ok(resReserved.error.includes('[ReservedTopic]'));

  // 2. 清理缺少 id 与 topic 报错拦截
  const resClearInvalid = await adapter.executeClear({
    args: {},
    exec: { agent }
  });
  assert.equal(resClearInvalid.success, false);
  assert.ok(resClearInvalid.error.includes('[InvalidParameter]'));

  // 3. store.clear 异常容灾
  const faultyStore = Object.create(BoardStore.prototype);
  faultyStore.clear = () => { throw new Error('底层存储异常'); };
  faultyStore.resolveCallerContext = () => ({ callerWorkspace: '/workspaces/faulty' });
  const faultyAdapter = new BoardToolsAdapter(faultyStore);
  const resFaultyClear = await faultyAdapter.executeClear({
    args: { id: 'some-id' },
    exec: { agent }
  });
  assert.equal(resFaultyClear.success, false);
  assert.equal(resFaultyClear.clearedCount, 0);
  assert.ok(resFaultyClear.error.includes('底层存储异常'));

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('BoardToolsAdapter: 主题校验收口与 BoardStore 纯存储分离', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-pure-store-'));
  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 0 });
  const adapter = new BoardToolsAdapter(store);

  // 1. 底层纯存储 rawPost 不包含主题保留逻辑，纯粹作为 Map 与持久化存储
  const rawRecord = { id: 'post-raw-1', topic: 'telemetry:internal', content: 'raw internal metrics', status: 'active' };
  const saved = store.rawPost(rawRecord);
  assert.equal(saved.id, 'post-raw-1');
  assert.equal(store.get('post-raw-1')?.topic, 'telemetry:internal');

  // 2. adapter.validateTopic 独立校验能力
  assert.throws(() => adapter.validateTopic('telemetry:call'), /\[ReservedTopic\]/);
  assert.throws(() => adapter.validateTopic('task:telemetry'), /\[ReservedTopic\]/);
  assert.doesNotThrow(() => adapter.validateTopic('task:deploy'));

  // 3. adapter.post 拦截保留主题并委托正常条目
  assert.throws(() => adapter.post({ id: 'p-bad', topic: 'call:steer', content: 'bad' }), /\[ReservedTopic\]/);
  const legalPost = adapter.post({ id: 'p-legal', topic: 'task:build', content: 'legal build' });
  assert.equal(legalPost.id, 'p-legal');
  assert.equal(store.get('p-legal')?.content, 'legal build');

  // 4. adapter.filterDirtyPosts 清洗脏数据
  const dirtyPosts = [
    { id: 'p1', topic: 'task:audit' },
    { id: 'p2', topic: 'telemetry:trace' },
    { id: 'p3', topic: 'call:steer' },
    { id: 'p4', topic: 'spec:release' }
  ];
  const { cleanedPosts, dirtyCount } = adapter.filterDirtyPosts(dirtyPosts);
  assert.equal(dirtyCount, 2);
  assert.deepEqual(cleanedPosts.map(p => p.id), ['p1', 'p4']);

  await store.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
