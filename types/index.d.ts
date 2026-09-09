/**
 * @module dsh-call-session
 * DSH 跨会话协同与公共黑板插件
 *
 * 核心功能：
 * 1. 工具：
 *    - board_post, board_list, board_clear: 共享黑板发布、查询与管理
 *    - session_call: 进程内会话单播通信（steer/followup）
 *    - session_query: 会话发现、工作区过滤与状态规范化
 * 2. Web 命令：
 *    - /dsh-call-session: 单播呼叫与黑板标题摘要
 * 3. 生命周期：
 *    - 支持 dispose 事件清理与持久化
 */

import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';

import {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText,
  type BoardPost,
  type BoardPostStatus,
  type BoardClearAction,
  type BoardPostArgs,
  type BoardTitleItem,
  type BoardListOptions,
  type BoardListResult,
  type BoardClearOptions,
  type BoardClearResult,
  type BoardStoreOptions
} from './board-store.js';

import {
  CALL_TYPE_INTENTS,
  dispatchNativeMessage,
  executeSessionCall,
  type CallType,
  type DeliveryMode,
  type SessionStatus,
  type SessionCallArgs,
  type SessionCallResult,
  type NativeUserMessage
} from './session-call.js';

import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  type SessionInfo,
  type SessionQueryArgs,
  type SessionQueryResult
} from './session-query.js';

import {
  executeSessionCreate,
  PEER_SESSION_CONSTANTS,
  type SessionCreateArgs,
  type SessionCreateResult
} from './session-create.js';

import {
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  type CanvasCallType,
  type CanvasDeliveryMode,
  type CanvasSessionState,
  type CallTelemetryRecord,
  type CallTelemetryFilter,
  type CanvasWorkspaceEntity,
  type CanvasSessionEntity,
  type CanvasBoardPostEntity,
  type CanvasTelemetrySnapshot,
  type GetCanvasTelemetryOptions
} from './call-telemetry.js';

import {
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS,
  type AuthenticatedWebRoutes
} from './web-telemetry-route.js';

/** Cordis 插件唯一识别名 */
export declare const name = 'dsh-call-session';

/** 声明式依赖注入服务清单（必需与渐进增强可选服务） */
export declare const inject: readonly ['agents', 'tools', 'commands', 'systemPrompt'];

/** 跨会话调度相关常量集合 */
export declare const DISPATCHER_CONSTANTS: Readonly<{
  TARGET_WILDCARDS: ReadonlySet<string>;
  LIMITS: Readonly<{
    MIN_PREFIX_LENGTH: number;
    SUMMARY_MAX_LENGTH: number;
    MESSAGE_MAX_LENGTH: number;
  }>;
  CALL_TYPES: readonly ['task_dispatch', 'task_report', 'notice'];
}>;

/**
 * 插件运行时配置项定义
 */
export interface CallSessionConfig {
  /** 是否启用跨会话通信与公共黑板插件，默认 true */
  enabled?: boolean;
  /** 黑板持久化文件存储路径，默认指向插件根目录下 board.json */
  storagePath?: string;
  /** 黑板数据持久化防抖延迟（毫秒），默认 300 */
  debounceMs?: number;
  /** 黑板保留条目上限（FIFO 淘汰），默认 200 */
  maxCapacity?: number;
  /** 跨会话调用遥测环形缓冲区保留上限（FIFO 淘汰），默认 200 */
  telemetryCapacity?: number;
  /** 注入全局 System Prompt 的排序权重，默认 118 */
  promptSectionOrder?: number;
  /** 记名提醒注入 System Prompt Context 的排序权重，默认 130 */
  remindContextOrder?: number;
  /** 是否注册 /dsh-call-session 斜杠命令，默认 true */
  slashCommand?: boolean;
}

/**
 * Schemastery 强类型配置 Schema 定义
 */
export declare const Config: z.Schema<CallSessionConfig>;

/**
 * 返回注入全局 System Prompt 的跨会话协作指南模型段落文本
 *
 * @returns Markdown 格式的模型引导提示词
 */
export declare function usageSectionText(): string;

/**
 * Cordis 插件激活与核心生命周期装配函数
 *
 * @param ctx Cordis 上下文
 * @param config 插件配置项
 */
export declare function apply(ctx: Context, config?: CallSessionConfig): void;

declare const _default: {
  name: typeof name;
  inject: typeof inject;
  Config: typeof Config;
  apply: typeof apply;
  usageSectionText: typeof usageSectionText;
};
export default _default;

export {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText,
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  executeSessionCreate,
  PEER_SESSION_CONSTANTS,
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS
};

export type {
  BoardPost,
  BoardPostStatus,
  BoardClearAction,
  BoardPostArgs,
  BoardTitleItem,
  BoardListOptions,
  BoardListResult,
  BoardClearOptions,
  BoardClearResult,
  BoardStoreOptions,
  CallType,
  DeliveryMode,
  SessionStatus,
  SessionCallArgs,
  SessionCallResult,
  NativeUserMessage,
  SessionInfo,
  SessionQueryArgs,
  SessionQueryResult,
  SessionCreateArgs,
  SessionCreateResult,
  CanvasCallType,
  CanvasDeliveryMode,
  CanvasSessionState,
  CallTelemetryRecord,
  CallTelemetryFilter,
  CanvasWorkspaceEntity,
  CanvasSessionEntity,
  CanvasBoardPostEntity,
  CanvasTelemetrySnapshot,
  GetCanvasTelemetryOptions,
  AuthenticatedWebRoutes
};
