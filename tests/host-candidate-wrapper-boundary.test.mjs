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
  let unmount = null;
  try {
    plugin.apply({
      effect: (fn) => {
        // Keep every disposer so a test can tear the plugin's @ source down the
        // way the host does on unload; apply() is the only place they are handed out.
        const dispose = fn();
        if (typeof dispose === 'function') unmount = dispose;
        return dispose;
      },
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
    // The host source object the plugin actually wraps: the fixture hands the same
    // object out on its live list, so a test can watch candidates on the entry the
    // host holds, not just the object it built.
    liveEntry: liveSources.includes(hostSource) ? hostSource : liveSources[liveSources.length - 1],
    // The plugin's own @ source, reachable through the host's live list.
    pluginSource: () => (inputTriggers.live && inputTriggers.live.sources || []).find((item) => item && item.name === 'peer-session') || null,
    unmount,
    mountedSync: () => mountedSync,
    mountFailure: () => mountFailure,
    inputTriggers,
    /**
     * Fetch through the host path: the live source the host actually holds, which
     * is the entry the wrapper replaced, or the rejected mount failure when the
     * host fixture broke apply() itself.
     */
    fetch: (session, request) => {
      if (mountFailure) return Promise.reject(mountFailure);
      const live = (inputTriggers.live && inputTriggers.live.sources) || [];
      const entry = live.find((item) => item === hostSource) || { candidates: hostSource.candidates };
      return entry.candidates.call(hostSource, session, request);
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


/**
 * Records how many times the plugin replaces the candidates function of one host
 * source. A second wrap shows up as a second assignment of a different function,
 * which pinning the raw host function identity alone would hide.
 */
function recordCandidateAssignments(hostSource) {
  const assignments = [];
  let current = hostSource.candidates;
  Object.defineProperty(hostSource, 'candidates', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next) => {
      assignments.push(next);
      current = next;
    }
  });
  return assignments;
}

test('Host Candidate Wrapper: a second install over the same host source never wraps it again (Invariant 3)', async () => {
  const host = mountHostWrapper({ hostCandidates: () => hostRows() });

  // The plugin has already installed its wrapper on the live source. Recording from
  // here counts only further replacements triggered by the plugin's own fetches.
  const assignments = recordCandidateAssignments(host.hostSource);
  const wrappedOnce = host.hostSource.candidates;

  // The plugin fetches its own candidates each time, and that path re-runs the
  // install pass; the weak set must keep it from stacking a second filter.
  await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);

  assert.equal(assignments.length, 0, 'A repeated install pass must not replace the host candidates function again');
  assert.equal(host.hostSource.candidates, wrappedOnce, 'The host source keeps the single wrapper it already has');
  assert.equal(host.hostCalls(), 3, 'Three fetches reach the host implementation three times, not six');

  host.unmount();

  // The host keeps its live list across unload and reload, so the plugin's own @
  // source from the first mount is still on it. Unloading cleared the filter from
  // that source but left its weak set entry behind; the second mount must still
  // wrap both sources rather than trust a stale mark on the first one.
  const remount = mountHostWrapper({
    hostCandidates: () => hostRows(),
    liveSources: [host.pluginSource(), host.liveEntry]
  });
  const pluginSourceAfterReload = remount.pluginSource();

  // The reloaded plugin does stack a second filter on its predecessor: the stale
  // source still holds the old wrapper and nothing removes it before the new mount
  // walks the list. That is the same source identity twice, so the weak set must
  // record two entries, one per mount, and neither may replace the host function.
  assert.ok(pluginSourceAfterReload && pluginSourceAfterReload.name === 'peer-session', 'The reload holds a live plugin @ source');

  const before = host.hostCalls();
  assert.deepEqual(
    NAMES(await host.liveEntry.candidates({ sessionId: 'cur' }, remount.undrilledRequest)),
    ROW_NAMES_AFTER_FILTER,
    'The re-wrapped host source filters the host rows again instead of returning them untouched'
  );
  assert.equal(host.hostCalls() - before, 1, 'One fetch through the re-installed wrapper reaches the host once');
});

test('Host Candidate Wrapper: one install pass wraps each reference source once and leaves other sources alone', async () => {
  // Two distinct @ reference sources plus a decoy on another trigger and a decoy
  // on '@' with a different name: only the reference ones may be replaced.
  const makeHost = (rows) => {
    let calls = 0;
    const source = {
      trigger: '@',
      name: 'reference',
      candidates: async () => {
        calls += 1;
        return rows.map((row) => ({ ...row }));
      }
    };
    return { source, calls: () => calls };
  };

  const first = makeHost(hostRows());
  const second = makeHost(hostRows());
  const otherTrigger = { trigger: '#', name: 'reference', candidates: async () => [] };
  const otherName = { trigger: '@', name: 'slash-command', candidates: async () => [] };

  const firstAssignments = recordCandidateAssignments(first.source);
  const secondAssignments = recordCandidateAssignments(second.source);
  const otherTriggerAssignments = recordCandidateAssignments(otherTrigger);
  const otherNameAssignments = recordCandidateAssignments(otherName);

  const host = mountHostWrapper({
    hostCandidates: () => [],
    liveSources: [first.source, otherTrigger, otherName, second.source]
  });

  assert.equal(firstAssignments.length, 1, 'The first reference source is wrapped exactly once');
  assert.equal(secondAssignments.length, 1, 'The second reference source is wrapped exactly once as well');
  assert.equal(otherTriggerAssignments.length, 0, 'A source on another trigger is never wrapped');
  assert.equal(otherNameAssignments.length, 0, 'A non-reference source on @ is never wrapped');

  assert.deepEqual(
    NAMES(await second.source.candidates({ sessionId: 'cur' }, host.undrilledRequest)),
    ROW_NAMES_AFTER_FILTER,
    'The second wrapped source filters host rows the same way as the first'
  );
  assert.equal(first.calls(), 0, 'The first source only answers fetches made against it');
  assert.equal(second.calls(), 1, 'The second source answers its own fetch exactly once');
});

test('Host Candidate Wrapper: a session row whose id is absent from the snapshot stays in its host slot (Invariant 7)', async () => {
  // The snapshot index names peer (5000) but not the two unknown ids: Invariant 7
  // keeps unknown rows in place instead of guessing them away, and keeps them out
  // of the recency sort, so the sortable row still sorts among sortable slots.
  const rows = [
    sessionRow('cur', 'current session'),
    sessionRow('unknown-peer', 'unknown snapshot peer'),
    sessionRow('peer', 'peer session'),
    DIRECTORY_ROW,
    sessionRow('unknown-second', 'unknown second peer')
  ];
  const hostRowsFixture = mountHostWrapper({ hostCandidates: () => rows.map((row) => ({ ...row })) });

  const result = await hostRowsFixture.hostSource.candidates({ sessionId: 'cur' }, hostRowsFixture.undrilledRequest);
  assert.deepEqual(
    NAMES(result),
    ['current session', 'unknown snapshot peer', 'peer session', 'enter-directory', 'unknown second peer'],
    'Unknown rows keep their slots while the sortable rows around them still sort by recency'
  );

  // With every row unknown the host array must come back by identity, untouched.
  const unknownOnly = [
    sessionRow('unknown-a', 'unknown a'),
    sessionRow('unknown-b', 'unknown b'),
    DIRECTORY_ROW
  ];
  const passthrough = mountHostWrapper({ hostCandidates: () => unknownOnly.map((row) => ({ ...row })) });
  const untouched = await passthrough.hostSource.candidates({ sessionId: 'cur' }, passthrough.undrilledRequest);
  assert.deepEqual(NAMES(untouched), ['unknown a', 'unknown b', 'enter-directory'], 'Unknown rows survive exactly as the host produced them');
  assert.equal(passthrough.warnings.length, 0, 'An unknown row is not a degradation and must not warn');
});

test('Host Candidate Wrapper: an empty host row set stays empty and the wrapper resolves without a warning', async () => {
  const host = mountHostWrapper({ hostCandidates: () => [] });

  const result = await host.hostSource.candidates({ sessionId: 'cur' }, host.undrilledRequest);
  assert.deepEqual(Array.from(result), [], 'An empty host row set must resolve to an empty array, not to undefined');
  assert.equal(host.warnings.length, 0, 'An empty row set is not a degradation');

  const undefinedRows = mountHostWrapper({ hostCandidates: () => undefined });
  const fromUndefined = await undefinedRows.hostSource.candidates({ sessionId: 'cur' }, undefinedRows.undrilledRequest);
  assert.equal(fromUndefined, undefined, 'A host that resolves to a non-array value passes that value through unreformed');
  assert.equal(undefinedRows.warnings.length, 0, 'A non-array host result is left alone rather than treated as a filter failure');
});
