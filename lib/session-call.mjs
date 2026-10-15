/**
 * DSH Cross-Session Call Service
 *
 * In-process unicast dispatch with status-aware channel selection (steer/followup).
 */
import { SessionDirectory, resolveNativeSessionStatus } from './session-directory.mjs';
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

  const initialEvents = typeof targetAgent.session?.snapshotEvents === 'function'
    ? targetAgent.session.snapshotEvents()
    : (Array.isArray(targetAgent.session?.events) ? targetAgent.session.events : []);
  const initialTurnEndCount = initialEvents.filter(e => e?.type === 'turn/end').length;

  const startTime = Date.now();
  let deliveryMode;
  try {
    deliveryMode = dispatchNativeMessage(targetAgent, userMessage);
  } catch (dispatchErr) {
    return {
      success: false,
      targetSessionId: targetAgent?.id || rawTarget,
      targetTitle,
      targetStatus: 'error',
      deliveryMode: 'followup',
      callType,
      callerSessionId,
      contextPostIds: cleanPostIds,
      deliveryState: 'failed',
      executionState: 'crashed',
      error: { message: dispatchErr?.message || String(dispatchErr), code: 'DISPATCH_ERROR' },
      message: `[Session] 单播分发失败: ${dispatchErr?.message || dispatchErr}`
    };
  }
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

  // 分级轻量握手验证与执行状态解析 (ADR-0031)
  let deliveryState = 'enqueued';
  let executionState = 'pending';
  let executionError = null;
  let finalTargetStatus = targetAgent.status === 'running' ? 'running' : 'idle';

  if (callType === 'task_report' || callType === 'notice') {
    deliveryState = 'delivered';
    executionState = 'unverified';
    finalTargetStatus = targetAgent.status === 'running' ? 'running' : (resolveNativeSessionStatus(targetAgent).status);
  } else {
    // task_dispatch: 默认施加 300 毫秒轻量握手等待
    let waitMs = (targetAgent?.phase || targetAgent?.session?.events ? 300 : 0);
    if (typeof args.wait_ms === 'number' && !Number.isNaN(args.wait_ms)) {
      waitMs = Math.max(0, Math.min(5000, Math.floor(args.wait_ms)));
    }

    if (waitMs > 0) {
      const pollIntervalMs = 15;
      const handStartTime = Date.now();

      while (Date.now() - handStartTime < waitMs) {
        try {
          const statusRes = resolveNativeSessionStatus(targetAgent);
          const currentEvents = typeof targetAgent?.session?.snapshotEvents === 'function'
            ? targetAgent.session.snapshotEvents()
            : (Array.isArray(targetAgent?.session?.events) ? targetAgent.session.events : []);
          const currentTurnEndCount = currentEvents.filter(e => e?.type === 'turn/end').length;

          // 秒崩捕获：在等待窗口内新增了 turn/end 且其 reason 为 error
          if (statusRes.status === 'error' && currentTurnEndCount > initialTurnEndCount) {
            deliveryState = 'failed';
            executionState = 'crashed';
            executionError = statusRes.error;
            finalTargetStatus = 'error';
            break;
          }

          // 物理运行确认：已切入 running 并稳定执行
          if (statusRes.status === 'running') {
            if (Date.now() - handStartTime >= 40 || !targetAgent?.phase) {
              deliveryState = 'delivered';
              executionState = 'running';
              finalTargetStatus = 'running';
              break;
            }
          }
        } catch {
          // 会话中途消亡容错
          break;
        }

        await new Promise(r => setTimeout(r, pollIntervalMs));
      }

      // 超时判定
      if (executionState !== 'crashed' && executionState !== 'running') {
        const finalCheck = resolveNativeSessionStatus(targetAgent);
        const currentEvents = typeof targetAgent.session?.snapshotEvents === 'function'
          ? targetAgent.session.snapshotEvents()
          : (Array.isArray(targetAgent.session?.events) ? targetAgent.session.events : []);
        const currentTurnEndCount = currentEvents.filter(e => e?.type === 'turn/end').length;

        if (finalCheck.status === 'error' && currentTurnEndCount > initialTurnEndCount) {
          deliveryState = 'failed';
          executionState = 'crashed';
          executionError = finalCheck.error;
          finalTargetStatus = 'error';
        } else if (finalCheck.status === 'running') {
          deliveryState = 'delivered';
          executionState = 'running';
          finalTargetStatus = 'running';
        } else {
          deliveryState = 'enqueued';
          executionState = 'pending';
          finalTargetStatus = finalCheck.status;
        }
      }
    } else {
      // 显式 wait_ms: 0 或无异步循环 mock
      const immediateCheck = resolveNativeSessionStatus(targetAgent);
      finalTargetStatus = immediateCheck.status;
      deliveryState = 'enqueued';
      executionState = immediateCheck.status === 'running' ? 'running' : 'unverified';
    }
  }

  if (executionState === 'crashed') {
    return {
      success: false,
      targetSessionId: targetAgent.id,
      targetTitle,
      targetStatus: 'error',
      deliveryMode,
      callType,
      callerSessionId,
      contextPostIds: cleanPostIds,
      deliveryState: 'failed',
      executionState: 'crashed',
      error: executionError,
      message: `[Session] 目标会话启动首帧发生崩溃: ${executionError?.message || '未知错误'}`
    };
  }

  return {
    success: true,
    targetSessionId: targetAgent.id,
    targetTitle,
    targetStatus: finalTargetStatus,
    deliveryMode,
    callType,
    callerSessionId,
    contextPostIds: cleanPostIds,
    deliveryState,
    executionState,
    message: resolveMessages(ctx, options?.config).sessionCallSuccess(targetAgent.id, deliveryMode, callType)
  };
}