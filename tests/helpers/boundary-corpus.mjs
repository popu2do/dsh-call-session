/**
 * Boundary corpus: malformed Host snapshots rebuilt from the real storage layout.
 *
 * Every other fixture in this repository offers legal values only, so the plugin has
 * never been observed against the shapes a real store can actually hold: a numeric
 * Workspace title, a sessionIds field that is not an array, a blank flag holding 1.
 * This module is pure data plus a few builders, so the neighbouring tickets can replay
 * one shared corpus instead of each inventing their own malformed rows.
 *
 * Shapes follow the two stores DSH writes. workspace.json keeps tables.workspaces as an
 * object keyed by Workspace id, each entry carrying path / title / sessionIds /
 * createdAt / updatedAt, with global.archivedSessionIds as a string array next to it.
 * The sessions snapshot is an ids array plus a byId map whose entries carry
 * id / title? / cwd? / parentId? / origin? / running / blank / updatedAt.
 *
 * Absolute paths are never hardcoded here: every fixture path hangs off a neutral
 * PROJECT_ROOT, and the corpus tree is assembled through path.join so it stays valid on
 * either separator.
 *
 * Each category records how its Host verdict is obtained:
 *   live    - computed through host-probe's lifted sessionVisible / groupByWorkspace
 *   derived - computed from what the probe lifts out of the Host bundle, in code no
 *             caller can reach (the current-row discovery, or the Workspace loop that
 *             dereferences sessionIds without a guard)
 *   static  - the Host never reads the field on this path, so the verdict is a reading
 *             of the lifted source, quoted in the note
 */
import path from 'node:path';

/** Raised when the corpus is asked for a category or case it does not carry. */
export class BoundaryCorpusError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'BoundaryCorpusError';
  }
}

/** Neutral root every fixture path derives from; never a developer home directory. */
export const PROJECT_ROOT = path.join(path.sep, 'srv', 'corpus');

/**
 * Builds one corpus path below PROJECT_ROOT. Segments are joined through path.join so
 * the result follows the current separator, then normalised to forward slashes.
 */
export function corpusPath(...segments) {
  const joined = segments.length === 0 ? PROJECT_ROOT : path.join(PROJECT_ROOT, ...segments);
  return joined.replace(/\\/gu, '/');
}

/** A fixed reference instant, so "same updatedAt" cases never depend on wall clock. */
export const REFERENCE_NOW = 1767225600000;

/** The session whose row is rendered as the current one (retainedBy.mainView > 0). */
export const CURRENT_SESSION_ID = 'session-boundary-current';

/** A correlation id every corpus snapshot carries, so cases compare one snapshot identity. */
export const CORPUS_CORRELATION_ID = 'corr-boundary-corpus';

/**
 * How a category's Host verdict is produced.
 *   live    - call host.sessionVisible / host.groupByWorkspace on the case values
 *   derived - read the lifted helper text out of the Host bundle and evaluate it
 *   static  - the field never reaches a Host judgment; the note explains why
 */
export const EXPECTATION_MODE = Object.freeze({
  live: 'live',
  derived: 'derived',
  static: 'static'
});

/** The recorded verdict for one case, or for the whole category when a case omits one. */
function judgment(visible, note, hostThrows) {
  const verdict = { visible, note };
  // Present only on the shapes the Host cannot answer at all: asking it throws, so there
  // is no verdict to record and the throw itself is the recorded behaviour.
  if (hostThrows) verdict.hostThrows = hostThrows;
  return verdict;
}

function caseOf(id, title, values, expectation) {
  return { id, title, values, judgment: expectation };
}

function categoryOf(id, label, expectationMode, hostExpectation, cases, notes) {
  return { id, label, expectationMode, hostExpectation, cases, notes };
}

// ---------------------------------------------------------------------------
// Session builders
// ---------------------------------------------------------------------------

/**
 * Builds one sessions-snapshot row in the shape sessions.list.getSnapshot() emits on
 * the Host. `fields` overrides named keys; a key passed as undefined is dropped, which
 * is how the corpus expresses a missing cwd or a missing blank flag rather than a null.
 */
