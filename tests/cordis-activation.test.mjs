import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Activation under the real Cordis runtime.
 *
 * The other suites drive a hand-written mock context, so they cannot observe
 * the proxy traps Cordis applies to an undeclared service read. This suite
 * mounts the plugin in a real Cordis app providing only the three services it
 * injects, which is the composition that aborted on 0.2.1 with
 * `cannot get property "workspaceRegistry" without inject`.
 */
const { Context } = await import('@deepseek-ai/cordis');
const plugin = await import('../index.mjs');

class ToolsService {
  constructor() { this.entries = new Map(); }
  register(definition) { this.entries.set(definition.name, definition); }
  get(name) { return this.entries.get(name) ?? null; }
  list() { return [...this.entries.values()]; }
}

class AgentsService {
  get() { return null; }
  list() { return []; }
  on() { return () => {}; }
}

const EXPECTED_TOOLS = Object.freeze([
  'board_clear',
  'board_list',
  'board_post',
  'session_call',
  'session_create',
  'session_query'
]);

test('真实 Cordis 下激活：六个工具全部注册', async () => {
  const app = new Context();
  const tools = new ToolsService();
  const failures = [];
  app.on('internal/error', (error) => failures.push(error?.message ?? String(error)));

  app.plugin({ name: 'test-agents', apply: (ctx) => { ctx.provide('agents', new AgentsService()); } });
  app.plugin({ name: 'test-tools', inject: ['agents'], apply: (ctx) => { ctx.provide('tools', tools); } });
  app.plugin({
    name: 'test-system-prompt',
    apply: (ctx) => {
      ctx.provide('systemPrompt', {
        sections: [],
        add(name, text) { this.sections.push({ name, text }); },
        context(entry) { this.sections.push(entry); }
      });
    }
  });
  // Mount the plugin object itself: a wrapper plugin would carry no inject
  // declaration and deny every service read the real plugin is entitled to.
  app.plugin(plugin.default, {});

  await new Promise((resolve) => setTimeout(resolve, 500));

  const names = tools.list().map((definition) => definition.name).sort();
  assert.deepEqual(failures, [], '激活过程不应产生错误');
  assert.deepEqual(names, EXPECTED_TOOLS, '六个协作工具必须全部注册');
});

test('真实 Cordis 下激活：provide 的两个服务可见', async () => {
  const app = new Context();
  app.plugin({ name: 'test-agents', apply: (ctx) => { ctx.provide('agents', new AgentsService()); } });
  app.plugin({ name: 'test-tools', inject: ['agents'], apply: (ctx) => { ctx.provide('tools', new ToolsService()); } });
  app.plugin({ name: 'test-system-prompt', apply: (ctx) => { ctx.provide('systemPrompt', { add() {}, context() {} }); } });
  app.plugin(plugin.default, {});

  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.ok(app.get('boardStore', false), 'boardStore 应对宿主可见');
  assert.ok(app.get('callTelemetry', false), 'callTelemetry 应对宿主可见');
});

test('未注入的可选服务不会中止激活', async () => {
  const app = new Context();
  const tools = new ToolsService();
  app.plugin({ name: 'test-agents', apply: (ctx) => { ctx.provide('agents', new AgentsService()); } });
  app.plugin({ name: 'test-tools', inject: ['agents'], apply: (ctx) => { ctx.provide('tools', tools); } });
  app.plugin({ name: 'test-system-prompt', apply: (ctx) => { ctx.provide('systemPrompt', { add() {}, context() {} }); } });
  // No workspaceRegistry on purpose: it is optional, so its absence must
  // degrade rather than abort.
  app.plugin(plugin.default, {});

  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(tools.list().length, EXPECTED_TOOLS.length);
});
