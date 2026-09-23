/**
 * DSH Board Store Engine
 *
 * In-memory store with debounced atomic disk persistence (board.json),
 * retry backoff, capacity FIFO eviction, and backup recovery.
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionDirectory } from './session-directory.mjs';
import { resolveLocale, getCatalog, resolveMessages } from './locales/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.basename(__dirname) === 'lib'
  ? path.resolve(__dirname, '..')
  : __dirname;
const DEFAULT_STORAGE_PATH = path.resolve(PLUGIN_ROOT, 'board.json');

/**
 * 规范化工程工作区路径：统一正斜杠、盘符小写并去除末尾斜杠
 *
 * @param {string | null | undefined} rawPath 原始路径
 * @returns {string} 规范化 POSIX 风格路径
 */
export function normalizeWorkspace(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let p = rawPath.trim();
  p = p.replace(/\\+/g, '/');
  p = p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  p = p.replace(/\/+$/, '');
  return p;
}

/**
 * 从黑板条目中安全提取人类可读标题
 *
 * @param {import('../types/board-store.js').BoardPost | object} post 黑板条目对象
 * @returns {string} 提取得到的标题文本
 */
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

export function extractTitle(post) {
  if (!post) return '(无标题内容)';
  if (typeof post.metadata?.title === 'string' && post.metadata.title.trim()) {
    return post.metadata.title.trim();
  }
  if (typeof post.content === 'string' && post.content.trim()) {
    const lines = post.content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      let firstLine = lines[0];
      firstLine = firstLine.replace(/^#+\s*/, '');
      firstLine = firstLine.replace(/^[-*+]\s+/, '');
      firstLine = firstLine.replace(/^\d+\.\s+/, '');
      firstLine = firstLine.trim();
      if (firstLine) {
        return firstLine.slice(0, 60);
      }
    }
  }
  return '(无标题内容)';
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
  if (!posts || !Array.isArray(posts) || posts.length === 0) return '';
  const effectiveLocale = locale || resolveLocale();
  const catalog = getCatalog(effectiveLocale);
  return catalog.prompts.authorReminder(posts);
}

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * 标准化多态执行参数（支持单对象包装形式或按位置传入形式）
 *
 * @param {object} [argsOrParams]
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
 * 公共黑板存储引擎：纯存储核心，聚焦内存 Map、防抖原子持久化与备份恢复自愈
 */
