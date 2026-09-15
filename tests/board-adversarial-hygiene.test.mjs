import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  BoardStore,
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText
} from '../lib/board-store.mjs';
import { apply } from '../index.mjs';

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-hygiene-adv-'));
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

function createMockCordisContext() {
  const tools = new Map();
  const contexts = new Map();
  const promptSections = new Map();
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
      register() {}
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

test('board_list 多时间点调用 Prompt 文本幂等性与时间戳处理', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  const agentAlpha = createMockAgent('agent-alpha', { cwd: 'c:/workspace/proj-alpha' });
  const boardPost = ctx.tools.get('board_post');
  const boardList = ctx.tools.get('board_list');

  // 发布具有 1 小时 TTL 的多条条目
  const post1Res = await boardPost.execute({
    topic: 'task:audit',
    content: '# Architecture & Token Governance Audit\nDetailed report and compliance specs.',
    tags: ['audit', 'p0']
  }, { agent: agentAlpha });
  assert.equal(post1Res.success, true);
  const post1Id = post1Res.postId;

  const post2Res = await boardPost.execute({
    topic: 'task:telemetry',
    content: '## Telemetry Metrics and In-Memory Buffer\nZero-disk and hermetic workspace isolation.',
    tags: ['telemetry', 'core']
  }, { agent: agentAlpha });
  assert.equal(post2Res.success, true);
  const post2Id = post2Res.postId;

  // 1. 基准调用 t = 0
  const baselineDefault = await boardList.execute({}, { agent: agentAlpha });
  assert.equal(baselineDefault.success, true);
  assert.equal(baselineDefault.count, 2);
  assert.equal(baselineDefault.titlesOnly, true);
  const baselineDefaultRendered = boardList.output.render({}, baselineDefault)[0].text;
  const baselineDefaultJson = JSON.stringify(baselineDefault, null, 2);

  // 断言：返回结构中无 remainingSeconds，且 titlesOnly 模式不含 content
  for (const post of baselineDefault.posts) {
    assert.equal(post.remainingSeconds, undefined, '不应包含 remainingSeconds');
    assert.equal(post.content, undefined, '默认摘要模式不应包含 content 正文');
  }

  // 2. 基准单条点查 t = 0 (智能分流为 titlesOnly: false)
  const baselinePoint = await boardList.execute({ id: post1Id }, { agent: agentAlpha });
  assert.equal(baselinePoint.success, true);
  assert.equal(baselinePoint.count, 1);
  assert.equal(baselinePoint.titlesOnly, false);
  const baselinePointRendered = boardList.output.render({ id: post1Id }, baselinePoint)[0].text;
  const baselinePointJson = JSON.stringify(baselinePoint, null, 2);
  assert.equal(baselinePoint.posts[0].remainingSeconds, undefined);
  assert.ok(baselinePoint.posts[0].content.includes('Architecture & Token Governance Audit'));

  // 3. 模拟多时间点跨秒采样 (模拟现实会话在不同秒级的连续调用：+100ms, +500ms, +1000ms, +2500ms, +5000ms, +10000ms)
  const timeDeltas = [100, 500, 1000, 2500, 5000, 10000];
  for (const delta of timeDeltas) {
    // 异步等待一定真实时间或推进时钟
    await new Promise(resolve => setTimeout(resolve, Math.min(delta, 50)));

    // 默认摘要调用
    const sampleDefault = await boardList.execute({}, { agent: agentAlpha });
    const sampleDefaultRendered = boardList.output.render({}, sampleDefault)[0].text;
    const sampleDefaultJson = JSON.stringify(sampleDefault, null, 2);

    assert.equal(
      sampleDefaultRendered,
      baselineDefaultRendered,
      `在 delta=${delta}ms 时的 Prompt 渲染文本与基准一致`
    );
    assert.equal(
      sampleDefaultJson,
      baselineDefaultJson,
      `在 delta=${delta}ms 时的 Tool 输出 JSON 与基准一致`
    );

    // 单条点查调用
    const samplePoint = await boardList.execute({ id: post1Id }, { agent: agentAlpha });
    const samplePointRendered = boardList.output.render({ id: post1Id }, samplePoint)[0].text;
    const samplePointJson = JSON.stringify(samplePoint, null, 2);

    assert.equal(
      samplePointRendered,
      baselinePointRendered,
      `单条点查在 delta=${delta}ms 时的 Prompt 渲染文本与基准一致`
    );
    assert.equal(
      samplePointJson,
      baselinePointJson,
      `单条点查在 delta=${delta}ms 时的 Tool 输出 JSON 与基准一致`
    );
  }

  // 4. 验证：防范易逝时间字符串泄漏到 Prompt 文本中
  const forbiddenTimePatterns = [/remainingSeconds/i, /\b\d+s\b/i, /秒前/, /分钟前/, /seconds? ago/i];
  for (const pattern of forbiddenTimePatterns) {
    assert.equal(pattern.test(baselineDefaultRendered), false, `Prompt 渲染文本不应匹配易逝时间特征: ${pattern}`);
    assert.equal(pattern.test(baselinePointRendered), false, `点查 Prompt 渲染文本不应匹配易逝时间特征: ${pattern}`);
  }

  await ctx.emit('dispose');
});

