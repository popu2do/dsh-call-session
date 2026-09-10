/**
 * @module dsh-call-session/session-query
 * 会话查询与工作区过滤服务
 */

import type { SessionStatus } from './session-call.js';

/**
 * 结构化会话信息描述对象
 */
export interface SessionInfo {
  /** 会话全局唯一 Session ID */
  sessionId: string;
  /** 会话人类可读标题 */
  title: string;
  /** 规范化状态：'running' | 'idle' */
  status: SessionStatus;
  /** 会话所属工程工作目录路径 */
  cwd: string;
}

/**
 * session_query 工具调用入参
 */
export interface SessionQueryArgs {
  /** 模糊搜索关键词，匹配 Session ID 或 Title */
  query?: string;
  /** 是否仅查询 running 状态的会话，默认 false */
  running_only?: boolean;
  /** 活跃会话查询别名 */
  active_only?: boolean | 'running';
  /** 是否跨工作区查询会话，默认 false */
  cross_workspace?: boolean;
  /** 是否仅列出顶层会话，排除子代理与临时会话，默认 true */
  top_level_only?: boolean;
  /** 返回结果数量上限，默认 50，最大 100 */
  limit?: number;
}

/**
 * session_query 执行返回结果结构
 */
export interface SessionQueryResult {
  /** 查询操作是否成功 */
  success: boolean;
  /** 实际匹配到的会话数量 */
  count: number;
  /** 本次查询生效的作用域 */
  scope: string;
  /** 是否跨工作区查询 */
  crossWorkspace: boolean;
  /** 匹配的会话明细列表 */
  sessions: SessionInfo[];
  /** 失败错误信息 */
  error?: string;
}

/**
 * 获取已被归档或废弃的 Session ID 集合
 *
 * @param ctx Cordis 上下文
 * @returns 包含全部归档会话 ID 的 Set 集合
 */
export declare function getArchivedSessionIds(ctx: any): Set<string>;

/**
 * 安全解析 Agent 实例所属的工作目录绝对路径 (cwd)
 *
 * @param agent Agent 运行时实例
 * @returns 规范的工作目录路径，未获取到时返回空字符串
 */
export declare function resolveSessionCwd(agent: any): string;

/**
 * 解析 Agent 实例的人类可读标题 (title)
 * 按优先级探测 agent.session.title、agent.title、sessionTitle 宿主服务以及 session 事件流
 *
 * @param ctx Cordis 上下文
 * @param agent Agent 运行时实例
 * @returns 提取得到的标题文本
 */
export declare function resolveSessionTitle(ctx: any, agent: any): string;

/**
 * 解析 agents 服务实例
 *
 * @param ctx Cordis 上下文
 * @param exec 工具执行上下文
 * @returns agents 服务实例或 null
 */
export declare function resolveAgentsService(ctx: any, exec?: any): any;

/**
 * 执行会话查询、工作区过滤与状态规范化
 *
 * @param ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param rawArgs session_query 入参
 * @param rawExec 工具执行上下文
 * @returns 符合规约的查询结果结构
 */
export declare function executeSessionQuery(
  ctxOrOptions: any,
  rawArgs?: SessionQueryArgs,
  rawExec?: any
): SessionQueryResult;
