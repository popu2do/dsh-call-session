/**
 * DSH Peer Session Creation Service
 *
 * Provides controlled peer Root Session creation (ctx.root.agents.create),
 * blast radius safeguards (workspace quota, rate limiting, generation cutoff),
 * title sanitization/derivation, and non-blocking fire-and-forget ignition.
 */
import { randomUUID } from 'node:crypto';
import { normalizeWorkspace } from './board-store.mjs';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService
} from './session-query.mjs';
import { dispatchNativeMessage } from './session-call.mjs';

export const PEER_SESSION_CONSTANTS = Object.freeze({
  MAX_ACTIVE_PEER_SESSIONS: 10,
  MAX_CREATIONS_PER_MINUTE: 5,
  MAX_GENERATION: 2,
  MAX_TITLE_LENGTH: 60,
  MAX_INITIAL_MESSAGE_LENGTH: 4000,
  MAX_CONTEXT_POST_IDS: 5,
  PRIVILEGED_PREFIX_REGEX: /^\[(SYSTEM|CAPTAIN|ROOT)\]\s*/i
});

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

function generateSessionId() {
  return typeof randomUUID === 'function'
    ? `session-${randomUUID()}`
    : `session-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function generateMessageId() {
  return typeof randomUUID === 'function'
    ? randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 单会话创建频次滑动窗口跟踪器 callerSessionId -> number[]
 */
const sessionCreationsMap = new Map();

/**
 * 重置限频记录，供测试与清理使用
 */
export function resetRateLimits() {
  sessionCreationsMap.clear();
}

/**
 * 校验并记录单会话创建频次
 *
 * @param {string} callerSessionId 发起方 Session ID
 * @param {number} [now] 当前时间戳
 */
export function checkRateLimit(callerSessionId, now = Date.now()) {
  if (!callerSessionId) return;
  const history = sessionCreationsMap.get(callerSessionId) || [];
  const recent = history.filter(ts => now - ts < 60000);
  if (recent.length >= PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE) {
    throw new Error(
      `[RateLimitExceeded] 会话 [${callerSessionId}] 创建同级会话过于频繁，限制为 ${PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE} 次/分钟。`
    );
  }
  recent.push(now);
  sessionCreationsMap.set(callerSessionId, recent);
}

/**
 * 解析根上下文中的 agents 服务实例，优先绑定 ctx.root 解耦作用域
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} [exec] 执行上下文
 * @returns {any} agents 服务实例
 */
export function resolveRootAgentsService(ctx, exec) {
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
    if (ctx?.agents) return ctx.agents;
  } catch (e) {}
  if (exec?.agent?.ctx?.root) {
    const r = exec.agent.ctx.root;
    if (typeof r.get === 'function') {
      const s = r.get('agents', false);
      if (s) return s;
    }
    try {
      if (r.agents) return r.agents;
    } catch (e) {}
  }
  return resolveAgentsService(ctx, exec);
}

/**
 * 规范化与推导同级会话标题
 *
 * @param {object} params
 * @param {string} [params.title] 用户显式传入标题
 * @param {string} [params.initial_message] 初始任务指令
 * @param {Set<string>} [params.activeTitles] 当前工作区活跃会话标题集合
 * @returns {string} 规范化后的标题
 */
export function resolvePeerTitle({ title, initial_message, activeTitles = new Set() }) {
  let cleanTitle = '';

  if (typeof title === 'string' && title.trim()) {
    cleanTitle = title.replace(/[\r\n\t]/g, ' ').trim();
    cleanTitle = cleanTitle.replace(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX, '').trim();
    cleanTitle = cleanTitle.replace(/\[(SYSTEM|CAPTAIN|ROOT)\]/gi, '').trim();
  }

  if (cleanTitle) {
    if (cleanTitle.length > PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH) {
      cleanTitle = cleanTitle.slice(0, PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH).trim();
    }
    if (activeTitles.has(cleanTitle.toLowerCase())) {
      throw new Error(`[DuplicateTitle] 会话标题 "${cleanTitle}" 与当前工作区活跃会话重复。`);
    }
    return cleanTitle;
  }

  if (typeof initial_message === 'string' && initial_message.trim()) {
    const firstLine = initial_message.split(/[\r\n]+/)[0] || '';
    let summary = firstLine.replace(/[#*`~_\[\]()]/g, ' ').replace(/[\t ]+/g, ' ').trim();
    if (summary.length > 40) {
      summary = summary.slice(0, 40).trim();
    }
    if (summary) {
      let candidate = `Peer: ${summary}`;
      if (candidate.length > PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH) {
        candidate = candidate.slice(0, PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH).trim();
      }
      if (!activeTitles.has(candidate.toLowerCase())) {
        return candidate;
      }
      for (let suffix = 2; suffix <= 99; suffix++) {
        const suffixed = `${candidate} (${suffix})`;
        if (!activeTitles.has(suffixed.toLowerCase())) {
          return suffixed;
        }
      }
    }
  }

  const randomSuffix = (typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36)).slice(0, 8);
  return `Peer-${randomSuffix}`;
}

