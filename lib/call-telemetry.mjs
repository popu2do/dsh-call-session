/**
 * DSH In-Memory Call Telemetry & Canvas Aggregator
 *
 * Provides a bounded FIFO ring buffer for session_call telemetry,
 * workspace-scoped filtering, session lifecycle cascade cleanup,
 * and a read-only canvas snapshot aggregator with zero passive wake-up.
 */
import path from 'node:path';
import { normalizeWorkspace } from './board-store.mjs';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService
} from './session-query.mjs';

/**
 * 内存环形调用记录缓冲区
 * 遵循确定性上限与 FIFO 淘汰机制，保证零磁盘 I/O 与受控内存占用。
 */
export class CallTelemetryRingBuffer {
  /**
   * @param {number} [capacity=200] 缓冲区最大容量，限制在 10 ~ 2000
   */
  constructor(capacity = 200) {
    const parsed = typeof capacity === 'number' && !Number.isNaN(capacity) ? Math.floor(capacity) : 200;
    this._capacity = Math.min(Math.max(parsed, 10), 2000);
    this._buffer = [];
  }

  /**
   * 获取当前缓冲区最大容量
   * @returns {number}
   */
  capacity() {
    return this._capacity;
  }

  /**
   * 获取当前缓冲区已存条目数量
   * @returns {number}
   */
  size() {
    return this._buffer.length;
  }

  /**
   * 清空缓冲区全部条目
   */
  clear() {
    this._buffer = [];
  }

  /**
   * 写入一条调用遥测记录，满容时按 FIFO 弹出最旧条目
   *
   * @param {object} entry 遥测条目原始字段
   * @returns {import('../types/call-telemetry.js').CallTelemetryRecord}
   */
  record(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('CallTelemetryRingBuffer.record: entry 必须是对象');
    }

    const now = typeof entry.timestamp === 'number' && entry.timestamp > 0 ? entry.timestamp : Date.now();
    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : `call-${now}-${Math.random().toString(36).slice(2, 8)}`;

    let snippet = typeof entry.messageSnippet === 'string' ? entry.messageSnippet : '';
    if (!snippet && typeof entry.messagePayload === 'string') {
      snippet = entry.messagePayload.replace(/[\r\n\t ]+/g, ' ').trim();
    }
    if (snippet.length > 120) {
      snippet = snippet.slice(0, 117) + '...';
    }

    let payload = typeof entry.messagePayload === 'string' ? entry.messagePayload : '';
    if (payload.length > 8192) {
      payload = payload.slice(0, 8189) + '...';
    }

    const record = {
      id: id.slice(0, 128),
      callerSessionId: String(entry.callerSessionId || 'unknown-caller').slice(0, 128),
      callerTitle: String(entry.callerTitle || 'Session').slice(0, 128),
      callerWorkspace: normalizeWorkspace(entry.callerWorkspace || ''),
      targetSessionId: String(entry.targetSessionId || 'unknown-target').slice(0, 128),
      targetTitle: String(entry.targetTitle || 'Session').slice(0, 128),
      targetWorkspace: normalizeWorkspace(entry.targetWorkspace || ''),
      callType: ['task_dispatch', 'task_report', 'notice'].includes(entry.callType) ? entry.callType : 'task_dispatch',
      deliveryMode: ['steer', 'followup'].includes(entry.deliveryMode) ? entry.deliveryMode : 'followup',
      timestamp: now,
      durationMs: typeof entry.durationMs === 'number' && entry.durationMs >= 0 ? entry.durationMs : 0,
      contextPostIds: Array.isArray(entry.contextPostIds)
        ? entry.contextPostIds.map(String).map(s => s.trim()).filter(Boolean).slice(0, 50)
        : [],
      messageSnippet: snippet,
      messagePayload: payload,
      status: entry.status === 'settled' ? 'settled' : 'active'
    };

