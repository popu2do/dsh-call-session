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

export declare function generateMessageId(): string;

export declare function sanitizeContextPostIds(postIds?: unknown): string[];

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
