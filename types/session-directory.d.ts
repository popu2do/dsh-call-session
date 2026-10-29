/**
 * @module dsh-call-session/session-directory
 * 会话目录管理、身份解析与目标匹配模块
 */

import type { SessionInfo } from './session-query.js';

export interface SessionIdentityInfo {
  sessionId: string;
  title: string;
  displayTitle: string;
  shortId: string;
  cwd: string;
  workspace: string;
  status: 'running' | 'idle';
  origin: string;
  isSubagent: boolean;
  blank: boolean;
}

export interface WorkspaceInspectionResult {
  count: number;
  activeTitles: Set<string>;
}

export interface TargetResolutionResult {
  targetAgent: any;
  targetTitle: string;
  targetShortId: string;
  targetWorkspace: string;
}

export interface ListActiveSessionsOptions {
  workspace?: string;
  crossWorkspace?: boolean;
  topLevelOnly?: boolean;
  runningOnly?: boolean;
  query?: string;
  limit?: number;
  callerSessionId?: string | null;
  exec?: any;
}

export declare class SessionDirectory {
  ctx: any;
  logger: any;

  constructor(ctx?: any, options?: { logger?: any });

  getAgentsService(exec?: any): any;
  getArchivedSessionIds(): Set<string>;
  isRegisteredWorkspace(workspacePath: string): boolean | null;
  resolveCwd(agent: any): string;
  resolveWorkspace(agent: any): string;
  resolveTitle(agent: any): string;
  resolveShortId(agentOrId: any): string;
  resolveDisplayTitle(agent: any, rawTitle?: string): string;
  resolveIdentity(agent: any): SessionIdentityInfo;
  listActiveSessions(options?: ListActiveSessionsOptions): SessionInfo[];
  inspectWorkspace(callerWorkspace: string, options?: any): WorkspaceInspectionResult;
  resolveTarget(
    rawTarget: string,
    options?: {
      callerSessionId?: string;
      callerAgent?: any;
      exec?: any;
      /**
       * 冷恢复时解析 agentOptions 的注入解析器；返回 undefined 表示不挂载。
       */
      resolveResumeAgentOptions?: () => { provider?: string; model?: string; reasoningEffort?: string } | undefined;
    }
  ): Promise<TargetResolutionResult>;
}

export declare function computeSessionShortId(rawId?: string): string;
export declare function isHumanReadableTitle(title?: string | null): boolean;
export declare function resolveCanvasSessionDisplayTitle(rawTitle?: string, agent?: any, shortId?: string): string;
export declare function resolveWorkspaceRegistry(ctx: any): any | undefined;
export declare function getArchivedSessionIds(ctx: any): Set<string>;
/**
 * 判定目标工作区是否为宿主已注册工作区；null 表示宿主未暴露注册表，调用方应失败关闭。
 */
export declare function isRegisteredWorkspace(ctx: any, workspacePath: string): boolean | null;
export declare function resolveSessionCwd(agent: any): string;
export declare function resolveSessionTitle(ctx: any, agent: any): string;
export declare function resolveAgentsService(ctx: any, exec?: any): any;
export interface ClassifiedError {
  category: 'ASSEMBLY' | 'RUNTIME' | 'PREFLIGHT' | 'DISPATCH' | 'TIMEOUT' | string;
  code: string;
  message: string;
  fatal?: boolean;
  details?: unknown;
}
export interface CausalRunningParams {
  statusRes?: { status: string };
  finalCheck?: { status: string };
  targetAgent: any;
  initialTargetRunning?: boolean;
  initialStepCount?: number;
  initialStepStartCount?: number;
  initialTurnCount?: number;
}
export declare function checkCausalRunning(params?: CausalRunningParams): boolean;
export declare function checkCausalRunningFinal(params?: CausalRunningParams): boolean;
export declare function classifyError(rawError: any): ClassifiedError;
export declare function resolveNativeSessionStatus(agent: any): { status: import('./session-call.js').SessionStatus; error: ClassifiedError | any | null };
