import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle
} from '../lib/board-store.mjs';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-test-'));
}

test('normalizeWorkspace: 路径标准化与盘符规约', () => {
  assert.equal(normalizeWorkspace(null), '');
  assert.equal(normalizeWorkspace(undefined), '');
  assert.equal(normalizeWorkspace(''), '');
  assert.equal(normalizeWorkspace('   '), '');
  assert.equal(normalizeWorkspace('C:\\Workspace\\Project'), 'c:/Workspace/Project');
  assert.equal(normalizeWorkspace('D:\\Workspace\\Repo\\\\\\'), 'd:/Workspace/Repo');
  assert.equal(normalizeWorkspace('/home/user/project/'), '/home/user/project');
  assert.equal(normalizeWorkspace('e:/repos/app'), 'e:/repos/app');
});

test('extractTitle: 从 Markdown 与元数据提取精炼标题', () => {
  assert.equal(extractTitle(null), '(无标题内容)');
  assert.equal(extractTitle({}), '(无标题内容)');
  assert.equal(extractTitle({ content: '' }), '(无标题内容)');

  // 优先采用 metadata.title
  assert.equal(
    extractTitle({
      content: '# Heading One',
      metadata: { title: 'Explicit Title' }
    }),
    'Explicit Title'
  );

  // Markdown 标题清洗
  assert.equal(
    extractTitle({ content: '### System Architecture Specification' }),
    'System Architecture Specification'
  );

  // 列表符号清洗
  assert.equal(
    extractTitle({ content: '- Task 1: Audit Security' }),
    'Task 1: Audit Security'
  );
  assert.equal(
    extractTitle({ content: '* Task 2: Refactor Store' }),
    'Task 2: Refactor Store'
  );
  assert.equal(
    extractTitle({ content: '1. Task 3: Build Pipeline' }),
    'Task 3: Build Pipeline'
  );

  // 长度截断为 60 字符
  const longText = 'A'.repeat(80);
  assert.equal(extractTitle({ content: longText }), 'A'.repeat(60));
});

test('BoardStore: 基础 CRUD、条目查询与标签过滤', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({
    storagePath,
    debounceMs: 50,
    maxPosts: 50
  });

  const now = Date.now();
  store.post({
    id: 'post-1',
    topic: 'task:audit',
    content: '# Security Audit\nAll green',
    tags: ['security', 'p0'],
    authorSessionId: 'sess-101',
    authorTitle: 'Security Lead',
    authorWorkspace: 'c:/repo',
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAt: new Date(now + 3600 * 1000).toISOString(),
    expiresAtMs: now + 3600 * 1000,
    status: 'active'
  });

  store.post({
    id: 'post-2',
    topic: 'task:build',
    content: 'Build artifact published',
    tags: ['build', 'ci'],
    authorSessionId: 'sess-102',
    authorTitle: 'CI Bot',
    authorWorkspace: 'c:/repo',
    createdAt: new Date(now + 1000).toISOString(),
    createdAtMs: now + 1000,
    expiresAt: new Date(now + 3600 * 1000).toISOString(),
    expiresAtMs: now + 3600 * 1000,
    status: 'active'
  });

  // get
  const retrieved = store.get('post-1');
  assert.ok(retrieved);
  assert.equal(retrieved.topic, 'task:audit');

  // list: 全量查询 (默认 titlesOnly: true 保护 Token 与 KV Cache)
  const listAll = store.list({ callerWorkspace: 'c:/repo' });
  assert.equal(listAll.total, 2);
  assert.equal(listAll.returned, 2);
  assert.equal(listAll.titlesOnly, true);
  assert.equal(listAll.posts[0].id, 'post-2'); // 倒序排序
  assert.equal(listAll.posts[0].content, undefined, '默认全量列表不包含 content 正文');
  assert.equal(listAll.posts[0].remainingSeconds, undefined, '不输出 remainingSeconds');

  // list: 显式指定 titlesOnly: false 全量拉取详情
  const listFull = store.list({ callerWorkspace: 'c:/repo', titlesOnly: false });
  assert.equal(listFull.total, 2);
  assert.equal(listFull.titlesOnly, false);
  assert.equal(listFull.posts[0].content, 'Build artifact published');
  assert.equal(listFull.posts[0].remainingSeconds, undefined);

  // list: 按 topic 精确或前缀匹配
  const auditList = store.list({ topic: 'task:audit', callerWorkspace: 'c:/repo' });
  assert.equal(auditList.total, 1);
  assert.equal(auditList.posts[0].id, 'post-1');

  // list: 按 topicPrefix 匹配
  const prefixList = store.list({ topicPrefix: 'task:', callerWorkspace: 'c:/repo' });
  assert.equal(prefixList.total, 2);

  // list: 按 tag 匹配 (大小写不敏感)
  const tagList = store.list({ tag: 'SECURITY', callerWorkspace: 'c:/repo' });
  assert.equal(tagList.total, 1);
  assert.equal(tagList.posts[0].id, 'post-1');

  // list: 按 authorSessionId 匹配
  const authorList = store.list({ author: 'sess-102', callerWorkspace: 'c:/repo' });
  assert.equal(authorList.total, 1);
  assert.equal(authorList.posts[0].id, 'post-2');

  await store.close();
});

