/**
 * DSH Board Tools Adapter Module
 *
 * Adapts pure BoardStore storage engine to Cordis tools, execution contexts,
 * topic filtering, author session resolution, and i18n message formatting.
 */

import { SessionDirectory } from './session-directory.mjs';
import { resolveLocale, getCatalog, resolveMessages } from './locales/index.mjs';
import { normalizeWorkspace } from './workspace.mjs';

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

export const RESERVED_TOPIC_PREFIXES = Object.freeze(['telemetry:', 'call:', 'sys:']);

/**
 * 校验主题是否属于保留主题或看板数据域。
 * 遵循 ADR-0001 与 ADR-0012：调用轨迹严格属于纯内存看板数据域，严禁作为持久化黑板条目发布。
 *
 * @param {string | null | undefined} topic
 * @returns {boolean}
 */
export function isReservedTopic(topic) {
  if (!topic || typeof topic !== 'string') return false;
  const t = topic.trim().toLowerCase();
  for (const prefix of RESERVED_TOPIC_PREFIXES) {
    if (t.startsWith(prefix)) return true;
  }
  if (t === 'telemetry' || t === 'call' || t === 'sys') return true;
  if (t === 'task:telemetry' || t.startsWith('task:telemetry:') || t.endsWith(':telemetry') || t.endsWith(':call')) {
    return true;
  }
  return false;
}

/**
 * 获取保留主题拦截错误描述文本。
 *
 * @param {string} topic
 * @returns {string}
 */
export function getReservedTopicErrorMessage(topic) {
  return `[ReservedTopic] Topic "${topic}" is reserved for in-memory telemetry (ADR-0012) and cannot be stored on public blackboard.`;
}

/**
 * 将作者的未清理活跃条目格式化为纯状态幂等的记名提醒文本。
 * 不包含动态时间戳，避免影响大模型缓存。
 *
 * @param {import('../types/board-store.js').BoardPost[]} posts 活跃条目列表
 * @param {string} [locale] 目标语言代码
 * @returns {string} 提醒文本，无未清理条目时返回空字符串 ''
 */
export function formatAuthorReminderText(posts, locale) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return '';
  }
  const effectiveLocale = locale || resolveLocale();
  const catalog = getCatalog(effectiveLocale);
  return catalog.prompts.authorReminder(posts);
}

/**
 * 规范化 executePost/List/Clear 等方法的参数传入形式
 * 支持对象包装 `{ args, exec, ctx }` 与传统位置参数 `(args, exec, ctx)`
 *
 * @param {object} [argsOrParams={}]
 * @param {any} [maybeExec]
 * @param {any} [maybeCtx]
 * @returns {{ args: any, exec: any, ctx: any }}
 */
export function normalizeExecParams(argsOrParams = {}, maybeExec, maybeCtx) {
  if (argsOrParams && typeof argsOrParams === 'object' && Object.prototype.hasOwnProperty.call(argsOrParams, 'args')) {
    return {
      args: argsOrParams.args !== undefined ? argsOrParams.args : {},
      exec: argsOrParams.exec,
      ctx: argsOrParams.ctx
    };
  }
  return {
    args: argsOrParams !== undefined && argsOrParams !== null ? argsOrParams : {},
    exec: maybeExec,
    ctx: maybeCtx
  };
}

/**
 * 公共黑板工具适配层：负责与 Cordis 工具调用、执行上下文及 i18n 消息进行适配
 */
export class BoardToolsAdapter {
  /**
   * @param {any} store 存储引擎实例
   * @param {object} [options]
   * @param {any} [options.ctx] Cordis 上下文
   * @param {any} [options.config] 插件配置
   * @param {any} [options.logger] 日志记录器
   */
  constructor(store, options = {}) {
    this.store = store;
    this.ctx = options.ctx || store?.ctx || null;
    this.config = options.config || store?.config || null;
    this.logger = options.logger || store?.logger || noopLogger;
  }

  /**
   * 获取多语言文案字典
   *
   * @param {any} [ctx]
   * @returns {import('./locales/index.mjs').MessageCatalog}
   */
  getMessages(ctx) {
    return resolveMessages(ctx || this.ctx, this.config);
  }

  /**
   * 校验主题合法性，保留主题抛出拦截异常
   *
   * @param {string} topic
   */
  validateTopic(topic) {
    if (isReservedTopic(topic)) {
      throw new Error(getReservedTopicErrorMessage(topic));
    }
  }

