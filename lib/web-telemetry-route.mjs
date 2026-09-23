/**
 * Read-only canvas telemetry Web surface & snapshot aggregator.
 *
 * Raw WebServer routes do not inherit the Connection authentication fence, so
 * every request passes through `connection.requestRejection` before any
 * workspace state is serialized. The route is GET-only by design: the canvas is
 * an observability mirror (ADR-0012 Invariant 1) and must never expose a write
 * or dispatch channel.
 */

import path from 'node:path';
import { normalizeWorkspace } from './board-store.mjs';
import {
  SessionDirectory,
  isHumanReadableTitle,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
} from './session-directory.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';

/** Service keys probed for the host Web server across DSH assemblies. */
export const WEB_SERVER_KEYS = Object.freeze(['webServer', 'httpServer']);

/** Canonical host route path, aligned with the DSH plugin route namespace. */
export const TELEMETRY_ROUTE_PATH = '/plugins/dsh-call-session/telemetry';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
});

/**
 * 聚合看板快照，纯只读、零被动唤醒与零磁盘 I/O
 *
 * @param {any} ctx Cordis 根上下文
 * @param {import('../types/call-telemetry.js').GetCanvasTelemetryOptions} [options] 过滤与查询选项
 * @returns {Promise<import('../types/call-telemetry.js').CanvasTelemetrySnapshot>}
 */
