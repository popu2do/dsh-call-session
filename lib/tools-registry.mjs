/**
 * DSH Native Tools Registry Module
 *
 * Encapsulates registration, schemas, dual-layer output rendering,
 * and dispatch execution for all 6 native collaboration tools:
 * - board_post, board_list, board_clear
 * - session_call, session_query, session_create
 */

import { executeSessionCall } from './session-call.mjs';
import { executeSessionQuery } from './session-directory.mjs';
import { PeerSessionFactory } from './session-create.mjs';
import { resolveLocale, getCatalog, resolveMessages } from './locales/index.mjs';
import { BoardToolsAdapter } from './board-tools-adapter.mjs';

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

function renderToolMessage(value, fallbackFn) {
  if (value?.message) return value.message;
  return typeof fallbackFn === 'function' ? fallbackFn() : '';
}

/**
 * 构造 6 大原生工具定义列表
 *
 * @param {any} ctx Cordis 根上下文
 * @param {object} options
 * @param {any} [options.boardStore] 黑板存储实例
 * @param {BoardToolsAdapter} [options.boardToolsAdapter] 黑板工具适配器实例
 * @param {any} [options.config] 插件配置
 * @param {any} [options.logger] 日志记录器
 * @returns {any[]}
 */
export function buildToolDefinitions(ctx, options = {}) {
  const { boardStore, config = {}, logger = noopLogger } = options;
  const boardToolsAdapter = options.boardToolsAdapter
    || (boardStore ? new BoardToolsAdapter(boardStore, { ctx, config, logger }) : null);
  const currentLocale = resolveLocale(ctx, config);
  const catalog = getCatalog(currentLocale);

  return [
    // 1. board_post
    {
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
        return boardToolsAdapter.executePost({ args, exec, ctx });
      }
    },

    // 2. board_list
    {
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
        return boardToolsAdapter.executeList({ args, exec, ctx });
      }
    },

    // 3. board_clear
    {
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
        return boardToolsAdapter.executeClear({ args, exec, ctx });
      }
    },

    // 4. session_call
    {
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
    },

    // 5. session_query
    {
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
    },

    // 6. session_create
    {
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
          },
          workspace: {
            type: 'string',
            description: catalog.tools.session_create.parameters.workspace
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
            bootstrapPostId: {
              oneOf: [
                { type: 'string' },
                { type: 'null' }
              ]
            },
            contextPostIds: {
              type: 'array',
              items: { type: 'string' }
            },
            error: {
              oneOf: [
                { type: 'string' },
                { type: 'null' }
              ]
            },
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
        const effectiveStore = boardStore || boardToolsAdapter?.store || null;
        const factory = new PeerSessionFactory(ctx, { boardStore: effectiveStore, config });
        return factory.create({ args, exec, options: { config } });
      }
    }
  ];
}

/**
 * 注册插件全量原生工具至 Cordis 工具注册表
 *
 * @param {any} ctx Cordis 根上下文
 * @param {object} options
 * @param {any} [options.boardStore] 黑板存储实例
 * @param {BoardToolsAdapter} [options.boardToolsAdapter] 黑板工具适配器实例
 * @param {any} [options.config] 插件配置
 * @param {any} [options.logger] 日志记录器
 */
export function registerNativeTools(ctx, options = {}) {
  const logger = options.logger || noopLogger;
  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    return;
  }

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

  const tools = buildToolDefinitions(ctx, options);
  for (const tool of tools) {
    registerSafe(tool);
  }
}
