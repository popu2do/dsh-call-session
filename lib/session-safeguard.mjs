/**
 * DSH Session Admission Safeguard Module
 *
 * Provides blast radius safeguards (workspace quota, rate limiting, generation cutoff,
 * in-flight concurrency control, and duplicate title avoidance) and atomic AdmissionLease.
 */

import { randomUUID } from 'node:crypto';
import { normalizeWorkspace } from './board-store.mjs';
import { SessionDirectory } from './session-directory.mjs';

export const SAFEGUARD_CONSTANTS = Object.freeze({
  MAX_ACTIVE_PEER_SESSIONS: 5,
  MAX_CONCURRENT_RUNNING_PEER_SESSIONS: 5,
  MAX_CREATIONS_PER_MINUTE: 5,
  MAX_GENERATION: 2,
  RATE_LIMIT_WINDOW_MS: 60000
});

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

/**
 * 原子准入租约 (AdmissionLease)
 * 持有准入预留并在会话创建成功后提交 (commit)，或在异常时回滚 (release)
 */
export class AdmissionLease {
  /**
   * @param {object} params
   * @param {SessionSafeguard} params.safeguard
   * @param {string} params.callerSessionId
   * @param {string} params.workspace
   * @param {string} params.title
   * @param {number} params.generation
   * @param {number|null} [params.timestamp]
   */
  constructor({ safeguard, callerSessionId, workspace, title, generation, timestamp, trackingKey }) {
    this.safeguard = safeguard;
    this.callerSessionId = callerSessionId;
    this.workspace = workspace;
    this.title = title;
    this.generation = generation;
    this.timestamp = timestamp ?? null;
    this.trackingKey = trackingKey || (title ? title.toLowerCase() : '');
    this.status = 'acquired';
  }

  /**
   * 提交租约：会话创建成功，释放在途登记，保留滑动窗口限频配额消耗
   */
  commit() {
    if (this.status !== 'acquired') {
      return this;
    }
    this.status = 'committed';
    if (this.safeguard) {
      this.safeguard._releaseInFlight(this.workspace, this.trackingKey);
    }
    return this;
  }

  /**
   * 回滚/释放租约：会话创建失败或取消，释放在途登记并返还限频配额
   */
  release() {
    if (this.status !== 'acquired') {
      return this;
    }
    this.status = 'released';
    if (this.safeguard) {
      this.safeguard._releaseInFlight(this.workspace, this.trackingKey);
      if (this.timestamp !== null && this.callerSessionId) {
        this.safeguard.rollbackRateLimit(this.callerSessionId, this.timestamp);
      }
    }
    return this;
  }

  /**
   * release 的安全别名
   */
  rollback() {
    return this.release();
  }
}

/**
 * 会话准入防护守卫 (SessionSafeguard)
 */
export class SessionSafeguard {
  /**
   * @param {object} [options]
   * @param {any} [options.ctx] Cordis 上下文
   * @param {number} [options.maxGeneration]
   * @param {number} [options.maxActivePeerSessions]
   * @param {number} [options.maxCreationsPerMinute]
   * @param {number} [options.windowMs]
   */
  constructor(options = {}) {
    this.ctx = options.ctx || null;
    this.maxGeneration = options.maxGeneration ?? SAFEGUARD_CONSTANTS.MAX_GENERATION;
    this.maxActivePeerSessions = options.maxActivePeerSessions ?? SAFEGUARD_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS;
    this.maxCreationsPerMinute = options.maxCreationsPerMinute ?? SAFEGUARD_CONSTANTS.MAX_CREATIONS_PER_MINUTE;
    this.windowMs = options.windowMs ?? SAFEGUARD_CONSTANTS.RATE_LIMIT_WINDOW_MS;

    this.rateLimits = new Map();
    this.inFlightByWorkspace = new Map();
    this.directory = new SessionDirectory(this.ctx);
  }

  /**
   * 重置内部状态
   */
  reset() {
    this.rateLimits.clear();
    this.inFlightByWorkspace.clear();
  }

  resetRateLimits() {
    this.rateLimits.clear();
  }

  resetInFlight() {
    this.inFlightByWorkspace.clear();
  }

  /**
   * 获取指定工作区当前在途会话数
   *
   * @param {string} workspace
   * @returns {number}
   */
  getInFlightCount(workspace) {
    const ws = workspace ? normalizeWorkspace(workspace) : '';
    const set = this.inFlightByWorkspace.get(ws);
    return set ? set.size : 0;
  }

