/**
 * Canonical Mock Agent and Session Test Fixtures
 * 
 * Provides unified, decoupled test doubles for DSH Agent, Session,
 * and host-level communication hooks, eliminating duplicate mock implementations.
 */

export const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});

/**
 * Creates a standardized Mock Agent double for testing.
 * Supports both signatures:
 * - createMockAgent(id, options)
 * - createMockAgent({ id, ...options })
 */
export function createMockAgent(idOrOptions, maybeOptions = {}) {
  const isObj = typeof idOrOptions === 'object' && idOrOptions !== null;
  const id = isObj ? idOrOptions.id : idOrOptions;
  const opts = isObj ? idOrOptions : maybeOptions;

  const {
    status = 'idle',
    title = 'Test Agent',
    cwd = 'c:/workspace/project-alpha',
    generation = 0,
    options = {},
    steerFn = null,
    followupFn = null,
    sendFn = null,
    origin = undefined,
    blank = false,
    events: initialEvents = [],
    shouldFail = false,
    isSubagent = false,
    frozenHeader = false,
    mutateStatusOnDispatch = false
  } = opts;

  const effectiveOrigin = isSubagent ? 'subagent' : origin;
  const rawHeader = {
    version: 0,
    id,
    cwd,
    title,
    origin: effectiveOrigin
  };
  const isFrozen = Boolean(frozenHeader);
  const header = isFrozen ? Object.freeze(rawHeader) : rawHeader;

  const received = [];
  const events = [...initialEvents];

  const agent = {
    id,
    status,
    title,
    generation,
    origin: effectiveOrigin,
    blank,
    options: { ...options },
    agentOptions: { ...options },
    session: {
      id,
      title,
      cwd,
      header,
      metadata: { generation, creatorSessionId: opts.creatorSessionId ?? null, ...(opts.metadata || {}) },
      events,
      _appendedEvents: events,
      messages: [],
      append(type, data) {
        const ev = { type, data, payload: data, seq: events.length, time: Date.now(), id: `evt-${events.length + 1}` };
        events.push(ev);
        return ev;
      }
    },
    get _session() {
      return this.session;
    },
    steer: steerFn || ((msg) => {
      if (shouldFail) throw new Error('steer dispatch failed');
      if (mutateStatusOnDispatch) agent.status = 'running';
      received.push({ method: 'steer', type: 'steer', msg });
      return Promise.resolve();
    }),
    followup: followupFn || ((msg) => {
      if (shouldFail) throw new Error('followup dispatch failed');
      if (mutateStatusOnDispatch) agent.status = 'running';
      received.push({ method: 'followup', type: 'followup', msg });
      return Promise.resolve();
    }),
    send: sendFn || ((msg) => {
      received.push({ method: 'send', type: 'send', msg });
      return Promise.resolve();
    }),
    received
  };

  return agent;
}

/**
 * Creates a minimal Mock Session double.
 */
export function createMockSession({
  id = 'session-test-1',
  title = 'Test Session',
  cwd = '/workspaces/project-1',
  frozenHeader = false,
  metadata = {}
} = {}) {
  const header = { cwd, title };
  if (frozenHeader) {
    Object.freeze(header);
  }

  const events = [];
  return {
    id,
    title,
    header,
    cwd,
    metadata: { ...metadata },
    events,
    _appendedEvents: events,
    async append(type, data) {
      const ev = { type, data, payload: data, seq: events.length, time: Date.now(), id: `evt-${events.length + 1}` };
      events.push(ev);
      return ev;
    }
  };
}
