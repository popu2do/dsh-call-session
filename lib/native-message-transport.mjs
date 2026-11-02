/**
 * DSH Native Message Transport Module
 *
 * In-process communication transport layer:
 * - Generates unique message identifiers
 * - Sanitizes blackboard post references (Context Ref)
 * - Assembles objective transport semantic headers and standard UserMessage payloads
 * - Dispatches via status-aware native channels (steer / followup / send)
 * - Implements cross-session handshake call waiting primitives (waitForCausalExecution)
 * - Provides composite native dispatch and verification (dispatchAndVerifyNativeMessage)
 * - Encapsulates physical execution causal verification assertions (checkCausalRunning / checkCausalRunningFinal)
 */
import { randomUUID } from 'node:crypto';

export function generateMessageId() {
  return randomUUID();
}

export const CALL_TYPE_INTENTS = Object.freeze({
  task_dispatch: 'TASK_DISPATCH',
  task_report: 'TASK_REPORT',
  notice: 'NOTICE'
});

export const DEFAULT_BOOTSTRAP_CALLER_ID = 'root-session';

/**
 * 清洗并去重关联黑板条目 ID 列表
 *
 * @param {unknown} postIds 原始 ID 列表
 * @returns {string[]} 规范化剥离井号并去重后的 ID 列表
 */
