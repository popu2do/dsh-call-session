/**
 * @module dsh-call-session/session-create
 * 平级会话创建与受控生命周期契约
 */
import { SessionStatus } from './session-call.js';

export interface SessionCreateArgs {
  /** 同级会话的人类可读标题。禁止特权前缀与换行符。 */
  title?: string;
  /** 点火初始任务指令，会话创建后立即自动投递并启动第一轮。 */
  initial_message?: string;
  /** 可选关联的黑板条目 ID 列表，将自动挂载至初始任务指令首部。 */
  context_post_ids?: string[];
  /** 可选覆写目标会话所使用的模型 ID。默认继承当前会话模型。 */
  model?: string;
  /** 可选显式指定 Session ID（测试或受控场景使用） */
  sessionId?: string;
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
  /** 平级派生代际深度（Root=0, Child=1, Gen2=2） */
  generation: number;
  /** 就绪公告关联的黑板条目 ID（可选） */
  bootstrapPostId?: string | null;
  /** 失败原因描述（仅在失败时提供） */
  error?: string;
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

export declare function checkRateLimit(callerSessionId: string, now?: number): void;

export declare function resolveRootAgentsService(ctx: any, exec?: any): any;

export declare function resolvePeerTitle(params: {
  title?: string;
  initial_message?: string;
  activeTitles?: Set<string>;
}): string;

export declare function inspectWorkspaceActiveSessions(
  agentsService: any,
  callerWorkspace: string,
  archivedIds: Set<string>,
  ctx: any
): { count: number; activeTitles: Set<string> };

export declare function executeSessionCreate(
  ctxOrOptions: any,
  rawArgs?: SessionCreateArgs,
  rawExec?: any,
  rawOptions?: any
): Promise<SessionCreateResult>;
