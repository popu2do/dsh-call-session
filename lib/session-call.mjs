/**
 * DSH Cross-Session Call Service
 *
 * In-process unicast dispatch with status-aware channel selection (steer/followup).
 */
import { randomUUID } from 'node:crypto';
import {
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService
} from './session-query.mjs';
import { normalizeWorkspace } from './board-store.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';

function generateMessageId() {
  return typeof randomUUID === 'function'
    ? randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TARGET_WILDCARDS = new Set(['*', 'all', 'broadcast']);

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * 呼叫意图映射常量
 */
export const CALL_TYPE_INTENTS = Object.freeze({
  task_dispatch: 'TASK_DISPATCH',
  task_report: 'TASK_REPORT',
  notice: 'NOTICE'
});

/**
 * 基于目标 Agent 运行状态分发消息
 *
 * @param {object} targetAgent 目标 ReactLoopAgent 实例
 * @param {import('../types/session-call.js').NativeUserMessage | object} userMessage DSH 原生 UserMessage 对象
 * @returns {import('../types/session-call.js').DeliveryMode} 'steer' | 'followup'
 */
export function dispatchNativeMessage(targetAgent, userMessage) {
  if (!targetAgent || typeof targetAgent !== 'object') {
    throw new Error('dispatchNativeMessage: targetAgent 必须是有效的 Agent 实例。');
  }

  const rawStatus = targetAgent.status;
  const isRunning = rawStatus === 'running';

  if (isRunning) {
    if (typeof targetAgent.steer === 'function') {
      targetAgent.steer(userMessage);
      return 'steer';
    }
  }

  if (typeof targetAgent.followup === 'function') {
    targetAgent.followup(userMessage);
    return 'followup';
  } else if (typeof targetAgent.send === 'function') {
    targetAgent.send(userMessage, 'next-turn', true);
    return 'followup';
  }

  throw new Error(`目标 Agent [${targetAgent.id}] 未提供有效的原生接收方法：followup、steer 或 send`);
}

/**
 * 执行 session_call 单播投递
 *
 * @param {any} ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param {import('../types/session-call.js').SessionCallArgs} [rawArgs] session_call 入参
 * @param {any} [rawExec] 工具执行上下文，包含调用方 agent 实例
 * @param {any} [rawOptions] 扩展配置选项
 * @returns {Promise<import('../types/session-call.js').SessionCallResult>}
 */
export async function executeSessionCall(ctxOrOptions, rawArgs = {}, rawExec = {}, rawOptions = {}) {
  let ctx, args, exec, options;
  if (ctxOrOptions && Object.prototype.hasOwnProperty.call(ctxOrOptions, 'ctx')) {
    ctx = ctxOrOptions.ctx;
    args = ctxOrOptions.args !== undefined ? ctxOrOptions.args : {};
    exec = ctxOrOptions.exec || {};
    options = ctxOrOptions.options || ctxOrOptions;
  } else {
    ctx = ctxOrOptions;
    args = rawArgs !== undefined ? rawArgs : {};
    exec = rawExec || {};
    options = rawOptions || {};
  }

  const logger = (typeof ctx?.logger === 'function' ? ctx.logger('dsh-call-session') : null)
    || (typeof ctx?.get === 'function' ? (typeof ctx.get('logger') === 'function' ? ctx.get('logger')('dsh-call-session') : ctx.get('logger')) : null)
    || (options.logger || noopLogger);

  if (!args || typeof args !== 'object') {
    throw new Error('session_call: 参数必须为对象。');
  }

  const rawTarget = typeof args.target_session_id === 'string' ? args.target_session_id.trim() : '';
  if (!rawTarget) {
    throw new Error('session_call: 必须提供 target_session_id 参数。');
  }

  const rawMessage = typeof args.message === 'string' ? args.message.trim() : '';
  if (!rawMessage) {
    throw new Error('session_call: 必须提供非空的 message 参数。');
  }
  if (rawMessage.length > 4000) {
    throw new Error('session_call: message 长度不能超过 4000 字符。');
  }

  const callType = ['task_dispatch', 'task_report', 'notice'].includes(args.call_type)
    ? args.call_type
    : 'task_dispatch';

  const targetLower = rawTarget.toLowerCase();

  // 阻断通配符与广播伪装
  if (TARGET_WILDCARDS.has(targetLower) || targetLower.includes('*') || targetLower.includes('?') || targetLower === '@all' || targetLower === '@everyone') {
    throw new Error('session_call: 不支持通配符 *、all、broadcast，必须指定具体 Session ID。');
  }

  // 阻断自调用死循环
  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || 'unknown-caller';
  if (callerAgent) {
    if (targetLower === callerSessionId.toLowerCase()) {
      throw new Error('session_call: 不能调用自身 Session ID。');
    }
    if (targetLower.length >= 8 && callerSessionId.toLowerCase().startsWith(targetLower)) {
      const agents = resolveAgentsService(ctx, exec);
      const liveList = typeof agents?.list === 'function' ? agents.list() : [];
      const hasOtherCandidate = liveList.some(a => a && a.id && a.id.toLowerCase() !== callerSessionId.toLowerCase() && a.id.toLowerCase().startsWith(targetLower));
      if (!hasOtherCandidate) {
        throw new Error('session_call: 不能调用自身 Session ID。');
      }
    }
  }

  const agents = resolveAgentsService(ctx, exec);
  const liveAgents = typeof agents?.list === 'function' ? agents.list() : [];
  const archivedIds = getArchivedSessionIds(ctx);
  const candidateAgents = liveAgents.filter(
    a => a && a.id && a.id.toLowerCase() !== callerSessionId.toLowerCase() && !archivedIds.has(a.id) && !archivedIds.has(a.id.toLowerCase())
  );

  let targetAgent = null;
  const exactMatches = candidateAgents.filter(a => a.id.toLowerCase() === targetLower);
  if (exactMatches.length === 1) {
    targetAgent = exactMatches[0];
  } else if (exactMatches.length > 1) {
    throw new Error(`session_call: 目标 Session ID "${rawTarget}" 存在多个匹配会话。`);
  } else {
    if (typeof agents?.get === 'function') {
      const direct = agents.get(rawTarget);
      if (direct && direct.id && direct.id.toLowerCase() !== callerSessionId.toLowerCase() && !archivedIds.has(direct.id) && !archivedIds.has(direct.id.toLowerCase())) {
        targetAgent = direct;
      }
    }

    // 内存中未命中时尝试恢复持久化会话
    if (!targetAgent && typeof agents?.resume === 'function') {
      try {
        const handle = await agents.resume({ resumeSessionId: rawTarget });
        const direct = handle?.agent || (typeof agents?.get === 'function' ? agents.get(rawTarget) : null);
        if (direct && direct.id && direct.id.toLowerCase() !== callerSessionId.toLowerCase() && !archivedIds.has(direct.id) && !archivedIds.has(direct.id.toLowerCase())) {
          targetAgent = direct;
        }
      } catch (err) {
        logger.debug?.(`[dsh-call-session] Auto-resume for "${rawTarget}" failed: ${err?.message || err}`);
      }
    }

    if (!targetAgent) {
      if (targetLower.length < 8) {
        throw new Error(`session_call: 前缀 "${rawTarget}" 长度小于 8 位，必须提供至少 8 位前缀。`);
      }
      const prefixMatches = candidateAgents.filter(a => a.id.toLowerCase().startsWith(targetLower));
      if (prefixMatches.length === 1) {
        targetAgent = prefixMatches[0];
      } else if (prefixMatches.length >= 2) {
        const matchedIds = prefixMatches.map(a => a.id).join(', ');
        throw new Error(`session_call: 目标前缀 "${rawTarget}" 匹配到 ${prefixMatches.length} 个活跃会话 [${matchedIds}]。`);
      } else {
        throw new Error(`session_call: 未找到匹配 "${rawTarget}" 的活跃会话，该会话可能不存在或已被归档。`);
      }
    }
  }

  const cleanPostIds = Array.isArray(args.context_post_ids)
    ? args.context_post_ids.filter(p => p !== null && p !== undefined).map(String).map(s => s.trim()).filter(Boolean)
    : [];

  const callerTitle = resolveSessionTitle(ctx, callerAgent) || 'Session';
  const targetTitle = resolveSessionTitle(ctx, targetAgent) || 'Session';

  let payloadText = rawMessage;
  if (cleanPostIds.length > 0) {
    const refs = cleanPostIds.map(id => (id.startsWith('#') ? id : `#${id}`)).join(', ');
    payloadText = `> Context Ref: ${refs}\n\n${rawMessage}`;
  }

  const intentStr = (callType ? String(callType).toUpperCase() : 'TASK_DISPATCH');
  const shortPayload = rawMessage.replace(/[\r\n\t ]+/g, ' ').trim();
  let summary = `[Cross-Session ${intentStr}] from ${callerTitle}: ${shortPayload}`;
  if (summary.length > 120) {
    summary = summary.slice(0, 117) + '...';
  }

  const userMessage = {
    id: generateMessageId(),
    role: 'user',
    content: [{ type: 'text', text: payloadText }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-call-session',
      form: 'notice',
      summary
    }
  };

  const startTime = Date.now();
  const deliveryMode = dispatchNativeMessage(targetAgent, userMessage);
  const durationMs = Date.now() - startTime;
  logger.debug?.(`[dsh-call-session] Successfully dispatched native notice to ${targetAgent.id} via ${deliveryMode}`);

  try {
    const ringBuffer = getCallTelemetry(ctx, options);
    if (ringBuffer && typeof ringBuffer.record === 'function') {
      const callerCwd = resolveSessionCwd(callerAgent);
      const targetCwd = resolveSessionCwd(targetAgent);
      ringBuffer.record({
        callerSessionId,
        callerTitle,
        callerWorkspace: normalizeWorkspace(callerCwd),
        targetSessionId: targetAgent.id,
        targetTitle,
        targetWorkspace: normalizeWorkspace(targetCwd),
        callType,
        deliveryMode,
        timestamp: startTime,
        durationMs,
        contextPostIds: cleanPostIds,
        messageSnippet: shortPayload.length > 120 ? shortPayload.slice(0, 117) + '...' : shortPayload,
        messagePayload: rawMessage,
        status: 'active'
      });
    }
  } catch (telemetryErr) {
    logger.debug?.(`[dsh-call-session] Call telemetry recording failed: ${telemetryErr?.message || telemetryErr}`);
  }

  return {
    success: true,
    targetSessionId: targetAgent.id,
    targetTitle,
    targetStatus: targetAgent.status === 'running' ? 'running' : 'idle',
    deliveryMode,
    callType,
    callerSessionId,
    contextPostIds: cleanPostIds,
    message: `已通过单播 ${deliveryMode} 成功呼叫目标会话 [${targetAgent.id}]，类型为 ${callType}`
  };
}
