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
