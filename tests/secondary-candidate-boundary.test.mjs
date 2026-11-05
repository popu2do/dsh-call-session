/**
 * Secondary candidate boundary alignment: the plugin's level-2 session rows against
 * the judgments the Host bundle actually makes.
 *
 * Ticket #44 replays the malformed shapes a real store can hold through the plugin's
 * level-2 candidate path (the loop in lib/client.js that walks targetRosterItem.sessionIds)
 * and compares every row with the Host through tests/helpers/host-probe.mjs. Each test
 * names one boundary and states the Host verdict it compares against, so a host upgrade
 * that moves a judgment turns a named boundary case red instead of drifting the menu
 * silently.
 *
 * The divisions below follow the boundaries the ticket lists: blank truthiness, the
 * Session reported from the live environment, malformed roster collections, unresolvable
 * member ids, subagent origin, the 50-row cap, updatedAt ordering and the archived filter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadClientInSandbox } from './helpers/canvas-harness.mjs';
import { sessionsSnapshot, workspaceItem, workspacesSnapshot } from './helpers/mock-host.mjs';
import {
  CURRENT_SESSION_ID,
  REFERENCE_NOW,
  coldUntitledRow,
  corpusPath,
  hostJudgments,
  requireHost,
  titledRow
} from './helpers/boundary-support.mjs';

const WORKSPACE_PATH = corpusPath('ws-boundary-alpha');

const HOST_AVAILABLE = requireHost();
const hostTest = HOST_AVAILABLE ? test : test.skip;

/**
 * Mounts the plugin with one roster entry and one sessions snapshot, then returns the
 * level-2 candidates for that Workspace. Level 2 reads membership from sessionIds alone,
 * so every fixture that expects a member declares it there.
 */
function mountLevel2(plugin, { byId, sessionIds, archivedSessionIds = [], currentSessionId = CURRENT_SESSION_ID }) {
  let registeredSource = null;
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (key) => key },
    slots: { inject: () => {}, register: () => {} },
    get: (name) => {
      if (name === 'inputTriggers') {
        return { registerSource: (source) => { registeredSource = source; return () => {}; } };
      }
      if (name === 'sessions') return { list: { getSnapshot: () => sessionsSnapshot(byId) } };
      if (name === 'workspaces') {
        return {
          list: {
            getSnapshot: () => workspacesSnapshot({
              items: [workspaceItem({ workspaceId: 'ws-boundary-alpha', path: WORKSPACE_PATH, sessionIds })],
              archivedSessionIds
            })
          }
        };
      }
      return null;
    }
  };
  plugin.apply(ctx);
  return registeredSource.candidates({ sessionId: currentSessionId }, { query: WORKSPACE_PATH, drilled: true });
}

/** The session ids the level-2 menu offers, in menu order. */
function offeredIds(candidates) {
  return Array.from(candidates, (item) => JSON.parse(item.value).sessionId);
}

/** The level-2 candidates for one plain Workspace holding exactly these rows. */
async function level2For(byId, { archivedSessionIds = [], sessionIds } = {}) {
  const { plugin } = loadClientInSandbox();
  const roster = sessionIds === undefined ? Object.keys(byId) : sessionIds;
  return mountLevel2(plugin, { byId, sessionIds: roster, archivedSessionIds });
}

// ---------------------------------------------------------------------------
// Boundary 1: an empty Session
// ---------------------------------------------------------------------------

/**
 * The blank Session reported from the live environment: four metadata frames, no
 * message, no title, still owned by its Workspace and absent from the archived roster.
 * It showed up third in the level-2 menu rendered as a bare id, which means the plugin
 * kept it while the sidebar did not.
 *
 * The store on this machine still holds that Session directory
 * (~/.dsh/sessions/--home-dev-code-TSPR-dsh-call-session--/session-6b440cb0-...), and its
 * decoded log is exactly the four metadata frames the report describes. What the report
 * cannot supply is the summary row: the client snapshot it came from is not on disk.
 */
const UNTITLED_SESSION_ID = 'session-6b440cb0-c9d7-4c50-8861-433f325aafc1';

