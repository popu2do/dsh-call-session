/**
 * @module dsh-call-session/lib/native-message-transport
 * Declarations for native message transport primitives.
 */

export interface CallTypeIntents {
  readonly task_dispatch: string;
  readonly task_report: string;
  readonly notice: string;
}

export declare const CALL_TYPE_INTENTS: Readonly<CallTypeIntents>;
export declare const DEFAULT_BOOTSTRAP_CALLER_ID: string;

export declare function generateMessageId(): string;

export declare function sanitizeContextPostIds(postIds?: unknown): string[];
export declare function sanitizePostIds(postIds?: unknown): string[];

export interface TransportPayloadOptions {
  callerSessionId?: string;
  callerTitle?: string;
  callType?: string;
  contextPostIds?: string[];
  cleanPostIds?: string[];
}

export declare function buildTransportPayload(rawMessage: string, options?: TransportPayloadOptions): string;

export interface NativeUserMessageOptions {
  rawMessage: string;
  form?: 'notice' | 'session_create' | string;
  callerSessionId?: string;
  callerTitle?: string;
  callType?: string;
  contextPostIds?: string[];
  generateMessageId?: () => string;
}

export interface NativeUserMessage {
  id: string;
  role: 'user';
  content: Array<{ type: 'text'; text: string }>;
  source: {
    kind: 'plugin:dsh-call-session';
    form: string;
    summary: string;
  };
}

export declare function buildNativeUserMessage(options: NativeUserMessageOptions): NativeUserMessage;

export declare function dispatchNativeMessage(targetAgent: any, userMessage: NativeUserMessage): 'steer' | 'followup';

/**
 * 目标会话因果计数器快照
 */
export interface CausalCounters {
  /** 会话事件流快照 */
  events: any[];
  /** phase.turn 当前值 */
  turn: number;
  /** phase.step 当前值 */
  step: number;
  /** 事件流中 step/start 事件数量 */
  stepStartCount: number;
  /** 事件流中 turn/end 事件数量 */
  turnEndCount: number;
}

export declare function extractCausalCounters(targetAgent: any): CausalCounters;

/**
 * 轮询中因果确权断言入参
 */
export interface CausalRunningParams {
  statusRes: { status: string; error?: unknown };
  targetAgent: any;
  initialTargetRunning?: boolean;
  initialStepCount?: number;
  initialStepStartCount?: number;
}

/**
 * 窗口期满因果确权断言入参
 */
export interface CausalRunningFinalParams {
  finalCheck: { status: string; error?: unknown };
  targetAgent: any;
  initialTargetRunning?: boolean;
  initialStepCount?: number;
  initialStepStartCount?: number;
  initialTurnCount?: number;
}

export declare function checkCausalRunning(params: CausalRunningParams): boolean;
export declare function checkCausalRunningFinal(params: CausalRunningFinalParams): boolean;

/**
 * 因果执行等待原语入参
 */
export interface CausalWaitOptions {
  targetAgent?: any;
  /** 等待窗口毫秒数，0 表示零延时直采 */
  waitMs?: number;
  /** 状态解析函数，缺省回退原生三态推导 */
  resolveStatus?: (agent: any) => { status: string; error?: unknown };
  initialTargetRunning?: boolean;
  initialStepCount?: number;
  initialStepStartCount?: number;
  initialTurnCount?: number;
  initialTurnEndCount?: number;
  /** 轮询间隔毫秒数 */
  pollIntervalMs?: number;
}

export interface CausalWaitResult {
  deliveryState: 'delivered' | 'enqueued' | 'failed';
  executionState: 'running' | 'pending' | 'crashed' | 'unverified';
  finalStatus: 'running' | 'idle' | 'error';
  executionError: unknown;
}

export declare function waitForCausalExecution(
  targetAgentOrOptions?: any | CausalWaitOptions,
  maybeOptions?: CausalWaitOptions
): Promise<CausalWaitResult>;

/**
 * 复合派发与因果验证原语入参
 */
export interface DispatchAndVerifyOptions {
  targetAgent?: any;
  userMessage?: NativeUserMessage;
  message?: NativeUserMessage;
  callType?: 'task_dispatch' | 'task_report' | 'notice' | string;
  waitMs?: number;
  resolveStatus?: (agent: any) => { status: string; error?: unknown };
  pollIntervalMs?: number;
}

export interface DispatchAndVerifyResult extends CausalWaitResult {
  deliveryMode: 'steer' | 'followup';
}

export declare function dispatchAndVerifyNativeMessage(
  targetAgentOrOptions?: any | DispatchAndVerifyOptions,
  maybeUserMessage?: NativeUserMessage,
  maybeOptions?: DispatchAndVerifyOptions
): Promise<DispatchAndVerifyResult>;
