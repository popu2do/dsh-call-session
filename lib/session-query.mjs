/**
 * DSH Session Query Service (Native Refactor Edition)
 *
 * Provides official two-state session queries, workspace isolation, and title/cwd resolution.
 * Zero HTTP dependencies.
 */
import { normalizeWorkspace } from './board-store.mjs';

/**
 * 获取已被归档或废弃的 Session ID 集合
 *
 * @param {any} ctx Cordis 上下文
 * @returns {Set<string>}
 */
export function getArchivedSessionIds(ctx) {
  const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
  if (!registry) return new Set();
  const raw = registry.archivedSessionIds;
  const set = new Set();
  if (raw && (Array.isArray(raw) || raw instanceof Set || typeof raw[Symbol.iterator] === 'function')) {
    for (const id of raw) {
      if (typeof id === 'string') {
        set.add(id);
        set.add(id.toLowerCase());
      }
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
  const titleService = typeof ctx?.get === 'function' ? ctx.get('sessionTitle') : undefined;
  if (titleService && typeof titleService.get === 'function' && agent?.session) {
    const res = titleService.get(agent.session);
    if (typeof res?.title === 'string' && res.title) {
      return res.title;
    }
  }
  if (Array.isArray(agent?.session?.events)) {
    for (let i = agent.session.events.length - 1; i >= 0; i--) {
      const ev = agent.session.events[i];
      if (ev?.type === 'session/title' && typeof ev.data?.title === 'string' && ev.data.title) {
        return ev.data.title;
      }
    }
  }
  return '';
}

/**
 * 健壮探测并解析 DSH 宿主 agents 原生调度服务
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
 * 执行原生会话查询、作用域过滤与两态规约
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
  const callerWorkspace = callerAgent ? normalizeWorkspace(resolveSessionCwd(callerAgent)) : '';

  const results = [];

  for (const agent of liveAgents) {
    if (!agent || !agent.id) continue;
    const sessionId = agent.id;
    if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) continue;
    if (topLevelOnly && (agent.origin === 'subagent' || agent.blank)) continue;

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

    results.push({
      sessionId: String(sessionId || ''),
      title: String(title || ''),
      status: status === 'running' ? 'running' : 'idle',
      cwd: String(cwd || '')
    });

    if (results.length >= limit) {
      break;
    }
  }

  return {
    success: true,
    count: results.length,
    scope: crossWorkspace ? 'global' : (callerWorkspace || 'unknown'),
    sessions: results
  };
}