export function sessionRow(id, fields = {}) {
  const row = {
    id,
    title: id,
    updatedAt: REFERENCE_NOW,
    retainedBy: { mainView: 0 },
    ...fields
  };
  for (const key of Object.keys(fields)) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}

/**
 * Assembles a sessions snapshot from rows, keeping ids in the order given. The Host
 * reads byId first (it dereferences retainedBy on every value) and ids second (it walks
 * that list for the trailing Ungrouped bucket), so both are always present and agree.
 */
export function sessionsSnapshot(rows, { ids, correlationId = CORPUS_CORRELATION_ID } = {}) {
  const byId = {};
  for (const row of rows) byId[row.id] = row;
  return { ids: [...(ids === undefined ? rows.map((row) => row.id) : ids)], byId, correlationId };
}

// ---------------------------------------------------------------------------
// Workspace builders
// ---------------------------------------------------------------------------

/**
 * Builds one roster entry in the shape workspaces.list.getSnapshot() emits. `fields`
 * replaces named keys, `undefined` removes them, and `drops` lists keys to remove
 * outright, so a missing path, an explicit null path and a missing title each get one
 * unambiguous spelling.
 */
export function workspaceEntry(workspaceId, fields = {}, { drops = [] } = {}) {
  const entry = {
    workspaceId,
    path: corpusPath(workspaceId),
    title: workspaceId,
    sessionIds: [],
    createdAt: new Date(REFERENCE_NOW).toISOString(),
    updatedAt: new Date(REFERENCE_NOW).toISOString(),
    ...fields
  };
  for (const key of [...Object.keys(fields), ...drops]) {
    if (entry[key] === undefined) delete entry[key];
  }
  return entry;
}

/** Builds a workspaces snapshot whose items are the roster entries in the order given. */
export function workspacesSnapshot(entries, { archivedSessionIds = [] } = {}) {
  return { items: [...entries], archivedSessionIds: [...archivedSessionIds] };
}

/**
 * Mirrors the stored workspace.json layout: tables.workspaces is keyed by Workspace
 * id, and global.archivedSessionIds sits beside the table. Fixtures are written this
 * way so a case can start from storage and be projected into either snapshot.
 */
export function storedWorkspaceTable(entries, archivedSessionIds = []) {
  const table = {};
  for (const entry of entries) table[entry.workspaceId] = entry;
  return {
    global: { archivedSessionIds: [...archivedSessionIds], workspaceIds: [], initialized: true },
    tables: { workspaces: table }
  };
}

/**
 * Projects the stored table into the workspace snapshot the Host hands to the client.
 * A malformed store (a non-object table, a non-array archived list) projects to the
 * same malformed shape: this is a projection, not a sanitiser.
 */
export function projectStoredTable(table) {
  if (table === null || typeof table !== 'object') return table;
  const workspaces = table.tables && table.tables.workspaces;
  const items = workspaces === null || typeof workspaces !== 'object' ? workspaces : Object.keys(workspaces).map((id) => workspaces[id]);
  return { items, archivedSessionIds: table.global && table.global.archivedSessionIds };
}

// ---------------------------------------------------------------------------
// Canonical members
// ---------------------------------------------------------------------------

export const CANONICAL_SESSIONS = Object.freeze({
  ordinary: 'session-boundary-ordinary',
  archived: 'session-boundary-archived',
  current: CURRENT_SESSION_ID
});

export const CANONICAL_ARCHIVED_IDS = Object.freeze([CANONICAL_SESSIONS.archived]);

/** The legal control snapshot every malformed case is compared against. */
export function canonicalSnapshot() {
  return sessionsSnapshot([
    sessionRow(CANONICAL_SESSIONS.ordinary, { title: 'Ordinary session', updatedAt: REFERENCE_NOW - 1000 }),
    sessionRow(CANONICAL_SESSIONS.archived, { title: 'Archived session', updatedAt: REFERENCE_NOW - 2000 }),
    sessionRow(CANONICAL_SESSIONS.current, { title: 'Current session', updatedAt: REFERENCE_NOW, retainedBy: { mainView: 1 } })
  ]);
}

