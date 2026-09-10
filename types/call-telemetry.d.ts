/**
 * @module dsh-call-session/call-telemetry
 * 内存调用遥测缓冲区契约与画板聚合数据模型
 */

/** 单播呼叫意图分类 */
export type CanvasCallType = 'task_dispatch' | 'task_report' | 'notice';

/** 原生交付模式 */
export type CanvasDeliveryMode = 'steer' | 'followup';

/** 会话运行状态 */
export type CanvasSessionState = 'running' | 'idle';

/** 黑板条目三态状态 */
export type CanvasBoardPostStatus = 'active' | 'archived' | 'expired';

/**
 * 内存调用遥测记录
 */
export interface CallTelemetryRecord {
  /** 唯一标识，例如 call-1725800000000-a1b2c3d4 */
  id: string;
  /** 调用方会话 Session ID */
  callerSessionId: string;
  /** 调用方会话展示标题 */
  callerTitle: string;
  /** 调用方工作区规范化路径 */
  callerWorkspace: string;
  /** 目标会话 Session ID */
  targetSessionId: string;
  /** 目标会话展示标题 */
  targetTitle: string;
  /** 目标工作区规范化路径 */
  targetWorkspace: string;
  /** 呼叫意图分类 */
  callType: CanvasCallType;
  /** 原生分发模式 */
  deliveryMode: CanvasDeliveryMode;
  /** 发生时间戳，单位毫秒 */
  timestamp: number;
  /** 执行投递耗时，单位毫秒 */
  durationMs: number;
  /** 关联引用的黑板条目 ID 列表 */
  contextPostIds: string[];
  /** 消息摘要，最多 120 字符 */
  messageSnippet: string;
  /** 完整消息内容 */
  messagePayload: string;
  /** 记录状态：活跃或已落定 */
  status: 'active' | 'settled';
}

/**
 * 调用遥测记录查询过滤器
 */
export interface CallTelemetryFilter {
  /** 目标工程工作区过滤 */
  workspace?: string;
  /** 是否跨工作区查询所有调用 */
  crossWorkspace?: boolean;
  /** cross_workspace 兼容别名 */
  cross_workspace?: boolean;
  /** 返回记录条数限制，默认 50 */
  limit?: number;
  /** 时间戳增量下限过滤 */
  since?: number;
  /** 指定会话 ID 过滤 */
  sessionId?: string;
  /** 状态过滤 */
  status?: 'active' | 'settled';
}

/**
 * 内存环形调用遥测缓冲区
 */
export declare class CallTelemetryRingBuffer {
  constructor(capacity?: number);
  /** 获取缓冲区最大容量 */
  capacity(): number;
  /** 获取当前已存条目数 */
  size(): number;
  /** 清空缓冲区 */
  clear(): void;
  /** 写入单条调用遥测记录 */
  record(entry: Partial<CallTelemetryRecord> & {
    callerSessionId: string;
    targetSessionId: string;
    callType?: CanvasCallType;
    deliveryMode?: CanvasDeliveryMode;
  }): CallTelemetryRecord;
  /** 查询调用遥测记录 */
  query(filter?: CallTelemetryFilter): CallTelemetryRecord[];
  /** 级联落定指定会话的调用连线 */
  settleSession(sessionId: string): number;
  /** 会话注销级联清理 */
  cleanupSession(sessionId: string, action?: 'settle' | 'purge' | 'delete'): number;
}

/**
 * 画板工作区集群实体
 */
export interface CanvasWorkspaceEntity {
  /** 工作区规范化绝对路径 */
  id: string;
  /** 工作区目录名 */
  name: string;
  /** 是否为当前会话所在工作区 */
  isCurrent: boolean;
  /** 归属于该工作区的会话 ID 列表 */
  sessionIds: string[];
}

/**
 * 画板会话节点实体
 */