  /**
   * 过滤并清洗包含保留主题的脏条目
   *
   * @param {any[]} rawPosts 原始条目数组
   * @param {any} [logger] 日志器
   * @returns {{ cleanedPosts: any[], dirtyCount: number }} 清洗后合法条目与脏条目数
   */
  filterDirtyPosts(rawPosts, logger) {
    if (!Array.isArray(rawPosts)) return { cleanedPosts: [], dirtyCount: 0 };
    let dirtyCount = 0;
    const cleanedPosts = [];
    const log = logger || this.logger;
    for (const post of rawPosts) {
      if (!post || !post.id) continue;
      if (isReservedTopic(post.topic)) {
        dirtyCount++;
        log?.warn?.(`[BoardStore] Cleaned dirty post with reserved topic: #${post.id} (topic: ${post.topic})`);
        continue;
      }
      cleanedPosts.push(post);
    }
    return { cleanedPosts, dirtyCount };
  }

  /**
   * 适配层条目写入：校验保留主题并将合法条目委托给存储核心
   *
   * @param {import('../types/board-store.js').BoardPost} record
   * @returns {import('../types/board-store.js').BoardPost}
   */
  post(record) {
    if (!record || typeof record !== 'object') {
      throw new Error('[InvalidParameter] board_post arguments must be a non-null object.');
    }
    this.validateTopic(record.topic);
    if (this.store && typeof this.store.rawPost === 'function') {
      return this.store.rawPost(record);
    }
    return record;
  }

  /**
   * 解析调用方 Agent 的会话标识、标题与工作区上下文
   *
   * @param {any} agent 调用方 Agent 实例
   * @param {any} [ctx] Cordis 上下文
   * @returns {{ authorSessionId: string, authorTitle: string, callerWorkspace: string }}
   */
  resolveCallerContext(agent, ctx) {
    if (this.store && typeof this.store.resolveCallerContext === 'function') {
      if (!this.store.resolveCallerContext._isForwarder) {
        return this.store.resolveCallerContext(agent, ctx);
      }
    }
    const authorSessionId = agent?.id || agent?.session?.id || 'unknown-session';
    const directory = new SessionDirectory(ctx || this.ctx);
    return {
      authorSessionId,
      authorTitle: directory.resolveTitle(agent) || 'Session',
      callerWorkspace: directory.resolveWorkspace(agent)
    };
  }

