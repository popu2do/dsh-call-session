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

test('executeSessionQuery: 严格两态规约 (running / idle)', () => {
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
  assert.equal(statusMap['sess-paused'], 'idle', '非 running 状态必须规范化为 idle');
  assert.equal(statusMap['sess-ready'], 'idle', '非 running 状态必须规范化为 idle');
  assert.equal(statusMap['sess-unknown'], 'idle', '非 running 状态必须规范化为 idle');
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

test('executeSessionQuery: 工作区作用域隔离与跨工程穿透', () => {
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