/**
 * 统计当前工作区活跃根会话数与收集已有标题
 *
 * @param {any} agentsService agents 服务实例
 * @param {string} callerWorkspace 规范化工作区路径
 * @param {Set<string>} archivedIds 已归档会话 ID 集合
 * @param {any} ctx Cordis 上下文
 * @returns {{ count: number, activeTitles: Set<string> }}
 */
export function inspectWorkspaceActiveSessions(agentsService, callerWorkspace, archivedIds, ctx) {
  const liveAgents = typeof agentsService?.list === 'function' ? agentsService.list() : [];
  let count = 0;
  const activeTitles = new Set();

  for (const agent of liveAgents) {
    if (!agent || !agent.id) continue;
    const sessionId = agent.id;
    if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) continue;
    if (agent.origin === 'subagent' || agent.session?.header?.origin === 'subagent' || agent.blank) continue;

    const agentCwd = resolveSessionCwd(agent);
    const agentWorkspace = normalizeWorkspace(agentCwd);

    if (callerWorkspace && agentWorkspace && agentWorkspace !== callerWorkspace) {
      continue;
    }

    count++;
    const title = resolveSessionTitle(ctx, agent);
    if (title) {
      activeTitles.add(title.toLowerCase());
    }
  }

  return { count, activeTitles };
}

/**
 * 执行 session_create 原生同级会话创建
 *
 * @param {any} ctxOrOptions Cordis 根上下文或参数对象
 * @param {import('../types/session-create.js').SessionCreateArgs} [rawArgs] 工具入参
 * @param {any} [rawExec] 执行上下文
 * @param {any} [rawOptions] 扩展参数，如 boardStore
 * @returns {Promise<import('../types/session-create.js').SessionCreateResult>}
 */
