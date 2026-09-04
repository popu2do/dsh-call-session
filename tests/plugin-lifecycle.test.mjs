import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pluginDefault, {
  name,
  inject,
  Config,
  usageSectionText,
  DISPATCHER_CONSTANTS,
  apply
} from '../index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-plugin-test-'));
}

function createMockCordisContext() {
  const tools = new Map();
  const commands = new Map();
  const promptSections = new Map();
  const eventHandlers = new Map();
  const agentsList = [];

  return {
    tools: {
      register(def) {
        tools.set(def.name, def);
      },
      get(name) {
        return tools.get(name);
      },
      has(name) {
        return tools.has(name);
      },
      all() {
        return Array.from(tools.values());
      }
    },
    commands: {
      register(cmd) {
        commands.set(cmd.name, cmd);
      },
      get(name) {
        return commands.get(name);
      }
    },
    systemPrompt: {
      add(id, getter, options) {
        promptSections.set(id, { getter, options });
      },
      get(id) {
        return promptSections.get(id);
      }
    },
    agents: {
      list: () => agentsList,
      get: (id) => agentsList.find(a => a.id === id)
    },
    _agentsList: agentsList,
    on(event, handler) {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event).push(handler);
    },
    async emit(event, ...args) {
      const list = eventHandlers.get(event) || [];
      for (const handler of list) {
        await handler(...args);
      }
    },
    logger(name) {
      return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      };
    },
    get(serviceName) {
      if (serviceName === 'logger') {
        return () => ({
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {}
        });
      }
      return undefined;
    }
  };
}

test('Plugin 基础元数据与配置导出规范', () => {
  assert.equal(name, 'dsh-call-session');
  assert.deepEqual(inject, ['agents', 'tools', 'commands', 'systemPrompt']);

  // Config schema 检验
  assert.ok(Config);

  // default 导出对标
  assert.equal(pluginDefault.name, name);
  assert.deepEqual(pluginDefault.inject, inject);
  assert.equal(typeof pluginDefault.apply, 'function');
  assert.equal(typeof pluginDefault.usageSectionText, 'function');

  // DISPATCHER_CONSTANTS
  assert.ok(DISPATCHER_CONSTANTS.TARGET_WILDCARDS.has('*'));
  assert.equal(DISPATCHER_CONSTANTS.LIMITS.MIN_PREFIX_LENGTH, 8);
  assert.equal(DISPATCHER_CONSTANTS.LIMITS.MESSAGE_MAX_LENGTH, 4000);
});

test('usageSectionText: 规范 System Prompt 段落结构与说明', () => {
  const text = usageSectionText();
  assert.ok(text.includes('## Cross-Session Communication & Collaboration (dsh-call-session)'));
  assert.ok(text.includes('session_query'));
  assert.ok(text.includes('session_call'));
  assert.ok(text.includes('board_post'));
  assert.ok(text.includes('board_list'));
  assert.ok(text.includes('board_clear'));
  assert.ok(text.includes('/dsh-call-session'));
});

test('apply: 插件初始化、工具注册与 System Prompt 挂载', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');

  apply(ctx, {
    storagePath,
    debounceMs: 50,
    maxCapacity: 100,
    promptSectionOrder: 120
  });

  // 1. 验证 5 大核心工具是否全部成功注册
  const expectedTools = ['board_post', 'board_list', 'board_clear', 'session_call', 'session_query'];
  for (const toolName of expectedTools) {
    const tool = ctx.tools.get(toolName);
    assert.ok(tool, `工具 ${toolName} 必须已注册`);
    assert.equal(tool.isConcurrencySafe, true);
    assert.equal(typeof tool.execute, 'function');
    assert.ok(tool.parameters);
    assert.ok(tool.output?.schema);
    assert.equal(typeof tool.output?.render, 'function');
  }

  // 2. 验证 System Prompt 挂载与排序权重
  const promptItem = ctx.systemPrompt.get('dsh-call-session:usage');
  assert.ok(promptItem, '应当挂载 dsh-call-session:usage 提示词段落');
  assert.equal(promptItem.options.order, 120);
  assert.ok(promptItem.getter().includes('Cross-Session Communication'));

  // 3. 验证 Web 斜杠指令注册
  const slashCmd = ctx.commands.get('dsh-call-session');
  assert.ok(slashCmd, '应当成功注册 /dsh-call-session 斜杠指令');
  assert.equal(typeof slashCmd.handler, 'function');

  // 4. 验证生命周期 dispose 事件触发数据落盘与资源释放
  await ctx.emit('dispose');
});

