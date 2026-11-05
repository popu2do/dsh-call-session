import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { loadClientInSandbox } from './helpers/canvas-harness.mjs';
import { sessionsSnapshot, workspaceItem, workspacesSnapshot } from './helpers/mock-host.mjs';

/**
 * Boundary suite for the host @ reference wrapper inside lib/client.js
 * (wrapNativeCandidateSource / alignNativeCandidatesWithSidebar /
 * installNativeCandidateFilter). ADR-0041 is the contract under test: every host
 * shape the wrapper can meet must resolve to a documented branch, a throwing
 * host must not be mislabelled as a filter degradation, and a throwing predicate
 * must return the host rows untouched instead of throwing into the host fetch path.
 */

/** Workspace path built from segments so no developer local path is embedded. */
const HOST_WS = path.join(path.sep, 'srv', 'projects', 'dsh-boundary');

/** A second roster workspace, used to prove that a hand-typed path drills. */
const OTHER_WS = path.join(path.sep, 'srv', 'projects', 'dsh-peer');

/** Encodes a session id into the mention the host writes on a session row. */
function sessionMention(sessionId, label) {
  const payload = Buffer.from(JSON.stringify(sessionId), 'utf8').toString('base64url');
  return '@[' + label + '](dsh-session:' + payload + ')';
}

/** Builds one host session row exactly as the host @ reference source emits it. */
function sessionRow(sessionId, label) {
  return {
    name: label,
    section: 'conversation',
    value: JSON.stringify({ kind: 'session', label, mention: sessionMention(sessionId, label) })
  };
}

/** A non-session row that must always pass through untouched. */
const DIRECTORY_ROW = { name: 'enter-directory', section: 'files', value: JSON.stringify({ kind: 'dir', path: 'lib' }) };

/** The session snapshot the wrapper reads: current, live peer, subagent, archived. */
function hostSessions() {
  return {
    cur: { id: 'cur', cwd: HOST_WS, title: 'current session', updatedAt: 9000 },
    peer: { id: 'peer', cwd: HOST_WS, title: 'peer session', updatedAt: 5000 },
    'spec-child': { id: 'spec-child', cwd: HOST_WS, title: 'spec child', origin: 'subagent', updatedAt: 8000 },
    'retired-peer': { id: 'retired-peer', cwd: HOST_WS, title: 'retired peer', archived: true, updatedAt: 3000 }
  };
}

/** The host row set every fixture starts from. */
function hostRows() {
  return [sessionRow('spec-child', 'spec child'), sessionRow('peer', 'peer session'), sessionRow('retired-peer', 'retired peer'), DIRECTORY_ROW];
}

/** A console double that records warn calls only, keeping degradation noise out of stdout. */
function recordingConsole() {
  const warnings = [];
  return { warnings, warn: (...args) => warnings.push(args) };
}

const NAMES = (rows) => Array.from(rows, (item) => item.name);

const ROW_NAMES_AFTER_FILTER = ['peer session', 'enter-directory'];

/**
 * Mounts the plugin over a host whose @ reference source already sits on
 * inputTriggers.live.sources, so the wrapper installs against the same object
 * identity the host hands out.
 *
 * The plugin mounts synchronously, so a fixture whose candidates throws would
 * abort apply() before an assertion runs. mountFailure captures that and exposes
 * the host path through fetch() instead.
 *
 * @param {Object} options.hostCandidates Host candidates implementation.
 * @param {Array} options.liveSources Live source list (defaults to one reference source).
 * @param {Object} options.console Console double handed to the sandbox.
 * @param {Function} options.getSessionsService Replaces the sessions service lookup.
 */
