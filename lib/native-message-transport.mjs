/**
 * DSH Native Message Transport Module
 *
 * In-process communication transport layer:
 * - Generates unique message identifiers
 * - Sanitizes blackboard post references (Context Ref)
 * - Assembles objective transport semantic headers and standard UserMessage payloads
 * - Dispatches via status-aware native channels (steer / followup / send)
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

function formatContextRefLine(postIds) {
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
  const effectiveTitle = callerTitle || 'Session';
  const effectiveRaw = typeof rawMessage === 'string' ? rawMessage : (rawMessage == null ? '' : String(rawMessage));
  const shortPayload = effectiveRaw.replace(/[\r\n\t ]+/g, ' ').trim();

  let summary = '';
  let payloadText = '';

  if (isBootstrap) {
    summary = `[Peer Session Bootstrap] from ${effectiveTitle}: ${shortPayload}`;
    const refLine = formatContextRefLine(contextPostIds);
    payloadText = refLine ? `${refLine}\n\n${effectiveRaw}` : effectiveRaw;
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