test('Secondary candidates: an untitled Session with no blank flag is offered by the plugin', async () => {
  const byId = {
    [UNTITLED_SESSION_ID]: coldUntitledRow(UNTITLED_SESSION_ID, WORKSPACE_PATH),
    'session-boundary-live': titledRow('session-boundary-live', 'Live session', {
      cwd: WORKSPACE_PATH,
      updatedAt: REFERENCE_NOW - 1000
    })
  };
  const candidates = await level2For(byId);

  assert.deepEqual(
    offeredIds(candidates),
    [UNTITLED_SESSION_ID, 'session-boundary-live'],
    'the Session the live store already dropped is still offered'
  );
});

hostTest('Secondary candidates: the Host keeps the same untitled Session, so the row alone explains nothing', () => {
  const row = coldUntitledRow(UNTITLED_SESSION_ID, WORKSPACE_PATH);
  const visible = hostJudgments().sessionVisible(row, CURRENT_SESSION_ID, new Set(), 'default');

  assert.equal(
    visible,
    true,
    'a cold summary without a blank flag is visible to the Host too, so the live menu row cannot be explained by the summary shape alone'
  );
});

// ---------------------------------------------------------------------------
// Boundary 2: blank as a non-boolean truthy value
// ---------------------------------------------------------------------------

/**
 * The confirmed rule divergence. The Host hides a blank row when the flag is merely
 * truthy (dsh-client-ui-workspace/lib/client.js:966, "if (session.blank && session.id !==
 * current) return false"); the plugin hides it only when it is strictly true
 * (lib/client.js:3733, "if (session.blank === true && session.id !== currentSessionId)
 * return false"). A flag of 1 or "yes" therefore hides the row in the sidebar and keeps it
 * in the menu.
 *
 * These cases pin both readings. Which one the plugin adopts is a captain decision: copy
 * the Host truthiness, or keep the strict boolean and rely on the Host only ever sending
 * true. Until that is decided the tests record the divergence rather than demanding the
 * plugin change.
 */
const BLANK_VALUES = [
  { value: true, label: 'true' },
  { value: 1, label: '1' },
  { value: 'yes', label: '"yes"' }
];

for (const { value, label } of BLANK_VALUES) {
  hostTest('Secondary candidates: blank ' + label + ' matches the Host visibility rule', async () => {
    const row = titledRow('session-boundary-blank', 'Blank candidate', { cwd: WORKSPACE_PATH, blank: value });
    const hostVisible = hostJudgments().sessionVisible(row, CURRENT_SESSION_ID, new Set(), 'default');
    const candidates = await level2For({ [row.id]: row });

    assert.equal(
      offeredIds(candidates).includes(row.id),
      hostVisible,
      'plugin visibility must equal the Host visibility for blank ' + label
    );
  });
}

// ---------------------------------------------------------------------------
// Boundary 3: malformed roster collections
// ---------------------------------------------------------------------------

/**
 * archivedSessionIds is the sidebar's archive list. Its only reader in the plugin,
 * resolveArchivedSessionIds, degrades a non-array value to an empty list, so a malformed
 * roster costs the filter rather than the menu. The Host builds a Set from the same value
 * without a guard, so a non-array is the plugin's own contract to keep.
 */
const ARCHIVED_ROSTER_SHAPES = [
  { label: 'a string', value: 'session-boundary-archived' },
  { label: 'null', value: null },
  { label: 'a number', value: 7 }
];

for (const { label, value } of ARCHIVED_ROSTER_SHAPES) {
  test('Secondary candidates: archivedSessionIds as ' + label + ' degrades to an empty archive list', async () => {
    const archived = titledRow('session-boundary-archived', 'Archived session', {
      cwd: WORKSPACE_PATH,
      updatedAt: REFERENCE_NOW - 1000
    });
    const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });

    // The snapshot hands the malformed value through unresolved: this is what the menu
    // reader has to survive, not a sanitised copy.
    const { plugin } = loadClientInSandbox();
    let registeredSource = null;
    const ctx = {
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => key },
      slots: { inject: () => {}, register: () => {} },
      get: (name) => {
        if (name === 'inputTriggers') {
          return { registerSource: (source) => { registeredSource = source; return () => {}; } };
        }
        if (name === 'sessions') {
          return { list: { getSnapshot: () => sessionsSnapshot({ [archived.id]: archived, [live.id]: live }) } };
        }
        if (name === 'workspaces') {
          return {
            list: {
              getSnapshot: () => ({
                items: [workspaceItem({
                  workspaceId: 'ws-boundary-alpha',
                  path: WORKSPACE_PATH,
                  sessionIds: [archived.id, live.id]
                })],
                archivedSessionIds: value
              })
            }
          };
        }
        return null;
      }
    };
    plugin.apply(ctx);
    const candidates = await registeredSource.candidates(
      { sessionId: CURRENT_SESSION_ID },
      { query: WORKSPACE_PATH, drilled: true }
    );

    assert.deepEqual(
      offeredIds(candidates),
      [live.id, archived.id],
      'a malformed archive list empties the filter instead of throwing or hiding live rows'
    );
  });
}