export async function getCanvasTelemetry(ctx, options = {}) {
  // ADR-0013: 看板数据面向人类观察者全局透视，无条件聚合全量多工作区与全部会话
  const crossWorkspace = true;
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 50;

  const directory = new SessionDirectory(ctx);
  let currentWorkspace = '';
  if (options.workspace) {
    currentWorkspace = normalizeWorkspace(options.workspace);
  } else if (options.sessionId) {
    const agents = directory.getAgentsService();
    const agent = agents?.get?.(options.sessionId) || (typeof agents?.list === 'function' ? agents.list().find(a => a?.id === options.sessionId) : null);
    if (agent) {
      currentWorkspace = directory.resolveWorkspace(agent);
    }
  }
  if (!currentWorkspace) {
    currentWorkspace = normalizeWorkspace(process.cwd());
  }

  const boardStore = ctx?.boardStore || options.boardStore || (typeof ctx?.get === 'function' ? ctx.get('boardStore') : null);
  const canvasPosts = [];
  const now = Date.now();

  if (boardStore && typeof boardStore.list === 'function') {
    const listRes = boardStore.list({
      callerWorkspace: currentWorkspace,
      crossWorkspace: true,
      status: 'all',
      titlesOnly: false,
      limit: 100
    });
    const rawPosts = Array.isArray(listRes) ? listRes : (listRes.posts || []);
    for (const post of rawPosts) {
      if (!post || !post.id) continue;
      const createdAtMs = post.createdAtMs || (post.createdAt ? new Date(post.createdAt).getTime() : now);
      const expiresAtMs = post.expiresAtMs || (post.expiresAt ? new Date(post.expiresAt).getTime() : now + 3600000);

      let status = 'active';
      if (post.status === 'archived' || post.status === 'dismissed') {
        status = 'archived';
      } else if (post.status === 'expired' || (expiresAtMs && now >= expiresAtMs)) {
        status = 'expired';
      } else if (post.status === 'active') {
        status = (expiresAtMs && now >= expiresAtMs) ? 'expired' : 'active';
      } else {
        status = (expiresAtMs && now >= expiresAtMs) ? 'expired' : 'active';
      }

      const ttlRemainingMs = status === 'active' ? Math.max(0, expiresAtMs - now) : 0;
      const isDismissed = status !== 'active';

      canvasPosts.push({
        id: String(post.id),
        topic: String(post.topic || ''),
        tags: Array.isArray(post.tags) ? post.tags : [],
        authorSessionId: String(post.authorSessionId || ''),
        authorTitle: typeof post.authorTitle === 'string' ? post.authorTitle : '',
        workspace: normalizeWorkspace(post.authorWorkspace || post.scope || ''),
        createdAt: createdAtMs,
        expiresAt: expiresAtMs,
        ttlRemainingMs,
        content: typeof post.content === 'string' ? post.content : '',
        metadata: post.metadata || {},
        status,
        isDismissed
      });
    }
  }

  const ringBuffer = getCallTelemetry(ctx, options);
  const rawCalls = ringBuffer.query({
    workspace: currentWorkspace,
    crossWorkspace,
    limit
  });

  // 只读探针获取活跃 agent，不调用任何 mutative 操作
  const agents = directory.getAgentsService();
  const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
  const archivedIds = directory.getArchivedSessionIds();

  const canvasSessions = [];
  const processedSessionIds = new Set();

  for (const agent of liveAgents) {
    if (!agent || !agent.id) continue;
    const sessionId = String(agent.id);
    const sidLower = sessionId.toLowerCase();
    if (archivedIds.has(sessionId) || archivedIds.has(sidLower)) {
      continue;
    }

    processedSessionIds.add(sidLower);
    const idInfo = directory.resolveIdentity(agent);
    const cwd = idInfo.cwd;
    const ws = idInfo.workspace;
    const shortId = idInfo.shortId;
    const title = idInfo.displayTitle;
    const state = idInfo.status;
    const isTopLevel = !idInfo.isSubagent && !idInfo.blank;
    const agentType = agent.agentType || agent.role || agent.origin || 'agent';

    canvasSessions.push({
      id: sessionId,
      shortId,
      title: String(title),
      workspace: ws || currentWorkspace,
      state,
      isTopLevel,
      agentType,
      createdAt: agent.session?.createdAt || agent.createdAt,
      lastActiveAt: agent.session?.lastActiveAt || agent.lastActiveAt,
      stats: {
        outboundCalls: 0,
        inboundCalls: 0,
        postsCount: 0
      }
    });
  }

  // 补齐参与了跨会话调用但未在当前 liveAgents 中的外部协作端点（保证拓扑连线不出现孤立空指针）
  for (const call of rawCalls) {
    const callerLower = String(call.callerSessionId).toLowerCase();
    if (!processedSessionIds.has(callerLower) && !archivedIds.has(callerLower)) {
      processedSessionIds.add(callerLower);
      const shortId = computeSessionShortId(call.callerSessionId);
      const title = call.callerTitle && isHumanReadableTitle(call.callerTitle)
        ? call.callerTitle
        : `Agent ${shortId}`;
      canvasSessions.push({
        id: call.callerSessionId,
        shortId,
        title,
        workspace: call.callerWorkspace || currentWorkspace,
        state: 'idle',
        isTopLevel: true,
        agentType: 'agent',
        stats: { outboundCalls: 0, inboundCalls: 0, postsCount: 0 }
      });
    }

    const targetLower = String(call.targetSessionId).toLowerCase();
    if (!processedSessionIds.has(targetLower) && !archivedIds.has(targetLower)) {
      processedSessionIds.add(targetLower);
      const shortId = computeSessionShortId(call.targetSessionId);
      const title = call.targetTitle && isHumanReadableTitle(call.targetTitle)
        ? call.targetTitle
        : `Agent ${shortId}`;
      canvasSessions.push({
        id: call.targetSessionId,
        shortId,
        title,
        workspace: call.targetWorkspace || currentWorkspace,
        state: 'idle',
        isTopLevel: true,
        agentType: 'agent',
        stats: { outboundCalls: 0, inboundCalls: 0, postsCount: 0 }
      });
    }
  }

  for (const post of canvasPosts) {
    if (!post.authorSessionId) continue;
    const authorLower = String(post.authorSessionId).toLowerCase();
    if (!processedSessionIds.has(authorLower) && !archivedIds.has(authorLower)) {
      processedSessionIds.add(authorLower);
      const shortId = computeSessionShortId(post.authorSessionId);
      const title = post.authorTitle && isHumanReadableTitle(post.authorTitle)
        ? post.authorTitle
        : `Agent ${shortId}`;
      canvasSessions.push({
        id: post.authorSessionId,
        shortId,
        title,
        workspace: post.workspace || currentWorkspace,
        state: 'idle',
        isTopLevel: true,
        agentType: 'agent',
        stats: { outboundCalls: 0, inboundCalls: 0, postsCount: 0 }
      });
    }
  }

  const activeSessionIdSet = new Set(canvasSessions.map(s => s.id.toLowerCase()));
  const finalCalls = rawCalls.map(call => {
    const callerId = call.callerSessionId.toLowerCase();
    const targetId = call.targetSessionId.toLowerCase();
    const isCallerOffline = !activeSessionIdSet.has(callerId) || archivedIds.has(call.callerSessionId) || archivedIds.has(callerId);
    const isTargetOffline = !activeSessionIdSet.has(targetId) || archivedIds.has(call.targetSessionId) || archivedIds.has(targetId);
    const isSettled = call.status === 'settled' || isCallerOffline || isTargetOffline;

    return {
      ...call,
      callerOffline: isCallerOffline,
      targetOffline: isTargetOffline,
      status: isSettled ? 'settled' : 'active'
    };
  });

  const outboundMap = new Map();
  const inboundMap = new Map();
  for (const c of finalCalls) {
    outboundMap.set(c.callerSessionId, (outboundMap.get(c.callerSessionId) || 0) + 1);
    inboundMap.set(c.targetSessionId, (inboundMap.get(c.targetSessionId) || 0) + 1);
  }
  const postsMap = new Map();
  for (const p of canvasPosts) {
    if (p.status === 'active') {
      postsMap.set(p.authorSessionId, (postsMap.get(p.authorSessionId) || 0) + 1);
    }
  }
  for (const s of canvasSessions) {
    s.stats = {
      outboundCalls: outboundMap.get(s.id) || 0,
      inboundCalls: inboundMap.get(s.id) || 0,
      postsCount: postsMap.get(s.id) || 0
    };
  }

  const wsMap = new Map();
  if (currentWorkspace) {
    wsMap.set(currentWorkspace, {
      id: currentWorkspace,
      name: path.basename(currentWorkspace) || currentWorkspace,
      isCurrent: true,
      sessionIds: []
    });
  }
  for (const s of canvasSessions) {
    const ws = s.workspace || currentWorkspace;
    if (!wsMap.has(ws)) {
      wsMap.set(ws, {
        id: ws,
        name: path.basename(ws) || ws,
        isCurrent: ws === currentWorkspace,
        sessionIds: []
      });
    }
    wsMap.get(ws).sessionIds.push(s.id);
  }
  const workspaces = Array.from(wsMap.values());

  const activePostsCount = canvasPosts.filter(p => p.status === 'active').length;
  const metrics = {
    totalSessions: canvasSessions.length,
    runningSessions: canvasSessions.filter(s => s.state === 'running').length,
    activeCalls: finalCalls.filter(c => c.status === 'active').length,
    totalPosts: activePostsCount,
    activePosts: activePostsCount
  };

  return {
    timestamp: now,
    currentWorkspace,
    workspaces,
    sessions: canvasSessions,
    posts: canvasPosts,
    calls: finalCalls,
    metrics
  };
}

