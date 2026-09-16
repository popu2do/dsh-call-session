import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  BoardStore,
  RESERVED_TOPIC_PREFIXES,
  isReservedTopic,
  getReservedTopicErrorMessage,
  formatAuthorReminderText
} from '../lib/board-store.mjs';
import { apply } from '../index.mjs';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-board-security-'));
}

function createMockCordisContext() {
  const tools = new Map();
  const contexts = new Map();
  const promptSections = new Map();
  const eventHandlers = new Map();
  const services = new Map();

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
    provide(key, value) {
      services.set(key, value);
    },
    get(key) {
      return services.get(key);
    },
    commands: {
      register() {}
    },
    on(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event).push(handler);
    },
    async emit(event, ...args) {
      const handlers = eventHandlers.get(event) || [];
      for (const h of handlers) {
        await h(...args);
      }
    }
  };
}

function createMockAgent(id, cwd = 'c:/workspace/proj-security') {
  return {
    id,
    session: {
      id,
      header: { cwd }
    }
  };
}

test('isReservedTopic: 保留主题与遥测命名空间判定 (ADR-0001 & ADR-0012)', () => {
  // 1. 保留前缀集合断言
  assert.ok(Array.isArray(RESERVED_TOPIC_PREFIXES));
  assert.ok(RESERVED_TOPIC_PREFIXES.includes('telemetry:'));
  assert.ok(RESERVED_TOPIC_PREFIXES.includes('call:'));
  assert.ok(RESERVED_TOPIC_PREFIXES.includes('sys:'));

  // 2. telemetry: 前缀判定
  assert.equal(isReservedTopic('telemetry:call'), true);
  assert.equal(isReservedTopic('telemetry:metrics'), true);
  assert.equal(isReservedTopic('telemetry:*'), true);
  assert.equal(isReservedTopic('TELEMETRY:TRACE'), true, '大小写不敏感');

  // 3. call: 前缀判定
  assert.equal(isReservedTopic('call:steer'), true);
  assert.equal(isReservedTopic('call:followup'), true);
  assert.equal(isReservedTopic('call:*'), true);
  assert.equal(isReservedTopic('CALL:UNICAST'), true, '大小写不敏感');

  // 4. sys: 前缀判定
  assert.equal(isReservedTopic('sys:alert'), true);
  assert.equal(isReservedTopic('sys:cron'), true);
  assert.equal(isReservedTopic('sys:*'), true);
  assert.equal(isReservedTopic('SYS:STATUS'), true, '大小写不敏感');

  // 5. 特殊保留与后缀判定
  assert.equal(isReservedTopic('telemetry'), true);
  assert.equal(isReservedTopic('call'), true);
  assert.equal(isReservedTopic('sys'), true);
  assert.equal(isReservedTopic('task:telemetry'), true, 'task:telemetry 必须判定为保留主题');
  assert.equal(isReservedTopic('task:telemetry:sync'), true);
  assert.equal(isReservedTopic('audit:telemetry'), true);
  assert.equal(isReservedTopic('task:call'), true);

  // 6. 正常业务分类不得被误判
  assert.equal(isReservedTopic('task:audit'), false);
  assert.equal(isReservedTopic('task:build'), false);
  assert.equal(isReservedTopic('task:deploy'), false);
  assert.equal(isReservedTopic('spec:api'), false);
  assert.equal(isReservedTopic('milestone:m1'), false);
  assert.equal(isReservedTopic('feature:canvas'), false);
  assert.equal(isReservedTopic('blackboard:hub'), false);

  // 7. 边界与空值安全
  assert.equal(isReservedTopic(''), false);
  assert.equal(isReservedTopic(null), false);
  assert.equal(isReservedTopic(undefined), false);
  assert.equal(isReservedTopic(12345), false);
});

