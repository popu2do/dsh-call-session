/**
 * Live host contract probe: the host's own judgment becomes the source of truth.
 *
 * Covers the probe in tests/helpers/host-probe.mjs, which lifts sessionVisible and
 * groupByWorkspace out of the shipped dsh-client-ui-workspace bundle. The pinned
 * expectations restate host behavior only: subagent children never show, blank rows
 * follow host truthiness instead of a strict boolean, the archived filter decides
 * membership, and Archived-only drops a Workspace with no surviving member.
 *
 * The source-identity assertion is mutation proven at the bottom: a body edited after
 * lifting must stop matching the host, a re-indented body must still match, and
 * re-evaluating an edited judgment must change that judgment's result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  HOST_JUDGMENTS,
  HostContractDriftError,
  HostUnavailableError,
  assertionSourceMatchesHost,
  extractHostFunction,
  loadHostJudgments,
  resolveHostClientPath
} from './helpers/host-probe.mjs';

const CLIENT_PATH = resolveHostClientPath();

if (CLIENT_PATH === null) {
  // A pinned run fails here rather than turning its cases into skips.
  if (process.env.DSH_REQUIRE_REAL_HOST === '1') {
    throw new HostUnavailableError('DSH_REQUIRE_REAL_HOST=1 demands a real host install, but none was found');
  }
  process.stderr.write('[host-probe] DSH host package not found; live host contract verification skipped\n');
}

/** Host-dependent cases skip as a group when no install is reachable. */
const describe = CLIENT_PATH === null ? test.skip : test;

/** Loaded once; a missing host never reaches this initializer. */
const judged = CLIENT_PATH === null ? null : loadHostJudgments({ clientPath: CLIENT_PATH });

function retained(mainView) {
  return { mainView };
}

/** Builds a sessions snapshot in the shape sessions.list.getSnapshot() emits on the host. */
function snapshot(entries) {
  const byId = {};
  for (const [id, extra] of Object.entries(entries)) {
    byId[id] = { id, title: id, updatedAt: 1, retainedBy: retained(0), ...extra };
  }
  return { byId, ids: Object.keys(entries) };
}

/** Builds a Workspace roster item in the shape workspaces.list.getSnapshot() emits. */
function workspace(workspaceId, title, sessionIds) {
  return {
    workspaceId,
    path: path.join(path.sep, 'tmp', workspaceId),
    title,
    createdAt: '2026-01-02T03:04:05.000Z',
    sessionIds
  };
}

function visibleIds(groups) {
  return groups.map((group) => group.sessions.map((session) => session.id));
}

/**
 * A throwaway host install whose workspace client bundle declares sessionVisible only,
 * so loading its groupByWorkspace has to fail loudly instead of half-working.
 */
function createStubHostRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-probe-'));
  const libDir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  const bundle = path.join(libDir, 'client.js');
  fs.writeFileSync(bundle, 'function sessionVisible(session) { return session !== undefined; }\n');
  return { root, bundle };
}

/**
 * Spawns the pinned/unpinned skip contract in a separate process, against a root that
 * deliberately holds no host: a pinned run must fail there, an unpinned one must warn
 * and exit clean so a CI job without DSH still runs the unit suite.
 */
function runPinnedChild(root, pin) {
  const helperUrl = new URL('./helpers/host-probe.mjs', import.meta.url).href;
  const script = [
    'import { loadHostJudgments, resolveHostClientPath, HostUnavailableError } from ' + JSON.stringify(helperUrl) + ';',
    'const clientPath = resolveHostClientPath();',
    'if (clientPath === null) {',
    '  if (process.env.DSH_REQUIRE_REAL_HOST === "1") throw new HostUnavailableError("DSH_REQUIRE_REAL_HOST=1 demands a real host install, but none was found");',
    '  process.stderr.write("[host-probe] DSH host package not found; live host contract verification skipped\\n");',
    '} else {',
    '  process.stdout.write(String(loadHostJudgments({ clientPath }).sessionVisible({ id: "s" }, "s", new Set(), "default")));',
    '}'
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DSH_HOST_ROOT: root, DSH_REQUIRE_REAL_HOST: pin }
  });
}

describe('Host Probe: both judgments are lifted from the real bundle and are callable', () => {
  assert.ok(fs.existsSync(CLIENT_PATH), 'the probe must read a bundle that exists on disk');
  assert.equal(path.basename(CLIENT_PATH), 'client.js');
  assert.equal(typeof judged.sessionVisible, 'function');
  assert.equal(typeof judged.groupByWorkspace, 'function');
  assert.deepEqual(Object.keys(HOST_JUDGMENTS).sort(), ['groupByWorkspace', 'sessionVisible']);
});