test('BoardStore: 工作区作用域隔离与跨工程查询', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  store.post({
    id: 'post-repo-a',
    topic: 'status',
    content: 'Repo A post',
    authorWorkspace: 'c:/workspace/repo-a',
    createdAtMs: now,
    status: 'active'
  });

  store.post({
    id: 'post-repo-b',
    topic: 'status',
    content: 'Repo B post',
    authorWorkspace: 'c:/workspace/repo-b',
    createdAtMs: now + 10,
    status: 'active'
  });

  // 1. 同工作区查询：默认隔离，仅返回 repo-a
  const scopedList = store.list({ callerWorkspace: 'C:\\workspace\\repo-a' });
  assert.equal(scopedList.total, 1);
  assert.equal(scopedList.posts[0].id, 'post-repo-a');

  // 2. 跨工作区穿透：设置 crossWorkspace: true
  const crossList = store.list({
    callerWorkspace: 'c:/workspace/repo-a',
    crossWorkspace: true
  });
  assert.equal(crossList.total, 2);

  await store.close();
});

test('BoardStore: titlesOnly 摘要模式与格式化输出', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  store.post({
    id: 'post-digest-1',
    topic: 'task:deploy',
    content: '# Production Deploy\nDeploying version 1.0.0 with full telemetry.',
    tags: ['prod'],
    authorSessionId: 'sess-lead',
    authorTitle: 'DevOps Lead',
    authorWorkspace: 'c:/app',
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAtMs: now + 3600 * 1000,
    status: 'active'
  });

  // titlesOnly 查询
  const titlesResult = store.list({ callerWorkspace: 'c:/app', titlesOnly: true });
  assert.equal(titlesResult.total, 1);
  assert.equal(titlesResult.titlesOnly, true);
  const item = titlesResult.posts[0];
  assert.equal(item.title, 'Production Deploy');
  assert.equal(item.content, undefined); // 确保去除了长正文
  assert.ok(item.remainingMinutes > 0);

  // listTitles 与 formatTitleDigest
  const titles = store.listTitles({ callerWorkspace: 'c:/app' });
  assert.equal(titles.length, 1);
  const digest = store.formatTitleDigest(titles);
  assert.ok(digest.includes('[BOARD TITLES: 1 active]'));
  assert.ok(digest.includes('[#post-digest-1]'));
  assert.ok(digest.includes('"Production Deploy"'));
  assert.ok(digest.includes('(by DevOps Lead'));

  // 空摘要返回空字符串
  assert.equal(store.formatTitleDigest([]), '');

  await store.close();
});

test('BoardStore: TTL 到期自动失效', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  // 10 毫秒后即过期
  store.post({
    id: 'post-expiring',
    topic: 'ephemeral',
    content: 'Short lived content',
    createdAtMs: now - 5000,
    expiresAtMs: now - 1000, // 已经过期
    status: 'active'
  });

  const activeList = store.list({ status: 'active' });
  assert.equal(activeList.total, 0, '已过期的条目不应出现在 active 列表中');

  const allList = store.list({ status: 'all' });
  assert.equal(allList.total, 1);
  assert.equal(allList.posts[0].status, 'expired');

  await store.close();
});