  /**
   * 执行 board_post 领域操作：参数校验、保留主题拦截、调用方工作区解析与条目落盘
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executePost(argsOrParams = {}, maybeExec, maybeCtx) {
    const { args, exec, ctx } = normalizeExecParams(argsOrParams, maybeExec, maybeCtx);

    try {
      if (isReservedTopic(args?.topic)) {
        const errMsg = getReservedTopicErrorMessage(args.topic);
        return {
          success: false,
          topic: args.topic,
          error: errMsg,
          message: this.getMessages(ctx).boardPostFailure(errMsg)
        };
      }

      const callerAgent = exec?.agent;
      const { authorSessionId, authorTitle, callerWorkspace: authorWorkspace } = this.resolveCallerContext(callerAgent, ctx);

      const now = Date.now();
      const ttlSeconds = typeof args.ttl === 'number' && args.ttl > 0 ? Math.min(args.ttl, 86400) : 3600;
      const postId = `post-${now}-${Math.random().toString(36).slice(2, 8)}`;

      const postFn = typeof this.store?.rawPost === 'function' ? this.store.rawPost.bind(this.store) : this.store.post.bind(this.store);
      const post = postFn({
        id: postId,
        topic: args.topic,
        content: args.content,
        tags: Array.isArray(args.tags) ? args.tags : [],
        authorSessionId,
        authorTitle,
        authorWorkspace,
        createdAt: new Date(now).toISOString(),
        createdAtMs: now,
        expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
        expiresAtMs: now + ttlSeconds * 1000,
        status: 'active',
        scope: authorWorkspace || 'global',
        metadata: args.metadata || {}
      });

      return {
        success: true,
        postId: post.id,
        topic: post.topic,
        authorSessionId: post.authorSessionId,
        createdAt: post.createdAt,
        expiresAt: post.expiresAt,
        scope: post.scope,
        message: this.getMessages(ctx).boardPostSuccess(post.id)
      };
    } catch (err) {
      const activeLogger = this.store?.logger || this.logger;
      activeLogger?.debug?.(`[dsh-call-session] board_post execution failed: ${err?.message || err}`);
      return {
        success: false,
        error: err?.message || String(err),
        message: this.getMessages(ctx).boardPostFailure(err?.message || err)
      };
    }
  }

  /**
   * 执行 board_list 领域操作：作用域过滤、工作区隔离、摘要截断与结构化响应
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executeList(argsOrParams = {}, maybeExec, maybeCtx) {
    const { args, exec, ctx } = normalizeExecParams(argsOrParams, maybeExec, maybeCtx);

    const isCrossWs = !!args?.cross_workspace;
    let fallbackScope = isCrossWs ? 'global' : 'unknown';
    const targetId = args?.id ? String(args.id).trim() : '';
    const fallbackTitlesOnly = args?.titles_only !== undefined ? !!args.titles_only : !targetId;

    try {
      const { callerWorkspace } = this.resolveCallerContext(exec?.agent, ctx);
      if (!isCrossWs) {
        fallbackScope = callerWorkspace || 'unknown';
      }

      const res = this.store.list({
        id: args?.id,
        topic: args?.topic,
        topicPrefix: args?.topic_prefix,
        tag: args?.tag,
        status: args?.active_only === false ? 'all' : 'active',
        callerWorkspace: isCrossWs ? null : callerWorkspace,
        crossWorkspace: isCrossWs,
        titlesOnly: args?.titles_only !== undefined ? !!args.titles_only : undefined,
        limit: args?.limit || 20
      });

      const postList = Array.isArray(res) ? res : (res.posts || []);
      return {
        success: true,
        count: postList.length,
        scope: isCrossWs ? 'global' : (res?.workspace || fallbackScope),
        titlesOnly: typeof res?.titlesOnly === 'boolean' ? res.titlesOnly : fallbackTitlesOnly,
        posts: postList
      };
    } catch (err) {
      const activeLogger = this.store?.logger || this.logger;
      activeLogger?.debug?.(`[dsh-call-session] board_list execution failed: ${err?.message || err}`);
      return {
        success: false,
        error: err?.message || String(err),
        count: 0,
        scope: fallbackScope,
        titlesOnly: fallbackTitlesOnly,
        posts: []
      };
    }
  }

  /**
   * 执行 board_clear 领域操作：条目/主题归档或物理删除与工作区隔离保护
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executeClear(argsOrParams = {}, maybeExec, maybeCtx) {
    const { args, exec, ctx } = normalizeExecParams(argsOrParams, maybeExec, maybeCtx);

    try {
      if (!args?.id && !args?.topic) {
        const errMsg = '[InvalidParameter] board_clear requires either id or topic filter.';
        return {
          success: false,
          clearedCount: 0,
          error: errMsg,
          message: this.getMessages(ctx).boardClearFailure(errMsg)
        };
      }

      const { callerWorkspace } = this.resolveCallerContext(exec?.agent, ctx);

      const res = this.store.clear({
        id: args?.id,
        topic: args?.topic,
        action: args?.mode === 'purge' ? 'delete' : 'archive',
        callerWorkspace
      });

      return {
        success: true,
        clearedCount: res.affectedCount || 0,
        action: res.action,
        message: this.getMessages(ctx).boardClearSuccess(res.affectedCount || 0, res.action)
      };
    } catch (err) {
      const activeLogger = this.store?.logger || this.logger;
      activeLogger?.debug?.(`[dsh-call-session] board_clear execution failed: ${err?.message || err}`);
      const errMsg = err?.message || String(err);
      return {
        success: false,
        error: errMsg,
        clearedCount: 0,
        message: this.getMessages(ctx).boardClearFailure(errMsg)
      };
    }
  }

  /**
   * 获取调用方 Agent 在当前工作区内的有效未清理提醒文本
   *
   * @param {any} agent 调用方 Agent 实例
   * @param {any} [ctx] Cordis 上下文
   * @param {any} [config] 插件配置
   * @returns {string} 格式化提醒文本
   */
  getAuthorReminder(agent, ctx, config) {
    const { authorSessionId, callerWorkspace } = this.resolveCallerContext(agent, ctx);
    if (!authorSessionId || authorSessionId === 'unknown-session') return '';
    const activePosts = this.store.findActiveByAuthor(authorSessionId, callerWorkspace);
    const locale = resolveLocale(ctx || this.ctx, config || this.config);
    return formatAuthorReminderText(activePosts, locale);
  }
}
