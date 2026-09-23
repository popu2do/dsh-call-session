/**
 * DSH Peer Session Bootstrapper
 *
 * Coordinates peer session initialization:
 * 1. Formats initial messages with context post references and summary metadata.
 * 2. Dispatches initial messages to peer ReactLoopAgent targets safely without blocking.
 * 3. Publishes 'session:bootstrap' notice to the public blackboard.
 */
import { randomUUID } from 'node:crypto';
import { dispatchNativeMessage } from './session-call.mjs';

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

function defaultGenerateMessageId() {
  return typeof randomUUID === 'function'
    ? randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 格式化同级会话初始任务消息对象
 *
 * @param {object} params
 * @param {string} [params.initialMessage] 初始任务文本
 * @param {string[]} [params.contextPostIds] 关联黑板贴子 ID 列表
 * @param {string} [params.callerTitle] 调用方会话标题
 * @param {() => string} [params.generateMessageId] 自定义消息 ID 生成函数
 * @returns {object | null} 格式化后的 UserMessage 对象，若无有效初始文本则返回 null
 */
export function formatInitialMessage({
  initialMessage,
  contextPostIds,
  callerTitle,
  generateMessageId
} = {}) {
  if (typeof initialMessage !== 'string') {
    return null;
  }
  const rawInitialMessage = initialMessage.trim();
  if (!rawInitialMessage) {
    return null;
  }

  const cleanPostIds = Array.isArray(contextPostIds)
    ? contextPostIds
        .filter(p => p !== null && p !== undefined)
        .map(String)
        .map(s => s.trim().replace(/^#+/, ''))
        .filter(Boolean)
    : [];

  let payloadText = rawInitialMessage;
  if (cleanPostIds.length > 0) {
    const refs = cleanPostIds.map(id => `#${id}`).join(', ');
    payloadText = `> Context Ref: ${refs}\n\n${rawInitialMessage}`;
  }

  const shortPayload = rawInitialMessage.replace(/[\r\n\t ]+/g, ' ').trim();
  const effectiveCallerTitle = callerTitle || 'Session';
  let summary = `[Peer Session Bootstrap] from ${effectiveCallerTitle}: ${shortPayload}`;
  if (summary.length > 120) {
    summary = summary.slice(0, 117) + '...';
  }

  const idGen = typeof generateMessageId === 'function' ? generateMessageId : defaultGenerateMessageId;

  return {
    id: idGen(),
    role: 'user',
    content: [{ type: 'text', text: payloadText }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-call-session',
      form: 'session_create',
      summary
    }
  };
}

/**
 * 安全派发初始消息至目标 Agent
 *
 * @param {object} targetAgent 目标 Agent 实例
 * @param {object | null} messagePayload UserMessage 对象
 * @param {object} [options]
 * @param {any} [options.logger] 日志服务
 * @returns {'running' | 'idle'} 派发后状态
 */
export function dispatchInitialMessage(targetAgent, messagePayload, { logger = noopLogger } = {}) {
  if (!messagePayload) {
    return 'idle';
  }

  try {
    dispatchNativeMessage(targetAgent, messagePayload);
    return 'running';
  } catch (err) {
    logger?.warn?.(
      `[dsh-call-session] Failed to dispatch initial message to ${targetAgent?.id}: ${err?.message || err}`
    );
    return 'idle';
  }
}

/**
 * 发布同级会话创建就绪引导公告至公共黑板
 *
 * @param {any} boardStore 黑板存储实例
 * @param {object} params
 * @param {object} [params.targetAgent] 目标 Agent 实例
 * @param {string} [params.peerSessionId] 目标会话 ID
 * @param {string} [params.finalTitle] 目标会话规范化标题
 * @param {string} [params.callerSessionId] 调用方会话 ID
 * @param {string} [params.callerTitle] 调用方会话标题
 * @param {string} [params.callerWorkspace] 工作区路径
 * @param {number} [params.targetGeneration] 代际深度
 * @param {object} [options]
 * @param {any} [options.logger] 日志服务
 * @returns {string | null} 发布的 post.id，未发布或失败返回 null
 */
export function publishBootstrapNotice(
  boardStore,
  {
    targetAgent,
    peerSessionId,
    finalTitle,
    callerSessionId,
    callerTitle,
    callerWorkspace,
    targetGeneration
  } = {},
  { logger = noopLogger } = {}
) {
  if (!boardStore || typeof boardStore.post !== 'function') {
    return null;
  }

  const effectivePeerId = peerSessionId || targetAgent?.id || 'unknown';
  const effectiveTitle = finalTitle || targetAgent?.title || '';
  const effectiveCallerId = callerSessionId || 'root-session';
  const effectiveCallerTitle = callerTitle || 'Session';
  const effectiveWorkspace = callerWorkspace || '';
  const effectiveGen = targetGeneration ?? (targetAgent?.generation ?? 1);

  try {
    const now = Date.now();
    const bp = boardStore.post({
      id: `post-${now}-${Math.random().toString(36).slice(2, 8)}`,
      topic: 'session:bootstrap',
      content: `平级会话 [${effectivePeerId}] ("${effectiveTitle}") 已创建并就绪。\n工作区: ${effectiveWorkspace}\n创建方: ${effectiveCallerId}`,
      tags: ['peer-session', 'bootstrap'],
      authorSessionId: effectiveCallerId,
      authorTitle: effectiveCallerTitle,
      authorWorkspace: effectiveWorkspace,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      expiresAt: new Date(now + 3600 * 1000).toISOString(),
      expiresAtMs: now + 3600 * 1000,
      status: 'active',
      scope: effectiveWorkspace || 'global',
      metadata: {
        peerSessionId: effectivePeerId,
        title: effectiveTitle,
        generation: effectiveGen,
        creatorSessionId: effectiveCallerId
      }
    });
    return bp?.id || null;
  } catch (err) {
    logger?.warn?.(
      `[dsh-call-session] Failed to post session:bootstrap notice: ${err?.message || err}`
    );
    return null;
  }
}

/**
 * 同级会话启动协同主流程
 *
 * @param {object} params
 * @param {object} params.targetAgent 目标 Agent
 * @param {string} [params.callerSessionId] 发起方会话 ID
 * @param {string} [params.callerTitle] 发起方标题
 * @param {string} [params.callerWorkspace] 工作区
 * @param {string} [params.initialMessage] 初始任务指令
 * @param {string[]} [params.contextPostIds] 关联黑板贴子
 * @param {any} [params.boardStore] 黑板存储
 * @param {number} [params.targetGeneration] 目标代际
 * @param {string} [params.finalTitle] 目标标题
 * @param {any} [params.logger] 日志服务
 * @param {() => string} [params.generateMessageId] 自定义 ID 生成
 * @returns {{ status: 'running' | 'idle', bootstrapPostId: string | null }}
 */
export function bootstrapPeerSession({
  targetAgent,
  callerSessionId,
  callerTitle,
  callerWorkspace,
  initialMessage,
  contextPostIds,
  boardStore,
  targetGeneration,
  finalTitle,
  logger = noopLogger,
  generateMessageId
} = {}) {
  const messagePayload = formatInitialMessage({
    initialMessage,
    contextPostIds,
    callerTitle,
    generateMessageId
  });

  const status = dispatchInitialMessage(targetAgent, messagePayload, { logger });

  const bootstrapPostId = publishBootstrapNotice(
    boardStore,
    {
      targetAgent,
      peerSessionId: targetAgent?.id,
      finalTitle,
      callerSessionId,
      callerTitle,
      callerWorkspace,
      targetGeneration
    },
    { logger }
  );

  return {
    status,
    bootstrapPostId
  };
}

/**
 * 同级会话启动协同器类
 */
export class PeerBootstrapper {
  /**
   * @param {object} [options]
   * @param {any} [options.logger] 日志服务
   * @param {any} [options.boardStore] 黑板存储服务
   * @param {() => string} [options.generateMessageId] 自定义消息 ID 生成函数
   */
  constructor(options = {}) {
    this.options = options || {};
    this.logger = this.options.logger || noopLogger;
    this.boardStore = this.options.boardStore || null;
    this.generateMessageId = this.options.generateMessageId;
  }

  formatInitialMessage(params = {}) {
    return formatInitialMessage({
      generateMessageId: this.generateMessageId,
      ...params
    });
  }

  dispatchInitialMessage(targetAgent, messagePayload, options = {}) {
    return dispatchInitialMessage(targetAgent, messagePayload, {
      logger: this.logger,
      ...options
    });
  }

  publishBootstrapNotice(boardStoreOrParams = {}, maybeParams = {}, maybeOptions = {}) {
    if (boardStoreOrParams && typeof boardStoreOrParams.post === 'function') {
      return publishBootstrapNotice(boardStoreOrParams, maybeParams, {
        logger: this.logger,
        ...maybeOptions
      });
    }
    return publishBootstrapNotice(this.boardStore, boardStoreOrParams, {
      logger: this.logger,
      ...maybeParams
    });
  }

  bootstrap(params = {}) {
    return bootstrapPeerSession({
      logger: this.logger,
      boardStore: this.boardStore,
      generateMessageId: this.generateMessageId,
      ...params
    });
  }

  static formatInitialMessage(params) {
    return formatInitialMessage(params);
  }

  static dispatchInitialMessage(targetAgent, messagePayload, options) {
    return dispatchInitialMessage(targetAgent, messagePayload, options);
  }

  static publishBootstrapNotice(boardStore, params, options) {
    return publishBootstrapNotice(boardStore, params, options);
  }

  static bootstrap(params) {
    return bootstrapPeerSession(params);
  }
}