export {
  computeSessionShortId,
  isHumanReadableTitle,
  resolveCanvasSessionDisplayTitle
};

function resolveWebServer(ctx) {
  if (typeof ctx?.get !== 'function') return undefined;
  for (const key of WEB_SERVER_KEYS) {
    const service = ctx.get(key);
    if (service && typeof service.register === 'function') return service;
  }
  return undefined;
}

/**
 * Wrap a raw WebServer so each handler runs behind the Connection fence.
 *
 * @param {any} server Raw host Web server exposing `register`
 * @param {() => any} connection Late-bound Connection service accessor
 * @returns {{ register: (route: any) => any }}
 */
export function authenticatedWebRoutes(server, connection) {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = typeof connection === 'function' ? connection() : undefined;
          const rejection = gate === undefined
            ? 503
            : (typeof gate.requestRejection === 'function' ? gate.requestRejection(req) : undefined);
          if (rejection !== undefined) {
            res.writeHead(rejection, JSON_HEADERS);
            res.end(JSON.stringify({
              error: rejection === 503
                ? 'authentication unavailable'
                : rejection === 401 ? 'unauthorized' : 'forbidden'
            }));
            return;
          }
          await route.handler(req, res);
        }
      });
    }
  };
}

/**
 * Build the GET-only telemetry handler.
 *
 * @param {any} ctx Cordis context used for the read-only snapshot
 * @param {{ logger?: any }} [deps]
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function createTelemetryHandler(ctx, deps = {}) {
  const logger = deps.logger;
  return async function handler(req, res) {
    if (req.method !== undefined && req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', ...JSON_HEADERS });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    let params;
    try {
      params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    } catch {
      params = new URLSearchParams();
    }

    const limitRaw = Number.parseInt(params.get('limit') ?? '', 10);
    // ADR-0013: Web 路由无条件返回全量工作区数据；保留 workspace 参数识别调用方当前工作区用于置首高亮
    const options = {
      sessionId: params.get('sessionId') || undefined,
      workspace: params.get('workspace') || undefined,
      crossWorkspace: true,
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    };

    try {
      const snapshot = await getCanvasTelemetry(ctx, options);
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(snapshot));
    } catch (error) {
      logger?.warn?.(`[dsh-call-session] telemetry route failed: ${error?.message || error}`);
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'telemetry unavailable' }));
    }
  };
}

/**
 * Mount the telemetry route as soon as the host Web server is bound.
 *
 * A webless profile keeps the plugin tool-only: the probe returns false and
 * boot is never blocked. Registration rides `ctx.effect`, so unloading the
 * plugin removes the route.
 *
 * @param {any} ctx Cordis plugin context
 * @param {{ logger?: any }} [deps]
 * @returns {{ tryRegister: () => boolean, registered: () => boolean }}
 */
export function installTelemetryWebSurface(ctx, deps = {}) {
  const logger = deps.logger;
  let registered = false;

  const tryRegister = () => {
    if (registered) return true;
    const rawServer = resolveWebServer(ctx);
    if (rawServer === undefined) return false;

    const server = authenticatedWebRoutes(rawServer, () => (typeof ctx.get === 'function' ? ctx.get('connection') : undefined));
    registered = true;

    const mount = () => server.register({
      kind: 'exact',
      path: TELEMETRY_ROUTE_PATH,
      handler: createTelemetryHandler(ctx, { logger })
    });

    if (typeof ctx.effect === 'function') {
      ctx.effect(mount, 'dsh-call-session: telemetry route');
    } else {
      mount();
    }

    logger?.debug?.(`[dsh-call-session] Telemetry route mounted at ${TELEMETRY_ROUTE_PATH}.`);
    return true;
  };

  tryRegister();

  if (typeof ctx.on === 'function') {
    ctx.on('internal/service', (name) => {
      if (WEB_SERVER_KEYS.includes(name) || name === 'connection') tryRegister();
    });
  }

  return {
    tryRegister,
    registered: () => registered
  };
}