export function sanitizeContextPostIds(postIds) {
  if (!Array.isArray(postIds)) return [];
  const result = [];
  const seen = new Set();
  for (const item of postIds) {
    if (item === null || item === undefined) continue;
    const str = String(item).trim();
    if (!str || str === '#') continue;
    const norm = str.replace(/^#+/, '');
    if (!norm) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}

/**
 * 清洗并去重关联黑板条目 ID 列表（向后兼容保留输入前缀）
 *
 * @param {unknown} postIds 原始 ID 列表
 * @returns {string[]}
 */
export function sanitizePostIds(postIds) {
  if (!Array.isArray(postIds)) return [];
  const result = [];
  const seen = new Set();
  for (const item of postIds) {
    if (item === null || item === undefined) continue;
    const str = String(item).trim();
    if (!str || str === '#') continue;
    const norm = str.replace(/^#+/, '');
    if (!norm) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(str);
    }
  }
  return result;
}

export function formatContextRefLine(postIds) {
  const valid = sanitizeContextPostIds(postIds);
  if (valid.length === 0) return '';
  const refs = valid.map(id => `#${id}`).join(', ');
  return `> Context Ref: ${refs}`;
}

/**
 * 构造客观传输层语义载荷 (Transport Semantic Header)
 *
 * 遵循 ADR-0006 与 ADR-0029 传输层报头规范：
 * 1. 首行注入发件人身份与呼叫类别客观报头：[From: <callerSessionId> (<callerTitle>) | CallType: <callType>]
 * 2. 若有关联条目引用，换行追加：> Context Ref: #post-xxx, #post-yyy
 * 3. 报头与正文以双换行符 \n\n 分隔，正文逐字保留，不注入任何引导性提示词。
 *
 * @param {string} rawMessage 原始正文
 * @param {object} [options] 报头选项
 * @param {string} [options.callerSessionId] 发件人 Session ID
 * @param {string} [options.callerTitle] 发件人标题
 * @param {string} [options.callType] 呼叫类别
 * @param {string[]} [options.contextPostIds] 关联黑板条目 ID 列表
 * @param {string[]} [options.cleanPostIds] 兼容别名
 * @returns {string} 注入客观报头后的完整消息载荷
 */
export function buildTransportPayload(rawMessage, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const callerSessionId = opts.callerSessionId;
  const callerTitle = opts.callerTitle;
  const callType = opts.callType;

  const rawCallerId = (typeof callerSessionId === 'string' ? callerSessionId : '').replace(/[\r\n]+/g, ' ').trim();
  const effectiveCallerId = rawCallerId || 'unknown-caller';

  const rawCallerTitle = (typeof callerTitle === 'string' ? callerTitle : '').replace(/[\r\n]+/g, ' ').trim();
  const effectiveCallerTitle = rawCallerTitle || 'Session';

  const normalizedCallType = (typeof callType === 'string' && Object.prototype.hasOwnProperty.call(CALL_TYPE_INTENTS, callType))
    ? callType
    : 'task_dispatch';

  let header = `[From: ${effectiveCallerId} (${effectiveCallerTitle}) | CallType: ${normalizedCallType}]`;

  const candidatePostIds = Array.isArray(opts.contextPostIds) && opts.contextPostIds.length > 0
    ? opts.contextPostIds
    : (opts.cleanPostIds || opts.contextPostIds);
  const refLine = formatContextRefLine(candidatePostIds);
  if (refLine) {
    header += `\n${refLine}`;
  }

  const messageText = typeof rawMessage === 'string'
    ? rawMessage
    : (rawMessage === null || rawMessage === undefined ? '' : String(rawMessage));
  return `${header}\n\n${messageText}`;
}

/**
 * 构造标准 DSH UserMessage 消息对象
 *
 * @param {object} options
 * @param {string} options.rawMessage 原始正文
 * @param {'notice' | 'session_create' | string} [options.form='notice'] 消息来源形式
 * @param {string} [options.callerSessionId] 发件人 Session ID
 * @param {string} [options.callerTitle] 发件人标题
 * @param {string} [options.callType] 呼叫类别
 * @param {string[]} [options.contextPostIds] 关联黑板条目 ID 列表
 * @param {() => string} [options.generateMessageId] 自定义 ID 生成器
 * @returns {object} 标准 DSH UserMessage 对象
 */
export function buildNativeUserMessage(options = {}) {
  const {
    rawMessage,
    form = 'notice',
    callerSessionId,
    callerTitle,
    callType,
    contextPostIds,
    generateMessageId: customIdGen
  } = options;

  const isBootstrap = form === 'session_create';
  const cleanTitle = typeof callerTitle === 'string' ? callerTitle.trim() : '';
  const effectiveTitle = cleanTitle || 'Session';
  const effectiveRaw = typeof rawMessage === 'string' ? rawMessage : (rawMessage == null ? '' : String(rawMessage));
  const shortPayload = effectiveRaw.replace(/[\r\n\t ]+/g, ' ').trim();

  let summary = '';
  let payloadText = '';

  if (isBootstrap) {
    summary = `[Peer Session Bootstrap] from ${effectiveTitle}: ${shortPayload}`;
    const cleanBootstrapCallerId = typeof callerSessionId === 'string' ? callerSessionId.trim() : '';
    payloadText = buildTransportPayload(effectiveRaw, {
      callerSessionId: cleanBootstrapCallerId || DEFAULT_BOOTSTRAP_CALLER_ID,
      callerTitle: effectiveTitle,
      callType: 'task_dispatch',
      contextPostIds
    });
  } else {
    const intentStr = (callType && Object.prototype.hasOwnProperty.call(CALL_TYPE_INTENTS, callType))
      ? CALL_TYPE_INTENTS[callType]
      : (callType ? String(callType).toUpperCase() : 'TASK_DISPATCH');
    summary = `[Cross-Session ${intentStr}] from ${effectiveTitle}: ${shortPayload}`;
    payloadText = buildTransportPayload(effectiveRaw, {
      callerSessionId,
      callerTitle: effectiveTitle,
      callType,
      contextPostIds
    });
  }

  if (summary.length > 120) {
    summary = summary.slice(0, 117) + '...';
  }

  const idGen = typeof customIdGen === 'function' ? customIdGen : generateMessageId;

  return {
    id: idGen(),
    role: 'user',
    content: [{ type: 'text', text: payloadText }],
    source: {
      kind: 'plugin:dsh-call-session',
      form,
      summary
    }
  };
}

/**
 * 基于目标 Agent 运行状态分发消息
 *
 * @param {object} targetAgent 目标 Agent 实例
 * @param {object} userMessage DSH 原生 UserMessage 对象
 * @returns {'steer' | 'followup'} 分发通道标识
 */
export function dispatchNativeMessage(targetAgent, userMessage) {
  if (!targetAgent || typeof targetAgent !== 'object') {
    throw new Error('[InvalidParameter] dispatchNativeMessage: targetAgent must be a valid Agent instance.');
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

  throw new Error(`[ServiceUnavailable] Target Agent [${targetAgent.id}] provides no native dispatch method (followup, steer, or send).`);
}

/**
 * 读取会话事件流快照
 *
 * 优先使用 snapshotEvents 投影；宿主未提供时退回原始 events 数组。
 *
 * @param {object} targetAgent 目标 Agent 实例
 * @returns {any[]} 事件数组，缺失时为只读空数组
 */
function snapshotSessionEvents(targetAgent) {
  if (typeof targetAgent?.session?.snapshotEvents === 'function') return targetAgent.session.snapshotEvents();
  return Array.isArray(targetAgent?.session?.events) ? targetAgent.session.events : [];
}

/**
 * 采集目标会话的因果计数器
 *
 * @param {object} targetAgent 目标 Agent 实例
 * @returns {{ events: any[], turn: number, step: number, stepStartCount: number, turnEndCount: number }}
 */
export function extractCausalCounters(targetAgent) {
  const events = snapshotSessionEvents(targetAgent);
  const turn = typeof targetAgent?.phase?.turn === 'number' ? targetAgent.phase.turn : 0;
  const step = typeof targetAgent?.phase?.step === 'number' ? targetAgent.phase.step : 0;
  const stepStartCount = events.filter(e => e?.type === 'step/start').length;
  const turnEndCount = events.filter(e => e?.type === 'turn/end').length;
  return { events, turn, step, stepStartCount, turnEndCount };
}

/**
 * 校验目标会话是否达成物理执行因果确权
 *
 * @param {object} params
 * @param {object} params.statusRes 状态解析结果
 * @param {object} params.targetAgent 目标 Agent
 * @param {boolean} [params.initialTargetRunning=false] 初始运行状态
 * @param {number} [params.initialStepCount=0] 初始 step 计数值
 * @param {number} [params.initialStepStartCount=0] 初始 step/start 事件数
 * @returns {boolean}
 */
export function checkCausalRunning({
  statusRes,
  targetAgent,
  initialTargetRunning = false,
  initialStepCount = 0,
  initialStepStartCount = 0
} = {}) {
  if (statusRes?.status !== 'running') return false;
  if (!targetAgent?.phase) return true;

  const { step, stepStartCount } = extractCausalCounters(targetAgent);
  const isAdvancing = (step >= 1 && step > initialStepCount) || (stepStartCount > initialStepStartCount);
  return (!initialTargetRunning && step >= 1) || isAdvancing;
}

/**
 * 等待窗口期满时校验目标会话是否达成因果运行确权
 *
 * @param {object} params
 * @param {object} params.finalCheck 状态解析结果
 * @param {object} params.targetAgent 目标 Agent
 * @param {boolean} [params.initialTargetRunning=false] 初始运行状态
 * @param {number} [params.initialStepCount=0] 初始 step 计数值
 * @param {number} [params.initialStepStartCount=0] 初始 step/start 事件数
 * @param {number} [params.initialTurnCount=0] 初始 turn 计数值
 * @returns {boolean}
 */
export function checkCausalRunningFinal({
  finalCheck,
  targetAgent,
  initialTargetRunning = false,
  initialStepCount = 0,
  initialStepStartCount = 0,
  initialTurnCount = 0
} = {}) {
  if (finalCheck?.status !== 'running') return false;
  if (!targetAgent?.phase) return true;

  const { turn, step, stepStartCount } = extractCausalCounters(targetAgent);
  const isAdvancing = (step >= 1 && step > initialStepCount) ||
    (stepStartCount > initialStepStartCount) ||
    (turn > initialTurnCount);
  return (!initialTargetRunning && (step >= 1 || turn >= 1)) || isAdvancing;
}

/**
 * 提取并归一化会话错误结构
 *
 * @param {any} rawError 原始错误对象或字符串
 * @returns {{ category: string, code: string, message: string, details?: unknown }}
 */
export function classifyError(rawError) {
  if (!rawError) {
    return {
      category: 'RUNTIME',
      code: 'TURN_ERROR',
      message: 'Turn execution failed with error',
      details: null
    };
  }

  const msg = typeof rawError === 'object' && rawError !== null
    ? String(rawError.message || rawError.msg || '')
    : String(rawError);
  const rawCode = typeof rawError === 'object' && rawError !== null && rawError.code
    ? String(rawError.code)
    : '';
  const code = (rawCode === 'UNKNOWN' || rawCode === 'TURN_ERROR') ? '' : rawCode;

  if (
    /prompt variable|assembly|section "deployment:|template|renderPrompt|compilePrompt/i.test(msg) ||
    /ASSEMBLY/i.test(code)
  ) {
    return {
      category: 'ASSEMBLY',
      code: code || 'PROMPT_ASSEMBLY_ERROR',
      message: msg || 'Prompt template assembly failed',
      fatal: true,
      details: rawError
    };
  }

  if (/dispatch|followup|steer|send method/i.test(msg) || /DISPATCH/i.test(code)) {
    return {
      category: 'DISPATCH',
      code: code || 'DISPATCH_ERROR',
      message: msg || 'Dispatch method failed',
      fatal: true,
      details: rawError
    };
  }

  if (/PREFLIGHT|TARGET_IN_ERROR/i.test(code)) {
    return {
      category: 'PREFLIGHT',
      code: code || 'PREFLIGHT_TARGET_IN_ERROR',
      message: msg || 'Target session is in error state',
      fatal: true,
      details: rawError
    };
  }

  if (/TIMEOUT/i.test(code) || /timed out/i.test(msg)) {
    return {
      category: 'TIMEOUT',
      code: code || 'HANDSHAKE_TIMEOUT',
      message: msg || 'Handshake confirmation timed out',
      fatal: false,
      details: rawError
    };
  }

  return {
    category: 'RUNTIME',
    code: code || 'TURN_ERROR',
    message: msg || 'Turn execution failed with error',
    fatal: true,
    details: rawError
  };
}

/**
 * 基于 DSH 原生 phase 与 session.events 推导会话状态 (running | idle | error)
 *
 * 1. 若 agent.phase.kind 为 running 或 agent.status 为 running，判定为 running；
 * 2. 检查未捕获错误字段；
 * 3. 倒序扫描最新 turn/end 事件，若为 error 则分类返回；
 * 4. 正常结束则返回 idle；
 * 5. 无事件记录时返回 idle。
 *
 * @param {any} agent
 * @returns {{ status: 'running' | 'idle' | 'error', error: any | null }}
 */
export function resolveNativeSessionStatus(agent) {
  if (!agent) return { status: 'idle', error: null };

  try {
    if (agent.phase?.kind === 'running' || agent.status === 'running') {
      return { status: 'running', error: null };
    }

    const directError = agent.lastError || agent.session?.lastError || agent.error || agent.session?.error;
    if (directError && agent.status !== 'running' && agent.phase?.kind !== 'running') {
      return {
        status: 'error',
        error: classifyError(directError)
      };
    }

    const events = typeof agent.session?.snapshotEvents === 'function'
      ? agent.session.snapshotEvents()
      : (Array.isArray(agent.session?.events) ? agent.session.events : []);

    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev && typeof ev === 'object' && ev.type === 'turn/end') {
          const reason = ev.data?.reason || ev.payload?.reason;
          if (reason?.kind === 'error') {
            const rawError = reason.error;
            return {
              status: 'error',
              error: classifyError(rawError)
            };
          }
          // completed 或 aborted 等非 error 终态中断搜索
          break;
        }
      }
    }
  } catch {
    return { status: 'idle', error: null };
  }

  return { status: 'idle', error: null };
}

