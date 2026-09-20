import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionDirectory } from '../lib/session-directory.mjs';

function createMockCordis(liveAgents = [], archivedIds = []) {
  const archivedSet = new Set(archivedIds);
  return {
    agents: {
      list: () => liveAgents,
      get: (id) => liveAgents.find(a => a.id === id) || null,
      resume: async ({ resumeSessionId }) => {
        const found = liveAgents.find(a => a.id === resumeSessionId);
        return found ? { agent: found } : null;
      }
    },
    workspaceRegistry: {
      archivedSessionIds: archivedSet
    },
    get(name) {
      if (name === 'agents') return this.agents;
      if (name === 'workspaceRegistry') return this.workspaceRegistry;
      return null;
    }
  };
}

function createMockAgent({
  id,
  title = '',
  cwd = 'c:/workspace/proj-a',
  status = 'idle',
  origin = 'user',
  blank = false,
  events = []
}) {
  return {
    id,
    title,
    status,
    origin,
    blank,
    session: {
      id,
      title,
      cwd,
      header: { cwd, title, origin },
      events
    }
  };
}

test('SessionDirectory: resolveCwd and resolveWorkspace', () => {
  const dir = new SessionDirectory({});
  const agent1 = createMockAgent({ id: 's-1', cwd: 'C:\\Projects\\Repo' });
  assert.equal(dir.resolveCwd(agent1), 'C:\\Projects\\Repo');
  assert.equal(dir.resolveWorkspace(agent1), 'c:/Projects/Repo');

  const agentEmpty = { id: 's-empty' };
  assert.equal(dir.resolveCwd(agentEmpty), '');
  assert.equal(dir.resolveWorkspace(agentEmpty), '');
});

test('SessionDirectory: resolveShortId', () => {
  const dir = new SessionDirectory({});
  assert.equal(dir.resolveShortId('session-a1b2c3d4-e5f6'), 'a1b2c3d4');
  assert.equal(dir.resolveShortId('1234567890'), '12345678');
  assert.equal(dir.resolveShortId(''), 'unknown');
  assert.equal(dir.resolveShortId(null), 'unknown');
});

test('SessionDirectory: resolveTitle with fallbacks', () => {
  const dir = new SessionDirectory({});
  
  // 显式标题直接提取
  const a1 = createMockAgent({ id: 's-1', title: 'Main Agent' });
  assert.equal(dir.resolveTitle(a1), 'Main Agent');

  // 事件日志标题回退
  const a2 = {
    id: 's-2',
    session: {
      id: 's-2',
      events: [
        { type: 'session/other' },
        { type: 'session/title', data: { title: 'Event-Sourced Title' } }
      ]
    }
  };
  assert.equal(dir.resolveTitle(a2), 'Event-Sourced Title');

  // 规范化兜底展示标题
  const a3 = { id: 'session-fedcba98' };
  assert.equal(dir.resolveDisplayTitle(a3), 'Agent fedcba98');
});

test('SessionDirectory: resolveIdentity returns complete metadata', () => {
  const dir = new SessionDirectory({});
  const agent = createMockAgent({
    id: 'session-42',
    title: 'Worker',
    cwd: '/home/user/repo',
    status: 'running',
    origin: 'subagent'
  });

  const idInfo = dir.resolveIdentity(agent);
  assert.equal(idInfo.sessionId, 'session-42');
  assert.equal(idInfo.title, 'Worker');
  assert.equal(idInfo.displayTitle, 'Worker');
  assert.equal(idInfo.shortId, '42');
  assert.equal(idInfo.cwd, '/home/user/repo');
  assert.equal(idInfo.workspace, '/home/user/repo');
  assert.equal(idInfo.status, 'running');
  assert.equal(idInfo.isSubagent, true);
});

