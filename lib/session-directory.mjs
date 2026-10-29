/**
 * DSH Session Directory Module
 *
 * Consolidated session discovery, identity resolution, lifecycle filtering,
 * and target matching across dsh-call-session.
 */

import { isSameWorkspace, normalizeWorkspace } from './workspace.mjs';
import { readHostService, readProperty } from './host-services.mjs';

const TARGET_WILDCARDS = Object.freeze(new Set(['*', 'all', 'broadcast']));

const SESSION_ID_PREFIX = 'session-';

/**
 * 剥离规范会话 ID 前缀
 *
 * 规范形式为 session-<uuid>，裸 uuid 与其指向同一会话，比较前统一口径。
 *
 * @param {string} idLower 小写会话 ID
 * @returns {string}
 */
function canonicalIdCore(idLower) {
  return idLower.startsWith(SESSION_ID_PREFIX) ? idLower.slice(SESSION_ID_PREFIX.length) : idLower;
}

/**
 * 归一化为持久层认可的规范 ID
 *
 * 持久层按规范形态建键，裸 uuid 补齐前缀后即为同一键。
 *
 * @param {string} id 去空白的会话 ID
 * @returns {string}
 */
function canonicalSessionId(id) {
  return id.toLowerCase().startsWith(SESSION_ID_PREFIX) ? id : `${SESSION_ID_PREFIX}${id}`;
}

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * 提取会话规范化 8 位短码
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
 * 判定标题是否为非空有效字符串
 *
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
/**
 * 判定标题是否为非空有效字符串
 *
 * @param {string | null | undefined} title
 * @returns {boolean}
 */
export function isHumanReadableTitle(title) {
  if (typeof title !== 'string') return false;
  return title.trim().length > 0;
}

/**
 * 提取并归一化会话错误结构
 *
 * @param {any} rawError 原始错误对象或字符串
 * @returns {{ category: string, code: string, message: string, details?: unknown }}
 */
export function classifyError(rawError) {
  if (!rawError) {
    return {
      category: 'RUNTIME',
      code: 'TURN_ERROR',
      message: 'Turn execution failed with error',
      details: null
    };
  }

  const msg = typeof rawError === 'object' && rawError !== null
    ? String(rawError.message || rawError.msg || '')
    : String(rawError);
  const rawCode = typeof rawError === 'object' && rawError !== null && rawError.code
    ? String(rawError.code)
    : '';
  const code = (rawCode === 'UNKNOWN' || rawCode === 'TURN_ERROR') ? '' : rawCode;

  if (
    /prompt variable|assembly|section "deployment:|template|renderPrompt|compilePrompt/i.test(msg) ||
    /ASSEMBLY/i.test(code)
  ) {
    return {
      category: 'ASSEMBLY',
      code: code || 'PROMPT_ASSEMBLY_ERROR',
      message: msg || 'Prompt template assembly failed',
      fatal: true,
      details: rawError
    };
  }

  if (/dispatch|followup|steer|send method/i.test(msg) || /DISPATCH/i.test(code)) {
    return {
      category: 'DISPATCH',
      code: code || 'DISPATCH_ERROR',
      message: msg || 'Dispatch method failed',
      fatal: true,
      details: rawError
    };
  }

  if (/PREFLIGHT|TARGET_IN_ERROR/i.test(code)) {
    return {
      category: 'PREFLIGHT',
      code: code || 'PREFLIGHT_TARGET_IN_ERROR',
      message: msg || 'Target session is in error state',
      fatal: true,
      details: rawError
    };
  }

  if (/TIMEOUT/i.test(code) || /timed out/i.test(msg)) {
    return {
      category: 'TIMEOUT',
      code: code || 'HANDSHAKE_TIMEOUT',
      message: msg || 'Handshake confirmation timed out',
      fatal: false,
      details: rawError
    };
  }

  return {
    category: 'RUNTIME',
    code: code || 'TURN_ERROR',
    message: msg || 'Turn execution failed with error',
    fatal: true,
    details: rawError
  };
}

function extractCausalCounters(targetAgent) {
  const events = typeof targetAgent?.session?.snapshotEvents === 'function'
    ? targetAgent.session.snapshotEvents()
    : (Array.isArray(targetAgent?.session?.events) ? targetAgent.session.events : []);
  const turn = typeof targetAgent?.phase?.turn === 'number' ? targetAgent.phase.turn : 0;
  const step = typeof targetAgent?.phase?.step === 'number' ? targetAgent.phase.step : 0;
  const stepStartCount = events.filter(e => e?.type === 'step/start').length;
  return { events, turn, step, stepStartCount };
}