test('Secondary candidates: a Workspace whose sessionIds is null or absent offers nothing and does not throw', async () => {
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const { plugin } = loadClientInSandbox();

  for (const sessionIds of [null, undefined]) {
    let registeredSource = null;
    const ctx = {
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => key },
      slots: { inject: () => {}, register: () => {} },
      get: (name) => {
        if (name === 'inputTriggers') {
          return { registerSource: (source) => { registeredSource = source; return () => {}; } };
        }
        if (name === 'sessions') return { list: { getSnapshot: () => sessionsSnapshot({ [live.id]: live }) } };
        if (name === 'workspaces') {
          const entry = workspaceItem({ workspaceId: 'ws-boundary-alpha', path: WORKSPACE_PATH, sessionIds: [] });
          if (sessionIds === null) entry.sessionIds = null;
          else delete entry.sessionIds;
          return { list: { getSnapshot: () => ({ items: [entry], archivedSessionIds: [] }) } };
        }
        return null;
      }
    };
    plugin.apply(ctx);
    const candidates = await registeredSource.candidates(
      { sessionId: CURRENT_SESSION_ID },
      { query: WORKSPACE_PATH, drilled: true }
    );
    assert.deepEqual(offeredIds(candidates), [], 'sessionIds ' + String(sessionIds) + ' keeps the Workspace reachable but empty');
  }
});

hostTest('Secondary candidates: the Host throws where the plugin degrades, so the two disagree on the roster shape', () => {
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const snapshot = { ids: [live.id], byId: { [live.id]: live } };
  const workspace = { workspaceId: 'ws-boundary-alpha', path: WORKSPACE_PATH, title: 'Alpha', sessionIds: null };

  assert.throws(
    () => hostJudgments().groupByWorkspace(snapshot, [workspace], new Set(), 'default'),
    /sessionIds is not iterable/u,
    'the Host grouping loop dereferences sessionIds without a guard; the plugin deliberately absorbs it'
  );
});

// ---------------------------------------------------------------------------
// Boundary 4: member ids the snapshot cannot resolve
// ---------------------------------------------------------------------------

/**
 * sessionIds may name an id the byId map does not carry, or repeat one. The Host skips
 * the unknown id and never de-duplicates; the plugin skips unresolvable ids the same way,
 * but it has no de-duplication either, so a repeated id is offered twice.
 */
test('Secondary candidates: a member id missing from byId is skipped without throwing', async () => {
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const candidates = await level2For(
    { [live.id]: live },
    { sessionIds: [live.id, 'session-boundary-nowhere'] }
  );

  assert.deepEqual(offeredIds(candidates), [live.id], 'an id the snapshot cannot resolve never reaches the menu');
});

hostTest('Secondary candidates: a member id missing from byId stays skipped on the Host side too', () => {
  const host = hostJudgments();
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const snapshot = { ids: [live.id, 'session-boundary-nowhere'], byId: { [live.id]: live } };
  const workspace = {
    workspaceId: 'ws-boundary-alpha',
    path: WORKSPACE_PATH,
    title: 'Alpha',
    sessionIds: [live.id, 'session-boundary-nowhere']
  };
  const groups = host.groupByWorkspace(snapshot, [workspace], new Set(), 'default');

  assert.deepEqual(
    groups[0].sessions.map((row) => row.id),
    [live.id],
    'the Host drops the unresolvable id and keeps the rest'
  );
});

