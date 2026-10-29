/**
 * DSH Cross-Session Call Service
 *
 * In-process unicast dispatch with status-aware channel selection (steer/followup).
 */
import { SessionDirectory, isTopLevelIdentity, resolveNativeSessionStatus, checkCausalRunning, checkCausalRunningFinal } from './session-directory.mjs';
import { getCallTelemetry } from './call-telemetry.mjs';
import { readHostService } from './host-services.mjs';
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

  const initialTargetRunning = targetAgent?.status === 'running' || targetAgent?.phase?.kind === 'running';
  const initialEvents = typeof targetAgent.session?.snapshotEvents === 'function'
    ? targetAgent.session.snapshotEvents()
    : (Array.isArray(targetAgent.session?.events) ? targetAgent.session.events : []);
  const initialTurnEndCount = initialEvents.filter(e => e?.type === 'turn/end').length;
  const initialTurnCount = typeof targetAgent?.phase?.turn === 'number' ? targetAgent.phase.turn : 0;
  const initialStepCount = typeof targetAgent?.phase?.step === 'number' ? targetAgent.phase.step : 0;
  const initialStepStartCount = initialEvents.filter(e => e?.type === 'step/start').length;

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
      // 端点身份此刻可解：一次解析同时给出 workdir 与顶层判据，落存供出站合成节点时复用（ADR-0013 §2.2.7）
      const callerIdentity = callerAgent ? directory.resolveIdentity(callerAgent) : null;
      const targetIdentity = directory.resolveIdentity(targetAgent);
      const callerNonTopLevel = !isTopLevelIdentity(callerIdentity);
      const targetNonTopLevel = !isTopLevelIdentity(targetIdentity);
      const shortPayload = (typeof rawMessage === 'string' ? rawMessage.replace(/[\r\n\t ]+/g, ' ').trim() : '');
      const messageSnippet = shortPayload.length > 120 ? shortPayload.slice(0, 117) + '...' : shortPayload;
      ringBuffer.record({
        callerSessionId,
        callerTitle,
        callerWorkspace: callerIdentity ? callerIdentity.workspace : '',
        targetSessionId: targetAgent.id,
        targetTitle,
        targetWorkspace: targetIdentity.workspace || '',
        callType,
        deliveryMode,
        timestamp: startTime,
        durationMs,
        contextPostIds: cleanPostIds,
        messageSnippet,
        messagePayload: rawMessage,
        callerNonTopLevel,
        targetNonTopLevel,
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

          // 异常捕获：在等待窗口内新增了 turn/end 且其 reason 为 error
          if (statusRes.status === 'error' && currentTurnEndCount > initialTurnEndCount) {
            deliveryState = 'failed';
            executionState = 'crashed';
            executionError = statusRes.error;
            finalTargetStatus = 'error';
            break;
          }

          const isCausallyRunning = checkCausalRunning({
            statusRes,
            targetAgent,
            initialTargetRunning,
            initialStepCount,
            initialStepStartCount
          });

          if (isCausallyRunning) {
            deliveryState = 'delivered';
            executionState = 'running';
            finalTargetStatus = 'running';
            break;
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
        const isCausallyRunningFinal = checkCausalRunningFinal({
          finalCheck,
          targetAgent,
          initialTargetRunning,
          initialStepCount,
          initialStepStartCount,
          initialTurnCount
        });

        if (finalCheck.status === 'error' && currentTurnEndCount > initialTurnEndCount) {
          deliveryState = 'failed';
          executionState = 'crashed';
          executionError = finalCheck.error;
          finalTargetStatus = 'error';
        } else if (isCausallyRunningFinal) {
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
    message: resolveMessages(ctx, options?.config).sessionCallSuccess(targetAgent.id, deliveryMode, callType, executionState, deliveryState)
  };
}