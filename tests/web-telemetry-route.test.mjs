import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS
} from '../lib/web-telemetry-route.mjs';
import { CallTelemetryRingBuffer } from '../lib/call-telemetry.mjs';
import { apply } from '../index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/** Minimal ServerResponse double capturing status, headers and body. */
function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(chunk) {
      if (chunk !== undefined) this.body = String(chunk);
      this.ended = true;
    }
  };
}

function createMockCtx({
  webServer = undefined,
  serverKey = 'webServer',
  connection = undefined,
  agentsList = [],
  hasEffect = true
} = {}) {
  const routes = [];
  const listeners = new Map();
  const effects = [];
  const agentMap = new Map(agentsList.map((a) => [a.id, a]));

  const ctx = {
    logger: () => silentLogger,
    routes,
    effects,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    emit(event, ...args) {
      for (const handler of listeners.get(event) || []) handler(...args);
    },
    get(name) {
      if (name === serverKey) return webServer;
      if (name === 'connection') return connection;
      if (name === 'logger') return () => silentLogger;
      return undefined;
    },
    agents: {
      list: () => agentsList,
      get: (id) => agentMap.get(id)
    }
  };

  if (hasEffect) {
    ctx.effect = (factory, label) => {
      effects.push(label);
      return factory();
    };
  }

  return ctx;
}

function createMockWebServer() {
  const registered = [];
  return {
    registered,
    register(route) {
      registered.push(route);
      return () => {
        const index = registered.indexOf(route);
        if (index >= 0) registered.splice(index, 1);
      };
    }
  };
}

test('Web Telemetry Route: 前后端请求路径与宿主注册路径完全一致', () => {
  assert.equal(TELEMETRY_ROUTE_PATH, '/plugins/dsh-call-session/telemetry');

  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  const occurrences = clientSource.split(TELEMETRY_ROUTE_PATH).length - 1;
  assert.ok(occurrences >= 2, 'client must request the canonical host route in both fetch paths');
  assert.ok(
    !clientSource.includes('/api/dsh-call-session/telemetry'),
    'stale /api/... path must not survive anywhere in the client bundle'
  );

  assert.deepEqual([...WEB_SERVER_KEYS], ['webServer', 'httpServer']);
});

test('Web Telemetry Route: 宿主懒加载注册与 ctx.effect 卸载摘除', () => {
  const webServer = createMockWebServer();
  const ctx = createMockCtx({ webServer });

  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(surface.registered(), true);
  assert.equal(webServer.registered.length, 1);
  assert.equal(webServer.registered[0].path, TELEMETRY_ROUTE_PATH);
  assert.equal(webServer.registered[0].kind, 'exact');
  assert.ok(ctx.effects.includes('dsh-call-session: telemetry route'));

  // Idempotent: a second attempt must not double-register.
  surface.tryRegister();
  assert.equal(webServer.registered.length, 1);
});

test('Web Telemetry Route: 无 Web 宿主时保持 tool-only 静默降级', () => {
  const ctx = createMockCtx({ webServer: undefined });
  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(surface.registered(), false);
  assert.equal(ctx.effects.length, 0);
});

test('Web Telemetry Route: internal/service 事件延迟绑定后补挂载', () => {
  let webServer;
  const ctx = createMockCtx({ webServer: undefined });
  ctx.get = (name) => {
    if (name === 'webServer') return webServer;
    if (name === 'connection') return undefined;
    return undefined;
  };

  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });
  assert.equal(surface.registered(), false);

  webServer = createMockWebServer();
  ctx.emit('internal/service', 'webServer');

  assert.equal(surface.registered(), true);
  assert.equal(webServer.registered.length, 1);
});

test('Web Telemetry Route: httpServer 备选探针键生效', () => {
  const webServer = createMockWebServer();
  const ctx = createMockCtx({ webServer, serverKey: 'httpServer' });

  installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(webServer.registered.length, 1);
  assert.equal(webServer.registered[0].path, TELEMETRY_ROUTE_PATH);
});

