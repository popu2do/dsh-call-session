/**
 * @module dsh-call-session/session-query
 * DSH 原生会话发现、状态两态规约与工作区隔离服务
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
  /** 严格两态化规范状态：'running' | 'idle' */
  status: SessionStatus;
  /** 会话所属工程工作目录路径 */
  cwd: string;
}

/**
 * session_query 工具调用入参
 */
export interface SessionQueryArgs {
  /** 模糊搜索关键词（大小写不敏感匹配 Session ID 或 Title） */
  query?: string;
  /** 是否仅查询处于 running 运行态的会话，默认 false（返回 running 和 idle） */
  running_only?: boolean;
  /** 活跃会话查询别名（兼容性传参） */
  active_only?: boolean | 'running';
  /** 是否跨工程穿透查询所有工作区的会话，默认 false（严格限定当前工程） */
  cross_workspace?: boolean;
  /** 是否仅列出顶层根会话（排除子代理 subagent 与 blank 匿名会话），默认 true */
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
  /** 本次查询生效的作用域（当前工作区路径或 'global'） */
  scope: string;
  /** 是否进行了跨工程工作区穿透 */
  crossWorkspace: boolean;
  /** 匹配的会话明细列表 */
  sessions: SessionInfo[];
  /** 错误信息描述（仅在失败时提供） */
  error?: string;
}

/**
 * 获取已被归档或废弃的 Session ID 集合（不区分大小写检索）
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
 * 健壮探测并解析 DSH 宿主 agents 原生调度服务
 * 支持从调用上下文 ctx、exec.agent.ctx、ctx.root 及显式服务依赖中多源降级寻址
 *
 * @param ctx Cordis 上下文
 * @param exec 工具执行上下文
 * @returns DSH 原生 agents 服务实例或 null
 */
export declare function resolveAgentsService(ctx: any, exec?: any): any;

/**
 * 执行原生会话查询、多级作用域过滤与两态规约逻辑
 *
 * @param ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param rawArgs session_query 入参
 * @param rawExec 工具执行上下文（用于提取调用方所在工作区）
 * @returns 符合规约的查询结果结构
 */
export declare function executeSessionQuery(
  ctxOrOptions: any,
  rawArgs?: SessionQueryArgs,
  rawExec?: any
): SessionQueryResult;