test('Secondary candidates: a repeated member id is offered twice, exactly as the Host groups it twice', async () => {
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const candidates = await level2For({ [live.id]: live }, { sessionIds: [live.id, live.id] });

  assert.deepEqual(
    offeredIds(candidates),
    [live.id, live.id],
    'neither side de-duplicates a roster that repeats one id'
  );
});

test('Secondary candidates: a member row whose id is null or absent is still offered under its roster key', async () => {
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH });
  const nullId = titledRow('session-boundary-null-id', 'Null id row', {
    cwd: WORKSPACE_PATH,
    updatedAt: REFERENCE_NOW
  });
  const absentId = { ...nullId };
  delete absentId.id;

  // The corpus distinguishes an explicit null id from a row with no id field. Level 2
  // looks members up by their roster key, so the row survives either way and only its
  // sessionId value degrades to the empty string.
  for (const [label, row] of [['null', { ...nullId, id: null }], ['absent', absentId]]) {
    const candidates = await level2For(
      { [live.id]: live, 'session-boundary-null-id': row },
      { sessionIds: [live.id, 'session-boundary-null-id'] }
    );
    assert.deepEqual(
      offeredIds(candidates),
      [live.id, ''],
      'a row with a ' + label + ' id is still offered under its roster key'
    );
  }
});


// ---------------------------------------------------------------------------
// Boundary 5: subagent rows and the origin conflict
// ---------------------------------------------------------------------------

/**
 * A Session is a subagent when its summary says origin "subagent". The plugin widens
 * that to header.origin as a fallback, so a row the Host keeps (header only) disappears
 * from the menu. The Host reads summary.origin alone
 * (dsh-client-ui-workspace/lib/client.js:965, "if (session.origin === \"subagent\")
 * return false").
 */
const ORIGIN_SHAPES = [
  { id: 'origin-subagent', label: 'origin alone says subagent', fields: { origin: 'subagent' } },
  { id: 'origin-header-subagent', label: 'only header.origin says subagent', fields: { header: { origin: 'subagent' } } },
  { id: 'origin-conflict', label: 'origin and header.origin disagree', fields: { origin: 'default', header: { origin: 'subagent' } } },
  { id: 'origin-agree', label: 'origin and header.origin both say default', fields: { origin: 'default', header: { origin: 'default' } } }
];

for (const shape of ORIGIN_SHAPES) {
  hostTest('Secondary candidates: subagent origin when ' + shape.label + ' matches the Host', async () => {
    const row = titledRow('session-boundary-origin', 'Origin candidate', { cwd: WORKSPACE_PATH, ...shape.fields });
    const hostVisible = hostJudgments().sessionVisible(row, CURRENT_SESSION_ID, new Set(), 'default');
    const candidates = await level2For({ [row.id]: row });

    assert.equal(
      offeredIds(candidates).includes(row.id),
      hostVisible,
      'plugin visibility must equal the Host visibility when ' + shape.label
    );
  });
}

// ---------------------------------------------------------------------------
// Boundary 6: the 50-row cap
// ---------------------------------------------------------------------------

/**
 * The menu stops at 50 rows for the 60fps budget. The slice runs after a recency sort
 * that is not stable across equal timestamps in general, so the cap is only predictable
 * while distinct timestamps order the rows. Two facts are pinned here: a Workspace with
 * more than 50 visible members offers exactly the 50 most recent ones in one order, and
 * rows the plugin drops are already gone before the cap applies.
 */
test('Secondary candidates: the cap keeps the 50 most recent members and drops the 51st', async () => {
  const byId = {};
  const sessionIds = [];
  for (let index = 0; index < 60; index += 1) {
    const id = 'session-boundary-member-' + String(index).padStart(2, '0');
    byId[id] = titledRow(id, 'Member ' + index, { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW + index });
    sessionIds.push(id);
  }
  const candidates = await level2For(byId, { sessionIds });
  const ids = offeredIds(candidates);

  assert.equal(ids.length, 50, 'the menu stops at 50 rows');
  assert.equal(ids[0], sessionIds[59], 'the most recent member leads');
  assert.equal(ids[49], sessionIds[10], 'the 50th row is the 50th most recent');
  assert.ok(!ids.includes(sessionIds[9]), 'the 51st most recent member is cut');
});