  /**
   * 获取指定工作区在途小写标题集合
   *
   * @param {string} workspace
   * @returns {Set<string>}
   */
  getInFlightTitles(workspace) {
    const ws = workspace ? normalizeWorkspace(workspace) : '';
    const set = this.inFlightByWorkspace.get(ws);
    if (!set) return new Set();
    const result = new Set();
    for (const key of set) {
      if (!key.startsWith('__in_flight_')) {
        result.add(key);
      }
    }
    return result;
  }

  _getOrCreateInFlight(workspace) {
    const ws = workspace ? normalizeWorkspace(workspace) : '';
    let set = this.inFlightByWorkspace.get(ws);
    if (!set) {
      set = new Set();
      this.inFlightByWorkspace.set(ws, set);
    }
    return set;
  }

  _releaseInFlight(workspace, title) {
    const ws = workspace ? normalizeWorkspace(workspace) : '';
    const set = this.inFlightByWorkspace.get(ws);
    if (set && title) {
      set.delete(title.toLowerCase());
      if (set.size === 0) {
        this.inFlightByWorkspace.delete(ws);
      }
    }
  }

  /**
   * 代际深度熔断校验
   *
   * @param {number} callerGen
   * @returns {number} 目标代际
   */
  checkGeneration(callerGen) {
    const gen = typeof callerGen === 'number' ? callerGen : 0;
    if (gen >= this.maxGeneration) {
      throw new Error(
        `[GenerationLimitExceeded] Caller session generation depth is ${gen}, reaching limit ${this.maxGeneration}.`
      );
    }
    return gen + 1;
  }

  /**
   * 运行态配额校验（包含在途）
   *
   * @param {string} workspace
   * @param {number} activeCount
   */
  checkQuota(workspace, activeCount = 0) {
    const inFlight = this.getInFlightCount(workspace);
    const effective = (typeof activeCount === 'number' ? activeCount : 0) + inFlight;
    if (effective >= this.maxActivePeerSessions) {
      throw new Error(
        `[QuotaExceeded] Current workspace running peer sessions reached limit of ${this.maxActivePeerSessions}.`
      );
    }
  }

  /**
   * 标题冲突校验（包含活跃会话与在途会话）
   *
   * @param {string} workspace
   * @param {string} title
   * @param {Set<string>} [activeTitles]
   */
  checkTitle(workspace, title, activeTitles = new Set()) {
    if (!title || typeof title !== 'string') return;
    const lower = title.toLowerCase();
    const inFlight = this.getInFlightTitles(workspace);
    if (activeTitles.has(lower) || inFlight.has(lower)) {
      throw new Error(
        `[DuplicateTitle] Session title "${title}" conflicts with an active session in the workspace.`
      );
    }
  }

  _getRecentTimestamps(callerSessionId, now = Date.now()) {
    if (!callerSessionId) return [];
    const history = this.rateLimits.get(callerSessionId) || [];
    return history.filter(ts => now - ts < this.windowMs);
  }

  /**
   * 单会话滑动窗口限频校验与预留
   *
   * @param {string} callerSessionId
   * @param {number} [now]
   * @returns {number|null} 预留时间戳
   */
  checkRateLimit(callerSessionId, now = Date.now()) {
    if (!callerSessionId) return null;
    const recent = this._getRecentTimestamps(callerSessionId, now);
    if (recent.length >= this.maxCreationsPerMinute) {
      throw new Error(
        `[RateLimitExceeded] Session [${callerSessionId}] creation rate exceeded (limit: ${this.maxCreationsPerMinute}/min).`
      );
    }
    recent.push(now);
    this.rateLimits.set(callerSessionId, recent);
    return now;
  }

  /**
   * 回滚单会话创建频次配额
   *
   * @param {string} callerSessionId
   * @param {number} timestamp
   */
  rollbackRateLimit(callerSessionId, timestamp) {
    if (!callerSessionId || !timestamp) return;
    const history = this.rateLimits.get(callerSessionId);
    if (!Array.isArray(history)) return;
    const idx = history.indexOf(timestamp);
    if (idx !== -1) {
      history.splice(idx, 1);
    }
  }

