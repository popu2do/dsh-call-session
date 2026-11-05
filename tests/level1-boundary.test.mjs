/**
 * Level 1 candidate boundary parity: the host roster decides the list, and every case
 * here asks the host first.
 *
 * Ticket #43. Each case drives the plugin's Level 1 branch (the workspace candidate list
 * built in lib/client.js) with a roster taken from the boundary corpus, and reads the
 * same roster through tests/helpers/host-probe.mjs. Wherever the host has a verdict the
 * assertion is that verdict, never a hand-written constant: rows exist because the host
 * emitted a group (or because the host itself threw), ids are the ids the host still
 * resolves, and path spellings are compared by the host's own string reading.
 *
 * Two families do not have a host verdict, and the tests say so instead of inventing one:
 * - the Host never marks a "current workspace"; it only carries workspace.path into
 *   group.cwd, so the plugin's isCurrent flag is compared against the literal path
 *   equality the host itself would compute, and the recorded divergence is asserted;
 * - the display-name fallback is a plugin projection over a label the host passes
 *   through untouched, so its contract is pinned as a projection.
 *
 * Malformed rows are the point of the exercise: a workspace.json holding sessionIds: null
 * makes the host sidebar throw, and the plugin must not take the resource explorer down
 * with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadClientInSandbox } from './helpers/canvas-harness.mjs';
import {
  HostUnavailableError,
  loadHostJudgments,
  resolveHostClientPath
} from './helpers/host-probe.mjs';
import {
  BOUNDARY_CATEGORIES,
  EXPECTATION_MODE,
  PATH_CATEGORY,
  PATH_EQUIVALENCE_PAIRS,
  SESSION_IDS_CATEGORY,
  TITLE_CATEGORY,
  buildCaseSnapshot,
  canonicalSnapshot,
  corpusPath,
  findCategory,
  workspaceEntry,
  workspacesSnapshot
} from './helpers/boundary-corpus.mjs';

const CLIENT_PATH = resolveHostClientPath();

if (CLIENT_PATH === null) {
  if (process.env.DSH_REQUIRE_REAL_HOST === '1') {
    throw new HostUnavailableError('DSH_REQUIRE_REAL_HOST=1 demands a real host install, but none was found');
  }
  process.stderr.write('[level1-boundary] DSH host package not found; host parity cases skipped\n');
}

const describe = CLIENT_PATH === null ? test.skip : test;
const host = CLIENT_PATH === null ? null : loadHostJudgments({ clientPath: CLIENT_PATH });

/** The current session id, matching CURRENT_SESSION_ID's row in canonicalSnapshot(). */
const CURRENT_SESSION_ID = 'session-boundary-current';

/** The Workspace id of the single roster entry every probe case builds. */
const CASE_WORKSPACE_ID = 'ws-boundary-case';

/**
 * Host verdict for one roster: the groups groupByWorkspace emits, in host order.
 * The host reads retainedBy off every byId row through mainSessionId, so the corpus
 * snapshot already carries it on every row.
 */
function hostGroups(workspaces, list = canonicalSnapshot(), archived = []) {
  const items = workspaces && Array.isArray(workspaces.items) ? workspaces.items : workspaces;
  const archivedIds = archived.length > 0 ? archived : (workspaces && workspaces.archivedSessionIds) || [];
  return host.groupByWorkspace(list, items, new Set(archivedIds), 'default', undefined);
}

/**
 * The roster groups a host grouping carries, ignoring the Ungrouped bucket the host
 * appends for sessions no roster entry accounts for. The bucket is identified by its
 * empty key, not by a missing cwd: a roster entry whose path is absent produces a group
 * with no cwd at all, and it is still a roster group.
 */
function hostRosterGroups(groups) {
  return groups.filter((group) => group.key !== '');
}

/** The cwds the host groups carry, in host order. */
function hostGroupPaths(groups) {
  return hostRosterGroups(groups).map((group) => group.cwd);
}