test('BoardStore.post: 直接写入保留主题与遥测数据时抛错拦截', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const store = new BoardStore({
    storagePath: path.join(tmpDir, 'board.json'),
    debounceMs: 50
  });

  // 1. 尝试直接写入 telemetry: 主题
  assert.throws(
    () => {
      store.post({
        id: 'post-tel-1',
        topic: 'telemetry:call',
        content: 'Call trace snapshot',
        status: 'active'
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('保留主题拦截'));
      assert.ok(err.message.includes('纯内存遥测域 (ADR-0012)'));
      assert.ok(err.message.includes('严禁写入持久化黑板'));
      return true;
    }
  );

  // 2. 尝试直接写入 task:telemetry 主题
  assert.throws(
    () => {
      store.post({
        id: 'post-tel-2',
        topic: 'task:telemetry',
        content: 'Telemetry buffer metrics',
        status: 'active'
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('task:telemetry'));
      assert.ok(err.message.includes('纯内存遥测域 (ADR-0012)'));
      return true;
    }
  );

  // 3. 尝试直接写入 call: 主题
  assert.throws(
    () => {
      store.post({
        id: 'post-call-1',
        topic: 'call:steer',
        content: 'Steer call notice',
        status: 'active'
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('call:steer'));
      assert.ok(err.message.includes('纯内存遥测域 (ADR-0012)'));
      return true;
    }
  );

  // 4. 尝试直接写入 sys: 主题
  assert.throws(
    () => {
      store.post({
        id: 'post-sys-1',
        topic: 'sys:alert',
        content: 'System alarm',
        status: 'active'
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('sys:alert'));
      assert.ok(err.message.includes('纯内存遥测域 (ADR-0012)'));
      return true;
    }
  );

  // 5. 校验拦截后黑板中不存在任何被拒绝条目
  assert.equal(store.posts.size, 0);
  assert.equal(store.get('post-tel-1'), undefined);
  assert.equal(store.get('post-tel-2'), undefined);
  assert.equal(store.get('post-call-1'), undefined);

  // 6. 合法业务主题正常写入
  const validPost = store.post({
    id: 'post-valid-1',
    topic: 'task:security',
    content: 'Security audit complete',
    status: 'active'
  });
  assert.equal(validPost.id, 'post-valid-1');
  assert.equal(store.posts.size, 1);

  await store.close();
});

test('BoardStore.hydratePosts: 启动水合自动清洗误写入的遥测脏数据并防止击穿 KV Cache', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');

  // 构造模拟历史脏数据（包含 2 条正常业务条目和 4 条遥测/保留主题脏条目）
  const dirtyDiskData = {
    version: 1,
    posts: [
      {
        id: 'post-v1',
        topic: 'task:audit',
        content: 'System architecture audit report',
        authorSessionId: 'session-author-1',
        status: 'active'
      },
      {
        id: 'post-d1',
        topic: 'task:telemetry',
        content: 'Dirty telemetry metrics',
        authorSessionId: 'session-author-1',
        status: 'active'
      },
      {
        id: 'post-d2',
        topic: 'telemetry:call:trace',
        content: 'Unicast call trace snapshot',
        authorSessionId: 'session-author-1',
        status: 'active'
      },
      {
        id: 'post-v2',
        topic: 'spec:api',
        content: 'API specification v2',
        authorSessionId: 'session-author-1',
        status: 'active'
      },
      {
        id: 'post-d3',
        topic: 'call:steer',
        content: 'Call dispatch message',
        authorSessionId: 'session-author-2',
        status: 'active'
      },
      {
        id: 'post-d4',
        topic: 'sys:internal',
        content: 'System internal state',
        authorSessionId: 'session-author-2',
        status: 'active'
      }
    ]
  };

  await fs.writeFile(storagePath, JSON.stringify(dirtyDiskData, null, 2), 'utf8');

  // 实例化 BoardStore，触发同步加载 loadSync 与 hydratePosts
  const store = new BoardStore({
    storagePath,
    debounceMs: 50
  });

  // 1. 验证黑板内存实例中的条目数仅为 2 条合法条目，4 条脏数据已被完全剔除
  assert.equal(store.posts.size, 2, '脏条目必须被完全过滤剔除');
  assert.equal(store.get('post-v1')?.topic, 'task:audit');
  assert.equal(store.get('post-v2')?.topic, 'spec:api');
  assert.equal(store.get('post-d1'), undefined, 'task:telemetry 脏数据已被清洗');
  assert.equal(store.get('post-d2'), undefined, 'telemetry:call:trace 脏数据已被清洗');
  assert.equal(store.get('post-d3'), undefined, 'call:steer 脏数据已被清洗');
  assert.equal(store.get('post-d4'), undefined, 'sys:internal 脏数据已被清洗');

  // 2. 验证 ADR-0010 System Prompt 提醒注入：脏数据不会流入 context 注入，保护 KV Cache
  const activePosts = store.findActiveByAuthor('session-author-1');
  assert.equal(activePosts.length, 2);
  const reminderText = formatAuthorReminderText(activePosts);
  assert.ok(reminderText.includes('task:audit'));
  assert.ok(reminderText.includes('spec:api'));
  assert.ok(!reminderText.includes('task:telemetry'), '提醒文本不得包含遥测脏条目');
  assert.ok(!reminderText.includes('telemetry:call:trace'), '提醒文本不得包含遥测脏条目');

  // 3. 验证自动自愈落盘：hydratePosts 发现脏数据后触发 scheduleFlush，磁盘上文件被清洗重写
  await store.close();

  const healedDiskRaw = await fs.readFile(storagePath, 'utf8');
  const healedDiskData = JSON.parse(healedDiskRaw);
  assert.equal(healedDiskData.posts.length, 2, '磁盘持久化文件已自愈，仅保留合法条目');
  const diskIds = healedDiskData.posts.map(p => p.id);
  assert.deepEqual(diskIds, ['post-v1', 'post-v2']);
});

test('board_post 工具端到端拦截：保留主题拒绝与错误响应契约', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  const agent = createMockAgent('agent-test');
  const boardPost = ctx.tools.get('board_post');
  const boardList = ctx.tools.get('board_list');

  // 1. 尝试发布 telemetry: 主题
  const res1 = await boardPost.execute({
    topic: 'telemetry:flow',
    content: 'Telemetry flow packet'
  }, { agent });

  assert.equal(res1.success, false);
  assert.equal(res1.topic, 'telemetry:flow');
  assert.ok(res1.error.includes('保留主题拦截'));
  assert.ok(res1.error.includes('纯内存遥测域 (ADR-0012)'));
  assert.ok(res1.error.includes('严禁写入持久化黑板'));
  const rendered1 = boardPost.output.render({}, res1)[0].text;
  assert.ok(rendered1.includes('[Board] 发布失败: 保留主题拦截'));

  // 2. 尝试发布 task:telemetry 主题
  const res2 = await boardPost.execute({
    topic: 'task:telemetry',
    content: 'Task telemetry data'
  }, { agent });

  assert.equal(res2.success, false);
  assert.equal(res2.topic, 'task:telemetry');
  assert.ok(res2.error.includes('保留主题拦截'));

  // 3. 尝试发布 call: 主题
  const res3 = await boardPost.execute({
    topic: 'call:broadcast',
    content: 'Call message'
  }, { agent });

  assert.equal(res3.success, false);
  assert.equal(res3.topic, 'call:broadcast');
  assert.ok(res3.error.includes('保留主题拦截'));

  // 4. 尝试发布 sys: 主题
  const res4 = await boardPost.execute({
    topic: 'sys:kernel',
    content: 'Kernel event'
  }, { agent });

  assert.equal(res4.success, false);
  assert.equal(res4.topic, 'sys:kernel');
  assert.ok(res4.error.includes('保留主题拦截'));

  // 5. 校验黑板列表：上述 4 次非法尝试均未写入黑板
  const listEmpty = await boardList.execute({}, { agent });
  assert.equal(listEmpty.success, true);
  assert.equal(listEmpty.count, 0, '黑板上无任何条目');

  // 6. 发布合法业务条目
  const resValid = await boardPost.execute({
    topic: 'spec:compliance',
    content: 'ADR-0012 and ADR-0010 compliance check'
  }, { agent });

  assert.equal(resValid.success, true);
  assert.equal(resValid.topic, 'spec:compliance');

  // 7. 校验黑板列表仅有 1 条合法条目
  const listOne = await boardList.execute({}, { agent });
  assert.equal(listOne.success, true);
  assert.equal(listOne.count, 1);
  assert.equal(listOne.posts[0].topic, 'spec:compliance');

  await ctx.emit('dispose');
});