test('Secondary candidates: hidden rows are dropped before the cap, so 47 visible members all fit', async () => {
  const byId = {};
  const sessionIds = [];
  for (let index = 0; index < 60; index += 1) {
    const id = 'session-boundary-member-' + String(index).padStart(2, '0');
    byId[id] = titledRow(id, 'Member ' + index, { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW + index });
    sessionIds.push(id);
  }
  // Every fifth member is a subagent child, which the menu drops before the cap applies.
  // 60 members minus 12 children leaves 48 visible rows under a 50-row budget, so the cap
  // never bites and the fixture stays a test of the filter order rather than the slice.
  for (let index = 0; index < 60; index += 5) {
    byId[sessionIds[index]] = titledRow(sessionIds[index], 'Child ' + index, {
      cwd: WORKSPACE_PATH,
      updatedAt: REFERENCE_NOW + index,
      origin: 'subagent'
    });
  }
  const candidates = await level2For(byId, { sessionIds });
  const ids = offeredIds(candidates);

  assert.equal(ids.length, 48, 'visible rows that survive the filter are all offered');
  assert.equal(ids[0], sessionIds[59], 'the most recent visible member leads');
  assert.ok(!ids.includes(sessionIds[0]), 'the hidden child is not offered even though it is recent');
  assert.ok(!ids.includes(sessionIds[55]), 'the last child in the roster is hidden as well');
});

/**
 * With 60 visible members plus 30 hidden ones the cap lands on the sorted list, which
 * proves the slice runs after the sidebar rule: 50 rows come out, none of them hidden.
 */
test('Secondary candidates: the cap counts only rows that survive the sidebar rule', async () => {
  const byId = {};
  const sessionIds = [];
  for (let index = 0; index < 90; index += 1) {
    const id = 'session-boundary-capped-' + String(index).padStart(2, '0');
    byId[id] = titledRow(id, 'Member ' + index, { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW + index });
    sessionIds.push(id);
  }
  // The 30 most recent members are subagent children, so they occupy the top of the sort
  // and would crowd the cap if the plugin truncated before filtering.
  for (let index = 60; index < 90; index += 1) {
    byId[sessionIds[index]] = titledRow(sessionIds[index], 'Child ' + index, {
      cwd: WORKSPACE_PATH,
      updatedAt: REFERENCE_NOW + index,
      origin: 'subagent'
    });
  }
  const candidates = await level2For(byId, { sessionIds });
  const ids = offeredIds(candidates);

  assert.equal(ids.length, 50, 'the cap still allows 50 visible rows');
  assert.equal(ids[0], sessionIds[59], 'the most recent visible member leads, not the most recent row overall');
  assert.ok(!ids.includes(sessionIds[89]), 'no hidden child survived the filter to take a slot');
});

// ---------------------------------------------------------------------------
// Boundary 7: updatedAt ordering
// ---------------------------------------------------------------------------

/**
 * Ordering is a subtraction over updatedAt (sessionRecency falls back to createdAt, then
 * 0). null, an absent field and a non-numeric string all collapse to a non-numeric
 * recency, and the resulting comparison is NaN, which sort() treats as "keep the current
 * order". So a row with no usable timestamp is not sunk: it keeps its roster position.
 * The cases pin that behaviour so the cap above stays the only order-sensitive rule.
 */
const ORDERING_SHAPES = [
  { label: 'null', updatedAt: null },
  { label: 'absent', updatedAt: undefined },
  { label: 'a non-numeric string', updatedAt: 'yesterday' }
];

for (const shape of ORDERING_SHAPES) {
  test('Secondary candidates: updatedAt as ' + shape.label + ' does not throw and keeps the roster order', async () => {
    const ranked = titledRow('session-boundary-ranked', 'Ranked', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW });
    const odd = titledRow('session-boundary-odd', 'Odd', { cwd: WORKSPACE_PATH });
    if (shape.updatedAt === undefined) delete odd.updatedAt;
    else odd.updatedAt = shape.updatedAt;

    const candidates = await level2For({ [ranked.id]: ranked, [odd.id]: odd }, {
      sessionIds: [odd.id, ranked.id]
    });
    // null and absent both fall back to 0 through the || chain, so the ranked row sorts
    // first. A non-numeric string makes the subtraction NaN, so the pair is left in
    // roster order instead.
    const expected = shape.label === 'a non-numeric string' ? [odd.id, ranked.id] : [ranked.id, odd.id];
    assert.deepEqual(offeredIds(candidates), expected, 'updatedAt as ' + shape.label + ' keeps the menu deterministic');
  });
}