/**
 * What the host itself does with a Workspace path: it stores it verbatim and writes it
 * into group.cwd. There is no normalization in the host lookup, which is why a
 * trailing slash or a differently-cased spelling stays a separate group.
 */
function hostReadsPathAs(group, candidateCwd) {
  return group.cwd === candidateCwd;
}

/**
 * Mounts the plugin over one workspaces snapshot and returns the registered @ source
 * plus the sessions snapshot it reads, so a case can call candidates/header exactly
 * as the composer does.
 */
function mountPlugin({ workspaces, sessions = canonicalSnapshot(), locale = 'en' }) {
  const { plugin } = loadClientInSandbox();
  const dict = locale === 'zh' ? plugin.zh : plugin.en;
  let registeredSource = null;
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (key) => dict[key] || key },
    slots: { inject: () => {}, register: () => {} },
    get: (serviceName) => {
      if (serviceName === 'inputTriggers') {
        return { registerSource: (source) => { registeredSource = source; return () => {}; } };
      }
      if (serviceName === 'sessions') {
        return { list: { getSnapshot: () => sessions } };
      }
      if (serviceName === 'workspaces') {
        return { list: { getSnapshot: () => workspaces } };
      }
      return null;
    }
  });
  assert.ok(registeredSource, 'the plugin must register the @ source');
  return registeredSource;
}

/**
 * A sessions snapshot whose current row carries the given cwd, which is the input the
 * Level 1 branch reads when it decides which roster row is "the current workspace".
 */
function sessionsWithCurrentCwd(cwd) {
  const snapshot = canonicalSnapshot();
  snapshot.byId[CURRENT_SESSION_ID] = Object.assign({}, snapshot.byId[CURRENT_SESSION_ID], { cwd });
  return snapshot;
}

/** Runs the Level 1 branch, which is what an undrilled request produces. */
async function level1Candidates(source, sessionId = CURRENT_SESSION_ID) {
  return source.candidates({ sessionId }, { query: '', drilled: false });
}

/** The decoded value payload of one candidate, which is what onPick later parses. */
function payload(candidate) {
  return JSON.parse(candidate.value);
}

/**
 * A probe entry used by the cases whose roster shape is legal: the corpus workspace id,
 * with the field under test overridden. Kept separate from the corpus's own entry so a
 * case never has to know how buildCaseSnapshot merges values.
 */
function probeEntry(fields, drops = []) {
  return workspaceEntry(CASE_WORKSPACE_ID, fields, { drops });
}

/** The roster entry a corpus case builds, which is the row under test. */
function corpusEntry(categoryId, caseId) {
  return buildCaseSnapshot(categoryId, caseId).rosterEntry;
}

// ---------------------------------------------------------------------------
// Title: display-name fallback
// ---------------------------------------------------------------------------

/**
 * The host carries a Workspace title opaquely into the group label: it never trims it
 * and never falls back to the path. The plugin's display name is therefore a
 * projection, and these cases anchor that projection on the host label: a title the
 * host passes through non-empty must survive as the plugin's name unchanged.
 */
describe('Level 1 boundary: a title the host passes through reaches the menu unchanged', async () => {
  for (const entry of TITLE_CATEGORY.cases) {
    const rosterEntry = buildCaseSnapshot('title', entry.id).rosterEntry;
    const groups = hostGroups([rosterEntry]);
    const [hostGroup] = hostRosterGroups(groups);
    assert.ok(hostGroup, entry.id + ': the host emits one roster group');
    // Host reading: the label is the roster title, verbatim (null stays null).
    assert.equal(hostGroup.label, entry.values.title, entry.id + ': the host passes the title through untouched');

    const source = mountPlugin({ workspaces: workspacesSnapshot([rosterEntry]) });
    const list = await level1Candidates(source);
    assert.equal(list.length, 1, entry.id + ': one roster row, one candidate');
    assert.equal(typeof list[0].name, 'string', entry.id + ': the display name must always be a string');
    assert.equal(list[0].name, list[0].label, entry.id + ': name and label must agree');
    assert.ok(list[0].name.length > 0, entry.id + ': an empty label would render as a blank row');

    const hostLabelIsUsable = typeof hostGroup.label === 'string' && hostGroup.label.trim() !== '';
    if (hostLabelIsUsable) {
      assert.equal(list[0].name, hostGroup.label, entry.id + ': a usable host label must survive as the display name');
    }
  }
});

