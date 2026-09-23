/**
 * DSH Peer Session Creation Service
 *
 * Coordinates peer session creation by composing:
 * - SessionSafeguard (workspace quota, rate limiting, generation cutoff, in-flight concurrency)
 * - DshHostGateway (Cordis host service discovery, root agent creation, model & preset inheritance)
 * - PeerBootstrapper (initial message formatting, dispatch, and blackboard announcement)
 */

import { randomUUID } from 'node:crypto';
import { normalizeWorkspace } from './board-store.mjs';
import { SessionDirectory } from './session-directory.mjs';
import { resolveMessages } from './locales/index.mjs';

// Deep sub-modules
import {
  DshHostGateway,
  resolveCordisService,
  resolveRootAgentsService,
  resolveDefaultModelSelection,
  resolveCallerAgentOptions,
  resolvePeerAgentOptions,
  resolvePeerPresetAndSetup
} from './dsh-host-gateway.mjs';

import {
  SAFEGUARD_CONSTANTS,
  PEER_SESSION_CONSTANTS,
  SessionSafeguard,
  AdmissionLease,
  defaultSafeguard,
  resolvePeerTitle,
  inspectWorkspaceActiveSessions,
  checkRateLimit,
  assertRateLimit,
  recordRateLimit,
  rollbackRateLimit,
  resetRateLimits,
  resetInFlightCreations
} from './session-safeguard.mjs';

import {
  PeerBootstrapper,
  formatInitialMessage,
  dispatchInitialMessage,
  publishBootstrapNotice,
  bootstrapPeerSession
} from './peer-bootstrap.mjs';

export {
  SAFEGUARD_CONSTANTS,
  PEER_SESSION_CONSTANTS,
  SessionSafeguard,
  AdmissionLease,
  resetRateLimits,
  checkRateLimit,
  assertRateLimit,
  recordRateLimit,
  rollbackRateLimit,
  resetInFlightCreations,
  resolvePeerTitle,
  inspectWorkspaceActiveSessions,
  resolveCordisService,
  resolveRootAgentsService,
  resolveDefaultModelSelection,
  resolveCallerAgentOptions,
  resolvePeerAgentOptions,
  resolvePeerPresetAndSetup,
  DshHostGateway,
  PeerBootstrapper,
  formatInitialMessage,
  dispatchInitialMessage,
  publishBootstrapNotice,
  bootstrapPeerSession
};

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

/**
 * 受控同级会话工厂
 * 组合宿主网关、准入防护守卫与启动协同器，提供受控 Root Session 生命周期编排。
 */
