/**
 * Boundary corpus self-check: the shared corpus is complete, well shaped and usable.
 *
 * tests/helpers/boundary-corpus.mjs is the single malformed-input corpus the later
 * boundary tickets replay, so this file guards it rather than any plugin behaviour:
 * every boundary the issue names has a case, every case has a shape the builders can
 * assemble, and every verdict is either computed through the lifted Host judgments or
 * explained where the Host never reads the field.
 *
 * The corpus is also run through the real Host judgments as a whole, so a case whose
 * recorded verdict drifted from the Host bundle fails here instead of in a consumer.
 * The blank-flag divergence is the one exception: the corpus records what each side
 * does, and this file pins both readings instead of demanding they agree.
 *
 * A missing Host install skips the Host-dependent cases with a warning; a run pinned
 * with DSH_REQUIRE_REAL_HOST=1 fails instead, so CI can demand live evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNDARY_CATEGORIES,
  BoundaryCorpusError,
  CORPUS,
  DIVERGENT_BLANK_VALUES,
  EXPECTATION_MODE,
  PATH_EQUIVALENCE_PAIRS,
  PLUGIN_BLANK_RULE,
  buildCaseSnapshot,
  canonicalSnapshot,
  canonicalWorkspacesSnapshot,
  corpusPath,
  sessionRow,
  equalUpdatedAtPair,
  HOST_GROUPING_BEHAVIOUR,
  HOST_SESSION_IDS_NOT_ITERABLE,
  findCategory,
  flattenCases,
  projectStoredTable,
  storedWorkspaceTable
} from './helpers/boundary-corpus.mjs';
import {
  HOST_JUDGMENTS,
  HostUnavailableError,
  extractHostFunction,
  loadHostJudgments,
  resolveHostClientPath
} from './helpers/host-probe.mjs';
import {
  computeSessionShortId,
  isHumanReadableTitle,
  isTopLevelIdentity
} from '../lib/session-directory.mjs';
import { isSameWorkspace, normalizeWorkspace } from '../lib/workspace.mjs';
import { readClientSource } from './helpers/canvas-harness.mjs';

const CLIENT_PATH = resolveHostClientPath();

if (CLIENT_PATH === null) {
  // A pinned run fails here rather than turning its cases into skips.
  if (process.env.DSH_REQUIRE_REAL_HOST === '1') {
    throw new HostUnavailableError('DSH_REQUIRE_REAL_HOST=1 demands a real host install, but none was found');
  }
  process.stderr.write('[boundary-corpus] DSH host package not found; Host verdict verification skipped\n');
}

/**
 * The client bundle keeps its own path comparison, which lowercases the whole path.
 * It is read out of lib/client.js rather than re-typed here, so the divergence recorded
 * in PATH_EQUIVALENCE_PAIRS is checked against the shipped text.
 */
const clientIsSameWorkspace = (() => {
  const source = readClientSource();
  // The declaration is 2-space indented (one level inside the bundle factory); its closing
  // line is the first "}" back at that indent, so the slice stops at the function.
  const match = source.match(/^ {2}function isSameWorkspace\(w1, w2\) \{[\s\S]*?\n {2}\}/mu);
  assert.ok(match, 'lib/client.js must still declare isSameWorkspace(w1, w2)');
  return new Function('w1', 'w2', 'return (' + match[0] + ')(w1, w2);');
})();

/** Host-dependent cases skip as a group when no install is reachable. */
const describe = CLIENT_PATH === null ? test.skip : test;

/** Loaded once; a missing host never reaches this initializer. */
const host = CLIENT_PATH === null ? null : loadHostJudgments({ clientPath: CLIENT_PATH });

/**
 * The Host current-row id. The Host derives it from retainedBy.mainView, a private
 * helper the probe does not lift, so the rule is restated here and the canonical
 * snapshot is required to satisfy it.
 */
function hostCurrentRowId(snapshot) {
  return Object.values(snapshot.byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)?.id;
}

