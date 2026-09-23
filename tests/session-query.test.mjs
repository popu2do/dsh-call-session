import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery
} from '../lib/session-query.mjs';

function createMockAgent(id, {
  status = 'idle',
  title = 'Test Session',
  cwd = 'c:/workspace/project-a',
  origin = undefined,
  blank = false,
  events = []
} = {}) {
  return {
    id,
    status,
    title,
    origin,
    blank,
    session: {
      id,
      title,
      cwd,
      events
    }
  };
}

function createMockCtx({
  agentsList = [],
  archivedIds = [],
  sessionTitleMap = {}
} = {}) {
  const archivedSet = new Set(archivedIds);
  return {
    get(name) {
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: archivedSet };
      }
      if (name === 'sessionTitle') {
        return {
          get: (session) => ({ title: sessionTitleMap[session?.id] || '' })
        };
      }
      return undefined;
    },
    agents: {
      list: () => agentsList
    }
  };
}

test('getArchivedSessionIds: 解析归档 ID 集合（大小写容错）', () => {
  assert.equal(getArchivedSessionIds(null).size, 0);
  assert.equal(getArchivedSessionIds({}).size, 0);

  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') {
        return { archivedSessionIds: ['Session-Alpha', 'session-beta'] };
      }
      return undefined;
    }
  };

  const ids = getArchivedSessionIds(ctx);
  assert.equal(ids.size, 3); // 'Session-Alpha', 'session-alpha', 'session-beta'
  assert.ok(ids.has('Session-Alpha'));
  assert.ok(ids.has('session-alpha'));
  assert.ok(ids.has('session-beta'));
});

test('resolveSessionCwd & resolveSessionTitle: 多源元数据解析优先级', () => {
  // 1. cwd: 优先 header.cwd，其次 cwd
  const agentHeaderCwd = { session: { header: { cwd: 'd:/header/path' }, cwd: 'd:/base/path' } };
  assert.equal(resolveSessionCwd(agentHeaderCwd), 'd:/header/path');

  const agentBaseCwd = { session: { cwd: 'd:/base/path' } };
  assert.equal(resolveSessionCwd(agentBaseCwd), 'd:/base/path');
  assert.equal(resolveSessionCwd(null), '');

  // 2. title: session.title > agent.title > sessionTitle 服务 > event 历史
  const ctx = createMockCtx({ sessionTitleMap: { 'agent-title-svc': 'Service Title' } });

  // 2.1 session.title
  assert.equal(resolveSessionTitle(ctx, { session: { title: 'Direct Title' } }), 'Direct Title');

  // 2.2 agent.title
  assert.equal(resolveSessionTitle(ctx, { title: 'Agent Prop Title' }), 'Agent Prop Title');

  // 2.3 sessionTitle 服务
  assert.equal(resolveSessionTitle(ctx, { session: { id: 'agent-title-svc' } }), 'Service Title');

  // 2.4 session.events 事件历史提取
  const agentWithEvents = {
    session: {
      events: [
        { type: 'message', data: {} },
        { type: 'session/title', data: { title: 'Title From Event' } }
      ]
    }
  };
  assert.equal(resolveSessionTitle(ctx, agentWithEvents), 'Title From Event');
});

test('resolveAgentsService: 多上下文多路径探针', () => {
  const agentsSvc = { list: () => [] };

  // 1. exec.agent.ctx.agents
  assert.equal(
    resolveAgentsService(null, { agent: { ctx: { agents: agentsSvc } } }),
    agentsSvc
  );

  // 2. ctx.root.get('agents')
  const ctxWithRoot = { root: { get: (k) => (k === 'agents' ? agentsSvc : null) } };
  assert.equal(resolveAgentsService(ctxWithRoot), agentsSvc);

  // 3. ctx.agents
  const ctxDirect = { agents: agentsSvc };
  assert.equal(resolveAgentsService(ctxDirect), agentsSvc);

  // 4. 未找到返回 null
  assert.equal(resolveAgentsService({}), null);
});