function mountHostWrapper(options = {}) {
  const sandboxConsole = options.console || recordingConsole();
  const { plugin } = loadClientInSandbox({ console: sandboxConsole });

  let hostCalls = 0;
  const hostSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    candidates: function (...args) {
      hostCalls += 1;
      return options.hostCandidates.apply(this, args);
    }
  };
  const liveSources = options.liveSources || [hostSource];

  const sessionsById = hostSessions();
  const inputTriggers = {
    live: { sources: liveSources },
    registerSource: (src) => {
      liveSources.push(src);
      return () => {};
    }
  };

  const services = (serviceName) => {
    if (serviceName === 'inputTriggers') return inputTriggers;
    if (serviceName === 'sessions') {
      if (options.getSessionsService) return options.getSessionsService();
      return { list: { getSnapshot: () => sessionsSnapshot(sessionsById) } };
    }
    if (serviceName === 'workspaces') {
      return {
        list: {
          getSnapshot: () =>
            workspacesSnapshot({
              items: [
                workspaceItem({ workspaceId: 'ws-host', path: HOST_WS, sessionIds: ['cur', 'peer'] }),
                workspaceItem({ workspaceId: 'ws-peer', path: OTHER_WS, sessionIds: [] })
              ],
              archivedSessionIds: []
            })
        }
      };
    }
    return null;
  };

  let mountedSync = true;
  let mountFailure = null;
  try {
    plugin.apply({
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => plugin.zh[key] || key },
      slots: { inject: () => {}, register: () => {} },
      get: services
    });
  } catch (error) {
    mountFailure = error;
    mountedSync = false;
  }

  return {
    plugin,
    hostSource,
    mountedSync: () => mountedSync,
    mountFailure: () => mountFailure,
    /**
     * Fetch through the host path: the plugin source when the wrapper is in place,
     * or the rejected mount failure when the host fixture broke apply() itself.
     */
    fetch: (session, request) => {
      if (mountFailure) return Promise.reject(mountFailure);
      return hostSource.candidates.call(hostSource, session, request);
    },
    hostCalls: () => hostCalls,
    warnings: sandboxConsole.warnings,
    undrilledRequest: { query: '', quoted: false, drilled: false }
  };
}

test('Host Candidate Wrapper: a synchronous host array is normalised into a Promise and filtered', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  const result = host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);

  assert.ok(result && typeof result.then === 'function', 'A synchronous host array must still be handed back as a Promise');
  assert.deepEqual(
    NAMES(await result),
    ROW_NAMES_AFTER_FILTER,
    'A synchronous array must travel through the same alignment as an asynchronous one: subagent and archived rows drop, the directory row keeps its slot'
  );
  assert.equal(host.hostCalls(), 1, 'The host implementation must be invoked exactly once for one undrilled fetch');
});

test('Host Candidate Wrapper: a host Promise resolving to rows is filtered after it settles', async () => {
  const host = mountHostWrapper({ hostCandidates: () => Promise.resolve(hostRows()) });

  const pending = host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  assert.ok(pending && typeof pending.then === 'function', 'A Promise-returning host must keep its Promise shape');
  assert.deepEqual(
    NAMES(await pending),
    ROW_NAMES_AFTER_FILTER,
    'A host Promise must produce the same filtered row set as a synchronous array'
  );
  assert.equal(host.hostCalls(), 1, 'The host implementation must be awaited, not called twice');
});

test('Host Candidate Wrapper: a synchronous host throw surfaces to the host fetch path without a warning', async () => {
  const sandboxConsole = recordingConsole();
  const failure = new Error('host candidate query failed');
  const host = mountHostWrapper({
    hostCandidates: () => {
      throw failure;
    },
    console: sandboxConsole
  });

  // The plugin's own mount pass fetches candidates; a host throw there is captured
  // by mountHostWrapper instead of escaping apply(), and replayed by fetch().
  const mounted = await Promise.resolve()
    .then(() => host.fetch({ sessionId: 'cur' }, host.undrilledRequest))
    .then(
      (rows) => ({ ok: rows }),
      (error) => ({ failed: error })
    );
  assert.deepEqual(
    Object.keys(mounted),
    ['failed'],
    'A throwing host implementation must surface its own error rather than being swallowed into a degraded row set'
  );
  assert.equal(mounted.failed, failure, 'The host error must surface unchanged, not wrapped');
  assert.equal(sandboxConsole.warnings.length, 0, 'A host failure is not a filter degradation, so no filter warning may be emitted');
  assert.equal(host.hostCalls() >= 1, true, 'The throwing host implementation must have been reached');
});

test('Host Candidate Wrapper: a rejecting host Promise surfaces the host error untouched', async () => {
  const sandboxConsole = recordingConsole();
  const failure = new Error('host candidate query rejected');
  const host = mountHostWrapper({
    hostCandidates: () => Promise.reject(failure),
    console: sandboxConsole
  });

  const settled = await host.hostSource
    .candidates({ sessionId: 'cur' }, host.undrilledRequest)
    .then(
      (rows) => ({ ok: rows }),
      (error) => ({ failed: error })
    );
  assert.equal(settled.failed, failure, 'A rejecting host Promise must reject the wrapper with the same error');
  assert.equal(sandboxConsole.warnings.length, 0, 'A host rejection must not be reported as a filter degradation');
});

