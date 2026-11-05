/**
 * DSH In-Memory Call Telemetry Ring Buffer
 *
 * Provides a bounded FIFO ring buffer for session_call telemetry,
 * workspace-scoped filtering, and session lifecycle cascade cleanup.
 * Pure in-memory data structure with zero disk I/O and zero external dependencies.
 */

import { normalizeWorkspace } from './workspace.mjs';
import { readHostService, readProperty } from './host-services.mjs';
import {
  isHumanReadableTitle,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
} from './session-directory.mjs';
import { resolveLocale, getCatalog } from './locales/index.mjs';

/**
 * 内存环形调用记录缓冲区
 * 遵循确定性上限与 FIFO 淘汰机制，保证零磁盘 I/O 与受控内存占用。
 */
export class CallTelemetryRingBuffer {
  /**
   * @param {number} [capacity=200] 缓冲区最大容量，限制在 10 ~ 2000
   */
  constructor(capacity = 200) {
    const parsed = typeof capacity === 'number' && !Number.isNaN(capacity) ? Math.floor(capacity) : 200;
    this._capacity = Math.min(Math.max(parsed, 10), 2000);
    this._buffer = [];
    this._pendingTasks = [];
  }

  /**
   * 获取当前缓冲区最大容量
   * @returns {number}
   */
  capacity() {
    return this._capacity;
  }

  /**
   * 获取当前缓冲区已存条目数量
   * @returns {number}
   */
  size() {
    return this._buffer.length;
  }

  /**
   * 清空缓冲区全部条目
   */
  clear() {
    this._buffer = [];
    this._pendingTasks = [];
  }

  /**
   * 写入一条调用记录，满容时按 FIFO 弹出最旧条目
   *
   * @param {object} entry 调用条目原始字段
   * @returns {import('../types/call-telemetry.js').CallTelemetryRecord}
   */
  record(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('[InvalidParameter] CallTelemetryRingBuffer.record: entry must be an object.');
    }

    const now = typeof entry.timestamp === 'number' && entry.timestamp > 0 ? entry.timestamp : Date.now();
    const id = typeof entry.id === 'string' && entry.id.trim()
      ? entry.id.trim()
      : `call-${now}-${Math.random().toString(36).slice(2, 8)}`;

    let snippet = typeof entry.messageSnippet === 'string' ? entry.messageSnippet : '';
    if (!snippet && typeof entry.messagePayload === 'string') {
      snippet = entry.messagePayload.replace(/[\r\n\t ]+/g, ' ').trim();
    }
    if (snippet.length > 120) {
      snippet = snippet.slice(0, 117) + '...';
    }

    let payload = typeof entry.messagePayload === 'string' ? entry.messagePayload : '';
    if (payload.length > 8192) {
      payload = payload.slice(0, 8189) + '...';
    }

    const record = {
      id: id.slice(0, 128),
      callerSessionId: String(entry.callerSessionId || 'unknown-caller').slice(0, 128),
      callerTitle: String(entry.callerTitle || 'Session').slice(0, 128),
      callerWorkspace: normalizeWorkspace(entry.callerWorkspace || ''),
      targetSessionId: String(entry.targetSessionId || 'unknown-target').slice(0, 128),
      targetTitle: String(entry.targetTitle || 'Session').slice(0, 128),
      targetWorkspace: normalizeWorkspace(entry.targetWorkspace || ''),
      callType: ['notice', 'task_soft', 'task_hard', 'task_report'].includes(entry.callType) ? entry.callType : 'task_soft',
      deliveryMode: ['steer', 'followup'].includes(entry.deliveryMode) ? entry.deliveryMode : 'followup',
      timestamp: now,
      durationMs: typeof entry.durationMs === 'number' && entry.durationMs >= 0 ? entry.durationMs : 0,
      contextPostIds: Array.isArray(entry.contextPostIds)
        ? entry.contextPostIds.map(String).map(s => s.trim()).filter(Boolean).slice(0, 50)
        : [],
      messageSnippet: snippet,
      messagePayload: payload,
      callerNonTopLevel: entry.callerNonTopLevel === true,
      targetNonTopLevel: entry.targetNonTopLevel === true,
      status: entry.status === 'settled' ? 'settled' : 'active'
    };

    if (this._buffer.length >= this._capacity) {
      this._buffer.shift();
    }
    this._buffer.push(record);

