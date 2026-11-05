/**
 * Shared formatting utilities for localization catalogs
 */

// <BEGIN> lib/locales/table.mjs region, do not edit by hand
// 本段由 scripts/embed-canvas-geometry.mjs 原样搬运进 lib/client.js：画布没有模块解析，
// 另写一份映射（或留测试才替换的占位符）就是上一版插件真机加载失败的成因。

/**
 * 呼叫类别在画布上的本地化词条键：四种合法类别各自对应一条词条，
 * 词条只写「类别」本身，不绑定 zh/en 文案。
 */
export const CALL_TYPE_I18N_KEYS = Object.freeze({
  task_soft: 'soft',
  task_hard: 'hard',
  task_report: 'report',
  notice: 'notice'
});

/**
 * 历史记录可能携带本版本不认识的类别（例如从旧会话回放），这类记录一律
 * 标成未识别，而不是假装它是某一类既定义务。
 */
export const CALL_TYPE_UNKNOWN_KEY = 'unknown';

/**
 * 呼叫类别对应的本地化词条键。
 *
 * @param {string} callType
 * @returns {string} 形如 `call.soft` 的词典键
 */
export function callTypeLabelKey(callType) {
  const key = Object.prototype.hasOwnProperty.call(CALL_TYPE_I18N_KEYS, callType)
    ? CALL_TYPE_I18N_KEYS[callType]
    : CALL_TYPE_UNKNOWN_KEY;
  return `call.${key}`;
}

/**
 * 呼叫类别在画布上的双语标签。文案与键名放在同一处，避免键在共享表里、
 * 文案却散落在客户端脚本内部。
 */
export const CALL_TYPE_LABELS = Object.freeze({
  soft: Object.freeze({ zh: '弹性任务', en: 'Task (Soft)' }),
  hard: Object.freeze({ zh: '强制任务', en: 'Task (Hard)' }),
  report: Object.freeze({ zh: '任务汇报', en: 'Task Report' }),
  notice: Object.freeze({ zh: '状态同步', en: 'Notice' }),
  [CALL_TYPE_UNKNOWN_KEY]: Object.freeze({ zh: '未知类别', en: 'Unknown call type' })
});

/**
 * 把呼叫类别标签展开成画布词典条目，形如 `call.soft`。
 *
 * @param {'zh'|'en'} locale
 * @returns {Record<string, string>}
 */
export function callTypeLabelEntries(locale) {
  const entries = {};
  for (const [key, labels] of Object.entries(CALL_TYPE_LABELS)) {
    entries[`call.${key}`] = labels[locale];
  }
  return entries;
}
// </BEGIN> lib/locales/table.mjs region

export function formatReminderItems(posts, maxDisplay = 3, separator = '、') {
  if (!posts || !Array.isArray(posts) || posts.length === 0) return null;
  const items = posts.slice(0, maxDisplay).map(p => {
    const topic = p.topic ? ` (${p.topic})` : '';
    return `#${p.id}${topic}`;
  }).join(separator);
  const count = posts.length;
  const extra = count > maxDisplay ? count - maxDisplay : 0;
  return { items, count, extra };
}

/**
 * Formats a localized Markdown overview table for session_query
 */
export function formatSessionQueryTable(rows, counts, headers, summaryLabels) {
  const sessionList = Array.isArray(rows) ? rows : [];
  const total = counts.total;
  const active = counts.active;
  const idle = counts.idle;

  const tableHeader = `| ${headers.sessionId} | ${headers.sessionTitle} | ${headers.status} | ${headers.workspace} | ${headers.current} |\n|:--- |:--- |:--- |:--- |:--- |`;
  const formattedRows = sessionList.map(session => {
    const sessionIdCell = `\`${session.sessionId}\``;
    const sessionTitleCell = (session.title || headers.untitled).replace(/\|/g, '\\|');
    const statusCell = session.status === 'running' ? '`running`' : (session.status === 'error' ? '`error`' : '`idle`');
    const workspaceCell = (session.workspace || session.cwd || '').replace(/\|/g, '\\|');
    const isCurrentCell = session.isCurrent ? headers.yes : headers.no;
    return `| ${sessionIdCell} | ${sessionTitleCell} | ${statusCell} | ${workspaceCell} | ${isCurrentCell} |`;
  }).join('\n');

  const errCount = typeof counts.error === 'number' ? counts.error : (typeof counts.errorCount === 'number' ? counts.errorCount : 0);
  const errorSuffix = errCount > 0 ? ` | **${summaryLabels.error || (summaryLabels.active === '运行中' ? '异常' : 'Error')}:** ${errCount}` : '';
  const summary = `\n\n**${summaryLabels.total}:** ${total} | **${summaryLabels.active}:** ${active} | **${summaryLabels.idle}:** ${idle}${errorSuffix}`;
  return `### ${headers.title}\n\n${tableHeader}\n${formattedRows}${summary}`;
}