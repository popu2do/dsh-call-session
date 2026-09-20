import { SessionStatus } from './session-call.js';
import { SessionDirectory } from './session-directory.js';

export interface SessionCreateArgs {
  /** 同级会话标题，不包含特权前缀与换行符。 */
  title?: string;
  /** 初始任务指令，会话创建后立即自动投递并启动第一轮。 */
  initial_message?: string;
  /** 可选关联的黑板条目 ID 列表，将自动挂载至初始任务指令首部。 */
  context_post_ids?: string[];
  /** 可选覆写目标会话所使用的模型 ID。默认继承当前会话模型，除非手动指定。支持 provider/model 格式。 */
  model?: string;
  /** 可选覆写目标会话所使用的推理强度 (如 low, medium, high)。默认继承当前会话推理强度，除非手动指定。 */
  reasoning_effort?: string;
  /** 可选指定挂载的智能体预设 ID。默认继承当前会话或全局默认预设，除非手动指定。 */
  preset?: string;
}

export interface SessionCreateResult {
  /** 创建是否成功 */
  success: boolean;
  /** 新建平级会话 Session ID */
  sessionId: string;
  /** 会话规范化标题 */
  title: string;
  /** 会话所属工作区绝对规范化路径 */
  workspace: string;
  /** 会话就绪状态：'running' | 'idle' */
  status: SessionStatus;
  /** 同级会话代际深度 */
  generation: number;
  /** 就绪公告关联的黑板条目 ID */
  bootstrapPostId?: string | null;
  /** 成功关联挂载的黑板 ID 列表 */
  contextPostIds?: string[];
  /** 本地化执行摘要文本 */
  message?: string;
  /** 失败原因描述 */
  error?: string | null;
}

export interface PeerSessionFactoryOptions {
  logger?: any;
  boardStore?: any;
  directory?: SessionDirectory;
  config?: any;
}

export interface PeerSessionCreateParams {
  args?: SessionCreateArgs;
  exec?: any;
  boardStore?: any;
  options?: any;
}

export declare class PeerSessionFactory {
  ctx: any;
  options: PeerSessionFactoryOptions;
  logger: any;
  directory: SessionDirectory;

  constructor(ctx: any, options?: PeerSessionFactoryOptions);

  static reset(): void;
  static resetRateLimits(): void;
  static resetInFlightCreations(): void;
  static checkRateLimit(callerSessionId: string, now?: number): number | null;
  static assertRateLimit(callerSessionId: string, now?: number): void;
  static recordRateLimit(callerSessionId: string, now?: number): number | null;
  static rollbackRateLimit(callerSessionId: string, timestamp: number): void;
  static resolveTitle(params: {
    title?: string;
    initialMessage?: string;
    activeTitles?: Set<string>;
  }): string;
  static resolveAgentOptions(params?: {
    ctx?: any;
    callerAgent?: any;
    model?: string;
    reasoningEffort?: string;
  }): Record<string, any>;
  static resolvePresetAndSetup(params?: {
    ctx?: any;
    callerAgent?: any;
    args?: any;
    options?: any;
    logger?: any;
  }): Promise<{ presetId?: string; setup?: (agentCtx: any) => Promise<void> | void }>;
  static resolveRootAgentsService(ctx: any, exec?: any): any;

  resolveTitle(params: {
    title?: string;
    initialMessage?: string;
    activeTitles?: Set<string>;
  }): string;
  resolveAgentOptions(params?: {
    callerAgent?: any;
    model?: string;
    reasoningEffort?: string;
  }): Record<string, any>;
  resolvePresetAndSetup(params?: {
    callerAgent?: any;
    args?: any;
    options?: any;
  }): Promise<{ presetId?: string; setup?: (agentCtx: any) => Promise<void> | void }>;
  inspectWorkspace(
    callerWorkspace: string,
    options?: { agentsService?: any; archivedIds?: Set<string> }
  ): { count: number; activeTitles: Set<string> };
  checkRateLimit(callerSessionId: string, now?: number): number | null;
  assertRateLimit(callerSessionId: string, now?: number): void;
  recordRateLimit(callerSessionId: string, now?: number): number | null;
  rollbackRateLimit(callerSessionId: string, timestamp: number): void;
  reset(): void;

  create(
    argsOrParams?: PeerSessionCreateParams | SessionCreateArgs,
    maybeExec?: any,
    maybeOptions?: any
  ): Promise<SessionCreateResult>;
}

export declare const PEER_SESSION_CONSTANTS: Readonly<{
  readonly MAX_ACTIVE_PEER_SESSIONS: 10;
  readonly MAX_CREATIONS_PER_MINUTE: 5;
  readonly MAX_GENERATION: 2;
  readonly MAX_TITLE_LENGTH: 60;
  readonly MAX_INITIAL_MESSAGE_LENGTH: 4000;
  readonly MAX_CONTEXT_POST_IDS: 5;
  readonly PRIVILEGED_PREFIX_REGEX: RegExp;
}>;

export declare function resetRateLimits(): void;

export declare function checkRateLimit(callerSessionId: string, now?: number): number | null;

export declare function assertRateLimit(callerSessionId: string, now?: number): void;

export declare function recordRateLimit(callerSessionId: string, now?: number): number | null;

export declare function rollbackRateLimit(callerSessionId: string, timestamp: number): void;

export declare function resetInFlightCreations(): void;

export declare function resolveRootAgentsService(ctx: any, exec?: any): any;

export declare function resolvePeerTitle(params: {
  title?: string;
  initialMessage?: string;
  activeTitles?: Set<string>;
}): string;

export declare function inspectWorkspaceActiveSessions(
  agentsService: any,
  callerWorkspace: string,
  archivedIds: Set<string>,
  ctx: any
): { count: number; activeTitles: Set<string> };

export declare function resolveDefaultModelSelection(ctx: any): Record<string, any>;

export declare function resolveCallerAgentOptions(callerAgent: any): Record<string, any>;

export declare function resolvePeerAgentOptions(params?: {
  ctx?: any;
  callerAgent?: any;
  model?: string;
  reasoningEffort?: string;
}): Record<string, any>;

export declare function resolvePeerPresetAndSetup(params?: {
  ctx?: any;
  callerAgent?: any;
  args?: any;
  options?: any;
  logger?: any;
}): Promise<{ presetId?: string; setup?: (agentCtx: any) => Promise<void> | void }>;

export declare function executeSessionCreate(
  ctxOrOptions: any,
  rawArgs?: SessionCreateArgs,
  rawExec?: any,
  rawOptions?: any
): Promise<SessionCreateResult>;
