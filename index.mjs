/**
 * DSH Cross-Session Collaboration & Blackboard Plugin
 *
 * Capabilities:
 * 1. Native Tools:
 *    - board_post, board_list, board_clear: Shared state blackboard storage and queries
 *    - session_call: In-process unicast communication (steer/followup)
 *    - session_query: Active session discovery with workspace filtering
 * 2. Web Slash Command:
 *    - /dsh-call-session: Unicast command and board digest in Web GUI
 * 3. Lifecycle Disposal:
 *    - Reversible cleanup and state persistence on dispose
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle,
  formatAuthorReminderText
} from './lib/board-store.mjs';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery
} from './lib/session-query.mjs';
import {
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
} from './lib/session-call.mjs';
import {
  executeSessionCreate,
  PEER_SESSION_CONSTANTS
} from './lib/session-create.mjs';
import {
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry
} from './lib/call-telemetry.mjs';
import {
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS
} from './lib/web-telemetry-route.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const name = 'dsh-call-session';
export const inject = ['agents', 'tools', 'commands', 'systemPrompt'];

let zInstance;
try {
  const mod = await import('@deepseek-ai/schemastery');
  zInstance = mod.default || mod;
} catch {
  // Graceful fallback when schemastery is optional or not yet installed
}

/**
 * Schemastery-backed plugin configuration schema.
 */
export const Config = zInstance ? zInstance.object({
  enabled: zInstance.boolean().default(true).description('是否启用跨会话通信与公共黑板插件'),
  storagePath: zInstance.string().description('黑板持久化存储文件路径'),
  debounceMs: zInstance.natural().default(300).description('黑板数据持久化防抖延迟毫秒数'),
  maxCapacity: zInstance.natural().min(10).max(10000).default(200).description('公共黑板保留条目上限，按 FIFO 淘汰'),
  telemetryCapacity: zInstance.natural().min(10).max(2000).default(200).description('跨会话调用遥测环形缓冲区保留上限，按 FIFO 淘汰'),
  promptSectionOrder: zInstance.natural().default(118).description('注入全局 System Prompt 的排序权重'),
  remindContextOrder: zInstance.natural().default(130).description('记名提醒注入 System Prompt Context 的排序权重'),
  slashCommand: zInstance.boolean().default(true).description('是否在 Web GUI 注册 /dsh-call-session 斜杠指令'),
}) : Object.freeze({
  enabled: true,
  debounceMs: 300,
  maxCapacity: 200,
  telemetryCapacity: 200,
  promptSectionOrder: 118,
  remindContextOrder: 130,
  slashCommand: true
});

/**
 * Returns model-facing cross-session collaboration instructions for System Prompt.
 *
 * @returns {string} Usage instructions in Markdown
 */