    // 追踪待办任务：义务只落在收件方身上（它欠一条回执），发起方不欠任何东西。
    // 结项严格先进先出：一次 task_report 落定同一发起方—接收方配对里最早入队的一条。
    const isTaskObligation = record.callType === 'task_soft' || record.callType === 'task_hard';
    if (isTaskObligation) {
      this._pendingTasks.push({
        callId: record.id,
        callerSessionId: record.callerSessionId,
        callerTitle: record.callerTitle,
        targetSessionId: record.targetSessionId,
        callType: record.callType,
        timestamp: record.timestamp
      });
    } else if (record.callType === 'task_report') {
      // 回执由收件方发给发起方，因此配对方向是反的：记录的发起方等于待办的接收方。
      // 唯一配对由账本的 (sender, receiver) 匹配函数判定，这里是纯先进先出：回执取走
      // 配对里最早入队的一条，不论它是硬任务还是软任务。
      const settled = this._pendingTasks.find((t) => this.matchesPair(t, record.callerSessionId, record.targetSessionId));
      if (settled) {
        this._pendingTasks.splice(this._pendingTasks.indexOf(settled), 1);
        const origRecord = this._buffer.find(r => r.id === settled.callId);
        if (origRecord) {
          origRecord.status = 'settled';
        }
      } else {
        // 无在账任务可结：不报错（故事 6），但要留痕，否则中继场景的落空回执没法排查。
        this.lastUnmatchedReport = {
          callerSessionId: record.callerSessionId,
          targetSessionId: record.targetSessionId,
          timestamp: record.timestamp
        };
      }
    }

    return record;
  }

  /**
   * 按条件查询调用记录
   *
   * @param {import('../types/call-telemetry.js').CallTelemetryFilter} [filter]
   * @returns {import('../types/call-telemetry.js').CallTelemetryRecord[]}
   */
  query(filter = {}) {
    const {
      workspace,
      crossWorkspace = false,
      limit = 50,
      since,
      sessionId,
      status
    } = filter;

    const effectiveCrossWs = Boolean(crossWorkspace);
    const effectiveWs = workspace ? normalizeWorkspace(workspace) : '';
    const effectiveLimit = typeof limit === 'number' && limit > 0
      ? Math.min(limit, this._capacity)
      : 50;

    const matched = [];
    for (let i = 0; i < this._buffer.length; i++) {
      const rec = this._buffer[i];
      if (!effectiveCrossWs && effectiveWs) {
        if (rec.callerWorkspace !== effectiveWs && rec.targetWorkspace !== effectiveWs) {
          continue;
        }
      }
      if (typeof since === 'number' && since > 0) {
        if (rec.timestamp < since) {
          continue;
        }
      }
      if (sessionId) {
        const sid = String(sessionId).toLowerCase();
        if (rec.callerSessionId.toLowerCase() !== sid && rec.targetSessionId.toLowerCase() !== sid) {
          continue;
        }
      }
      if (status && rec.status !== status) {
        continue;
      }
      matched.push(rec);
    }

    return matched.slice(-effectiveLimit);
  }

  /**
   * 级联将指定会话涉及的所有调用标记为已落定 settled
   *
   * @param {string} sessionId 会话 ID
   * @returns {number} 受影响的记录数量
   */
  settleSession(sessionId) {
    if (!sessionId) return 0;
    const targetId = String(sessionId).toLowerCase();
    let affected = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      const rec = this._buffer[i];
      if (rec.callerSessionId.toLowerCase() === targetId || rec.targetSessionId.toLowerCase() === targetId) {
        if (rec.status !== 'settled') {
          rec.status = 'settled';
          affected++;
        }
      }
    }
    return affected;
  }

  /**
   * 一条回执记录（发信方 sent 回执给收信方 receiver）是否能结掉某条在账待办。
   *
   * 待办登记在收件方身上：它欠发起方一条回执。回执方向恰好相反，所以匹配时把两端
   * 对调比较。抽取成单一判定，免得账本里散落几份手写的方向推导。
   *
   * @param {object} task 在账待办
   * @param {string} sender 回执的发起方会话 ID
   * @param {string} receiver 回执的接收方会话 ID
   * @returns {boolean}
   */
  matchesPair(task, sender, receiver) {
    return task.callerSessionId.toLowerCase() === String(receiver ?? '').toLowerCase()
      && task.targetSessionId.toLowerCase() === String(sender ?? '').toLowerCase();
  }

  /**
   * 查询指定会话欠着的未结待办。
   *
   * 义务由收件方承担：只有收件方欠回执，也只有它会被守卫追着要汇报；发起方只是在
   * 等结果，不承担任何回传义务。
   *
   * @param {string} sessionId 会话 ID
   * @returns {Array<object>} 未结待办列表
   */
  getPendingTasksForSession(sessionId) {
    if (!sessionId) return [];
    const norm = String(sessionId).trim().toLowerCase();
    return this._pendingTasks.filter(t => t.targetSessionId.toLowerCase() === norm);
  }

  getPendingTaskReminder(targetSessionId, ctx, config) {
    const tasks = this.getPendingTasksForSession(targetSessionId);
    if (tasks.length === 0) return '';
    const locale = resolveLocale(ctx, config);
    return formatPendingTaskReminderText(tasks, locale);
  }

  cleanupSession(sessionId, action = 'settle') {
    if (!sessionId) return 0;
    const targetId = String(sessionId).toLowerCase();
    this._pendingTasks = this._pendingTasks.filter(
      t => t.callerSessionId.toLowerCase() !== targetId && t.targetSessionId.toLowerCase() !== targetId
    );
    if (action === 'purge' || action === 'delete') {
      const prevLen = this._buffer.length;
      this._buffer = this._buffer.filter(
        rec => rec.callerSessionId.toLowerCase() !== targetId && rec.targetSessionId.toLowerCase() !== targetId
      );
      return prevLen - this._buffer.length;
    }
    return this.settleSession(sessionId);
  }
}