test('executeSessionQuery: 状态规范化 (running / idle)', () => {
  const aRunning = createMockAgent('sess-running', { status: 'running' });
  const aIdle = createMockAgent('sess-idle', { status: 'idle' });
  const aPaused = createMockAgent('sess-paused', { status: 'paused' });
  const aReady = createMockAgent('sess-ready', { status: 'ready' });
  const aUnknown = createMockAgent('sess-unknown', { status: 'custom_state' });

  const ctx = createMockCtx({
    agentsList: [aRunning, aIdle, aPaused, aReady, aUnknown]
  });

  const res = executeSessionQuery({ ctx, args: { cross_workspace: true } });
  assert.equal(res.success, true);
  assert.equal(res.count, 5);

  const statusMap = Object.fromEntries(res.sessions.map(s => [s.sessionId, s.status]));
  assert.equal(statusMap['sess-running'], 'running');
  assert.equal(statusMap['sess-idle'], 'idle');
  assert.equal(statusMap['sess-paused'], 'idle', '非 running 状态规范化为 idle');
  assert.equal(statusMap['sess-ready'], 'idle', '非 running 状态规范化为 idle');
  assert.equal(statusMap['sess-unknown'], 'idle', '非 running 状态规范化为 idle');
});

test('executeSessionQuery: 归档过滤与 running_only 过滤', () => {
  const a1 = createMockAgent('sess-1', { status: 'running' });
  const a2 = createMockAgent('sess-2', { status: 'idle' });
  const a3 = createMockAgent('sess-archived', { status: 'running' });

  const ctx = createMockCtx({
    agentsList: [a1, a2, a3],
    archivedIds: ['sess-archived']
  });

  // 1. 默认查询：自动过滤归档会话
  const resAll = executeSessionQuery({ ctx, args: { cross_workspace: true } });
  assert.equal(resAll.count, 2);
  assert.deepEqual(resAll.sessions.map(s => s.sessionId), ['sess-1', 'sess-2']);

  // 2. running_only: true 过滤
  const resRunning = executeSessionQuery({
    ctx,
    args: { running_only: true, cross_workspace: true }
  });
  assert.equal(resRunning.count, 1);
  assert.equal(resRunning.sessions[0].sessionId, 'sess-1');

  // 3. active_only 别名已被废除：传入 active_only 不生效，依然返回所有非归档会话 (ADR-0016)
  const resActiveIgnored = executeSessionQuery({
    ctx,
    args: { active_only: true, cross_workspace: true }
  });
  assert.equal(resActiveIgnored.count, 2, '废弃的 active_only 别名不生效');
});

test('executeSessionQuery: top_level_only 过滤子代理与空白会话', () => {
  const rootAgent = createMockAgent('root-sess');
  const subAgent = createMockAgent('child-subagent', { origin: 'subagent' });
  const blankAgent = createMockAgent('blank-sess', { blank: true });

  const ctx = createMockCtx({
    agentsList: [rootAgent, subAgent, blankAgent]
  });

  // 1. top_level_only: true (默认)
  const resTop = executeSessionQuery({ ctx, args: { cross_workspace: true } });
  assert.equal(resTop.count, 1);
  assert.equal(resTop.sessions[0].sessionId, 'root-sess');

  // 2. top_level_only: false (包含子代理)
  const resAll = executeSessionQuery({
    ctx,
    args: { top_level_only: false, cross_workspace: true }
  });
  assert.equal(resAll.count, 3);
});

