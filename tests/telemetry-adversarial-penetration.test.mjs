import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry
} from '../lib/call-telemetry.mjs';
import {
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH
} from '../lib/web-telemetry-route.mjs';

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

function createMockWebServer() {
  const registered = [];
  return {
    registered,
    register(route) {
      registered.push(route);
      return () => {
        const idx = registered.indexOf(route);
        if (idx >= 0) registered.splice(idx, 1);
      };
    }
  };
}

test('遥测路由认证校验：401 未授权、403 禁止访问与 503 服务不可用拦截', async () => {
  const rawServer = createMockWebServer();
  let underlyingHandlerInvocations = 0;

  // 1.1 恶意穿透头注入攻击 (20+ 伪造认证与代理头组合)
  const maliciousHeaders = [
    { authorization: 'Bearer invalid-expired-token' },
    { authorization: 'Basic YWRtaW46cGFzc3dvcmQ=' },
    { cookie: 'dsh_session=admin; bypass_auth=true' },
    { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' },
    { 'x-real-ip': '127.0.0.1' },
    { 'x-remote-user': 'admin' },
    { 'x-custom-auth': 'root' },
    { 'x-original-url': '/plugins/dsh-call-session/telemetry' },
    { 'x-rewrite-url': '/plugins/dsh-call-session/telemetry' },
    { 'x-authenticated-user': 'superuser' }
  ];

  // 模拟 Connection 门禁：只要无合法 session 均判 401 未授权
  const authFence = authenticatedWebRoutes(rawServer, () => ({
    requestRejection: (req) => {
      // 真实鉴权逻辑必须拒绝所有无内置凭证的伪造头
      if (req.headers && req.headers['x-valid-internal-token'] === 'valid-secret') {
        return undefined;
      }
      return 401;
    }
  }));

  authFence.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async (req, res) => {
      underlyingHandlerInvocations++;
      res.writeHead(200, {});
      res.end('{}');
    }
  });

  const boundHandler = rawServer.registered[0].handler;

  for (const headers of maliciousHeaders) {
    const res = createMockResponse();
    await boundHandler({
      method: 'GET',
      url: TELEMETRY_ROUTE_PATH,
      headers
    }, res);

    assert.equal(res.statusCode, 401, '伪造请求头返回 401');
    assert.equal(res.headers['cache-control'], 'no-store', '响应头包含 no-store');
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    const parsed = JSON.parse(res.body);
    assert.equal(parsed.error, 'unauthorized', '返回 unauthorized 错误');
    assert.equal(parsed.stack, undefined, '不向客户端返回堆栈信息');
  }

  // 1.2 越权访问 (Forbidden 403) 拦截
  const forbiddenServer = createMockWebServer();
  const forbiddenFence = authenticatedWebRoutes(forbiddenServer, () => ({
    requestRejection: () => 403
  }));
  forbiddenFence.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async () => { underlyingHandlerInvocations++; }
  });
  const res403 = createMockResponse();
  await forbiddenServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res403);
  assert.equal(res403.statusCode, 403);
  assert.equal(JSON.parse(res403.body).error, 'forbidden');

  // 1.3 服务离线 (Service Unavailable 503) 拦截
  const missingServer = createMockWebServer();
  const missingFence = authenticatedWebRoutes(missingServer, () => undefined);
  missingFence.register({
    kind: 'exact',
    path: TELEMETRY_ROUTE_PATH,
    handler: async () => { underlyingHandlerInvocations++; }
  });
  const res503 = createMockResponse();
  await missingServer.registered[0].handler({ method: 'GET', url: TELEMETRY_ROUTE_PATH }, res503);
  assert.equal(res503.statusCode, 503);
  assert.equal(JSON.parse(res503.body).error, 'authentication unavailable');

  // 核心安全断言：在所有未授权/越权/缺失场景下，底层真实 Handler 执行次数为 0
  assert.equal(underlyingHandlerInvocations, 0, '未授权请求不调用底层数据处理器');
});

