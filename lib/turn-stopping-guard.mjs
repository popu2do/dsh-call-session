/**
 * Turn-stopping guard (Issue #20).
 *
 * The host emits `agent/turn-stopping` with `{ turn, signal, agent }` once a
 * turn is about to close without further queued steps (verified in-process, see
 * ADR-0042). Steering inside the handler keeps
 * the turn alive, so a session holding an un-settled `task_hard` can be pushed to
 * report before it is allowed to go idle.
 *
 * The hook is the seam rather than a step-level injection point because the probe
 * recorded it firing on both the prose and the tool-call endings, i.e. exactly when
 * a session would otherwise go idle still owing a report, and it carries the live
 * agent that `steer` needs (see ADR-0042).
 */
/** Report reminders a single session may receive within one host turn. */
export const MAX_REPORT_REMINDERS = 3;

/**
 * Resolves the owning session id from a live agent instance. The host hands the
 * agent itself to `agent/turn-stopping`, so the id always arrives as a property
 * of that object rather than as a separate payload field.
 *
 * @param {object} [agent]
 * @returns {string | undefined}
 */
export function resolveAgentSessionId(agent) {
  return agent?.session?.id;
}

/** Budget key: one counter per session per host turn. */
function turnKey(sessionId, turn) {
  return `${sessionId}:${turn}`;
}

/** Drops every budget entry belonging to one session. */
function forgetKeys(keys, sessionId) {
  const prefix = `${sessionId}:`;
  for (const key of [...keys]) {
    if (String(key).startsWith(prefix)) keys.delete(key);
  }
}

/**
 * Creates the turn-stopping handler.
 *
 * Budget is counted per session and turn: a new host turn starts a fresh budget,
 * so an exhausted chase never leaks into the next turn, and a settled task stops
 * chasing immediately because the lookup returns nothing.
 *
 * The host accepts only a native UserMessage on `agent.steer`; a bare string is
 * spliced into the inbox and then rejected during rendering, which fails the whole
 * turn with `Cannot read properties of undefined (reading 'kind')` (documented in
 * ADR-0042). The reminder therefore leaves through
 * the same message builder every other cross-session delivery uses.
 *
 * Every hook invocation re-reads pending work from the ledger, so a session that
 * starts up with un-settled hard tasks is chased again without extra bookkeeping
 * at boot time.
 *
 * The chase itself is a `notice` from the chased session: an advisory push to report
 * is not a second obligation, so it must not feed the very ledger it is chasing.
 *
 * @param {object} deps
 * @param {Function} deps.getPendingTasksForSession session id -> pending tasks
 * @param {Function} deps.buildReminder pending tasks -> localised reminder text
 * @param {Function} deps.buildUserMessage (reminder, agent, pendingHardTasks) -> native UserMessage
 * @param {object} [deps.logger]
 */
export function createTurnStoppingGuard({
  getPendingTasksForSession,
  buildReminder,
  buildUserMessage,
  logger = {}
}) {
  const remindersByTurn = new Map();
  const warnedTurns = new Set();
  const hookListener = (payload) => handleTurnStopping(payload);

  function forgetSession(sessionId) {
    if (!sessionId) return;
    forgetKeys(remindersByTurn, sessionId);
    forgetKeys(warnedTurns, sessionId);
  }

  async function handleTurnStopping(payload) {
    const agent = payload?.agent;
    const turn = payload?.turn;
    const sessionId = resolveAgentSessionId(agent);
    if (!sessionId) return;

    // The turn is already being torn down (user stop, dispose); chasing it would
    // resurrect a turn the operator asked to end.
    if (payload?.signal?.aborted) return;

    const key = turnKey(sessionId, turn);
    const allPending = getPendingTasksForSession(sessionId);
    const pendingHardTasks = allPending
      .filter((task) => task.callType === 'task_hard');
    if (pendingHardTasks.length === 0) {
      remindersByTurn.delete(key);
      return;
    }

    const remindersSent = remindersByTurn.get(key) ?? 0;
    const reminder = buildReminder(pendingHardTasks);
    if (remindersSent >= MAX_REPORT_REMINDERS || !reminder || typeof agent.steer !== 'function') {
      // Warn once per turn: the host keeps calling this hook while the turn
      // stays open, so repeated warnings would drown the log. The count is the
      // ledger's own: soft work still owed counts too.
      if (!warnedTurns.has(key)) {
        warnedTurns.add(key);
        logger.warn?.(
          `[dsh-call-session] Session ${sessionId} exhausted ${MAX_REPORT_REMINDERS} report reminders in turn ${turn} with ${allPending.length} pending task(s); allowing the turn to close.`
        );
      }
      return;
    }

    // Budget is spent only once the chase actually left, so a throw or a missing
    // steer method cannot burn a turn's budget silently.
    await agent.steer(buildUserMessage(reminder, agent, pendingHardTasks));
    remindersByTurn.set(key, remindersSent + 1);
  }

  return { handleTurnStopping, forgetSession, hookListener };
}
