/**
 * DSH Session Query Service
 *
 * Provides session queries, workspace filtering, and title/cwd resolution.
 * Delegates discovery, identity resolution, and filtering to SessionDirectory.
 */
import { normalizeWorkspace } from './board-store.mjs';
import {
  SessionDirectory,
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService
} from './session-directory.mjs';

export {
  SessionDirectory,
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService
};

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
  const runningOnly = args?.running_only === true;
  const crossWorkspace = args?.cross_workspace === true;
  const limit = typeof args?.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 50;

  const directory = new SessionDirectory(ctx);
  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || exec?.sessionId || null;
  const callerWorkspace = callerAgent
    ? (directory.resolveWorkspace(callerAgent) || normalizeWorkspace(process.cwd()))
    : normalizeWorkspace(process.cwd());

  const results = directory.listActiveSessions({
    workspace: callerWorkspace,
    crossWorkspace,
    topLevelOnly,
    runningOnly,
    query: queryStr,
    limit,
    callerSessionId,
    exec
  });

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