export class PeerSessionFactory {
  /**
   * @param {any} ctx Cordis 根上下文
   * @param {object} [options]
   * @param {any} [options.logger] 自定义日志
   * @param {any} [options.boardStore] 默认黑板服务
   * @param {SessionDirectory} [options.directory] 共享 SessionDirectory 实例
   * @param {DshHostGateway} [options.gateway] 宿主网关实例
   * @param {SessionSafeguard} [options.safeguard] 准入守卫实例
   * @param {PeerBootstrapper} [options.bootstrapper] 启动协同器实例
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = options || {};
    this.logger = (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
      || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
      || (this.options.logger || noopLogger);
    this.directory = this.options.directory || new SessionDirectory(ctx, { logger: this.logger });
    this.gateway = this.options.gateway || new DshHostGateway(ctx, { logger: this.logger });
    this.safeguard = this.options.safeguard || defaultSafeguard;
    this.bootstrapper = this.options.bootstrapper || new PeerBootstrapper({ logger: this.logger });
  }

  static reset() {
    defaultSafeguard.reset();
  }

  static resetRateLimits() {
    defaultSafeguard.resetRateLimits();
  }

  static resetInFlightCreations() {
    defaultSafeguard.resetInFlight();
  }

  static checkRateLimit(callerSessionId, now = Date.now()) {
    return defaultSafeguard.checkRateLimit(callerSessionId, now);
  }

  static assertRateLimit(callerSessionId, now = Date.now()) {
    const history = defaultSafeguard.rateLimits.get(callerSessionId) || [];
    const recent = history.filter(ts => now - ts < defaultSafeguard.windowMs);
    if (recent.length >= defaultSafeguard.maxCreationsPerMinute) {
      throw new Error(
        `[RateLimitExceeded] Session [${callerSessionId}] creation rate exceeded (limit: ${defaultSafeguard.maxCreationsPerMinute}/min).`
      );
    }
  }

  static recordRateLimit(callerSessionId, now = Date.now()) {
    if (!callerSessionId) return null;
    const history = defaultSafeguard.rateLimits.get(callerSessionId) || [];
    const recent = history.filter(ts => now - ts < defaultSafeguard.windowMs);
    recent.push(now);
    defaultSafeguard.rateLimits.set(callerSessionId, recent);
    return now;
  }

  static rollbackRateLimit(callerSessionId, timestamp) {
    defaultSafeguard.rollbackRateLimit(callerSessionId, timestamp);
  }

  static resolveTitle(params) {
    return resolvePeerTitle(params);
  }

  static resolveAgentOptions(params = {}) {
    return resolvePeerAgentOptions(params);
  }

  static resolvePresetAndSetup(params = {}) {
    return resolvePeerPresetAndSetup(params);
  }

  static resolveRootAgentsService(ctx, exec) {
    return resolveRootAgentsService(ctx, exec);
  }

  resolveTitle(params) {
    return PeerSessionFactory.resolveTitle(params);
  }

  resolveAgentOptions(params = {}) {
    return this.gateway.resolveEffectiveModel(params);
  }

  resolvePresetAndSetup(params = {}) {
    return this.gateway.resolvePresetSetup(params);
  }

  inspectWorkspace(callerWorkspace, options = {}) {
    return this.directory.inspectWorkspace(callerWorkspace, options);
  }

  checkRateLimit(callerSessionId, now = Date.now()) {
    return this.safeguard.checkRateLimit(callerSessionId, now);
  }

  assertRateLimit(callerSessionId, now = Date.now()) {
    return PeerSessionFactory.assertRateLimit(callerSessionId, now);
  }

  recordRateLimit(callerSessionId, now = Date.now()) {
    return PeerSessionFactory.recordRateLimit(callerSessionId, now);
  }

  rollbackRateLimit(callerSessionId, timestamp) {
    return this.safeguard.rollbackRateLimit(callerSessionId, timestamp);
  }

  reset() {
    this.safeguard.reset();
  }

  /**
   * 创建受控平级会话 (Root Session)
   *
   * @param {object | import('../types/session-create.js').SessionCreateArgs} argsOrParams
   * @param {any} [maybeExec]
   * @param {any} [maybeOptions]
   * @returns {Promise<import('../types/session-create.js').SessionCreateResult>}
   */
  async create(argsOrParams = {}, maybeExec = {}, maybeOptions = {}) {
    let args, exec, options, boardStore;
    if (argsOrParams && (
      Object.prototype.hasOwnProperty.call(argsOrParams, 'args') ||
      Object.prototype.hasOwnProperty.call(argsOrParams, 'exec')
    )) {
      args = argsOrParams.args !== undefined ? argsOrParams.args : {};
      exec = argsOrParams.exec || {};
      options = argsOrParams.options || this.options || {};
      boardStore = argsOrParams.boardStore || options.boardStore || this.options.boardStore || this.ctx?.boardStore;
    } else {
      args = argsOrParams || {};
      exec = maybeExec || {};
      options = maybeOptions || this.options || {};
      boardStore = options.boardStore || this.options.boardStore || this.ctx?.boardStore;
    }

    if (!args || typeof args !== 'object') {
      throw new Error('[InvalidParameter] session_create: arguments must be an object.');
    }

    const directory = this.directory;
    const logger = this.logger;
    const callerAgent = exec?.agent;
    const callerSessionId = callerAgent?.id || 'root-session';
    const creatorSessionId = callerSessionId;
    const callerTitle = directory.resolveTitle(callerAgent) || 'Session';
    const callerCwd = directory.resolveCwd(callerAgent) || process.cwd();
    const callerWorkspace = normalizeWorkspace(callerCwd);

    if (args.title !== undefined) {
      if (typeof args.title !== 'string') {
        throw new Error('[InvalidParameter] session_create: title must be a string.');
      }
      if (args.title.length > PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH) {
        throw new Error(`[InvalidParameter] session_create: title exceeds maximum length of ${PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH} characters.`);
      }
    }

    if (args.initial_message !== undefined && args.initial_message !== null) {
      if (typeof args.initial_message !== 'string') {
        throw new Error('[InvalidParameter] session_create: initial_message must be a string.');
      }
      if (args.initial_message.length > PEER_SESSION_CONSTANTS.MAX_INITIAL_MESSAGE_LENGTH) {
        throw new Error(`[InvalidParameter] session_create: initial_message exceeds maximum length of ${PEER_SESSION_CONSTANTS.MAX_INITIAL_MESSAGE_LENGTH} characters.`);
      }
    }

    if (args.context_post_ids !== undefined && !Array.isArray(args.context_post_ids)) {
      throw new Error('[InvalidParameter] session_create: context_post_ids must be an array.');
    }

    const cleanPostIds = Array.isArray(args.context_post_ids)
      ? args.context_post_ids.filter(p => p !== null && p !== undefined).map(String).map(s => s.trim().replace(/^#+/, '')).filter(Boolean).slice(0, PEER_SESSION_CONSTANTS.MAX_CONTEXT_POST_IDS)
      : [];

    const agentsService = this.gateway.resolveRootAgentsService(exec);
    if (!agentsService || typeof agentsService.create !== 'function') {
      throw new Error('[ServiceUnavailable] session_create: agents.create service is unavailable.');
    }

    const archivedIds = directory.getArchivedSessionIds();
    const { count: activeCount, activeTitles } = directory.inspectWorkspace(
      callerWorkspace,
      { agentsService, archivedIds }
    );

    const inFlightTitles = this.safeguard.getInFlightTitles(callerWorkspace);
    const mergedActiveTitles = new Set(activeTitles);
    for (const t of inFlightTitles) {
      mergedActiveTitles.add(t.toLowerCase());
    }

    const finalTitle = resolvePeerTitle({
      title: args.title,
      initialMessage: args.initial_message,
      activeTitles: mergedActiveTitles
    });

    // 准入获取租约 (Atomic Admission Lease)
    const lease = this.safeguard.admit({
      callerAgent,
      callerWorkspace,
      targetTitle: finalTitle,
      activeCount,
      activeTitles
    });

    try {
      const sessionId = generateSessionId();

      const agentOptions = this.gateway.resolveEffectiveModel({
        callerAgent,
        model: args.model,
        reasoningEffort: args.reasoning_effort
      });

      const { presetId: resolvedPresetId, setup: compositionSetup } = await this.gateway.resolvePresetSetup({
        callerAgent,
        args,
        options
      });

      const targetAgent = await this.gateway.createRootAgent({
        sessionId,
        title: finalTitle,
        cwd: callerCwd,
        generation: lease.generation,
        creatorSessionId,
        agentOptions,
        presetId: resolvedPresetId,
        setup: compositionSetup,
        agentsService,
        exec
      });

      // 持久化标题事件 (ADR-0017)
      await this.gateway.appendTitleEvent(targetAgent, finalTitle);

      // 挂载工作区归属
      await this.gateway.attachWorkspace(sessionId, callerWorkspace);

      // 初始消息派发与公共黑板引导公告
      const { status, bootstrapPostId } = this.bootstrapper.bootstrap({
        targetAgent,
        callerSessionId,
        callerTitle,
        callerWorkspace,
        initialMessage: args.initial_message,
        contextPostIds: cleanPostIds,
        boardStore,
        targetGeneration: lease.generation,
        finalTitle
      });

      // 提交租约
      lease.commit();

      const msg = resolveMessages(this.ctx, this.options?.config || options?.config);

      return {
        success: true,
        sessionId: targetAgent.id,
        title: finalTitle,
        workspace: callerWorkspace,
        status,
        generation: lease.generation,
        bootstrapPostId,
        contextPostIds: cleanPostIds,
        message: msg.sessionCreateSuccess(targetAgent.id, finalTitle, status, lease.generation)
      };
    } catch (err) {
      lease.release();
      throw err;
    }
  }
}

/**
 * 执行 session_create 原生同级会话创建（委托至 PeerSessionFactory）
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

  const factory = new PeerSessionFactory(ctx, options);
  return factory.create({ args, exec, boardStore, options });
}
