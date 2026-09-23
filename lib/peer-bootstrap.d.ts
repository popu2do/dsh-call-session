/**
 * @module dsh-call-session/lib/peer-bootstrap
 * Declarations for PeerBootstrapper and lifecycle bootstrap helpers.
 */

export interface FormatInitialMessageParams {
  initialMessage?: string;
  contextPostIds?: string[];
  callerTitle?: string;
  generateMessageId?: () => string;
}

export interface DispatchInitialMessageOptions {
  logger?: any;
}

export interface PublishBootstrapNoticeParams {
  targetAgent?: any;
  peerSessionId?: string;
  finalTitle?: string;
  callerSessionId?: string;
  callerTitle?: string;
  callerWorkspace?: string;
  targetGeneration?: number;
}

export interface PublishBootstrapNoticeOptions {
  logger?: any;
}

export interface BootstrapPeerSessionParams {
  targetAgent: any;
  callerSessionId?: string;
  callerTitle?: string;
  callerWorkspace?: string;
  initialMessage?: string;
  contextPostIds?: string[];
  boardStore?: any;
  targetGeneration?: number;
  finalTitle?: string;
  logger?: any;
  generateMessageId?: () => string;
}

export interface BootstrapPeerSessionResult {
  status: 'running' | 'idle';
  bootstrapPostId: string | null;
}

export interface PeerBootstrapperOptions {
  logger?: any;
  boardStore?: any;
  generateMessageId?: () => string;
}

export declare function formatInitialMessage(
  params?: FormatInitialMessageParams
): any | null;

export declare function dispatchInitialMessage(
  targetAgent: any,
  messagePayload: any,
  options?: DispatchInitialMessageOptions
): 'running' | 'idle';

export declare function publishBootstrapNotice(
  boardStore: any,
  params?: PublishBootstrapNoticeParams,
  options?: PublishBootstrapNoticeOptions
): string | null;

export declare function bootstrapPeerSession(
  params?: BootstrapPeerSessionParams
): BootstrapPeerSessionResult;

export declare class PeerBootstrapper {
  readonly options: PeerBootstrapperOptions;
  readonly logger: any;
  readonly boardStore: any;
  readonly generateMessageId?: () => string;

  constructor(options?: PeerBootstrapperOptions);

  formatInitialMessage(params?: FormatInitialMessageParams): any | null;
  dispatchInitialMessage(
    targetAgent: any,
    messagePayload: any,
    options?: DispatchInitialMessageOptions
  ): 'running' | 'idle';
  publishBootstrapNotice(
    boardStoreOrParams?: any,
    maybeParams?: PublishBootstrapNoticeParams,
    maybeOptions?: PublishBootstrapNoticeOptions
  ): string | null;
  bootstrap(params?: BootstrapPeerSessionParams): BootstrapPeerSessionResult;

  static formatInitialMessage(params?: FormatInitialMessageParams): any | null;
  static dispatchInitialMessage(
    targetAgent: any,
    messagePayload: any,
    options?: DispatchInitialMessageOptions
  ): 'running' | 'idle';
  static publishBootstrapNotice(
    boardStore: any,
    params?: PublishBootstrapNoticeParams,
    options?: PublishBootstrapNoticeOptions
  ): string | null;
  static bootstrap(params?: BootstrapPeerSessionParams): BootstrapPeerSessionResult;
}