test('apply: 重复注册工具幂等性防护 (registerSafe)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');

  // 第一次挂载
  apply(ctx, { storagePath, debounceMs: 50 });
  const firstPostExecute = ctx.tools.get('board_post').execute;

  // 第二次挂载 (模拟热重载或重新初始化)
  apply(ctx, { storagePath, debounceMs: 50 });
  const secondPostExecute = ctx.tools.get('board_post').execute;

  assert.ok(secondPostExecute);
  // 原有工具应被更新而不是崩溃
  assert.equal(typeof secondPostExecute, 'function');

  await ctx.emit('dispose');
});

test('Web Slash Command (/dsh-call-session) 行为验证', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  const cmd = ctx.commands.get('dsh-call-session');
  const caller = {
    id: 'commander-agent',
    title: 'Commander',
    session: { cwd: 'c:/app' }
  };

  // 1. 无参数调用：看板无公告时提示空列表
  const resEmpty = await cmd.handler({ rawInput: '', agent: caller });
  assert.equal(resEmpty.kind, 'success');
  assert.ok(resEmpty.text.includes('当前暂无有效公告'));

  // 2. 通过 board_post 插入一条公告后，再次无参数调用
  const boardPostTool = ctx.tools.get('board_post');
  await boardPostTool.execute({
    topic: 'release:v1',
    content: '# Release Notice\nReady for launch'
  }, { agent: caller });

  const resWithPost = await cmd.handler({ rawInput: '  ', agent: caller });
  assert.equal(resWithPost.kind, 'success');
  assert.ok(resWithPost.text.includes('[BOARD TITLES: 1 active]'));
  assert.ok(resWithPost.text.includes('Release Notice'));

  // 3. 参数格式错误：仅有目标没有消息
  const resNoMsg = await cmd.handler({ rawInput: 'worker-session-id', agent: caller });
  assert.equal(resNoMsg.kind, 'error');
  assert.ok(resNoMsg.text.includes('用法错误：缺少消息内容'));

  // 4. 正确参数调用呼叫目标
  const targetWorker = {
    id: 'worker-session-001',
    title: 'Worker One',
    status: 'idle',
    received: [],
    followup(msg) { this.received.push(msg); },
    session: { id: 'worker-session-001', title: 'Worker One', cwd: 'c:/app' }
  };
  ctx._agentsList.push(caller, targetWorker);

  const resCall = await cmd.handler({
    rawInput: 'worker-session-001 Please sync files',
    agent: caller
  });
  assert.equal(resCall.kind, 'success');
  assert.ok(resCall.text.includes('成功呼叫会话 [worker-session-001]'));
  assert.equal(targetWorker.received.length, 1);

  await ctx.emit('dispose');
});

test('五大工具集成执行链路 (execute 端到端测试)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = createMockCordisContext();
  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  const caller = {
    id: 'lead-session-8888',
    title: 'Tech Lead',
    status: 'idle',
    session: { cwd: 'c:/repo' }
  };
  const worker = {
    id: 'peer-session-9999',
    title: 'Peer Developer',
    status: 'running',
    received: [],
    steer(msg) { this.received.push(msg); },
    session: { id: 'peer-session-9999', title: 'Peer Developer', cwd: 'c:/repo' }
  };
  ctx._agentsList.push(caller, worker);

  const exec = { agent: caller };

  // 1. board_post
  const postRes = await ctx.tools.get('board_post').execute({
    topic: 'milestone:m1',
    content: 'All tasks completed',
    tags: ['m1']
  }, exec);
  assert.equal(postRes.success, true);
  assert.ok(postRes.postId);

  // 2. board_list
  const listRes = await ctx.tools.get('board_list').execute({
    topic: 'milestone:m1'
  }, exec);
  assert.equal(listRes.success, true);
  assert.equal(listRes.count, 1);
  assert.equal(listRes.posts[0].id, postRes.postId);

  // 3. session_query
  const queryRes = await ctx.tools.get('session_query').execute({
    query: 'peer'
  }, exec);
  assert.equal(queryRes.success, true);
  assert.equal(queryRes.count, 1);
  assert.equal(queryRes.sessions[0].sessionId, 'peer-session-9999');
  assert.equal(queryRes.sessions[0].status, 'running');

  // 4. session_call (携带刚刚发布的 postId)
  const callRes = await ctx.tools.get('session_call').execute({
    target_session_id: 'peer-session-9999',
    message: 'Check milestone post',
    context_post_ids: [postRes.postId]
  }, exec);
  assert.equal(callRes.success, true);
  assert.equal(callRes.deliveryMode, 'steer');
  assert.equal(worker.received.length, 1);

  // 5. board_clear
  const clearRes = await ctx.tools.get('board_clear').execute({
    id: postRes.postId,
    mode: 'purge'
  }, exec);
  assert.equal(clearRes.success, true);
  assert.equal(clearRes.clearedCount, 1);

  await ctx.emit('dispose');
});