describe('Level 1 boundary: empty, whitespace and numeric titles fall back to the path leaf', async () => {
  // A title a reader can see is kept as the host shows it; a title that would render as
  // a blank (or bare number) row falls back to the path leaf.
  const expectations = {
    'title-empty': { leaf: 'alpha', showsTitle: false },
    'title-whitespace': { leaf: 'beta', showsTitle: false },
    'title-number': { leaf: 'gamma', showsTitle: true, shown: '42' }
  };
  for (const [caseId, expectation] of Object.entries(expectations)) {
    const rosterEntry = corpusEntry('title', caseId);
    const wsPath = corpusPath(expectation.leaf);
    const entry = Object.assign({}, rosterEntry, { path: wsPath });
    // Host reading of the same entry, so the case is anchored on a label the host itself
    // produces and refuses to trim or replace.
    const hostLabel = hostRosterGroups(hostGroups([entry]))[0].label;
    assert.deepEqual(hostLabel, entry.title, caseId + ': the host label is the raw roster title');

    const source = mountPlugin({ workspaces: workspacesSnapshot([entry]) });
    const [candidate] = await level1Candidates(source);
    const expected = expectation.showsTitle ? expectation.shown : expectation.leaf;
    assert.equal(candidate.name, expected, caseId + ': the display name is the visible title or the path leaf');
    if (!expectation.showsTitle) {
      assert.equal(candidate.name.trim(), expectation.leaf, caseId + ': a blank title never renders as a blank row');
    }
    assert.equal(payload(candidate).path, wsPath, caseId + ': the fallback never changes the drill path');
  }
});

describe('Level 1 boundary: a title-carrying entry without a path takes the title, not a path leaf', async () => {
  const entry = probeEntry({ path: null, title: 'Null Path' });
  const source = mountPlugin({ workspaces: workspacesSnapshot([entry]) });
  const [candidate] = await level1Candidates(source);
  assert.equal(candidate.name, 'Null Path', 'an entry with no path still shows its title');
});

describe('Level 1 boundary: an entry with neither path nor title still gets a readable name', async () => {
  // The host has no reading to compare against here (its label would be the empty
  // string, which a menu row cannot show), so the plugin's own floor is asserted: a
  // row is never blank.
  const entry = probeEntry({ path: null, title: null });
  const source = mountPlugin({ workspaces: workspacesSnapshot([entry]) });
  const [candidate] = await level1Candidates(source);
  assert.equal(typeof candidate.name, 'string');
  assert.ok(candidate.name.trim().length > 0, 'a nameless roster row still renders something');
});

// ---------------------------------------------------------------------------
// Path: absent, null and equivalence against the host cwd
// ---------------------------------------------------------------------------

describe('Level 1 boundary: an entry with no path is never given an invented workspace', async () => {
  for (const caseId of ['path-absent', 'path-null']) {
    const entry = corpusEntry('path', caseId);
    // The host keeps the entry as its own group and writes whatever path it holds into
    // group.cwd: an absent path leaves that key off the group entirely, a null path puts
    // null there. Neither becomes a fabricated string.
    const groups = hostRosterGroups(hostGroups([entry]));
    assert.equal(groups.length, 1, caseId + ': the host emits the group');
    assert.ok(groups[0].cwd === undefined || groups[0].cwd === null, caseId + ': the host invents no cwd');

    const source = mountPlugin({ workspaces: workspacesSnapshot([entry]) });
    const list = await level1Candidates(source);
    assert.equal(list.length, groups.length, caseId + ': level 1 keeps the row the host keeps');
    assert.equal(payload(list[0]).path, '', caseId + ': the plugin invents no path either');
    assert.notEqual(payload(list[0]).path, CURRENT_SESSION_ID, caseId + ': the drill path never borrows the current session id');

    // Drilling into that row must not fabricate a workspace header: the plugin resolves
    // no roster item for an empty path and stays silent, exactly like a host whose group
    // carries no cwd cannot mark anything as current.
    const header = source.header({ sessionId: CURRENT_SESSION_ID }, { query: '', drilled: true });
    assert.equal(header, undefined, caseId + ': a blank path must not produce a fabricated drill header');
  }

  // Control: the legal entry keeps its path all the way through, so the assertions above
  // are about the blank spellings and not about the host dropping cwds in general.
  const control = probeEntry({ path: corpusPath('control'), title: 'Control', sessionIds: [] });
  assert.equal(hostRosterGroups(hostGroups([control]))[0].cwd, corpusPath('control'), 'control: a legal entry carries its path through');
});