test('BoardStore: clear 清理与归档操作', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  store.post({ id: 'p1', topic: 'task:one', content: 'c1', status: 'active' });
  store.post({ id: 'p2', topic: 'task:two', content: 'c2', status: 'active' });
  store.post({ id: 'p3', topic: 'task:two', content: 'c3', status: 'active' });

  // 1. 无条件调用拒绝
  assert.throws(() => store.clear({}), /board_clear 必须指定 id 或 topic/);

  // 2. 按 id 归档 (dismiss)
  const clearIdRes = store.clear({ id: 'p1', action: 'archive' });
  assert.equal(clearIdRes.affectedCount, 1);
  assert.equal(clearIdRes.action, 'archive');
  assert.equal(store.get('p1').status, 'archived');

  // 3. 按 id 物理删除 (purge)
  const purgeIdRes = store.clear({ id: 'p1', action: 'delete' });
  assert.equal(purgeIdRes.affectedCount, 1);
  assert.equal(purgeIdRes.action, 'delete');
  assert.equal(store.get('p1'), undefined);

  // 4. 按 topic 批量归档
  const topicClearRes = store.clear({ topic: 'task:two', action: 'archive' });
  assert.equal(topicClearRes.affectedCount, 2);
  assert.equal(store.get('p2').status, 'archived');
  assert.equal(store.get('p3').status, 'archived');

  await store.close();
});

test('BoardStore: 容量限制与 FIFO 淘汰机制', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const maxPosts = 3;
  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    maxPosts,
    debounceMs: 50
  });

  const now = Date.now();
  // 插入 3 条数据
  store.post({ id: 'p-1', topic: 't', content: '1', createdAtMs: now, status: 'active' });
  store.post({ id: 'p-2', topic: 't', content: '2', createdAtMs: now + 10, status: 'active' });
  store.post({ id: 'p-3', topic: 't', content: '3', createdAtMs: now + 20, status: 'active' });
  assert.equal(store.posts.size, 3);

  // 插入第 4 条数据时，由于全部 active，应当淘汰最老的 p-1
  store.post({ id: 'p-4', topic: 't', content: '4', createdAtMs: now + 30, status: 'active' });
  assert.equal(store.posts.size, 3);
  assert.equal(store.get('p-1'), undefined, '最老条目 p-1 应当被淘汰');
  assert.ok(store.get('p-2'));
  assert.ok(store.get('p-3'));
  assert.ok(store.get('p-4'));

  // 将 p-2 标记为 archived，插入第 5 条数据时应优先淘汰 archived 的 p-2，而非最老 active 的 p-3
  store.get('p-2').status = 'archived';
  store.post({ id: 'p-5', topic: 't', content: '5', createdAtMs: now + 40, status: 'active' });
  assert.equal(store.posts.size, 3);
  assert.equal(store.get('p-2'), undefined, '已归档的 p-2 应当被优先淘汰');
  assert.ok(store.get('p-3'));
  assert.ok(store.get('p-4'));
  assert.ok(store.get('p-5'));

  await store.close();
});

test('BoardStore: 持久化与 .bak 备份恢复测试', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');
  const backupPath = `${storagePath}.bak`;

  // 1. 实例化并写入条目，触发原子落盘
  const store1 = new BoardStore({
    storagePath,
    backupPath,
    debounceMs: 20
  });

  store1.post({
    id: 'persistent-post-1',
    topic: 'spec:api',
    content: 'Important spec content',
    status: 'active',
    createdAtMs: Date.now()
  });

  await store1.close();

  assert.ok(existsSync(storagePath), 'board.json 主文件应当已落盘');
  assert.ok(existsSync(backupPath), 'board.json.bak 备份文件应当已生成');

  // 2. 模拟主文件损坏
  writeFileSync(storagePath, 'INVALID_CORRUPTED_JSON_<<<>>>', 'utf8');

  // 3. 重新实例化，验证从 .bak 备份恢复
  const store2 = new BoardStore({
    storagePath,
    backupPath,
    debounceMs: 20
  });

  const recovered = store2.get('persistent-post-1');
  assert.ok(recovered, '应当成功从 .bak 恢复损坏的黑板条目');
  assert.equal(recovered.topic, 'spec:api');

  await store2.close();
});