test('官方 ctx.logger 规范接入与生命周期降噪 (全部日志收敛至 debug 级别)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const capturedLogs = [];
  const requestedScopes = [];

  const mockLogger = {
    debug(...args) { capturedLogs.push({ level: 'debug', args }); },
    info(...args) { capturedLogs.push({ level: 'info', args }); },
    warn(...args) { capturedLogs.push({ level: 'warn', args }); },
    error(...args) { capturedLogs.push({ level: 'error', args }); }
  };

  const ctx = createMockCordisContext();
  ctx.logger = (scope) => {
    requestedScopes.push(scope);
    return mockLogger;
  };

  const storagePath = path.join(tmpDir, 'board.json');
  apply(ctx, { storagePath, debounceMs: 50 });

  // 1. 验证 ctx.logger 被以官方标准作用域 'dsh-call-session' 调用
  assert.ok(requestedScopes.includes('dsh-call-session'), '必须请求 dsh-call-session 作用域 logger');

  // 2. 验证生命周期中的启动、工具注册、斜杠注册日志已触发
  assert.ok(capturedLogs.length > 0, '应当记录生命周期日志');

  // 3. 验证所有生命周期日志均为 debug 级别，绝不使用 info 产生控制台噪音
  const nonDebugLogs = capturedLogs.filter(l => l.level !== 'debug');
  assert.equal(nonDebugLogs.length, 0, '生命周期正常流程下不得输出 info/warn/error 级别日志，避免控制台污染');

  const activationLog = capturedLogs.find(l => l.args[0]?.includes('Activating pure DSH Native Collaboration Plugin'));
  assert.ok(activationLog, '必须包含插件激活 debug 日志');

  const toolLogs = capturedLogs.filter(l => l.args[0]?.includes('registered successfully'));
  assert.ok(toolLogs.length >= 1, '工具注册必须记录 debug 日志');

  // 4. 验证 dispose 过程也是 debug 级别
  capturedLogs.length = 0;
  await ctx.emit('dispose');

  const disposeLog = capturedLogs.find(l => l.args[0]?.includes('Disposing plugin'));
  assert.ok(disposeLog, '必须包含插件释放 debug 日志');
  assert.equal(disposeLog.level, 'debug');
  assert.equal(capturedLogs.filter(l => l.level !== 'debug').length, 0);
});

test('支持 ctx.get("logger") 备选注入与无 logger 时的 noopLogger 安全回退', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // A. 测试 ctx.get('logger') 备选路径
  const getLogs = [];
  const ctxWithGet = createMockCordisContext();
  delete ctxWithGet.logger;
  ctxWithGet.get = (name) => {
    if (name === 'logger') {
      return (scope) => ({
        debug(...args) { getLogs.push({ scope, level: 'debug', args }); },
        info() {},
        warn() {},
        error() {}
      });
    }
    return undefined;
  };

  const storagePath1 = path.join(tmpDir, 'board1.json');
  apply(ctxWithGet, { storagePath: storagePath1, debounceMs: 50 });
  assert.ok(getLogs.length > 0);
  assert.equal(getLogs[0].scope, 'dsh-call-session');
  await ctxWithGet.emit('dispose');

  // B. 测试完全无 logger 服务时的安全纯净回退
  const bareCtx = createMockCordisContext();
  delete bareCtx.logger;
  bareCtx.get = () => undefined;

  const storagePath2 = path.join(tmpDir, 'board2.json');
  assert.doesNotThrow(() => {
    apply(bareCtx, { storagePath: storagePath2, debounceMs: 50 });
  });
  await bareCtx.emit('dispose');
});

