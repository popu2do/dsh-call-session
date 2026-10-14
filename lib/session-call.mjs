/**
 * DSH Cross-Session Call Service
 *
 * In-process unicast dispatch with status-aware channel selection (steer/followup).
 */
import { SessionDirectory } from './session-directory.mjs';
import { normalizeWorkspace } from './workspace.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';
import { resolveMessages } from './locales/index.mjs';
import {
  CALL_TYPE_INTENTS,
  buildTransportPayload,
  buildNativeUserMessage,
  sanitizeContextPostIds,
  sanitizePostIds,
  dispatchNativeMessage
} from './native-message-transport.mjs';

export {
  CALL_TYPE_INTENTS,
  buildTransportPayload,
  buildNativeUserMessage,
  sanitizeContextPostIds,
  sanitizePostIds,
  dispatchNativeMessage
};

const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

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
    throw new Error('[InvalidParameter] session_call: arguments must be an object.');
  }

  const rawTarget = typeof args.target_session_id === 'string' ? args.target_session_id.trim() : '';
  if (!rawTarget) {
    throw new Error('[InvalidParameter] session_call: target_session_id is required.');
  }

  const rawMessage = typeof args.message === 'string' ? args.message : '';
  if (!rawMessage.trim()) {
    throw new Error('[InvalidParameter] session_call: non-empty message parameter is required.');
  }
  if (rawMessage.length > 4000) {
    throw new Error('[InvalidParameter] session_call: message exceeds maximum length of 4000 characters.');
  }

  const callType = (typeof args.call_type === 'string' && Object.prototype.hasOwnProperty.call(CALL_TYPE_INTENTS, args.call_type))
    ? args.call_type
    : 'task_dispatch';

  const callerAgent = exec?.agent;
  const callerSessionId = callerAgent?.id || 'unknown-caller';

  const directory = new SessionDirectory(ctx, { logger });
  const { targetAgent, targetTitle } = await directory.resolveTarget(rawTarget, {
    callerSessionId,
    callerAgent,
    exec
  });

  const callerTitle = callerAgent
    ? directory.resolveDisplayTitle(callerAgent)
    : 'Session';

  const cleanPostIds = sanitizePostIds(args.context_post_ids);

  const userMessage = buildNativeUserMessage({
    rawMessage,
    form: 'notice',
    callerSessionId,
    callerTitle,
    callType,
    contextPostIds: cleanPostIds
  });

  const startTime = Date.now();
  const deliveryMode = dispatchNativeMessage(targetAgent, userMessage);
  const durationMs = Date.now() - startTime;
  logger.debug?.(`[dsh-call-session] Successfully dispatched native notice to ${targetAgent.id} via ${deliveryMode}`);

  try {
    const ringBuffer = getCallTelemetry(ctx, options);
    if (ringBuffer && typeof ringBuffer.record === 'function') {
      const callerCwd = directory.resolveCwd(callerAgent);
      const targetCwd = directory.resolveCwd(targetAgent);
      const shortPayload = (typeof rawMessage === 'string' ? rawMessage.replace(/[\r\n\t ]+/g, ' ').trim() : '');
      const messageSnippet = shortPayload.length > 120 ? shortPayload.slice(0, 117) + '...' : shortPayload;
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
        messageSnippet,
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
    message: resolveMessages(ctx, options?.config).sessionCallSuccess(targetAgent.id, deliveryMode, callType)
  };
}