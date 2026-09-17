/**
 * DSH Session Directory Module
 *
 * Consolidated session discovery, identity resolution, lifecycle filtering,
 * and target matching across dsh-call-session.
 */

import { normalizeWorkspace } from './board-store.mjs';

const TARGET_WILDCARDS = Object.freeze(new Set(['*', 'all', 'broadcast']));

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
export function isHumanReadableTitle(title) {
  if (typeof title !== 'string') return false;
  return title.trim().length > 0;
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
 * 获取已被归档或废弃的 Session ID 集合
 *
 * @param {any} ctx Cordis 上下文
 * @returns {Set<string>}
 */
export function getArchivedSessionIds(ctx) {
  const registry = (typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined)
    || ctx?.workspaceRegistry
    || ctx?.root?.workspaceRegistry;
  const raw = registry?.archivedSessionIds || ctx?.archivedSessionIds || ctx?.archivedSessions;
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
    const status = agent?.status === 'running' ? 'running' : 'idle';
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
      if (topLevelOnly && (agent.origin === 'subagent' || agent.session?.header?.origin === 'subagent' || agent.blank)) continue;

      const rawStatus = agent.status;
      const status = rawStatus === 'running' ? 'running' : 'idle';
      if (runningOnly && status !== 'running') continue;

      const title = this.resolveTitle(agent);
      const cwd = this.resolveCwd(agent);
      const agentWorkspace = normalizeWorkspace(cwd);

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
        status: status === 'running' ? 'running' : 'idle',
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
      if (agent.origin === 'subagent' || agent.session?.header?.origin === 'subagent' || agent.blank) continue;

      const agentCwd = this.resolveCwd(agent);
      const agentWorkspace = normalizeWorkspace(agentCwd);

      if (normalizedCallerWorkspace && agentWorkspace && agentWorkspace !== normalizedCallerWorkspace) {
        continue;
      }

      const rawStatus = agent.status;
      const isRunning = rawStatus === 'running';
      if (isRunning) {
        count++;
      }
      const title = this.resolveTitle(agent);
      if (title) {
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
   * @returns {Promise<{
   *   targetAgent: any,
   *   targetTitle: string,
   *   targetShortId: string,
   *   targetWorkspace: string
   * }>}
   */
  async resolveTarget(rawTarget, options = {}) {
    if (!rawTarget || typeof rawTarget !== 'string') {
      throw new Error('session_call: 必须提供 target_session_id 参数。');
    }

    const targetTrimmed = rawTarget.trim();
    const targetLower = targetTrimmed.toLowerCase();

    // 1. 阻断通配符与广播伪装
    if (TARGET_WILDCARDS.has(targetLower) || targetLower.includes('*') || targetLower.includes('?') || targetLower === '@all' || targetLower === '@everyone') {
      throw new Error('session_call: 不支持通配符 *、all、broadcast，必须指定具体 Session ID。');
    }

    const callerAgent = options.callerAgent;
    const callerSessionId = options.callerSessionId || callerAgent?.id || 'unknown-caller';
    const callerLower = callerSessionId ? callerSessionId.toLowerCase() : '';

    const agents = this.getAgentsService(options.exec);
    const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
    const archivedIds = this.getArchivedSessionIds();

    const candidateAgents = liveAgents.filter(
      a => a && a.id && a.id.toLowerCase() !== callerLower && !archivedIds.has(a.id) && !archivedIds.has(a.id.toLowerCase())
    );

    // 2. 阻断自调用死循环
    if (callerLower) {
      if (targetLower === callerLower) {
        throw new Error('session_call: 不能调用自身 Session ID。');
      }
      if (targetLower.length >= 8 && callerLower.startsWith(targetLower)) {
        const hasOtherCandidate = candidateAgents.some(
          a => a && a.id && a.id.toLowerCase().startsWith(targetLower)
        );
        if (!hasOtherCandidate) {
          throw new Error('session_call: 不能调用自身 Session ID。');
        }
      }
    }

    let targetAgent = null;

    // 3. 精确匹配
    const exactMatches = candidateAgents.filter(a => a.id.toLowerCase() === targetLower);
    if (exactMatches.length === 1) {
      targetAgent = exactMatches[0];
    } else if (exactMatches.length > 1) {
      throw new Error(`session_call: 目标 Session ID "${rawTarget}" 存在多个匹配会话。`);
    } else {
      if (typeof agents?.get === 'function') {
        const direct = agents.get(rawTarget);
        if (direct && direct.id && direct.id.toLowerCase() !== callerLower && !archivedIds.has(direct.id) && !archivedIds.has(direct.id.toLowerCase())) {
          targetAgent = direct;
        }
      }

      // 4. 内存中未命中时尝试恢复持久化会话
      if (!targetAgent && typeof agents?.resume === 'function') {
        try {
          const handle = await agents.resume({ resumeSessionId: rawTarget });
          const direct = handle?.agent || (typeof agents?.get === 'function' ? agents.get(rawTarget) : null);
          if (direct && direct.id && direct.id.toLowerCase() !== callerLower && !archivedIds.has(direct.id) && !archivedIds.has(direct.id.toLowerCase())) {
            targetAgent = direct;
          }
        } catch (err) {
          this.logger.debug?.(`[SessionDirectory] Auto-resume for "${rawTarget}" failed: ${err?.message || err}`);
        }
      }

      // 5. 前缀匹配 (>= 8 位)
      if (!targetAgent) {
        if (targetLower.length < 8) {
          throw new Error(`session_call: 前缀 "${rawTarget}" 长度小于 8 位，必须提供至少 8 位前缀。`);
        }
        const prefixMatches = candidateAgents.filter(a => a.id.toLowerCase().startsWith(targetLower));
        if (prefixMatches.length === 1) {
          targetAgent = prefixMatches[0];
        } else if (prefixMatches.length >= 2) {
          const matchedIds = prefixMatches.map(a => a.id).join(', ');
          throw new Error(`session_call: 目标前缀 "${rawTarget}" 匹配到 ${prefixMatches.length} 个活跃会话 [${matchedIds}]。`);
        } else {
          throw new Error(`session_call: 未找到匹配 "${rawTarget}" 的活跃会话，该会话可能不存在或已被归档。`);
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
}