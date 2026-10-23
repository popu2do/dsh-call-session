import test from 'node:test';
import assert from 'node:assert/strict';
import { readHostService, readProperty } from '../lib/host-services.mjs';
import { resolveWorkspaceRegistry, resolveAgentsService, getArchivedSessionIds } from '../lib/session-directory.mjs';
import { getCanvasTelemetry } from '../lib/web-telemetry-route.mjs';

/**
 * Simulate the Cordis 4.0.5 context proxy: an undeclared service property
 * throws instead of yielding undefined, and only `get(name, false)` is safe.
 */
function createStrictProxyContext(services = {}) {
  const provided = new Map(Object.entries(services));
  return {
    get(name, strict = true) {
      if (!provided.has(name)) {
        if (strict) throw new Error(`cannot get required service "${name}"`);
        return undefined;
      }
      return provided.get(name);
    },
    root: {
      get(name, strict = true) {
        if (!provided.has(name)) {
          if (strict) throw new Error(`cannot get required service "${name}"`);
          return undefined;
        }
        return provided.get(name);
      }
    }
  };
}

function createThrowingProxyContext() {
  const trap = {
    get(_target, prop) {
      if (prop === 'root' || prop === 'get') {
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      }
      throw new Error(`cannot get property "${String(prop)}" without inject`);
    }
  };
  return new Proxy({}, trap);
}

test('readHostService: 非严格探针读取宿主服务', () => {
  const agents = { list: () => [] };
  const ctx = createStrictProxyContext({ agents });
  assert.equal(readHostService(ctx, 'agents'), agents);
  assert.equal(readHostService(ctx, 'missing'), undefined);
});

test('readHostService: 严格代理上读取未声明服务不抛错', () => {
  let sawStrictThrow = false;
  const ctx = {
    get(name, strict = true) {
      if (strict) {
        sawStrictThrow = true;
        throw new Error(`cannot get property "${name}" without inject`);
      }
      return undefined;
    }
  };
  assert.equal(readHostService(ctx, 'workspaceRegistry'), undefined);
  assert.equal(sawStrictThrow, false, '读探针必须走非严格访问器');
});

test('readHostService: 根上下文服务对子上下文可见', () => {
  const workspaceRegistry = { on() {}, list: () => [] };
  const root = createStrictProxyContext({ workspaceRegistry });
  const child = { root, get: () => undefined };
  assert.equal(readHostService(child, 'workspaceRegistry'), workspaceRegistry);
});

test('readProperty: 属性代理抛错时返回 undefined', () => {
  const ctx = createThrowingProxyContext();
  assert.equal(readProperty(ctx, 'boardStore'), undefined);
  assert.equal(readHostService(ctx, 'boardStore'), undefined);
});

test('插件解析器在严格代理上下文下安全降级', () => {
  const ctx = createStrictProxyContext({ agents: { list: () => [] } });
  assert.equal(resolveWorkspaceRegistry(ctx), undefined);
  assert.ok(resolveAgentsService(ctx));

  const throwing = createThrowingProxyContext();
  assert.equal(resolveWorkspaceRegistry(throwing), undefined);
  assert.equal(resolveAgentsService(throwing), null);
});

test('归档会话集合在严格代理上下文下安全降级', () => {
  const throwing = createThrowingProxyContext();
  assert.equal(getArchivedSessionIds(throwing).size, 0);

  // 注册表上的归档集合优先于上下文上的回退字段。
  const registry = { archivedSessionIds: ['Session-A'] };
  const ctx = createStrictProxyContext({ workspaceRegistry: registry });
  assert.deepEqual([...getArchivedSessionIds(ctx)], ['Session-A', 'session-a']);
});

test('看板快照在严格代理上下文下不抛错', async () => {
  const ctx = createStrictProxyContext({ agents: { list: () => [], get: () => null } });
  const snapshot = await getCanvasTelemetry(ctx, { workspace: '/tmp/ws' });
  assert.equal(snapshot.posts.length, 0);
  assert.equal(Array.isArray(snapshot.sessions), true);
});