describe('Host Probe: sessionVisible drops subagent children and keeps ordinary rows', () => {
  const archived = new Set();
  assert.equal(judged.sessionVisible({ id: 'session-a', origin: 'subagent' }, 'session-a', archived, 'show'), false);
  assert.equal(judged.sessionVisible({ id: 'session-a' }, 'session-a', archived, 'default'), true);
  assert.equal(judged.sessionVisible({ id: 'session-a' }, 'session-a', archived, 'show'), true);
  assert.equal(judged.sessionVisible({ id: 'session-a' }, 'session-a', archived, 'only'), false);
});

describe('Host Probe: blank rows follow host truthiness, not a strict boolean', () => {
  const archived = new Set();
  const current = 'session-current';
  assert.equal(judged.sessionVisible({ id: current, blank: true }, current, archived, 'default'), true);
  assert.equal(judged.sessionVisible({ id: 'session-blank', blank: true }, current, archived, 'default'), false);
  // The host tests the field for truthiness, so a non-boolean value still hides the row.
  assert.equal(judged.sessionVisible({ id: 'session-blank', blank: 1 }, current, archived, 'default'), false);
  assert.equal(judged.sessionVisible({ id: 'session-blank', blank: 'yes' }, current, archived, 'default'), false);
  assert.equal(judged.sessionVisible({ id: 'session-blank', blank: false }, current, archived, 'default'), true);
});

describe('Host Probe: the archived filter decides membership rather than the row itself', () => {
  const archived = new Set(['session-archived']);
  const row = { id: 'session-archived' };
  assert.equal(judged.sessionVisible(row, 'session-current', archived, 'default'), false);
  assert.equal(judged.sessionVisible(row, 'session-current', archived, 'show'), true);
  assert.equal(judged.sessionVisible(row, 'session-current', archived, 'only'), true);
});

describe('Host Probe: groupByWorkspace keeps Workspaces in caller order and trails strays', () => {
  const list = snapshot({
    'session-a': { updatedAt: 3 },
    'session-b': { updatedAt: 2 },
    'session-stray': { updatedAt: 9 }
  });
  const groups = judged.groupByWorkspace(list, [workspace('ws-a', 'alpha', ['session-b', 'session-a'])], new Set(), 'default', undefined);
  assert.deepEqual(visibleIds(groups), [['session-b', 'session-a'], ['session-stray']]);
  assert.equal(groups[0].label, 'alpha');
  assert.equal(groups[0].cwd, workspace('ws-a', 'alpha', []).path);
  assert.equal(groups[0].createdAt, Date.parse('2026-01-02T03:04:05.000Z'));
  // The trailing Ungrouped bucket carries no Workspace identity.
  assert.equal(groups[1].key, '');
  assert.equal(groups[1].workspaceId, undefined);
});

describe('Host Probe: Archived-only drops a Workspace whose members do not survive the filter', () => {
  const list = snapshot({ 'session-live': {}, 'session-archived': { updatedAt: 5 } });
  const roster = [workspace('ws-live', 'live', ['session-live']), workspace('ws-archived', 'archived', ['session-archived'])];
  const archived = new Set(['session-archived']);

  assert.deepEqual(visibleIds(judged.groupByWorkspace(list, roster, archived, 'default', undefined)), [['session-live'], []]);
  // ws-live loses every member, so the host skips it instead of emitting an empty group.
  const onlyArchived = judged.groupByWorkspace(list, roster, archived, 'only', undefined);
  assert.deepEqual(onlyArchived.map((group) => group.key), ['ws-archived']);
  assert.deepEqual(visibleIds(onlyArchived), [['session-archived']]);
  assert.deepEqual(visibleIds(judged.groupByWorkspace(list, roster, archived, 'show', undefined)), [['session-live'], ['session-archived']]);
});

describe('Host Probe: a lifted judgment still matches the host source verbatim', () => {
  assert.equal(assertionSourceMatchesHost(judged), null);
  for (const names of Object.values(HOST_JUDGMENTS)) {
    for (const name of names) {
      assert.equal(judged.sourceOf(name), extractHostFunction(judged.source, name), `${name} must be lifted verbatim`);
    }
  }
});

describe('Host Probe: mutation - an edited body stops matching the host source', () => {
  const original = judged.sourceOf('sessionVisible');
  const mutated = original.replace(
    'if (session.blank && session.id !== current) return false;',
    'if (session.blank === true && session.id !== current) return false;'
  );
  assert.notEqual(mutated, original, 'the mutation must actually rewrite the lifted body');
  const reread = { ...judged, source: judged.source.replace(original, mutated) };
  const mismatch = assertionSourceMatchesHost(reread);
  assert.ok(mismatch, 'the source-identity assertion must report the edited body');
  assert.equal(mismatch.name, 'sessionVisible');
  assert.equal(mismatch.lifted, mutated);
  assert.equal(mismatch.fresh, original);
});