test('board:remind 上下文注入在连续决策步中的状态幂等性', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  const agentAlpha = createMockAgent('agent-alpha-worker', { cwd: 'c:/workspace/proj-alpha' });
  const remindContext = ctx.systemPrompt.getContext('board:remind');
  assert.ok(remindContext, 'board:remind 必须已注册');

  // 未发布前提醒为空字符串（0 token 开销）
  assert.equal(remindContext.text({ agent: agentAlpha }), '');

  // 发布条目
  const boardPost = ctx.tools.get('board_post');
  await boardPost.execute({
    topic: 'task:review',
    content: 'Pending architecture review'
  }, { agent: agentAlpha });

  // 连续执行 25 轮模型推理步采样
  const stepOutputs = [];
  for (let step = 0; step < 25; step++) {
    const text = remindContext.text({ agent: agentAlpha });
    stepOutputs.push(text);
  }

  // 断言每一轮步进生成的提示词与第一轮一致
  const firstText = stepOutputs[0];
  assert.ok(firstText.includes('1 条尚未清理的有效条目'));
  assert.ok(firstText.includes('task:review'));
  assert.ok(firstText.includes('board_clear'));

  for (let i = 1; i < stepOutputs.length; i++) {
    assert.equal(stepOutputs[i], firstText, `第 ${i} 步提示词应与第 0 步一致`);
  }

  // 清理条目后立即消除
  const boardClear = ctx.tools.get('board_clear');
  await boardClear.execute({ topic: 'task:review', mode: 'dismiss' }, { agent: agentAlpha });
  assert.equal(remindContext.text({ agent: agentAlpha }), '', '清理后提醒应置空');

  await ctx.emit('dispose');
});

test('异常退出残留临时文件清理与状态恢复', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');
  const backupPath = path.join(tmpDir, 'board.json.bak');

  // 模拟场景：先建立合法的持久化基线
  const store1 = new BoardStore({ storagePath, backupPath, debounceMs: 20 });
  store1.post({
    id: 'post-base-1',
    topic: 'task:base',
    content: 'Base content before simulated crash',
    status: 'active'
  });
  await store1.close();

  assert.ok(existsSync(storagePath), '基线 board.json 已落盘');
  assert.ok(existsSync(backupPath), '基线 board.json.bak 已落盘');

  // 模拟异常退出：进程在写入临时文件途中被杀死
  // 遗留了 3 个异常命名的孤儿临时文件
  const orphanTmp1 = `${storagePath}.tmp.8888.1700000000000.abcd`;
  const orphanTmp2 = `${storagePath}.tmp.8889.1700000001000.ef01`;
  const orphanTmp3 = `${storagePath}.tmp.8890.1700000002000.2345`;
  writeFileSync(orphanTmp1, '{"partial": true, "corrupted":', 'utf8');
  writeFileSync(orphanTmp2, 'TRUNCATED_GARBAGE_BYTES_###', 'utf8');
  writeFileSync(orphanTmp3, '', 'utf8');

  assert.ok(existsSync(orphanTmp1));
  assert.ok(existsSync(orphanTmp2));
  assert.ok(existsSync(orphanTmp3));

  // 冷启动新的 BoardStore 实例（模拟宿主重启）
  const store2 = new BoardStore({ storagePath, backupPath, debounceMs: 20 });

  // 断言：BoardStore 启动时清除所有孤儿临时文件
  assert.equal(existsSync(orphanTmp1), false, 'orphanTmp1 已清除');
  assert.equal(existsSync(orphanTmp2), false, 'orphanTmp2 已清除');
  assert.equal(existsSync(orphanTmp3), false, 'orphanTmp3 已清除');

  // 并且正常数据未受破坏
  const recoveredItem = store2.get('post-base-1');
  assert.ok(recoveredItem);
  assert.equal(recoveredItem.content, 'Base content before simulated crash');

  await store2.close();
});

