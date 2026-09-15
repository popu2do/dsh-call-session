/**
 * DSH Session Query Service
 *
 * Provides session queries, workspace filtering, and title/cwd resolution.
 */
import { normalizeWorkspace } from './board-store.mjs';

/**
 * 获取已被归档或废弃的 Session ID 集合
 *
 * @param {any} ctx Cordis 上下文
 * @returns {Set<string>}
 */
export function getArchivedSessionIds(ctx) {
  const registry = (typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined)
    || ctx?.workspaceRegistry
    || ctx?.root?.workspaceRegistry;
  const raw = registry?.archivedSessionIds || ctx?.archivedSessionIds || ctx?.archivedSessions;
  if (!raw) return new Set();
  const set = new Set();
  const iter = Array.isArray(raw) || raw instanceof Set || typeof raw[Symbol.iterator] === 'function'
    ? raw
    : (typeof raw.list === 'function' ? raw.list() : []);
  for (const id of iter) {
    if (typeof id === 'string') {
      set.add(id);
      set.add(id.toLowerCase());
    }
  }
  return set;
}

/**
 * 解析 Agent 实例所在工程的工作目录 (cwd)
 *
 * @param {any} agent Agent 实例
 * @returns {string} 绝对路径或空字符串
 */
export function resolveSessionCwd(agent) {
  return agent?.session?.header?.cwd || agent?.session?.cwd || '';
}

/**
 * 解析 Agent 实例的人类可读标题 (title)
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} agent Agent 实例
 * @returns {string}
 */
export function resolveSessionTitle(ctx, agent) {
  if (typeof agent?.session?.title === 'string' && agent.session.title) {
    return agent.session.title;
  }
  if (typeof agent?.title === 'string' && agent.title) {
    return agent.title;
  }
  if (typeof agent?.session?.header?.title === 'string' && agent.session.header.title) {
    return agent.session.header.title;
  }

  // 尝试从 sessionProjections 读取已折叠标题
  const projections = typeof ctx?.get === 'function' ? ctx.get('sessionProjections') : undefined;
  if (projections && typeof projections.stateOf === 'function' && agent?.session) {
    try {
      const projTitle = projections.stateOf(agent.session, 'title');
      if (typeof projTitle === 'string' && projTitle) {
        return projTitle;
      }
    } catch {}
  }

  const titleService = typeof ctx?.get === 'function' ? ctx.get('sessionTitle') : undefined;
  if (titleService && typeof titleService.get === 'function' && agent?.session) {
    try {
      const res = titleService.get(agent.session);
      if (typeof res?.title === 'string' && res.title) {
        return res.title;
      }
    } catch {}
  }

  // 尝试从事件日志倒序提取 session/title
  let events = [];
  if (typeof agent?.session?.snapshotEvents === 'function') {
    try {
      events = agent.session.snapshotEvents();
    } catch {}
  } else if (Array.isArray(agent?.session?.events)) {
    events = agent.session.events;
  }

  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev?.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title) {
        return ev.data.title;
      }
    }
  }

  return '';
}

/**
 * 解析 agents 服务实例
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} [exec] 工具执行上下文
 * @returns {any}
 */
export function resolveAgentsService(ctx, exec) {
  if (exec?.agent?.ctx?.agents) return exec.agent.ctx.agents;
  if (typeof exec?.agent?.ctx?.get === 'function') {
    const s = exec.agent.ctx.get('agents', false);
    if (s) return s;
  }
  if (ctx?.root) {
    if (typeof ctx.root.get === 'function') {
      const s = ctx.root.get('agents', false);
      if (s) return s;
    }
    try {
      if (ctx.root.agents) return ctx.root.agents;
    } catch (e) {}
  }
  if (typeof ctx?.get === 'function') {
    const s = ctx.get('agents', false);
    if (s) return s;
  }
  try {
    return ctx?.agents || null;
  } catch (e) {
    return null;
  }
}

/**
 * 执行会话查询、工作区过滤与状态规范化
 *
 * @param {any} ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param {import('../types/session-query.js').SessionQueryArgs} [rawArgs] session_query 入参
 * @param {any} [rawExec] 工具执行上下文
 * @returns {import('../types/session-query.js').SessionQueryResult}
 */
export function executeSessionQuery(ctxOrOptions, rawArgs = {}, rawExec = {}) {
  let ctx, args, exec;
  if (ctxOrOptions && Object.prototype.hasOwnProperty.call(ctxOrOptions, 'ctx')) {
    ctx = ctxOrOptions.ctx;
    args = ctxOrOptions.args || {};
    exec = ctxOrOptions.exec || {};
  } else {
    ctx = ctxOrOptions;
    args = rawArgs || {};
    exec = rawExec || {};
  }

  const queryStr = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
  const topLevelOnly = args?.top_level_only !== false;
  const runningOnly = args?.running_only === true || args?.active_only === 'running' || args?.active_only === true;
  const crossWorkspace = args?.cross_workspace === true;
  const limit = typeof args?.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 50;

  const agents = resolveAgentsService(ctx, exec);
  const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
  const archivedIds = getArchivedSessionIds(ctx);

  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || exec?.sessionId || null;
  const callerWorkspace = callerAgent
    ? (normalizeWorkspace(resolveSessionCwd(callerAgent)) || normalizeWorkspace(process.cwd()))
    : normalizeWorkspace(process.cwd());

  const results = [];

  for (const agent of liveAgents) {
    if (!agent || !agent.id) continue;
    const sessionId = agent.id;
    if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) continue;
    if (topLevelOnly && (agent.origin === 'subagent' || agent.session?.header?.origin === 'subagent' || agent.blank)) continue;

    const rawStatus = agent.status;
    const status = rawStatus === 'running' ? 'running' : 'idle';

    if (runningOnly && status !== 'running') {
      continue;
    }

    const title = resolveSessionTitle(ctx, agent);
    const cwd = resolveSessionCwd(agent);
    const agentWorkspace = normalizeWorkspace(cwd);

    if (!crossWorkspace && callerWorkspace && agentWorkspace && agentWorkspace !== callerWorkspace) {
      continue;
    }

    if (queryStr) {
      const lowerId = sessionId.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const matchId = lowerId.startsWith(queryStr) || lowerId.includes(queryStr);
      const matchTitle = lowerTitle.includes(queryStr);
      if (!matchId && !matchTitle) {
        continue;
      }
    }

    const isCurrent = Boolean(callerSessionId && (sessionId === callerSessionId || sessionId.toLowerCase() === String(callerSessionId).toLowerCase()));
    const normWs = String(agentWorkspace || normalizeWorkspace(cwd) || '');

    results.push({
      sessionId: String(sessionId || ''),
      title: String(title || ''),
      status: status === 'running' ? 'running' : 'idle',
      workspace: normWs,
      cwd: normWs,
      isCurrent
    });

    if (results.length >= limit) {
      break;
    }
  }

  const activeCount = results.filter(s => s.status === 'running').length;
  const idleCount = results.filter(s => s.status === 'idle').length;

  return {
    success: true,
    count: results.length,
    totalCount: results.length,
    activeCount,
    idleCount,
    scope: crossWorkspace ? 'global' : (callerWorkspace || 'unknown'),
    sessions: results
  };
}
