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
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText,
  RESERVED_TOPIC_PREFIXES,
  isReservedTopic,
  getReservedTopicErrorMessage
} from './lib/board-store.mjs';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery
} from './lib/session-query.mjs';
import { SessionDirectory } from './lib/session-directory.mjs';
import {
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  buildTransportPayload
} from './lib/session-call.mjs';
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

  const currentLocale = resolveLocale(ctx, config);
  const catalog = getCatalog(currentLocale);

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

  function renderToolMessage(value, fallbackFn) {
    if (value?.message) return value.message;
    return typeof fallbackFn === 'function' ? fallbackFn() : '';
  }

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    const registerSafe = (toolDef) => {
      try {
        const existing = typeof ctx.tools?.get === 'function' ? ctx.tools.get(toolDef.name) : null;
        if (existing) {
          logger.debug?.(`[dsh-call-session] Tool "${toolDef.name}" is already in registry, updating execute/output.`);
          existing.execute = toolDef.execute;
          if (toolDef.output) existing.output = toolDef.output;
          return;
        }
        ctx.tools.register(toolDef);
        logger.debug?.(`[dsh-call-session] Tool "${toolDef.name}" registered successfully.`);
      } catch (err) {
        logger.warn?.(`[dsh-call-session] Failed to register tool "${toolDef.name}": ${err?.message || err}`);
      }
    };

    registerSafe({
      name: 'board_post',
      description: catalog.tools.board_post.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: catalog.tools.board_post.parameters.topic
          },
          content: {
            type: 'string',
            minLength: 1,
            maxLength: 65536,
            description: catalog.tools.board_post.parameters.content
          },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 32 },
            maxItems: 10,
            description: catalog.tools.board_post.parameters.tags
          },
          ttl: {
            type: 'integer',
            minimum: 0,
            maximum: 86400,
            default: 3600,
            description: catalog.tools.board_post.parameters.ttl
          },
          metadata: {
            type: 'object',
            description: catalog.tools.board_post.parameters.metadata
          }
        },
        required: ['topic', 'content']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            postId: { type: 'string' },
            topic: { type: 'string' },
            authorSessionId: { type: 'string' },
            createdAt: { type: 'string' },
            expiresAt: { type: 'string' },
            scope: { type: 'string' },
            message: { type: 'string' },
            error: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: renderToolMessage(value, () => value?.success ? resolveMessages(ctx, config).boardPostSuccess(value?.postId) : resolveMessages(ctx, config).boardPostFailure(value?.error))
          }];
        }
      },
      execute: (args, exec) => {
        return boardStore.executePost({ args, exec, ctx });
      }
    });

    registerSafe({
      name: 'board_list',
      description: catalog.tools.board_list.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: catalog.tools.board_list.parameters.id
          },
          topic: {
            type: 'string',
            description: catalog.tools.board_list.parameters.topic
          },
          topic_prefix: {
            type: 'string',
            description: catalog.tools.board_list.parameters.topic_prefix
          },
          tag: {
            type: 'string',
            description: catalog.tools.board_list.parameters.tag
          },
          active_only: {
            type: 'boolean',
            default: true,
            description: catalog.tools.board_list.parameters.active_only
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: catalog.tools.board_list.parameters.cross_workspace
          },
          titles_only: {
            type: 'boolean',
            default: true,
            description: catalog.tools.board_list.parameters.titles_only
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: catalog.tools.board_list.parameters.limit
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            count: { type: 'number' },
            scope: { type: 'string' },
            titlesOnly: { type: 'boolean' },
            posts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  topic: { type: 'string' },
                  content: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  authorSessionId: { type: 'string' },
                  authorTitle: { type: 'string' },
                  authorWorkspace: { type: 'string' },
                  createdAt: { type: 'string' },
                  expiresAt: { type: 'string' },
                  status: { type: 'string' },
                  scope: { type: 'string' }
                },
                additionalProperties: true
              }
            }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2)
          }];
        }
      },
      execute: (args, exec) => {
        return boardStore.executeList({ args, exec, ctx });
      }
    });

    registerSafe({
      name: 'board_clear',
      description: catalog.tools.board_clear.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: catalog.tools.board_clear.parameters.id
          },
          topic: {
            type: 'string',
            description: catalog.tools.board_clear.parameters.topic
          },
          mode: {
            type: 'string',
            enum: ['dismiss', 'purge'],
            default: 'dismiss',
            description: catalog.tools.board_clear.parameters.mode
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            clearedCount: { type: 'number' },
            action: { type: 'string' },
            message: { type: 'string' },
            error: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: renderToolMessage(value, () => value?.success ? resolveMessages(ctx, config).boardClearSuccess(value?.clearedCount, value?.action) : resolveMessages(ctx, config).boardClearFailure(value?.error))
          }];
        }
      },
      execute: (args, exec) => {
        return boardStore.executeClear({ args, exec, ctx });
      }
    });

    registerSafe({
      name: 'session_call',
      description: catalog.tools.session_call.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          target_session_id: {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            description: catalog.tools.session_call.parameters.target_session_id
          },
          message: {
            type: 'string',
            minLength: 1,
            maxLength: 4000,
            description: catalog.tools.session_call.parameters.message
          },
          call_type: {
            type: 'string',
            enum: ['task_dispatch', 'task_report', 'notice'],
            default: 'task_dispatch',
            description: catalog.tools.session_call.parameters.call_type
          },
          context_post_ids: {
            type: 'array',
            items: { type: 'string' },
            description: catalog.tools.session_call.parameters.context_post_ids
          }
        },
        required: ['target_session_id', 'message']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            targetSessionId: { type: 'string' },
            targetTitle: { type: 'string' },
            targetStatus: { type: 'string' },
            deliveryMode: { type: 'string' },
            callType: { type: 'string' },
            callerSessionId: { type: 'string' },
            contextPostIds: {
              type: 'array',
              items: { type: 'string' }
            },
            message: { type: 'string' },
            error: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: renderToolMessage(value, () => value?.success ? resolveMessages(ctx, config).sessionCallSuccess(value?.targetSessionId, value?.deliveryMode, value?.callType) : resolveMessages(ctx, config).sessionCallFailure(value?.error))
          }];
        }
      },
      execute: async (args, exec) => {
        return executeSessionCall({ ctx, args, exec, options: { logger, config } });
      }
    });

    registerSafe({
      name: 'session_query',
      description: catalog.tools.session_query.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: catalog.tools.session_query.parameters.query
          },
          running_only: {
            type: 'boolean',
            default: false,
            description: catalog.tools.session_query.parameters.running_only
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: catalog.tools.session_query.parameters.cross_workspace
          },
          top_level_only: {
            type: 'boolean',
            default: true,
            description: catalog.tools.session_query.parameters.top_level_only
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: catalog.tools.session_query.parameters.limit
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
            totalCount: { type: 'integer' },
            activeCount: { type: 'integer' },
            idleCount: { type: 'integer' },
            scope: { type: 'string' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'string', enum: ['running', 'idle'] },
                  workspace: { type: 'string' },
                  cwd: { type: 'string' },
                  isCurrent: { type: 'boolean' }
                },
                required: ['sessionId', 'title', 'status', 'workspace', 'isCurrent']
              }
            }
          },
          required: ['totalCount', 'activeCount', 'idleCount', 'sessions']
        },
        render(_args, value) {
          const sessions = Array.isArray(value?.sessions) ? value.sessions : [];
          const total = typeof value?.totalCount === 'number' ? value.totalCount : sessions.length;
          const active = typeof value?.activeCount === 'number' ? value.activeCount : sessions.filter(s => s.status === 'running').length;
          const idle = typeof value?.idleCount === 'number' ? value.idleCount : sessions.filter(s => s.status === 'idle').length;

          const counts = { total, active, idle };
          const msg = resolveMessages(ctx, config);
          if (sessions.length === 0) {
            return [{
              type: 'text',
              text: msg.sessionQueryEmpty(counts)
            }];
          }

          return [{
            type: 'text',
            text: msg.sessionQueryOverview(sessions, counts)
          }];
        }
      },
      execute: async (args, exec) => {
        return executeSessionQuery({ ctx, args, exec });
      }
    });

    registerSafe({
      name: 'session_create',
      description: catalog.tools.session_create.description,
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 60,
            description: catalog.tools.session_create.parameters.title
          },
          initial_message: {
            type: 'string',
            maxLength: 4000,
            description: catalog.tools.session_create.parameters.initial_message
          },
          context_post_ids: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
            description: catalog.tools.session_create.parameters.context_post_ids
          },
          model: {
            type: 'string',
            description: catalog.tools.session_create.parameters.model
          },
          reasoning_effort: {
            type: 'string',
            description: catalog.tools.session_create.parameters.reasoning_effort
          },
          preset: {
            type: 'string',
            description: catalog.tools.session_create.parameters.preset
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            sessionId: { type: 'string' },
            title: { type: 'string' },
            workspace: { type: 'string' },
            status: { type: 'string' },
            generation: { type: 'number' },
            bootstrapPostId: { type: ['string', 'null'] },
            contextPostIds: {
              type: 'array',
              items: { type: 'string' }
            },
            error: { type: ['string', 'null'] },
            message: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: renderToolMessage(value, () => value?.success ? resolveMessages(ctx, config).sessionCreateSuccess(value?.sessionId, value?.title, value?.status, value?.generation) : resolveMessages(ctx, config).sessionCreateFailure(value?.error))
          }];
        }
      },
      execute: async (args, exec) => {
        const factory = new PeerSessionFactory(ctx, { boardStore, config });
        return factory.create({ args, exec, options: { config } });
      }
    });
  }

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