/** The legal control workspaces snapshot: one Workspace owning all three sessions. */
export function canonicalWorkspacesSnapshot() {
  return workspacesSnapshot([
    workspaceEntry('ws-boundary-alpha', {
      title: 'Boundary Alpha',
      sessionIds: [CANONICAL_SESSIONS.ordinary, CANONICAL_SESSIONS.archived, CANONICAL_SESSIONS.current]
    })
  ]);
}

// ---------------------------------------------------------------------------
// Category: blank flag
// ---------------------------------------------------------------------------

const BLANK_VALUES = [
  { id: 'blank-true', title: 'blank is true', value: true, visible: false, pluginVisible: false, reads: 'strict equality and truthiness agree' },
  { id: 'blank-false', title: 'blank is false', value: false, visible: true, pluginVisible: true, reads: 'strict equality and truthiness agree' },
  { id: 'blank-number-1', title: 'blank is 1', value: 1, visible: false, pluginVisible: true, reads: 'DIVERGENCE: Host truthiness hides the row, plugin strict equality keeps it' },
  { id: 'blank-string-yes', title: 'blank is "yes"', value: 'yes', visible: false, pluginVisible: true, reads: 'DIVERGENCE: Host truthiness hides the row, plugin strict equality keeps it' },
  { id: 'blank-number-0', title: 'blank is 0', value: 0, visible: true, pluginVisible: true, reads: 'falsy under either reading' },
  { id: 'blank-absent', title: 'blank is absent', value: undefined, visible: true, pluginVisible: true, reads: 'a missing flag is falsy under either reading' }
];

export const BLANK_CATEGORY = categoryOf(
  'blank',
  'blank flag',
  EXPECTATION_MODE.live,
  'sessionVisible(row, CURRENT_SESSION_ID, new Set(), "default")',
  BLANK_VALUES.map((entry) =>
    caseOf(entry.id, entry.title, { blank: entry.value }, {
      ...judgment(entry.visible, entry.reads),
      plugin: { visible: entry.pluginVisible },
      divergent: entry.visible !== entry.pluginVisible
    })
  ),
  [
    'Only the current row is tested: sessionVisible hides a blank row only when its id is not the current one.',
    'This is the confirmed rule divergence: the Host hides a truthy blank, the plugin hides only a strict true (lib/client.js:3733).'
  ]
);

/** The blank values on which the Host verdict and the plugin verdict differ. */
export const DIVERGENT_BLANK_VALUES = Object.freeze(
  BLANK_CATEGORY.cases.filter((entry) => entry.judgment.divergent).map((entry) => entry.values.blank)
);

/** The plugin-side rule this corpus compares against, quoted from lib/client.js:3733. */
export const PLUGIN_BLANK_RULE = Object.freeze({
  source: 'lib/client.js:3733',
  text: 'if (session.blank === true && session.id !== currentSessionId) return false;',
  hiddenWhen: 'session.blank === true and the row is not the current session',
  divergentValues: DIVERGENT_BLANK_VALUES
});

// ---------------------------------------------------------------------------
// Category: origin / header
// ---------------------------------------------------------------------------