describe('Level 1 boundary: trailing-slash and case-mixed spellings follow the host string reading', async () => {
  for (const pair of PATH_EQUIVALENCE_PAIRS) {
    if (pair.id === 'missing-path') continue;
    const rosterEntry = workspaceEntry('ws-boundary-' + pair.id, {
      path: pair.right,
      title: pair.id,
      sessionIds: [CURRENT_SESSION_ID]
    });
    const groups = hostGroups([rosterEntry]);
    assert.equal(hostRosterGroups(groups).length, 1, pair.id + ': one roster entry, one host group');
    // Host reading: the path is written verbatim into the group, and the host's own
    // comparison against a cwd is a plain string equality.
    const [hostGroup] = hostRosterGroups(groups);
    assert.equal(hostGroup.cwd, pair.right, pair.id + ': the host keeps the spelling verbatim');
    assert.equal(hostReadsPathAs(hostGroup, pair.right), true, pair.id + ': the host finds the cwd when the strings match');
    assert.equal(
      hostReadsPathAs(hostGroup, pair.left),
      pair.left === pair.right,
      pair.id + ': the host only calls the sibling spelling current when the strings are identical'
    );

    // Plugin reading: the current row carries the sibling spelling, so isCurrent records
    // whether the plugin considers the two spellings one directory.
    const source = mountPlugin({
      workspaces: workspacesSnapshot([rosterEntry]),
      sessions: sessionsWithCurrentCwd(pair.left)
    });
    const [candidate] = await level1Candidates(source);
    assert.equal(payload(candidate).isCurrent, pair.pluginEquivalent, pair.id + ': the plugin reading matches the recorded one');
    assert.equal(payload(candidate).path, pair.right, pair.id + ': the drill path keeps the roster spelling');
    if (pair.pluginEquivalent) {
      assert.equal(candidate.description, 'Current', pair.id + ': an equivalent spelling is marked as the current workspace');
    }
  }
});

describe('Level 1 boundary: only one spelling is pinned first when both are in the roster', async () => {
  const equivalence = PATH_EQUIVALENCE_PAIRS.find((pair) => pair.id === 'trailing-slash');
  const trailing = workspaceEntry('ws-boundary-trailing', {
    path: equivalence.right,
    title: 'Trailing',
    sessionIds: []
  });
  const plain = workspaceEntry('ws-boundary-plain', {
    path: equivalence.left,
    title: 'Plain',
    sessionIds: []
  });
  const roster = [plain, trailing];
  // The host emits both spellings as their own groups, in roster order.
  assert.equal(hostRosterGroups(hostGroups(roster)).length, 2, 'control: the host keeps both spellings as their own groups');

  const source = mountPlugin({ workspaces: workspacesSnapshot(roster), sessions: sessionsWithCurrentCwd(equivalence.left) });
  const list = await level1Candidates(source);
  const flagged = list.filter((candidate) => payload(candidate).isCurrent);
  assert.equal(flagged.length, 2, 'both spellings name the current directory to the plugin normalizer');
  // The pin only reorders, it never drops a row.
  assert.equal(list.length, 2, 'no row is dropped while pinning');
  assert.deepEqual(
    list.map((candidate) => payload(candidate).path).sort(),
    [...hostGroupPaths(hostGroups(roster))].sort(),
    'the pinned list still carries exactly the roster paths'
  );
});