  /**
   * 断言单会话限频未超限
   *
   * @param {string} callerSessionId
   * @param {number} [now]
   */
  assertRateLimit(callerSessionId, now = Date.now()) {
    if (!callerSessionId) return;
    const recent = this._getRecentTimestamps(callerSessionId, now);
    if (recent.length >= this.maxCreationsPerMinute) {
      throw new Error(
        `[RateLimitExceeded] Session [${callerSessionId}] creation rate exceeded (limit: ${this.maxCreationsPerMinute}/min).`
      );
    }
  }

  /**
   * 记录单会话创建时间戳
   *
   * @param {string} callerSessionId
   * @param {number} [now]
   * @returns {number|null}
   */
  recordRateLimit(callerSessionId, now = Date.now()) {
    if (!callerSessionId) return null;
    const recent = this._getRecentTimestamps(callerSessionId, now);
    recent.push(now);
    this.rateLimits.set(callerSessionId, recent);
    return now;
  }

  /**
   * 核心准入获取租约
   *
   * @param {object} params
   * @returns {AdmissionLease}
   */
  acquire(params = {}) {
    const callerAgent = params.callerAgent;
    const callerSessionId = params.callerSessionId
      || callerAgent?.id
      || 'root-session';

    const callerGen = params.callerGeneration
      ?? callerAgent?.session?.metadata?.generation
      ?? callerAgent?.generation
      ?? callerAgent?.session?.generation
      ?? 0;

    const rawWorkspace = params.workspace
      || params.callerWorkspace
      || callerAgent?.session?.cwd
      || callerAgent?.cwd
      || '';
    const normWorkspace = rawWorkspace ? normalizeWorkspace(rawWorkspace) : '';

    const title = params.title || params.targetTitle || '';
    const now = params.now ?? Date.now();

    // 1. 代际深度熔断校验
    const targetGeneration = this.checkGeneration(callerGen);

    // 2. 统计/解析活跃会话与标题
    let activeCount = params.activeCount;
    let activeTitles = params.activeTitles;

    if (activeCount === undefined || !activeTitles) {
      if (params.agentsService) {
        const inspected = this.directory.inspectWorkspace(normWorkspace, {
          agentsService: params.agentsService,
          archivedIds: params.archivedIds
        });
        if (activeCount === undefined) activeCount = inspected.count;
        if (!activeTitles) activeTitles = inspected.activeTitles;
      } else {
        if (activeCount === undefined) activeCount = 0;
        if (!activeTitles) activeTitles = new Set();
      }
    }

    // 3. 运行态配额校验（包含在途）
    this.checkQuota(normWorkspace, activeCount);

    // 4. 标题冲突校验（包含活跃和在途）
    if (title) {
      this.checkTitle(normWorkspace, title, activeTitles);
    }

    // 5. 滑动窗口限频预留
    const timestamp = this.checkRateLimit(callerSessionId, now);

    // 6. 在途并发登记（支持有标题与无标题两种形态的在途租约凭据）
    const trackingKey = title
      ? title.toLowerCase()
      : `__in_flight_${callerSessionId}_${timestamp || now}_${Math.random().toString(36).slice(2, 8)}`;

    const inFlightSet = this._getOrCreateInFlight(normWorkspace);
    inFlightSet.add(trackingKey);

    return new AdmissionLease({
      safeguard: this,
      callerSessionId,
      workspace: normWorkspace,
      title,
      generation: targetGeneration,
      timestamp,
      trackingKey
    });
  }

  /**
   * 业务级准入入口（别名/扩展）
   *
   * @param {object} params
   * @returns {AdmissionLease}
   */
  admit(params = {}) {
    return this.acquire(params);
  }
}

export const defaultSafeguard = new SessionSafeguard();

export function resetRateLimits() {
  defaultSafeguard.resetRateLimits();
}

export function resetInFlightCreations() {
  defaultSafeguard.resetInFlight();
}

export function checkRateLimit(callerSessionId, now = Date.now()) {
  return defaultSafeguard.checkRateLimit(callerSessionId, now);
}

export function rollbackRateLimit(callerSessionId, timestamp) {
  defaultSafeguard.rollbackRateLimit(callerSessionId, timestamp);
}

export function assertRateLimit(callerSessionId, now = Date.now()) {
  defaultSafeguard.assertRateLimit(callerSessionId, now);
}

export function recordRateLimit(callerSessionId, now = Date.now()) {
  return defaultSafeguard.recordRateLimit(callerSessionId, now);
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
