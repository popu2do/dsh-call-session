import type { Agent } from '@deepseek-ai/dsh-agent';

export declare const MAX_REPORT_REMINDERS: number;

export declare function resolveAgentSessionId(agent?: Partial<Agent> | Record<string, unknown>): string | undefined;

export interface TurnStoppingPayload {
  turn: number;
  signal?: AbortSignal;
  agent?: Partial<Agent>;
}

export interface TurnStoppingGuardDeps {
  getPendingTasksForSession(sessionId: string): Array<{ callType: string; callerTitle?: string }>;
  buildReminder(pendingTasks: Array<{ callType: string; callerTitle?: string }>): string;
  /** The host accepts only a native UserMessage on `agent.steer`; see the module doc. */
  buildUserMessage(reminder: string, agent?: unknown): Record<string, unknown>;
  resolveSessionId?(agent?: unknown): string | undefined;
  logger?: { warn?(message: string): void };
}

export declare function createTurnStoppingGuard(deps: TurnStoppingGuardDeps): {
  handleTurnStopping(payload: TurnStoppingPayload): Promise<void>;
  forgetSession(sessionId?: string): void;
};
