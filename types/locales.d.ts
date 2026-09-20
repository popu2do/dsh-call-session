/**
 * Type declarations for dsh-call-session localization catalogs
 */

export type SupportedLocale = 'zh' | 'en';

export interface ToolCatalogItem<TParams extends string = string> {
  name: string;
  description: string;
  parameters: Record<TParams, string>;
}

export interface SessionQueryCounts {
  total: number;
  active: number;
  idle: number;
}

export interface LocaleMessages {
  boardPostSuccess: (postId: string) => string;
  boardPostFailure: (error: string) => string;
  boardClearSuccess: (count: number, action: string) => string;
  boardClearFailure: (error?: string) => string;
  sessionCallSuccess: (targetSessionId: string, deliveryMode: string, callType: string) => string;
  sessionCallFailure: (error?: string) => string;
  sessionCreateSuccess: (sessionId: string, title: string, status: string, generation: number) => string;
  sessionCreateFailure: (error?: string) => string;
  sessionQueryEmpty: (counts: SessionQueryCounts) => string;
  sessionQueryOverview: (rows: any[], counts: SessionQueryCounts) => string;
}

export interface LocaleTools {
  board_post: ToolCatalogItem<'topic' | 'content' | 'tags' | 'ttl' | 'metadata'>;
  board_list: ToolCatalogItem<'id' | 'topic' | 'topic_prefix' | 'tag' | 'active_only' | 'cross_workspace' | 'titles_only' | 'limit'>;
  board_clear: ToolCatalogItem<'id' | 'topic' | 'mode'>;
  session_call: ToolCatalogItem<'target_session_id' | 'message' | 'call_type' | 'context_post_ids'>;
  session_query: ToolCatalogItem<'query' | 'running_only' | 'cross_workspace' | 'top_level_only' | 'limit'>;
  session_create: ToolCatalogItem<'title' | 'initial_message' | 'context_post_ids' | 'model' | 'reasoning_effort' | 'preset'>;
}

export interface LocaleCatalog {
  locale: SupportedLocale;
  tools: LocaleTools;
  prompts: {
    usageSection: () => string;
    authorReminder: (posts: any[]) => string;
  };
  messages: LocaleMessages;
}

export declare const SUPPORTED_LOCALES: readonly ['zh', 'en'];
export declare const DEFAULT_LOCALE: 'en';
export declare const CATALOGS: {
  readonly zh: LocaleCatalog;
  readonly en: LocaleCatalog;
};

export declare function resolveLocale(ctx?: any, config?: any): SupportedLocale;
export declare function resolveMessages(ctx?: any, config?: any): LocaleMessages;
export declare function getCatalog(locale?: string): LocaleCatalog;

export declare const zh: LocaleCatalog;
export declare const en: LocaleCatalog;