export const ORIGIN_CATEGORY = categoryOf(
  'origin',
  'subagent origin against the header',
  EXPECTATION_MODE.live,
  'sessionVisible(row, CURRENT_SESSION_ID, new Set(), "default")',
  [
    caseOf('origin-subagent-header-absent', 'origin is "subagent" and header is absent', { origin: 'subagent' }, judgment(false, 'the Host reads the summary origin first and drops the row')),
    caseOf('origin-subagent-header-agrees', 'origin and header.origin both say subagent', { origin: 'subagent', header: { origin: 'subagent' } }, judgment(false, 'both readings agree; the row never shows')),
    caseOf('origin-absent-header-subagent', 'origin is absent and header.origin says subagent', { header: { origin: 'subagent' } }, judgment(true, 'the lifted sessionVisible tests only summary.origin, so the Host keeps the row while the plugin drops it: recorded divergence')),
    caseOf('origin-header-conflict', 'origin says default and header.origin says subagent', { origin: 'default', header: { origin: 'subagent' } }, judgment(true, 'same divergence as the case above: the Host keeps the row while the plugin drops it')),
    caseOf('origin-default-header-default', 'origin and header.origin both say default', { origin: 'default', header: { origin: 'default' } }, judgment(true, 'neither reading marks a child'))
  ],
  [
    'The header rides along on the row as a whole object; the lifted sessionVisible never reads header.origin, which is why the verdict above is the plain origin reading.',
    'The two header-only rows are the ones the plugin drops, so the self-check asserts that divergence instead of assuming agreement.'
  ]
);

// ---------------------------------------------------------------------------
// Category: cwd
// ---------------------------------------------------------------------------

export const CWD_CATEGORY = categoryOf(
  'cwd',
  'session cwd',
  EXPECTATION_MODE.static,
  'no Host judgment reads cwd; the field is recorded so grouping and drill-down cases can reuse it',
  [
    caseOf('cwd-absent', 'cwd is absent', { cwd: undefined }, judgment(null, 'no Host reading; the Workspace owns the row, never the cwd')),
    caseOf('cwd-null', 'cwd is null', { cwd: null }, judgment(null, 'no Host reading')),
    caseOf('cwd-empty', 'cwd is the empty string', { cwd: '' }, judgment(null, 'no Host reading')),
    caseOf('cwd-relative', 'cwd is a relative path', { cwd: 'corpus/relative' }, judgment(null, 'no Host reading')),
    caseOf('cwd-present', 'cwd is an absolute path', { cwd: corpusPath('cwd-present') }, judgment(null, 'legal control'))
  ],
  ['cwd is asserted through the plugin-side path comparison, never through a Host verdict.']
);

// ---------------------------------------------------------------------------
// Category: updatedAt
// ---------------------------------------------------------------------------

export const UPDATED_AT_CATEGORY = categoryOf(
  'updatedAt',
  'member updatedAt',
  EXPECTATION_MODE.derived,
  'orderByRecency arithmetic over the row values',
  [
    caseOf('updatedAt-number', 'updatedAt is a number', { updatedAt: REFERENCE_NOW }, judgment(true, 'ranks normally')),
    caseOf('updatedAt-null', 'updatedAt is null', { updatedAt: null }, judgment(true, 'null subtracts as 0 in the comparator')),
    caseOf('updatedAt-string', 'updatedAt is a numeric string', { updatedAt: String(REFERENCE_NOW) }, judgment(true, 'the comparator subtracts, so a numeric string coerces')),
    caseOf('updatedAt-word', 'updatedAt is a non-numeric string', { updatedAt: 'yesterday' }, judgment(true, 'subtraction yields NaN, so the comparator never reorders this row')),
    caseOf('updatedAt-absent', 'updatedAt is absent', { updatedAt: undefined }, judgment(true, 'undefined subtracts as NaN through the Host comparator')),
    caseOf('updatedAt-equal', 'two rows share the same updatedAt', { updatedAt: REFERENCE_NOW }, judgment(true, 'equal ranks fall back to id order, so the result is stable'))
  ],
  ['Equal values are checked as an ordering invariant over a pair of rows, not as a single-row verdict.']
);

/** The pair used by the equal-updatedAt case, so the ordering claim has an input to run on. */
export function equalUpdatedAtPair() {
  return sessionsSnapshot([
    sessionRow('session-boundary-zeta', { updatedAt: REFERENCE_NOW }),
    sessionRow('session-boundary-alpha', { updatedAt: REFERENCE_NOW })
  ]);
}

// ---------------------------------------------------------------------------
// Category: workspace title
// ---------------------------------------------------------------------------