test('Secondary candidates: members sharing one updatedAt keep roster order, so the order repeats', async () => {
  const byId = {
    'session-boundary-zeta': titledRow('session-boundary-zeta', 'Zeta', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW }),
    'session-boundary-alpha': titledRow('session-boundary-alpha', 'Alpha', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW })
  };
  const first = await level2For(byId, { sessionIds: ['session-boundary-zeta', 'session-boundary-alpha'] });
  const second = await level2For(byId, { sessionIds: ['session-boundary-zeta', 'session-boundary-alpha'] });

  assert.deepEqual(offeredIds(first), ['session-boundary-zeta', 'session-boundary-alpha'], 'equal timestamps keep the declared order');
  assert.deepEqual(offeredIds(second), offeredIds(first), 'the same input yields the same order on every run');
});

hostTest('Secondary candidates: the Host sorts equal timestamps by the same roster order', () => {
  const snapshot = {
    ids: ['session-boundary-zeta', 'session-boundary-alpha'],
    byId: {
      'session-boundary-zeta': titledRow('session-boundary-zeta', 'Zeta', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW }),
      'session-boundary-alpha': titledRow('session-boundary-alpha', 'Alpha', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW })
    }
  };
  const workspace = {
    workspaceId: 'ws-boundary-alpha',
    path: WORKSPACE_PATH,
    title: 'Alpha',
    sessionIds: ['session-boundary-zeta', 'session-boundary-alpha']
  };
  const groups = hostJudgments().groupByWorkspace(snapshot, [workspace], new Set(), 'default');

  assert.deepEqual(
    groups[0].sessions.map((row) => row.id),
    ['session-boundary-zeta', 'session-boundary-alpha'],
    'the Host keeps roster order for equal recency as well'
  );
});

// ---------------------------------------------------------------------------
// Boundary 8: the archived "only" filter
// ---------------------------------------------------------------------------

/**
 * The Host drops a whole Workspace group when the archived filter is "only" and nothing
 * in it survives (dsh-client-ui-workspace/lib/client.js:1040, "if (archivedFilter ===
 * \"only\" && members.length === 0) continue"). The plugin's level 2 is never asked for
 * the archived filter: its arguments carry query and drill only, and it always applies
 * the "default" rule. A Workspace with nothing archived therefore still offers its live
 * rows, which is the intended level-2 behaviour and is pinned here so a future archived
 * switch does not arrive unnoticed.
 */
hostTest('Secondary candidates: the archived "only" filter empties the Host group while level 2 keeps its live rows', async () => {
  const archived = titledRow('session-boundary-archived', 'Archived session', { cwd: WORKSPACE_PATH });
  const live = titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW - 10 });
  const snapshot = { ids: [archived.id, live.id], byId: { [archived.id]: archived, [live.id]: live } };
  const workspace = {
    workspaceId: 'ws-boundary-alpha',
    path: WORKSPACE_PATH,
    title: 'Alpha',
    sessionIds: [archived.id, live.id]
  };
  const archivedSet = new Set([archived.id]);

  const onlyGroups = hostJudgments().groupByWorkspace(snapshot, [workspace], archivedSet, 'only');
  assert.deepEqual(
    onlyGroups.map((group) => group.sessions.map((row) => row.id)),
    [[archived.id]],
    'the Host keeps only the archived row under the "only" filter'
  );

  const emptyHostGroups = hostJudgments().groupByWorkspace(
    { ids: [live.id], byId: { [live.id]: live } },
    [workspace],
    archivedSet,
    'only'
  );
  assert.deepEqual(emptyHostGroups, [], 'a Workspace with nothing archived is skipped entirely under "only"');

  const candidates = await level2For(snapshot.byId, { sessionIds: workspace.sessionIds, archivedSessionIds: [archived.id] });
  assert.deepEqual(
    offeredIds(candidates),
    [live.id],
    'level 2 never takes the archived filter, so it keeps the live row and hides the archived one'
  );
});