export class BoardStore {
  /**
   * @param {import('../types/board-store.js').BoardStoreOptions} [options]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath !== undefined ? options.storagePath : DEFAULT_STORAGE_PATH;
    this.backupPath = options.backupPath || (this.storagePath ? `${this.storagePath}.bak` : null);
    this.maxPosts = options.maxPosts || 200;
    this.debounceMs = options.debounceMs ?? 300;
    this.logger = options.logger || noopLogger;
    this.ctx = options.ctx || null;
    this.config = options.config || null;

    this.posts = new Map();
    this.flushTimer = null;
    this.isFlushing = false;
    this.needsFlush = false;

    if (options.adapter) {
      this.__adapterInstance = options.adapter;
    }

    if (this.storagePath) {
      this.loadSync();
    }
  }

  cleanOrphanTempFiles() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) return;
      const base = path.basename(this.storagePath);
      const prefix = `${base}.tmp.`;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          try {
            unlinkSync(path.join(dir, entry));
            this.logger.debug?.(`[BoardStore] Cleaned orphan temp file: ${entry}`);
          } catch {}
        }
      }
    } catch {}
  }

  loadSync() {
    this.cleanOrphanTempFiles();
    if (!existsSync(this.storagePath)) {
      if (existsSync(this.backupPath)) {
        this.recoverFromBackup();
      }
      return;
    }
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const data = JSON.parse(raw);
      this.hydratePosts(data);
    } catch (err) {
      this.logger.warn?.(`[StorageError] [BoardStore] Primary storage file corrupted: ${err.message}, attempting backup recovery...`);
      this.recoverFromBackup();
    }
  }

  recoverFromBackup() {
    if (!existsSync(this.backupPath)) {
      this.logger.warn?.('[BoardStore] No backup file available, initializing empty blackboard.');
      return;
    }
    try {
      const bakRaw = readFileSync(this.backupPath, 'utf8');
      const bakData = JSON.parse(bakRaw);
      this.hydratePosts(bakData);
      this.logger.debug?.('[BoardStore] Successfully recovered blackboard data from backup.');
      this.scheduleFlush();
    } catch (bakErr) {
      this.logger.warn?.(`[StorageError] [BoardStore] Backup storage file corrupted, initializing empty blackboard: ${bakErr.message}`);
    }
  }

  hydratePosts(data) {
    if (!data || !Array.isArray(data.posts)) return 0;
    const now = Date.now();
    const adapter = this._adapter;
    const { cleanedPosts, dirtyCount } = adapter.filterDirtyPosts(data.posts, this.logger);
    for (const post of cleanedPosts) {
      if (post.status === 'active' && post.expiresAtMs && now > post.expiresAtMs) {
        post.status = 'expired';
      }
      this.posts.set(post.id, post);
    }
    if (dirtyCount > 0) {
      this.logger.info?.(`[BoardStore] Hydration complete: filtered ${dirtyCount} dirty posts containing reserved topics.`);
      this.scheduleFlush();
    }
    return dirtyCount;
  }

  enforceCapacityLimit() {
    if (this.posts.size < this.maxPosts) return;
    const now = Date.now();
    for (const [id, post] of this.posts.entries()) {
      if (post.status === 'expired' || (post.expiresAtMs && now > post.expiresAtMs)) {
        this.posts.delete(id);
        if (this.posts.size < this.maxPosts) return;
      }
    }
    for (const [id, post] of this.posts.entries()) {
      if (post.status === 'archived') {
        this.posts.delete(id);
        if (this.posts.size < this.maxPosts) return;
      }
    }
    let oldestId = null;
    let oldestTime = Infinity;
    for (const [id, post] of this.posts.entries()) {
      const t = post.createdAtMs || 0;
      if (t < oldestTime) {
        oldestTime = t;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.posts.delete(oldestId);
    }
  }

  /**
   * 底层纯存储写入：容量限制、更新 Map 与异步防抖落盘（无业务主题拦截）
   *
   * @param {import('../types/board-store.js').BoardPost} record
   * @returns {import('../types/board-store.js').BoardPost}
   */
  rawPost(record) {
    if (!record || typeof record !== 'object') {
      throw new Error('[InvalidParameter] board_post arguments must be a non-null object.');
    }
    this.enforceCapacityLimit();
    this.posts.set(record.id, record);
    this.scheduleFlush();
    return record;
  }

  /**
   * 发布或更新一条黑板条目（收口委托至适配器执行主题校验）
   *
   * @param {import('../types/board-store.js').BoardPost} record
   * @returns {import('../types/board-store.js').BoardPost}
   */
  post(record) {
    return this._adapter.post(record);
  }

  /**
   * 根据 ID 检索黑板条目
   *
   * @param {string} id
   * @returns {import('../types/board-store.js').BoardPost | undefined}
   */
  get(id) {
    return this.posts.get(id);
  }

  /**
   * 查找由指定 Session 发布的、当前仍处于活跃且未过期的黑板条目列表
   *
   * @param {string} authorSessionId 作者 Session ID
   * @param {string} [callerWorkspace] 调用方规范化工作区路径，用于工作区隔离，可选
   * @returns {import('../types/board-store.js').BoardPost[]} 匹配的活跃条目数组
   */
  findActiveByAuthor(authorSessionId, callerWorkspace) {
    if (!authorSessionId || typeof authorSessionId !== 'string') return [];
    const now = Date.now();
    const effectiveWs = normalizeWorkspace(callerWorkspace);
    const matched = [];

    for (const post of this.posts.values()) {
      if (!post || post.status !== 'active') continue;
      if (post.expiresAtMs && now > post.expiresAtMs) {
        post.status = 'expired';
        continue;
      }
      if (effectiveWs && post.authorWorkspace && post.authorWorkspace !== effectiveWs) {
        continue;
      }
      if (post.authorSessionId === authorSessionId) {
        matched.push(post);
      }
    }

    matched.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return matched;
  }

