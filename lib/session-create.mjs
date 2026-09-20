/**
 * DSH Peer Session Creation Service
 *
 * Provides controlled peer Root Session creation (ctx.root.agents.create),
 * blast radius safeguards (workspace quota, rate limiting, generation cutoff),
 * title normalization/derivation, and non-blocking fire-and-forget initial message dispatch.
 */
import { randomUUID } from 'node:crypto';
import { normalizeWorkspace } from './board-store.mjs';
import {
  SessionDirectory,
  getArchivedSessionIds,
  resolveAgentsService
} from './session-directory.mjs';
import { dispatchNativeMessage } from './session-call.mjs';
import { resolveMessages } from './locales/index.mjs';

export const PEER_SESSION_CONSTANTS = Object.freeze({
  MAX_ACTIVE_PEER_SESSIONS: 5,
  MAX_CONCURRENT_RUNNING_PEER_SESSIONS: 5,
  MAX_CREATIONS_PER_MINUTE: 5,
  MAX_GENERATION: 2,
  MAX_TITLE_LENGTH: 60,
  MAX_INITIAL_MESSAGE_LENGTH: 4000,
  MAX_CONTEXT_POST_IDS: 5,
  PRIVILEGED_PREFIX_REGEX: /^(\[(SYSTEM|CAPTAIN|ROOT|ADMIN)\]|(admin|system|root|captain):)\s*/i
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
 * 校验并乐观预留单会话创建频次配额 (Optimistic Reserve)
 *
 * @param {string} callerSessionId 发起方 Session ID
 * @param {number} [now] 当前时间戳
 * @returns {number | null} 预留的时间戳
 */
export function checkRateLimit(callerSessionId, now = Date.now()) {
  if (!callerSessionId) return null;
  const history = sessionCreationsMap.get(callerSessionId) || [];
  const recent = history.filter(ts => now - ts < 60000);
  if (recent.length >= PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE) {
    throw new Error(
      `[RateLimitExceeded] Session [${callerSessionId}] creation rate exceeded (limit: ${PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE}/min).`
    );
  }
  recent.push(now);
  sessionCreationsMap.set(callerSessionId, recent);
  return now;
}

export function assertRateLimit(callerSessionId, now = Date.now()) {
  if (!callerSessionId) return;
  const history = sessionCreationsMap.get(callerSessionId) || [];
  const recent = history.filter(ts => now - ts < 60000);
  if (recent.length >= PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE) {
    throw new Error(
      `[RateLimitExceeded] Session [${callerSessionId}] creation rate exceeded (limit: ${PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE}/min).`
    );
  }
}

export function recordRateLimit(callerSessionId, now = Date.now()) {
  if (!callerSessionId) return null;
  const history = sessionCreationsMap.get(callerSessionId) || [];
  const recent = history.filter(ts => now - ts < 60000);
  recent.push(now);
  sessionCreationsMap.set(callerSessionId, recent);
  return now;
}

/**
 * 回滚单会话创建频次配额
 *
 * @param {string} callerSessionId 发起方 Session ID
 * @param {number} timestamp 待回滚的时间戳
 */
export function rollbackRateLimit(callerSessionId, timestamp) {
  if (!callerSessionId || !timestamp) return;
  const history = sessionCreationsMap.get(callerSessionId);
  if (!Array.isArray(history)) return;
  const idx = history.indexOf(timestamp);
  if (idx !== -1) {
    history.splice(idx, 1);
  }
}

const inFlightCreationsByWorkspace = new Map();

export function resetInFlightCreations() {
  inFlightCreationsByWorkspace.clear();
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
 * @param {string} [params.initialMessage] 初始任务指令
 * @param {Set<string>} [params.activeTitles] 当前工作区活跃会话标题集合
 * @returns {string} 规范化后的标题
 */
export function resolvePeerTitle({ title, initialMessage, activeTitles = new Set() }) {
  let cleanTitle = '';

  if (typeof title === 'string' && title.trim()) {
    cleanTitle = title.replace(/[\r\n\t]/g, ' ').trim();
    cleanTitle = cleanTitle.replace(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX, '').trim();
    cleanTitle = cleanTitle.replace(/\[(SYSTEM|CAPTAIN|ROOT|ADMIN)\]/gi, '').trim();
    cleanTitle = cleanTitle.replace(/\b(admin|system|root|captain):\s*/gi, '').trim();
  }

  if (cleanTitle) {
    if (cleanTitle.length > PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH) {
      cleanTitle = cleanTitle.slice(0, PEER_SESSION_CONSTANTS.MAX_TITLE_LENGTH).trim();
    }
    if (activeTitles.has(cleanTitle.toLowerCase())) {
      throw new Error(`[DuplicateTitle] Session title "${cleanTitle}" conflicts with an active session in the workspace.`);
    }
    return cleanTitle;
  }

  if (typeof initialMessage === 'string' && initialMessage.trim()) {
    const firstLine = initialMessage.split(/[\r\n]+/)[0] || '';
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
  const directory = new SessionDirectory(ctx);
  return directory.inspectWorkspace(callerWorkspace, { agentsService, archivedIds });
}

/**
 * 解析 Cordis 服务实例（多级回退探测）
 *
 * @param {any} ctx Cordis 上下文
 * @param {string} name 服务名称
 * @returns {any}
 */
export function resolveCordisService(ctx, name) {
  if (!ctx) return undefined;
  if (ctx[name]) return ctx[name];
  if (typeof ctx.get === 'function') {
    const svc = ctx.get(name);
    if (svc) return svc;
  }
  if (ctx.root) {
    if (ctx.root[name]) return ctx.root[name];
    if (typeof ctx.root.get === 'function') {
      const svc = ctx.root.get(name);
      if (svc) return svc;
    }
  }
  return undefined;
}

/**
 * 解析全局部署默认模型配置 (ctx.agentDefaultModel)
 *
 * @param {any} ctx Cordis 上下文
 * @param {any} [logger] 日志服务
 * @returns {{ provider?: string, model?: string, reasoningEffort?: string }}
 */
export function resolveDefaultModelSelection(ctx, logger = noopLogger) {
  const defaultModelService = resolveCordisService(ctx, 'agentDefaultModel');

  if (defaultModelService) {
    if (typeof defaultModelService.currentSelection === 'function') {
      try {
        const sel = defaultModelService.currentSelection();
        if (sel && typeof sel === 'object') return { ...sel };
      } catch (err) {
        logger.debug?.(`[dsh-call-session] defaultModelService.currentSelection failed: ${err?.message || err}`);
      }
    }
    if (defaultModelService.selection && typeof defaultModelService.selection === 'object') {
      return { ...defaultModelService.selection };
    }
    if (defaultModelService.current && typeof defaultModelService.current === 'object') {
      return { ...defaultModelService.current };
    }
    if (typeof defaultModelService === 'object' && (defaultModelService.provider || defaultModelService.model)) {
      return { ...defaultModelService };
    }
  }
  return {};
}

/**
 * 解析调用方 Agent 的模型选项 (callerAgent.options)
 *
 * @param {any} callerAgent 调用方 Agent
 * @returns {Record<string, any>}
 */
export function resolveCallerAgentOptions(callerAgent) {
  if (!callerAgent) return {};
  const base = {
    ...(callerAgent.options || {}),
    ...(callerAgent.agentOptions || {}),
    ...(callerAgent.session?.agentOptions || {})
  };
  if (callerAgent.provider && !base.provider) base.provider = callerAgent.provider;
  if (callerAgent.model && !base.model) base.model = callerAgent.model;
  if (callerAgent.reasoningEffort !== undefined && base.reasoningEffort === undefined) {
    base.reasoningEffort = callerAgent.reasoningEffort;
  }
  const requestConfig = typeof callerAgent.session?.requestHeader === 'function'
    ? callerAgent.session.requestHeader()?.config
    : undefined;
  if (requestConfig) {
    if (requestConfig.provider) base.provider = requestConfig.provider;
    if (requestConfig.model) base.model = requestConfig.model;
    if (requestConfig.reasoningEffort !== undefined) base.reasoningEffort = requestConfig.reasoningEffort;
  }
  return base;
}

/**
 * 解析同级会话的目标 AgentOptions：
 * 继承 callerAgent.options -> 回退 ctx.agentDefaultModel -> 支持 args.model 覆写与 provider 解析
 *
 * @param {object} [params]
 * @param {any} [params.ctx] Cordis 上下文
 * @param {any} [params.callerAgent] 调用方 Agent
 * @param {string} [params.model] 覆写的模型规格 (支持 'provider/model', 'provider:model' 或纯 'model')
 * @param {string} [params.reasoningEffort] 可选覆写的推理强度
 * @returns {Record<string, any>}
 */
export function resolvePeerAgentOptions({ ctx, callerAgent, model, reasoningEffort } = {}) {
  const defaultSelection = resolveDefaultModelSelection(ctx);
  const callerOptions = resolveCallerAgentOptions(callerAgent);

  let provider = callerOptions.provider || defaultSelection.provider;
  let modelName = callerOptions.model || defaultSelection.model;
  let effort = callerOptions.reasoningEffort !== undefined
    ? callerOptions.reasoningEffort
    : defaultSelection.reasoningEffort;

  const otherOptions = { ...defaultSelection, ...callerOptions };
  delete otherOptions.provider;
  delete otherOptions.model;
  delete otherOptions.reasoningEffort;

  if (typeof model === 'string' && model.trim()) {
    const trimmed = model.trim();
    const delimMatch = trimmed.match(/^([^/:]+)[/:](.+)$/);
    if (delimMatch) {
      const explicitProvider = delimMatch[1].trim();
      const explicitModel = delimMatch[2].trim();
      if (explicitProvider) provider = explicitProvider;
      if (explicitModel) modelName = explicitModel;
    } else {
      modelName = trimmed;
    }

    if (reasoningEffort !== undefined) {
      effort = reasoningEffort;
    } else if (modelName !== callerOptions.model || provider !== callerOptions.provider) {
      effort = undefined;
    }
  } else if (reasoningEffort !== undefined) {
    effort = reasoningEffort;
  }

  const result = {
    ...otherOptions
  };
  if (provider !== undefined) result.provider = provider;
  if (modelName !== undefined) result.model = modelName;
  if (effort !== undefined) result.reasoningEffort = effort;

  return result;
}

/**
 * 解析同级会话预设 (preset) 与 setup 组合钩子
 *
 * @param {object} [params]
 * @param {any} [params.ctx] Cordis 上下文
 * @param {any} [params.callerAgent] 调用方 Agent
 * @param {any} [params.args] 工具入参
 * @param {any} [params.options] 扩展选项
 * @param {any} [params.logger] 日志服务
 * @returns {Promise<{ presetId?: string, setup?: (agentCtx: any) => Promise<void> | void }>}
 */
export async function resolvePeerPresetAndSetup({ ctx, callerAgent, args = {}, options = {}, logger = noopLogger } = {}) {
  const sessionController = resolveCordisService(ctx, 'sessionController');
  const agentPresets = resolveCordisService(ctx, 'agentPresets') || resolveCordisService(callerAgent?.ctx, 'agentPresets');

  let candidatePresetId = args.preset || options.preset;
  if (!candidatePresetId && callerAgent) {
    candidatePresetId = callerAgent.options?.preset
      || callerAgent.agentOptions?.preset
      || callerAgent.session?.metadata?.agentPreset
      || callerAgent.session?.header?.agentPreset
      || (agentPresets && typeof agentPresets.composedPreset === 'function' && callerAgent.ctx
          ? agentPresets.composedPreset(callerAgent.ctx)
          : undefined)
      || (sessionController?.agents && typeof sessionController.agents.presetForSession === 'function' && callerAgent.session
          ? sessionController.agents.presetForSession(callerAgent.session)
          : undefined);
  }

  let resolvedPresetId = candidatePresetId;
  let setupFn = null;

  if (sessionController?.agents && typeof sessionController.agents.composeAgent === 'function') {
    try {
      const composition = await sessionController.agents.composeAgent(candidatePresetId);
      if (composition) {
        if (composition.agentPreset) resolvedPresetId = composition.agentPreset;
        if (typeof composition.setup === 'function') {
          setupFn = composition.setup;
        }
      }
    } catch (err) {
      logger.debug?.(`[dsh-call-session] sessionController.agents.composeAgent failed: ${err?.message || err}`);
    }
  }

  if (!setupFn && agentPresets) {
    if (typeof agentPresets.resolve === 'function') {
      try {
        const resolved = await agentPresets.resolve(candidatePresetId);
        if (resolved?.id) {
          resolvedPresetId = resolved.id;
        }
      } catch (err) {
        logger.debug?.(`[dsh-call-session] agentPresets.resolve failed: ${err?.message || err}`);
      }
    }

    setupFn = async (agentCtx) => {
      if (sessionController?.agents && typeof sessionController.agents.installSelection === 'function') {
        try {
          sessionController.agents.installSelection(agentCtx);
        } catch (err) {
          logger.debug?.(`[dsh-call-session] sessionController.agents.installSelection failed: ${err?.message || err}`);
        }
      }
      if (typeof agentPresets.mount === 'function') {
        try {
          await agentPresets.mount(agentCtx, resolvedPresetId);
        } catch (err) {
          logger.debug?.(`[dsh-call-session] agentPresets.mount failed: ${err?.message || err}`);
        }
      } else if (typeof agentPresets.composeFrom === 'function' && callerAgent?.ctx) {
        try {
          agentPresets.composeFrom(agentCtx, callerAgent.ctx);
        } catch (err) {
          logger.debug?.(`[dsh-call-session] agentPresets.composeFrom failed: ${err?.message || err}`);
        }
      }
    };
  }

  const customSetup = typeof options.setup === 'function' ? options.setup : null;
  let finalSetup = setupFn;
  if (customSetup) {
    if (setupFn) {
      finalSetup = async (agentCtx) => {
        await setupFn(agentCtx);
        await customSetup(agentCtx);
      };
    } else {
      finalSetup = customSetup;
    }
  }

  return {
    presetId: resolvedPresetId,
    setup: finalSetup
  };
}

/**
 * 受控同级会话工厂
 * 封装根会话创建流程、工作区配额检查、限频控制、并发防重、模型参数推导与初始消息分发。
 */
export class PeerSessionFactory {
  /**
   * @param {any} ctx Cordis 根上下文
   * @param {object} [options]
   * @param {any} [options.logger] 自定义日志
   * @param {any} [options.boardStore] 默认黑板服务
   * @param {SessionDirectory} [options.directory] 共享 SessionDirectory 实例
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = options || {};
    this.logger = (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
      || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
      || (this.options.logger || noopLogger);
    this.directory = this.options.directory || new SessionDirectory(ctx, { logger: this.logger });
  }

  static reset() {
    sessionCreationsMap.clear();
    inFlightCreationsByWorkspace.clear();
  }

  static resetRateLimits() {
    sessionCreationsMap.clear();
  }

  static resetInFlightCreations() {
    inFlightCreationsByWorkspace.clear();
  }

  static checkRateLimit(callerSessionId, now = Date.now()) {
    return checkRateLimit(callerSessionId, now);
  }

  static assertRateLimit(callerSessionId, now = Date.now()) {
    return assertRateLimit(callerSessionId, now);
  }

  static recordRateLimit(callerSessionId, now = Date.now()) {
    return recordRateLimit(callerSessionId, now);
  }

  static rollbackRateLimit(callerSessionId, timestamp) {
    return rollbackRateLimit(callerSessionId, timestamp);
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
    return PeerSessionFactory.resolveAgentOptions({ ctx: this.ctx, ...params });
  }

  resolvePresetAndSetup(params = {}) {
    return PeerSessionFactory.resolvePresetAndSetup({ ctx: this.ctx, logger: this.logger, ...params });
  }

  inspectWorkspace(callerWorkspace, options = {}) {
    return this.directory.inspectWorkspace(callerWorkspace, options);
  }

  checkRateLimit(callerSessionId, now = Date.now()) {
    return PeerSessionFactory.checkRateLimit(callerSessionId, now);
  }

  assertRateLimit(callerSessionId, now = Date.now()) {
    return PeerSessionFactory.assertRateLimit(callerSessionId, now);
  }

  recordRateLimit(callerSessionId, now = Date.now()) {
    return PeerSessionFactory.recordRateLimit(callerSessionId, now);
  }

  rollbackRateLimit(callerSessionId, timestamp) {
    return PeerSessionFactory.rollbackRateLimit(callerSessionId, timestamp);
  }

  reset() {
    PeerSessionFactory.reset();
  }

  /**
   * 创建受控平级会话 (Root Session)
   * 包含工作区配额校验、限频控制、并发防重、模型参数推导、元数据隔离与初始消息投递。
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

    const callerGen = callerAgent?.session?.metadata?.generation
      ?? callerAgent?.generation
      ?? callerAgent?.session?.generation
      ?? 0;

    if (callerGen >= PEER_SESSION_CONSTANTS.MAX_GENERATION) {
      throw new Error(
        `[GenerationLimitExceeded] Caller session generation depth is ${callerGen}, reaching limit ${PEER_SESSION_CONSTANTS.MAX_GENERATION}.`
      );
    }
    const targetGeneration = callerGen + 1;

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

    const agentsService = resolveRootAgentsService(this.ctx, exec);
    if (!agentsService || typeof agentsService.create !== 'function') {
      throw new Error('[ServiceUnavailable] session_create: agents.create service is unavailable.');
    }

    const archivedIds = directory.getArchivedSessionIds();
    const { count: activeCount, activeTitles } = this.inspectWorkspace(
      callerWorkspace,
      { agentsService, archivedIds }
    );

    const inFlightTitles = inFlightCreationsByWorkspace.get(callerWorkspace) || new Set();
    const effectiveActiveCount = activeCount + inFlightTitles.size;

    if (effectiveActiveCount >= PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS) {
      throw new Error(
        `[QuotaExceeded] Current workspace running peer sessions reached limit of ${PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS}.`
      );
    }

    const mergedActiveTitles = new Set(activeTitles);
    for (const t of inFlightTitles) {
      mergedActiveTitles.add(t.toLowerCase());
    }

    const finalTitle = this.resolveTitle({
      title: args.title,
      initialMessage: args.initial_message,
      activeTitles: mergedActiveTitles
    });

    const rateLimitTimestamp = this.checkRateLimit(callerSessionId);

    if (!inFlightCreationsByWorkspace.has(callerWorkspace)) {
      inFlightCreationsByWorkspace.set(callerWorkspace, inFlightTitles);
    }
    inFlightTitles.add(finalTitle.toLowerCase());

    const sessionId = generateSessionId();

    const agentOptions = this.resolveAgentOptions({
      callerAgent,
      model: args.model,
      reasoningEffort: args.reasoning_effort
    });

    const { presetId: resolvedPresetId, setup: compositionSetup } = await this.resolvePresetAndSetup({
      callerAgent,
      args,
      options
    });

    // 构造 meta，不向底层传递非 'subagent' 的 origin
    const cleanMeta = {
      cwd: callerCwd,
      title: finalTitle,
      generation: targetGeneration,
      creatorSessionId,
      ...(resolvedPresetId ? { agentPreset: resolvedPresetId } : {})
    };
    delete cleanMeta.origin;
    delete cleanMeta.parentSession;

    const createPayload = {
      sessionId,
      agentOptions,
      title: finalTitle,
      cwd: callerCwd,
      meta: cleanMeta,
      ...(compositionSetup ? { setup: compositionSetup } : {})
    };

    try {
      logger.debug?.(`[dsh-call-session] Creating peer session [${sessionId}] "${finalTitle}" (Gen ${targetGeneration})...`);
      const handleOrAgent = await agentsService.create(createPayload);
      const targetAgent = handleOrAgent?.agent || handleOrAgent;

      if (targetAgent) {
        if (!targetAgent.id) targetAgent.id = sessionId;
        targetAgent.title = finalTitle;
        targetAgent.generation = targetGeneration;
        if (!targetAgent.options || Object.keys(targetAgent.options).length === 0) {
          targetAgent.options = agentOptions;
        }
        if (targetAgent.session) {
          targetAgent.session.title = finalTitle;
          // 宿主 SessionHeader 为 deepFreeze 冻结对象，做防御性检查避免严格模式下抛出 TypeError
          if (targetAgent.session.header && !Object.isFrozen(targetAgent.session.header)) {
            targetAgent.session.header.cwd = callerCwd;
            targetAgent.session.header.title = finalTitle;
            if (resolvedPresetId) {
              targetAgent.session.header.agentPreset = resolvedPresetId;
            }
          }
          // 协作溯源元数据挂载至 session.metadata，与底层 session.header 隔离
          targetAgent.session.metadata = {
            ...(targetAgent.session.metadata || {}),
            generation: targetGeneration,
            creatorSessionId,
            origin: 'peer_created',
            ...(resolvedPresetId ? { agentPreset: resolvedPresetId } : {})
          };
        }

        // ADR-0017: 写入 session/title 日志事件，确保标题在 Web GUI 和投影服务中即时持久化呈现
        const targetSession = targetAgent.session || targetAgent;
        let titleAppended = false;
        const sessionTitleService = resolveCordisService(this.ctx, 'sessionTitle');
        if (sessionTitleService && typeof sessionTitleService.rename === 'function') {
          try {
            await sessionTitleService.rename(targetSession, finalTitle);
            titleAppended = true;
          } catch (err) {
            logger.debug?.(`[dsh-call-session] sessionTitle.rename fallback to session.append: ${err?.message || err}`);
          }
        }
        if (!titleAppended && targetSession && typeof targetSession.append === 'function') {
          try {
            await targetSession.append('session/title', {
              title: finalTitle,
              messageSeqs: [],
              source: { kind: 'user' }
            });
          } catch (err) {
            logger.debug?.(`[dsh-call-session] session.append session/title ignored: ${err?.message || err}`);
          }
        }
      }

      // 挂载工作区，确保在 Web GUI 归属当前工程
      const workspaceRegistry = resolveCordisService(this.ctx, 'workspaceRegistry');
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
          logger.warn?.(`[dsh-call-session] Failed to dispatch initial message to ${targetAgent?.id}: ${err?.message || err}`);
        }
      }

      const msg = resolveMessages(this.ctx, this.options?.config || options?.config);
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
        contextPostIds: cleanPostIds,
        message: msg.sessionCreateSuccess(targetAgent.id, finalTitle, status, targetGeneration)
      };
    } catch (err) {
      if (rateLimitTimestamp) {
        this.rollbackRateLimit(callerSessionId, rateLimitTimestamp);
      }
      throw err;
    } finally {
      inFlightTitles.delete(finalTitle.toLowerCase());
      if (inFlightTitles.size === 0) {
        inFlightCreationsByWorkspace.delete(callerWorkspace);
      }
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