test('遥测路由 HTTP 请求方法限制：非 GET 请求返回 405', async () => {
  let aggregatorExecuted = 0;
  const mockCtx = {
    agents: { list: () => [] },
    boardStore: { list: () => [] },
    callTelemetry: new CallTelemetryRingBuffer(20)
  };

  const handler = createTelemetryHandler(mockCtx, {
    logger: {
      debug() {},
      warn() {}
    }
  });

  // 2.1 全量标准与非标准非 GET HTTP 动词
  const prohibitedMethods = [
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'HEAD',
    'TRACE',
    'CONNECT',
    'PROPFIND',
    'MKCOL',
    'INJECT_ACTION',
    'CUSTOM_MALICIOUS'
  ];

  for (const method of prohibitedMethods) {
    const res = createMockResponse();
    await handler({
      method,
      url: TELEMETRY_ROUTE_PATH,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ malicious: 'write_payload' })
    }, res);

    assert.equal(res.statusCode, 405, `方法 ${method} 返回 405`);
    assert.equal(res.headers.allow, 'GET', '响应头明确提示 allow: GET');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(res.body).error, 'method not allowed');
  }

  // 2.2 动词混淆与覆盖（Method Overriding Attack）
  const overrideHeaders = [
    { 'x-http-method-override': 'GET' },
    { 'x-method-override': 'GET' },
    { 'x-http-method': 'GET' },
    { 'x-method': 'GET' }
  ];

  for (const headers of overrideHeaders) {
    const res = createMockResponse();
    // 发起 POST 请求试图通过 Header 伪装为 GET
    await handler({
      method: 'POST',
      url: TELEMETRY_ROUTE_PATH,
      headers
    }, res);

    assert.equal(res.statusCode, 405, '非 GET 请求返回 405');
    assert.equal(res.headers.allow, 'GET');
  }

  // 2.3 畸形 URL 路径与查询参数对抗注入
  const maliciousUrls = [
    `${TELEMETRY_ROUTE_PATH}/../../../etc/passwd`,
    `${TELEMETRY_ROUTE_PATH}?limit=-99999`,
    `${TELEMETRY_ROUTE_PATH}?limit=NaN`,
    `${TELEMETRY_ROUTE_PATH}?limit=${'9'.repeat(100)}`,
    `${TELEMETRY_ROUTE_PATH}?sessionId=${'%00%00%00'}`,
    `${TELEMETRY_ROUTE_PATH}?crossWorkspace=invalid_bool_string`,
    `${TELEMETRY_ROUTE_PATH}?${'a'.repeat(20000)}=${'b'.repeat(20000)}`
  ];

  for (const url of maliciousUrls) {
    const res = createMockResponse();
    await handler({
      method: 'GET',
      url
    }, res);

    // 异常路径应受控容错，返回 200 快照或 500 错误，不产生未捕获异常
    assert.ok(res.statusCode === 200 || res.statusCode === 500, `URL [${url}] 安全响应`);
    if (res.statusCode === 200) {
      const snap = JSON.parse(res.body);
      assert.ok(Array.isArray(snap.sessions));
      assert.ok(Array.isArray(snap.calls));
    }
  }
});

test('环形缓冲区 Payload 截断与原型链污染防御', () => {
  const buffer = new CallTelemetryRingBuffer(20);

  // 3.1 原型链污染防御测试
  const prototypePayload = JSON.parse('{"__proto__": {"polluted": true, "isAdmin": true}}');
  buffer.record({
    callerSessionId: 'sess-attack-1',
    targetSessionId: 'sess-target-1',
    messagePayload: 'Normal text',
    ...prototypePayload
  });

  assert.equal(({}).polluted, undefined, '环形缓冲区遭受 __proto__ 原型链污染检查');
  assert.equal(({}).isAdmin, undefined, '全局原型链属性未被修改');

  // 3.2 灌入超大 Payload (100KB, 500KB)
  const hugeString100KB = 'A'.repeat(1024 * 100);
  const hugeString500KB = 'X\r\n\t'.repeat(1024 * 150);

  const rec1 = buffer.record({
    callerSessionId: 'sess-huge-1',
    targetSessionId: 'sess-huge-2',
    callerWorkspace: 'c:/workspace/test',
    targetWorkspace: 'c:/workspace/test',
    messagePayload: hugeString100KB
  });

  // 摘要清洗截断断言 (<= 120 字符)
  assert.ok(rec1.messageSnippet.length <= 120, 'messageSnippet 截断至 120 字符以内');
  assert.ok(rec1.messageSnippet.endsWith('...'), '截断摘要末尾携带省略号');

  // messagePayload 钳位断言 (<= 8192 字符)
  assert.ok(rec1.messagePayload.length <= 8192, 'messagePayload 长度在 8192 字符以内');

  const rec2 = buffer.record({
    callerSessionId: 'sess-huge-3',
    targetSessionId: 'sess-huge-4',
    callerWorkspace: 'c:/workspace/test',
    targetWorkspace: 'c:/workspace/test',
    messagePayload: hugeString500KB
  });
  assert.ok(rec2.messageSnippet.length <= 120);
  assert.ok(rec2.messagePayload.length <= 8192);

  // 3.3 非法元数据处理
  const rec3 = buffer.record({
    callerSessionId: 'S'.repeat(5000), // 超长 Session ID
    callerTitle: 'T'.repeat(5000),
    targetSessionId: 'T'.repeat(5000),
    targetTitle: 'Target'.repeat(1000),
    contextPostIds: Array.from({ length: 1000 }, (_, i) => `post-${i}`.repeat(50))
  });

  assert.ok(rec3.callerSessionId.length <= 128, 'callerSessionId 长度在 128 字符以内');
  assert.ok(rec3.callerTitle.length <= 128, 'callerTitle 长度在 128 字符以内');
  assert.ok(rec3.targetSessionId.length <= 128, 'targetSessionId 长度在 128 字符以内');
  assert.ok(rec3.contextPostIds.length <= 50, 'contextPostIds 数组长度在 50 条以内');
});

