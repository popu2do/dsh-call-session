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
 * Asserts the payload handed to a native dispatch method is a DSH UserMessage.
 *
 * The real host splices whatever it receives into the inbox and only later resolves
 * `message.kind`; a bare string or a hand-rolled object therefore survives the mock
 * and crashes the live turn with `Cannot read properties of undefined (reading
 * 'kind')` (docs/agents/evidence/0020-turn-stopping.md). Returning the payload keeps
 * `steer` usable as an identity function for assertions.
 *
 * @param {unknown} message
 * @returns {unknown}
 */
export function assertNativeUserMessage(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError(
      `native dispatch requires a UserMessage, received ${Array.isArray(message) ? 'array' : typeof message}: ${String(message)}`
    );
  }
  if (typeof message.id !== 'string' || !message.id) {
    throw new TypeError('native dispatch requires a UserMessage with a non-empty string id');
  }
  if (message.role !== 'user') {
    throw new TypeError(`native dispatch requires role "user", received ${JSON.stringify(message.role)}`);
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    throw new TypeError('native dispatch requires a UserMessage with a non-empty content array');
  }
  for (const part of message.content) {
    if (!part || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') {
      throw new TypeError('native dispatch requires text content parts');
    }
  }
  return message;
}

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
      assertNativeUserMessage(msg);
      if (shouldFail) throw new Error('steer dispatch failed');
      if (mutateStatusOnDispatch) agent.status = 'running';
      received.push({ method: 'steer', type: 'steer', msg });
      return Promise.resolve();
    }),
    followup: followupFn || ((msg) => {
      assertNativeUserMessage(msg);
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
