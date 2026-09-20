/**
 * Shared formatting utilities for localization catalogs
 */

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
    const statusCell = session.status === 'running' ? '`running`' : '`idle`';
    const workspaceCell = (session.workspace || session.cwd || '').replace(/\|/g, '\\|');
    const isCurrentCell = session.isCurrent ? headers.yes : headers.no;
    return `| ${sessionIdCell} | ${sessionTitleCell} | ${statusCell} | ${workspaceCell} | ${isCurrentCell} |`;
  }).join('\n');

  const summary = `\n\n**${summaryLabels.total}:** ${total} | **${summaryLabels.active}:** ${active} | **${summaryLabels.idle}:** ${idle}`;
  return `### ${headers.title}\n\n${tableHeader}\n${formattedRows}${summary}`;
}
