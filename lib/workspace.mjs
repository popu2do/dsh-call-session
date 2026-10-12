/**
 * DSH Workspace Domain Primitives
 *
 * Encapsulates workspace path normalization and equivalence checking
 * across dsh-call-session.
 */

/**
 * 规范化工程工作区路径：统一正斜杠、盘符小写并去除末尾斜杠
 *
 * @param {string | null | undefined} rawPath 原始路径
 * @returns {string} 规范化 POSIX 风格路径
 */
export function normalizeWorkspace(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let p = rawPath.trim();
  p = p.replace(/\\+/g, '/');
  p = p.replace(/^([a-zA-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  p = p.replace(/\/+$/, '');
  return p;
}

/**
 * 判定两个路径是否指向同一个规范化工作区
 *
 * @param {string | null | undefined} wsA
 * @param {string | null | undefined} wsB
 * @returns {boolean}
 */
export function isSameWorkspace(wsA, wsB) {
  const normA = normalizeWorkspace(wsA);
  const normB = normalizeWorkspace(wsB);
  if (!normA || !normB) return false;
  return normA === normB;
}