export const TITLE_CATEGORY = categoryOf(
  'title',
  'workspace title',
  EXPECTATION_MODE.static,
  'no Host judgment reads a Workspace title; the roster row carries whatever value it holds',
  [
    caseOf('title-number', 'title is a number', { title: 42 }, judgment(null, 'the Host passes the number through as the group label')),
    caseOf('title-null', 'title is null', { title: null }, judgment(null, 'the Host passes null through as the group label')),
    caseOf('title-empty', 'title is the empty string', { title: '' }, judgment(null, 'an empty label renders as no label')),
    caseOf('title-whitespace', 'title is whitespace only', { title: '   ' }, judgment(null, 'a whitespace label renders as no label')),
    caseOf('title-string', 'title is a normal string', { title: 'Boundary Alpha' }, judgment(null, 'legal control'))
  ],
  ['Titles are asserted through the plugin label projection, which calls String() on every value.']
);

// ---------------------------------------------------------------------------
// Category: workspace sessionIds
// ---------------------------------------------------------------------------

/**
 * What the Host throws on a Workspace whose sessionIds is null or absent. groupByWorkspace
 * walks `for (const id of workspace.sessionIds)` with no guard, so one malformed roster
 * entry ends the whole grouping rather than that one group. Recorded as text because the
 * corpus carries no live error object; the self-check compares it against the real throw.
 */
export const HOST_SESSION_IDS_NOT_ITERABLE = 'TypeError: workspace.sessionIds is not iterable';

/** The three ways groupByWorkspace answers a roster entry, quoted by the self-check. */
export const HOST_GROUPING_BEHAVIOUR = Object.freeze({
  grouped: 'grouped',
  emptyGroup: 'empty-group',
  throws: 'throws'
});

export const SESSION_IDS_CATEGORY = categoryOf(
  'sessionIds',
  'workspace sessionIds',
  EXPECTATION_MODE.live,
  'groupByWorkspace(snapshot, [entry], archived, "default")',
  [
    caseOf('sessionIds-unknown-id', 'sessionIds names a session the snapshot does not carry', { sessionIds: [CANONICAL_SESSIONS.ordinary, 'session-boundary-missing'] }, judgment(true, 'the Host skips an unknown id and keeps the rows it found')),
    caseOf('sessionIds-duplicate-id', 'sessionIds repeats one id', { sessionIds: [CANONICAL_SESSIONS.ordinary, CANONICAL_SESSIONS.ordinary] }, judgment(true, 'the Host has no de-duplication, so the member appears twice')),
    caseOf('sessionIds-not-array', 'sessionIds is a string', { sessionIds: CANONICAL_SESSIONS.ordinary }, judgment(true, 'a string iterates by character, none of which is a snapshot id, so the group silently ends up empty and every row falls into Ungrouped')),
    caseOf('sessionIds-empty', 'sessionIds is an empty array', { sessionIds: [] }, judgment(true, 'the Workspace owns nothing, so the group is empty by demand rather than by accident')),
    caseOf('sessionIds-null', 'sessionIds is null', { sessionIds: null }, judgment(null, 'the Host loop iterates sessionIds unguarded, so a null roster entry takes the whole sidebar grouping down; the plugin degrades to an empty roster instead', HOST_SESSION_IDS_NOT_ITERABLE)),
    caseOf('sessionIds-absent', 'sessionIds is absent', { sessionIds: undefined }, judgment(null, 'an absent sessionIds dereferences to undefined at the same unguarded loop, so the Host fails exactly as it does for null', HOST_SESSION_IDS_NOT_ITERABLE))
  ],
  [
    'The three unreadable shapes are recorded separately: okay cases group normally, a string silently groups nothing, and null or absent throws out of groupByWorkspace. A plugin that reads the roster without a guard crashes the sidebar on the last pair.',
    'The throwing shapes are pinned by evaluating the lifted groupByWorkspace source, so the record is Host behaviour rather than a guess.'
  ]
);

