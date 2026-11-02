/**
 * DSH Cross-Session Call Service
 *
 * In-process unicast dispatch with status-aware channel selection (steer/followup).
 */
import { SessionDirectory, isTopLevelIdentity, resolveNativeSessionStatus } from './session-directory.mjs';
import { resolveResumeAgentOptions } from './dsh-host-gateway.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';
import { readHostService } from './host-services.mjs';
import { resolveMessages } from './locales/index.mjs';
import {
  CALL_TYPE_INTENTS,
  buildTransportPayload,
  buildNativeUserMessage,
  sanitizeContextPostIds,
  sanitizePostIds,
  dispatchNativeMessage,
  dispatchAndVerifyNativeMessage
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
 * 记录跨会话调用轨迹快照
 */
function recordCallTelemetrySnapshot(telemetryCtx, callMeta, dispatchMeta) {
  try {
    const ringBuffer = getCallTelemetry(telemetryCtx.ctx, telemetryCtx.options);
    if (!ringBuffer || typeof ringBuffer.record !== 'function') return;

    const directory = telemetryCtx.directory;
    const callerIdentity = callMeta.callerAgent ? directory.resolveIdentity(callMeta.callerAgent) : null;
    const targetIdentity = directory.resolveIdentity(callMeta.targetAgent);
    const callerNonTopLevel = !isTopLevelIdentity(callerIdentity);
    const targetNonTopLevel = !isTopLevelIdentity(targetIdentity);
    const rawMessage = callMeta.rawMessage;
    const shortPayload = (typeof rawMessage === 'string' ? rawMessage.replace(/[\r\n\t ]+/g, ' ').trim() : '');
    const messageSnippet = shortPayload.length > 120 ? shortPayload.slice(0, 117) + '...' : shortPayload;

    ringBuffer.record({
      callerSessionId: callMeta.callerSessionId,
      callerTitle: callMeta.callerTitle,
      callerWorkspace: callerIdentity ? callerIdentity.workspace : '',
      targetSessionId: callMeta.targetAgent.id,
      targetTitle: callMeta.targetTitle,
      targetWorkspace: targetIdentity.workspace || '',
      callType: callMeta.callType,
      deliveryMode: dispatchMeta.mode,
      timestamp: Date.now() - (dispatchMeta.durationMs || 0),
      durationMs: dispatchMeta.durationMs || 0,
      contextPostIds: callMeta.cleanPostIds,
      messageSnippet,
      messagePayload: rawMessage,
      callerNonTopLevel,
      targetNonTopLevel,
      status: 'active'
    });
  } catch (telemetryErr) {
    telemetryCtx.logger?.debug?.(`[dsh-call-session] Call telemetry recording failed: ${telemetryErr?.message || telemetryErr}`);
  }
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
    exec,
    // 冷恢复时由本模块解析模型三键并注入，session-directory 不依赖宿主网关
    resolveResumeAgentOptions: () => resolveResumeAgentOptions({ ctx, callerAgent })
  });

  const callerTitle = callerAgent
    ? directory.resolveDisplayTitle(callerAgent)
    : 'Session';

  const cleanPostIds = sanitizePostIds(args.context_post_ids);

  // 目标处于错误态时，汇报消息转存黑板，其他调用直接拦截
  const targetHealth = resolveNativeSessionStatus(targetAgent);

  if (targetHealth.status === 'error') {
    if (callType === 'task_report') {
      const boardStore = options.boardStore || readHostService(ctx, 'boardStore');
      let fallbackPostId = null;
      if (boardStore && typeof boardStore.post === 'function') {
        try {
          const now = Date.now();
          const callerWs = directory.resolveWorkspace(callerAgent);
          const bp = boardStore.post({
            id: `post-${now}-${Math.random().toString(36).slice(2, 8)}`,
            topic: 'report:fallback',
            content: `目标会话 [${targetAgent.id}] 处于错误状态，汇报转存:\n\n${rawMessage}`,
            tags: ['report', 'fallback'],
            authorSessionId: callerSessionId,
            authorTitle: callerTitle,
            authorWorkspace: callerWs,
            metadata: {
              targetSessionId: targetAgent.id,
              targetTitle,
              crashedError: targetHealth.error
            }
          });
          fallbackPostId = bp?.id || null;
        } catch (postErr) {
          logger.debug?.(`[dsh-call-session] Report fallback post failed: ${postErr?.message || postErr}`);
        }
      }
      return {
        success: true,
        targetSessionId: targetAgent.id,
        targetTitle,
        targetStatus: 'error',
        deliveryMode: 'followup',
        callType: 'task_report',
        callerSessionId,
        contextPostIds: cleanPostIds,
        deliveryState: 'delivered',
        executionState: 'unverified',
        fallbackPostId,
        message: `[Session] 目标会话处于错误状态，汇报内容已转存至公共黑板 #${fallbackPostId || 'unknown'}`
      };
    }

    return {
      success: false,
      targetSessionId: targetAgent.id,
      targetTitle,
      targetStatus: 'error',
      deliveryMode: 'followup',
      callType,
      callerSessionId,
      contextPostIds: cleanPostIds,
      deliveryState: 'failed',
      executionState: 'crashed',
      error: {
        category: 'PREFLIGHT',
        code: 'PREFLIGHT_TARGET_IN_ERROR',
        message: targetHealth.error?.message || 'Target session is in error state',
        details: targetHealth.error
      },
      message: `[Session] 目标会话处于错误异常状态，前置拒绝投递: ${targetHealth.error?.message || '未知错误'}`
    };
  }

  const userMessage = buildNativeUserMessage({
    rawMessage,
    form: 'notice',
    callerSessionId,
    callerTitle,
    callType,
    contextPostIds: cleanPostIds
  });

  let deliveryMode = 'followup';
  let dispatchResult;
  try {
    dispatchResult = await dispatchAndVerifyNativeMessage(targetAgent, userMessage, {
      callType,
      waitMs: args.wait_ms,
      defaultDeliveryState: 'enqueued',
      resolveStatus: resolveNativeSessionStatus,
      onDispatched: ({ deliveryMode: mode, durationMs }) => {
        deliveryMode = mode;
        logger.debug?.(`[dsh-call-session] Successfully dispatched native notice to ${targetAgent.id} via ${mode}`);
        recordCallTelemetrySnapshot(
          { ctx, options, logger, directory },
          { callerAgent, callerSessionId, callerTitle, targetAgent, targetTitle, callType, cleanPostIds, rawMessage },
          { mode, durationMs }
        );
      }
    });
    deliveryMode = dispatchResult.deliveryMode;
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

  const deliveryState = dispatchResult.deliveryState;
  const executionState = dispatchResult.executionState;
  const finalTargetStatus = dispatchResult.finalStatus;
  const executionError = dispatchResult.executionError;

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
    message: resolveMessages(ctx, options?.config).sessionCallSuccess(targetAgent.id, deliveryMode, callType, executionState, deliveryState)
  };
}