test('Web Telemetry Route: 认证围栏拒绝未授权与服务缺失请求', async () => {
  const rawServer = createMockWebServer();

  // 1. Connection service missing -> 503, handler must never run.
  let handlerRuns = 0;
  const missingGate = authenticatedWebRoutes(rawServer, () => undefined);
  missingGate.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async () => { handlerRuns += 1; }
  });
  const res503 = createMockResponse();
  await rawServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res503);
  assert.equal(res503.statusCode, 503);
  assert.equal(JSON.parse(res503.body).error, 'authentication unavailable');
  assert.equal(handlerRuns, 0);
  assert.equal(res503.headers['cache-control'], 'no-store');

  // 2. Unauthorized -> 401.
  const unauthorizedServer = createMockWebServer();
  const unauthorizedGate = authenticatedWebRoutes(unauthorizedServer, () => ({
    requestRejection: () => 401
  }));
  unauthorizedGate.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async () => { handlerRuns += 1; }
  });
  const res401 = createMockResponse();
  await unauthorizedServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res401);
  assert.equal(res401.statusCode, 401);
  assert.equal(JSON.parse(res401.body).error, 'unauthorized');
  assert.equal(handlerRuns, 0);

  // 3. Forbidden -> 403.
  const forbiddenServer = createMockWebServer();
  const forbiddenGate = authenticatedWebRoutes(forbiddenServer, () => ({
    requestRejection: () => 403
  }));
  forbiddenGate.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async () => { handlerRuns += 1; }
  });
  const res403 = createMockResponse();
  await forbiddenServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res403);
  assert.equal(res403.statusCode, 403);
  assert.equal(JSON.parse(res403.body).error, 'forbidden');
  assert.equal(handlerRuns, 0);

  // 4. Authorized -> the inner handler finally runs.
  const okServer = createMockWebServer();
  const okGate = authenticatedWebRoutes(okServer, () => ({
    requestRejection: () => undefined
  }));
  okGate.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async (req, res) => {
      handlerRuns += 1;
      res.writeHead(200, {});
      res.end('{}');
    }
  });
  const res200 = createMockResponse();
  await okServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res200);
  assert.equal(res200.statusCode, 200);
  assert.equal(handlerRuns, 1);
});

test('Web Telemetry Route: 只读 GET-only，非 GET 返回 405', async () => {
  const ctx = createMockCtx({ agentsList: [] });
  const handler = createTelemetryHandler(ctx, { logger: silentLogger });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = createMockResponse();
    await handler({ method, url: TELEMETRY_ROUTE_PATH }, res);
    assert.equal(res.statusCode, 405, `${method} must be rejected`);
    assert.equal(res.headers.allow, 'GET');
    assert.equal(JSON.parse(res.body).error, 'method not allowed');
  }
});

