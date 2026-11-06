/**
 * Canonical Mock Host and Context Test Fixtures
 * 
 * Provides unified, decoupled test doubles for Cordis Context
 * and AgentsService.
 */

import { createMockAgent } from './mock-agent.mjs';

/**
 * Creates a mock AgentsService double.
 */
function createMockAgentsService(agentList = []) {
  const list = [...agentList];
  return {
    list: () => list,
    create: async (payload) => {
      const target = createMockAgent(payload.sessionId, {
        title: payload.title,
        cwd: payload.cwd,
        generation: payload.meta?.generation ?? 1,
        options: payload.agentOptions,
        mutateStatusOnDispatch: true
      });
      list.push(target);
      return target;
    }
  };
}

/**
 * Creates a mock Cordis environment with AgentsService and Root Context.
 */
export function createMockEnvironment(agentList = []) {
  const agentsService = createMockAgentsService(agentList);
  const mockCtx = {
    root: {
      agents: agentsService
    },
    agents: agentsService,
    get: (key) => (key === 'agents' ? agentsService : undefined)
  };

  return { ctx: mockCtx, agentsService, list: agentsService.list() };
}
/**
 * Workspace roster and session snapshot doubles for the @ peer-session tests.
 *
 * The host hands the plugin two snapshots whose shape decides what the picker can
 * see: sessions.list.getSnapshot() returns byId together with ids, and
 * workspaces.list.getSnapshot() returns items carrying workspaceId, path, title
 * and sessionIds alongside archivedSessionIds. Modelling both here keeps every
 * roster scenario constructible without a test inventing its own double.
 */

/**
 * Builds a workspace roster item in the shape workspaces.list.getSnapshot() emits.
 */
export function workspaceItem({ workspaceId, path: wsPath, title, sessionIds }) {
  return {
    workspaceId,
    path: wsPath,
    title: title === undefined ? String(wsPath).split(/[\\/]/).filter(Boolean).pop() || String(wsPath) : title,
    sessionIds: sessionIds ? sessionIds.slice() : []
  };
}

/**
 * Builds a sessions.list snapshot. Omit ids to have the snapshot derive them from
 * byId, which is what the host does; pass ids to declare a snapshot whose index
 * names sessions the byId map cannot resolve.
 */
export function sessionsSnapshot(byId, ids) {
  return {
    byId: byId || {},
    ids: Array.isArray(ids) ? ids.slice() : Object.keys(byId || {})
  };
}

/**
 * Builds a workspaces.list snapshot. Omitting items leaves the roster field absent,
 * which is the snapshot shape that must degrade to an empty roster.
 */
export function workspacesSnapshot({ items, archivedSessionIds } = {}) {
  const snapshot = {};
  if (items !== undefined) snapshot.items = items.slice();
  if (archivedSessionIds !== undefined) snapshot.archivedSessionIds = archivedSessionIds.slice();
  return snapshot;
}

/**
 * Snapshot readers whose read counts are observable, so a test can pin that one
 * candidate computation reads either snapshot exactly once.
 */
export function createCountingSnapshot(snapshot) {
  let reads = 0;
  return {
    getSnapshot: () => {
      reads += 1;
      return snapshot;
    },
    reads: () => reads
  };
}

/**
 * The seven fixture scenarios the specification requires every later ticket to be
 * able to construct. Roster order is deliberately not path-alphabetical so that an
 * ordering assertion cannot pass by accident.
 */
export function rosterScenarios() {
  const currentPath = '/repos/TSPR/dsh-call-session';
  const reachablePath = '/repos/infra/dsh-agent-cluster';
  const crossCwdPath = '/repos/infra/dsh-gateway';
  const spacedPath = '/repos/projects/project with spaces';
  const retiredPath = '/repos/legacy/dsh-retired';

  const currentRosterIds = [
    'session-curr',
    'session-live',
    'session-blank',
    'session-snapshot-archived',
    'session-roster-archived'
  ];

  // 名册项：只有当前工作区能在 byId 里解出会话，恰好覆盖七个必备场景
  const items = [
    workspaceItem({
      workspaceId: 'ws-current',
      path: currentPath,
      title: 'dsh-call-session',
      sessionIds: currentRosterIds
    }),
    // 下钻工作区：sessionIds 全部不可解析，二级必然为空
    // 标题刻意不同于路径末段：一级候选只认名册 title 时这条才能把"改回按路径取名"的变异测红
    workspaceItem({
      workspaceId: 'ws-unreachable',
      path: reachablePath,
      title: '集群工作区',
      sessionIds: ['session-unresolvable-1', 'session-unresolvable-2']
    }),
    // cwd 指向 reachablePath，名册把它放在这里
    workspaceItem({
      workspaceId: 'ws-cross-cwd',
      path: crossCwdPath,
      title: 'dsh-gateway',
      sessionIds: ['session-cross-cwd']
    }),
    // sessionIds 成员快照缺 cwd
    workspaceItem({
      workspaceId: 'ws-spaced',
      path: spacedPath,
      title: 'project with spaces',
      sessionIds: ['session-no-cwd']
    }),
    // 名册里有、本窗口会话存储完全触达不到的工作区
    workspaceItem({
      workspaceId: 'ws-retired',
      path: retiredPath,
      title: 'dsh-retired',
      sessionIds: ['session-retired-1']
    })
  ];

  // 会话快照：名册成员的 cwd 一律照旧照写，归属只由 sessionIds 决定
  const sessions = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: currentPath, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '可见成员', cwd: currentPath, status: 'idle', updatedAt: 2000 },
    // 空白会话且不是当前会话
    'session-blank': { id: 'session-blank', title: '空白会话', cwd: currentPath, blank: true, status: 'idle', updatedAt: 4000 },
    // 快照字段声明归档
    'session-snapshot-archived': { id: 'session-snapshot-archived', title: '快照归档会话', cwd: currentPath, archived: true, status: 'archived', updatedAt: 3500 },
    // 名册 id 声明归档，快照没有任何标记
    'session-roster-archived': { id: 'session-roster-archived', title: '名册归档会话', cwd: currentPath, status: 'idle', updatedAt: 3000 },
    // cwd 指向 reachablePath，名册归属 crossCwdPath
    'session-cross-cwd': { id: 'session-cross-cwd', title: '跨根目录成员', cwd: reachablePath, status: 'idle', updatedAt: 6000 },
    // 名册成员但快照缺 cwd
    'session-no-cwd': { id: 'session-no-cwd', title: '无根目录成员', status: 'idle', updatedAt: 7000 },
    // 不在任何名册项里
    'session-unrostered': { id: 'session-unrostered', title: '名册外会话', cwd: currentPath, status: 'idle', updatedAt: 5000 }
  };

  return {
    workspaces: items.map((item) => item.path),
    currentWs: currentPath,
    unreachableWs: reachablePath,
    crossCwdWs: crossCwdPath,
    spacedWs: spacedPath,
    retiredWs: retiredPath,
    items,
    sessions,
    archivedSessionIds: ['session-roster-archived'],
    currentRosterIds
  };
}