test('AtomicBoardStore: 别名导出一致性', () => {
  assert.equal(BoardStore, AtomicBoardStore);
});

test('BoardStore: ADR-0011 规范验证 (默认 titlesOnly: true、id 精确查阅智能分流与显式覆盖)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  store.post({
    id: 'post-adr-1',
    topic: 'task:architecture',
    content: '# ADR-0011 Token Governance\nMassive 64KB architecture spec text goes here...',
    tags: ['adr', 'spec'],
    authorSessionId: 'sess-arch',
    authorTitle: 'Chief Architect',
    authorWorkspace: 'c:/repo',
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAt: new Date(now + 3600 * 1000).toISOString(),
    expiresAtMs: now + 3600 * 1000,
    status: 'active',
    metadata: { version: '1.0' }
  });

  store.post({
    id: 'post-adr-2',
    topic: 'task:implementation',
    content: '## Implementation Detail\nSource code changes in lib/board-store.mjs...',
    tags: ['dev', 'core'],
    authorSessionId: 'sess-dev',
    authorTitle: 'Senior Dev',
    authorWorkspace: 'c:/repo',
    createdAt: new Date(now + 100).toISOString(),
    createdAtMs: now + 100,
    expiresAt: new Date(now + 3600 * 1000).toISOString(),
    expiresAtMs: now + 3600 * 1000,
    status: 'active'
  });

  // 1. 默认集合查询：未传 id 且未传 titlesOnly 时默认为 titlesOnly: true，不包含 content
  const defaultList = store.list({ callerWorkspace: 'c:/repo' });
  assert.equal(defaultList.titlesOnly, true, '集合查询未显式指定时 titlesOnly 默认为 true');
  assert.equal(defaultList.total, 2);
  assert.equal(defaultList.returned, 2);
  for (const post of defaultList.posts) {
    assert.equal(post.content, undefined, '默认摘要模式不包含 content 正文');
    assert.equal(post.remainingSeconds, undefined, '条目中不包含 remainingSeconds 字段');
    assert.ok(post.id);
    assert.ok(post.title);
    assert.ok(post.topic);
    assert.ok(typeof post.remainingMinutes === 'number');
  }

  // 2. 单条点查智能分流：传入 id 且未传 titlesOnly，自动分流默认为 titlesOnly: false，直取完整 content
  const pointDetail = store.list({ id: 'post-adr-1', callerWorkspace: 'c:/repo' });
  assert.equal(pointDetail.titlesOnly, false, '指定 id 且未指定 titlesOnly 时 titlesOnly 为 false');
  assert.equal(pointDetail.total, 1);
  assert.equal(pointDetail.returned, 1);
  assert.equal(pointDetail.posts[0].id, 'post-adr-1');
  assert.equal(pointDetail.posts[0].content, '# ADR-0011 Token Governance\nMassive 64KB architecture spec text goes here...');
  assert.equal(pointDetail.posts[0].remainingSeconds, undefined, '详情模式不包含 remainingSeconds');

  // 3. 显式意图优先 (Caller Intent Supremacy)：传入 id 且显式传 titlesOnly: true，依然返回摘要
  const pointDigest = store.list({ id: 'post-adr-1', titlesOnly: true, callerWorkspace: 'c:/repo' });
  assert.equal(pointDigest.titlesOnly, true);
  assert.equal(pointDigest.total, 1);
  assert.equal(pointDigest.posts[0].id, 'post-adr-1');
  assert.equal(pointDigest.posts[0].content, undefined, '显式指定 titlesOnly: true 时不包含 content');

  // 3b. 蛇形参数别名 titles_only: true 同样遵循显式意图
  const pointDigestSnake = store.list({ id: 'post-adr-1', titles_only: true, callerWorkspace: 'c:/repo' });
  assert.equal(pointDigestSnake.titlesOnly, true);
  assert.equal(pointDigestSnake.posts[0].content, undefined);

  // 4. 显式意图优先：未传 id 但显式指定 titlesOnly: false，全量返回包含 content
  const fullList = store.list({ titlesOnly: false, callerWorkspace: 'c:/repo' });
  assert.equal(fullList.titlesOnly, false);
  assert.equal(fullList.total, 2);
  assert.equal(fullList.posts[0].content, '## Implementation Detail\nSource code changes in lib/board-store.mjs...');
  assert.equal(fullList.posts[1].content, '# ADR-0011 Token Governance\nMassive 64KB architecture spec text goes here...');

  // 4b. 蛇形参数别名 titles_only: false 同样生效
  const fullListSnake = store.list({ titles_only: false, callerWorkspace: 'c:/repo' });
  assert.equal(fullListSnake.titlesOnly, false);
  assert.ok(fullListSnake.posts[0].content);

  // 5. 不存在的 id 精确查询返回空列表
  const nonExistent = store.list({ id: 'post-does-not-exist', callerWorkspace: 'c:/repo' });
  assert.equal(nonExistent.total, 0);
  assert.equal(nonExistent.returned, 0);
  assert.deepEqual(nonExistent.posts, []);

  // 6. 断言所有返回结果序列化字符串均不包含 remainingSeconds
  for (const res of [defaultList, pointDetail, pointDigest, fullList, nonExistent]) {
    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes('remainingSeconds'), false, '返回结果序列化中不包含 remainingSeconds');
  }

  await store.close();
});