    if (this._buffer.length >= this._capacity) {
      this._buffer.shift();
    }
    this._buffer.push(record);
    return record;
  }

  /**
   * 按条件查询调用记录
   *
   * @param {import('../types/call-telemetry.js').CallTelemetryFilter} [filter]
   * @returns {import('../types/call-telemetry.js').CallTelemetryRecord[]}
   */
  query(filter = {}) {
    const {
      workspace,
      crossWorkspace = false,
      cross_workspace = false,
      limit = 50,
      since,
      sessionId,
      status
    } = filter;

    const effectiveCrossWs = Boolean(crossWorkspace || cross_workspace);
    const effectiveWs = workspace ? normalizeWorkspace(workspace) : '';
    const effectiveLimit = typeof limit === 'number' && limit > 0
      ? Math.min(limit, this._capacity)
      : 50;

    const matched = [];
    for (let i = 0; i < this._buffer.length; i++) {
      const rec = this._buffer[i];
      if (!effectiveCrossWs && effectiveWs) {
        if (rec.callerWorkspace !== effectiveWs && rec.targetWorkspace !== effectiveWs) {
          continue;
        }
      }
      if (typeof since === 'number' && since > 0) {
        if (rec.timestamp < since) {
          continue;
        }
      }
      if (sessionId) {
        const sid = String(sessionId).toLowerCase();
        if (rec.callerSessionId.toLowerCase() !== sid && rec.targetSessionId.toLowerCase() !== sid) {
          continue;
        }
      }
      if (status && rec.status !== status) {
        continue;
      }
      matched.push(rec);
    }

    return matched.slice(-effectiveLimit);
  }

  /**
   * 级联将指定会话涉及的所有调用标记为已落定 settled
   *
   * @param {string} sessionId 会话 ID
   * @returns {number} 受影响的记录数量
   */
  settleSession(sessionId) {
    if (!sessionId) return 0;
    const targetId = String(sessionId).toLowerCase();
    let affected = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      const rec = this._buffer[i];
      if (rec.callerSessionId.toLowerCase() === targetId || rec.targetSessionId.toLowerCase() === targetId) {
        if (rec.status !== 'settled') {
          rec.status = 'settled';
          affected++;
        }
      }
    }
    return affected;
  }

  /**
   * 会话注销级联清理，支持 settle 软落定或 purge 物理清理
   *
   * @param {string} sessionId 会话 ID
   * @param {'settle' | 'purge' | 'delete'} [action='settle'] 清理动作
   * @returns {number} 受影响或删除的记录数量
   */
  cleanupSession(sessionId, action = 'settle') {
    if (!sessionId) return 0;
    if (action === 'purge' || action === 'delete') {
      const targetId = String(sessionId).toLowerCase();
      const prevLen = this._buffer.length;
      this._buffer = this._buffer.filter(
        rec => rec.callerSessionId.toLowerCase() !== targetId && rec.targetSessionId.toLowerCase() !== targetId
      );
      return prevLen - this._buffer.length;
    }
    return this.settleSession(sessionId);
  }
}

const contextTelemetryMap = new WeakMap();
let defaultRingBuffer = null;

/**
 * 获取或按上下文解析 CallTelemetryRingBuffer 实例
 *
 * @param {any} ctxOrOptions Cordis 根上下文或配置对象
 * @param {any} [rawOptions] 备选配置对象
 * @returns {CallTelemetryRingBuffer}
 */
export function getCallTelemetry(ctxOrOptions, rawOptions) {
  if (ctxOrOptions instanceof CallTelemetryRingBuffer) {
    return ctxOrOptions;
  }
  if (ctxOrOptions && ctxOrOptions.callTelemetry instanceof CallTelemetryRingBuffer) {
    return ctxOrOptions.callTelemetry;
  }
  const options = (rawOptions || (ctxOrOptions && ctxOrOptions.options) || ctxOrOptions || {});
  if (options.callTelemetry instanceof CallTelemetryRingBuffer) {
    return options.callTelemetry;
  }

  const ctx = ctxOrOptions && ctxOrOptions.ctx ? ctxOrOptions.ctx : ctxOrOptions;
  if (ctx && typeof ctx === 'object') {
    if (ctx.callTelemetry instanceof CallTelemetryRingBuffer) {
      return ctx.callTelemetry;
    }
    if (typeof ctx.get === 'function') {
      const service = ctx.get('callTelemetry', false);
      if (service instanceof CallTelemetryRingBuffer) return service;
    }
    if (ctx.root?.callTelemetry instanceof CallTelemetryRingBuffer) {
      return ctx.root.callTelemetry;
    }
    if (!contextTelemetryMap.has(ctx)) {
      contextTelemetryMap.set(ctx, new CallTelemetryRingBuffer(options.telemetryCapacity || 200));
    }
    return contextTelemetryMap.get(ctx);
  }

  if (!defaultRingBuffer) {
    defaultRingBuffer = new CallTelemetryRingBuffer(200);
  }
  return defaultRingBuffer;
}

const SYSTEM_TITLE_PATTERN = /joined the team|wait for an automatic assignment|system-reminder/i;

/**
 * 计算规范化 8 位会话短码
 * 剥离 session- 前缀与非字母数字字符，统一为 8 位小写字符串。
 *
 * @param {string} [rawId] 原始会话 ID
 * @returns {string} 8 位小写字母/数字短码或 'unknown'
 */