test('主文件损坏时自动通过备份恢复', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');
  const backupPath = path.join(tmpDir, 'board.json.bak');

  // 1. 正常落盘一份有效数据
  const store1 = new BoardStore({ storagePath, backupPath, debounceMs: 20 });
  store1.post({
    id: 'post-safe-1',
    topic: 'spec:security',
    content: 'Zero-data-loss mission critical spec',
    status: 'active'
  });
  await store1.close();

  // 2. 模拟坏块：将主文件篡改为完全非法的乱码字节
  writeFileSync(storagePath, '\x00\x01\x02\xFF\xFEINVALID_JSON_CORRUPTION_DAMAGE', 'utf8');

  // 3. 重新实例化，断言透明从 backup 恢复且不抛异常
  const store2 = new BoardStore({ storagePath, backupPath, debounceMs: 20 });
  const post = store2.get('post-safe-1');
  assert.ok(post, '成功从 .bak 恢复黑板条目');
  assert.equal(post.topic, 'spec:security');

  // 4. 等待触发的备份恢复落盘完成
  await store2.close();

  // 5. 验证主文件已自动恢复为合法 JSON
  const repairedContent = JSON.parse(await fs.readFile(storagePath, 'utf8'));
  assert.ok(Array.isArray(repairedContent.posts));
  assert.equal(repairedContent.posts[0].id, 'post-safe-1');
});

test('并发 Flush 与 Close 竞争下的时序安全与定时器清理', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const storagePath = path.join(tmpDir, 'board.json');
  const store = new BoardStore({ storagePath, debounceMs: 100 });

  // 快速高频并发 post
  for (let i = 0; i < 20; i++) {
    store.post({
      id: `post-burst-${i}`,
      topic: 'stress',
      content: `Burst content ${i}`,
      status: 'active'
    });
  }

  // 立即触发 close()，测试 isFlushing、needsFlush 与 close 协同等待
  await store.close();

  // 验证定时器已清空
  assert.equal(store.flushTimer, null, 'flushTimer 已清空');
  assert.equal(store.isFlushing, false, 'isFlushing 为 false');

  // 验证所有数据完整落盘
  const diskData = JSON.parse(await fs.readFile(storagePath, 'utf8'));
  assert.equal(diskData.posts.length, 20);

  // 验证临时目录下无任何 .tmp.* 残留
  const dirFiles = readdirSync(tmpDir);
  const tmpFiles = dirFiles.filter(f => f.includes('.tmp.'));
  assert.equal(tmpFiles.length, 0, `临时目录下无残留临时文件: ${tmpFiles.join(', ')}`);
});

test('工作区根目录无临时文件与备份残留', () => {
  // 检查根目录下无 board.json、board.json.bak 或 board.json.tmp.* 残留
  const testFileDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginRoot = path.resolve(testFileDir, '..');
  
  const rootFiles = readdirSync(pluginRoot);
  const boardArtifacts = rootFiles.filter(f => /^board\.json(\..*)?$/i.test(f));

  assert.deepEqual(
    boardArtifacts,
    [],
    `工作区根目录发现残留黑板文件: ${boardArtifacts.join(', ')}`
  );
});