// ---------------------------------------------------------------------------
// Collection: two rows for one workspace, and no roster at all
// ---------------------------------------------------------------------------

describe('Level 1 boundary: the roster length decides the list, duplicates included', async () => {
  const duplicatePair = [
    workspaceEntry('ws-boundary-dup-a', { path: corpusPath('dup'), title: 'A', sessionIds: [] }),
    workspaceEntry('ws-boundary-dup-b', { path: corpusPath('dup'), title: 'A again', sessionIds: [] })
  ];
  const groups = hostGroups(duplicatePair);
  assert.equal(hostRosterGroups(groups).length, 2, 'host groups both roster rows even when they name one path');
  assert.deepEqual(hostGroupPaths(groups), [corpusPath('dup'), corpusPath('dup')], 'and reports the path twice');

  const source = mountPlugin({ workspaces: workspacesSnapshot(duplicatePair) });
  const list = await level1Candidates(source);
  assert.equal(list.length, hostRosterGroups(groups).length, 'level 1 must match the host row-for-row rather than de-duplicating');
  assert.deepEqual(
    list.map((candidate) => payload(candidate).path),
    hostGroupPaths(groups),
    'both rows naming the duplicated path survive in roster order'
  );
  assert.deepEqual(
    list.map((candidate) => candidate.name),
    hostRosterGroups(groups).map((group) => group.label),
    'and each keeps its own title'
  );
});

describe('Level 1 boundary: a session the roster never claims is grouped by the host but not listed as a workspace', async () => {
  // The host appends an Ungrouped bucket for stray sessions; that bucket has no cwd and
  // is not a workspace, so Level 1 must not turn it into a candidate.
  const claimed = workspaceEntry('ws-boundary-claimed', { path: corpusPath('claimed'), title: 'Claimed', sessionIds: [CURRENT_SESSION_ID] });
  const groups = hostGroups([claimed]);
  const ungrouped = groups.filter((group) => group.key === '');
  assert.equal(ungrouped.length, 1, 'control: the host emits an Ungrouped bucket for the unclaimed sessions');
  assert.ok(ungrouped[0].sessions.length > 0, 'control: and that bucket carries them');

  const source = mountPlugin({ workspaces: workspacesSnapshot([claimed]) });
  const list = await level1Candidates(source);
  assert.equal(list.length, hostRosterGroups(groups).length, 'the Ungrouped bucket is not a workspace candidate');
  assert.deepEqual(list.map((candidate) => candidate.name), ['Claimed'], 'only the roster rows are listed');
});

describe('Level 1 boundary: an empty roster lists nothing and fabricates no workspace', async () => {
  const emptyRoster = buildCaseSnapshot('collection', 'roster-empty');
  const groups = hostGroups(emptyRoster.workspaces, emptyRoster.sessions);
  assert.equal(hostRosterGroups(groups).length, 0, 'control: the host emits no roster group for an empty roster');
  assert.equal(groups.length, 1, 'control: the host still emits its Ungrouped bucket');
  assert.equal(
    groups[0].sessions.length,
    emptyRoster.sessions.ids.length,
    'control: every session of the snapshot lands in that bucket'
  );

  // The current session row still carries a cwd, which is exactly the input an
  // aggregation over sessions used to turn into a workspace.
  const source = mountPlugin({ workspaces: emptyRoster.workspaces, sessions: emptyRoster.sessions });
  const list = await level1Candidates(source);
  assert.deepEqual(list, [], 'no roster entry, no candidate: the cwd of the current session is not a workspace');

  const drilled = await source.candidates({ sessionId: CURRENT_SESSION_ID }, { query: corpusPath('anything'), drilled: true });
  assert.equal(drilled.length, 0, 'a driven empty roster resolves no member either');
});