// ---------------------------------------------------------------------------
// The Session reported from the live environment
// ---------------------------------------------------------------------------

/**
 * The live Session the ticket reports: session-6b440cb0-c9d7-4c50-8861-433f325aafc1 was
 * built and never used, so its log holds four metadata frames and no message and no
 * title. It belongs to this Workspace's sessionIds, it is not archived, and it showed up
 * third in the level-2 menu rendered as a bare id.
 *
 * The plugin hides a row only when blank is the strict boolean true
 * (lib/client.js:3733). The Host bundle's blank producer always writes a boolean
 * (dsh-api-session-controller/lib/types/list.js: summaryFor uses
 * "blank: metadata?.blank ?? session.seq === 0" and summarizeCold uses
 * "blank: metadata?.blank ?? false"), so the live environment can hand the plugin a
 * blank-bearing row only in one of four shapes. Each shape is replayed below with a real
 * UUID-shaped id, and the two verdicts are compared.
 */
const UUID_SHAPED_ID = 'session-6b440cb0-c9d7-4c50-8861-433f325aafc1';

const LIVE_SUMMARY_SHAPES = [
  {
    label: 'blank true, the shape the Host writes for an unused Session',
    fields: { blank: true },
    pluginOffers: false,
    hostVisible: false
  },
  {
    label: 'blank absent, the shape a summary projection drops the field into',
    fields: {},
    pluginOffers: true,
    hostVisible: true
  },
  {
    label: 'blank 1, a non-boolean truthy flag',
    fields: { blank: 1 },
    pluginOffers: true,
    hostVisible: false
  },
  {
    label: 'blank "yes", a truthy string flag',
    fields: { blank: 'yes' },
    pluginOffers: true,
    hostVisible: false
  }
];

for (const shape of LIVE_SUMMARY_SHAPES) {
  hostTest('Secondary candidates: the reported unused Session when ' + shape.label, async () => {
    const row = coldUntitledRow(UUID_SHAPED_ID, WORKSPACE_PATH, { updatedAt: REFERENCE_NOW });
    Object.assign(row, shape.fields);
    const hostVisible = hostJudgments().sessionVisible(row, CURRENT_SESSION_ID, new Set(), 'default');
    const candidates = await level2For({ [row.id]: row, 'session-boundary-live': titledRow('session-boundary-live', 'Live session', { cwd: WORKSPACE_PATH, updatedAt: REFERENCE_NOW - 60 }) });
    const offered = offeredIds(candidates);

    assert.equal(hostVisible, shape.hostVisible, 'the Host verdict for this summary shape');
    assert.equal(offered.includes(UUID_SHAPED_ID), shape.pluginOffers, 'the plugin verdict for this summary shape');
    if (shape.pluginOffers) {
      const untitled = candidates.find((item) => JSON.parse(item.value).sessionId === UUID_SHAPED_ID);
      assert.equal(untitled.label, 'Agent #6b440cb0', 'an untitled row falls back to its short id label');
    }
  });
}

/**
 * The defect report says the row rendered as a bare id, not as "Agent 6b440cb0: ...".
 * That wording matters: only a row whose title is missing or is not a string falls back,
 * so the live summary had no usable title. A titled blank Session of the same shape stays
 * hidden, which is why the menu label is itself evidence about the summary.
 */
test('Secondary candidates: an untitled blank Session without a blank flag carries the bare-id fallback', async () => {
  const row = coldUntitledRow(UUID_SHAPED_ID, WORKSPACE_PATH, { updatedAt: REFERENCE_NOW });
  const candidates = await level2For({ [row.id]: row });
  const item = candidates.find((candidate) => JSON.parse(candidate.value).sessionId === UUID_SHAPED_ID);

  assert.ok(item, 'an untitled row with no blank flag reaches the menu');
  assert.equal(item.label, 'Agent #6b440cb0', 'the label is the short id badge, which is what the report saw as a bare id');
  assert.equal(item.description, 'time.months', 'only the recency line describes the row, since it never had a title');
});