test('环形缓冲区 FIFO 淘汰与内存占用测试', () => {
  const capacity = 50;
  const buffer = new CallTelemetryRingBuffer(capacity);
  assert.equal(buffer.capacity(), capacity);

  const initialMemory = process.memoryUsage().heapUsed;

  // 4.1 写入 5,000 条调用记录，超出容量上限
  const TOTAL_WRITES = 5000;
  for (let i = 1; i <= TOTAL_WRITES; i++) {
    buffer.record({
      id: `call-seq-${i}`,
      callerSessionId: `session-caller-${i % 10}`,
      targetSessionId: `session-target-${(i + 1) % 10}`,
      callerWorkspace: i % 2 === 0 ? 'c:/workspace/proj-a' : 'c:/workspace/proj-b',
      targetWorkspace: i % 3 === 0 ? 'c:/workspace/proj-a' : 'c:/workspace/proj-b',
      messagePayload: `Concurreny stress payload #${i} with metadata payload chunk`,
      timestamp: 1700000000000 + i
    });
  }

  // 4.2 容量上限断言
  assert.equal(buffer.size(), capacity, `缓冲区条目总数等于容量上限 ${capacity}`);

  // 4.3 按 FIFO 淘汰检验
  const remaining = buffer.query({ crossWorkspace: true, limit: 100 });
  assert.equal(remaining.length, capacity);

  // 最早留存的记录必须是第 TOTAL_WRITES - capacity + 1 (4951) 条
  const firstRetainedId = remaining[0].id;
  assert.equal(firstRetainedId, `call-seq-${TOTAL_WRITES - capacity + 1}`, '最旧记录被 FIFO 淘汰');

  // 最新留存的记录必须是第 TOTAL_WRITES (5000) 条
  const lastRetainedId = remaining[capacity - 1].id;
  assert.equal(lastRetainedId, `call-seq-${TOTAL_WRITES}`, '最新记录在队尾留存');

  // 4.4 内存审查
  if (typeof global.gc === 'function') {
    global.gc();
  }
  const finalMemory = process.memoryUsage().heapUsed;
  const memoryDeltaMB = (finalMemory - initialMemory) / (1024 * 1024);
  assert.ok(memoryDeltaMB < 25, `5000 次写入 FIFO 淘汰后堆内存增量受控（当前增量: ${memoryDeltaMB.toFixed(2)} MB）`);

  // 4.5 参数容错与类型鲁棒性
  assert.throws(() => buffer.record(null), /必须是对象/);
  assert.throws(() => buffer.record(undefined), /必须是对象/);
  assert.throws(() => buffer.record('invalid-string'), /必须是对象/);
  assert.throws(() => buffer.record(12345), /必须是对象/);

  // 允许空对象写入并赋默认值
  const emptyRec = buffer.record({});
  assert.ok(emptyRec.id.startsWith('call-'));
  assert.equal(emptyRec.callerSessionId, 'unknown-caller');
  assert.equal(emptyRec.status, 'active');
});