test('端到端全局无裸 console 污染断言 (Full Lifecycle & Tools Execution)', async (t) => {
  const tmpDir = await createTempDir();
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const interceptedCalls = [];
  const originalMethods = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  t.after(() => {
    console.log = originalMethods.log;
    console.info = originalMethods.info;
    console.warn = originalMethods.warn;
    console.error = originalMethods.error;
    console.debug = originalMethods.debug;
  });

  // 拦截全局 console
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    console[method] = (...args) => {
      interceptedCalls.push({ method, args });
    };
  }

  // 使用没有提供任何 logger 服务的 bare context
  const bareCtx = createMockCordisContext();
  delete bareCtx.logger;
  bareCtx.get = () => undefined;

  const caller = {
    id: 'clean-caller-1111',
    title: 'Clean Caller',
    status: 'idle',
    session: { cwd: 'c:/clean' }
  };
  const target = {
    id: 'clean-target-2222',
    title: 'Clean Target',
    status: 'running',
    received: [],
    steer(msg) { this.received.push(msg); },
    session: { id: 'clean-target-2222', title: 'Clean Target', cwd: 'c:/clean' }
  };
  bareCtx._agentsList.push(caller, target);

  const storagePath = path.join(tmpDir, 'board.json');
  // 1. apply 挂载
  apply(bareCtx, { storagePath, debounceMs: 50 });

  // 2. board_post 工具执行
  const postRes = await bareCtx.tools.get('board_post').execute({
    topic: 'clean:test',
    content: 'Zero console pollution verification'
  }, { agent: caller });

  // 3. board_list 工具执行
  await bareCtx.tools.get('board_list').execute({ topic: 'clean:test' }, { agent: caller });

  // 4. session_query 工具执行
  await bareCtx.tools.get('session_query').execute({ query: 'clean' }, { agent: caller });

  // 5. session_call 工具执行
  await bareCtx.tools.get('session_call').execute({
    target_session_id: 'clean-target-2222',
    message: 'Testing zero console pollution',
    context_post_ids: [postRes.postId]
  }, { agent: caller });

  // 6. slash command 交互执行
  const slashCmd = bareCtx.commands.get('dsh-call-session');
  assert.ok(slashCmd, '必须成功注册 /dsh-call-session 指令');
  await slashCmd.handler({ rawInput: '', agent: caller });
  await slashCmd.handler({ rawInput: 'clean-target-2222 Hello cleanly', agent: caller });

  // 7. board_clear 工具执行
  await bareCtx.tools.get('board_clear').execute({ id: postRes.postId, mode: 'purge' }, { agent: caller });

  // 8. dispose 销毁落盘
  await bareCtx.emit('dispose');

  // 核心断言：全生命周期中零裸 console 污染
  assert.equal(
    interceptedCalls.length,
    0,
    `生产调用链中检测到裸 console 污染: ${JSON.stringify(interceptedCalls)}`
  );
});

test('静态合规审查：index.mjs 与 lib/*.mjs 生产代码 0 处裸 console 调用', async () => {
  const projectDir = path.resolve(__dirname, '..');
  const filesToScan = [
    path.join(projectDir, 'index.mjs'),
    path.join(projectDir, 'lib', 'board-store.mjs'),
    path.join(projectDir, 'lib', 'session-call.mjs'),
    path.join(projectDir, 'lib', 'session-query.mjs')
  ];

  for (const filePath of filesToScan) {
    const content = await fs.readFile(filePath, 'utf8');
    // 移除多行注释和单行注释
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const consoleMatches = codeOnly.match(/\bconsole\.(log|info|warn|error|debug|trace|dir)\b/g);
    assert.equal(
      consoleMatches,
      null,
      `文件 ${path.basename(filePath)} 包含裸 console 调用: ${consoleMatches?.join(', ')}`
    );
  }
});