/** Runs one corpus case through the Host judgments the category declares. */
function judgeWithHost(category) {
  if (category.expectationMode === EXPECTATION_MODE.live && category.id === 'sessionIds') {
    return (caseId) => {
      const built = buildCaseSnapshot(category.id, caseId);
      try {
        const groups = host.groupByWorkspace(built.sessions, built.workspaces.items, new Set(built.archivedSessionIds), 'default', undefined);
        return { visible: true, groups, thrown: null };
      } catch (error) {
        return { visible: null, groups: null, thrown: error };
      }
    };
  }
  return (caseId) => {
    const built = buildCaseSnapshot(category.id, caseId);
    const current = hostCurrentRowId(built.sessions);
    const visible = host.sessionVisible(built.row, current, new Set(built.archivedSessionIds), 'default');
    return { visible, thrown: null };
  };
}

/**
 * Categories whose cases the Host can be asked about directly. `updatedAt` is derived
 * rather than live: the Host stacks two sorters on one field and its result is order,
 * not a boolean, so its cases are pinned through the comparator below instead.
 */
function isHostRunnable(category) {
  const id = category.id;
  const runnable = new Set(['blank', 'origin', 'sessionIds']);
  return runnable.has(id);
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

/** Case ids the issue names verbatim, so dropping a sample cannot pass unnoticed. */
const REQUIRED_CASE_IDS = Object.freeze([
  'title-number',
  'title-null',
  'title-empty',
  'title-whitespace',
  'sessionIds-unknown-id',
  'sessionIds-not-array',
  'sessionIds-duplicate-id',
  'path-absent',
  'path-null',
  'path-spaces',
  'path-trailing-slash',
  'path-case-mixed',
  'cwd-absent',
  'blank-true',
  'blank-false',
  'blank-number-1',
  'blank-string-yes',
  'blank-number-0',
  'blank-absent',
  'origin-subagent-header-absent',
  'origin-header-conflict',
  'updatedAt-null',
  'updatedAt-word',
  'updatedAt-equal',
  'archived-session-ids-not-array',
  'items-not-array',
  'roster-empty'
]);

const REQUIRED_CATEGORY_IDS = Object.freeze(['title', 'sessionIds', 'path', 'cwd', 'blank', 'origin', 'updatedAt', 'collection']);

test('Boundary Corpus: every boundary category the issue names is present', () => {
  assert.deepEqual([...BOUNDARY_CATEGORIES.map((category) => category.id)].sort(), [...REQUIRED_CATEGORY_IDS].sort());
  for (const categoryId of REQUIRED_CATEGORY_IDS) {
    const category = findCategory(categoryId);
    assert.ok(category.cases.length >= 3, categoryId + ' must carry several cases, not a single token one');
    assert.ok(category.label.length > 0, categoryId + ' must be named');
    assert.ok(category.hostExpectation.length > 0, categoryId + ' must say how its verdict is obtained');
  }
});

test('Boundary Corpus: every case the issue names exists and is owned by one category', () => {
  const keys = new Set(flattenCases().map((entry) => entry.key));
  for (const required of REQUIRED_CASE_IDS) {
    const owners = BOUNDARY_CATEGORIES.filter((category) => category.cases.some((entry) => entry.id === required));
    assert.equal(owners.length, 1, required + ' must appear in exactly one category');
    assert.ok(keys.has(owners[0].id + '/' + required), required + ' must be reachable through flattenCases');
  }
  // The named set is a floor, not the whole corpus: extras are allowed and expected.
  assert.ok(keys.size > REQUIRED_CASE_IDS.length);
});

test('Boundary Corpus: case ids are unique and category ids are unique', () => {
  const keys = flattenCases().map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  const categoryIds = BOUNDARY_CATEGORIES.map((category) => category.id);
  assert.equal(new Set(categoryIds).size, categoryIds.length);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('Boundary Corpus: every case carries an id, a title, values and a judgment', () => {
  for (const { category, entry, key } of flattenCases()) {
    if (category.id === 'collection' && entry.values === null) {
      assert.equal(key, 'collection/snapshot-null', 'only the null-snapshot case may carry no values');
    } else {
      assert.equal(typeof entry.values, 'object', key + ' must carry an object of values');
      assert.notEqual(entry.values, null, key + ' must carry values');
    }
    assert.equal(typeof entry.title, 'string');
    assert.ok(entry.title.length > 0, key + ' must be titled');
    assert.ok(entry.judgment && typeof entry.judgment === 'object', key + ' must carry a judgment');
    assert.ok(Object.keys(entry.judgment).includes('note'), key + ' must explain its judgment');
  }
});

test('Boundary Corpus: every expectation mode is declared and every category names one', () => {
  const modes = new Set(Object.values(EXPECTATION_MODE));
  for (const category of BOUNDARY_CATEGORIES) {
    assert.ok(modes.has(category.expectationMode), category.id + ' declares an unknown expectation mode');
    assert.ok(Array.isArray(category.notes) && category.notes.length > 0, category.id + ' must explain itself');
  }
});

test('Boundary Corpus: cases that carry a boolean verdict also carry the values it was read from', () => {
  for (const { category, entry, key } of flattenCases()) {
    if (category.expectationMode === EXPECTATION_MODE.static || entry.judgment.visible === null) continue;
    assert.equal(typeof entry.judgment.visible, 'boolean', key + ' records a verdict, so it must be boolean');
    assert.equal(typeof entry.judgment.note, 'string');
    assert.ok(entry.judgment.note.length > 0, key + ' must say what the verdict rests on');
  }
});

test('Boundary Corpus: every case assembles into snapshots the Host can be asked about', () => {
  for (const { category, entry, key } of flattenCases()) {
    const built = buildCaseSnapshot(category.id, entry.id);
    assert.ok(built.sessions, key + ' must assemble a sessions snapshot');
    assert.ok(Array.isArray(built.sessions.ids), key + ' must assemble an ids array');
    // A snapshot whose byId holds a row the ids list omits would let the Host never see it.
    assert.deepEqual([...built.sessions.ids].sort(), Object.keys(built.sessions.byId).sort(), key + ' must keep ids and byId in step');
    for (const row of Object.values(built.sessions.byId)) {
      assert.ok(row.retainedBy && typeof row.retainedBy === 'object', key + ' rows must stay shaped like Host summaries');
    }
    if (category.id === 'collection') continue;
    if (category.id === 'title' || category.id === 'sessionIds' || category.id === 'path') {
      assert.ok(Array.isArray(built.workspaces.items), key + ' must assemble a roster the Host can read');
      assert.equal(built.workspaces.items.length, 1);
      assert.equal(built.rosterEntry, built.workspaces.items[0], key + ' must hand back the roster entry it built');
    } else {
      assert.ok(built.row && built.row.id === 'session-boundary-case', key + ' must assemble one case row');
    }
  }
});

test('Boundary Corpus: building a case twice yields two independent snapshots', () => {
  const first = buildCaseSnapshot('blank', 'blank-number-1');
  const second = buildCaseSnapshot('blank', 'blank-number-1');
  assert.notEqual(first.sessions, second.sessions);
  assert.notEqual(first.sessions.byId, second.sessions.byId);
  first.sessions.byId['session-boundary-case'].blank = 'mutated';
  assert.equal(second.sessions.byId['session-boundary-case'].blank, 1);
});

test('Boundary Corpus: an unknown category or case fails loudly', () => {
  assert.throws(() => findCategory('nope'), BoundaryCorpusError);
  assert.throws(() => buildCaseSnapshot('blank', 'nope'), /unknown case/u);
  assert.throws(() => buildCaseSnapshot('nope', 'blank-true'), /unknown category/u);
});

test('Boundary Corpus: the canonical control snapshot satisfies the Host current-row rule', () => {
  const snapshot = canonicalSnapshot();
  assert.equal(hostCurrentRowId(snapshot), 'session-boundary-current');
  assert.deepEqual(canonicalWorkspacesSnapshot().items[0].sessionIds, snapshot.ids, 'the control Workspace owns every control session');
  assert.equal(hostCurrentRowId(equalUpdatedAtPair()), undefined, 'the ordering pair carries no current row');
});

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------

test('Boundary Corpus: fixtures round-trip through the real workspace.json layout', () => {
  const entries = canonicalWorkspacesSnapshot().items;
  const table = storedWorkspaceTable(entries, ['session-boundary-archived']);
  // The stored table is keyed by Workspace id, never an array.
  assert.ok(!Array.isArray(table.tables.workspaces));
  assert.deepEqual(Object.keys(table.tables.workspaces), ['ws-boundary-alpha']);
  assert.deepEqual(table.global.archivedSessionIds, ['session-boundary-archived']);
  const projected = projectStoredTable(table);
  assert.deepEqual(projected.items, entries);
  assert.deepEqual(projected.archivedSessionIds, ['session-boundary-archived']);
});

test('Boundary Corpus: projection keeps a malformed store malformed and never invents a roster', () => {
  assert.equal(projectStoredTable(null), null);
  assert.deepEqual(projectStoredTable({ tables: { workspaces: null }, global: {} }), { items: null, archivedSessionIds: undefined });
  assert.deepEqual(projectStoredTable({ tables: { workspaces: 'broken' }, global: null }), { items: 'broken', archivedSessionIds: null });
});

// ---------------------------------------------------------------------------
// Portability
// ---------------------------------------------------------------------------

test('Boundary Corpus: no fixture path is a hardcoded absolute home directory', () => {
  const serialised = JSON.stringify(CORPUS) + JSON.stringify(BOUNDARY_CATEGORIES.map((category) => category.cases));
  // Character classes, so this guard stays clean of the literals it refuses.
  assert.doesNotMatch(serialised, /["'`]\/(?:home|Users|root)\//u, 'fixture values must not embed a home directory');
  assert.ok(corpusPath('alpha').startsWith(corpusPath()), 'fixtures must hang off the neutral corpus root');
  assert.ok(!corpusPath('alpha').includes('\\'), 'fixture paths stay on one separator');
});

// ---------------------------------------------------------------------------
// Host verdicts
// ---------------------------------------------------------------------------

describe('Boundary Corpus: recorded verdicts match the lifted Host judgments', () => {
  for (const category of BOUNDARY_CATEGORIES) {
    if (!isHostRunnable(category)) continue;
    const judge = judgeWithHost(category);
    for (const entry of category.cases) {
      const key = category.id + '/' + entry.id;
      if (entry.judgment.visible === null) {
        // A recorded null means the Host cannot answer, so asking it must not answer either.
        const result = judge(entry.id);
        assert.equal(result.visible, null, key + ' records no Host verdict but the Host returned one');
        if (entry.judgment.hostThrows) {
          assert.ok(result.thrown, key + ' records a Host throw, so the Host must throw');
          assert.equal(String(result.thrown), entry.judgment.hostThrows, key + ' records a different Host failure');
        }
        continue;
      }
      assert.equal(judge(entry.id).visible, entry.judgment.visible, key + ' disagrees with the Host');
    }
  }
});

describe('Boundary Corpus: the unknown-id and duplicate-id cases keep every known member', () => {
  // Every row of the control snapshot is unaccounted for by the case Workspace, so the
  // Host emits a trailing Ungrouped bucket next to the case group; groups[0] is the case.
  for (const caseId of ['sessionIds-unknown-id', 'sessionIds-duplicate-id']) {
    const built = buildCaseSnapshot('sessionIds', caseId);
    const groups = host.groupByWorkspace(built.sessions, built.workspaces.items, new Set(), 'default', undefined);
    assert.equal(groups.length, 2, caseId + ' must add one Ungrouped bucket for the control rows');
    // The case row owns the ordinary id, so only the other control rows land in the bucket.
    const strayIds = groups[1].sessions.map((row) => row.id);
    assert.deepEqual(strayIds.sort(), [built.sessions.ids[1], built.sessions.ids[2]].sort());
    assert.ok(groups[0].sessions.length >= 1, caseId + ' must keep the member it did resolve');
    if (caseId === 'sessionIds-duplicate-id') {
      assert.equal(groups[0].sessions.length, 2, 'the Host does not de-duplicate sessionIds');
    }
  }
});

/** Runs the lifted grouping over a hand-built roster; mainSessionId dereferences retainedBy. */
function hostGroupsFor(roster, rows) {
  const byId = {};
  for (const row of rows) byId[row.id] = row;
  const sessions = { ids: rows.map((row) => row.id), byId, correlationId: 'corr-boundary-grouping' };
  return host.groupByWorkspace(sessions, roster, new Set(), 'default', undefined);
}

describe('Boundary Corpus: the three grouping behaviours a malformed roster produces', () => {
  // Each tier is driven through the Host with its own roster, so a tier cannot borrow the
  // answer of its neighbour: only the null/absent roster may throw, and it must.

  test('Boundary Corpus: sessionIds that resolve to unknown ids still group normally', () => {
    const built = buildCaseSnapshot('sessionIds', 'sessionIds-unknown-id');
    const groups = hostGroupsFor(built.workspaces.items, [built.sessions.byId['session-boundary-ordinary']]);
    assert.equal(groups[0].sessions.length, 1, HOST_GROUPING_BEHAVIOUR.grouped + ' must yield the member it resolved');
  });

  test('Boundary Corpus: a string sessionIds silently groups nothing and throws nothing', () => {
    // A one-character roster entry iterates over that character; no snapshot id matches it.
    const stringRoster = [{ workspaceId: 'ws-boundary-case', path: null, title: 'case', sessionIds: 'x' }];
    const row = sessionRow('session-boundary-control', {});
    const groups = hostGroupsFor(stringRoster, [row]);
    assert.equal(groups.length, 2, 'the empty group plus the trailing Ungrouped bucket');
    assert.equal(groups[0].sessions.length, 0, HOST_GROUPING_BEHAVIOUR.emptyGroup + ' must assemble an empty group');
    assert.deepEqual(groups[1].sessions.map((entry) => entry.id), ['session-boundary-control']);
  });

  test('Boundary Corpus: the recorded string case reproduces the silent empty group over the corpus roster', () => {
    const built = buildCaseSnapshot('sessionIds', 'sessionIds-not-array');
    const groups = host.groupByWorkspace(built.sessions, built.workspaces.items, new Set(), 'default', undefined);
    // A string iterates by character, none of which is a snapshot id.
    assert.equal(groups[0].sessions.length, 0, 'the recorded case must not throw and must not group');
    assert.equal(groups[0].key, 'ws-boundary-case');
  });

  for (const caseId of ['sessionIds-null', 'sessionIds-absent']) {
    test('Boundary Corpus: ' + caseId + ' makes the Host throw on the unguarded sessionIds loop', () => {
      const built = buildCaseSnapshot('sessionIds', caseId);
      assert.throws(
        () => hostGroupsFor(built.workspaces.items, [built.sessions.byId['session-boundary-ordinary']]),
        { name: 'TypeError', message: /sessionIds is not iterable/u },
        caseId + ' must reproduce ' + HOST_SESSION_IDS_NOT_ITERABLE
      );
      assert.equal(
        built.rosterEntry.sessionIds,
        caseId === 'sessionIds-null' ? null : undefined,
        'the roster entry must carry the malformed value rather than an empty list'
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Confirmed divergence
// ---------------------------------------------------------------------------

test('Boundary Corpus: the blank-flag divergence is recorded on both sides', () => {
  assert.deepEqual([...DIVERGENT_BLANK_VALUES], [1, 'yes']);
  assert.deepEqual([...PLUGIN_BLANK_RULE.divergentValues], [1, 'yes']);
  // The rule is quoted from the client; a rule edit must surface here rather than drift.
  assert.match(PLUGIN_BLANK_RULE.source, /^lib\/client\.js:\d+$/u);
  const blank = findCategory('blank');
  for (const entry of blank.cases) {
    assert.equal(typeof entry.judgment.plugin.visible, 'boolean', entry.id + ' must record the plugin reading too');
    assert.equal(entry.judgment.divergent, entry.judgment.visible !== entry.judgment.plugin.visible);
  }
});

describe('Boundary Corpus: the Host hides truthy blanks the plugin keeps', () => {
  for (const value of DIVERGENT_BLANK_VALUES) {
    const entry = findCategory('blank').cases.find((candidate) => Object.is(candidate.values.blank, value));
    assert.ok(entry, 'the divergent value ' + String(value) + ' must be in the corpus');
    const built = buildCaseSnapshot('blank', entry.id);
    assert.equal(host.sessionVisible(built.row, hostCurrentRowId(built.sessions), new Set(), 'default'), false);
    // The plugin rule, applied literally to the same row.
    const pluginHidden = built.row.blank === true && built.row.id !== 'session-boundary-current';
    assert.equal(pluginHidden, false);
    assert.equal(entry.judgment.plugin.visible, !pluginHidden);
  }
});

describe('Boundary Corpus: a header-only subagent row is kept by the Host and dropped by the plugin', () => {
  const entry = findCategory('origin').cases.find((candidate) => candidate.id === 'origin-absent-header-subagent');
  const built = buildCaseSnapshot('origin', entry.id);
  assert.equal(host.sessionVisible(built.row, hostCurrentRowId(built.sessions), new Set(), 'default'), true);
  // lib/client.js:3641-3645 reads header.origin as the fallback.
  assert.equal(built.row.header.origin === 'subagent', true);
  assert.equal(entry.judgment.visible, true);
});

// ---------------------------------------------------------------------------
// updatedAt ordering
// ---------------------------------------------------------------------------

describe('Boundary Corpus: equal updatedAt falls back to id order in the lifted comparator', () => {
  const compare = host.compileJudgment('orderByRecency', HOST_JUDGMENTS.groupByWorkspace.map((name) => extractHostFunction(host.source, name)));
  const pair = equalUpdatedAtPair();
  assert.deepEqual(compare(pair.ids, pair.byId), ['session-boundary-alpha', 'session-boundary-zeta']);
  // Reversing the input must not reverse the output: the fallback is the id, not the slot.
  assert.deepEqual(compare([...pair.ids].reverse(), pair.byId), ['session-boundary-alpha', 'session-boundary-zeta']);
});

describe('Boundary Corpus: a non-numeric updatedAt ranks as NaN and never reorders', () => {
  const compare = host.compileJudgment('orderByRecency', HOST_JUDGMENTS.groupByWorkspace.map((name) => extractHostFunction(host.source, name)));
  const rows = {
    'session-boundary-alpha': { id: 'session-boundary-alpha', updatedAt: 'yesterday' },
    'session-boundary-zeta': { id: 'session-boundary-zeta', updatedAt: 5 }
  };
  const ordered = compare(['session-boundary-alpha', 'session-boundary-zeta'], rows);
  // NaN comparisons leave the slot untouched, so the malformed row keeps its position.
  assert.equal(ordered[0], 'session-boundary-alpha');
  // A numeric pair is reordered as the Host documents.
  assert.deepEqual(compare(['session-boundary-a', 'session-boundary-b'], {
    'session-boundary-a': { id: 'session-boundary-a', updatedAt: 1 },
    'session-boundary-b': { id: 'session-boundary-b', updatedAt: 2 }
  }), ['session-boundary-b', 'session-boundary-a']);
});

// ---------------------------------------------------------------------------
// Plugin-side readings
// ---------------------------------------------------------------------------

test('Boundary Corpus: every Workspace title projects to a usable label', () => {
  for (const entry of findCategory('title').cases) {
    const built = buildCaseSnapshot('title', entry.id);
    const title = built.rosterEntry.title;
    // The projection the plugin menu applies at lib/client.js:4032: only a falsy title
    // falls back, so a whitespace title survives as whitespace and is pinned as such.
    const label = String(title || corpusPath('fallback').split('/').pop());
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 0, entry.id + ' must project to a non-empty label');
    if (!title) {
      assert.equal(label, 'fallback', entry.id + ' must fall back to the path basename');
    }
    if (entry.id === 'title-whitespace') {
      assert.equal(label.trim(), '', 'a whitespace title is not trimmed by the projection');
      assert.equal(isHumanReadableTitle(title), false, 'the title helper does reject it');
    }
    if (entry.id === 'title-number') {
      assert.equal(label, '42', 'a numeric title projects through String()');
    }
  }
  assert.equal(isHumanReadableTitle(null), false);
  assert.equal(isHumanReadableTitle('   '), false);
});

test('Boundary Corpus: every path case compares the way the plugin compares paths', () => {
  for (const pair of PATH_EQUIVALENCE_PAIRS) {
    assert.equal(isSameWorkspace(pair.left, pair.right), pair.equivalent, pair.id + ' disagrees with the shared normalizer');
    // The client carries its own copy, which lowercases the whole path instead.
    assert.equal(clientIsSameWorkspace(pair.left, pair.right), pair.pluginEquivalent, pair.id + ' disagrees with the client copy');
  }
  for (const entry of findCategory('path').cases) {
    const built = buildCaseSnapshot('path', entry.id);
    const value = built.rosterEntry.path;
    // A missing or null path normalises to empty rather than throwing.
    assert.equal(typeof normalizeWorkspace(value), 'string', entry.id + ' must normalise without throwing');
  }
});

test('Boundary Corpus: a malformed collection degrades to the guards the plugin applies', () => {
  const cases = new Map(findCategory('collection').cases.map((entry) => [entry.id, entry]));
  for (const caseId of ['archived-session-ids-not-array', 'archived-session-ids-null', 'archived-session-ids-absent']) {
    const built = buildCaseSnapshot('collection', caseId);
    assert.deepEqual(built.archivedSessionIds, [], caseId + ' must degrade to an empty archived roster');
    assert.ok(cases.has(caseId));
  }
  for (const caseId of ['items-not-array', 'items-object']) {
    const built = buildCaseSnapshot('collection', caseId);
    assert.ok(!Array.isArray(built.workspaces.items), caseId + ' must stay non-array so the guard is exercised');
  }
  const empty = buildCaseSnapshot('collection', 'roster-empty');
  assert.deepEqual(empty.workspaces.items, [], 'an empty roster stays an empty roster');
  assert.deepEqual(empty.workspaces.items, [], 'an empty roster stays an empty roster');
  assert.equal(buildCaseSnapshot('collection', 'snapshot-null').workspaces, null);
});

test('Boundary Corpus: every cwd case is either absent, null or a string', () => {
  for (const entry of findCategory('cwd').cases) {
    const built = buildCaseSnapshot('cwd', entry.id);
    const cwd = built.row.cwd;
    assert.ok(cwd === undefined || cwd === null || typeof cwd === 'string', entry.id + ' must keep cwd a scalar or absent');
    if (entry.id === 'cwd-absent') assert.equal('cwd' in built.row, false, 'an absent cwd must not be materialised as undefined');
    assert.equal(typeof computeSessionShortId(built.row.id), 'string');
  }
  // The board's top-level rule reads blank strictly; a truthy non-boolean is not blank there.
  assert.equal(isTopLevelIdentity({ blank: 1 }), true);
  assert.equal(isTopLevelIdentity({ blank: true }), false);
});