test('画板全景快照与遥测路由不产生被动唤醒', async () => {
  // 5.1 构造包含 15 个会话的复杂集群，并对所有唤醒入口挂载高敏感度拦截监控 Spy
  const wakeUpCalls = [];
  function createSpyAgent(id, { status = 'idle', isSubagent = false } = {}) {
    return {
      id,
      status,
      session: {
        id,
        title: `Session ${id}`,
        cwd: 'c:/workspace/app',
        header: Object.freeze({
          version: 0,
          id,
          origin: isSubagent ? 'subagent' : undefined,
          cwd: 'c:/workspace/app'
        })
      },
      // 间谍探测入口：一旦任何只读快照流程意外触碰以下方法，立即拦截录制
      steer(...args) {
        wakeUpCalls.push({ agentId: id, method: 'steer', args });
      },
      followup(...args) {
        wakeUpCalls.push({ agentId: id, method: 'followup', args });
      },
      send(...args) {
        wakeUpCalls.push({ agentId: id, method: 'send', args });
      },
      step(...args) {
        wakeUpCalls.push({ agentId: id, method: 'step', args });
      },
      prompt(...args) {
        wakeUpCalls.push({ agentId: id, method: 'prompt', args });
      },
      cancel(...args) {
        wakeUpCalls.push({ agentId: id, method: 'cancel', args });
      }
    };
  }

  const agents = [
    createSpyAgent('root-idle-1', { status: 'idle' }),
    createSpyAgent('root-idle-2', { status: 'idle' }),
    createSpyAgent('root-running-1', { status: 'running' }),
    createSpyAgent('root-running-2', { status: 'running' }),
    createSpyAgent('sub-idle-1', { status: 'idle', isSubagent: true }),
    createSpyAgent('sub-running-1', { status: 'running', isSubagent: true }),
    createSpyAgent('archived-session-1', { status: 'idle' })
  ];

  const ringBuffer = new CallTelemetryRingBuffer(50);
  ringBuffer.record({
    callerSessionId: 'root-running-1',
    targetSessionId: 'root-idle-1',
    callerWorkspace: 'c:/workspace/app',
    targetWorkspace: 'c:/workspace/app',
    messagePayload: 'inspect system'
  });

  const mockCtx = {
    logger: () => ({ debug() {}, warn() {}, info() {}, error() {} }),
    agents: {
      list: () => agents,
      get: (id) => agents.find(a => a.id === id)
    },
    archivedSessions: {
      list: () => ['archived-session-1']
    },
    boardStore: {
      list: () => [
        { id: 'post-1', topic: 'task', content: 'test post', authorSessionId: 'root-idle-1' }
      ]
    },
    callTelemetry: ringBuffer,
    tools: new Map([
      ['session_call', { name: 'session_call' }],
      ['session_query', { name: 'session_query' }],
      ['session_create', { name: 'session_create' }],
      ['board_post', { name: 'board_post' }],
      ['board_list', { name: 'board_list' }],
      ['board_clear', { name: 'board_clear' }]
    ])
  };

  const handler = createTelemetryHandler(mockCtx, {
    logger: { debug() {}, warn() {} }
  });

  // 5.2 高频并发调用 200 次 getCanvasTelemetry 快照聚合与 HTTP 路由
  const CONCURRENT_RUNS = 200;
  const promises = [];
  for (let i = 0; i < CONCURRENT_RUNS; i++) {
    promises.push((async () => {
      // 方式 A: 直接调用 getCanvasTelemetry 门面
      const snap = await getCanvasTelemetry(mockCtx, {
        workspace: 'c:/workspace/app',
        crossWorkspace: i % 2 === 0
      });
      assert.ok(snap.sessions.length > 0);

      // 方式 B: 通过 Web 路由 Handler 处理
      const res = createMockResponse();
      await handler({
        method: 'GET',
        url: `${TELEMETRY_ROUTE_PATH}?limit=10&crossWorkspace=true`
      }, res);
      assert.equal(res.statusCode, 200);
    })());
  }

  await Promise.all(promises);

  // 5.3 核心架构原则断言：不触发被动唤醒
  assert.equal(
    wakeUpCalls.length,
    0,
    `全景画板快照与遥测路由在 ${CONCURRENT_RUNS * 2} 次并发拉取中触发了 ${wakeUpCalls.length} 次被动唤醒`
  );

  // 5.4 架构防御断言：遥测接口不注册为 Agent Tool
  assert.equal(mockCtx.tools.has('canvas_telemetry'), false, '遥测接口不注册为 Agent Tool');
  assert.equal(mockCtx.tools.has('get_telemetry'), false, '遥测接口不注册为 Agent Tool');
  assert.equal(mockCtx.tools.has('telemetry_query'), false, '遥测接口不注册为 Agent Tool');
});
