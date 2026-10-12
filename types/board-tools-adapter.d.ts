/**
 * @module dsh-call-session/board-tools-adapter
 * 公共黑板工具适配器与执行门面
 */

import type { BoardPost } from './board-store.js';

export declare const RESERVED_TOPIC_PREFIXES: readonly string[];

export declare function isReservedTopic(topic: string | null | undefined): boolean;

export declare function getReservedTopicErrorMessage(topic: string): string;

export declare function formatAuthorReminderText(posts: BoardPost[], locale?: string): string;

export declare function normalizeExecParams(
  argsOrParams?: { args?: any; exec?: any; ctx?: any } | any,
  maybeExec?: any,
  maybeCtx?: any
): { args: any; exec: any; ctx: any };

export declare class BoardToolsAdapter {
  store: any;
  ctx: any;
  config: any;
  logger: any;

  constructor(store: any, options?: { ctx?: any; config?: any; logger?: any });

  getMessages(ctx?: any): any;
  validateTopic(topic: string): void;
  filterDirtyPosts(rawPosts: any[], logger?: any): { cleanedPosts: any[]; dirtyCount: number };
  post(record: BoardPost): BoardPost;
  resolveCallerContext(agent: any, ctx?: any): { authorSessionId: string; authorTitle: string; callerWorkspace: string };
  executePost(argsOrParams?: any, maybeExec?: any, maybeCtx?: any): Promise<any>;
  executeList(argsOrParams?: any, maybeExec?: any, maybeCtx?: any): Promise<any>;
  executeClear(argsOrParams?: any, maybeExec?: any, maybeCtx?: any): Promise<any>;
  getAuthorReminder(agent?: any, ctx?: any, config?: any): string;
}