export function usageSectionText() {
  return [
    '## Cross-Session Communication & Collaboration (dsh-call-session)',
    '',
    'Coordinate with other active sessions in real time:',
    '1. Discover sessions: Use `session_query` to find active sessions (scoped to current workspace by default; use `cross_workspace: true` for cross-workspace discovery).',
    '2. Unicast call: Use `session_call` to send tasks, reports, or notices to a specific session (`target_session_id`). Wildcards (*, all) are not supported.',
    '3. Create peer session: Use `session_create` to create a peer session in the current workspace.',
    '4. Shared blackboard: Use `board_post` to publish milestones, tasks, or shared state. Use `board_list` to query blackboard posts, and `board_clear` to dismiss or purge them.',
    '5. Web slash command: Users can invoke `/dsh-call-session <target_session_id> <message>` directly in the Web UI.',
    '',
    'Intent routing (session_create vs subagent):',
    '- Use `session_create`: 创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。',
    '- Use `subagent`: Only for internal parent-child delegation where the parent waits for or collects the child result.'
  ].join('\n');
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
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS,
  executeSessionCreate,
  PEER_SESSION_CONSTANTS,
  CallTelemetryRingBuffer,
  getCanvasTelemetry,
  getCallTelemetry,
  installTelemetryWebSurface,
  authenticatedWebRoutes,
  createTelemetryHandler,
  TELEMETRY_ROUTE_PATH,
  WEB_SERVER_KEYS
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
    logger
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

  ctx.on('dispose', async () => {
    logger.debug?.('[dsh-call-session] Disposing plugin, flushing pending writes...');
    try {
      callTelemetry.clear();
      await boardStore.close();
    } catch (err) {
      logger.warn?.(`[dsh-call-session] Error during dispose flush: ${err?.message || err}`);
    }
  });

  // Read-only telemetry Web surface for the Canvas view. A webless profile
  // keeps the plugin tool-only instead of blocking boot.
  installTelemetryWebSurface(ctx, { logger });

  // 0. Register System Prompt usage instructions
  if (config.enabled !== false && ctx.systemPrompt && typeof ctx.systemPrompt.add === 'function') {
    ctx.systemPrompt.add('dsh-call-session:usage', usageSectionText, {
      order: config.promptSectionOrder ?? 118
    });
  }

  // 0.1 Register Blackboard Author Reminder in systemPrompt.context
  if (config.enabled !== false && ctx.systemPrompt && typeof ctx.systemPrompt.context === 'function') {
    ctx.systemPrompt.context({
      name: 'board:remind',
      order: config.remindContextOrder ?? 130,
      text: (context) => {
        const agent = context?.agent;
        const authorSessionId = agent?.id || agent?.session?.id;
        if (!authorSessionId) return '';
        const callerCwd = resolveSessionCwd(agent);
        const callerWorkspace = normalizeWorkspace(callerCwd);
        const activePosts = boardStore.findActiveByAuthor(authorSessionId, callerWorkspace);
        return formatAuthorReminderText(activePosts);
      }
    });
  }

  // 1. Register Native Tools
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
      description: '向公共黑板发布共享事实、状态或公告数据。其他会话可通过 board_list 按需读取。若需直接通知目标会话，请在发布后调用 session_call 并附带返回的 postId。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: "主题或业务分类，例如 task:audit、spec:api。"
          },
          content: {
            type: 'string',
            minLength: 1,
            maxLength: 65536,
            description: '发布的主体内容，支持 Markdown、纯文本或 JSON 字符串，最大 64KB。'
          },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 32 },
            maxItems: 10,
            description: "标签列表，用于分类与检索。例如 ['p0', 'blocked']。"
          },
          ttl: {
            type: 'integer',
            minimum: 0,
            maximum: 86400,
            default: 3600,
            description: '生存时间，单位为秒。默认 3600 秒即 1 小时，最大 86400 秒即 24 小时。设为 0 表示使用默认值。'
          },
          metadata: {
            type: 'object',
            description: '可选结构化元数据键值对，用于存储关联文件路径、版本号等。'
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
            message: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: value?.message || (value?.success ? `[Board] 已发布条目 (#${value?.postId})` : `[Board] 发布失败: ${value?.error}`)
          }];
        }
      },
      execute: async (args, exec) => {
        try {
          const callerAgent = exec?.agent;
          const authorSessionId = callerAgent?.id || 'unknown-session';
          const authorTitle = resolveSessionTitle(ctx, callerAgent) || 'Session';
          const authorCwd = resolveSessionCwd(callerAgent);
          const authorWorkspace = normalizeWorkspace(authorCwd);

          const now = Date.now();
          const ttlSeconds = typeof args.ttl === 'number' && args.ttl > 0 ? Math.min(args.ttl, 86400) : 3600;
          const postId = `post-${now}-${Math.random().toString(36).slice(2, 8)}`;

          const post = boardStore.post({
            id: postId,
            topic: args.topic,
            content: args.content,
            tags: Array.isArray(args.tags) ? args.tags : [],
            authorSessionId,
            authorTitle,
            authorWorkspace,
            createdAt: new Date(now).toISOString(),
            createdAtMs: now,
            expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
            expiresAtMs: now + ttlSeconds * 1000,
            status: 'active',
            scope: authorWorkspace || 'global',
            metadata: args.metadata || {}
          });

          return {
            success: true,
            postId: post.id,
            topic: post.topic,
            authorSessionId: post.authorSessionId,
            createdAt: post.createdAt,
            expiresAt: post.expiresAt,
            scope: post.scope,
            message: `[Board] 已发布条目 (#${post.id})`
          };
        } catch (err) {
          logger.debug?.(`[dsh-call-session] board_post execution failed: ${err?.message || err}`);
          return { success: false, error: err?.message || String(err) };
        }
      }
    });

    registerSafe({
      name: 'board_list',
      description: '查询公共黑板上的有效公告与共享状态。默认仅返回标题与元数据摘要 titles_only: true；支持通过 id 精确查阅单条详情，自动包含正文。默认仅限当前工程工作区。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '按条目唯一 ID 精确检索，例如 post-1725300000000-abcd。指定 id 时 titles_only 默认自动分流为 false 以便直取正文。'
          },
          topic: {
            type: 'string',
            description: '按完整主题过滤，例如 task:audit。'
          },
          topic_prefix: {
            type: 'string',
            description: '按主题前缀过滤，例如 task:。'
          },
          tag: {
            type: 'string',
            description: '按单个标签过滤。'
          },
          active_only: {
            type: 'boolean',
            default: true,
            description: '是否仅返回未过期且未归档的活跃记录。默认为 true。'
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: '是否查询所有工作区的条目。默认为 false，即仅限当前工作区。'
          },
          titles_only: {
            type: 'boolean',
            default: true,
            description: '是否仅返回标题与元数据摘要，不含 content 正文。未指定 id 时默认为 true，指定 id 时默认为 false。'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: '返回条数限制。默认 20，最大 100。'
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
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
      execute: async (args, exec) => {
        try {
          const callerAgent = exec?.agent;
          const callerCwd = resolveSessionCwd(callerAgent);

          const res = boardStore.list({
            id: args.id,
            topic: args.topic,
            topicPrefix: args.topic_prefix,
            tag: args.tag,
            status: args.active_only === false ? 'all' : 'active',
            callerWorkspace: args.cross_workspace ? null : callerCwd,
            crossWorkspace: !!args.cross_workspace,
            titlesOnly: args.titles_only !== undefined ? !!args.titles_only : undefined,
            limit: args.limit || 20
          });

          const postList = Array.isArray(res) ? res : (res.posts || []);
          return {
            success: true,
            count: postList.length,
            scope: args.cross_workspace ? 'global' : (callerCwd ? normalizeWorkspace(callerCwd) : 'unknown'),
            titlesOnly: res && typeof res.titlesOnly === 'boolean' ? res.titlesOnly : (args.titles_only !== undefined ? !!args.titles_only : !args.id),
            posts: postList
          };
        } catch (err) {
          logger.debug?.(`[dsh-call-session] board_list execution failed: ${err?.message || err}`);
          return { success: false, error: err?.message || String(err), count: 0, posts: [] };
        }
      }
    });

    registerSafe({
      name: 'board_clear',
      description: '清理或归档黑板上的指定条目或主题。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '目标条目 ID，例如 post-1725300000000-abcd。'
          },
          topic: {
            type: 'string',
            description: '按主题批量清理，例如 task:audit。未指定 id 时生效。'
          },
          mode: {
            type: 'string',
            enum: ['dismiss', 'purge'],
            default: 'dismiss',
            description: "清理模式：'dismiss' 归档保留记录，或 'purge' 物理删除。默认 'dismiss'。"
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
            message: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: value?.message || `[Board] 已清理 ${value?.clearedCount || 0} 条目`
          }];
        }
      },
      execute: async (args, exec) => {
        try {
          if (!args.id && !args.topic) {
            return {
              success: false,
              clearedCount: 0,
              error: 'board_clear 必须指定 id 或 topic 筛选条件。'
            };
          }

          const callerAgent = exec?.agent;
          const callerCwd = resolveSessionCwd(callerAgent);
          const callerWorkspace = normalizeWorkspace(callerCwd);

          const res = boardStore.clear({
            id: args.id,
            topic: args.topic,
            action: args.mode === 'purge' ? 'delete' : 'archive',
            callerWorkspace
          });

          return {
            success: true,
            clearedCount: res.affectedCount || 0,
            action: res.action,
            message: res.message
          };
        } catch (err) {
          logger.debug?.(`[dsh-call-session] board_clear execution failed: ${err?.message || err}`);
          return { success: false, error: err?.message || String(err), clearedCount: 0 };
        }
      }
    });

    registerSafe({
      name: 'session_call',
      description: '向指定活跃会话发起单播调用。根据目标状态自动选择 steer 运行中引导或 followup 空闲唤醒。支持关联黑板条目 context_post_ids。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          target_session_id: {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            description: '目标会话 Session ID，支持精确匹配或大于等于 8 位的唯一前缀，不支持通配符。'
          },
          message: {
            type: 'string',
            minLength: 1,
            maxLength: 4000,
            description: '任务指令、进度汇报或通知内容，最大 4000 字符。'
          },
          call_type: {
            type: 'string',
            enum: ['task_dispatch', 'task_report', 'notice'],
            default: 'task_dispatch',
            description: '呼叫意图类型：task_dispatch 任务派发、task_report 任务汇报、notice 状态同步通知。默认 task_dispatch。'
          },
          context_post_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '引用的公共黑板条目 ID 列表。'
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
            message: { type: 'string' }
          },
          additionalProperties: false
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: value?.message || (value?.success ? `成功呼叫目标会话 [${value?.targetSessionId}] (${value?.deliveryMode})` : '呼叫失败')
          }];
        }
      },
      execute: async (args, exec) => {
        return executeSessionCall({ ctx, args, exec });
      }
    });

    registerSafe({
      name: 'session_query',
      description: '查询当前活跃会话。默认仅返回当前工作区的会话；跨工作区查询请设置 cross_workspace: true。状态规范化为 running 或 idle。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，匹配 Session ID 或 Title。'
          },
          running_only: {
            type: 'boolean',
            default: false,
            description: '是否仅返回处于 running 状态的会话。默认为 false。'
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: '是否查询所有工作区的会话。默认为 false，即仅限当前工作区。'
          },
          top_level_only: {
            type: 'boolean',
            default: true,
            description: '是否仅列出顶层会话，排除子代理与临时会话。默认为 true。'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: '返回条数限制。默认 50，最大 100。'
          }
        }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'number' },
            scope: { type: 'string' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'string' },
                  cwd: { type: 'string' }
                },
                additionalProperties: false
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
      execute: async (args, exec) => {
        return executeSessionQuery({ ctx, args, exec });
      }
    });

    registerSafe({
      name: 'session_create',
      description: '创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 60,
            description: '同级会话的人类可读标题。禁止特权前缀与换行符。'
          },
          initial_message: {
            type: 'string',
            maxLength: 4000,
            description: '初始任务指令，会话创建后立即自动投递并启动第一轮。'
          },
          context_post_ids: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
            description: '可选关联的黑板条目 ID 列表，将自动挂载至初始任务指令首部。'
          },
          model: {
            type: 'string',
            description: '可选覆写目标会话所使用的模型 ID。默认继承当前会话模型。'
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
            bootstrapPostId: { type: 'string' }
          },
          additionalProperties: true
        },
        render(_args, value) {
          return [{
            type: 'text',
            text: value?.success
              ? `[Session] 成功创建同级会话 [${value?.sessionId}] "${value?.title}" (状态: ${value?.status}, 代际: ${value?.generation})`
              : `[Session] 创建同级会话失败: ${value?.error}`
          }];
        }
      },
      execute: async (args, exec) => {
        return executeSessionCreate({ ctx, args, exec, boardStore });
      }
    });
  }

  // 2. Register Web Slash Command (/dsh-call-session)
  const registerSlashCommand = (cmdCtx) => {
    if (!cmdCtx?.commands || typeof cmdCtx.commands.register !== 'function') return;

    cmdCtx.commands.register({
      name: 'dsh-call-session',
      description: '向指定会话发起单播呼叫，或不带参数查看当前黑板标题摘要',
      input: { hint: '[<target_session_id> <message>]' },
      recordInput: false,
      handler: async (invocation) => {
        const raw = (invocation.rawInput || '').trim();
        const callerAgent = invocation.agent;
        const callerWorkspace = normalizeWorkspace(resolveSessionCwd(callerAgent));

        // 1. 无参数：查阅看板标题摘要
        if (!raw) {
          const titles = boardStore.listTitles({ callerWorkspace });
          const digest = boardStore.formatTitleDigest(titles);
          if (!digest) {
            return {
              kind: 'success',
              text: [
                '[工作区公告看板] 当前暂无有效公告。',
                '',
                '使用说明:',
                '- 跨会话呼叫: /dsh-call-session <target_session_id> <message>',
                '- 查询可用会话: 调用 session_query 工具'
              ].join('\n')
            };
          }
          return {
            kind: 'success',
            text: [
              digest,
              '',
              '用法: /dsh-call-session <target_session_id> <message>'
            ].join('\n')
          };
        }

        // 2. 带参数：解析 target 与 message
        const firstSpace = raw.search(/[\t\n\r ]/u);
        if (firstSpace === -1) {
          return {
            kind: 'error',
            text: '用法错误：缺少消息内容。示例：/dsh-call-session <target_session_id> <message>'
          };
        }

        const targetSessionId = raw.slice(0, firstSpace).trim();
        const message = raw.slice(firstSpace).trim();

        if (!targetSessionId || !message) {
          return {
            kind: 'error',
            text: '目标 Session ID 与消息内容均不能为空。示例：/dsh-call-session <target_session_id> <message>'
          };
        }

        try {
          const result = await executeSessionCall({
            ctx,
            args: {
              target_session_id: targetSessionId,
              message,
              call_type: 'notice'
            },
            exec: { agent: callerAgent }
          });

          return {
            kind: 'success',
            text: `已通过单播 (${result.deliveryMode}) 成功呼叫会话 [${result.targetSessionId}]`
          };
        } catch (error) {
          return {
            kind: 'error',
            text: `跨会话呼叫失败: ${error?.message || error}`
          };
        }
      }
    });

    logger.debug?.('[dsh-call-session] Slash command /dsh-call-session registered successfully.');
  };

  if (ctx.commands && typeof ctx.commands.register === 'function') {
    registerSlashCommand(ctx);
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (subCtx) => {
      registerSlashCommand(subCtx);
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
