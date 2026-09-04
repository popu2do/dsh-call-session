/**
 * @module dsh-call-session
 * DSH 原生跨会话协作、进程内 Session 调度与公共黑板系统 (Cordis 标准插件)
 *
 * 提供原生能力：
 * 1. 原生工具：
 *    - board_post, board_list, board_clear：纯拉取模式共享状态黑板，零被动唤醒副作用
 *    - session_call：严格 1:1 进程内单播通信，自适应 steer/followup 两态分发
 *    - session_query：原生会话发现，默认工作区隔离，严格 running/idle 两态规约
 * 2. Web 界面交互：
 *    - /dsh-call-session：支持快速单播调度与黑板有效标题大屏看板
 * 3. 插件生命周期：
 *    - 完全可逆的 dispose 事件处理与防抖原子落盘保证
 */

import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';

import {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle,
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

/** Cordis 插件唯一识别名 */
export declare const name = 'dsh-call-session';

/** 声明式依赖注入服务清单（必需与渐进增强可选服务） */
export declare const inject: readonly ['agents', 'tools', 'commands', 'systemPrompt'];

/** 跨会话调度安全与治理常量集合 */
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
  /** 是否启用跨会话通信与公共黑板插件（默认 true） */
  enabled?: boolean;
  /** 自定义黑板持久化存储文件路径（默认指向插件根目录 board.json） */
  storagePath?: string;
  /** 黑板数据原子写盘的防抖延迟（毫秒），默认 300ms */
  debounceMs?: number;
  /** 公共黑板最大保留有效条目上限（先进先出淘汰），默认 200 */
  maxCapacity?: number;
  /** 注入全局 System Prompt 指南的排序权重，默认 118 */
  promptSectionOrder?: number;
  /** 是否在 Web GUI 注册 /dsh-call-session 斜杠快捷指令，默认 true */
  slashCommand?: boolean;
}

/** 兼容历史命名的类型别名 */
export type CallAgentConfig = CallSessionConfig;

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
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
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
  SessionQueryResult
};