test('SessionDirectory: listActiveSessions with workspace and status filters', () => {
  const a1 = createMockAgent({ id: 's-1', title: 'A1', cwd: '/app/repo1', status: 'running' });
  const a2 = createMockAgent({ id: 's-2', title: 'A2', cwd: '/app/repo1', status: 'idle' });
  const a3 = createMockAgent({ id: 's-3', title: 'A3', cwd: '/app/repo2', status: 'running' });
  const aSub = createMockAgent({ id: 's-sub', title: 'Sub', cwd: '/app/repo1', origin: 'subagent' });
  const aArchived = createMockAgent({ id: 's-old', title: 'Old', cwd: '/app/repo1' });

  const ctx = createMockCordis([a1, a2, a3, aSub, aArchived], ['s-old']);
  const dir = new SessionDirectory(ctx);

  // 工作区隔离过滤（排除异地工作区、子代理与归档项）
  const list1 = dir.listActiveSessions({ workspace: '/app/repo1' });
  assert.equal(list1.length, 2);
  assert.deepEqual(list1.map(s => s.sessionId), ['s-1', 's-2']);

  // 仅活跃状态过滤
  const listRunning = dir.listActiveSessions({ workspace: '/app/repo1', runningOnly: true });
  assert.equal(listRunning.length, 1);
  assert.equal(listRunning[0].sessionId, 's-1');

  // 跨工作区透视查询
  const listAll = dir.listActiveSessions({ crossWorkspace: true });
  assert.equal(listAll.length, 3);
  assert.deepEqual(listAll.map(s => s.sessionId), ['s-1', 's-2', 's-3']);
});

test('SessionDirectory: inspectWorkspace for quota and active title tracking (running quota vs unarchived titles)', () => {
  // a1 is running, a2 is idle; both in /app/repo
  const a1 = createMockAgent({ id: 's-1', title: 'Planning Agent', cwd: '/app/repo', status: 'running' });
  const a2 = createMockAgent({ id: 's-2', title: 'Execution Agent', cwd: '/app/repo', status: 'idle' });
  const aOther = createMockAgent({ id: 's-3', title: 'Other', cwd: '/other/repo', status: 'running' });

  const ctx = createMockCordis([a1, a2, aOther]);
  const dir = new SessionDirectory(ctx);

  const res = dir.inspectWorkspace('/app/repo');
  // Concurrency quota count strictly reflects running sessions (1)
  assert.equal(res.count, 1);
  // Title deduplication tracks all unarchived workspace sessions (both running and idle)
  assert.ok(res.activeTitles.has('planning agent'));
  assert.ok(res.activeTitles.has('execution agent'));
  assert.equal(res.activeTitles.has('other'), false);
});

test('SessionDirectory: resolveTarget with exact match, prefix match, and guards', async () => {
  const a1 = createMockAgent({ id: 'session-12345678-aaaa', title: 'Alpha', cwd: '/repo' });
  const a2 = createMockAgent({ id: 'session-12345678-bbbb', title: 'Beta', cwd: '/repo' });
  const a3 = createMockAgent({ id: 'session-99999999-cccc', title: 'Gamma', cwd: '/repo' });

  const ctx = createMockCordis([a1, a2, a3]);
  const dir = new SessionDirectory(ctx);

  // 通配符拦截保护
  await assert.rejects(
    () => dir.resolveTarget('*'),
    /\[WildcardForbidden\]/
  );

  // 自呼叫拦截保护
  await assert.rejects(
    () => dir.resolveTarget('session-12345678-aaaa', { callerSessionId: 'session-12345678-aaaa' }),
    /\[SelfCallForbidden\]/
  );

  // 自呼叫前缀拦截忽略同前缀已归档项
  const ctxWithArchived = createMockCordis(
    [a1, createMockAgent({ id: 'session-12345678-archived', title: 'Archived Same Prefix' })],
    ['session-12345678-archived']
  );
  const dirArchived = new SessionDirectory(ctxWithArchived);
  await assert.rejects(
    () => dirArchived.resolveTarget('session-12345678', { callerSessionId: 'session-12345678-aaaa' }),
    /\[SelfCallForbidden\]/
  );

  // 精确匹配
  const exact = await dir.resolveTarget('session-99999999-cccc', { callerSessionId: 'caller-1' });
  assert.equal(exact.targetAgent.id, 'session-99999999-cccc');
  assert.equal(exact.targetTitle, 'Gamma');

  // 歧义多重前缀拦截
  await assert.rejects(
    () => dir.resolveTarget('session-12345678', { callerSessionId: 'caller-1' }),
    /\[AmbiguousPrefix\]/
  );

  // 唯一前缀（>= 8 位）安全命中
  const prefix = await dir.resolveTarget('session-99999999', { callerSessionId: 'caller-1' });
  assert.equal(prefix.targetAgent.id, 'session-99999999-cccc');

  // 短前缀（< 8 位）防御拦截
  await assert.rejects(
    () => dir.resolveTarget('session', { callerSessionId: 'caller-1' }),
    /\[InvalidParameter\]/
  );

  // 未找到目标会话
  await assert.rejects(
    () => dir.resolveTarget('session-00000000', { callerSessionId: 'caller-1' }),
    /\[TargetNotFound\]/
  );
});