  /**
   * 按条件检索与过滤黑板条目列表
   *
   * @param {import('../types/board-store.js').BoardListOptions} [options]
   * @returns {import('../types/board-store.js').BoardListResult}
   */
  list({
    id,
    topic,
    topicPrefix,
    tag,
    author,
    status = 'active',
    limit = 20,
    callerWorkspace,
    crossWorkspace = false,
    titlesOnly
  } = {}) {
    const now = Date.now();
    const effectiveLimit = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 20;
    const effectiveCrossWs = Boolean(crossWorkspace);
    const effectiveCallerWs = normalizeWorkspace(callerWorkspace);
    const targetId = id ? String(id).trim() : '';

    const effectiveTitlesOnly = titlesOnly !== undefined
      ? Boolean(titlesOnly)
      : (targetId ? false : true);

    const effectivePrefix = (topicPrefix || '').trim().toLowerCase();
    const results = [];

    for (const post of this.posts.values()) {
      if (!post) continue;

      if (post.status === 'active' && post.expiresAtMs && now > post.expiresAtMs) {
        post.status = 'expired';
      }

      if (status === 'active') {
        if (post.status !== 'active') continue;
      } else if (status === 'archived') {
        if (post.status !== 'archived') continue;
      } else if (status !== 'all') {
        if (post.status !== status) continue;
      }

      if (!effectiveCrossWs) {
        if (effectiveCallerWs && post.authorWorkspace && post.authorWorkspace !== effectiveCallerWs) {
          continue;
        }
      }

      if (targetId) {
        if (post.id !== targetId) {
          continue;
        }
      }

      if (topic) {
        const t = topic.trim().toLowerCase();
        const pt = (post.topic || '').toLowerCase();
        if (pt !== t && !pt.startsWith(t)) {
          continue;
        }
      }

      if (effectivePrefix) {
        const pt = (post.topic || '').toLowerCase();
        if (!pt.startsWith(effectivePrefix)) {
          continue;
        }
      }

      if (tag) {
        const searchTag = tag.trim().toLowerCase();
        const tags = Array.isArray(post.tags) ? post.tags.map(x => String(x).toLowerCase()) : [];
        if (!tags.includes(searchTag)) {
          continue;
        }
      }

      if (author) {
        const a = author.trim().toLowerCase();
        const pa = (post.authorSessionId || '').toLowerCase();
        if (pa !== a && !pa.startsWith(a)) {
          continue;
        }
      }

      results.push(post);
    }

    results.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    const total = results.length;
    const returnedPosts = results.slice(0, effectiveLimit).map(p => {
      const remainingMinutes = p.expiresAtMs ? Math.ceil(Math.max(0, (p.expiresAtMs - now) / 1000) / 60) : 0;
      const title = extractTitle(p);

      if (effectiveTitlesOnly) {
        return {
          id: p.id,
          topic: p.topic,
          title,
          tags: p.tags || [],
          authorSessionId: p.authorSessionId,
          authorTitle: p.authorTitle || '',
          createdAt: p.createdAt,
          remainingMinutes,
          status: p.status,
          metadata: p.metadata || {}
        };
      }

      return {
        id: p.id,
        topic: p.topic,
        title,
        content: p.content,
        tags: p.tags || [],
        authorSessionId: p.authorSessionId,
        authorTitle: p.authorTitle || '',
        createdAt: p.createdAt,
        remainingMinutes,
        status: p.status,
        metadata: p.metadata || {}
      };
    });

    return {
      total,
      returned: returnedPosts.length,
      workspace: effectiveCallerWs || '',
      crossWorkspace: !!effectiveCrossWs,
      titlesOnly: !!effectiveTitlesOnly,
      posts: returnedPosts
    };
  }