test('Host Candidate Wrapper: a throwing predicate returns the host rows unchanged and warns exactly once (Invariant 4)', async () => {
  const sandboxConsole = recordingConsole();

  // A session index that throws on every id lookup makes the filter itself fail,
  // which is the degradation branch ADR-0041 section 4.2 describes.
  const hostileById = new Proxy(
    {},
    {
      get() {
        throw new TypeError('session index unavailable');
      }
    }
  );

  const host = mountHostWrapper({
    hostCandidates: () => hostRows().map((row) => ({ ...row })),
    getSessionsService: () => ({ list: { getSnapshot: () => ({ byId: hostileById, ids: ['peer'] }) } }),
    console: sandboxConsole
  });

  const first = await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  assert.deepEqual(
    NAMES(first),
    ['spec child', 'peer session', 'retired peer', 'enter-directory'],
    'ADR-0041 Invariant 4: a throwing predicate returns the host rows exactly as the host produced them'
  );
  assert.equal(sandboxConsole.warnings.length, 1, 'The degradation must be recorded by exactly one warning call');

  // A second degraded fetch returns the same rows but must stay silent: the
  // warning is one degradation record for the module instance, not a per-fetch log.
  const second = await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  assert.deepEqual(NAMES(second), NAMES(first), 'A second degraded fetch keeps returning the host rows');
  assert.equal(sandboxConsole.warnings.length, 1, 'The degradation warning stays at one call across repeated degraded fetches');

  const [message, detail] = sandboxConsole.warnings[0];
  assert.match(String(message), /candidate filter degraded/, 'The warning must name the degraded candidate filter');
  assert.match(String(detail), /session index unavailable/, 'The warning must carry the swallowed failure');
});

test('Host Candidate Wrapper: a drilled request resolves to one deterministic empty array and never calls the host (Invariant 1)', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  // The host flag is the only signal here: the query names no roster workspace.
  const first = await host.hostSource.candidates({ sessionId: 'cur' }, { query: '', drilled: true });
  const second = await host.hostSource.candidates({ sessionId: 'cur' }, { query: 'anything', drilled: true });

  assert.ok(Array.isArray(first), 'A drilled fetch must resolve to an array, not undefined');
  assert.deepEqual(Array.from(first), [], 'A drilled fetch carries no host rows at all');
  assert.deepEqual(Array.from(second), [], 'Every drilled fetch carries no host rows, whatever the query text');
  assert.equal(first.length, 0, 'The drilled array must be empty, not merely falsy');
  assert.notEqual(first, second, 'Each fetch resolves its own array; the emptiness is deterministic, not a shared cached value');
  assert.equal(host.hostCalls(), 0, 'ADR-0041 Invariant 1: the host candidate generator must not run at all for a drilled fetch');
});

test('Host Candidate Wrapper: an undefined or null request stays top-level and still filters host rows', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  const fromUndefined = await host.hostSource.candidates({ sessionId: 'cur' }, undefined);
  assert.deepEqual(
    NAMES(fromUndefined),
    ROW_NAMES_AFTER_FILTER,
    'A missing request is an undrilled fetch: the host rows still pass through the sidebar predicate'
  );

  const fromNull = await host.hostSource.candidates({ sessionId: 'cur' }, null);
  assert.deepEqual(NAMES(fromNull), ROW_NAMES_AFTER_FILTER, 'A null request is undrilled too, and must not throw');

  const withoutSession = await host.hostSource.candidates(undefined, undefined);
  assert.deepEqual(
    NAMES(withoutSession),
    ROW_NAMES_AFTER_FILTER,
    'A missing session argument must not throw either; visibility falls back to the snapshot row itself'
  );

  assert.equal(host.hostCalls(), 3, 'Each undrilled fetch reaches the host implementation exactly once');
  assert.equal(host.warnings.length, 0, 'A missing request is not a degradation, so no warning may be emitted');
});

test('Host Candidate Wrapper: a string "true" drilled flag is not a drill (strict === true)', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  const fromTruthyString = await host.hostSource.candidates({ sessionId: 'cur' }, { query: '', drilled: 'true' });
  assert.deepEqual(
    NAMES(fromTruthyString),
    ROW_NAMES_AFTER_FILTER,
    'The string "true" is not the host boolean flag, so the fetch stays undrilled and keeps host rows'
  );
  assert.equal(host.hostCalls(), 1, 'A truthy-but-not-true flag must still reach the host implementation');

  for (const flag of [1, 'yes', {}, [], { valueOf: () => true }]) {
    const result = await host.hostSource.candidates({ sessionId: 'cur' }, { query: '', drilled: flag });
    assert.deepEqual(
      NAMES(result),
      ROW_NAMES_AFTER_FILTER,
      'Only the boolean true may drill; ' + String(flag) + ' must stay undrilled'
    );
  }
  assert.equal(host.hostCalls(), 6, 'Every non-boolean drilled value reaches the host implementation exactly once');
});

