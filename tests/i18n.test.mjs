/**
 * Bilingual Localization & Standardized English Error Protocol Tests (ADR-0023)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {
  apply,
  Config,
  usageSectionText
} from '../index.mjs';
import {
  resolveLocale,
  getCatalog
} from '../lib/locales/index.mjs';
import {
  SUPPORTED_LOCALES,
  CATALOGS,
  zh,
  en
} from '../lib/locales/index.mjs';
import { formatAuthorReminderText } from '../lib/board-store.mjs';

function createMockHarness(initialSettings = null) {
  const tools = new Map();
  const promptSections = new Map();
  const settingsStore = new Map();

  if (initialSettings) {
    for (const [k, v] of Object.entries(initialSettings)) {
      settingsStore.set(k, v);
    }
  }

  const ctx = {
    tools: {
      register(def) { tools.set(def.name, def); },
      get(name) { return tools.get(name); },
      has(name) { return tools.has(name); },
      all() { return Array.from(tools.values()); }
    },
    systemPrompt: {
      add(id, getter, options) { promptSections.set(id, { getter, options }); },
      get(id) { return promptSections.get(id); },
      context(def) { promptSections.set(`context:${def.name}`, def); },
      getContext(name) { return promptSections.get(`context:${name}`); }
    },
    settings: {
      get(key) { return settingsStore.get(key); },
      set(key, val) { settingsStore.set(key, val); }
    },
    get(serviceName) {
      if (serviceName === 'settings') return this.settings;
      if (serviceName === 'tools') return this.tools;
      if (serviceName === 'systemPrompt') return this.systemPrompt;
      return undefined;
    },
    on() {},
    provide() {}
  };

  return { ctx, tools, promptSections, settingsStore };
}

test('ADR-0023: Catalog 拓扑完全对称与中英文键对齐验证', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['zh', 'en']);
  assert.equal(typeof CATALOGS.zh, 'object');
  assert.equal(typeof CATALOGS.en, 'object');

  // 1. Messages 命名空间键对齐
  const zhMsgKeys = Object.keys(zh.messages).sort();
  const enMsgKeys = Object.keys(en.messages).sort();
  assert.deepEqual(zhMsgKeys, enMsgKeys, 'Messages 说明字段中英文必须 100% 对称');

  // 2. Tools 字典拓扑对齐
  const zhToolNames = Object.keys(zh.tools).sort();
  const enToolNames = Object.keys(en.tools).sort();
  assert.deepEqual(zhToolNames, enToolNames, '注册工具清单中英文必须完全一致');

  for (const toolName of zhToolNames) {
    const zhTool = zh.tools[toolName];
    const enTool = en.tools[toolName];
    assert.ok(zhTool.description && zhTool.description.length > 0, `${toolName} 必须包含中文描述`);
    assert.ok(enTool.description && enTool.description.length > 0, `${toolName} 必须包含英文描述`);

    const zhParams = Object.keys(zhTool.parameters || {}).sort();
    const enParams = Object.keys(enTool.parameters || {}).sort();
    assert.deepEqual(zhParams, enParams, `${toolName} 入参描述字段中英文必须完全一致`);
  }
});

test('ADR-0023: resolveLocale 层级决议与配置穿透验证', () => {
  // 1. 宿主 settings 偏好优先级最高以确保 Web 切换即刻生效 (ADR-0023 第三节)
  assert.equal(resolveLocale(null, { locale: 'en' }), 'en');
  assert.equal(resolveLocale(null, { locale: 'zh' }), 'zh');

  const { ctx, settingsStore } = createMockHarness();
  settingsStore.set('locale', { preference: 'en' });
  assert.equal(resolveLocale(ctx, { locale: 'zh' }), 'en', '宿主设置优先于插件配置以确保 Web UI 切换语言实时更新');
  assert.equal(resolveLocale(ctx, { locale: 'auto' }), 'en', 'auto 模式下宿主设置生效');

  // 2. 宿主直接返回标量字符串支持
  settingsStore.set('locale', 'zh');
  assert.equal(resolveLocale(ctx, {}), 'zh', '宿主直接返回标量字符串时亦正常识别');

  // 3. 宿主无设置时，显式 config.locale 生效
  settingsStore.delete('locale');
  assert.equal(resolveLocale(ctx, { locale: 'zh' }), 'zh', '宿主未配置时插件配置生效');
  assert.equal(resolveLocale(ctx, { locale: 'en' }), 'en', '宿主未配置时插件配置生效');

  // 3. 环境变量 process.env.LANG 自动检测
  const oldLang = process.env.LANG;
  try {
    process.env.LANG = 'en_US.UTF-8';
    assert.equal(resolveLocale(null, {}), 'en');
    process.env.LANG = 'zh_CN.UTF-8';
    assert.equal(resolveLocale(null, {}), 'zh');
  } finally {
    process.env.LANG = oldLang;
  }
});

test('ADR-0023: 英文模式下 6 大原生工具 Schema 纯英文注册验证', () => {
  const { ctx, tools } = createMockHarness();
  apply(ctx, { locale: 'en', storagePath: path.join(os.tmpdir(), 'i18n-en-schema.json'), debounceMs: 0 });

  const toolNames = ['board_post', 'board_list', 'board_clear', 'session_call', 'session_query', 'session_create'];
  for (const name of toolNames) {
    assert.ok(tools.has(name), `工具 ${name} 必须成功注册`);
    const def = tools.get(name);
    // 验证描述为纯英文（不包含中文字符）
    assert.ok(!/[\u4e00-\u9fa5]/.test(def.description), `${name} description 必须为纯英文`);
    // 验证所有参数说明为纯英文
    for (const [paramKey, paramSchema] of Object.entries(def.parameters.properties || {})) {
      if (paramSchema.description) {
        assert.ok(!/[\u4e00-\u9fa5]/.test(paramSchema.description), `${name} 参数 ${paramKey} 描述必须为纯英文`);
      }
    }
  }
});

test('ADR-0023: 中文模式下 6 大原生工具 Schema 中文注册验证', () => {
  const { ctx, tools } = createMockHarness();
  apply(ctx, { locale: 'zh', storagePath: path.join(os.tmpdir(), 'i18n-zh-schema.json'), debounceMs: 0 });

  const toolNames = ['board_post', 'board_list', 'board_clear', 'session_call', 'session_query', 'session_create'];
  for (const name of toolNames) {
    const def = tools.get(name);
    assert.ok(/[\u4e00-\u9fa5]/.test(def.description), `${name} description 必须包含中文`);
  }
});

test('ADR-0023: System Prompt 与黑板提醒动态求值时序与语言自适应验证', () => {
  const { ctx, promptSections, settingsStore } = createMockHarness();
  settingsStore.set('locale', { preference: 'zh' });
  apply(ctx, { locale: 'auto', storagePath: path.join(os.tmpdir(), 'i18n-auto-prompt.json'), debounceMs: 0 });

  const usageGetter = promptSections.get('dsh-call-session:usage').getter;
  assert.ok(usageGetter, '必须注册 System Prompt usage getter');

  // 1. 默认测试基线状态下为中文
  const initialText = usageGetter();
  assert.ok(initialText.includes('创建同级会话'), '中文模式下必须包含中文引导');

  // 2. 模拟前端/宿主设置切换为英文 -> System Prompt 无需重启插件即刻呈现纯英文
  settingsStore.set('locale', { preference: 'en' });
  const enText = usageGetter();
  assert.ok(enText.includes('Create an independent peer root session'), '英文模式下必须包含英文引导');
  assert.ok(!/[\u4e00-\u9fa5]/.test(enText), '英文模式下 System Prompt 不得包含中文字符');

  // 3. 再次切回中文 -> 即刻恢复中文
  settingsStore.set('locale', { preference: 'zh' });
  const zhText = usageGetter();
  assert.ok(zhText.includes('创建同级会话'), '切回中文后必须呈现中文引导');
});

test('ADR-0023: formatAuthorReminderText 双语格式化验证', () => {
  const mockPosts = [
    { id: 'post-1001', topic: 'task:audit' },
    { id: 'post-1002', topic: 'spec:api' },
    { id: 'post-1003' },
    { id: 'post-1004' }
  ];

  // 1. 中文格式
  const zhReminder = formatAuthorReminderText(mockPosts, 'zh');
  assert.ok(zhReminder.includes('你在公共黑板上有 4 条尚未清理的有效条目'));
  assert.ok(zhReminder.includes('#post-1001 (task:audit)'));
  assert.ok(zhReminder.includes('#post-1002 (spec:api)'));
  assert.ok(zhReminder.includes('等共 4 条'));
  assert.ok(zhReminder.includes('board_clear'));

  // 2. 英文格式
  const enReminder = formatAuthorReminderText(mockPosts, 'en');
  assert.ok(enReminder.includes('You have 4 active post(s) on the public blackboard'));
  assert.ok(enReminder.includes('#post-1001 (task:audit)'));
  assert.ok(enReminder.includes('#post-1002 (spec:api)'));
  assert.ok(enReminder.includes('total 4'));
  assert.ok(enReminder.includes('board_clear'));
  assert.ok(!/[\u4e00-\u9fa5]/.test(enReminder), '英文记名提醒不得包含中文字符');
});

test('ADR-0023: 标准化英文异常错误码合规性测试', () => {
  const expectedCodes = [
    '[InvalidParameter]',
    '[TargetNotFound]',
    '[SelfCallForbidden]',
    '[AmbiguousPrefix]',
    '[WildcardForbidden]',
    '[RateLimitExceeded]',
    '[GenerationLimitExceeded]',
    '[QuotaExceeded]',
    '[DuplicateTitle]',
    '[ReservedTopic]',
    '[StorageError]',
    '[ServiceUnavailable]'
  ];

  for (const code of expectedCodes) {
    assert.match(code, /^\[[A-Z][A-Za-z0-9]+\]$/, `错误码 ${code} 必须符合 [ErrorCode] 标准格式`);
  }
});

test('ADR-0023: 运行时异常抛出真实路径错误码规范符合性断言', async () => {
  const { executeSessionCall } = await import('../lib/session-call.mjs');
  const { AtomicBoardStore } = await import('../lib/board-store.mjs');
  const { ctx } = createMockHarness();
  const caller = { id: 'caller-node-1', status: 'idle' };
  const target = { id: 'target-node-2', status: 'idle' };
  ctx.agents = {
    list: () => [caller, target],
    get: (id) => (id === caller.id ? caller : id === target.id ? target : undefined)
  };

  // 1. [InvalidParameter]
  await assert.rejects(
    () => executeSessionCall({ ctx, args: null }),
    /\[InvalidParameter\]/
  );

  // 2. [SelfCallForbidden]
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: 'caller-node-1', message: 'hi' }, exec: { agent: caller } }),
    /\[SelfCallForbidden\]/
  );

  // 3. [WildcardForbidden]
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: '*', message: 'hi' } }),
    /\[WildcardForbidden\]/
  );

  // 4. [TargetNotFound]
  await assert.rejects(
    () => executeSessionCall({ ctx, args: { target_session_id: 'non-existent-session-12345678', message: 'hi' } }),
    /\[TargetNotFound\]/
  );

  // 5. [ReservedTopic]
  const store = new AtomicBoardStore({ debounceMs: 0 });
  assert.throws(
    () => store.post({ id: 'p1', topic: 'telemetry:test', content: 'c' }),
    /\[ReservedTopic\]/
  );

  // 6. [InvalidParameter] on board_clear
  assert.throws(
    () => store.clear({}),
    /\[InvalidParameter\]/
  );
});

test('ADR-0023: 原生工具执行摘要与双层渲染中英双语输出验证', async () => {
  // 1. 中文执行摘要与渲染验证
  const { ctx: ctxZh, tools: toolsZh } = createMockHarness();
  apply(ctxZh, { locale: 'zh', storagePath: path.join(os.tmpdir(), 'i18n-zh-summary.json'), debounceMs: 0 });
  const boardPostZh = toolsZh.get('board_post');
  const postResZh = await boardPostZh.execute({ topic: 'task:i18n-zh', content: 'test content' });
  assert.equal(postResZh.success, true);
  assert.ok(postResZh.message.includes('[Board] 已发布条目'));
  const renderedZh = boardPostZh.output.render({}, postResZh);
  assert.ok(renderedZh[0].text.includes('[Board] 已发布条目'));

  const boardClearZh = toolsZh.get('board_clear');
  const clearResZh = await boardClearZh.execute({ id: postResZh.postId, mode: 'dismiss' });
  assert.equal(clearResZh.success, true);
  assert.ok(clearResZh.message.includes('已归档 1 条黑板条目'));

  // 2. 英文执行摘要与渲染验证
  const { ctx: ctxEn, tools: toolsEn } = createMockHarness();
  apply(ctxEn, { locale: 'en', storagePath: path.join(os.tmpdir(), 'i18n-en-summary.json'), debounceMs: 0 });
  const boardPostEn = toolsEn.get('board_post');
  const postResEn = await boardPostEn.execute({ topic: 'task:i18n-en', content: 'test content' });
  assert.equal(postResEn.success, true);
  assert.ok(postResEn.message.includes('[Board] Published post'));
  assert.ok(!/[\u4e00-\u9fa5]/.test(postResEn.message));
  const renderedEn = boardPostEn.output.render({}, postResEn);
  assert.ok(renderedEn[0].text.includes('[Board] Published post'));
  assert.ok(!/[\u4e00-\u9fa5]/.test(renderedEn[0].text));

  const boardClearEn = toolsEn.get('board_clear');
  const clearResEn = await boardClearEn.execute({ id: postResEn.postId, mode: 'dismiss' });
  assert.equal(clearResEn.success, true);
  assert.ok(clearResEn.message.includes('Cleared 1 blackboard post(s)'));
  assert.ok(clearResEn.message.includes('dismissed'));
  assert.ok(!/[\u4e00-\u9fa5]/.test(clearResEn.message));
});


