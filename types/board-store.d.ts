/**
 * @module dsh-call-session/board-store
 * DSH 公共黑板持久化存储引擎与共享状态契约
 */

/** 黑板条目生命周期状态枚举 */
export type BoardPostStatus = 'active' | 'archived' | 'expired';

/** 黑板清理动作类型 */
export type BoardClearAction = 'archive' | 'delete';

/**
 * 公共黑板条目核心数据结构
 */
export interface BoardPost {
  /** 条目唯一 ID，格式如 'post-1725300000000-abcd' */
  id: string;
  /** 业务分类/主题命名空间，如 'task:audit', 'artifact:build', 'spec:api' */
  topic: string;
  /** 主体内容，支持 Markdown、纯文本或 JSON 序列化字符串 */
  content: string;
  /** 检索标签列表，如 ['p0', 'blocked', 'ready-for-review'] */
  tags: string[];
  /** 发布者会话 ID */
  authorSessionId: string;
  /** 发布者会话人类可读标题 */
  authorTitle: string;
  /** 发布者所在工程工作区规范化路径 */
  authorWorkspace: string;
  /** 创建时间 ISO 8601 格式字符串 */
  createdAt: string;
  /** 创建时间戳（毫秒） */
  createdAtMs: number;
  /** 过期时间 ISO 8601 格式字符串 */
  expiresAt: string;
  /** 过期时间戳（毫秒） */
  expiresAtMs: number;
  /** 当前状态：活跃 active、归档 archived、过期 expired */
  status: BoardPostStatus;
  /** 可见性作用域（工作区规范化路径或 'global'） */
  scope: string;
  /** 结构化扩展元数据键值对 */
  metadata: Record<string, any>;
}

/**
 * 向黑板发布新条目入参
 */
export interface BoardPostArgs {
  /** 业务分类或主题名，必填 */
  topic: string;
  /** 消息主体正文（最大 64KB），必填 */
  content: string;
  /** 可选标签列表（最多 10 个） */
  tags?: string[];
  /** 生存时间（秒），默认 3600 秒（1小时），最大不超过 86400 秒（24小时） */
  ttl?: number;
  /** 可选的结构化元数据键值对 */
  metadata?: Record<string, any>;
}

/**
 * 黑板标题摘要条目（精简模式）
 */
export interface BoardTitleItem {
  /** 条目 ID */
  id: string;
  /** 主题分类 */
  topic: string;
  /** 提取自元数据 title 字段或正文首行的标题 */
  title: string;
  /** 标签列表 */
  tags: string[];
  /** 发布者会话 ID */
  authorSessionId: string;
  /** 发布者会话人类可读标题 */
  authorTitle: string;
  /** 创建时间 ISO 8601 格式字符串 */
  createdAt: string;
  /** 距离过期的剩余分钟数 */
  remainingMinutes: number;
  /** 距离过期的剩余秒数 */
  remainingSeconds?: number;
  /** 当前状态 */
  status?: BoardPostStatus;
  /** 扩展元数据 */
  metadata?: Record<string, any>;
}

/**
 * 查询黑板条目参数选项
 */
export interface BoardListOptions {
  /** 按完整主题过滤（如 task:audit） */
  topic?: string;
  /** 按主题前缀模糊过滤 (camelCase) */
  topicPrefix?: string;
  /** 按主题前缀模糊过滤 (snake_case) */
  topic_prefix?: string;
  /** 按单个标签检索（如 ready-for-review） */
  tag?: string;
  /** 按作者会话 ID 检索 */
  author?: string;
  /** 状态过滤：'active' | 'archived' | 'expired' | 'all'，默认为 'active' */
  status?: 'active' | 'archived' | 'expired' | 'all';
  /** 返回结果数量限制，默认 20 条，最大 100 条 */
  limit?: number;
  /** 调用方所在工作区规范化路径 (camelCase) */
  callerWorkspace?: string;
  /** 工作区过滤别名 */
  workspace?: string;
  /** 是否跨工程穿透查询所有工作区的公告 (camelCase) */
  crossWorkspace?: boolean;
  /** 是否跨工程穿透查询所有工作区的公告 (snake_case) */
  cross_workspace?: boolean;
  /** 是否仅返回标题与摘要元数据（不含主体 content 大文本），以节约 Token (camelCase) */
  titlesOnly?: boolean;
  /** 是否仅返回标题与摘要元数据 (snake_case) */
  titles_only?: boolean;
}

/**
 * 黑板列表查询返回结构
 */
export interface BoardListResult {
  /** 符合过滤条件的记录总数 */
  total: number;
  /** 本次实际返回记录数 */
  returned: number;
  /** 当前查询所处工作区 */
  workspace: string;
  /** 是否跨工作区查询 */
  crossWorkspace: boolean;
  /** 是否仅返回标题模式 */
  titlesOnly: boolean;
  /** 条目列表（包含完整内容或精简标题摘要） */
  posts: (BoardPost | BoardTitleItem)[];
}

/**
 * 清理或撤销黑板条目入参
 */
