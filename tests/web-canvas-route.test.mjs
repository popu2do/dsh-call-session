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
  WEB_SERVER_KEYS,
  getCanvasTelemetry,
  computeSessionShortId,
  isHumanReadableTitle,
  resolveCanvasSessionDisplayTitle
} from '../lib/web-telemetry-route.mjs';
import { CallTelemetryRingBuffer } from '../lib/call-telemetry.mjs';
import { apply } from '../index.mjs';
import { silentLogger } from './helpers/mock-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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

test('Web Canvas Route: 前后端请求路径与宿主注册路径完全一致', () => {
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

test('Web Canvas Route: 宿主懒加载注册与 ctx.effect 卸载摘除', () => {
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

test('Web Canvas Route: 无 Web 宿主时保持 tool-only 静默回退', () => {
  const ctx = createMockCtx({ webServer: undefined });
  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(surface.registered(), false);
  assert.equal(ctx.effects.length, 0);
});

test('Web Canvas Route: internal/service 事件延迟绑定后补挂载', () => {
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

test('Web Canvas Route: httpServer 备选探针键生效', () => {
  const webServer = createMockWebServer();
  const ctx = createMockCtx({ webServer, serverKey: 'httpServer' });

  installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(webServer.registered.length, 1);
  assert.equal(webServer.registered[0].path, TELEMETRY_ROUTE_PATH);
});

test('Web Canvas Route: 认证围栏拒绝未授权与服务缺失请求', async () => {
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

test('Web Canvas Route: 只读 GET-only，非 GET 返回 405', async () => {
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

test('Web Canvas Route: GET 返回只读全景快照与查询参数透传', async () => {
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

test('Web Canvas Route: 无 crossWorkspace 参数时默认返回全量多工作区与全部会话 (ADR-0013)', async () => {
  const telemetry = new CallTelemetryRingBuffer(20);
  telemetry.record({
    callerSessionId: 'session-main-1',
    callerTitle: 'Main Dev',
    callerWorkspace: 'c:/workspace/proj-main',
    targetSessionId: 'session-peer-2',
    targetTitle: 'Peer Dev',
    targetWorkspace: 'c:/workspace/proj-peer',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    durationMs: 5,
    contextPostIds: [],
    messageSnippet: 'Cross-workspace dispatch',
    messagePayload: 'Full payload',
    status: 'active'
  });

  const agents = [
    {
      id: 'session-main-1',
      status: 'running',
      title: 'Main Dev',
      session: { id: 'session-main-1', title: 'Main Dev', cwd: 'c:/workspace/proj-main' }
    },
    {
      id: 'session-peer-2',
      status: 'idle',
      title: 'Peer Dev',
      session: { id: 'session-peer-2', title: 'Peer Dev', cwd: 'c:/workspace/proj-peer' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const handler = createTelemetryHandler(ctx, { logger: silentLogger });
  const res = createMockResponse();

  // 请求时不带任何 crossWorkspace 参数
  await handler({
    method: 'GET',
    url: TELEMETRY_ROUTE_PATH + '?sessionId=session-main-1'
  }, res);

  assert.equal(res.statusCode, 200);
  const snapshot = JSON.parse(res.body);

  // 必须返回全部 2 个工作区和全部 2 个会话
  assert.equal(snapshot.workspaces.length, 2, '未传 crossWorkspace 参数时必须返回全量 2 个工作区');
  assert.equal(snapshot.sessions.length, 2, '未传 crossWorkspace 参数时必须返回全量 2 个会话');
  assert.equal(snapshot.calls.length, 1, '跨工作区调用必须包含在内');
});

test('Web Canvas Route: 快照聚合抛错时返回 500 且不泄漏内部堆栈', async () => {
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

test('Web Canvas Route: 无 ctx.effect 的宿主仍能直接挂载', () => {
  const webServer = createMockWebServer();
  const ctx = createMockCtx({ webServer, hasEffect: false });

  const surface = installTelemetryWebSurface(ctx, { logger: silentLogger });

  assert.equal(surface.registered(), true);
  assert.equal(webServer.registered.length, 1);
});

test('Web Canvas Route: apply 挂载看板数据路由且不唤醒 Agent', async () => {
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

test('Web Canvas Route: 快照聚合器独立性与全景数据协同验证', async () => {
  // 1. 验证 getCanvasTelemetry 及其辅助纯函数从 lib/web-telemetry-route.mjs 独立导出
  assert.equal(typeof getCanvasTelemetry, 'function', 'getCanvasTelemetry 必须在 web-telemetry-route 中原生导出');
  assert.equal(typeof computeSessionShortId, 'function', 'computeSessionShortId 必须在 web-telemetry-route 中原生导出');
  assert.equal(typeof isHumanReadableTitle, 'function', 'isHumanReadableTitle 必须在 web-telemetry-route 中原生导出');
  assert.equal(typeof resolveCanvasSessionDisplayTitle, 'function', 'resolveCanvasSessionDisplayTitle 必须在 web-telemetry-route 中原生导出');

  // 2. 验证聚合器直接协同 SessionDirectory 与 CallTelemetryRingBuffer
  const ringBuffer = new CallTelemetryRingBuffer(20);
  ringBuffer.record({
    callerSessionId: 'agent-standalone-1',
    targetSessionId: 'agent-standalone-2',
    callerWorkspace: 'c:/workspace/app',
    targetWorkspace: 'c:/workspace/app',
    messagePayload: 'standalone aggregator test'
  });

  const mockCtx = {
    callTelemetry: ringBuffer,
    agents: {
      list: () => [
        { id: 'agent-standalone-1', status: 'running', session: { id: 'agent-standalone-1', title: 'Standalone-1', cwd: 'c:/workspace/app' } },
        { id: 'agent-standalone-2', status: 'idle', session: { id: 'agent-standalone-2', title: 'Standalone-2', cwd: 'c:/workspace/app' } }
      ],
      get: (id) => (id === 'agent-standalone-1'
        ? { id: 'agent-standalone-1', status: 'running', session: { id: 'agent-standalone-1', title: 'Standalone-1', cwd: 'c:/workspace/app' } }
        : { id: 'agent-standalone-2', status: 'idle', session: { id: 'agent-standalone-2', title: 'Standalone-2', cwd: 'c:/workspace/app' } })
    },
    get(key) {
      if (key === 'callTelemetry') return ringBuffer;
      return undefined;
    }
  };

  const snapshot = await getCanvasTelemetry(mockCtx, { workspace: 'c:/workspace/app', crossWorkspace: true });
  assert.ok(typeof snapshot.timestamp === 'number');
  assert.equal(snapshot.sessions.length, 2);
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.metrics.totalSessions, 2);
  assert.equal(snapshot.metrics.activeCalls, 1);
});

test('Web Canvas Route: 非顶层会话、其连线与相关计数在出站前收窄 (ADR-0013)', async () => {
  const telemetry = new CallTelemetryRingBuffer(20);
  const record = (targetSessionId, targetTitle) => telemetry.record({
    callerSessionId: 'session-lead',
    callerTitle: 'Lead',
    callerWorkspace: 'c:/workspace/proj-main',
    targetSessionId,
    targetTitle,
    targetWorkspace: 'c:/workspace/proj-main',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    durationMs: 5,
    contextPostIds: [],
    messageSnippet: 'dispatch',
    messagePayload: 'payload',
    status: 'active'
  });
  record('session-subagent', 'Worker');
  record('session-partner', 'Partner');

  const agents = [
    {
      id: 'session-lead',
      status: 'running',
      title: 'Lead',
      session: { id: 'session-lead', title: 'Lead', cwd: 'c:/workspace/proj-main' }
    },
    {
      id: 'session-partner',
      status: 'idle',
      title: 'Partner',
      session: { id: 'session-partner', title: 'Partner', cwd: 'c:/workspace/proj-peers' }
    },
    {
      id: 'session-subagent',
      status: 'running',
      title: 'Worker',
      session: {
        id: 'session-subagent',
        title: 'Worker',
        cwd: 'c:/workspace/proj-main',
        header: { origin: 'subagent' }
      }
    },
    {
      id: 'session-blank',
      status: 'idle',
      title: 'Blank',
      blank: true,
      session: { id: 'session-blank', title: 'Blank', cwd: 'c:/workspace/proj-empty' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });
  const ids = snapshot.sessions.map((s) => s.id);

  assert.deepEqual(ids.slice().sort(), ['session-lead', 'session-partner'], '非顶层会话不得下发到看板');
  assert.equal(snapshot.metrics.totalSessions, 2, '会话总数必须按可见集合统计');
  assert.equal(snapshot.metrics.runningSessions, 1, '运行中会话数必须按可见集合统计');
  assert.equal(snapshot.metrics.activeCalls, 1, '活动调用数必须按可见集合统计');
  assert.equal(snapshot.calls.length, 1, '端点为隐藏会话的调用不得下发');
  assert.deepEqual(
    snapshot.workspaces.map((ws) => ws.id).slice().sort(),
    ['c:/workspace/proj-main', 'c:/workspace/proj-peers'],
    '只含隐藏会话的工作区不得下发空列'
  );

  const lead = snapshot.sessions.find((s) => s.id === 'session-lead');
  assert.deepEqual(
    { outbound: lead.stats.outboundCalls, inbound: lead.stats.inboundCalls },
    { outbound: 1, inbound: 0 },
    '会话统计必须排除通往隐藏会话的调用'
  );
});
test('Web Canvas Route: 离开 roster 的隐藏端点沿用记录来源，只剩隐藏会话的当前工作区不留列 (ADR-0013 §2.2.7)', async () => {
  const telemetry = new CallTelemetryRingBuffer(20);
  const record = (targetSessionId, targetTitle, targetNonTopLevel) => telemetry.record({
    callerSessionId: 'session-lead',
    callerTitle: 'Lead',
    callerWorkspace: 'c:/workspace/proj-main',
    targetSessionId,
    targetTitle,
    targetWorkspace: 'c:/workspace/proj-workers',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    durationMs: 3,
    contextPostIds: [],
    messageSnippet: 'dispatch',
    messagePayload: 'payload',
    callerNonTopLevel: false,
    targetNonTopLevel,
    status: 'settled'
  });
  record('session-worker', 'Worker', true);
  record('session-partner', 'Partner', false);

  // worker 离开 roster 后 agents.list 只剩两个顶层会话，它只能靠调用记录合成端点
  const agents = [
    {
      id: 'session-lead',
      status: 'running',
      title: 'Lead',
      session: { id: 'session-lead', title: 'Lead', cwd: 'c:/workspace/proj-main' }
    },
    {
      id: 'session-partner',
      status: 'idle',
      title: 'Partner',
      session: { id: 'session-partner', title: 'Partner', cwd: 'c:/workspace/proj-main' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-workers', crossWorkspace: true });
  const ids = snapshot.sessions.map((s) => s.id);

  assert.deepEqual(ids.slice().sort(), ['session-lead', 'session-partner'], '合成端点必须沿用调用记录里的来源，隐藏 worker 不得回流');
  assert.equal(snapshot.calls.length, 1, '通往隐藏端点的调用不得下发');
  assert.deepEqual(
    snapshot.workspaces.map((ws) => ws.id),
    ['c:/workspace/proj-main'],
    '只剩隐藏会话的当前工作区不得下发空列'
  );
  assert.equal(snapshot.metrics.totalSessions, 2, '合成端点不得计入会话总数');
});

test('Web Canvas Route: 归档到 archivedSessionIds 的隐藏端点不得凭 settled 记录回流 (ADR-0013 §2.2.7)', async () => {
  const telemetry = new CallTelemetryRingBuffer(20);
  telemetry.record({
    callerSessionId: 'session-lead',
    callerTitle: 'Lead',
    callerWorkspace: 'c:/workspace/proj-main',
    targetSessionId: 'session-worker',
    targetTitle: 'Worker',
    targetWorkspace: 'c:/workspace/proj-main',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    durationMs: 4,
    contextPostIds: [],
    messageSnippet: 'dispatch',
    messagePayload: 'payload',
    callerNonTopLevel: false,
    targetNonTopLevel: true,
    status: 'settled'
  });

  const agents = [
    {
      id: 'session-lead',
      status: 'running',
      title: 'Lead',
      session: { id: 'session-lead', title: 'Lead', cwd: 'c:/workspace/proj-main' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  // 真实归档路径：worker 在归档名单里，故不会合成会话行，只剩记录上的来源标记可用
  ctx.archivedSessionIds = new Set(['session-worker']);
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });

  assert.deepEqual(snapshot.sessions.map((s) => s.id), ['session-lead'], '归档端点不得回流成会话行');
  assert.equal(snapshot.calls.length, 0, '端点已归档的 settled 调用不得下发');
  assert.equal(snapshot.metrics.totalSessions, 1, '归档端点不得计入会话总数');
  assert.equal(snapshot.metrics.activeCalls, 0, '归档端点不得计入活动调用');
  const lead = snapshot.sessions.find((s) => s.id === 'session-lead');
  assert.equal(lead.stats.outboundCalls, 0, '会话统计必须排除通往归档端点的调用');
});

test('Web Canvas Route: 黑板作者不在 roster 时不合成会话 (ADR-0013 §2.2.3)', async () => {
  const agents = [
    {
      id: 'session-lead',
      status: 'running',
      title: 'Lead',
      session: { id: 'session-lead', title: 'Lead', cwd: 'c:/workspace/proj-main' }
    }
  ];
  const boardStore = {
    list() {
      return [
        { id: 'post-1', topic: 'worker-note', content: 'from a worker', authorSessionId: 'session-worker', authorTitle: 'Worker', status: 'active' }
      ];
    }
  };

  const ctx = createMockCtx({ agentsList: agents });
  ctx.boardStore = boardStore;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'boardStore' ? boardStore : baseGet(name));

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });

  assert.equal(snapshot.posts.length, 1, '条目本身必须照常下发');
  assert.deepEqual(snapshot.sessions.map((s) => s.id), ['session-lead'], '不在 roster 的作者不得合成为会话节点');
  assert.equal(snapshot.metrics.totalSessions, 1, '合成作者不得计入会话总数');
});

test('Web Canvas Route: 整张看板无顶层会话时保留当前工作区空列 (ADR-0013 §2.2.4)', async () => {
  const agents = [
    {
      id: 'session-worker',
      status: 'running',
      title: 'Worker',
      session: {
        id: 'session-worker',
        title: 'Worker',
        cwd: 'c:/workspace/proj-main',
        header: { origin: 'subagent' }
      }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });

  assert.equal(snapshot.sessions.length, 0, '只剩非顶层会话时不得下发会话');
  assert.deepEqual(snapshot.workspaces.map((ws) => ws.id), ['c:/workspace/proj-main'], '零顶层会话时保留当前工作区作为锚点');
  assert.deepEqual(snapshot.workspaces[0].sessionIds, [], '锚点列不含节点');
  assert.equal(snapshot.metrics.totalSessions, 0, '零顶层会话时总数为 0');
});

test('Web Canvas Route: 全顶层载荷下无会话的当前工作区仍占空列 (ADR-0013 §2.2.4)', async () => {
  const agents = [
    {
      id: 'session-peer',
      status: 'running',
      title: 'Peer',
      session: { id: 'session-peer', title: 'Peer', cwd: 'c:/workspace/proj-peer' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });

  assert.deepEqual(
    snapshot.workspaces.map((ws) => ws.id),
    ['c:/workspace/proj-main', 'c:/workspace/proj-peer'],
    '收窄没有隐藏任何会话，当前工作区列必须与收窄前一样保留'
  );
  assert.deepEqual(snapshot.workspaces[0].sessionIds, [], '当前工作区本来就没有存活会话，列内无节点');
  assert.equal(snapshot.workspaces[0].isCurrent, true, '保留的当前列仍带当前标记');
});

test('Web Canvas Route: 出站会话必带 isTopLevel 标记 (ADR-0013 §2.2.1)', async () => {
  const telemetry = new CallTelemetryRingBuffer(20);
  telemetry.record({
    callerSessionId: 'session-lead',
    callerTitle: 'Lead',
    callerWorkspace: 'c:/workspace/proj-main',
    targetSessionId: 'session-departed',
    targetTitle: 'Departed',
    targetWorkspace: 'c:/workspace/proj-main',
    callType: 'task_dispatch',
    deliveryMode: 'followup',
    durationMs: 2,
    contextPostIds: [],
    messageSnippet: 'dispatch',
    messagePayload: 'payload',
    callerNonTopLevel: false,
    targetNonTopLevel: false,
    status: 'active'
  });

  const agents = [
    {
      id: 'session-lead',
      status: 'running',
      title: 'Lead',
      session: { id: 'session-lead', title: 'Lead', cwd: 'c:/workspace/proj-main' }
    }
  ];

  const ctx = createMockCtx({ agentsList: agents });
  ctx.callTelemetry = telemetry;
  const baseGet = ctx.get;
  ctx.get = (name) => (name === 'callTelemetry' ? telemetry : baseGet(name));

  const snapshot = await getCanvasTelemetry(ctx, { workspace: 'c:/workspace/proj-main', crossWorkspace: true });

  assert.deepEqual(snapshot.sessions.map((s) => s.id).sort(), ['session-departed', 'session-lead']);
  for (const session of snapshot.sessions) {
    assert.equal(typeof session.isTopLevel, 'boolean', `会话 ${session.id} 必须带 isTopLevel 标记`);
  }
  const departed = snapshot.sessions.find((s) => s.id === 'session-departed');
  assert.equal(departed.isTopLevel, true, '合成端点沿用记录里的顶层来源，客户端不得因缺标记而误判');
});