export interface CanvasSessionEntity {
  /** 会话唯一标识 */
  id: string;
  /** 8 位规范化小写会话短码（剥离 session- 前缀） */
  shortId: string;
  /** 会话展示标题 */
  title: string;
  /** 所属工作区根路径 */
  workspace: string;
  /** 规范化运行状态：running 或 idle */
  state: CanvasSessionState;
  /** 是否为根会话 */
  isTopLevel: boolean;
  /** 智能体预设或类型标识 */
  agentType?: string;
  /** 会话创建时间戳 */
  createdAt?: number;
  /** 最近活跃时间戳 */
  lastActiveAt?: number;
  /** 交互指标统计 */
  stats: {
    outboundCalls: number;
    inboundCalls: number;
    postsCount: number;
  };
}

/**
 * 画板黑板公告条目实体
 */
export interface CanvasBoardPostEntity {
  /** 条目唯一 ID */
  id: string;
  /** 业务主题命名空间 */
  topic: string;
  /** 检索标签列表 */
  tags: string[];
  /** 发布者 Session ID */
  authorSessionId: string;
  /** 归属工作区 */
  workspace: string;
  /** 发布时间戳 */
  createdAt: number;
  /** 过期时间戳 */
  expiresAt: number;
  /** 剩余生存毫秒数（非 active 条目归零） */
  ttlRemainingMs: number;
  /** 完整正文内容 */
  content: string;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 条目规范化三态状态：active、archived 或 expired */
  status: CanvasBoardPostStatus;
  /** 是否已被清理或过期（兼容旧版布尔字段） */
  isDismissed: boolean;
}

/**
 * 画板全景遥测聚合快照
 */
export interface CanvasTelemetrySnapshot {
  /** 快照生成时间戳 */
  timestamp: number;
  /** 当前工作区规范化路径 */
  currentWorkspace: string;
  /** 工作区集群列表 */
  workspaces: CanvasWorkspaceEntity[];
  /** 会话节点列表 */
  sessions: CanvasSessionEntity[];
  /** 黑板公告列表 */
  posts: CanvasBoardPostEntity[];
  /** 跨会话调用连线列表 */
  calls: CallTelemetryRecord[];
  /** 全局统计度量 */
  metrics: {
    totalSessions: number;
    runningSessions: number;
    activeCalls: number;
    totalPosts: number;
    activePosts: number;
  };
}

/**
 * 聚合全景遥测查询入参
 */
export interface GetCanvasTelemetryOptions {
  /** 目标工作区路径 */
  workspace?: string;
  /** 是否允许跨工作区查询 */
  crossWorkspace?: boolean;
  /** cross_workspace 兼容别名 */
  cross_workspace?: boolean;
  /** 调用记录返回条数限制 */
  limit?: number;
  /** 关联定位会话 ID */
  sessionId?: string;
  /** 显式注入的 BoardStore 实例 */
  boardStore?: any;
  /** 显式注入的 CallTelemetryRingBuffer 实例 */
  callTelemetry?: CallTelemetryRingBuffer;
}

/**
 * 获取或按上下文解析 CallTelemetryRingBuffer 实例
 */
export declare function getCallTelemetry(
  ctxOrOptions?: any,
  rawOptions?: any
): CallTelemetryRingBuffer;

/**
 * 计算规范化 8 位会话短码
 * 剥离 session- 前缀与非字母数字字符，统一为 8 位小写字符串
 */
export declare function computeSessionShortId(rawId?: string | null): string;

/**
 * 解析会话展示标题，针对 AgentTeams 入场文案及空值进行角色优先/短码保底回退
 */
export declare function resolveCanvasSessionDisplayTitle(
  rawTitle: string | null | undefined,
  agent: any,
  shortId?: string
): string;

/**
 * 聚合全景画板遥测快照，只读且不唤醒目标会话
 */
export declare function getCanvasTelemetry(
  ctx: any,
  options?: GetCanvasTelemetryOptions
): Promise<CanvasTelemetrySnapshot>;
