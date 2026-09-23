/**
 * DSH In-Memory Call Telemetry Ring Buffer
 *
 * Provides a bounded FIFO ring buffer for session_call telemetry,
 * workspace-scoped filtering, and session lifecycle cascade cleanup.
 * Pure in-memory data structure with zero disk I/O and zero external dependencies.
 */

import { normalizeWorkspace } from './board-store.mjs';
import {
  isHumanReadableTitle,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
} from './session-directory.mjs';

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
      callType: ['task_dispatch', 'task_report', 'notice'].includes(entry.callType) ? entry.callType : 'task_dispatch',
      deliveryMode: ['steer', 'followup'].includes(entry.deliveryMode) ? entry.deliveryMode : 'followup',
      timestamp: now,
      durationMs: typeof entry.durationMs === 'number' && entry.durationMs >= 0 ? entry.durationMs : 0,
      contextPostIds: Array.isArray(entry.contextPostIds)
        ? entry.contextPostIds.map(String).map(s => s.trim()).filter(Boolean).slice(0, 50)
        : [],
      messageSnippet: snippet,
      messagePayload: payload,
      status: entry.status === 'settled' ? 'settled' : 'active'
    };

    if (this._buffer.length >= this._capacity) {
      this._buffer.shift();
    }
    this._buffer.push(record);
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
   * 会话注销级联清理，支持 settle 软落定或 purge 物理清理
   *
   * @param {string} sessionId 会话 ID
   * @param {'settle' | 'purge' | 'delete'} [action='settle'] 清理动作
   * @returns {number} 受影响或删除的记录数量
   */
  cleanupSession(sessionId, action = 'settle') {
    if (!sessionId) return 0;
    if (action === 'purge' || action === 'delete') {
      const targetId = String(sessionId).toLowerCase();
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
  if (ctxOrOptions && ctxOrOptions.callTelemetry instanceof CallTelemetryRingBuffer) {
    return ctxOrOptions.callTelemetry;
  }
  const options = (rawOptions || (ctxOrOptions && ctxOrOptions.options) || ctxOrOptions || {});
  if (options.callTelemetry instanceof CallTelemetryRingBuffer) {
    return options.callTelemetry;
  }

  const ctx = ctxOrOptions && ctxOrOptions.ctx ? ctxOrOptions.ctx : ctxOrOptions;
  if (ctx && typeof ctx === 'object') {
    if (ctx.callTelemetry instanceof CallTelemetryRingBuffer) {
      return ctx.callTelemetry;
    }
    if (typeof ctx.get === 'function') {
      const service = ctx.get('callTelemetry', false);
      if (service instanceof CallTelemetryRingBuffer) return service;
    }
    if (ctx.root?.callTelemetry instanceof CallTelemetryRingBuffer) {
      return ctx.root.callTelemetry;
    }
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

export {
  isHumanReadableTitle,
  computeSessionShortId,
  resolveCanvasSessionDisplayTitle
};

/**
 * 动态按需桥接全景拓扑快照聚合逻辑，彻底阻断与 Web 路由层的静态循环依赖。
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