  /**
   * 清理或归档指定黑板条目或主题（纯存储契约）
   *
   * @param {import('../types/board-store.js').BoardClearOptions} options
   * @returns {import('../types/board-store.js').BoardClearResult}
   */
  clear({ id, topic, action = 'archive', callerWorkspace } = {}) {
    if (!id && !topic) {
      throw new Error('[InvalidParameter] board_clear requires either id or topic filter.');
    }
    const cleanAction = action === 'delete' ? 'delete' : 'archive';
    let affectedCount = 0;

    const effectiveCallerWs = normalizeWorkspace(callerWorkspace);

    if (id) {
      const cleanId = String(id).trim();
      const post = this.posts.get(cleanId);
      if (post) {
        const postWs = normalizeWorkspace(post.authorWorkspace);
        if (effectiveCallerWs && postWs && postWs !== effectiveCallerWs) {
          return {
            success: true,
            affectedCount: 0,
            action: cleanAction,
            message: `[BoardStore] Cleared 0 item(s) (${cleanAction}).`
          };
        }
        if (cleanAction === 'delete') {
          this.posts.delete(cleanId);
        } else {
          post.status = 'archived';
        }
        affectedCount++;
      }
    } else if (topic) {
      const t = String(topic).trim().toLowerCase();
      const toDelete = [];
      for (const [postId, post] of this.posts.entries()) {
        if (!post) continue;
        const postWs = normalizeWorkspace(post.authorWorkspace);
        if (effectiveCallerWs && postWs && postWs !== effectiveCallerWs) {
          continue;
        }
        const pt = (post.topic || '').toLowerCase();
        if (pt === t || pt.startsWith(t)) {
          if (cleanAction === 'delete') {
            toDelete.push(postId);
          } else {
            post.status = 'archived';
          }
          affectedCount++;
        }
      }
      for (const pid of toDelete) {
        this.posts.delete(pid);
      }
    }

    if (affectedCount > 0) {
      this.scheduleFlush();
    }

    return {
      success: true,
      affectedCount,
      action: cleanAction,
      message: `[BoardStore] Cleared ${affectedCount} item(s) (${cleanAction}).`
    };
  }

  /**
   * 仅获取活跃黑板条目的轻量标题列表
   *
   * @param {object} [options]
   * @param {string} [options.callerWorkspace]
   * @param {boolean} [options.crossWorkspace]
   * @returns {import('../types/board-store.js').BoardTitleItem[]}
   */
  listTitles({ callerWorkspace, crossWorkspace = false } = {}) {
    const now = Date.now();
    const results = [];
    for (const post of this.posts.values()) {
      if (!post || post.status !== 'active') continue;
      if (post.expiresAtMs && now > post.expiresAtMs) continue;
      if (!crossWorkspace && callerWorkspace && post.authorWorkspace && post.authorWorkspace !== callerWorkspace) {
        continue;
      }
      const remMin = post.expiresAtMs ? Math.ceil(Math.max(0, (post.expiresAtMs - now) / 1000) / 60) : 0;
      results.push({
        id: post.id,
        topic: post.topic,
        title: extractTitle(post),
        tags: post.tags || [],
        authorSessionId: post.authorSessionId,
        authorTitle: post.authorTitle || '',
        createdAt: post.createdAt,
        remainingMinutes: remMin
      });
    }
    results.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return results;
  }

  /**
   * 将标题列表格式化为适合 Web 斜杠指令呈现的纯文本摘要
   *
   * @param {import('../types/board-store.js').BoardTitleItem[]} [titles]
   * @returns {string}
   */
  formatTitleDigest(titles = []) {
    if (!titles || titles.length === 0) return '';
    const lines = titles.map(t => {
      const tagStr = t.tags && t.tags.length ? ` [${t.tags.join(', ')}]` : '';
      const author = t.authorTitle || t.authorSessionId;
      const titleDisplay = t.title ? ` "${t.title}"` : '';
      return `- [#${t.id}] [${t.topic}]${titleDisplay}${tagStr} (by ${author}, rem ${t.remainingMinutes}m)`;
    });
    return `[BOARD TITLES: ${titles.length} active]\n${lines.join('\n')}`;
  }

  scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushAtomic().catch(e => {
        this.logger.error?.(`[BoardStore] Asynchronous disk flush failed: ${e?.message || e}`);
      });
    }, this.debounceMs);
  }

  async flushAtomic() {
    if (!this.storagePath) {
      return;
    }
    if (this.isFlushing) {
      this.needsFlush = true;
      return;
    }
    this.isFlushing = true;
    const tmpPath = `${this.storagePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    try {
      const payload = JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        posts: Array.from(this.posts.values())
      }, null, 2);

      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(tmpPath, payload, 'utf8');

      if (existsSync(this.storagePath)) {
        try {
          await fs.copyFile(this.storagePath, this.backupPath);
        } catch {}
      }

      let retries = 5;
      let delay = 20;
      while (retries > 0) {
        try {
          await fs.rename(tmpPath, this.storagePath);
          break;
        } catch (renameErr) {
          retries--;
          if (retries === 0) throw new Error(`[StorageError] Atomic disk flush failed after retries: ${renameErr?.message || renameErr}`);
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        }
      }

      if (!existsSync(this.backupPath) && existsSync(this.storagePath)) {
        try {
          await fs.copyFile(this.storagePath, this.backupPath);
        } catch {}
      }
    } finally {
      try {
        if (existsSync(tmpPath)) {
          await fs.unlink(tmpPath);
        }
      } catch {}
      this.isFlushing = false;
      if (this.needsFlush) {
        this.needsFlush = false;
        this.scheduleFlush();
      }
    }
  }

  /**
   * 销毁实例并持久化数据
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.isFlushing) {
      await new Promise(r => setTimeout(r, 20));
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAtomic();
  }

  // --- 向后兼容委托门面 (Facade Delegations) ---

  get _adapter() {
    if (!this.__adapterInstance) {
      this.__adapterInstance = new BoardToolsAdapter(this, {
        ctx: this.ctx,
        config: this.config,
        logger: this.logger
      });
    }
    return this.__adapterInstance;
  }

  set _adapter(adapter) {
    this.__adapterInstance = adapter;
  }

  /**
   * 获取多语言文案字典（兼容门面）
   *
   * @param {any} [ctx]
   * @returns {import('./locales/index.mjs').MessageCatalog}
   */
  getMessages(ctx) {
    return this._adapter.getMessages(ctx);
  }

  /**
   * 解析调用方 Agent 的会话标识、标题与工作区上下文（兼容门面）
   *
   * @param {any} agent 调用方 Agent 实例
   * @param {any} [ctx] Cordis 上下文
   * @returns {{ authorSessionId: string, authorTitle: string, callerWorkspace: string }}
   */
  resolveCallerContext(agent, ctx) {
    return this._adapter.resolveCallerContext(agent, ctx);
  }

  /**
   * 执行 board_post 领域操作（兼容门面）
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executePost(argsOrParams, maybeExec, maybeCtx) {
    return this._adapter.executePost(argsOrParams, maybeExec, maybeCtx);
  }

  /**
   * 执行 board_list 领域操作（兼容门面）
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executeList(argsOrParams, maybeExec, maybeCtx) {
    return this._adapter.executeList(argsOrParams, maybeExec, maybeCtx);
  }

  /**
   * 执行 board_clear 领域操作（兼容门面）
   *
   * @param {object} [argsOrParams]
   * @param {any} [maybeExec]
   * @param {any} [maybeCtx]
   * @returns {Promise<object>}
   */
  async executeClear(argsOrParams, maybeExec, maybeCtx) {
    return this._adapter.executeClear(argsOrParams, maybeExec, maybeCtx);
  }

  /**
   * 获取调用方 Agent 在当前工作区内的有效未清理提醒文本（兼容门面）
   *
   * @param {any} agent 调用方 Agent 实例
   * @param {any} [ctx] Cordis 上下文
   * @param {any} [config] 插件配置
   * @returns {string} 格式化提醒文本
   */
  getAuthorReminder(agent, ctx, config) {
    return this._adapter.getAuthorReminder(agent, ctx, config);
  }
}

/**
 * 公共黑板工具适配层：负责与 Cordis 工具调用、执行上下文及 i18n 消息进行适配
 */
export class BoardToolsAdapter {
  /**
   * @param {BoardStore} store 存储引擎实例
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
    if (this.store && typeof this.store.resolveCallerContext === 'function' && this.store.resolveCallerContext !== BoardStore.prototype.resolveCallerContext) {
      return this.store.resolveCallerContext(agent, ctx);
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

export {
  BoardStore as AtomicBoardStore
};