export async function executeSessionCreate(ctxOrOptions, rawArgs = {}, rawExec = {}, rawOptions = {}) {
  let ctx, args, exec, options, boardStore;
  if (ctxOrOptions && Object.prototype.hasOwnProperty.call(ctxOrOptions, 'ctx')) {
    ctx = ctxOrOptions.ctx;
    args = ctxOrOptions.args !== undefined ? ctxOrOptions.args : {};
    exec = ctxOrOptions.exec || {};
    options = ctxOrOptions.options || ctxOrOptions;
    boardStore = ctxOrOptions.boardStore || options.boardStore || ctx?.boardStore;
  } else {
    ctx = ctxOrOptions;
    args = rawArgs !== undefined ? rawArgs : {};
    exec = rawExec || {};
    options = rawOptions || {};
    boardStore = options.boardStore || ctx?.boardStore;
  }

  const logger = (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
    || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
    || (options.logger || noopLogger);

  if (!args || typeof args !== 'object') {
    throw new Error('session_create: 参数必须为对象。');
  }

  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || 'root-session';
  const creatorSessionId = callerSessionId;
  const callerTitle = resolveSessionTitle(ctx, callerAgent) || 'Session';
  const callerCwd = resolveSessionCwd(callerAgent) || process.cwd();
  const callerWorkspace = normalizeWorkspace(callerCwd);

  checkRateLimit(callerSessionId);

  const callerGen = callerAgent?.session?.metadata?.generation
    ?? callerAgent?.generation
    ?? callerAgent?.session?.generation
    ?? 0;

  if (callerGen >= PEER_SESSION_CONSTANTS.MAX_GENERATION) {
    throw new Error(
      `[GenerationLimitExceeded] 当前会话代际深度为 ${callerGen}，已达上限 ${PEER_SESSION_CONSTANTS.MAX_GENERATION}，无法继续派生同级会话。`
    );
  }
  const targetGeneration = callerGen + 1;

  if (args.title !== undefined) {
    if (typeof args.title !== 'string') {
      throw new Error('session_create: title 必须为字符串。');
    }
    if (args.title.length > PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH) {
      throw new Error(`session_create: title 超过最大长度限制 ${PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH} 字符。`);
    }
  }

  if (args.initial_message !== undefined && args.initial_message !== null) {
    if (typeof args.initial_message !== 'string') {
      throw new Error('session_create: initial_message 必须为字符串。');
    }
    if (args.initial_message.length > PEER_SESSION_CONSTANTS.MAX_INITIAL_MESSAGE_LENGTH) {
      throw new Error(`session_create: initial_message 超过最大长度限制 ${PEER_SESSION_CONSTANTS.MAX_INITIAL_MESSAGE_LENGTH} 字符。`);
    }
  }

  if (args.context_post_ids !== undefined && !Array.isArray(args.context_post_ids)) {
    throw new Error('session_create: context_post_ids 必须为数组。');
  }

  const cleanPostIds = Array.isArray(args.context_post_ids)
    ? args.context_post_ids.filter(p => p !== null && p !== undefined).map(String).map(s => s.trim()).filter(Boolean).slice(0, PEER_SESSION_CONSTANTS.MAX_CONTEXT_POST_IDS)
    : [];

  const agentsService = resolveRootAgentsService(ctx, exec);
  if (!agentsService || typeof agentsService.create !== 'function') {
    throw new Error('session_create: 未找到可用的 agents.create 服务实例。');
  }

  const archivedIds = getArchivedSessionIds(ctx);
  const { count: activeCount, activeTitles } = inspectWorkspaceActiveSessions(
    agentsService,
    callerWorkspace,
    archivedIds,
    ctx
  );

  if (activeCount >= PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS) {
    throw new Error(
      `[QuotaExceeded] 当前工作区活跃同级会话数已达上限 ${PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS}，无法创建新会话。`
    );
  }

  const finalTitle = resolvePeerTitle({
    title: args.title,
    initial_message: args.initial_message,
    activeTitles
  });

  const sessionId = args.sessionId || generateSessionId();
  const agentOptions = args.model ? { model: args.model } : (callerAgent?.agentOptions || callerAgent?.session?.agentOptions || {});

  // 构造 meta，不向底层传递非 'subagent' 的 origin
  const cleanMeta = {
    cwd: callerCwd,
    title: finalTitle,
    generation: targetGeneration,
    creatorSessionId
  };
  delete cleanMeta.origin;
  delete cleanMeta.parentSession;

  const createPayload = {
    sessionId,
    agentOptions,
    title: finalTitle,
    cwd: callerCwd,
    meta: cleanMeta
  };

  logger.debug?.(`[dsh-call-session] Creating peer session [${sessionId}] "${finalTitle}" (Gen ${targetGeneration})...`);
  const handleOrAgent = await agentsService.create(createPayload);
  const targetAgent = handleOrAgent?.agent || handleOrAgent;

  if (targetAgent) {
    if (!targetAgent.id) targetAgent.id = sessionId;
    targetAgent.title = finalTitle;
    targetAgent.generation = targetGeneration;
    if (targetAgent.session) {
      targetAgent.session.title = finalTitle;
      // 宿主 SessionHeader 为 deepFreeze 冻结对象，做防御性检查避免严格模式下抛出 TypeError
      if (targetAgent.session.header && !Object.isFrozen(targetAgent.session.header)) {
        targetAgent.session.header.cwd = callerCwd;
        targetAgent.session.header.title = finalTitle;
      }
      // 链路追踪元数据挂载至 session.metadata，与底层 session.header 隔离
      targetAgent.session.metadata = {
        ...(targetAgent.session.metadata || {}),
        generation: targetGeneration,
        creatorSessionId,
        origin: 'peer_created'
      };
    }
  }

  // 挂载工作区，确保在 Web GUI 归属当前工程
  const workspaceRegistry = typeof ctx?.get === 'function'
    ? ctx.get('workspaceRegistry')
    : (ctx?.workspaceRegistry || ctx?.root?.get?.('workspaceRegistry'));
  if (workspaceRegistry) {
    const wsList = typeof workspaceRegistry.list === 'function' ? workspaceRegistry.list() : [];
    const matchedWs = wsList.find(w => normalizeWorkspace(w.path) === callerWorkspace);
    if (matchedWs && typeof matchedWs.attachSession === 'function') {
      try {
        await matchedWs.attachSession(sessionId);
      } catch (err) {
        logger.debug?.(`[dsh-call-session] attachSession to workspace [${matchedWs.id}] ignored: ${err?.message || err}`);
      }
    }
  }

  let status = 'idle';
  const rawInitialMessage = typeof args.initial_message === 'string' ? args.initial_message.trim() : '';

  if (rawInitialMessage) {
    let payloadText = rawInitialMessage;
    if (cleanPostIds.length > 0) {
      const refs = cleanPostIds.map(id => (id.startsWith('#') ? id : `#${id}`)).join(', ');
      payloadText = `> Context Ref: ${refs}\n\n${rawInitialMessage}`;
    }

    const shortPayload = rawInitialMessage.replace(/[\r\n\t ]+/g, ' ').trim();
    let summary = `[Peer Session Bootstrap] from ${callerTitle}: ${shortPayload}`;
    if (summary.length > 120) {
      summary = summary.slice(0, 117) + '...';
    }

    const userMessage = {
      id: generateMessageId(),
      role: 'user',
      content: [{ type: 'text', text: payloadText }],
      source: {
        kind: 'plugin',
        plugin: 'dsh-call-session',
        form: 'session_create',
        summary
      }
    };

    try {
      dispatchNativeMessage(targetAgent, userMessage);
      status = 'running';
    } catch (err) {
      logger.warn?.(`[dsh-call-session] Failed to dispatch ignition message to ${targetAgent?.id}: ${err?.message || err}`);
    }
  }

  let bootstrapPostId = null;
  if (boardStore && typeof boardStore.post === 'function') {
    try {
      const now = Date.now();
      const bp = boardStore.post({
        id: `post-${now}-${Math.random().toString(36).slice(2, 8)}`,
        topic: 'session:bootstrap',
        content: `平级会话 [${targetAgent.id}] ("${finalTitle}") 已创建并就绪。\n工作区: ${callerWorkspace}\n创建方: ${callerSessionId}`,
        tags: ['peer-session', 'bootstrap'],
        authorSessionId: callerSessionId,
        authorTitle: callerTitle,
        authorWorkspace: callerWorkspace,
        createdAt: new Date(now).toISOString(),
        createdAtMs: now,
        expiresAt: new Date(now + 3600 * 1000).toISOString(),
        expiresAtMs: now + 3600 * 1000,
        status: 'active',
        scope: callerWorkspace || 'global',
        metadata: {
          peerSessionId: targetAgent.id,
          title: finalTitle,
          generation: targetGeneration,
          creatorSessionId
        }
      });
      bootstrapPostId = bp?.id || null;
    } catch (err) {
      logger.warn?.(`[dsh-call-session] Failed to post session:bootstrap notice: ${err?.message || err}`);
    }
  }

  logger.debug?.(`[dsh-call-session] Peer session [${targetAgent.id}] created successfully with status "${status}".`);

  return {
    success: true,
    sessionId: targetAgent.id,
    title: finalTitle,
    workspace: callerWorkspace,
    status,
    generation: targetGeneration,
    bootstrapPostId,
    contextPostIds: cleanPostIds
  };
}
