/**
 * DSH Board Store Engine (Native Refactor Edition)
 *
 * In-memory primary store with debounced atomic disk persistence (board.json),
 * Windows lock retry with exponential backoff, capacity FIFO eviction, and .bak self-healing.
 */
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.basename(__dirname) === 'lib'
  ? path.resolve(__dirname, '..')
  : __dirname;
const DEFAULT_STORAGE_PATH = path.resolve(PLUGIN_ROOT, 'board.json');

/**
 * 规范化工程工作区路径（统一正斜杠、盘符小写、剔除末尾斜杠）
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

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * DSH 公共黑板存储引擎：内存主索引、防抖原子持久化与 .bak 容灾自愈
 */
export class BoardStore {
  /**
   * @param {import('../types/board-store.js').BoardStoreOptions} [options]
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_STORAGE_PATH;
    this.backupPath = options.backupPath || `${this.storagePath}.bak`;
    this.maxPosts = options.maxPosts || 200;
    this.debounceMs = options.debounceMs ?? 300;
    this.logger = options.logger || noopLogger;

    this.posts = new Map();
    this.flushTimer = null;
    this.isFlushing = false;
    this.needsFlush = false;

    this.loadSync();
  }

  loadSync() {
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
      this.logger.warn?.(`[BoardStore] 主文件损坏 (${err.message})，尝试从备份恢复...`);
      this.recoverFromBackup();
    }
  }

  recoverFromBackup() {
    if (!existsSync(this.backupPath)) {
      this.logger.warn?.('[BoardStore] 无可用备份文件，安全初始化空黑板。');
      return;
    }
    try {
      const bakRaw = readFileSync(this.backupPath, 'utf8');
      const bakData = JSON.parse(bakRaw);
      this.hydratePosts(bakData);
      this.logger.info?.('[BoardStore] 成功从 board.json.bak 恢复黑板数据！');
      this.scheduleFlush();
    } catch (bakErr) {
      this.logger.error?.('[BoardStore] 备份文件亦损坏，安全初始化空黑板:', bakErr.message);
    }
  }

  hydratePosts(data) {
    if (!data || !Array.isArray(data.posts)) return;
    const now = Date.now();
    for (const post of data.posts) {
      if (!post || !post.id) continue;
      if (post.status === 'active' && post.expiresAtMs && now > post.expiresAtMs) {
        post.status = 'expired';
      }
      this.posts.set(post.id, post);
    }
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
   * 发布或更新一条黑板条目
   *
   * @param {import('../types/board-store.js').BoardPost} record
   * @returns {import('../types/board-store.js').BoardPost}
   */
  post(record) {
    this.enforceCapacityLimit();
    this.posts.set(record.id, record);
    this.scheduleFlush();
    return record;
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
   * 按条件检索与过滤黑板条目列表
   *
   * @param {import('../types/board-store.js').BoardListOptions} [options]
   * @returns {import('../types/board-store.js').BoardListResult}
   */
  list({
    topic,
    topicPrefix,
    topic_prefix,
    tag,
    author,
    status = 'active',
    limit = 20,
    callerWorkspace,
    workspace,
    crossWorkspace = false,
    cross_workspace = false,
    titlesOnly = false,
    titles_only = false
  } = {}) {
    const now = Date.now();
    const effectiveLimit = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 20;
    const effectiveCrossWs = crossWorkspace || cross_workspace;
    const effectiveCallerWs = normalizeWorkspace(callerWorkspace || workspace);
    const effectiveTitlesOnly = titlesOnly || titles_only;
    const effectivePrefix = (topicPrefix || topic_prefix || '').trim().toLowerCase();
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
      const remainingSeconds = p.expiresAtMs ? Math.max(0, Math.ceil((p.expiresAtMs - now) / 1000)) : 0;
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
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
          remainingSeconds,
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
        remainingSeconds,
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
   * 清理或撤销指定黑板条目或主题
   *
   * @param {import('../types/board-store.js').BoardClearOptions} options
   * @returns {import('../types/board-store.js').BoardClearResult}
   */
  clear({ id, topic, action = 'archive', callerWorkspace } = {}) {
    if (!id && !topic) {
      throw new Error('board_clear 必须指定 id 或 topic 至少一个筛选条件，禁止无条件全量清除！');
    }
    const cleanAction = action === 'delete' ? 'delete' : 'archive';
    let affectedCount = 0;

    if (id) {
      const cleanId = String(id).trim();
      const post = this.posts.get(cleanId);
      if (post) {
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
        if (callerWorkspace && post.authorWorkspace && post.authorWorkspace !== callerWorkspace) {
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
      message: `成功${cleanAction === 'delete' ? '物理删除' : '归档'} ${affectedCount} 条黑板条目。`
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
      const remSec = post.expiresAtMs ? Math.max(0, Math.ceil((post.expiresAtMs - now) / 1000)) : 0;
      results.push({
        id: post.id,
        topic: post.topic,
        title: extractTitle(post),
        tags: post.tags || [],
        authorSessionId: post.authorSessionId,
        authorTitle: post.authorTitle || '',
        createdAt: post.createdAt,
        remainingMinutes: Math.ceil(remSec / 60)
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
        this.logger.error?.(`[BoardStore] 异步写盘失败: ${e?.message || e}`);
      });
    }, this.debounceMs);
  }

  async flushAtomic() {
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
          if (retries === 0) throw renameErr;
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
   * 销毁实例并强制立即将内存状态原子落盘
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAtomic();
  }
}

export { BoardStore as AtomicBoardStore };
