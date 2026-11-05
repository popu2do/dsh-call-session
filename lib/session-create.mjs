/**
 * DSH Peer Session Creation Service
 *
 * Coordinates peer session creation by composing:
 * - SessionSafeguard (workspace quota, rate limiting, generation cutoff, in-flight concurrency)
 * - DshHostGateway (Cordis host service discovery, root agent creation, model & preset inheritance)
 * - PeerBootstrapper (initial message formatting, dispatch, and blackboard announcement)
 */

import { randomUUID } from 'node:crypto';
import { isSameWorkspace, normalizeWorkspace } from './workspace.mjs';
import { readHostService } from './host-services.mjs';
import { SessionDirectory, isTopLevelIdentity, resolveNativeSessionStatus } from './session-directory.mjs';
import { CALL_TYPES, DEFAULT_CALL_TYPE, extractCausalCounters, waitForCausalExecution } from './native-message-transport.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';
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
 * 阶段 1：准入校验与租约申领
 *
 * @param {object} deps 依赖注入对象
 * @param {object} input 外部输入
 * @returns {object} 准入上下文状态
 */
function validateAndAdmit(deps, input = {}) {
  const directory = deps.directory;
  const safeguard = deps.safeguard || defaultSafeguard;
  const gateway = deps.gateway;
  const { args, exec, options, boardStore } = input;

  if (!args || typeof args !== 'object') {
    throw new Error('[InvalidParameter] session_create: arguments must be an object.');
  }

  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || 'root-session';
  const creatorSessionId = callerSessionId;
  const callerTitle = directory?.resolveTitle?.(callerAgent) || 'Session';
  const callerCwd = directory?.resolveCwd?.(callerAgent) || process.cwd();

  if (args.workspace !== undefined && args.workspace !== null) {
    if (typeof args.workspace !== 'string' || !args.workspace.trim()) {
      throw new Error('[InvalidParameter] session_create: workspace must be a non-empty string.');
    }
  }

  const targetCwd = (args.workspace && typeof args.workspace === 'string')
    ? args.workspace.trim()
    : callerCwd;
  const targetWorkspace = normalizeWorkspace(targetCwd);

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

  if (args.call_type !== undefined && args.call_type !== null && !CALL_TYPES.includes(args.call_type)) {
    throw new Error(
      `[InvalidParameter] session_create: invalid call_type "${args.call_type}". Use notice, task_soft, task_hard, or task_report.`
    );
  }

  if (args.context_post_ids !== undefined && !Array.isArray(args.context_post_ids)) {
    throw new Error('[InvalidParameter] session_create: context_post_ids must be an array.');
  }

  if (args.model !== undefined && args.model !== null) {
    if (typeof args.model !== 'string' || !args.model.trim()) {
      throw new Error('[InvalidParameter] session_create: model must be a non-empty string.');
    }
  }

  if (args.reasoning_effort !== undefined && args.reasoning_effort !== null) {
    if (typeof args.reasoning_effort !== 'string' || !args.reasoning_effort.trim()) {
      throw new Error('[InvalidParameter] session_create: reasoning_effort must be a non-empty string.');
    }
  }

  if (args.preset !== undefined && args.preset !== null) {
    if (typeof args.preset !== 'string' || !args.preset.trim()) {
      throw new Error('[InvalidParameter] session_create: preset must be a non-empty string.');
    }
  }

  const cleanPostIds = Array.isArray(args.context_post_ids)
    ? args.context_post_ids.filter(p => p !== null && p !== undefined).map(String).map(s => s.trim().replace(/^#+/, '')).filter(Boolean).slice(0, PEER_SESSION_CONSTANTS.MAX_CONTEXT_POST_IDS)
    : [];

  const agentsService = gateway?.resolveRootAgentsService?.(exec);
  if (!agentsService || typeof agentsService.create !== 'function') {
    throw new Error('[ServiceUnavailable] session_create: agents.create service is unavailable.');
  }

  // 工作区准入校验 (ADR-0003 §4.1.5)：同工程直通，跨工程必须命中宿主注册表
  if (args.workspace && !isSameWorkspace(targetWorkspace, callerCwd)) {
    const registered = directory?.isRegisteredWorkspace?.(targetWorkspace);
    if (registered === null || registered === undefined) {
      throw new Error('[WorkspaceRegistryUnavailable] session_create: host exposes no workspace registry, so cross-workspace creation cannot be validated.');
    }
    if (!registered) {
      throw new Error(`[WorkspaceNotRegistered] session_create: workspace "${targetWorkspace}" is not a registered workspace; register it on the host before creating sessions there.`);
    }
  }

  // 准入获取租约 (Atomic Admission Lease)
  const lease = safeguard.admit({
    callerAgent,
    workspace: targetWorkspace,
    title: args.title,
    initialMessage: args.initial_message,
    agentsService,
    directory
  });

  return {
    lease,
    cleanPostIds,
    targetWorkspace,
    targetCwd,
    callerSessionId,
    creatorSessionId,
    callerTitle,
    callerAgent,
    agentsService,
    options,
    boardStore,
    args,
    exec
  };
}

/**
 * 阶段 2：代理开辟与标题关联
 *
 * @param {object} deps 依赖注入对象
 * @param {object} state 准入状态
 * @returns {Promise<object>} 目标 Agent 实例
 */
async function provisionPeerAgent(deps, state) {
  const gateway = deps.gateway;
  const sessionId = generateSessionId();

  const agentOptions = gateway.resolveEffectiveModel({
    callerAgent: state.callerAgent,
    model: state.args.model,
    reasoningEffort: state.args.reasoning_effort
  });

  const { presetId: resolvedPresetId, setup: compositionSetup } = await gateway.resolvePresetSetup({
    callerAgent: state.callerAgent,
    args: state.args,
    options: state.options
  });

  const targetAgent = await gateway.createRootAgent({
    sessionId,
    title: state.lease.title,
    cwd: state.targetCwd,
    generation: state.lease.generation,
    creatorSessionId: state.creatorSessionId,
    agentOptions,
    presetId: resolvedPresetId,
    setup: compositionSetup,
    agentsService: state.agentsService,
    exec: state.exec
  });

  // 持久化标题事件 (ADR-0017)
  await gateway.appendTitleEvent(targetAgent, state.lease.title);

  // 挂载工作区归属
  await gateway.attachWorkspace(sessionId, state.targetWorkspace);

  return targetAgent;
}



/**
 * 安全解析会话原生状态辅助函数 (M1: 统一包裹并保留原始失败信号)
 * @param {any} agent
 * @param {any} logger
 * @param {string} phaseTag
 * @returns {{ statusRes: object, err: any }}
 */
function safeResolveStatus(agent, logger, phaseTag) {
  try {
    const res = resolveNativeSessionStatus(agent);
    return { statusRes: res, err: null };
  } catch (err) {
    logger?.warn?.(`[Session] ${phaseTag} error resolving session status:`, err);
    return {
      statusRes: { status: 'idle', error: null },
      err
    };
  }
}

/**
 * 阶段 3：启动协同与初帧因果确权
 *
 * @param {object} deps 依赖注入对象
 * @param {object} state 开辟后流水线状态
 * @returns {Promise<object>} 确权结果元组
 */
async function bootstrapAndVerify(deps, state) {
  const { targetAgent, lease, args, cleanPostIds, targetWorkspace, callerSessionId, callerTitle, boardStore } = state;
  const bootstrapper = deps.bootstrapper;
  const logger = deps.logger || noopLogger;

  // 初始消息派发前健康探测
  const targetHealth = resolveNativeSessionStatus(targetAgent);
  if (targetHealth.status === 'error') {
    return {
      status: 'error',
      bootstrapPostId: null,
      deliveryState: 'failed',
      executionState: 'crashed',
      finalStatus: 'error',
      executionError: targetHealth.error || {
        category: 'PREFLIGHT',
        code: 'PREFLIGHT_TARGET_IN_ERROR',
        message: 'Target session is in error state upon creation',
        details: null
      },
      hasInitialMessage: Boolean(args.initial_message && typeof args.initial_message === 'string' && args.initial_message.trim()),
      isPreflightError: true
    };
  }

  // 派发前采样因果基线，防止同步执行吞没增量计数 (Spec-014 / 审查修复)
  const initialCounters = extractCausalCounters(targetAgent);
  const initialTargetRunning = Boolean(targetHealth?.status === 'running');

  // 初始消息派发与公共黑板引导公告
  const { status, bootstrapPostId } = bootstrapper.bootstrap({
    targetAgent,
    callerSessionId,
    callerTitle,
    callerWorkspace: targetWorkspace,
    initialMessage: args.initial_message,
    contextPostIds: cleanPostIds,
    callType: args.call_type ?? undefined,
    boardStore,
    targetGeneration: lease.generation,
    finalTitle: lease.title
  });

  // 初始消息投递成功即入账：义务由收件方承担，与 session_call 同一本账、同一结算语义。
  // 投递失败（status 为 'idle' 表示派发异常被吞）不入账，避免凭空造出无人能结的义务。
  if (status !== 'idle' && typeof args.initial_message === 'string' && args.initial_message.trim()) {
    recordCreateObligation(deps, {
      callerSessionId,
      callerTitle,
      callerAgent: state.callerAgent,
      targetAgent,
      callType: args.call_type ?? DEFAULT_CALL_TYPE,
      cleanPostIds,
      rawMessage: args.initial_message,
      targetWorkspace
    });
  }

  // 分级轻量启动握手检查 (ADR-0031)
  let deliveryState = 'delivered';
  let executionState = 'pending';
  let finalStatus = status;
  let executionError = null;

  const hasInitialMessage = Boolean(args.initial_message && typeof args.initial_message === 'string' && args.initial_message.trim());
  if (hasInitialMessage) {
    let waitMs = (targetAgent?.phase || targetAgent?.session?.events ? 300 : 0);
    if (typeof args.wait_ms === 'number' && !Number.isNaN(args.wait_ms)) {
      waitMs = Math.max(0, Math.min(5000, Math.floor(args.wait_ms)));
    }

    const causalResult = await waitForCausalExecution({
      targetAgent,
      waitMs,
      resolveStatus: (agent) => {
        const { statusRes, err } = safeResolveStatus(agent, logger, 'Handshake probe');
        if (err && !executionError) {
          executionError = err;
        }
        return statusRes;
      },
      initialTargetRunning,
      initialCounters,
      defaultDeliveryState: 'enqueued',
      pollIntervalMs: 15
    });

    deliveryState = causalResult.deliveryState;
    executionState = causalResult.executionState;
    finalStatus = causalResult.finalStatus;
    if (causalResult.executionError) {
      executionError = causalResult.executionError;
    }
  } else {
    deliveryState = 'delivered';
    executionState = 'unverified';
    finalStatus = 'idle';
  }

  return {
    status,
    bootstrapPostId,
    deliveryState,
    executionState,
    finalStatus,
    executionError,
    hasInitialMessage,
    isPreflightError: false
  };
}

/**
 * 把 `session_create` 的初始消息记进同一本调用账本。
 *
 * 两种入口（`session_call` 与 `session_create`）写同一形状的条目，收件方因此被同一条
 * 守卫追着要回执，而不是只有其中一种入口产生义务。
 *
 * @param {object} deps 依赖注入对象
 * @param {object} meta 记账所需字段
 */
function recordCreateObligation(deps, {
  callerSessionId,
  callerTitle,
  callerAgent,
  targetAgent,
  callType,
  cleanPostIds,
  rawMessage,
  targetWorkspace
} = {}) {
  try {
    const ringBuffer = getCallTelemetry(deps.ctx, deps.options);
    if (!ringBuffer || typeof ringBuffer.record !== 'function') return;
    const directory = deps.directory;
    const callerIdentity = callerAgent && directory ? directory.resolveIdentity(callerAgent) : null;
    const targetIdentity = directory ? directory.resolveIdentity(targetAgent) : null;
    const payload = typeof rawMessage === 'string' ? rawMessage : '';
    const snippet = payload.replace(/[\r\n\t ]+/g, ' ').trim();

    ringBuffer.record({
      callerSessionId,
      callerTitle,
      callerWorkspace: callerIdentity ? callerIdentity.workspace : '',
      targetSessionId: targetAgent?.id,
      targetTitle: targetAgent?.session?.title || 'Session',
      targetWorkspace: (targetIdentity && targetIdentity.workspace) || targetWorkspace || '',
      callType,
      deliveryMode: 'followup',
      contextPostIds: cleanPostIds,
      messageSnippet: snippet,
      messagePayload: payload,
      callerNonTopLevel: Boolean(callerAgent && directory && !isTopLevelIdentity(callerIdentity)),
      targetNonTopLevel: Boolean(directory && !isTopLevelIdentity(targetIdentity)),
      status: 'active'
    });
  } catch (telemetryErr) {
    deps.logger?.debug?.(`[dsh-call-session] session_create telemetry recording failed: ${telemetryErr?.message || telemetryErr}`);
  }
}

/**
 * 阶段 4：提交租约与结果装配
 *
 * @param {object} deps 依赖注入对象
 * @param {object} state 完结阶段状态
 * @returns {object} SessionCreateResult 结果对象
 */
function finalizeAdmission(deps, state) {
  const lease = state.lease;
  const targetAgent = state.targetAgent;
  const targetWorkspace = state.targetWorkspace;
  const cleanPostIds = state.cleanPostIds || [];
  const verification = state.verification || state;

  const finalStatus = verification.finalStatus ?? state.finalStatus;
  const bootstrapPostId = verification.bootstrapPostId ?? state.bootstrapPostId ?? null;
  const deliveryState = verification.deliveryState ?? state.deliveryState;
  const executionState = verification.executionState ?? state.executionState;
  const hasInitialMessage = verification.hasInitialMessage ?? state.hasInitialMessage ?? false;

  lease.commit();

  const msg = resolveMessages(deps?.ctx, deps?.options?.config || state.options?.config);

  return {
    success: true,
    sessionId: targetAgent.id,
    title: lease.title,
    workspace: targetWorkspace,
    status: finalStatus,
    generation: lease.generation,
    bootstrapPostId,
    contextPostIds: cleanPostIds,
    deliveryState,
    executionState,
    message: msg.sessionCreateSuccess(
      targetAgent.id,
      lease.title,
      finalStatus,
      lease.generation,
      executionState,
      deliveryState,
      hasInitialMessage
    )
  };
}

/**
 * 原子对等会话准入流水线组合执行器
 * 持有事务屏障，未达成功提交阶段的退出路径执行 lease.release()。
 *
 * @param {any} ctx Cordis 上下文
 * @param {object} [pipelineInput]
 * @returns {Promise<object>} SessionCreateResult 结果
 */
async function executePeerSessionAdmissionPipeline(ctx, {
  args = {},
  exec = {},
  options = {},
  gateway,
  safeguard,
  directory,
  bootstrapper,
  boardStore,
  logger = noopLogger
} = {}) {
  const resolvedDirectory = directory || new SessionDirectory(ctx, { logger });
  const resolvedGateway = gateway || new DshHostGateway(ctx, { logger });
  const resolvedSafeguard = safeguard || defaultSafeguard;
  const resolvedBootstrapper = bootstrapper || new PeerBootstrapper({ logger });
  const resolvedBoardStore = boardStore || options.boardStore || readHostService(ctx, 'boardStore');

  const deps = {
    ctx,
    logger,
    directory: resolvedDirectory,
    gateway: resolvedGateway,
    safeguard: resolvedSafeguard,
    bootstrapper: resolvedBootstrapper,
    options
  };

  const input = {
    args,
    exec,
    options,
    boardStore: resolvedBoardStore
  };

  const admissionState = validateAndAdmit(deps, input);
  const lease = admissionState.lease;

  try {
    const targetAgent = await provisionPeerAgent(deps, admissionState);
    const verification = await bootstrapAndVerify(deps, {
      ...admissionState,
      targetAgent
    });

    if (verification.executionState === 'crashed') {
      return {
        success: false,
        sessionId: targetAgent.id,
        title: lease.title,
        workspace: admissionState.targetWorkspace,
        status: 'error',
        generation: lease.generation,
        bootstrapPostId: verification.bootstrapPostId ?? null,
        contextPostIds: admissionState.cleanPostIds,
        deliveryState: 'failed',
        executionState: 'crashed',
        error: verification.executionError,
        message: verification.isPreflightError
          ? `[Session] 同级会话创建后处于异常状态，阻断初始任务派发: ${verification.executionError?.message || '未知错误'}`
          : `[Session] 同级会话启动首帧发生崩溃: ${verification.executionError?.message || '未知错误'}`
      };
    }

    return finalizeAdmission(deps, {
      ...admissionState,
      targetAgent,
      verification
    });
  } finally {
    lease.release();
  }
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
    defaultSafeguard.assertRateLimit(callerSessionId, now);
  }

  static recordRateLimit(callerSessionId, now = Date.now()) {
    return defaultSafeguard.recordRateLimit(callerSessionId, now);
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
    return this.safeguard.assertRateLimit(callerSessionId, now);
  }

  recordRateLimit(callerSessionId, now = Date.now()) {
    return this.safeguard.recordRateLimit(callerSessionId, now);
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
      boardStore = argsOrParams.boardStore || options.boardStore || this.options.boardStore || readHostService(this.ctx, 'boardStore');
    } else {
      args = argsOrParams || {};
      exec = maybeExec || {};
      options = maybeOptions || this.options || {};
      boardStore = options.boardStore || this.options.boardStore || readHostService(this.ctx, 'boardStore');
    }

    return executePeerSessionAdmissionPipeline(this.ctx, {
      args,
      exec,
      options,
      gateway: this.gateway,
      safeguard: this.safeguard,
      directory: this.directory,
      bootstrapper: this.bootstrapper,
      boardStore,
      logger: this.logger
    });
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
    boardStore = ctxOrOptions.boardStore || options.boardStore || readHostService(ctx, 'boardStore');
  } else {
    ctx = ctxOrOptions;
    args = rawArgs !== undefined ? rawArgs : {};
    exec = rawExec || {};
    options = rawOptions || {};
    boardStore = options.boardStore || readHostService(ctx, 'boardStore');
  }

  const factory = new PeerSessionFactory(ctx, options);
  return factory.create({ args, exec, boardStore, options });
}

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
  bootstrapPeerSession,
  validateAndAdmit,
  provisionPeerAgent,
  bootstrapAndVerify,
  finalizeAdmission,
  executePeerSessionAdmissionPipeline
};