test('BoardStore: id 精确查阅的工作区隔离与跨工作区查询', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  const now = Date.now();
  store.post({
    id: 'post-isolated-frontend',
    topic: 'ui:theme',
    content: 'Frontend theme specification',
    authorWorkspace: 'c:/workspaces/frontend-app',
    createdAtMs: now,
    status: 'active'
  });

  store.post({
    id: 'post-isolated-backend',
    topic: 'api:auth',
    content: 'Backend auth specification',
    authorWorkspace: 'c:/workspaces/backend-service',
    createdAtMs: now + 50,
    status: 'active'
  });

  const callerWs = 'c:/workspaces/frontend-app';

  // 1. 同工作区内精确检索目标条目：成功返回且默认分流包含 content
  const sameWsRes = store.list({ id: 'post-isolated-frontend', callerWorkspace: callerWs });
  assert.equal(sameWsRes.total, 1);
  assert.equal(sameWsRes.posts[0].id, 'post-isolated-frontend');
  assert.equal(sameWsRes.posts[0].content, 'Frontend theme specification');

  // 2. 跨工作区精确检索目标条目：默认 crossWorkspace: false 严格隔离，返回 0 条
  const crossIsolated = store.list({ id: 'post-isolated-backend', callerWorkspace: callerWs });
  assert.equal(crossIsolated.total, 0, '未开启 crossWorkspace 时不查阅外部工作区条目');
  assert.equal(crossIsolated.returned, 0);

  // 3. 跨工作区精确检索目标条目：开启 crossWorkspace: true 获取详情
  const crossAllowed = store.list({
    id: 'post-isolated-backend',
    callerWorkspace: callerWs,
    crossWorkspace: true
  });
  assert.equal(crossAllowed.total, 1, '开启 crossWorkspace: true 允许跨工作区查阅目标 ID');
  assert.equal(crossAllowed.posts[0].id, 'post-isolated-backend');
  assert.equal(crossAllowed.posts[0].content, 'Backend auth specification');
  assert.equal(crossAllowed.titlesOnly, false);

  // 4. 蛇形参数 cross_workspace: true 同样支持
  const crossSnakeAllowed = store.list({
    id: 'post-isolated-backend',
    callerWorkspace: callerWs,
    cross_workspace: true
  });
  assert.equal(crossSnakeAllowed.total, 1);
  assert.equal(crossSnakeAllowed.posts[0].id, 'post-isolated-backend');

  await store.close();
});
