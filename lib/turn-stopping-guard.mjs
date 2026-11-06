/**
 * Turn-stopping guard (Issue #20).
 *
 * The host emits `agent/turn-stopping` with `{ turn, signal, agent }` once a
 * turn is about to close without further queued steps (verified in-process, see
 * docs/evidence/0020-turn-stopping.md). Steering inside the handler keeps the
 * turn alive, so a session holding an un-settled `task_hard` can be pushed to
 * report before it is allowed to go idle.
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
  return agent?.session?.id ?? agent?.sessionId ?? agent?.id;
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
 * turn with `Cannot read properties of undefined (reading 'kind')` (captured in
 * docs/agents/evidence/0020-turn-stopping.md). The reminder therefore leaves through
 * the same message builder every other cross-session delivery uses.
 *
 * @param {object} deps
 * @param {Function} deps.getPendingTasksForSession session id -> pending tasks
 * @param {Function} deps.buildReminder pending tasks -> localised reminder text
 * @param {Function} deps.buildUserMessage reminder text + agent -> native UserMessage
 * @param {Function} [deps.resolveSessionId] agent -> session id
 * @param {object} [deps.logger]
 * @returns {(payload: { turn: number, signal?: AbortSignal, agent?: object }) => Promise<void>}
 */
export function createTurnStoppingGuard({
  getPendingTasksForSession,
  buildReminder,
  buildUserMessage,
  resolveSessionId = resolveAgentSessionId,
  logger = {}
}) {
  const remindersByTurn = new Map();
  const exhaustedTurns = new Set();

  function forgetSession(sessionId) {
    if (!sessionId) return;
    for (const key of remindersByTurn.keys()) {
      for (const key of exhaustedTurns) {
      if (key.startsWith(sessionId + ':')) exhaustedTurns.delete(key);
    }
    for (const key of remindersByTurn.keys()) {
      if (key.startsWith(sessionId + ':')) remindersByTurn.delete(key);
    }
    }
  }

  async function handleTurnStopping(payload) {
    const agent = payload?.agent;
    const turn = payload?.turn;
    const sessionId = resolveSessionId(agent);
    if (!sessionId) return;

    // The turn is already being torn down (user stop, dispose); chasing it would
    // resurrect a turn the operator asked to end.
    if (payload?.signal?.aborted) {
      remindersByTurn.delete(sessionId + ':' + turn);
      return;
    }

    const pendingHardTasks = getPendingTasksForSession(sessionId)
      .filter((task) => task.callType === 'task_hard');
    if (pendingHardTasks.length === 0) {
      remindersByTurn.delete(sessionId + ':' + turn);
      return;
    }

    const key = sessionId + ':' + turn;
    const sent = remindersByTurn.get(key) ?? 0;
    if (sent >= MAX_REPORT_REMINDERS) {
      // Warn once per turn: the host keeps calling this hook while the turn
      // stays open, so repeated warnings would drown the log.
      if (!exhaustedTurns.has(key)) {
        exhaustedTurns.add(key);
        logger.warn?.(
          `[dsh-call-session] Session ${sessionId} exhausted ${MAX_REPORT_REMINDERS} report reminders in turn ${turn} with ${pendingHardTasks.length} pending hard task(s); allowing the turn to close.`
        );
      }
      return;
    }
    remindersByTurn.set(key, sent + 1);

    const reminder = buildReminder(pendingHardTasks);
    if (reminder && typeof agent.steer === 'function') {
      await agent.steer(buildUserMessage(reminder, agent));
    }
  }

  return {
    handleTurnStopping,
    forgetSession,
    /** Exposed for tests that assert the budget resets across turns. */
    __remindersByTurn: remindersByTurn
  };
}