test('executeSessionQuery: 工作区作用域隔离与跨工程查询', () => {
  const caller = createMockAgent('caller-sess', { cwd: 'c:/repos/repo-alpha' });
  const peerInAlpha = createMockAgent('peer-alpha', { cwd: 'C:\\repos\\repo-alpha' });
  const peerInBeta = createMockAgent('peer-beta', { cwd: 'c:/repos/repo-beta' });

  const ctx = createMockCtx({
    agentsList: [caller, peerInAlpha, peerInBeta]
  });
  const exec = { agent: caller };

  // 1. 默认隔离 (cross_workspace: false)：仅返回同一工程工作区中的会话
  const scopedRes = executeSessionQuery({ ctx, args: {}, exec });
  assert.equal(scopedRes.count, 2);
  assert.deepEqual(
    scopedRes.sessions.map(s => s.sessionId).sort(),
    ['caller-sess', 'peer-alpha']
  );
  assert.equal(scopedRes.scope, 'c:/repos/repo-alpha');

  // 2. 跨工程穿透 (cross_workspace: true)：返回所有工作区的会话
  const crossRes = executeSessionQuery({
    ctx,
    args: { cross_workspace: true },
    exec
  });
  assert.equal(crossRes.count, 3);
  assert.equal(crossRes.scope, 'global');
});

test('executeSessionQuery: 关键词模糊匹配 (query) 与数量限制 (limit)', () => {
  const a1 = createMockAgent('deploy-worker-primary', { title: 'Production Pipeline' });
  const a2 = createMockAgent('deploy-worker-secondary', { title: 'Staging Pipeline' });
  const a3 = createMockAgent('audit-agent', { title: 'Security Scanner' });

  const ctx = createMockCtx({
    agentsList: [a1, a2, a3]
  });

  // 1. 匹配 Session ID
  const resQueryId = executeSessionQuery({
    ctx,
    args: { query: 'deploy-worker', cross_workspace: true }
  });
  assert.equal(resQueryId.count, 2);

  // 2. 匹配 Title 关键词
  const resQueryTitle = executeSessionQuery({
    ctx,
    args: { query: 'Security', cross_workspace: true }
  });
  assert.equal(resQueryTitle.count, 1);
  assert.equal(resQueryTitle.sessions[0].sessionId, 'audit-agent');

  // 3. limit 截断
  const resLimit = executeSessionQuery({
    ctx,
    args: { limit: 1, cross_workspace: true }
  });
  assert.equal(resLimit.count, 1);
});

test('executeSessionQuery: 兼容位置参数签名 executeSessionQuery(ctx, args, exec)', () => {
  const a1 = createMockAgent('pos-agent-1');
  const ctx = createMockCtx({ agentsList: [a1] });

  const res = executeSessionQuery(ctx, { cross_workspace: true }, {});
  assert.equal(res.success, true);
  assert.equal(res.count, 1);
  assert.equal(res.sessions[0].sessionId, 'pos-agent-1');
});

test('executeSessionQuery: 严格契约对齐 ADR-0005 (totalCount, activeCount, idleCount, workspace, isCurrent)', () => {
  const caller = createMockAgent('caller-query-1', {
    status: 'running',
    title: 'Orchestrator Leader',
    cwd: 'd:/projects/app-root'
  });
  const peerIdle = createMockAgent('peer-idle-1', {
    status: 'idle',
    title: 'Idle Worker',
    cwd: 'd:/projects/app-root'
  });
  const peerRunning = createMockAgent('peer-run-2', {
    status: 'running',
    title: 'Active Task Runner',
    cwd: 'd:/projects/app-root'
  });

  const ctx = createMockCtx({
    agentsList: [caller, peerIdle, peerRunning]
  });
  const exec = { agent: caller };

  const res = executeSessionQuery({
    ctx,
    args: { cross_workspace: true },
    exec
  });

  // 1. 验证 ADR-0005 结构化统计字段
  assert.equal(res.totalCount, 3, 'totalCount 必须为总匹配会话数');
  assert.equal(res.activeCount, 2, 'activeCount 必须为 running 状态会话总数');
  assert.equal(res.idleCount, 1, 'idleCount 必须为 idle 状态会话总数');

  // 2. 验证会话字段：workspace、status、isCurrent
  const callerItem = res.sessions.find(s => s.sessionId === 'caller-query-1');
  assert.ok(callerItem);
  assert.equal(callerItem.isCurrent, true, '调用方会话必须被标记为 isCurrent=true');
  assert.equal(callerItem.status, 'running');
  assert.equal(callerItem.workspace, 'd:/projects/app-root');

  const peerItem = res.sessions.find(s => s.sessionId === 'peer-idle-1');
  assert.ok(peerItem);
  assert.equal(peerItem.isCurrent, false, '同级非当前会话必须被标记为 isCurrent=false');
  assert.equal(peerItem.status, 'idle');
  assert.equal(peerItem.workspace, 'd:/projects/app-root');
});