/**
 * 校验目标会话是否达成物理执行因果确权
 *
 * @param {object} params
 * @returns {boolean}
 */
export function checkCausalRunning({
  statusRes,
  targetAgent,
  initialTargetRunning = false,
  initialStepCount = 0,
  initialStepStartCount = 0
} = {}) {
  if (statusRes?.status !== 'running') return false;
  if (!targetAgent?.phase) return true;

  const { step, stepStartCount } = extractCausalCounters(targetAgent);
  const isAdvancing = (step >= 1 && step > initialStepCount) || (stepStartCount > initialStepStartCount);
  return (!initialTargetRunning && step >= 1) || isAdvancing;
}

/**
 * 等待窗口期满时校验目标会话是否达成因果运行确权
 *
 * @param {object} params
 * @returns {boolean}
 */
export function checkCausalRunningFinal({
  finalCheck,
  targetAgent,
  initialTargetRunning = false,
  initialStepCount = 0,
  initialStepStartCount = 0,
  initialTurnCount = 0
} = {}) {
  if (finalCheck?.status !== 'running') return false;
  if (!targetAgent?.phase) return true;

  const { turn, step, stepStartCount } = extractCausalCounters(targetAgent);
  const isAdvancing = (step >= 1 && step > initialStepCount) ||
    (stepStartCount > initialStepStartCount) ||
    (turn > initialTurnCount);
  return (!initialTargetRunning && (step >= 1 || turn >= 1)) || isAdvancing;
}

/**
 * 基于 DSH 原生 phase 与 session.events 推导会话状态 (running | idle | error)
 *
 * 1. 若 agent.phase.kind 为 running 或 agent.status 为 running，判定为 running；
 * 2. 检查未捕获错误字段；
 * 3. 倒序扫描最新 turn/end 事件，若为 error 则分类返回；
 * 4. 正常结束则返回 idle；
 * 5. 无事件记录时返回 idle。
 *
 * @param {any} agent
 * @returns {{ status: 'running' | 'idle' | 'error', error: any | null }}
 */
export function resolveNativeSessionStatus(agent) {
  if (!agent) return { status: 'idle', error: null };

  try {
    if (agent.phase?.kind === 'running' || agent.status === 'running') {
      return { status: 'running', error: null };
    }

    const directError = agent.lastError || agent.session?.lastError || agent.error || agent.session?.error;
    if (directError && agent.status !== 'running' && agent.phase?.kind !== 'running') {
      return {
        status: 'error',
        error: classifyError(directError)
      };
    }

    const events = typeof agent.session?.snapshotEvents === 'function'
      ? agent.session.snapshotEvents()
      : (Array.isArray(agent.session?.events) ? agent.session.events : []);

    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev && typeof ev === 'object' && ev.type === 'turn/end') {
          const reason = ev.data?.reason || ev.payload?.reason;
          if (reason?.kind === 'error') {
            const rawError = reason.error;
            return {
              status: 'error',
              error: classifyError(rawError)
            };
          }
          // completed 或 aborted 等非 error 终态中断搜索
          break;
        }
      }
    }
  } catch {
    return { status: 'idle', error: null };
  }

  return { status: 'idle', error: null };
}

/**
 * 解析会话在看板上的展示标题
 *
 * @param {string} [rawTitle] 原始解析标题
 * @param {any} [agent] 会话实体对象
 * @param {string} [shortId] 规范化 8 位短码
 * @returns {string}
 */
export function resolveCanvasSessionDisplayTitle(rawTitle, agent, shortId) {
  const titleCandidates = [
    rawTitle,
    agent?.title,
    agent?.session?.header?.title,
    agent?.session?.title
  ];
  for (const c of titleCandidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }

  const sid = shortId || computeSessionShortId(agent?.id || agent?.session?.id);
  return `Agent ${sid}`;
}

/**
 * 解析宿主工作区注册表
 *
 * @param {any} ctx Cordis 上下文
 * @returns {any|undefined}
 */
export function resolveWorkspaceRegistry(ctx) {
  return readHostService(ctx, 'workspaceRegistry');
}

