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
    }
  ): Promise<TargetResolutionResult>;
}

export declare function computeSessionShortId(rawId?: string): string;
export declare function isHumanReadableTitle(title?: string | null): boolean;
export declare function resolveCanvasSessionDisplayTitle(rawTitle?: string, agent?: any, shortId?: string): string;
export declare function getArchivedSessionIds(ctx: any): Set<string>;
export declare function resolveSessionCwd(agent: any): string;
export declare function resolveSessionTitle(ctx: any, agent: any): string;
export declare function resolveAgentsService(ctx: any, exec?: any): any;
