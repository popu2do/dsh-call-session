/**
 * DSH Host Gateway Module
 *
 * Encapsulates Cordis host service discovery, root agent creation,
 * model option inheritance/overrides, preset resolution, title event persistence,
 * and workspace attachment safeguards.
 */

import { normalizeWorkspace } from './board-store.mjs';
import { resolveAgentsService } from './session-directory.mjs';

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * 解析日志服务实例
 *
 * @param {any} [ctx] Cordis 根上下文
 * @param {object} [options]
 * @returns {any}
 */
function resolveLogger(ctx, options = {}) {
  return (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
    || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
    || (options.logger || noopLogger);
}

/**
 * 解析 Cordis 宿主服务实例（多层回退探测）
 *
 * @param {any} ctx Cordis 上下文
 * @param {string} name 服务名称
 * @returns {any}
 */
export function resolveCordisService(ctx, name) {
  if (!ctx || !name) return undefined;
  if (typeof ctx.get === 'function') {
    try {
      const svc = ctx.get(name, false);
      if (svc) return svc;
    } catch {}
  }
  if (ctx.root && typeof ctx.root.get === 'function') {
    try {
      const svc = ctx.root.get(name, false);
      if (svc) return svc;
    } catch {}
  }
  try {
    if (ctx[name]) return ctx[name];
  } catch {}
  try {
    if (ctx.root && ctx.root[name]) return ctx.root[name];
  } catch {}
  return undefined;
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
 * 解析宿主兜底模型配置 (ctx.agentDefaultModel)
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
        logger.debug?.(`[dsh-host-gateway] defaultModelService.currentSelection failed: ${err?.message || err}`);
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
  const session = callerAgent.session;
  const requestConfig = typeof session?.requestHeader === 'function'
    ? (session.requestHeader() || {}).config
    : undefined;
  if (requestConfig) {
    if (requestConfig.provider) base.provider = requestConfig.provider;
    if (requestConfig.model) base.model = requestConfig.model;
    if (requestConfig.reasoningEffort !== undefined) base.reasoningEffort = requestConfig.reasoningEffort;
  }
  return base;
}

/**
 * 解析同级会话的目标有效模型选项：
 * 继承 callerAgent.options -> 回退 ctx.agentDefaultModel -> 支持 args.model 覆写与 provider 解析
 *
 * @param {object} [params]
 * @param {any} [params.ctx] Cordis 上下文
 * @param {any} [params.callerAgent] 调用方 Agent
 * @param {string} [params.model] 覆写的模型规格 (支持 'provider/model', 'provider:model' 或纯 'model')
 * @param {string} [params.reasoningEffort] 可选覆写的推理强度
 * @returns {Record<string, any>}
 */
export function resolveEffectiveModel({ ctx, callerAgent, model, reasoningEffort } = {}) {
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

/** 向后兼容别名 */
export const resolvePeerAgentOptions = resolveEffectiveModel;

/**
 * 解析会话预设 (preset) 与 setup 组合钩子
 *
 * @param {object} [params]
 * @param {any} [params.ctx] Cordis 上下文
 * @param {any} [params.callerAgent] 调用方 Agent
 * @param {any} [params.args] 工具入参
 * @param {any} [params.options] 扩展选项
 * @param {any} [params.logger] 日志服务
 * @returns {Promise<{ presetId?: string, setup?: (agentCtx: any) => Promise<void> | void }>}
 */
export async function resolvePresetSetup({ ctx, callerAgent, args = {}, options = {}, logger = noopLogger } = {}) {
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
      logger.debug?.(`[dsh-host-gateway] sessionController.agents.composeAgent failed: ${err?.message || err}`);
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
        logger.debug?.(`[dsh-host-gateway] agentPresets.resolve failed: ${err?.message || err}`);
      }
    }

    setupFn = async (agentCtx) => {
      if (sessionController?.agents && typeof sessionController.agents.installSelection === 'function') {
        try {
          sessionController.agents.installSelection(agentCtx);
        } catch (err) {
          logger.debug?.(`[dsh-host-gateway] sessionController.agents.installSelection failed: ${err?.message || err}`);
        }
      }
      if (typeof agentPresets.mount === 'function') {
        try {
          await agentPresets.mount(agentCtx, resolvedPresetId);
        } catch (err) {
          logger.debug?.(`[dsh-host-gateway] agentPresets.mount failed: ${err?.message || err}`);
        }
      } else if (typeof agentPresets.composeFrom === 'function' && callerAgent?.ctx) {
        try {
          agentPresets.composeFrom(agentCtx, callerAgent.ctx);
        } catch (err) {
          logger.debug?.(`[dsh-host-gateway] agentPresets.composeFrom failed: ${err?.message || err}`);
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

/** 向后兼容别名 */
export const resolvePeerPresetAndSetup = resolvePresetSetup;

/**
 * 根智能体创建与元数据防御性隔离
 *
 * @param {any} gatewayOrCtx
 * @param {object} [params]
 * @returns {Promise<any>}
 */
export async function createRootAgent(gatewayOrCtx, params) {
  if (gatewayOrCtx instanceof DshHostGateway) {
    return gatewayOrCtx.createRootAgent(params);
  }
  if (!params && gatewayOrCtx && (gatewayOrCtx.sessionId || gatewayOrCtx.agentsService)) {
    const gw = new DshHostGateway(gatewayOrCtx.ctx);
    return gw.createRootAgent(gatewayOrCtx);
  }
  const gw = new DshHostGateway(gatewayOrCtx);
  return gw.createRootAgent(params);
}

/**
 * 标题持久化事件流分发 (ADR-0017)
 *
 * @param {any} gatewayOrCtx
 * @param {any} targetAgent
 * @param {string} title
 * @returns {Promise<boolean>}
 */
export async function appendTitleEvent(gatewayOrCtx, targetAgent, title) {
  if (gatewayOrCtx instanceof DshHostGateway) {
    return gatewayOrCtx.appendTitleEvent(targetAgent, title);
  }
  const gw = new DshHostGateway(gatewayOrCtx);
  return gw.appendTitleEvent(targetAgent, title);
}

/**
 * 工作区归属挂载
 *
 * @param {any} gatewayOrCtx
 * @param {string} sessionId
 * @param {string} workspacePath
 * @returns {Promise<boolean>}
 */
export async function attachWorkspace(gatewayOrCtx, sessionId, workspacePath) {
  if (gatewayOrCtx instanceof DshHostGateway) {
    return gatewayOrCtx.attachWorkspace(sessionId, workspacePath);
  }
  const gw = new DshHostGateway(gatewayOrCtx);
  return gw.attachWorkspace(sessionId, workspacePath);
}

/**
 * DshHostGateway 宿主网关
 *
 * 统一封装与 Cordis 宿主体系交互的探测、适配与防御隔离逻辑：
 * 1. 宿主服务探测 (agents, agentDefaultModel, sessionController, agentPresets, sessionTitle, workspaceRegistry)
 * 2. 模型选项解析 (resolveEffectiveModel)
 * 3. 预设配置解析与 setup 组合 (resolvePresetSetup)
 * 4. 根智能体创建与元数据隔离 (createRootAgent)
 * 5. 标题持久化事件分发 (appendTitleEvent)
 * 6. 工作区挂载 (attachWorkspace)
 */
export class DshHostGateway {
  /**
   * @param {any} [ctx] Cordis 根上下文
   * @param {object} [options] 配置选项
   * @param {any} [options.logger] 日志服务
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = options || {};
    this.logger = resolveLogger(ctx, this.options);
  }

  /**
   * 探测 Cordis 宿主服务
   *
   * @param {string} name 服务标识
   * @returns {any}
   */
  resolveService(name) {
    return resolveCordisService(this.ctx, name);
  }

  /**
   * 解析根级 Agents 服务
   *
   * @param {any} [exec]
   * @returns {any}
   */
  resolveRootAgentsService(exec) {
    return resolveRootAgentsService(this.ctx, exec);
  }

  /**
   * 解析目标有效模型配置
   *
   * @param {object} [params]
   * @returns {Record<string, any>}
   */
  resolveEffectiveModel(params = {}) {
    return resolveEffectiveModel({ ctx: this.ctx, ...params });
  }

  /**
   * 解析预设与 setup 组合
   *
   * @param {object} [params]
   * @returns {Promise<{ presetId?: string, setup?: Function }>}
   */
  async resolvePresetSetup(params = {}) {
    return resolvePresetSetup({ ctx: this.ctx, logger: this.logger, ...params });
  }

  /**
   * 创建受控平级根智能体
   *
   * @param {object} params
   * @returns {Promise<any>}
   */
  async createRootAgent(params = {}) {
    const {
      sessionId,
      title,
      cwd,
      generation = 1,
      creatorSessionId,
      agentOptions = {},
      presetId,
      setup,
      agentsService: explicitAgentsService,
      exec
    } = params;

    const agentsService = explicitAgentsService || this.resolveRootAgentsService(exec);
    if (!agentsService || typeof agentsService.create !== 'function') {
      throw new Error('[ServiceUnavailable] session_create: agents.create service is unavailable.');
    }

    // 构造 meta，不向底层传递非 'subagent' 的 origin，彻底清洗 parentSession
    const cleanMeta = {
      cwd,
      title,
      generation,
      creatorSessionId,
      ...(presetId ? { agentPreset: presetId } : {})
    };
    delete cleanMeta.origin;
    delete cleanMeta.parentSession;

    const createPayload = {
      sessionId,
      agentOptions,
      title,
      cwd,
      meta: cleanMeta,
      ...(setup ? { setup } : {})
    };

    this.logger.debug?.(`[dsh-host-gateway] Creating root agent [${sessionId}] "${title}" (Gen ${generation})...`);
    const handleOrAgent = await agentsService.create(createPayload);
    const targetAgent = handleOrAgent?.agent || handleOrAgent;

    if (targetAgent) {
      if (!targetAgent.id) targetAgent.id = sessionId;
      targetAgent.title = title;
      targetAgent.generation = generation;
      if (!targetAgent.options || Object.keys(targetAgent.options).length === 0) {
        targetAgent.options = agentOptions;
      }
      if (targetAgent.session) {
        targetAgent.session.title = title;
        // 宿主 SessionHeader 为 deepFreeze 冻结对象，做防御性检查避免严格模式下抛出 TypeError
        if (targetAgent.session.header && !Object.isFrozen(targetAgent.session.header)) {
          if (cwd) targetAgent.session.header.cwd = cwd;
          if (title) targetAgent.session.header.title = title;
          if (presetId) {
            targetAgent.session.header.agentPreset = presetId;
          }
        }
        // 协作溯源元数据挂载至 session.metadata，与底层 session.header 隔离
        targetAgent.session.metadata = {
          ...(targetAgent.session.metadata || {}),
          generation,
          creatorSessionId,
          origin: 'peer_created',
          ...(presetId ? { agentPreset: presetId } : {})
        };
      }
    }

    return targetAgent;
  }

  /**
   * 写入 session/title 日志事件，确保标题在 Web GUI 和投影服务中即时持久化呈现 (ADR-0017)
   *
   * @param {any} targetAgent
   * @param {string} title
   * @returns {Promise<boolean>}
   */
  async appendTitleEvent(targetAgent, title) {
    if (!targetAgent || !title) return false;
    const targetSession = targetAgent.session || targetAgent;
    let titleAppended = false;

    const sessionTitleService = this.resolveService('sessionTitle');
    if (sessionTitleService && typeof sessionTitleService.rename === 'function') {
      try {
        await sessionTitleService.rename(targetSession, title);
        titleAppended = true;
      } catch (err) {
        this.logger.debug?.(`[dsh-host-gateway] sessionTitle.rename fallback to session.append: ${err?.message || err}`);
      }
    }

    if (!titleAppended && targetSession && typeof targetSession.append === 'function') {
      try {
        await targetSession.append('session/title', {
          title,
          messageSeqs: [],
          source: { kind: 'user' }
        });
        titleAppended = true;
      } catch (err) {
        this.logger.debug?.(`[dsh-host-gateway] session.append session/title ignored: ${err?.message || err}`);
      }
    }

    return titleAppended;
  }

  /**
   * 挂载工作区，确保在 Web GUI 归属当前工程
   *
   * @param {string} sessionId 会话标识
   * @param {string} workspacePath 工作区目录
   * @returns {Promise<boolean>}
   */
  async attachWorkspace(sessionId, workspacePath) {
    if (!sessionId || !workspacePath) return false;
    const normalizedTarget = normalizeWorkspace(workspacePath);
    const workspaceRegistry = this.resolveService('workspaceRegistry');

    if (workspaceRegistry) {
      const wsList = typeof workspaceRegistry.list === 'function' ? workspaceRegistry.list() : [];
      const matchedWs = wsList.find(w => normalizeWorkspace(w.path) === normalizedTarget);
      if (matchedWs && typeof matchedWs.attachSession === 'function') {
        try {
          await matchedWs.attachSession(sessionId);
          return true;
        } catch (err) {
          this.logger.debug?.(`[dsh-host-gateway] attachSession to workspace [${matchedWs.id || matchedWs.path}] ignored: ${err?.message || err}`);
        }
      }
    }

    return false;
  }
}