export interface BoardClearOptions {
  /** 待删除或撤销的条目唯一 ID（如 post-1725300000000-abcd） */
  id?: string;
  /** 按主题批量标记撤销（如 task:audit，当未指定 id 时有效） */
  topic?: string;
  /** 清理动作：'archive' 软删除标记已处理；'delete' 彻底物理移除，默认 'archive' */
  action?: BoardClearAction;
  /** 清理模式参数映射（工具入参）：'dismiss' 映射为 archive，'purge' 映射为 delete */
  mode?: 'dismiss' | 'purge';
  /** 调用方工作区路径（用于主题级批量清理的作用域隔离保护） */
  callerWorkspace?: string;
}

/**
 * 黑板清理执行返回结果
 */
export interface BoardClearResult {
  /** 清理操作是否成功 */
  success: boolean;
  /** 受影响的条目数量 */
  affectedCount: number;
  /** 实际执行的底层动作：'archive' | 'delete' */
  action: BoardClearAction;
  /** 用户友好的操作反馈描述 */
  message: string;
}

/**
 * BoardStore 构造配置选项
 */
export interface BoardStoreOptions {
  /** 主存储文件路径（默认指向插件目录下的 board.json） */
  storagePath?: string;
  /** 容灾备份文件路径（默认 storagePath + '.bak'） */
  backupPath?: string;
  /** 内存黑板保留的最大条目数上限（FIFO 淘汰策略），默认 200 */
  maxPosts?: number;
  /** 数据原子写盘的防抖延迟时间（毫秒），默认 300ms */
  debounceMs?: number;
  /** 自定义日志记录器对象 */
  logger?: {
    info?(...args: any[]): void;
    warn?(...args: any[]): void;
    error?(...args: any[]): void;
    debug?(...args: any[]): void;
  } | Console;
}

/**
 * 规范化工程工作区路径（统一正斜杠、盘符小写、剔除末尾斜杠）
 *
 * @param rawPath 原始文件或目录路径
 * @returns 统一格式的规范化 POSIX 风格路径
 */
export declare function normalizeWorkspace(rawPath: string | null | undefined): string;

/**
 * 从黑板条目中安全提取人类可读标题
 * 优先读取 metadata.title，次选正文首行提取并裁剪（去 Markdown 标题标记）
 *
 * @param post 黑板条目对象
 * @returns 提取得到的标题文本，默认 '(无标题内容)'
 */
export declare function extractTitle(post: BoardPost | Partial<BoardPost> | null | undefined): string;

/**
 * DSH 公共黑板存储引擎：基于内存主索引的高性能读写、防抖原子持久化与 .bak 容灾自愈
 */
export declare class BoardStore {
  /** 主文件物理存储路径 */
  storagePath: string;
  /** 容灾备份物理存储路径 */
  backupPath: string;
  /** 最大条目容量上限 */
  maxPosts: number;
  /** 防抖延迟毫秒数 */
  debounceMs: number;
  /** 日志记录器 */
  logger: any;
  /** 内存条目索引映射 */
  posts: Map<string, BoardPost>;
  /** 内部防抖计时器引用 */
  flushTimer: NodeJS.Timeout | null;
  /** 是否正在执行写盘刷新 */
  isFlushing: boolean;
  /** 是否有在写盘期间产生的待写盘脏数据 */
  needsFlush: boolean;

  constructor(options?: BoardStoreOptions);

  /**
   * 同步初始化载入磁盘数据，主文件异常时自动降级从 .bak 容灾自愈
   */
  loadSync(): void;

  /**
   * 从 .bak 备份文件执行自愈恢复
   */
  recoverFromBackup(): void;

  /**
   * 水合反序列化磁盘 JSON 数据至内存 Map
   */
  hydratePosts(data: { version?: number; updatedAt?: string; posts?: BoardPost[] }): void;

  /**
   * 执行容量限制淘汰：优先清理过期 expired，次选归档 archived，最后按 FIFO 淘汰最老活跃记录
   */
  enforceCapacityLimit(): void;

  /**
   * 发布/覆盖一条黑板条目
   */
  post(record: BoardPost): BoardPost;

  /**
   * 根据唯一 ID 获取黑板条目
   */
  get(id: string): BoardPost | undefined;

  /**
   * 按条件检索与过滤黑板条目列表
   */
  list(options?: BoardListOptions): BoardListResult;

  /**
   * 清理或撤销指定条目或主题
   */
  clear(options: BoardClearOptions): BoardClearResult;

  /**
   * 仅获取活跃黑板条目的轻量标题列表
   */
  listTitles(options?: { callerWorkspace?: string; crossWorkspace?: boolean }): BoardTitleItem[];

  /**
   * 将标题列表格式化为适合 Web 斜杠指令呈现的纯文本摘要
   */
  formatTitleDigest(titles?: BoardTitleItem[]): string;

  /**
   * 触发防抖延迟落盘调度
   */
  scheduleFlush(): void;

  /**
   * 执行原子写盘：写入临时文件 -> 同步备份 -> 重命名替换主文件（带 Windows 文件锁重试）
   */
  flushAtomic(): Promise<void>;

  /**
   * 插件卸载或进程退出时立即关闭定时器并强制同步刷新未决写入
   */
  close(): Promise<void>;
}

export { BoardStore as AtomicBoardStore };