/**
 * 顶层会话判定：subagent 与空白会话都不是顶层。
 * 看板收窄、对等会话清单与调用记录落存共用此判据，避免各处口径分裂。
 * 身份缺失时按顶层处理，与看板 isTopLevel 缺省即顶层的语义一致。
 *
 * @param {{isSubagent?: boolean, blank?: boolean}} [idInfo] resolveIdentity 的结果
 * @returns {boolean}
 */
export function isTopLevelIdentity(idInfo) {
  return idInfo?.isSubagent !== true && idInfo?.blank !== true;
}

/**
 * 获取已被归档或废弃的 Session ID 集合
 *
 * @param {any} ctx Cordis 上下文
 * @returns {Set<string>}
 */
export function getArchivedSessionIds(ctx) {
  const registry = resolveWorkspaceRegistry(ctx);
  const raw = readProperty(registry, 'archivedSessionIds')
    || readProperty(ctx, 'archivedSessionIds')
    || readProperty(ctx, 'archivedSessions');
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
 * 判定目标路径是否为宿主已注册的工作区
 *
 * 返回 null 表示宿主未暴露注册表、无法判定，调用方据此失败关闭而非放行。
 *
 * @param {any} ctx Cordis 上下文
 * @param {string} workspacePath 目标工作区路径
 * @returns {boolean|null}
 */
export function isRegisteredWorkspace(ctx, workspacePath) {
  const registry = resolveWorkspaceRegistry(ctx);
  if (!registry || typeof registry.list !== 'function') return null;
  const target = normalizeWorkspace(workspacePath);
  if (!target) return false;

  const entries = registry.list();
  if (!Array.isArray(entries)) return null;
  return entries.some((entry) => isSameWorkspace(entry?.path, target));
}

/**
 * 解析 Agent 实例所在工程的工作目录 (cwd)
 *
 * @param {any} agent Agent 实例
 * @returns {string} 完整物理路径或空字符串
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
  const fromExec = readHostService(exec?.agent?.ctx, 'agents');
  if (fromExec) return fromExec;
  return readHostService(ctx, 'agents') || null;
}

/**
 * 会话目录管理核心类
 */
export class SessionDirectory {
  /**
   * @param {any} [ctx] Cordis 根上下文
   * @param {object} [options] 配置选项
   * @param {any} [options.logger] 日志服务
   */
  constructor(ctx = {}, options = {}) {
    this.ctx = ctx;
    this.logger = options.logger || (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : noopLogger);
  }

  /**
   * 解析 agents 服务实例
   * @param {any} [exec]
   * @returns {any}
   */
  getAgentsService(exec) {
    return resolveAgentsService(this.ctx, exec);
  }

  /**
   * 获取已归档会话 ID 集合
   * @returns {Set<string>}
   */
  getArchivedSessionIds() {
    return getArchivedSessionIds(this.ctx);
  }

  /**
   * 判定目标路径是否为宿主已注册的工作区
   * @param {string} workspacePath
   * @returns {boolean|null} null 表示宿主未暴露注册表
   */
  isRegisteredWorkspace(workspacePath) {
    return isRegisteredWorkspace(this.ctx, workspacePath);
  }

  /**
   * 解析 Agent 的工作目录 (cwd)
   * @param {any} agent
   * @returns {string}
   */
  resolveCwd(agent) {
    return resolveSessionCwd(agent);
  }

  /**
   * 解析并规范化 Agent 的工程工作区路径
   * @param {any} agent
   * @returns {string}
   */
  resolveWorkspace(agent) {
    return normalizeWorkspace(this.resolveCwd(agent));
  }

  /**
   * 解析 Agent 的可读标题
   * @param {any} agent
   * @returns {string}
   */
  resolveTitle(agent) {
    return resolveSessionTitle(this.ctx, agent);
  }

  /**
   * 提取会话规范化 8 位短码
   * @param {any} agentOrId
   * @returns {string}
   */
  resolveShortId(agentOrId) {
    if (typeof agentOrId === 'string') {
      return computeSessionShortId(agentOrId);
    }
    return computeSessionShortId(agentOrId?.id || agentOrId?.session?.id);
  }

  /**
   * 解析看板展示标题
   * @param {any} agent
   * @param {string} [rawTitle]
   * @returns {string}
   */
  resolveDisplayTitle(agent, rawTitle) {
    const title = rawTitle !== undefined ? rawTitle : this.resolveTitle(agent);
    const shortId = this.resolveShortId(agent);
    return resolveCanvasSessionDisplayTitle(title, agent, shortId);
  }

  /**
   * 完整解析一个 Agent 的身份元数据快照
   * @param {any} agent
   * @returns {{
   *   sessionId: string,
   *   title: string,
   *   displayTitle: string,
   *   shortId: string,
   *   cwd: string,
   *   workspace: string,
   *   status: 'running' | 'idle',
   *   origin: string,
   *   isSubagent: boolean,
   *   blank: boolean
   * }}
   */
  resolveIdentity(agent) {
    const sessionId = String(agent?.id || agent?.session?.id || '');
    const title = this.resolveTitle(agent);
    const shortId = this.resolveShortId(agent);
    const displayTitle = resolveCanvasSessionDisplayTitle(title, agent, shortId);
    const cwd = this.resolveCwd(agent);
    const workspace = normalizeWorkspace(cwd);
    const statusResult = resolveNativeSessionStatus(agent);
    const status = statusResult.status;
    const origin = agent?.origin || agent?.session?.header?.origin || '';
    const isSubagent = origin === 'subagent';
    const blank = Boolean(agent?.blank);

    return {
      sessionId,
      title,
      displayTitle,
      shortId,
      cwd,
      workspace,
      status,
      error: statusResult.error,
      origin,
      isSubagent,
      blank
    };
  }

  /**
   * 列表查询活跃会话
   *
   * @param {object} [options]
   * @param {string} [options.workspace] 当前工作区过滤
   * @param {boolean} [options.crossWorkspace=false] 是否跨工作区
   * @param {boolean} [options.topLevelOnly=true] 是否仅查顶层会话
   * @param {boolean} [options.runningOnly=false] 是否仅查运行中会话
   * @param {string} [options.query=''] 关键词过滤
   * @param {number} [options.limit=50] 最大返回数量
   * @param {string} [options.callerSessionId] 调用方会话 ID (用于标记 isCurrent)
   * @param {any} [options.exec] 工具执行上下文
   * @returns {Array<{
   *   sessionId: string,
   *   title: string,
   *   status: 'running' | 'idle',
   *   workspace: string,
   *   cwd: string,
   *   isCurrent: boolean
   * }>}
   */
  listActiveSessions(options = {}) {
    const {
      workspace: callerWorkspace,
      crossWorkspace = false,
      topLevelOnly = true,
      runningOnly = false,
      query = '',
      limit = 50,
      callerSessionId = null,
      exec = null
    } = options;

    const queryStr = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const effectiveLimit = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 50;

    const agents = this.getAgentsService(exec);
    const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
    const archivedIds = this.getArchivedSessionIds();

    const normalizedCallerWorkspace = callerWorkspace ? normalizeWorkspace(callerWorkspace) : '';
    const results = [];

    for (const agent of liveAgents) {
      if (!agent || !agent.id) continue;
      const sessionId = String(agent.id);

      if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) continue;
      const idInfo = this.resolveIdentity(agent);
      if (topLevelOnly && !isTopLevelIdentity(idInfo)) continue;

      const status = idInfo.status;
      if (runningOnly && status !== 'running') continue;

      const title = idInfo.title;
      const agentWorkspace = idInfo.workspace;

      if (!crossWorkspace && normalizedCallerWorkspace && agentWorkspace && agentWorkspace !== normalizedCallerWorkspace) {
        continue;
      }

      if (queryStr) {
        const lowerId = sessionId.toLowerCase();
        const lowerTitle = title.toLowerCase();
        const matchId = lowerId.startsWith(queryStr) || lowerId.includes(queryStr);
        const matchTitle = lowerTitle.includes(queryStr);
        if (!matchId && !matchTitle) continue;
      }

      const isCurrent = Boolean(
        callerSessionId && (sessionId === callerSessionId || sessionId.toLowerCase() === String(callerSessionId).toLowerCase())
      );
      const normWs = String(agentWorkspace || '');

      results.push({
        sessionId,
        title: String(title || ''),
        status,
        ...(idInfo.error ? { error: idInfo.error } : {}),
        workspace: normWs,
        cwd: normWs,
        isCurrent
      });

      if (results.length >= effectiveLimit) {
        break;
      }
    }

    return results;
  }

  /**
   * 检查并统计当前工作区内的活跃根会话数与收集已有标题
   *
   * @param {string} callerWorkspace
   * @param {any} [exec]
   * @returns {{ count: number, activeTitles: Set<string> }}
   */
  inspectWorkspace(callerWorkspace, options = {}) {
    const normalizedCallerWorkspace = callerWorkspace ? normalizeWorkspace(callerWorkspace) : '';
    const opts = options && typeof options === 'object' ? options : {};
    const agents = opts.agentsService || (typeof options?.list === 'function' ? options : this.getAgentsService(opts.exec || options));
    const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
    const archivedIds = opts.archivedIds instanceof Set ? opts.archivedIds : (Array.isArray(opts.archivedIds) ? new Set(opts.archivedIds) : this.getArchivedSessionIds());

    let count = 0;
    const activeTitles = new Set();

    for (const agent of liveAgents) {
      if (!agent || !agent.id) continue;
      const sessionId = agent.id;
      if (archivedIds.has(sessionId) || archivedIds.has(sessionId.toLowerCase())) continue;
      const idInfo = this.resolveIdentity(agent);
      if (!isTopLevelIdentity(idInfo)) continue;

      const agentWorkspace = idInfo.workspace;

      if (normalizedCallerWorkspace && agentWorkspace && agentWorkspace !== normalizedCallerWorkspace) {
        continue;
      }

      const rawStatus = agent.status;
      const isRunning = rawStatus === 'running';
      if (isRunning) {
        count++;
      }
      const agentEvents = typeof agent.session?.snapshotEvents === 'function'
        ? agent.session.snapshotEvents()
        : (Array.isArray(agent.session?.events) ? agent.session.events : []);
      const hasEffectiveSteps = agentEvents.some(e => e?.type === 'step/start');
      const isZombieCrashed = idInfo.status === 'error' && !hasEffectiveSteps;
      const title = idInfo.title;
      if (title && !isZombieCrashed) {
        activeTitles.add(title.toLowerCase());
      }
    }

    return { count, activeTitles };
  }

  /**
   * 解析单播调用的目标会话
   *
   * @param {string} rawTarget 目标 ID 或前缀
   * @param {object} [options]
   * @param {string} [options.callerSessionId]
   * @param {any} [options.callerAgent]
   * @param {any} [options.exec]
   * @param {Function} [options.resolveResumeAgentOptions] 冷恢复时解析 agentOptions 的注入解析器，可返回 undefined
   * @returns {Promise<{
   *   targetAgent: any,
   *   targetTitle: string,
   *   targetShortId: string,
   *   targetWorkspace: string
   * }>}
   */
  async resolveTarget(rawTarget, options = {}) {
    if (!rawTarget || typeof rawTarget !== 'string') {
      throw new Error('[InvalidParameter] session_call: target_session_id is required.');
    }

    const targetTrimmed = rawTarget.trim();
    const targetLower = targetTrimmed.toLowerCase();

    // 1. 阻断通配符与广播伪装
    if (TARGET_WILDCARDS.has(targetLower) || targetLower.includes('*') || targetLower.includes('?') || targetLower === '@all' || targetLower === '@everyone') {
      throw new Error('[WildcardForbidden] session_call: wildcard targets (*, all, broadcast) are forbidden; an explicit session ID must be provided.');
    }

    const targetCore = canonicalIdCore(targetLower);

    const callerAgent = options.callerAgent;
    const callerSessionId = options.callerSessionId || callerAgent?.id || 'unknown-caller';
    const callerLower = callerSessionId ? callerSessionId.toLowerCase() : '';

    const agents = this.getAgentsService(options.exec);
    const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
    const archivedIds = this.getArchivedSessionIds();

    const isCallable = agent => Boolean(agent?.id)
      && agent.id.toLowerCase() !== callerLower
      && !archivedIds.has(agent.id)
      && !archivedIds.has(agent.id.toLowerCase());

    const candidateAgents = liveAgents.filter(isCallable);

    // 2. 阻断自调用死循环
    if (callerLower) {
      const callerCore = canonicalIdCore(callerLower);
      const isDirectSelf = targetCore === callerCore;
      const isPrefixSelf = targetLower.length >= 8 &&
        callerCore.startsWith(targetCore) &&
        !candidateAgents.some(a => a && a.id && canonicalIdCore(a.id.toLowerCase()).startsWith(targetCore));
      if (isDirectSelf || isPrefixSelf) {
        throw new Error('[SelfCallForbidden] session_call: cannot call self session ID.');
      }
    }

    let targetAgent = null;

    // 3. 精确匹配
    const exactMatches = candidateAgents.filter(a => canonicalIdCore(a.id.toLowerCase()) === targetCore);
    if (exactMatches.length === 1) {
      targetAgent = exactMatches[0];
    } else if (exactMatches.length > 1) {
      const matchedIds = exactMatches.map(a => a.id).join(', ');
      throw new Error(`[AmbiguousPrefix] session_call: multiple sessions match target ID "${rawTarget}" [${matchedIds}].`);
    } else {
      const persistenceId = canonicalSessionId(targetTrimmed);

      if (typeof agents?.get === 'function') {
        const direct = agents.get(persistenceId);
        if (isCallable(direct)) {
          targetAgent = direct;
        }
      }

      // 4. 内存中未命中时尝试恢复持久化会话
      if (!targetAgent && typeof agents?.resume === 'function') {
        const resumeOptions = { resumeSessionId: persistenceId };

        // 模型解析由调用方注入：dsh-host-gateway 反向依赖本模块，静态导入会成环，
        // 注入则让 session-directory 保持对模型解析无感知，且降级路径可测
        if (typeof options.resolveResumeAgentOptions === 'function') {
          try {
            const agentOptions = options.resolveResumeAgentOptions();
            if (agentOptions) resumeOptions.agentOptions = agentOptions;
          } catch (err) {
            this.logger.debug?.(`[SessionDirectory] Resolve agent options for "${rawTarget}" failed: ${err?.message || err}`);
          }
        }

        try {
          const handle = await agents.resume(resumeOptions);
          const direct = handle?.agent || (typeof agents?.get === 'function' ? agents.get(persistenceId) : null);
          if (isCallable(direct)) {
            targetAgent = direct;
          }
        } catch (err) {
          this.logger.debug?.(`[SessionDirectory] Auto-resume for "${rawTarget}" failed: ${err?.message || err}`);
        }
      }

      // 5. 前缀匹配 (>= 8 位)
      if (!targetAgent) {
        if (targetLower.length < 8) {
          throw new Error(`[InvalidParameter] session_call: prefix "${rawTarget}" must be at least 8 characters.`);
        }
        const prefixMatches = candidateAgents.filter(a => canonicalIdCore(a.id.toLowerCase()).startsWith(targetCore));
        if (prefixMatches.length === 1) {
          targetAgent = prefixMatches[0];
        } else if (prefixMatches.length >= 2) {
          const matchedIds = prefixMatches.map(a => a.id).join(', ');
          throw new Error(`[AmbiguousPrefix] session_call: prefix "${rawTarget}" matches multiple active sessions [${matchedIds}].`);
        } else {
          throw new Error(`[TargetNotFound] session_call: active session matching "${rawTarget}" not found or archived.`);
        }
      }
    }

    const targetShortId = this.resolveShortId(targetAgent);
    const rawTargetTitle = this.resolveTitle(targetAgent);
    const targetTitle = resolveCanvasSessionDisplayTitle(rawTargetTitle, targetAgent, targetShortId);
    const targetWorkspace = this.resolveWorkspace(targetAgent);

    return {
      targetAgent,
      targetTitle,
      targetShortId,
      targetWorkspace
    };
  }

  /**
   * 执行会话查询、工作区过滤与状态汇总
   *
   * @param {import('../types/session-query.js').SessionQueryArgs} [args] session_query 入参
   * @param {any} [exec] 工具执行上下文
   * @returns {import('../types/session-query.js').SessionQueryResult}
   */
  query(args = {}, exec = {}) {
    const queryStr = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
    const topLevelOnly = args?.top_level_only !== false;
    const runningOnly = args?.running_only === true;
    const crossWorkspace = args?.cross_workspace === true;
    const limit = typeof args?.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 50;

    const callerAgent = exec?.agent;
    const callerSessionId = callerAgent?.id || exec?.sessionId || null;
    const callerWorkspace = callerAgent
      ? (this.resolveWorkspace(callerAgent) || normalizeWorkspace(process.cwd()))
      : normalizeWorkspace(process.cwd());

    const results = this.listActiveSessions({
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
    const errorCount = results.filter(s => s.status === 'error').length;

    return {
      success: true,
      count: results.length,
      totalCount: results.length,
      activeCount,
      idleCount,
      errorCount,
      scope: crossWorkspace ? 'global' : (callerWorkspace || 'unknown'),
      sessions: results
    };
  }
}

/**
 * 顶层导出：执行会话查询、工作区过滤与状态汇总
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
  const directory = new SessionDirectory(ctx);
  return directory.query(args, exec);
}