/**
 * Fixtures shared by the secondary candidate boundary tests (ticket #44).
 *
 * The plugin side is driven through tests/helpers/mock-host.mjs, but every verdict it
 * has to agree with comes from the Host bundle through tests/helpers/host-probe.mjs, so
 * this module only re-exports the probe and adds the row shapes a malformed store can
 * hold. Nothing here records an expectation: every case states its own Host verdict and
 * the tests compare the two sides.
 */
import { CURRENT_SESSION_ID, REFERENCE_NOW, corpusPath, sessionRow } from './boundary-corpus.mjs';
import { HostUnavailableError, loadHostJudgments, resolveHostClientPath } from './host-probe.mjs';

export { CURRENT_SESSION_ID, REFERENCE_NOW, corpusPath, sessionRow, HostUnavailableError };

/** True when this process can reach a Host install; a pinned run fails instead of skipping. */
export const HOST_AVAILABLE = resolveHostClientPath() !== null;

/**
 * Whether the cases that need the lifted Host judgments may run. A pinned run
 * (DSH_REQUIRE_REAL_HOST=1) fails on a missing host rather than quietly skipping, the
 * same contract tests/boundary-corpus.test.mjs uses.
 */
export function requireHost() {
  if (HOST_AVAILABLE) return true;
  if (process.env.DSH_REQUIRE_REAL_HOST === '1') {
    throw new HostUnavailableError('DSH_REQUIRE_REAL_HOST=1 demands a real host install, but none was found');
  }
  return false;
}

let judgments = null;

/** The lifted Host judgments, read once per process; null when no Host install is reachable. */
export function hostJudgments() {
  if (!HOST_AVAILABLE) throw new HostUnavailableError('no DSH host install is reachable');
  if (judgments === null) judgments = loadHostJudgments();
  return judgments;
}

/**
 * The row shape sessions.list.getSnapshot() emits for a Session the store already knows
 * but the client never opened: no title, still owned by its Workspace, and no blank flag
 * at all. Every key written here is one the Host list writes itself
 * (dsh-api-session-controller/lib/types/list.js summarizeCold); blank is absent precisely
 * because the Host does not hand that field to the client on this path.
 */
export function coldUntitledRow(id, cwd, { updatedAt = REFERENCE_NOW, running = false } = {}) {
  return { id, sessionId: id, cwd, updatedAt, running, agentAvailable: false, formatStatus: 'current' };
}

/**
 * A corpus row carrying a title, with the summary id the Host list always pairs it with
 * so the plugin sees the same shape it sees in the live environment.
 */
export function titledRow(id, title, fields = {}) {
  const row = sessionRow(id, { title, ...fields });
  if (row.sessionId === undefined) row.sessionId = id;
  return row;
}
