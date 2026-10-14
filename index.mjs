/**
 * DSH Cross-Session Collaboration & Blackboard Plugin
 *
 * Capabilities:
 * 1. Native Tools:
 *    - board_post, board_list, board_clear: Shared state blackboard storage and queries
 *    - session_call: In-process unicast communication (steer/followup)
 *    - session_query: Active session discovery with workspace filtering
 * 2. Lifecycle Disposal:
 *    - Reversible cleanup and state persistence on dispose
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardStore,
  AtomicBoardStore,
  extractTitle,
  formatAuthorReminderText,
  RESERVED_TOPIC_PREFIXES,
  isReservedTopic,
  getReservedTopicErrorMessage
} from './lib/board-store.mjs';
import {
  normalizeWorkspace
} from './lib/workspace.mjs';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery
} from './lib/session-query.mjs';
import { SessionDirectory } from './lib/session-directory.mjs';
import {
  executeSessionCall
} from './lib/session-call.mjs';
import {
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  buildTransportPayload
} from './lib/native-message-transport.mjs';
import {
  PeerSessionFactory,
  executeSessionCreate,
  PEER_SESSION_CONSTANTS
} from './lib/session-create.mjs';
import {
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
} from './lib/call-telemetry.mjs';
import {
  resolveLocale,
  getCatalog,
  resolveMessages
} from './lib/locales/index.mjs';
import {
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS
} from './lib/web-telemetry-route.mjs';
import {
  registerNativeTools,
  buildToolDefinitions
} from './lib/tools-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const name = 'dsh-call-session';
export const inject = ['agents', 'tools', 'systemPrompt'];

let zInstance;
try {
  const mod = await import('@deepseek-ai/schemastery');
  zInstance = mod.default || mod;
} catch {
  // Fallback when schemastery is optional or not yet installed
}

/**
 * Schemastery-backed plugin configuration schema.
 */
export const Config = zInstance ? zInstance.object({
  enabled: zInstance.boolean().default(true).description('是否启用跨会话通信与公共黑板插件'),
  storagePath: zInstance.string().description('黑板持久化存储文件路径'),
  debounceMs: zInstance.natural().default(300).description('黑板数据持久化防抖延迟毫秒数'),
  maxCapacity: zInstance.natural().min(10).max(10000).default(200).description('公共黑板保留条目上限，按 FIFO 淘汰'),
  telemetryCapacity: zInstance.natural().min(10).max(2000).default(200).description('跨会话调用看板数据环形缓冲区保留上限，按 FIFO 淘汰'),
  promptSectionOrder: zInstance.natural().default(118).description('注入全局 System Prompt 的排序权重'),
  remindContextOrder: zInstance.natural().default(130).description('记名提醒注入 System Prompt Context 的排序权重'),
  locale: zInstance.union(['auto', 'zh', 'en']).default('auto').description('插件交互语言偏好')
}) : Object.freeze({
  enabled: true,
  debounceMs: 300,
  maxCapacity: 200,
  telemetryCapacity: 200,
  promptSectionOrder: 118,
  remindContextOrder: 130,
  locale: 'auto'
});

/**
 * Returns model-facing cross-session collaboration instructions for System Prompt.
 *
 * @param {any} [ctx] Cordis context
 * @param {any} [config] Plugin configuration
 * @returns {string} Usage instructions in Markdown
 */
export function usageSectionText(ctx, config) {
  const currentLocale = resolveLocale(ctx, config);
  const catalog = getCatalog(currentLocale);
  return catalog.prompts.usageSection();
}

export const DISPATCHER_CONSTANTS = Object.freeze({
  TARGET_WILDCARDS: Object.freeze(new Set(['*', 'all', 'broadcast'])),
  LIMITS: Object.freeze({
    MIN_PREFIX_LENGTH: 8,
    SUMMARY_MAX_LENGTH: 120,
    MESSAGE_MAX_LENGTH: 4000
  }),
  CALL_TYPES: Object.freeze(['task_dispatch', 'task_report', 'notice'])
});