// ---------------------------------------------------------------------------
// Category: workspace path
// ---------------------------------------------------------------------------

export const PATH_CATEGORY = categoryOf(
  'path',
  'workspace path',
  EXPECTATION_MODE.static,
  'the Host carries the path opaquely; equivalence is decided by the plugin path comparison',
  [
    caseOf('path-absent', 'path is absent', { path: undefined }, judgment(null, 'no Host reading')),
    caseOf('path-null', 'path is null', { path: null }, judgment(null, 'no Host reading')),
    caseOf('path-spaces', 'path contains a space', { path: corpusPath('with space', 'alpha') }, judgment(null, 'no Host reading')),
    caseOf('path-trailing-slash', 'path ends with a separator', { path: corpusPath('trailing') + '/' }, judgment(null, 'no Host reading')),
    caseOf('path-case-mixed', 'path is a differently-cased spelling of the trailing case', { path: corpusPath('TRAILING') }, judgment(null, 'no Host reading'))
  ],
  ['Path cases come in pairs so the comparison can be exercised as an equivalence question.']
);

/**
 * Pairs a path case with the spelling it is compared against. The case-mixed pair is the
 * confirmed divergence between the two sides: lib/workspace.mjs lowercases the drive
 * letter only, while the client's own isSameWorkspace (lib/client.js:1103) lowercases the
 * whole path, so the corpus records both readings instead of assuming one.
 */
export const PATH_EQUIVALENCE_PAIRS = Object.freeze([
  { id: 'trailing-slash', left: corpusPath('trailing'), right: corpusPath('trailing') + '/', equivalent: true, pluginEquivalent: true },
  { id: 'case-mixed', left: corpusPath('trailing'), right: corpusPath('TRAILING'), equivalent: false, pluginEquivalent: true },
  { id: 'missing-path', left: corpusPath('trailing'), right: '', equivalent: false, pluginEquivalent: false }
]);

// ---------------------------------------------------------------------------
// Category: collection shape
// ---------------------------------------------------------------------------

export const COLLECTION_CATEGORY = categoryOf(
  'collection',
  'collection shape',
  EXPECTATION_MODE.static,
  'the plugin reads archivedSessionIds and items through Array.isArray guards; the Host loop is not guarded',
  [
    caseOf('archived-session-ids-not-array', 'archivedSessionIds is a string', { archivedSessionIds: 'session-boundary-archived' }, judgment(null, 'the plugin degrades to an empty archived roster')),
    caseOf('archived-session-ids-null', 'archivedSessionIds is null', { archivedSessionIds: null }, judgment(null, 'the plugin degrades to an empty archived roster')),
    caseOf('archived-session-ids-absent', 'archivedSessionIds is absent', { archivedSessionIds: undefined }, judgment(null, 'the plugin degrades to an empty archived roster')),
    caseOf('items-not-array', 'items is a string', { items: 'ws-boundary-alpha' }, judgment(null, 'the plugin degrades to an empty roster')),
    caseOf('items-object', 'items is an object keyed by Workspace id', { items: { 'ws-boundary-alpha': workspaceEntry('ws-boundary-alpha') } }, judgment(null, 'the plugin degrades to an empty roster')),
    caseOf('roster-empty', 'items is an empty array', { items: [] }, judgment(true, 'the roster is empty by design, not by degradation')),
    caseOf('snapshot-null', 'the whole workspaces snapshot is null', null, judgment(null, 'the plugin degrades to an empty roster and an empty archived list'))
  ],
  ['A non-array collection never reaches a Host judgment in the plugin, so these are recorded as plugin inputs with no Host verdict.']
);

/** Categories whose cases ride on a Workspace roster entry rather than a session row. */
export const WORKSPACE_SIDE_CATEGORIES = new Set(['title', 'sessionIds', 'path']);

// ---------------------------------------------------------------------------
// Registry and assembly
// ---------------------------------------------------------------------------