describe('Host Probe: mutation - re-indenting a body keeps the source matching', () => {
  // Indentation and line breaks are not contract; only the tokens inside the body are.
  const original = judged.sourceOf('sessionVisible');
  const respaced = original.replace(/\n\t\t\t\t/gu, '\n');
  assert.notEqual(respaced, original);
  const reread = { ...judged, source: judged.source.replace(original, respaced) };
  assert.equal(assertionSourceMatchesHost(reread), null);
});

describe('Host Probe: mutation - a strict-boolean body changes the blank-row result', () => {
  const mutated = judged.compileJudgment(
    'sessionVisible',
    HOST_JUDGMENTS.sessionVisible.map((name) =>
      name === 'sessionVisible'
        ? judged
            .sourceOf(name)
            .replace('if (session.blank && session.id !== current) return false;', 'if (session.blank === true && session.id !== current) return false;')
        : judged.sourceOf(name)
    )
  );
  const current = 'session-current';
  const archived = new Set();
  assert.equal(judged.sessionVisible({ id: 'session-blank', blank: 1 }, current, archived, 'default'), false);
  assert.equal(mutated({ id: 'session-blank', blank: 1 }, current, archived, 'default'), true);
  // Truthy booleans agree, so the mutation only reddens where the rule actually differs.
  assert.equal(mutated({ id: 'session-blank', blank: true }, current, archived, 'default'), false);
});

describe('Host Probe: mutation - dropping the Archived-only group skip adds an empty group', () => {
  const mutated = judged.compileJudgment(
    'groupByWorkspace',
    HOST_JUDGMENTS.groupByWorkspace.map((name) =>
      name === 'groupByWorkspace' ? judged.sourceOf(name).replace('if (archivedFilter === "only" && members.length === 0) continue;', '') : judged.sourceOf(name)
    )
  );
  const list = snapshot({ 'session-live': {}, 'session-archived': { updatedAt: 5 } });
  const roster = [workspace('ws-live', 'live', ['session-live']), workspace('ws-archived', 'archived', ['session-archived'])];
  const archived = new Set(['session-archived']);
  assert.deepEqual(judged.groupByWorkspace(list, roster, archived, 'only', undefined).map((group) => group.key), ['ws-archived']);
  assert.deepEqual(mutated(list, roster, archived, 'only', undefined).map((group) => group.key), ['ws-live', 'ws-archived']);
});

test('Host Probe: extraction fails loudly when the host no longer declares a judgment', () => {
  assert.throws(() => extractHostFunction('function other() {}', 'sessionVisible'), HostContractDriftError);
  assert.throws(() => extractHostFunction('', 'sessionVisible'), HostContractDriftError);
  assert.throws(
    () => extractHostFunction('function sessionVisible(a) { return a; } function sessionVisible(b) { return b; }', 'sessionVisible'),
    /more than once/u
  );
  assert.throws(() => extractHostFunction('function sessionVisible(a) { if (a) { return 1; }', 'sessionVisible'), /unbalanced braces/u);
});

test('Host Probe: a host whose bundle drifted is not silently skipped', () => {
  const stub = createStubHostRoot();
  try {
    assert.equal(typeof extractHostFunction(fs.readFileSync(stub.bundle, 'utf8'), 'sessionVisible'), 'string');
    assert.throws(() => loadHostJudgments({ clientPath: stub.bundle }), HostContractDriftError);
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});

test('Host Probe: a missing host is an explicit skip path, never a silent pass', () => {
  assert.throws(() => loadHostJudgments({ clientPath: null }), HostUnavailableError);
  // The error class is what a caller keys its skip, and its hard failure, on.
  assert.equal(new HostUnavailableError('x').name, 'HostUnavailableError');
});

test('Host Probe: DSH_REQUIRE_REAL_HOST turns a missing host into a failure, not a skip', () => {
  const root = path.join(os.tmpdir(), 'dsh-host-probe-absent');
  assert.ok(!fs.existsSync(root));
  const pinned = runPinnedChild(root, '1');
  assert.notEqual(pinned.status, 0, 'a pinned run without a host must fail');
  assert.match(pinned.stderr, /DSH_REQUIRE_REAL_HOST=1 demands a real host install/u);

  const unpinned = runPinnedChild(root, '0');
  assert.equal(unpinned.status, 0, unpinned.stderr);
  assert.match(unpinned.stderr, /live host contract verification skipped/u);
  // The unpinned child reported a skip instead of pretending to have judged anything.
  assert.equal(unpinned.stdout, '');
});