export {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText,
  RESERVED_TOPIC_PREFIXES,
  isReservedTopic,
  getReservedTopicErrorMessage,
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  buildTransportPayload,
  PeerSessionFactory,
  executeSessionCreate,
  PEER_SESSION_CONSTANTS,
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle,
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS,
  SessionDirectory
};

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

export function apply(ctx, config = {}) {
  const logger = (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
    || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
    || noopLogger;
  logger.debug?.('[dsh-call-session] Activating pure DSH Native Collaboration Plugin (zero HTTP, zero envelopes)...');

  const boardStore = new AtomicBoardStore({
    storagePath: config.storagePath || path.resolve(__dirname, 'board.json'),
    debounceMs: config.debounceMs ?? 300,
    maxPosts: config.maxCapacity ?? 200,
    logger,
    ctx,
    config
  });

  const callTelemetry = new CallTelemetryRingBuffer(config.telemetryCapacity ?? 200);
  if (typeof ctx.provide === 'function') {
    ctx.provide('callTelemetry', callTelemetry);
    ctx.provide('boardStore', boardStore);
  } else {
    ctx.callTelemetry = callTelemetry;
    ctx.boardStore = boardStore;
  }
  if (ctx.root && typeof ctx.root.provide === 'function') {
    try { ctx.root.provide('callTelemetry', callTelemetry); } catch {}
    try { ctx.root.provide('boardStore', boardStore); } catch {}
  } else if (ctx.root) {
    try { ctx.root.callTelemetry = callTelemetry; } catch {}
    try { ctx.root.boardStore = boardStore; } catch {}
  }

  // Session archive cascade cleanup listener
  const workspaceRegistry = typeof ctx?.get === 'function'
    ? ctx.get('workspaceRegistry')
    : (ctx?.workspaceRegistry || ctx?.root?.get?.('workspaceRegistry'));
  if (workspaceRegistry && typeof workspaceRegistry.on === 'function') {
    workspaceRegistry.on('archiveSession', (sessionId) => {
      callTelemetry.cleanupSession(sessionId);
    });
  }
  if (typeof ctx.on === 'function') {
    ctx.on('session/archive', (sessionId) => {
      callTelemetry.cleanupSession(typeof sessionId === 'string' ? sessionId : sessionId?.id);
    });
    ctx.on('session/remove', (sessionId) => {
      callTelemetry.cleanupSession(typeof sessionId === 'string' ? sessionId : sessionId?.id);
    });
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', async () => {
      logger.debug?.('[dsh-call-session] Disposing plugin, flushing pending writes...');
      try {
        callTelemetry.clear();
        await boardStore.close();
      } catch (err) {
        logger.warn?.(`[dsh-call-session] Error during dispose flush: ${err?.message || err}`);
      }
    });
  }

  // Read-only telemetry Web surface for the Canvas view. A webless profile
  // keeps the plugin tool-only instead of blocking boot.
  installTelemetryWebSurface(ctx, { logger });

  if (config.enabled !== false && ctx.systemPrompt && typeof ctx.systemPrompt.add === 'function') {
    ctx.systemPrompt.add('dsh-call-session:usage', () => usageSectionText(ctx, config), {
      order: config.promptSectionOrder ?? 118
    });
  }

  if (config.enabled !== false && ctx.systemPrompt && typeof ctx.systemPrompt.context === 'function') {
    ctx.systemPrompt.context({
      name: 'board:remind',
      order: config.remindContextOrder ?? 130,
      text: (context) => boardStore.getAuthorReminder(context?.agent, ctx, config)
    });
  }

  registerNativeTools(ctx, { boardStore, config, logger });

  logger.debug?.('[dsh-call-session] Plugin initialized.');
}

export const provide = ['callTelemetry', 'boardStore'];

export default {
  name,
  inject,
  provide,
  Config,
  apply,
  usageSectionText
};