export function computeSessionShortId(rawId) {
  if (!rawId || typeof rawId !== 'string') return 'unknown';
  const stripped = rawId.replace(/^session-/i, '').replace(/[^a-zA-Z0-9]/g, '');
  return stripped.slice(0, 8).toLowerCase() || 'unknown';
}

/**
 * 解析会话在看板上的展示标题
 * 当标题命中 AgentTeams 入场文案特征或为空时，回退显示为角色名或 Agent <shortId>。
 *
 * @param {string} [rawTitle] 原始解析标题
 * @param {any} [agent] 会话实体对象
 * @param {string} [shortId] 规范化 8 位短码
 * @returns {string}
 */
export function resolveCanvasSessionDisplayTitle(rawTitle, agent, shortId) {
  const candidate = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const isSystemOrEmpty = !candidate || SYSTEM_TITLE_PATTERN.test(candidate);
  if (!isSystemOrEmpty) {
    return candidate;
  }

  const roleCandidate = agent?.role || agent?.agentType || agent?.session?.header?.role;
  if (roleCandidate && typeof roleCandidate === 'string') {
    const trimmed = roleCandidate.trim();
    if (trimmed && trimmed.toLowerCase() !== 'agent') {
      return trimmed;
    }
  }

  const sid = shortId || computeSessionShortId(agent?.id);
  return `Agent ${sid}`;
}

/**
 * 聚合看板遥测快照，纯只读、零被动唤醒与零磁盘 I/O
 *
 * @param {any} ctx Cordis 根上下文
 * @param {import('../types/call-telemetry.js').GetCanvasTelemetryOptions} [options] 过滤与查询选项
 * @returns {Promise<import('../types/call-telemetry.js').CanvasTelemetrySnapshot>}
 */
export async function getCanvasTelemetry(ctx, options = {}) {
  const crossWorkspace = Boolean(options.crossWorkspace || options.cross_workspace);
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 50;

  let currentWorkspace = '';
  if (options.workspace) {
    currentWorkspace = normalizeWorkspace(options.workspace);
  } else if (options.sessionId) {
    const agents = resolveAgentsService(ctx);
    const agent = agents?.get?.(options.sessionId) || (typeof agents?.list === 'function' ? agents.list().find(a => a?.id === options.sessionId) : null);
    if (agent) {
      currentWorkspace = normalizeWorkspace(resolveSessionCwd(agent));
    }
  }
  if (!currentWorkspace) {
    currentWorkspace = normalizeWorkspace(process.cwd());
  }

  // 只读探针，不调用 steer、followup 或 send
  const agents = resolveAgentsService(ctx);
  const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
  const archivedIds = getArchivedSessionIds(ctx);

  const canvasSessions = [];
  for (const agent of liveAgents) {
    if (!agent || !agent.id) continue;
    const sessionId = String(agent.id);
    if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) {
      continue;
    }

    const cwd = resolveSessionCwd(agent);
    const ws = normalizeWorkspace(cwd);

    if (!crossWorkspace && currentWorkspace && ws && ws !== currentWorkspace) {
      continue;
    }

    const shortId = computeSessionShortId(sessionId);
    const rawTitle = resolveSessionTitle(ctx, agent);
    const title = resolveCanvasSessionDisplayTitle(rawTitle, agent, shortId);
    const rawStatus = agent.status;
    const state = rawStatus === 'running' ? 'running' : 'idle';
    const isTopLevel = !(agent.origin === 'subagent' || agent.session?.header?.origin === 'subagent' || agent.blank);
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

  const boardStore = ctx?.boardStore || options.boardStore || (typeof ctx?.get === 'function' ? ctx.get('boardStore') : null);
  const canvasPosts = [];
  const now = Date.now();

  if (boardStore && typeof boardStore.list === 'function') {
    const listRes = boardStore.list({
      callerWorkspace: currentWorkspace,
      crossWorkspace,
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

  const activeSessionIdSet = new Set(canvasSessions.map(s => s.id.toLowerCase()));
  const finalCalls = rawCalls.map(call => {
    const callerId = call.callerSessionId.toLowerCase();
    const targetId = call.targetSessionId.toLowerCase();
    const isCallerOffline = !activeSessionIdSet.has(callerId) || archivedIds.has(call.callerSessionId) || archivedIds.has(callerId);
    const isTargetOffline = !activeSessionIdSet.has(targetId) || archivedIds.has(call.targetSessionId) || archivedIds.has(targetId);
    const isSettled = call.status === 'settled' || isCallerOffline || isTargetOffline;

    return {
      ...call,
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
  if (currentWorkspace && !wsMap.has(currentWorkspace)) {
    wsMap.set(currentWorkspace, {
      id: currentWorkspace,
      name: path.basename(currentWorkspace) || currentWorkspace,
      isCurrent: true,
      sessionIds: []
    });
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