const contextTelemetryMap = new WeakMap();
let defaultRingBuffer = null;

/**
 * 获取或按上下文解析 CallTelemetryRingBuffer 实例
 *
 * @param {any} ctxOrOptions Cordis 根上下文或配置对象
 * @param {any} [rawOptions] 备选配置对象
 * @returns {CallTelemetryRingBuffer}
 */
export function getCallTelemetry(ctxOrOptions, rawOptions) {
  if (ctxOrOptions instanceof CallTelemetryRingBuffer) {
    return ctxOrOptions;
  }
  const provided = readHostService(ctxOrOptions, 'callTelemetry');
  if (provided instanceof CallTelemetryRingBuffer) {
    return provided;
  }
  const options = (rawOptions || readProperty(ctxOrOptions, 'options') || ctxOrOptions || {});
  if (options.callTelemetry instanceof CallTelemetryRingBuffer) {
    return options.callTelemetry;
  }

  const ctx = readProperty(ctxOrOptions, 'ctx') || ctxOrOptions;
  if (ctx && typeof ctx === 'object') {
    const service = readHostService(ctx, 'callTelemetry');
    if (service instanceof CallTelemetryRingBuffer) return service;
    if (!contextTelemetryMap.has(ctx)) {
      contextTelemetryMap.set(ctx, new CallTelemetryRingBuffer(options.telemetryCapacity || 200));
    }
    return contextTelemetryMap.get(ctx);
  }

  if (!defaultRingBuffer) {
    defaultRingBuffer = new CallTelemetryRingBuffer(200);
  }
  return defaultRingBuffer;
}

export function formatPendingTaskReminderText(pendingTasks, locale = 'zh') {
  if (!Array.isArray(pendingTasks) || pendingTasks.length === 0) return '';
  const catalog = getCatalog(locale);
  if (typeof catalog.prompts?.taskReminder === 'function') {
    return catalog.prompts.taskReminder(pendingTasks);
  }
  return '';
}

export {
  isHumanReadableTitle,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
};

/**
 * 动态按需桥接全景拓扑快照聚合逻辑，阻断与 Web 路由层的静态循环依赖。
 * 静态加载 call-telemetry.mjs 时不会触发 web-telemetry-route.mjs 及其业务数据源求值。
 *
 * @param {any} ctx Cordis 根上下文
 * @param {import('../types/call-telemetry.js').GetCanvasTelemetryOptions} [options]
 * @returns {Promise<import('../types/call-telemetry.js').CanvasTelemetrySnapshot>}
 */
export async function getCanvasTelemetry(ctx, options = {}) {
  const { getCanvasTelemetry: impl } = await import('./web-telemetry-route.mjs');
  return impl(ctx, options);
}