/**
 * 规约轻量握手等待时间毫秒数
 *
 * @param {any} rawWaitMs 原始入参 waitMs
 * @param {any} targetAgent 目标 Agent 实例
 * @returns {number} 钳制在 [0, 5000] 之间的整数毫秒数
 */
export function clampWaitMs(rawWaitMs, targetAgent) {
  if (typeof rawWaitMs !== 'number' || Number.isNaN(rawWaitMs)) {
    return (targetAgent?.phase || targetAgent?.session?.events) ? 300 : 0;
  }
  return Math.max(0, Math.min(5000, Math.floor(rawWaitMs)));
}

/**
 * 统一跨会话握手因果等待原语 (Handshake Call Wait Primitive)
 *
 * 在指定的等待窗口内轮询目标会话状态与因果计数器，精准判断执行状态。
 * 支持双重载入参：
 * 1. waitForCausalExecution(targetAgent, options)
 * 2. waitForCausalExecution(options)
 *
 * @param {object} targetAgentOrOptions 目标 Agent 实例或配置对象
 * @param {object} [maybeOptions] 配置对象
 * @returns {Promise<{
 *   deliveryState: 'delivered' | 'enqueued' | 'failed',
 *   executionState: 'running' | 'pending' | 'crashed' | 'unverified',
 *   finalStatus: 'running' | 'idle' | 'error',
 *   executionError: any
 * }>}
 */