describe('Level 1 boundary: a roster the host refuses to read is not read as a list', async () => {
  for (const caseId of ['items-not-array', 'items-object', 'snapshot-null']) {
    const broken = buildCaseSnapshot('collection', caseId);
    const source = mountPlugin({ workspaces: broken.workspaces, sessions: broken.sessions });
    const list = await level1Candidates(source).catch((error) => {
      assert.fail(caseId + ': level 1 must not throw on a broken roster: ' + error.message);
    });
    assert.ok(Array.isArray(list), caseId + ': level 1 always answers with a list');
    assert.equal(list.length, 0, caseId + ': nothing is borrowed from the sessions snapshot');
  }
});

// ---------------------------------------------------------------------------
// sessionIds: the shape that takes the host sidebar down
// ---------------------------------------------------------------------------

describe('Level 1 boundary: a malformed sessionIds never reaches the menu', async () => {
  for (const entry of SESSION_IDS_CATEGORY.cases) {
    const snapshot = buildCaseSnapshot('sessionIds', entry.id);
    const rosterItem = snapshot.workspaces.items[0];

    // Host verdict: either a grouping with the members it can resolve, or the recorded
    // TypeError that takes the whole sidebar down.
    let hostMembers = null;
    if (entry.judgment.hostThrows) {
      assert.throws(
        () => hostGroups(snapshot.workspaces, snapshot.sessions),
        (error) => error instanceof TypeError && /sessionIds is not iterable/.test(error.message),
        entry.id + ': the host grouping crashes on this roster entry'
      );
    } else {
      const [group] = hostRosterGroups(hostGroups(snapshot.workspaces, snapshot.sessions));
      assert.ok(group, entry.id + ': the host still emits the group');
      hostMembers = group.sessions.map((session) => session.id).filter((id) => id !== CURRENT_SESSION_ID);
    }

    // Plugin verdict: Level 1 lists the entry, and drilling answers instead of throwing.
    // sessionIds is never read on the Level 1 path, which is why the shape is only
    // observable one level down.
    const source = mountPlugin({ workspaces: snapshot.workspaces, sessions: snapshot.sessions });
    const list = await level1Candidates(source).catch((error) => {
      assert.fail(entry.id + ': level 1 must not throw on a malformed sessionIds: ' + error.message);
    });
    assert.equal(list.length, 1, entry.id + ': the roster entry still occupies one row');
    assert.equal(payload(list[0]).path, rosterItem.path, entry.id + ': the row keeps its own path');

    const drilled = await source.candidates({ sessionId: CURRENT_SESSION_ID }, { query: rosterItem.path, drilled: true })
      .catch((error) => {
        assert.fail(entry.id + ': drilling must not throw on a malformed sessionIds: ' + error.message);
      });
    const expectedMembers = hostMembers === null ? [] : hostMembers;
    // Compared through JSON so a candidate array from the sandbox and a host array from
    // the host bundle are the same value, not two different realms of Array.
    assert.equal(
      JSON.stringify(drilled.map((candidate) => payload(candidate).sessionId)),
      JSON.stringify(expectedMembers),
      entry.id + ': the members are whatever the host still resolves, never an exception'
    );
  }
});

describe('Level 1 boundary: every category this file reads is still the one it was written against', async () => {
  assert.equal(SESSION_IDS_CATEGORY.expectationMode, EXPECTATION_MODE.live, 'sessionIds verdicts must stay live');
  assert.equal(PATH_CATEGORY.expectationMode, EXPECTATION_MODE.static, 'path verdicts are plugin-side');
  assert.equal(TITLE_CATEGORY.expectationMode, EXPECTATION_MODE.static, 'title verdicts are plugin-side');
  for (const categoryId of ['title', 'path', 'sessionIds', 'collection']) {
    assert.ok(findCategory(categoryId), categoryId + ' must stay addressable');
  }
  const covered = BOUNDARY_CATEGORIES.filter((category) => ['title', 'path', 'sessionIds', 'collection'].includes(category.id));
  assert.equal(covered.length, 4, 'the four roster-side categories are the ones this file covers');
});