test('Host Candidate Wrapper: a whitespace, bare @ or "@ " query is not mistaken for a drill', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  for (const query of ['', ' ', '   ', '\t', '\n', '@', '@ ', ' @']) {
    const result = await host.hostSource.candidates({ sessionId: 'cur' }, { query, drilled: false });
    assert.deepEqual(
      NAMES(result),
      ROW_NAMES_AFTER_FILTER,
      'Query ' + JSON.stringify(query) + ' names no workspace path, so host rows must survive the level check'
    );
  }
  assert.equal(host.hostCalls(), 8, 'Each blank query reaches the host implementation exactly once');
  assert.equal(host.warnings.length, 0, 'A blank query is an ordinary top-level fetch, never a degradation');
});

test('Host Candidate Wrapper: a hand-typed workspace path drills even when the host flag is false', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  const typed = await host.hostSource.candidates({ sessionId: 'cur' }, { query: OTHER_WS, drilled: false });
  assert.deepEqual(Array.from(typed), [], 'A query naming a roster workspace is level two, so host rows must be cut');
  assert.equal(host.hostCalls(), 0, 'A hand-typed workspace path must cut the host before its implementation runs');

  const filteredInside = await host.hostSource.candidates({ sessionId: 'cur' }, { query: OTHER_WS + ' peer', drilled: false });
  assert.deepEqual(Array.from(filteredInside), [], 'A workspace path followed by a filter word is still level two');
  assert.equal(host.hostCalls(), 0, 'The filter-word form must cut before the host implementation as well');

  const offRoster = await host.hostSource.candidates({ sessionId: 'cur' }, { query: path.join(path.sep, 'srv', 'nope'), drilled: false });
  assert.deepEqual(NAMES(offRoster), ROW_NAMES_AFTER_FILTER, 'A path outside the roster names no workspace, so it stays level one');
  assert.equal(host.hostCalls(), 1, 'An off-roster path reaches the host implementation exactly once');
});

test('Host Candidate Wrapper: a missing or malformed reference registration degrades without throwing', async () => {
  // The live list holds a source on another trigger: no reference source to wrap.
  const unrelated = { trigger: '#', name: 'reference', candidates: async () => [] };
  const noReference = mountHostWrapper({ hostCandidates: () => hostRows(), liveSources: [unrelated] });
  assert.equal(noReference.mountedSync(), true, 'Mounting without a reference source must complete without throwing');
  assert.deepEqual(
    NAMES(await noReference.fetch({ sessionId: 'cur' }, noReference.undrilledRequest)),
    ['spec child', 'peer session', 'retired peer', 'enter-directory'],
    'With no reference source to wrap, host rows come back exactly as the host produced them'
  );
  assert.equal(noReference.warnings.length, 0, 'A missing reference source is not a filter degradation and stays silent');

  // A reference source whose candidates is not a function cannot be wrapped.
  const callableLess = { trigger: '@', name: 'reference', candidates: 'not-a-function' };
  const notCallable = mountHostWrapper({ hostCandidates: () => hostRows(), liveSources: [callableLess] });
  assert.equal(notCallable.mountedSync(), true, 'A non-callable candidates field must not break the mount');
  assert.equal(callableLess.candidates, 'not-a-function', 'A non-function candidates field must be left alone');

  // Every malformed live shape, and a host with no inputTriggers service at all.
  const malformed = [undefined, null, {}, { sources: 'nope' }, { sources: [] }];
  for (const live of malformed) {
    const { plugin } = loadClientInSandbox();
    assert.doesNotThrow(() => {
      plugin.apply({
        effect: (fn) => fn(),
        locale: { register: () => {}, bind: () => (key) => plugin.zh[key] || key },
        slots: { inject: () => {}, register: () => {} },
        get: (serviceName) => {
          if (serviceName === 'inputTriggers') return { live, registerSource: () => () => {} };
          if (serviceName === 'sessions') return { list: { getSnapshot: () => sessionsSnapshot(hostSessions()) } };
          return null;
        }
      });
    }, 'A live shape of ' + JSON.stringify(live) + ' must not throw on mount');
  }

  const { plugin: bare } = loadClientInSandbox();
  assert.doesNotThrow(() => {
    bare.apply({
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => bare.zh[key] || key },
      slots: { inject: () => {}, register: () => {} },
      get: () => null
    });
  }, 'A host with no inputTriggers service must not throw on mount');
});