export async function waitForCausalExecution(targetAgentOrOptions, maybeOptions) {
  // 重载判定：当首参存在且传入了第二参数 maybeOptions 时，或首参明显为 Agent 实例且无 options 包裹时视为位置重载
  const isPositional = Boolean(
    maybeOptions !== undefined ||
    (targetAgentOrOptions && !targetAgentOrOptions.targetAgent && (
      typeof targetAgentOrOptions.followup === 'function' ||
      typeof targetAgentOrOptions.steer === 'function' ||
      typeof targetAgentOrOptions.send === 'function' ||
      targetAgentOrOptions.session ||
      targetAgentOrOptions.phase
    ))
  );

  const options = isPositional
    ? (maybeOptions || {})
    : (targetAgentOrOptions || {});

  const targetAgent = isPositional
    ? targetAgentOrOptions
    : options.targetAgent;

  const waitMs = clampWaitMs(options.waitMs, targetAgent);

  const resolve = typeof options.resolveStatus === 'function'
    ? options.resolveStatus
    : resolveNativeSessionStatus;

  const initialTargetRunning = Boolean(options.initialTargetRunning);
  const initialStepCount = typeof options.initialStepCount === 'number' ? options.initialStepCount : 0;
  const initialStepStartCount = typeof options.initialStepStartCount === 'number' ? options.initialStepStartCount : 0;
  const initialTurnCount = typeof options.initialTurnCount === 'number' ? options.initialTurnCount : 0;
  const initialTurnEndCount = typeof options.initialTurnEndCount === 'number' ? options.initialTurnEndCount : 0;
  const pollIntervalMs = typeof options.pollIntervalMs === 'number' ? options.pollIntervalMs : 15;

  if (waitMs <= 0) {
    const immediateCheck = resolve(targetAgent);
    return {
      deliveryState: 'enqueued',
      executionState: immediateCheck.status === 'running' ? 'running' : 'unverified',
      finalStatus: immediateCheck.status,
      executionError: null
    };
  }

  const startTime = Date.now();
  let deliveryState = 'enqueued';
  let executionState = 'pending';
  let finalStatus = 'idle';
  let executionError = null;

  while (Date.now() - startTime < waitMs) {
    try {
      const statusRes = resolve(targetAgent);
      // 只认派发后新增的 turn/end：派发前的历史错误不代表本次投递失败
      const { turnEndCount: currentTurnEndCount } = extractCausalCounters(targetAgent);

      if (statusRes.status === 'error' && currentTurnEndCount > initialTurnEndCount) {
        deliveryState = 'failed';
        executionState = 'crashed';
        executionError = statusRes.error;
        finalStatus = 'error';
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
        finalStatus = 'running';
        break;
      }
    } catch {
      break;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  if (executionState !== 'crashed' && executionState !== 'running') {
    const finalCheck = resolve(targetAgent);
    const { turnEndCount: currentTurnEndCount } = extractCausalCounters(targetAgent);
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
      finalStatus = 'error';
    } else if (isCausallyRunningFinal) {
      deliveryState = 'delivered';
      executionState = 'running';
      finalStatus = 'running';
    } else {
      deliveryState = 'enqueued';
      executionState = 'pending';
      finalStatus = finalCheck.status;
    }
  }

  return {
    deliveryState,
    executionState,
    finalStatus,
    executionError
  };
}

/**
 * 复合派发与握手因果验证原语 (Composite Native Dispatch and Handshake Verification)
 *
 * 原子装配消息、快照初始因果基线、原生通道派发并根据呼叫策略执行因果等待验证。
 * 支持双重载入参：
 * 1. dispatchAndVerifyNativeMessage(targetAgent, userMessage, options)
 * 2. dispatchAndVerifyNativeMessage(options)
 *
 * @param {object} targetAgentOrOptions 目标 Agent 实例或配置对象
 * @param {object} [maybeUserMessage] DSH 原生 UserMessage 对象
 * @param {object} [maybeOptions] 配置对象
 * @returns {Promise<{
 *   deliveryMode: 'steer' | 'followup',
 *   deliveryState: 'delivered' | 'enqueued' | 'failed',
 *   executionState: 'running' | 'pending' | 'crashed' | 'unverified',
 *   finalStatus: 'running' | 'idle' | 'error',
 *   executionError: any
 * }>}
 */
export async function dispatchAndVerifyNativeMessage(targetAgentOrOptions, maybeUserMessage, maybeOptions) {
  // 重载判定：优先检查是否传了 maybeUserMessage（位置参数传参），或 targetAgentOrOptions 具有 Agent 方法且不是单纯 options 对象
  const isPositional = Boolean(
    maybeUserMessage !== undefined ||
    (targetAgentOrOptions && !targetAgentOrOptions.targetAgent && !targetAgentOrOptions.userMessage && !targetAgentOrOptions.message && (
      typeof targetAgentOrOptions.followup === 'function' ||
      typeof targetAgentOrOptions.steer === 'function' ||
      typeof targetAgentOrOptions.send === 'function' ||
      targetAgentOrOptions.session ||
      targetAgentOrOptions.phase
    ))
  );

  const options = isPositional
    ? (maybeOptions || {})
    : (targetAgentOrOptions || {});

  const targetAgent = isPositional
    ? targetAgentOrOptions
    : options.targetAgent;

  const userMessage = isPositional
    ? maybeUserMessage
    : (options.userMessage || options.message);

  const callType = options.callType || 'task_dispatch';
  const resolve = typeof options.resolveStatus === 'function'
    ? options.resolveStatus
    : resolveNativeSessionStatus;
  const pollIntervalMs = typeof options.pollIntervalMs === 'number' ? options.pollIntervalMs : 15;

  // 派发前快照因果基线，供等待原语判定增量推进
  const initialCounters = extractCausalCounters(targetAgent);
  const initialTargetRunning = targetAgent?.status === 'running' || targetAgent?.phase?.kind === 'running';
  const initialTurnEndCount = initialCounters.turnEndCount;

  const deliveryMode = dispatchNativeMessage(targetAgent, userMessage);

  if (callType === 'task_report' || callType === 'notice') {
    const immediateStatus = targetAgent?.status === 'running' ? 'running' : resolve(targetAgent).status;
    return {
      deliveryMode,
      deliveryState: 'delivered',
      executionState: 'unverified',
      finalStatus: immediateStatus,
      executionError: null
    };
  }

  const waitMs = clampWaitMs(options.waitMs, targetAgent);

  // 依据 ADR-0031 §4.2 与 Spec-014 契约：waitMs 为 0 或无异步等待能力时返回 delivered 与 unverified
  if (waitMs <= 0) {
    const immediateCheck = resolve(targetAgent);
    return {
      deliveryMode,
      deliveryState: 'delivered',
      executionState: 'unverified',
      finalStatus: immediateCheck.status,
      executionError: null
    };
  }

  const causalResult = await waitForCausalExecution({
    targetAgent,
    waitMs,
    resolveStatus: resolve,
    initialTargetRunning,
    initialStepCount: initialCounters.step,
    initialStepStartCount: initialCounters.stepStartCount,
    initialTurnCount: initialCounters.turn,
    initialTurnEndCount,
    pollIntervalMs
  });

  return {
    deliveryMode,
    ...causalResult
  };
}