test('session_query Dual-Layer Render: 符合 ADR-0005 标准 Markdown 结构化汇总表格排版', async () => {
  const { apply } = await import('../index.mjs');
  const registeredTools = new Map();
  const mockCtx = {
    tools: {
      register(def) {
        registeredTools.set(def.name, def);
      }
    },
    commands: { register() {} },
    systemPrompt: { add() {}, context() {} },
    on() {},
    emit() {},
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    get: () => undefined
  };

  apply(mockCtx);
  const sessionQueryTool = registeredTools.get('session_query');
  assert.ok(sessionQueryTool, 'session_query 工具必须成功注册');
  assert.ok(sessionQueryTool.output?.render, 'session_query 必须声明 output.render 呈现层');

  // 1. 测试存在会话时的表格排版
  const mockResult = {
    success: true,
    count: 2,
    totalCount: 2,
    activeCount: 1,
    idleCount: 1,
    scope: 'd:/repo',
    sessions: [
      {
        sessionId: 'session-alpha',
        title: 'Alpha Worker',
        status: 'running',
        workspace: 'd:/repo',
        isCurrent: true
      },
      {
        sessionId: 'session-beta',
        title: 'Beta Helper',
        status: 'idle',
        workspace: 'd:/repo',
        isCurrent: false
      }
    ]
  };

  const rendered = sessionQueryTool.output.render({}, mockResult);
  assert.ok(Array.isArray(rendered) && rendered.length > 0);
  const text = rendered[0].text;

  // 严禁裸倾倒 JSON
  assert.equal(text.startsWith('{'), false, 'render 严禁倾倒裸 JSON 串');
  assert.ok(text.includes('### Session Query Overview') || text.includes('### 会话概览'), '必须包含概览标题');
  assert.ok(text.includes('Session ID') || text.includes('会话 ID'), '必须包含标准 Markdown 表头');
  assert.ok(text.includes('session-alpha') && (text.includes('Yes') || text.includes('是')), '必须渲染包含当前标记的数据行');
  assert.ok(text.includes('session-beta') && (text.includes('No') || text.includes('否')), '必须渲染包含非当前标记的数据行');
  assert.ok(text.includes('2') && text.includes('1'), '必须包含统计概览行');

  // 2. 测试空列表时的友好提示
  const emptyRendered = sessionQueryTool.output.render({}, {
    success: true,
    count: 0,
    totalCount: 0,
    activeCount: 0,
    idleCount: 0,
    scope: 'd:/repo',
    sessions: []
  });
  assert.ok(emptyRendered[0].text.includes('No active sessions found.') || emptyRendered[0].text.includes('未找到匹配的会话'));
  assert.ok(emptyRendered[0].text.includes('0'));
});

test('session-query.mjs Facade: 纯重导出与 session-directory.mjs 引用一致性', async () => {
  const dirModule = await import('../lib/session-directory.mjs');
  const queryModule = await import('../lib/session-query.mjs');

  assert.equal(queryModule.SessionDirectory, dirModule.SessionDirectory);
  assert.equal(queryModule.getArchivedSessionIds, dirModule.getArchivedSessionIds);
  assert.equal(queryModule.resolveSessionCwd, dirModule.resolveSessionCwd);
  assert.equal(queryModule.resolveSessionTitle, dirModule.resolveSessionTitle);
  assert.equal(queryModule.resolveAgentsService, dirModule.resolveAgentsService);
  assert.equal(queryModule.executeSessionQuery, dirModule.executeSessionQuery);
});
