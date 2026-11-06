/**
 * @module dsh-call-session/turn-stopping-guard
 * 轮次收尾守卫：会话带着未结履约任务即将转 idle 时，投递一条原生催办消息把回合顶回去
 */

export declare const MAX_REPORT_REMINDERS: number;

/** 宿主传给 `agent/turn-stopping` 监听器的载荷，agent 是活对象，缺省表示宿主未提供 */
export interface TurnStoppingPayload {
  turn: number;
  signal?: AbortSignal;
  agent?: Record<string, unknown>;
}

export declare function resolveAgentSessionId(agent?: Record<string, unknown>): string | undefined;

/** 账本里一条待办的最小投影，守卫只读这几项 */
export interface GuardPendingTask {
  callType: string;
  callerSessionId?: string;
  callerTitle?: string;
}

export interface TurnStoppingGuardDeps {
  getPendingTasksForSession(sessionId: string): GuardPendingTask[];
  buildReminder(pendingTasks: GuardPendingTask[]): string;
  /** 宿主只接受原生 UserMessage，字符串载荷会让整个回合以未知错误结束；见模块文档。 */
  buildUserMessage(reminder: string, agent?: unknown, pendingTasks?: GuardPendingTask[]): Record<string, unknown>;
  logger?: { warn?(message: string): void };
}

export declare function createTurnStoppingGuard(deps: TurnStoppingGuardDeps): {
  handleTurnStopping(payload: TurnStoppingPayload): Promise<void>;
  /** 交给 ctx.on('agent/turn-stopping', …) 的稳定引用，重启自检据此判断是否已注册 */
  hookListener(payload: TurnStoppingPayload): Promise<void>;
  forgetSession(sessionId?: string): void;
};