test('Web Telemetry Route: GET 返回只读全景快照与查询参数透传', async () => {
  const telemetry = new CallTelemetryRingBuffer(50);
  telemetry.record({
    callerSessionId: 'session-aaaaaaaa-1',
    targetSessionId: 'session-bbbbbbbb-2',
    callerWorkspace: 'c:/workspace/app',
    targetWorkspace: 'c:/workspace/app',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    messagePayload: 'inspect the canvas'
  });

  const agents = [
    {
      id: 'session-aaaaaaaa-1',
      status: 'running',
      title: 'Caller',
      session: { id: 'session-aaaaaaaa-1', title: 'Caller', cwd: 'c:/workspace/app' }
    },
    {
      id: 'session-bbbbbbbb-2',
      status: 'idle',
      title: 'Target',
      session: { id: 'session-bbbbbbbb-2', title: 'Target', cwd: 'c:/workspace/app' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const handler = createTelemetryHandler(ctx, { logger: silentLogger });
  const res = createMockResponse();
  await handler({
    method: 'GET',
    url: TELEMETRY_ROUTE_PATH + '?sessionId=session-aaaaaaaa-1&crossWorkspace=true&limit=10'
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');

  const snapshot = JSON.parse(res.body);
  assert.equal(typeof snapshot.timestamp, 'number');
  assert.ok(Array.isArray(snapshot.sessions));
  assert.ok(Array.isArray(snapshot.calls));
  assert.ok(Array.isArray(snapshot.posts));
  assert.ok(Array.isArray(snapshot.workspaces));
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.calls[0].callType, 'task_dispatch');
  assert.equal(snapshot.metrics.totalSessions, 2);
  assert.equal(snapshot.metrics.runningSessions, 1);

  // Read-only invariant: the response carries no mutation affordance.
  const keys = Object.keys(snapshot);
  for (const forbidden of ['dispatch', 'send', 'steer', 'followup', 'delete', 'update']) {
    assert.ok(!keys.includes(forbidden), `snapshot must not expose ${forbidden}`);
  }
});

test('Web Telemetry Route: 快照聚合抛错时降级 500 且不泄漏内部堆栈', async () => {
  const brokenCtx = createMockCtx({ agentsList: [] });
  brokenCtx.agents = {
    list: () => { throw new Error('agents service exploded'); }
  };
  const handler = createTelemetryHandler(brokenCtx, { logger: silentLogger });

  const res = createMockResponse();
  await handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res);

  assert.equal(res.statusCode, 500);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error, 'telemetry unavailable');
  assert.ok(!res.body.includes('agents service exploded'));
});

test('Web Telemetry Route: 无 ctx.effect 的宿主仍能直接挂载', () => {
  const webServer = createMockWebServer();
  const ctx = createMockCtx({ webServer, hasEffect: false });

  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(surface.registered(), true);
  assert.equal(webServer.registered.length, 1);
});

test('Web Telemetry Route: apply 挂载遥测路由且不唤醒 Agent', async () => {
  const webServer = createMockWebServer();
  const wakeups = [];
  const agents = [
    {
      id: 'session-cccccccc-3',
      status: 'idle',
      title: 'Peer',
      session: { id: 'session-cccccccc-3', title: 'Peer', cwd: process.cwd() },
      steer: () => { wakeups.push('steer'); },
      followup: () => { wakeups.push('followup'); },
      send: () => { wakeups.push('send'); }
    }
  ];

  const registeredTools = [];
  const listeners = new Map();
  const ctx = {
    logger: () => silentLogger,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    async emit(event, ...args) {
      for (const handler of listeners.get(event) || []) await handler(...args);
    },
    effect: (factory) => factory(),
    get(name) {
      if (name === 'webServer') return webServer;
      if (name === 'connection') return { requestRejection: () => undefined };
      if (name === 'logger') return () => silentLogger;
      return undefined;
    },
    agents: {
      list: () => agents,
      get: (id) => agents.find((a) => a.id === id)
    },
    tools: {
      register: (def) => { registeredTools.push(def.name); }
    },
    systemPrompt: { add() {}, context() {} }
  };

  apply(ctx, {
    enabled: true,
    slashCommand: false,
    storagePath: path.join(rootDir, 'tests', '.tmp-web-route-board.json')
  });

  assert.equal(webServer.registered.length, 1);
  assert.equal(webServer.registered[0].path, TELEMETRY_ROUTE_PATH);

  // Telemetry must never be exposed as an LLM tool (ADR-0012 Invariant 4).
  for (const toolName of registeredTools) {
    assert.ok(
      !/telemetry|canvas/i.test(toolName),
      `tool "${toolName}" must not expose telemetry to the model`
    );
  }

  const res = createMockResponse();
  await webServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res);
  assert.equal(res.statusCode, 200);

  // Zero passive wake-up invariant across a real route hit.
  assert.deepEqual(wakeups, []);

  await ctx.emit('dispose');
  const tmpBoard = path.join(rootDir, 'tests', '.tmp-web-route-board.json');
  for (const leftover of [tmpBoard, `${tmpBoard}.bak`]) {
    if (fs.existsSync(leftover)) fs.rmSync(leftover, { force: true });
  }
});