/** Every category in declaration order. */
export const BOUNDARY_CATEGORIES = Object.freeze([
  BLANK_CATEGORY,
  ORIGIN_CATEGORY,
  CWD_CATEGORY,
  UPDATED_AT_CATEGORY,
  TITLE_CATEGORY,
  SESSION_IDS_CATEGORY,
  PATH_CATEGORY,
  COLLECTION_CATEGORY
]);

/** Looks a category up by id, failing loudly rather than returning undefined. */
export function findCategory(categoryId) {
  const found = BOUNDARY_CATEGORIES.find((category) => category.id === categoryId);
  if (!found) throw new BoundaryCorpusError('unknown category ' + categoryId);
  return found;
}

/** Every case keyed by "<category>/<case>", which is how the self-check reports them. */
export function flattenCases(categories = BOUNDARY_CATEGORIES) {
  const flattened = [];
  for (const category of categories) {
    for (const entry of category.cases) flattened.push({ category, entry, key: category.id + '/' + entry.id });
  }
  return flattened;
}

/**
 * The archived roster a case is judged with: the canonical one, except for a collection
 * case, which keeps whatever malformed value it carries. A non-array value becomes an
 * empty list here only because the call signature needs one; the snapshot still carries
 * the raw value, so the guard that degrades it stays under test.
 */
function archivedIdsFor(categoryId, values) {
  if (categoryId === 'collection') {
    return Array.isArray(values && values.archivedSessionIds) ? [...values.archivedSessionIds] : [];
  }
  return [...CANONICAL_ARCHIVED_IDS];
}

/**
 * Assembles the snapshots one case is judged against. Workspace-side categories get a
 * roster entry carrying the case's own values merged over a legal entry; session-side
 * categories get the case's row merged over the canonical snapshot; collection cases
 * get the malformed snapshot the case describes. Every builder allocates fresh objects,
 * so calling this twice yields two independent snapshots.
 */
export function buildCaseSnapshot(categoryId, caseId) {
  const category = findCategory(categoryId);
  const entry = category.cases.find((candidate) => candidate.id === caseId);
  if (!entry) throw new BoundaryCorpusError('unknown case ' + categoryId + '/' + caseId);
  const values = entry.values;

  if (category.id === 'collection') {
    if (values === null) return { sessions: canonicalSnapshot(), workspaces: null, archivedSessionIds: [] };
    const workspaces = {};
    if ('items' in values) workspaces.items = values.items;
    if ('archivedSessionIds' in values) workspaces.archivedSessionIds = values.archivedSessionIds;
    return { sessions: canonicalSnapshot(), workspaces, archivedSessionIds: archivedIdsFor(category.id, values) };
  }

  if (WORKSPACE_SIDE_CATEGORIES.has(category.id)) {
    const drops = Object.keys(values).filter((key) => values[key] === undefined);
    const rosterEntry = workspaceEntry('ws-boundary-case', values, { drops });
    return {
      sessions: canonicalSnapshot(),
      workspaces: workspacesSnapshot([rosterEntry]),
      archivedSessionIds: archivedIdsFor(category.id, values),
      rosterEntry
    };
  }

  const drops = Object.keys(values).filter((key) => values[key] === undefined);
  const row = sessionRow('session-boundary-case', values, { drops });
  const base = canonicalSnapshot();
  const rows = base.ids.map((id) => base.byId[id]);
  return {
    sessions: sessionsSnapshot([...rows, row]),
    workspaces: workspacesSnapshot([workspaceEntry('ws-boundary-alpha', { sessionIds: [row.id] })]),
    archivedSessionIds: archivedIdsFor(category.id, values),
    row
  };
}

/** The corpus entry point: the categories plus the reusable canonical fixtures. */
export const CORPUS = Object.freeze({
  categories: BOUNDARY_CATEGORIES,
  sessions: Object.freeze({ canonical: canonicalSnapshot, equalUpdatedAt: equalUpdatedAtPair }),
  workspaces: Object.freeze({ canonical: canonicalWorkspacesSnapshot })
});
