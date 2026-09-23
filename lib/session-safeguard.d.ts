/**
 * @module dsh-call-session/lib/session-safeguard
 * Declarations for SessionSafeguard and atomic AdmissionLease.
 */

export interface SafeguardConstants {
  readonly MAX_ACTIVE_PEER_SESSIONS: number;
  readonly MAX_CONCURRENT_RUNNING_PEER_SESSIONS: number;
  readonly MAX_CREATIONS_PER_MINUTE: number;
  readonly MAX_GENERATION: number;
  readonly RATE_LIMIT_WINDOW_MS: number;
}

export interface PeerSessionConstants extends SafeguardConstants {
  readonly MAX_TITLE_LENGTH: number;
  readonly MAX_INITIAL_MESSAGE_LENGTH: number;
  readonly MAX_CONTEXT_POST_IDS: number;
  readonly PRIVILEGED_PREFIX_REGEX: RegExp;
}

export declare const SAFEGUARD_CONSTANTS: Readonly<SafeguardConstants>;
export declare const PEER_SESSION_CONSTANTS: Readonly<PeerSessionConstants>;

export interface AdmissionLeaseParams {
  safeguard: SessionSafeguard;
  callerSessionId: string;
  workspace: string;
  title: string;
  generation: number;
  timestamp?: number | null;
}

export declare class AdmissionLease {
  readonly safeguard: SessionSafeguard;
  readonly callerSessionId: string;
  readonly workspace: string;
  readonly title: string;
  readonly generation: number;
  readonly timestamp: number | null;
  status: 'acquired' | 'committed' | 'released';

  constructor(params: AdmissionLeaseParams);

  commit(): this;
  release(): this;
  rollback(): this;
}

export interface SessionSafeguardOptions {
  ctx?: any;
  maxGeneration?: number;
  maxActivePeerSessions?: number;
  maxCreationsPerMinute?: number;
  windowMs?: number;
}

export interface AcquireParams {
  callerAgent?: any;
  callerSessionId?: string;
  callerGeneration?: number;
  workspace?: string;
  callerWorkspace?: string;
  title?: string;
  targetTitle?: string;
  now?: number;
  activeCount?: number;
  activeTitles?: Set<string>;
  agentsService?: any;
  archivedIds?: Set<string>;
}

export declare class SessionSafeguard {
  readonly ctx: any;
  readonly maxGeneration: number;
  readonly maxActivePeerSessions: number;
  readonly maxCreationsPerMinute: number;
  readonly windowMs: number;
  readonly rateLimits: Map<string, number[]>;
  readonly inFlightByWorkspace: Map<string, Set<string>>;
  readonly directory: any;

  constructor(options?: SessionSafeguardOptions);

  reset(): void;
  resetRateLimits(): void;
  resetInFlight(): void;
  getInFlightCount(workspace?: string): number;
  getInFlightTitles(workspace?: string): Set<string>;
  checkGeneration(callerGen?: number): number;
  checkQuota(workspace: string, activeCount?: number): void;
  checkTitle(workspace: string, title: string, activeTitles?: Set<string>): void;
  checkRateLimit(callerSessionId: string, now?: number): number | null;
  rollbackRateLimit(callerSessionId: string, timestamp: number): void;
  acquire(params?: AcquireParams): AdmissionLease;
  admit(params?: AcquireParams): AdmissionLease;
}

export declare const defaultSafeguard: SessionSafeguard;
export declare function resetRateLimits(): void;
export declare function resetInFlightCreations(): void;
export declare function checkRateLimit(callerSessionId: string, now?: number): number | null;
export declare function rollbackRateLimit(callerSessionId: string, timestamp: number): void;
export declare function assertRateLimit(callerSessionId: string, now?: number): void;
export declare function recordRateLimit(callerSessionId: string, now?: number): number | null;
export declare function resolvePeerTitle(params: { title?: string; initialMessage?: string; activeTitles?: Set<string> }): string;
export declare function inspectWorkspaceActiveSessions(agentsService: any, callerWorkspace: string, archivedIds: Set<string>, ctx?: any): { count: number; activeTitles: Set<string> };
