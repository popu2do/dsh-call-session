/**
 * DSH Cross-Session Native Collaboration & Blackboard Plugin (Native Refactor Edition)
 *
 * Capabilities:
 * 1. Native Tools:
 *    - board_post, board_list, board_clear (Pull-based shared state, zero wakeup side effects)
 *    - session_call (Strict in-process unicast push, state-aware steer/followup, zero HTTP)
 *    - session_query (Two-state running/idle resolution, workspace isolation by default)
 * 2. Web Slash Command:
 *    - /dsh-call-session (Interactive human command and board digest in Web GUI)
 * 3. Lifecycle Disposal:
 *    - Reversible cleanup, atomic debounced flush on dispose.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardStore,
  AtomicBoardStore,
  normalizeWorkspace,
  extractTitle
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
  storagePath: zInstance.string().description('自定义黑板持久化存储文件路径（默认指向系统级存储目录）'),
  debounceMs: zInstance.natural().default(300).description('黑板数据原子落盘的防抖时间（毫秒）'),
  maxCapacity: zInstance.natural().min(10).max(10000).default(200).description('公共黑板最大保留有效条目上限（先进先出淘汰）'),
  promptSectionOrder: zInstance.natural().default(118).description('注入全局 System Prompt 的排序权重'),
  slashCommand: zInstance.boolean().default(true).description('是否在 Web GUI 注册 /dsh-call-session 斜杠指令'),
}) : Object.freeze({
  enabled: true,
  debounceMs: 300,
  maxCapacity: 200,
  promptSectionOrder: 118,
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
    'You can discover and coordinate with other active sessions in real time:',
    '1. Discover sessions: Use `session_query` to find active sessions (scoped to current workspace by default; use `cross_workspace: true` for multi-repository tasks).',
    '2. Unicast 1:1 call: Use `session_call` to send tasks, reports, or notices to a specific session (`target_session_id`). Wildcard broadcasting is strictly forbidden.',
    '3. Shared blackboard: Use `board_post` to publish milestones, tasks, or shared state (pure pull model, zero passive wakeups). Use `board_list` to inspect blackboard posts, and `board_clear` to dismiss or purge them.',
    '4. Web slash command: Users can invoke `/dsh-call-session <target_session_id> <message>` directly in the Web UI.'
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
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  executeSessionQuery,
  executeSessionCall,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
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

  ctx.on('dispose', async () => {
    logger.debug?.('[dsh-call-session] Disposing plugin, flushing pending writes...');
    try {
      await boardStore.close();
    } catch (err) {
      logger.warn?.(`[dsh-call-session] Error during dispose flush: ${err?.message || err}`);
    }
  });

  // 0. Register System Prompt usage instructions
  if (config.enabled !== false && ctx.systemPrompt && typeof ctx.systemPrompt.add === 'function') {
    ctx.systemPrompt.add('dsh-call-session:usage', usageSectionText, {
      order: config.promptSectionOrder ?? 118
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
      description: '向原生公共黑板发布一条共享事实、任务交接或公告数据。该操作为纯拉取（Pull）模型，绝对不会触发任何会话的被动唤醒。若需通知特定会话，请在发布后显式调用 session_call 工具并附带返回的 postId。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: "主题/业务分类。推荐遵循命名空间风格，如 'task:audit', 'artifact:build', 'spec:api', 'status:system' 等。"
          },
          content: {
            type: 'string',
            minLength: 1,
            maxLength: 65536,
            description: '发布的主体内容。支持 Markdown、纯文本或 JSON 序列化字符串（软限制最大 64KB）。'
          },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 32 },
            maxItems: 10,
            description: "可选标签列表，便于精确检索。如 ['p0', 'blocked', 'ready-for-review']。"
          },
          ttl: {
            type: 'integer',
            minimum: 0,
            maximum: 86400,
            default: 3600,
            description: '生存时间（秒）。默认 3600 秒（1小时），最大不超过 86400 秒（24小时）。设为 0 表示使用默认存活期。'
          },
          metadata: {
            type: 'object',
            description: '可选的结构化元数据键值对，用于存放版本号、关联文件路径等辅助字段。'
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
            text: value?.message || (value?.success ? `[Board] 公共黑板已发布条目 (#${value?.postId})` : `[Board] 发布失败: ${value?.error}`)
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
            message: `[Board] 公共黑板已成功发布条目 (#${post.id})，纯拉取模型，零被动唤醒副作用。`
          };
        } catch (err) {
          logger.debug?.(`[dsh-call-session] board_post execution failed: ${err?.message || err}`);
          return { success: false, error: err?.message || String(err) };
        }
      }
    });

    registerSafe({
      name: 'board_list',
      description: '查询公共黑板上的有效公告与共享状态。纯拉取（Pull）操作，零被动唤醒。默认仅返回与调用方同一工作区的条目；跨工程协作请设置 cross_workspace: true。支持 titles_only 精简模式以节约 Token。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: '按完整主题过滤（如 task:audit）。'
          },
          topic_prefix: {
            type: 'string',
            description: '按主题前缀模糊过滤（如 task: 可匹配 task:audit, task:verify）。'
          },
          tag: {
            type: 'string',
            description: '按单个标签检索（如 ready-for-review）。'
          },
          active_only: {
            type: 'boolean',
            default: true,
            description: '是否仅返回未过期且未被撤销的活跃记录。默认为 true。'
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: '是否跨工程穿透查询所有工作区的公告。默认为 false（仅查当前工程）。'
          },
          titles_only: {
            type: 'boolean',
            default: false,
            description: '是否仅返回标题与摘要元数据（不含主体 content 大文本），极度节省 Token。'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 20,
            description: '返回结果数量限制。默认 20 条。'
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
            topic: args.topic,
            topicPrefix: args.topic_prefix,
            tag: args.tag,
            status: args.active_only === false ? 'all' : 'active',
            callerWorkspace: args.cross_workspace ? null : callerCwd,
            crossWorkspace: !!args.cross_workspace,
            titlesOnly: !!args.titles_only,
            limit: args.limit || 20
          });

          const postList = Array.isArray(res) ? res : (res.posts || []);
          return {
            success: true,
            count: postList.length,
            scope: args.cross_workspace ? 'global' : (callerCwd ? normalizeWorkspace(callerCwd) : 'unknown'),
            titlesOnly: !!args.titles_only,
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
      description: '清理或撤销黑板上的指定条目或主题。纯拉取（Pull）管理操作，零唤醒副作用。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '待删除或撤销的条目唯一 ID（如 post-1725300000000-abcd）。'
          },
          topic: {
            type: 'string',
            description: '按主题批量标记撤销（如 task:audit）。当未指定 id 时有效。'
          },
          mode: {
            type: 'string',
            enum: ['dismiss', 'purge'],
            default: 'dismiss',
            description: "清理模式：'dismiss' 软删除标记已处理（保留审计踪迹）；'purge' 彻底物理移除。默认 'dismiss'。"
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
              error: 'board_clear 必须指定 id 或 topic 至少一个筛选条件。'
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
      description: '向指定活跃会话发起严格 1:1 DSH 原生进程内单播调用。纯推送模型，自适应支持目标 running（steer 引导）与 idle（followup 唤醒），严格禁止通配符广播与自身自呼叫。支持关联黑板条目（context_post_ids）。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          target_session_id: {
            type: 'string',
            minLength: 8,
            maxLength: 128,
            description: '目标会话 Session ID（支持精确匹配或 >=8 位唯一前缀，严禁 * 或广播通配符）。'
          },
          message: {
            type: 'string',
            minLength: 1,
            maxLength: 4000,
            description: '纯净任务指令、汇报或交接内容（严禁假冒人类或拼装假信封）。'
          },
          call_type: {
            type: 'string',
            enum: ['task_dispatch', 'task_report', 'notice'],
            default: 'task_dispatch',
            description: '呼叫意图类型：task_dispatch（任务派发）、task_report（任务汇报）、notice（状态同步通知）。'
          },
          context_post_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '可选引用的公共黑板条目 ID列表。'
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
      description: '查询当前活跃会话。纯只读探索工具。默认仅返回当前工程工作区的会话；跨工程协作请设置 cross_workspace: true。状态严格规范化为 idle 与 running 两态。',
      isConcurrencySafe: true,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '模糊搜索关键词（匹配 Session ID 或 Title）。'
          },
          running_only: {
            type: 'boolean',
            default: false,
            description: '是否仅查询处于 running 运行态的会话。默认为 false（返回 running 和 idle）。'
          },
          cross_workspace: {
            type: 'boolean',
            default: false,
            description: '是否跨工程穿透查询所有工作区的会话。默认为 false（仅查当前工程）。'
          },
          top_level_only: {
            type: 'boolean',
            default: true,
            description: '是否仅列出顶层根会话（排除子代理与匿名会话）。默认为 true。'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: '返回结果数量限制。默认 50 条。'
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
  }

  // 2. Register Web Slash Command (/dsh-call-session)
  const registerSlashCommand = (cmdCtx) => {
    if (!cmdCtx?.commands || typeof cmdCtx.commands.register !== 'function') return;

    cmdCtx.commands.register({
      name: 'dsh-call-session',
      description: '向指定活跃会话发起 DSH 原生跨会话调度呼叫，或无参查阅看板有效标题',
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
                '📋 [工作区公告看板] 当前暂无有效公告。',
                '',
                '💡 使用说明:',
                '• 跨会话呼叫: /dsh-call-session <target_session_id> <message>',
                '• 查阅可用会话: 调用 session_query 工具'
              ].join('\n')
            };
          }
          return {
            kind: 'success',
            text: [
              digest,
              '',
              '💡 提示: 输入 `/dsh-call-session <target_session_id> <message>` 可直接跨会话呼叫目标 Agent。'
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
            text: `已通过原生单播 (${result.deliveryMode}) 成功呼叫会话 [${result.targetSessionId}]`
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

  logger.debug?.('[dsh-call-session] Plugin fully initialized with pure native board, session_call, session_query, and /dsh-call-session.');
}

export default {
  name,
  inject,
  Config,
  apply,
  usageSectionText
};
