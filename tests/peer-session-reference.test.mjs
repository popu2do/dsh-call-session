import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

import { loadClientBundle, loadClientInSandbox, readClientSource } from './helpers/canvas-harness.mjs';
import { rosterScenarios, sessionsSnapshot, workspacesSnapshot } from './helpers/mock-host.mjs';

const CURRENT_WS = '/repos/TSPR/dsh-call-session';
const CLUSTER_WS = '/repos/infra/dsh-agent-cluster';
const GATEWAY_WS = '/repos/infra/dsh-gateway';
const SPACE_WS = '/repos/projects/project with spaces';

function setupMockContext(plugin, options = {}) {
  const {
    sessionsById = {},
    sessionsIds = null,
    locale = 'zh',
    hasInputTriggers = true,
    hasSessionsService = true,
    initialActiveCalls = 0,
    hasWorkspacesService = false,
    workspacesList = null,
    workspacesItems = null,
    archivedSessionIds = [],
    workspacesListThrows = false
  } = options;

  let registeredSource = null;
  const recordedCalls = Array.isArray(options.recordedCalls) ? options.recordedCalls.slice() : [];
  const recordedPosts = Array.isArray(options.recordedPosts) ? options.recordedPosts.slice() : [];

  const dict = locale === 'en' ? plugin.en : plugin.zh;

  const mockCtx = {
    effect: (fn) => fn(),
    locale: {
      register: () => {},
      bind: () => (key) => dict[key] || key
    },
    slots: {
      inject: () => {},
      register: () => {}
    },
    get: (serviceName) => {
      if (serviceName === 'inputTriggers') {
        if (!hasInputTriggers) return null;
        return {
          registerSource: (src) => {
            registeredSource = src;
            return () => { registeredSource = null; };
          }
        };
      }
      if (serviceName === 'sessions') {
        if (!hasSessionsService) return null;
        return {
          list: {
            getSnapshot: () => sessionsSnapshot(sessionsById, sessionsIds || undefined)
          }
        };
      }
      if (serviceName === 'workspaces') {
        // A roster declared through workspacesItems stands in for the real workspaces
        // snapshot, which always carries items alongside archivedSessionIds.
        if (workspacesItems) {
          return {
            list: {
              getSnapshot: () => {
                if (workspacesListThrows) throw new Error('workspaces list snapshot unavailable');
                return workspacesSnapshot({ items: workspacesItems, archivedSessionIds });
              }
            }
          };
        }
        if (!hasWorkspacesService) return null;
        return {
          list: {
            getSnapshot: () => {
              if (workspacesListThrows) throw new Error('workspaces list snapshot unavailable');
              return workspacesList || {};
            }
          }
        };
      }
      if (serviceName === 'callTelemetry') {
        return {
          activeCalls: initialActiveCalls,
          calls: recordedCalls,
          recordCall: (c) => recordedCalls.push(c)
        };
      }
      if (serviceName === 'boardStore') {
        return {
          posts: recordedPosts,
          executePost: (p) => recordedPosts.push(p),
          executeList: () => ({ posts: recordedPosts })
        };
      }
      if (serviceName === 'remote') {
        return {
          $host: { home: '/mock/account/home' }
        };
      }
      return null;
    }
  };

  plugin.apply(mockCtx);

  return {
    mockCtx,
    getRegisteredSource: () => registeredSource,
    recordedCalls,
    recordedPosts
  };
}

test('Peer Session Reference: Workspace roster reader sits beside the session reader and honours the empty-list contract', () => {
  const source = readClientSource();
  const sessionReaderAt = source.indexOf('function resolveSessionsById(');
  const rosterReaderAt = source.indexOf('function resolveWorkspaceRoster(');
  assert.ok(sessionReaderAt >= 0, 'The session reader must stay in lib/client.js');
  assert.ok(rosterReaderAt >= 0, 'A workspace roster reader must sit in lib/client.js beside the session reader');
  assert.ok(
    Math.abs(rosterReaderAt - sessionReaderAt) < 2000,
    'The roster reader must sit beside the session reader rather than elsewhere in the module'
  );
});

test('Peer Session Reference: One candidate computation reads the workspace roster snapshot once', async () => {
  const { plugin } = loadClientInSandbox();
  const scenarios = rosterScenarios();

  let reads = 0;
  let registeredSource = null;
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (key) => plugin.zh[key] || key },
    slots: { inject: () => {}, register: () => {} },
    get: (serviceName) => {
      if (serviceName === 'inputTriggers') {
        return { registerSource: (src) => { registeredSource = src; return () => {}; } };
      }
      if (serviceName === 'sessions') {
        return { list: { getSnapshot: () => ({ byId: scenarios.sessions }) } };
      }
      if (serviceName === 'workspaces') {
        return {
          list: {
            getSnapshot: () => {
              reads += 1;
              return { items: scenarios.items, archivedSessionIds: ['session-roster-archived'] };
            }
          }
        };
      }
      return null;
    }
  });

  await registeredSource.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(reads, 1, 'One Level 1 computation must read the workspace roster snapshot exactly once');

  reads = 0;
  await registeredSource.candidates({ sessionId: 'session-curr' }, { query: scenarios.currentWs, drilled: true });
  assert.equal(reads, 1, 'One Level 2 computation must read the workspace roster snapshot exactly once');
});

test('Peer Session Reference: Workspace roster reader degrades to an empty roster without throwing', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionRow = (id, label) => ({
    name: label,
    section: 'conversation',
    value: JSON.stringify({
      kind: 'session',
      label,
      mention: '@[' + label + '](dsh-session:' + Buffer.from(JSON.stringify(id), 'utf8').toString('base64url') + ')'
    })
  });

  /**
   * Mounts the plugin over a hand-written workspaces double and returns every
   * Level 2 candidate and wrapped native row set it produces, so a degradation
   * shows up as "the existing filtering still ran" rather than as a thrown error.
   */
  async function probe(workspacesService, sessionsService) {
    const nativeSource = {
      trigger: '@',
      name: 'reference',
      showGroupTitle: false,
      candidates: async () => [sessionRow('peer', 'peer session'), sessionRow('dead', 'dead session')]
    };
    const live = { sources: [nativeSource] };
    let registeredSource = null;
    plugin.apply({
      effect: (fn) => fn(),
      locale: { register: () => {}, bind: () => (key) => plugin.zh[key] || key },
      slots: { inject: () => {}, register: () => {} },
      get: (serviceName) => {
        if (serviceName === 'inputTriggers') {
          return {
            live,
            registerSource: (src) => { registeredSource = src; live.sources.push(src); return () => {}; }
          };
        }
        if (serviceName === 'sessions') return sessionsService;
        if (serviceName === 'workspaces') return workspacesService;
        return null;
      }
    });

    const level2 = await registeredSource.candidates(
      { sessionId: 'session-curr' },
      { query: CURRENT_WS, drilled: true }
    );
    const native = await nativeSource.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
    return { level2, native };
  }

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'peer': { id: 'peer', title: 'peer session', cwd: CURRENT_WS, status: 'idle', updatedAt: 4000 },
    'dead': { id: 'dead', title: 'dead session', cwd: CURRENT_WS, status: 'idle', updatedAt: 3000 }
  };
  const sessionsService = { list: { getSnapshot: () => ({ byId: sessionsById, ids: Object.keys(sessionsById) }) } };

  const expectedLevel2 = ['存活任务', 'peer session', 'dead session'];
  const expectedNative = ['peer session', 'dead session'];

  const cases = [
    ['missing workspaces service', null],
    ['snapshot without items', { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } }],
    ['items that is not an array', { list: { getSnapshot: () => ({ items: 'ws-current' }) } }],
    ['throwing snapshot read', { list: { getSnapshot: () => { throw new Error('workspaces list snapshot unavailable'); } } }],
    ['workspaces service without a list', {}]
  ];

  for (const [label, workspacesService] of cases) {
    const { level2, native } = await probe(workspacesService, sessionsService);
    const level2Labels = Array.from(level2, (item) => item.label);
    assert.deepEqual(
      level2Labels,
      expectedLevel2,
      'Roster read must degrade to an empty list for ' + label + ': got ' + JSON.stringify(level2Labels)
    );
    assert.deepEqual(
      Array.from(native, (item) => item.name),
      expectedNative,
      'Roster read must degrade to an empty list for ' + label + ', leaving the native wrapper filtering on'
    );
  }
});

test('Peer Session Reference: Harness declares roster items, archived roster ids and session ids without touching plugin internals', async () => {
  const { plugin } = loadClientInSandbox();
  const scenarios = rosterScenarios();

  // 名册外会话照旧留在 byId，但不在任何名册项里
  const sessionsById = Object.assign({}, scenarios.sessions, {
    'session-unrostered': { id: 'session-unrostered', title: '名册外会话', status: 'idle', updatedAt: 5000 },
    // 名册 id 声明归档，快照里没有任何归档标记
    'session-roster-archived': { id: 'session-roster-archived', title: '名册归档会话', cwd: scenarios.currentWs, status: 'idle', updatedAt: 3000 }
  });

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    sessionsIds: ['session-curr', 'session-ghost'],
    workspacesItems: scenarios.items,
    archivedSessionIds: ['session-roster-archived']
  });
  const src = getRegisteredSource();

  // 名册可声明但本窗口解不出会话：下钻直接空列表，不依赖 byId 里的 cwd 聚合
  const unreachable = await src.candidates(
    { sessionId: 'session-curr' },
    { query: scenarios.unreachableWs, drilled: true }
  );
  assert.ok(Array.isArray(unreachable), 'Roster items must be reachable without a matching byId entry');

  // 名册 id 声明归档的会话不进二级列表（快照字段本可放过它），其余成员照常展开
  const current = await src.candidates(
    { sessionId: 'session-curr' },
    { query: scenarios.currentWs, drilled: true }
  );
  const currentLabels = Array.from(current, (item) => item.label);
  assert.deepEqual(
    currentLabels,
    ['空白会话', '可见成员'],
    'Roster archived ids must reach Level 2 filtering for every declared member of the drilled workspace'
  );

  // sessions.ids 声明了 byId 里没有的会话，读取不得因此抛错或补齐成行
  assert.ok(!currentLabels.includes('Agent #ghost000'), 'Session ids without a byId entry must not synthesize rows');
});

test('Peer Session Reference: Roster fixtures construct all seven required scenarios', () => {
  const scenarios = rosterScenarios();
  const byId = scenarios.sessions;
  const rosterIds = Array.isArray(scenarios.items) ? scenarios.items.flatMap((item) => item.sessionIds) : [];

  // 1. 五个名册项，而 byId 只能解出一个工作区的会话
  assert.equal(scenarios.items.length, 5, 'The fixture must declare five roster items');
  const resolvableWorkspaces = scenarios.items.filter((item) =>
    item.sessionIds.some((id) => byId[id] !== undefined && byId[id].cwd !== undefined && byId[id].cwd === item.path)
  );
  assert.equal(resolvableWorkspaces.length, 1, 'byId must resolve sessions whose cwd matches for exactly one roster item');

  // 2. sessionIds 成员缺 cwd
  const noCwd = rosterIds.filter((id) => byId[id] !== undefined && byId[id].cwd === undefined && byId[id].workspace === undefined);
  assert.deepEqual(Array.from(noCwd), ['session-no-cwd'], 'One rostered session must carry no cwd');

  // 3. cwd 指向 A 而 sessionIds 归属 B
  const crossCwd = scenarios.items.filter((item) =>
    item.sessionIds.some((id) => byId[id] !== undefined && byId[id].cwd !== undefined && byId[id].cwd !== item.path)
  );
  assert.equal(crossCwd.length, 1, 'One rostered session must carry a cwd naming a different workspace');
  assert.equal(crossCwd[0].path, scenarios.crossCwdWs, 'The cross-cwd member must be rostered under the gateway workspace');

  // 4. 不在任何名册的会话
  const unrostered = Object.keys(byId).filter((id) => !rosterIds.includes(id));
  assert.deepEqual(Array.from(unrostered), ['session-unrostered'], 'One session must stay outside every roster');

  // 5. 非当前会话的空白会话
  const currentItem = scenarios.items.find((item) => item.path === scenarios.currentWs);
  const blankRostered = currentItem.sessionIds.filter((id) => byId[id] && byId[id].blank === true);
  assert.deepEqual(Array.from(blankRostered), ['session-blank'], 'One rostered session must be blank and outside the current session');
  assert.notEqual(currentItem.sessionIds[0], 'session-blank', 'The blank session must not be the current session');

  // 6. 同时以快照字段和名册 id 声明的归档会话
  const snapshotArchived = rosterIds.filter((id) => byId[id] && byId[id].archived === true);
  const rosterArchived = rosterIds.filter((id) => scenarios.archivedSessionIds.includes(id) && byId[id] && byId[id].archived !== true);
  assert.deepEqual(Array.from(snapshotArchived), ['session-snapshot-archived'], 'One rostered session must be archived through a snapshot field');
  assert.deepEqual(Array.from(rosterArchived), ['session-roster-archived'], 'One rostered session must be archived through a roster id only');

  // 7. 下钻工作区 sessionIds 全部不可解析，二级必然为空
  const unreachable = scenarios.items.find((item) => item.path === scenarios.unreachableWs);
  assert.ok(
    unreachable && unreachable.sessionIds.length > 0 && unreachable.sessionIds.every((id) => byId[id] === undefined),
    'The drilled cluster workspace must name only session ids the sessions snapshot cannot resolve'
  );

  // 名册顺序与字母序刻意不同，后续断言无法靠巧合通过
  const sortedPaths = scenarios.workspaces.slice().sort((a, b) => a.localeCompare(b));
  assert.notDeepEqual(Array.from(scenarios.workspaces), Array.from(sortedPaths), 'Roster order must differ from path-alphabetical order');
});

test('Peer Session Reference: Dictionary entries in zh and en are symmetrical and complete (ADR-0023)', () => {
  const plugin = loadClientBundle();

  assert.ok(plugin.zh['section.workspaces'], 'zh dictionary must contain section.workspaces');
  assert.ok(plugin.en['section.workspaces'], 'en dictionary must contain section.workspaces');
  assert.equal(plugin.zh['section.workspaces'], '工作区');
  assert.equal(plugin.en['section.workspaces'], 'Workspaces');

  assert.ok(plugin.zh['header.root'], 'zh dictionary must contain header.root');
  assert.ok(plugin.en['header.root'], 'en dictionary must contain header.root');
  assert.equal(plugin.zh['header.root'], '工作区根目录');
  assert.equal(plugin.en['header.root'], 'Workspace Root');

  assert.equal(plugin.zh['workspace.current'], '当前');
  assert.equal(plugin.en['workspace.current'], 'Current');
  assert.equal(plugin.zh['session.running'], '运行中');
  assert.equal(plugin.en['session.running'], 'Running');
  assert.equal(plugin.zh['session.idle'], '就绪');
  assert.equal(plugin.en['session.idle'], 'Idle');
  assert.equal(plugin.zh['session.error'], '异常');
  assert.equal(plugin.en['session.error'], 'Error');
  assert.equal(plugin.zh['session.offline'], '会话已离线');
  assert.equal(plugin.en['session.offline'], 'Session Offline');

  const zhKeys = Object.keys(plugin.zh).sort();
  const enKeys = Object.keys(plugin.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'All dictionary keys in zh and en must be strictly symmetrical');
});

test('Peer Session Reference: Input trigger source registration and codec contract in Node VM sandbox', async () => {
  const { plugin } = loadClientInSandbox();
  const { getRegisteredSource } = setupMockContext(plugin);

  const src = getRegisteredSource();
  assert.ok(src, 'Input trigger source must be registered');
  assert.equal(src.trigger, '@', 'Trigger character must be @');
  assert.equal(src.name, 'peer-session', 'Source name must be peer-session');
  assert.equal(src.order, -10, 'Source order must be -10 to ensure top priority placement over native sources');
  assert.equal(src.showGroupTitle, false, 'Group title must be hidden');

  assert.ok(src.codec, 'Source must provide codec');
  assert.equal(typeof src.codec.clipboardText, 'function');
  assert.equal(typeof src.codec.serialize, 'function');

  const ref = 'dsh-session:session-test-id';
  assert.equal(src.codec.clipboardText(ref), ref, 'clipboardText must return ref string directly');
  const serialized = await src.codec.serialize(ref);
  assert.equal(serialized, ref, 'serialize must resolve to ref string');
});

test('Peer Session Reference: Level 1 workspace discovery, drill contract, and current workspace pinning', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '主控协调任务', cwd: CURRENT_WS, status: 'running', updatedAt: 1000 },
    'session-local-1': { id: 'session-local-1', title: '架构重构', cwd: CURRENT_WS, status: 'idle', updatedAt: 2000 },
    'session-local-2': { id: 'session-local-2', title: '性能测试', cwd: CURRENT_WS, status: 'running', updatedAt: 3000 },
    'session-cl-1': { id: 'session-cl-1', title: '集群节点A', cwd: CLUSTER_WS, status: 'idle', updatedAt: 1500 },
    'session-cl-2': { id: 'session-cl-2', title: '集群节点B', cwd: CLUSTER_WS, status: 'running', updatedAt: 1800 },
    'session-gw-1': { id: 'session-gw-1', title: '网关路由', cwd: GATEWAY_WS, status: 'idle', updatedAt: 2500 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', quoted: false, drilled: false, signal: new AbortController().signal }
  );

  // 验证一级菜单仅包含工作区，会话全部被折叠，且多会话同一工作区去重
  assert.equal(level1.length, 3, 'Level 1 must deduplicate workspaces and contain exactly 3 workspaces');
  assert.ok(level1.every(item => item.drill === true), 'All Level 1 items must declare drill: true');
  assert.ok(level1.every(item => item.icon === 'folder'), 'All Level 1 items must use folder icon');
  assert.ok(level1.every(item => item.section === '工作区'), 'All Level 1 items must carry the plugin-owned 工作区 section');
  assert.ok(level1.every(item => item.icon !== 'session'), 'Zero session entities may be exposed at Level 1');

  // 当前工作区置顶
  assert.equal(level1[0].name, 'dsh-call-session', 'First workspace must be current workspace');
  assert.equal(level1[0].description, '当前', 'Current workspace must be marked with 当前 description');
  const val0 = JSON.parse(level1[0].value);
  assert.equal(val0.isCurrent, true, 'First workspace value must have isCurrent: true');
  assert.equal(val0.path, CURRENT_WS);

  // 非当前工作区按路径字母序排序
  assert.equal(level1[1].name, 'dsh-agent-cluster');
  assert.equal(level1[1].description, undefined);
  assert.equal(level1[2].name, 'dsh-gateway');
  assert.equal(level1[2].description, undefined);

  // 一级状态下顶栏下钻标题恒为 undefined
  const header = src.header({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(header, undefined, 'Level 1 must have no drill header');
});

test('Peer Session Reference: Level 1 query filtering and workspace selection formatting', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, status: 'running', updatedAt: 1000 },
    'session-cl': { id: 'session-cl', cwd: CLUSTER_WS, status: 'idle', updatedAt: 2000 },
    'session-gw': { id: 'session-gw', cwd: GATEWAY_WS, status: 'idle', updatedAt: 3000 },
    'session-sp': { id: 'session-sp', cwd: SPACE_WS, status: 'idle', updatedAt: 4000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  // 关键词过滤
  const matchGateway = await src.candidates(
    { sessionId: 'session-curr' },
    { query: 'gateway', drilled: false }
  );
  assert.equal(matchGateway.length, 1);
  assert.equal(matchGateway[0].name, 'dsh-gateway');

  // 大小写不敏感过滤
  const matchCluster = await src.candidates(
    { sessionId: 'session-curr' },
    { query: 'CLUSTER', drilled: false }
  );
  assert.equal(matchCluster.length, 1);
  assert.equal(matchCluster[0].name, 'dsh-agent-cluster');

  // 无匹配项返回空数组
  const matchNone = await src.candidates(
    { sessionId: 'session-curr' },
    { query: 'nonexistent-repo-path', drilled: false }
  );
  assert.equal(matchNone.length, 0);

  // 选定工作区下钻：不带空格路径
  const pickNormal = src.onPick({
    action: 'drill',
    candidate: matchCluster[0]
  });
  assert.equal(pickNormal.text, '@' + CLUSTER_WS);
  assert.equal(pickNormal.continue, true);

  // 选定工作区下钻：带空格路径自动包裹引号
  const matchSpace = await src.candidates(
    { sessionId: 'session-curr' },
    { query: 'spaces', drilled: false }
  );
  assert.equal(matchSpace.length, 1);
  const pickSpace = src.onPick({
    action: 'drill',
    candidate: matchSpace[0]
  });
  assert.equal(pickSpace.text, '@"' + SPACE_WS + '"');
  assert.equal(pickSpace.continue, true);
});

test('Peer Session Reference: Tab drill-down and Level 2 flat session expansion without micro-sections', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 5000 },
    'session-local-1': { id: 'session-local-1', title: '代码生成子模块', cwd: CURRENT_WS, status: 'running', updatedAt: 4000 },
    'session-local-2': { id: 'session-local-2', title: '自动化测试运行器', cwd: CURRENT_WS, status: 'idle', updatedAt: 3000 },
    'session-local-3': { id: 'session-local-3', title: '代码静态检查器', cwd: CURRENT_WS, status: 'error', updatedAt: 2000 },
    'session-child-1': { id: 'session-child-1', title: '临时子代理任务', cwd: CURRENT_WS, origin: 'subagent', parentId: 'session-curr', status: 'idle', updatedAt: 4500 },
    'session-archived-1': { id: 'session-archived-1', title: '历史已归档任务', cwd: CURRENT_WS, archived: true, status: 'archived', updatedAt: 4200 },
    'session-remote-1': { id: 'session-remote-1', title: '远端节点巡检', cwd: CLUSTER_WS, status: 'idle', updatedAt: 6000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  // 下钻当前工作区
  const level2Local = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  // 严格排除当前会话自身，且排除子代理与已归档会话
  assert.equal(level2Local.length, 3, 'Must list only 3 independent active root sessions in current workspace');
  assert.ok(level2Local.every(item => item.name !== '#curr0000' && !item.label.includes('当前会话')));
  assert.ok(!level2Local.some(item => item.label.includes('临时子代理任务')), 'Subagents must be strictly excluded from Level 2 (ADR-0010, ADR-0024)');
  assert.ok(!level2Local.some(item => item.label.includes('历史已归档任务')), 'Archived sessions must be strictly excluded from Level 2 (ADR-0010, ADR-0024)');

  // 扁平列表契约：绝无微分类
  assert.ok(level2Local.every(item => item.section === undefined), 'Level 2 must be flat with section undefined');
  assert.ok(level2Local.every(item => item.icon === 'session'), 'Level 2 items must use session icon');

  // 下钻远端工作区
  const level2Remote = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CLUSTER_WS, drilled: true }
  );
  assert.equal(level2Remote.length, 1);
  assert.equal(level2Remote[0].label, '远端节点巡检');

  // 下钻后二级过滤：按标题子串过滤
  const filteredByTitle = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS + ' 静态检查', drilled: true }
  );
  assert.equal(filteredByTitle.length, 1);
  assert.equal(filteredByTitle[0].label, '代码静态检查器');

  // 下钻后二级过滤：按短 ID 过滤（支持 # 前缀与纯短码）
  const targetShortId = level2Local[0].name;
  const filteredByShortWithHash = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS + ' ' + targetShortId, drilled: true }
  );
  assert.equal(filteredByShortWithHash.length, 1);
  assert.equal(filteredByShortWithHash[0].label, level2Local[0].label);

  const filteredByShortWithoutHash = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS + ' ' + targetShortId.replace('#', ''), drilled: true }
  );
  assert.equal(filteredByShortWithoutHash.length, 1);
  assert.equal(filteredByShortWithoutHash[0].label, level2Local[0].label);
});

test('Peer Session Reference: Sorting strictly by native latest update time descending', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, updatedAt: 99999 },
    'session-t1': { id: 'session-t1', title: '任务一', cwd: CURRENT_WS, status: 'idle', updatedAt: 1000 },
    'session-t2': { id: 'session-t2', title: '任务二', cwd: CURRENT_WS, status: 'running', updatedAt: 5000 },
    'session-t3': { id: 'session-t3', title: '任务三', cwd: CURRENT_WS, status: 'idle', updatedAt: 3000 },
    'session-t4': { id: 'session-t4', title: '任务四', cwd: CURRENT_WS, status: 'idle', createdAt: 2500 }, // 回退到 createdAt
    'session-t5': { id: 'session-t5', title: '任务五', cwd: CURRENT_WS, status: 'idle', updatedAt: 4000 },
    'session-t6': { id: 'session-t6', title: '任务六', cwd: CURRENT_WS, status: 'idle' } // 无时间戳，为 0
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const list = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  assert.equal(list.length, 6);
  assert.equal(list[0].label, '任务二', 'updatedAt 5000 must be first');
  assert.equal(list[1].label, '任务五', 'updatedAt 4000 must be second');
  assert.equal(list[2].label, '任务三', 'updatedAt 3000 must be third');
  assert.equal(list[3].label, '任务四', 'createdAt 2500 fallback must be fourth');
  assert.equal(list[4].label, '任务一', 'updatedAt 1000 must be fifth');
  assert.equal(list[5].label, '任务六', '0 timestamp must be last');
});

test('Peer Session Reference: Level 2 order follows the sidebar with no collaborator pinning', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, updatedAt: 99999 },
    'session-unregistered-recent': { id: 'session-unregistered-recent', title: '未协作新任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 8000 },
    'session-registered-older': { id: 'session-registered-older', title: '已协作旧任务', cwd: CURRENT_WS, status: 'running', updatedAt: 2000 },
    'session-registered-newer': { id: 'session-registered-newer', title: '已协作新任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 4000 }
  };

  // 注入已参与 call-session 调用的连线快照
  const mockCalls = [
    { callerSessionId: 'session-curr', targetSessionId: 'session-registered-older' },
    { callerSessionId: 'session-registered-newer', targetSessionId: 'session-curr' }
  ];

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    initialActiveCalls: 1,
    recordedCalls: mockCalls
  });
  const src = getRegisteredSource();

  const list = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  assert.equal(list.length, 3);
  // 纯按更新时间倒序：8000 > 4000 > 2000，协作记录不再置顶
  assert.equal(list[0].label, '未协作新任务', 'Newest session must lead regardless of collaboration history');
  assert.equal(list[1].label, '已协作新任务', 'Registered session with updatedAt 4000 must follow the newer session');
  assert.equal(list[2].label, '已协作旧任务', 'Registered session with updatedAt 2000 must rank last');
});

test('Peer Session Reference: Canonical 8-character short ID badge and title disambiguation', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, updatedAt: 9999 },
    'session-dup-a': { id: 'session-dup-a-11223344', title: '性能优化专项', cwd: CURRENT_WS, status: 'running', updatedAt: 3000 },
    'session-dup-b': { id: 'session-dup-b-55667788', title: '性能优化专项', cwd: CURRENT_WS, status: 'idle', updatedAt: 2000 },
    'session-notitle': { id: 'session-notitle-99aabbcc', cwd: CURRENT_WS, status: 'error', updatedAt: 1000 },
    'session-offline': { id: 'session-offline-ddeeff00', title: '已断开任务', cwd: CURRENT_WS, status: 'offline', updatedAt: 500 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const list = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  assert.equal(list.length, 4);

  // 8位规范短 ID 格式：# 开头且总长度为 9
  for (const item of list) {
    assert.ok(item.name.startsWith('#'), 'Candidate name must start with #');
    assert.equal(item.name.length, 9, 'Short ID format #12345678 must be exactly 9 characters');
  }

  // 同名消歧：标题相同但短 ID 必定不同
  assert.equal(list[0].label, '性能优化专项');
  assert.equal(list[1].label, '性能优化专项');
  assert.notEqual(list[0].name, list[1].name, 'Duplicate titles must produce distinct short IDs');

  // 无标题会话回退为 Agent #xxxxxxxx
  assert.equal(list[2].label, 'Agent ' + list[2].name, 'Missing title must fall back to Agent #shortId');

  // 动态状态与相对更新时间排版 (Q3 A 决策)
  assert.ok(list[0].description.startsWith('运行中 · '), 'Running session must display running status prefix with relative time');
  assert.ok(!list[1].description.includes('就绪'), 'Idle session must remain quiet and display only relative time without 就绪');
  assert.ok(list[2].description.startsWith('异常 · '), 'Error session must display error status prefix with relative time');
  assert.ok(list[3].description.startsWith('会话已离线 · '), 'Offline session must display offline status prefix with relative time');
});

test('Peer Session Reference: Drill header, root switching, and workspace header', () => {
  const { plugin } = loadClientInSandbox();
  const { getRegisteredSource } = setupMockContext(plugin);
  const src = getRegisteredSource();

  // 未下钻时返回 undefined
  assert.equal(src.header({ sessionId: 'session-curr' }, { query: '', drilled: false }), undefined);
  assert.equal(src.header({ sessionId: 'session-curr' }, null), undefined);

  // 已下钻时返回二级下钻标题
  const header = src.header({ sessionId: 'session-curr' }, { query: CURRENT_WS, drilled: true });
  assert.ok(Array.isArray(header));
  assert.equal(header.length, 2);

  // 根条目
  assert.equal(header[0].label, '工作区根目录');
  const rootVal = JSON.parse(header[0].value);
  assert.equal(rootVal.kind, 'workspace-root');

  // 当前工作区条目
  assert.equal(header[1].label, 'dsh-call-session');
  assert.equal(header[1].current, true);
  const wsVal = JSON.parse(header[1].value);
  assert.equal(wsVal.kind, 'workspace');
  assert.equal(wsVal.path, CURRENT_WS);

  // 验证搜索词输入时下钻标题名称不被过滤词污染
  const headerWithQuery = src.header({ sessionId: 'session-curr' }, { query: CURRENT_WS + ' 过滤关键词', drilled: true });
  assert.ok(Array.isArray(headerWithQuery));
  assert.equal(headerWithQuery[1].label, 'dsh-call-session', 'Drill header must remain the workspace name without query filter text');

  // 点击或回车选定工作区：无论 action 为 pick 还是 drill 均触发下钻
  const clickPick = src.onPick({
    action: 'pick',
    candidate: header[1]
  });
  assert.equal(clickPick.text, '@' + CURRENT_WS);
  assert.equal(clickPick.continue, true);

  // 点击下钻标题根条目：返回 @ 且 continue: true 切回一级工作区列表
  const rootPick = src.onPick({
    action: 'drill',
    candidate: header[0]
  });
  assert.equal(rootPick.text, '@');
  assert.equal(rootPick.continue, true);
});

test('Peer Session Reference: Session selection, pure slice reference URI, and codec contract', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, updatedAt: 9999 },
    'session-target': { id: 'session-target', title: '核心协调器', cwd: CURRENT_WS, status: 'idle', updatedAt: 2000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const candidates = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];

  // 选定会话：返回 insert 引用
  const pickResult = src.onPick({
    action: 'pick',
    candidate: candidate
  });

  assert.ok(pickResult && pickResult.insert);
  assert.equal(pickResult.insert.source, 'peer-session');
  assert.equal(pickResult.insert.ref, 'dsh-session:session-target', 'URI must be canonical dsh-session: format');
  assert.equal(pickResult.insert.label, '核心协调器');
  assert.equal(pickResult.insert.appearance, 'session');
  assert.equal(pickResult.insert.clipboardText, '@核心协调器');

  // 无效动作或候选返回 undefined
  assert.equal(src.onPick(null), undefined);
  assert.equal(src.onPick({ action: 'unknown', candidate }), undefined);
  assert.equal(src.onPick({ action: 'pick', candidate: { value: 'invalid-json' } }), undefined);
});

test('Peer Session Reference: Zero cross-boundary and zero board orchestration invariant', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '发起方', cwd: CURRENT_WS, status: 'running', updatedAt: 5000 },
    'session-target': { id: 'session-target', title: '接收方', cwd: CURRENT_WS, status: 'idle', updatedAt: 4000 }
  };

  const { getRegisteredSource, mockCtx, recordedCalls, recordedPosts } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  // 模拟全流程用户交互：一级发现 -> 下钻 -> 检索 -> 选定 -> 返回
  // 1. 一级工作区发现
  const l1 = await src.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(l1.length, 1);

  // 2. 选择工作区下钻
  const drillPick = src.onPick({ action: 'drill', candidate: l1[0] });
  assert.ok(drillPick.continue);

  // 3. 读取下钻标题
  const header = src.header({ sessionId: 'session-curr' }, { query: CURRENT_WS, drilled: true });
  assert.equal(header.length, 2);

  // 4. 二级会话展开
  const l2 = await src.candidates({ sessionId: 'session-curr' }, { query: CURRENT_WS, drilled: true });
  assert.equal(l2.length, 1);

  // 5. 二级过滤检索
  const l2Filtered = await src.candidates({ sessionId: 'session-curr' }, { query: CURRENT_WS + ' 接收方', drilled: true });
  assert.equal(l2Filtered.length, 1);

  // 6. 选定会话并生成引用
  const sessionPick = src.onPick({ action: 'pick', candidate: l2Filtered[0] });
  assert.ok(sessionPick.insert);

  // 7. 点击下钻标题切回根目录
  const backPick = src.onPick({ action: 'drill', candidate: header[0] });
  assert.equal(backPick.text, '@');

  // 8. 编解码执行
  const ref = sessionPick.insert.ref;
  src.codec.clipboardText(ref);
  await src.codec.serialize(ref);

  // 不变式断言：全流程恒等于 0，绝不越界触发单播调度连线、调用派发或公共黑板写入
  const telemetry = mockCtx.get('callTelemetry');
  assert.equal(telemetry.activeCalls, 0, 'activeCalls must remain strictly 0 throughout peer reference workflow');
  assert.equal(telemetry.calls.length, 0, 'Zero call telemetry records created');
  assert.equal(recordedCalls.length, 0, 'Zero dispatched calls recorded');

  const board = mockCtx.get('boardStore');
  assert.equal(board.executeList().posts.length, 0, 'Zero blackboard posts created');
  assert.equal(recordedPosts.length, 0, 'Zero blackboard mutations executed');
});

test('Peer Session Reference: English locale end-to-end symmetry across discovery and drill', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', cwd: CURRENT_WS, status: 'running', updatedAt: 5000 },
    'session-sub': { id: 'session-sub', title: 'Sub Task', cwd: CURRENT_WS, status: 'running', updatedAt: 4000 },
    'session-idle': { id: 'session-idle', title: 'Worker', cwd: CURRENT_WS, status: 'idle', updatedAt: 3000 },
    'session-err': { id: 'session-err', title: 'Failed Job', cwd: CURRENT_WS, status: 'error', updatedAt: 2000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById, locale: 'en' });
  const src = getRegisteredSource();

  // 一级菜单英文词条断言
  const l1 = await src.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(l1[0].section, 'Workspaces', 'Level 1 section must be Workspaces in English');
  assert.equal(l1[0].description, 'Current', 'Current workspace description must be Current in English');

  // 下钻标题英文词条断言
  const header = src.header({ sessionId: 'session-curr' }, { query: CURRENT_WS, drilled: true });
  assert.equal(header[0].label, 'Workspace Root', 'Root entry must be Workspace Root in English');

  // 二级会话列表英文三态描述断言
  const l2 = await src.candidates({ sessionId: 'session-curr' }, { query: CURRENT_WS, drilled: true });
  assert.ok(l2[0].description.startsWith('Running'), 'English session description must start with Running');
  assert.ok(!l2[1].description.includes('Idle'), 'Idle session in English must display only relative time without Idle');
  assert.ok(l2[2].description.startsWith('Error'), 'Error session in English must start with Error');
});

test('Peer Session Reference: Node VM sandbox resilience and boundary condition robustness', async () => {
  const { plugin } = loadClientInSandbox();

  // 1. 当 inputTriggers 服务缺失时安全忽略不报错
  const noTriggersCtx = setupMockContext(plugin, { hasInputTriggers: false });
  assert.equal(noTriggersCtx.getRegisteredSource(), null);

  // 2. 当 sessions 服务缺失时安全返回空数组
  const noSessionsCtx = setupMockContext(plugin, { hasSessionsService: false });
  const srcNoSessions = noSessionsCtx.getRegisteredSource();
  const c1 = await srcNoSessions.candidates({ sessionId: 's1' }, { drilled: false });
  assert.equal(c1.length, 0);
  const c2 = await srcNoSessions.candidates({ sessionId: 's1' }, { drilled: true, query: CURRENT_WS });
  assert.equal(c2.length, 0);

  // 3. 当 sessionsSnapshot 为空时安全返回空数组
  const emptyCtx = setupMockContext(plugin, { sessionsById: {} });
  const srcEmpty = emptyCtx.getRegisteredSource();
  const c3 = await srcEmpty.candidates({ sessionId: 's1' }, { drilled: false });
  assert.equal(c3.length, 0);

  // 4. 畸变会话对象容错
  const malformedSessions = {
    'valid-curr': { id: 'valid-curr', cwd: CURRENT_WS, updatedAt: 1000 },
    'null-session': null,
    'missing-fields': { id: 'missing-fields' },
    'negative-time': { id: 'negative-time', title: '异常时间', cwd: CURRENT_WS, updatedAt: -100 },
    'win-path': { id: 'win-path', title: 'Windows 会话', cwd: 'C:\\Users\\dev\\workspace', status: 'idle', updatedAt: 200 }
  };

  const { getRegisteredSource: getMalformedSource } = setupMockContext(plugin, { sessionsById: malformedSessions });
  const srcMalformed = getMalformedSource();

  const l1Malformed = await srcMalformed.candidates({ sessionId: 'valid-curr' }, { drilled: false });
  assert.ok(l1Malformed.length >= 2);
  const winWs = l1Malformed.find(w => w.name === 'workspace');
  assert.ok(winWs, 'Windows backslash path must extract workspace name correctly');

  const l2Malformed = await srcMalformed.candidates({ sessionId: 'valid-curr' }, { query: CURRENT_WS, drilled: true });
  assert.ok(l2Malformed.length >= 1);
});

test('Peer Session Reference: Level 2 keeps origin-only siblings and hides every subagent session', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '分析dsh 同级会话功能', cwd: CURRENT_WS, status: 'running', updatedAt: 99999 },
    // 真实子代理样本：根会话记录带 origin 与 parentSession，标记为子代理
    'sub-1': { id: 'sub-1', title: 'Spec axis re-review for HEAD vs main', cwd: CURRENT_WS, origin: 'subagent', parentSession: 'session-curr', updatedAt: 10000 },
    'sub-2': { id: 'sub-2', title: 'Standards axis re-review for HEAD vs main', cwd: CURRENT_WS, origin: 'subagent', parentSession: 'session-curr', updatedAt: 10000 },
    'sub-3': { id: 'sub-3', title: 'agent-teams:peer-session-mention:docs-auditor', cwd: CURRENT_WS, origin: 'subagent', parentSession: 'session-curr', updatedAt: 9000 },
    'sub-4': { id: 'sub-4', title: 'Implement Ticket 01: Peer session discovery', cwd: CURRENT_WS, origin: 'subagent', parentSession: 'session-curr', updatedAt: 8000 },
    // 带 parentSession 字段但 origin 为空的会话：左侧列表照常显示，这里也必须显示
    'parented-root': { id: 'parented-root', title: '迁移遗留会话', cwd: CURRENT_WS, origin: null, parentSession: 'session-other', updatedAt: 15000 },
    // 真实同级协作根会话（无 parentSessionId，在 callTelemetry 中有协作记录）
    'peer-active-1': { id: 'peer-active-1', title: '优化README的 @ 功能展示...', cwd: CURRENT_WS, status: 'running', updatedAt: 50000 },
    'peer-active-2': { id: 'peer-active-2', title: '查找开发者社区技能', cwd: CURRENT_WS, status: 'idle', updatedAt: 40000 },
    // 真实同级普通根会话
    'peer-normal-1': { id: 'peer-normal-1', title: 'task_report回传提醒机制', cwd: CURRENT_WS, status: 'idle', updatedAt: 20000 }
  };

  const mockCalls = [
    { callerSessionId: 'session-curr', targetSessionId: 'peer-active-1' },
    { callerSessionId: 'peer-active-2', targetSessionId: 'session-curr' }
  ];

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    initialActiveCalls: 1,
    recordedCalls: mockCalls
  });
  const src = getRegisteredSource();

  const list = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );

  // 1. 严格断言所有子代理任务已被 100% 过滤
  assert.ok(!list.some(item => item.label.includes('Spec axis')), 'Spec axis subagent must be filtered out');
  assert.ok(!list.some(item => item.label.includes('Standards axis')), 'Standards axis subagent must be filtered out');
  assert.ok(!list.some(item => item.label.includes('agent-teams:')), 'agent-teams task must be filtered out');
  assert.ok(!list.some(item => item.label.includes('Implement Ticket')), 'Implement ticket subagent must be filtered out');

  // 2. 严格断言同级会话数量：三个根会话加一个带 parentSession 但 origin 为空的会话
  assert.equal(list.length, 4, 'Must contain the three root peers plus the parented non-subagent session');
  assert.ok(list.some(item => item.label === '迁移遗留会话'), 'Session with a parent but no subagent origin stays visible');

  // 3. 严格断言排序：纯按更新时间倒序，与左侧原生列表一致
  assert.equal(list[0].label, '优化README的 @ 功能展示...', 'First must be the newest session');
  assert.equal(list[1].label, '查找开发者社区技能', 'Second must follow by update time');
  assert.equal(list[2].label, 'task_report回传提醒机制', 'Third must follow by update time');
  assert.equal(list[3].label, '迁移遗留会话', 'Oldest visible session must rank last');
});

test('Peer Session Reference: Source registration keeps order and name', async () => {
  const { plugin } = loadClientInSandbox();

  let registeredSource = null;
  const mockCtx = {
    effect: (fn) => fn(),
    locale: {
      register: () => {},
      bind: () => (key) => plugin.zh[key] || key
    },
    slots: {
      inject: () => {},
      register: () => {}
    },
    get: (serviceName) => {
      if (serviceName === 'inputTriggers') {
        return {
          registerSource: (src) => {
            registeredSource = src;
            return () => {};
          }
        };
      }
      return null;
    }
  };

  plugin.apply(mockCtx);

  assert.ok(registeredSource);
  assert.equal(registeredSource.order, -10, 'Priority order must be -10 to place peer sessions at the top');
  assert.equal(registeredSource.name, 'peer-session');
});

test('Peer Session Reference: archived roster read degrades to snapshot-field filtering when the workspaces service is missing (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-flagged': { id: 'session-flagged', title: '标记归档任务', cwd: CURRENT_WS, archived: true, status: 'archived', updatedAt: 6000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const level2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  assert.equal(level2.length, 1, 'Missing workspaces service must not block Level 2 candidates');
  assert.equal(level2[0].label, '存活任务', 'Snapshot-field archived exclusion must keep working without the service');

  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );
  assert.equal(level1.length, 1, 'Missing workspaces service must not block Level 1 candidates');
  assert.equal(level1[0].name, 'dsh-call-session');
});

test('Peer Session Reference: archived roster read failure keeps candidates flowing (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-flagged': { id: 'session-flagged', title: '标记归档任务', cwd: CURRENT_WS, archived: true, status: 'archived', updatedAt: 6000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesListThrows: true
  });
  const src = getRegisteredSource();

  const level2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  assert.equal(level2.length, 1, 'Throwing workspaces list snapshot must not block Level 2 candidates');
  assert.equal(level2[0].label, '存活任务', 'Read failure must degrade to snapshot-field filtering');

  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );
  assert.equal(level1.length, 1, 'Throwing workspaces list snapshot must not block Level 1 candidates');
});

test('Peer Session Reference: snapshot without archivedSessionIds degrades to baseline identical to missing service (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-flagged': { id: 'session-flagged', title: '标记归档任务', cwd: CURRENT_WS, archived: true, status: 'archived', updatedAt: 6000 }
  };

  // 基线：无 workspaces 服务
  const baseline = setupMockContext(plugin, { sessionsById });
  const baselineSrc = baseline.getRegisteredSource();
  const baselineLevel2 = await baselineSrc.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  const baselineLevel1 = await baselineSrc.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );

  // 服务在而快照缺 archivedSessionIds 字段：名单视为空，字段判定照常，输出与基线一致
  const degraded = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesList: {}
  });
  const degradedSrc = degraded.getRegisteredSource();
  const degradedLevel2 = await degradedSrc.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  const degradedLevel1 = await degradedSrc.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );

  assert.deepEqual(
    degradedLevel2.map((item) => [item.label, item.name]),
    baselineLevel2.map((item) => [item.label, item.name]),
    'Snapshot without the roster field must produce Level 2 candidates identical to the missing-service baseline'
  );
  assert.equal(degradedLevel2.length, 1, 'Field-flagged archived exclusion must keep working without the roster field');
  assert.equal(degradedLevel2[0].label, '存活任务');

  assert.deepEqual(
    degradedLevel1.map((item) => [item.label, item.name]),
    baselineLevel1.map((item) => [item.label, item.name]),
    'Snapshot without the roster field must produce Level 1 candidates identical to the missing-service baseline'
  );
  assert.equal(degradedLevel1[0].name, 'dsh-call-session');
});

test('Peer Session Reference: level 2 excludes rostered sessions even without snapshot archived markers (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  // 快照无任何归档标记：真实数据源仅存在于原生 workspaces 名单 (ADR-0034 归档排除不变量)
  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-rostered': { id: 'session-rostered', title: '名单归档任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 6000 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesList: { items: [], pinnedSessionIds: [], archivedSessionIds: ['session-rostered'] }
  });
  const src = getRegisteredSource();

  const level2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  assert.equal(level2.length, 1, 'Level 2 must exclude the rostered session from candidates');
  assert.equal(level2[0].label, '存活任务');

  // 名单过滤同时约束一级汇聚：工作区在仍有存活会话时照常输出 (ADR-0034 工作区收敛不变量)
  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );
  assert.equal(level1.length, 1, 'Level 1 keeps the workspace while it still has live sessions');
});

test('Peer Session Reference: level 2 excludes both rostered and snapshot-flagged archived sessions (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-flagged': { id: 'session-flagged', title: '标记归档任务', cwd: CURRENT_WS, archived: true, status: 'archived', updatedAt: 6000 },
    'session-rostered': { id: 'session-rostered', title: '名单归档任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 6500 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesList: { items: [], pinnedSessionIds: [], archivedSessionIds: ['session-rostered'] }
  });
  const src = getRegisteredSource();

  const level2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  assert.equal(level2.length, 1, 'Rostered and snapshot-flagged archived sessions must both be excluded');
  assert.equal(level2[0].label, '存活任务');
});

test('Peer Session Reference: level 2 without workspaces service keeps rostered sessions visible as current behavior (ADR-0034 archived exclusion)', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-live': { id: 'session-live', title: '存活任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 5000 },
    'session-rostered': { id: 'session-rostered', title: '名单归档任务', cwd: CURRENT_WS, status: 'idle', updatedAt: 6000 }
  };

  // 服务缺失：名单为空，归档判定退化为现状字段，候选与既有行为一致
  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();

  const level2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: CURRENT_WS, drilled: true }
  );
  assert.equal(level2.length, 2, 'Degraded level 2 keeps the rostered session visible exactly like the pre-roster behavior');
  assert.ok(level2.some(item => item.label === '名单归档任务'));
  assert.ok(level2.some(item => item.label === '存活任务'));
});

test('Peer Session Reference: level 1 drops workspaces whose sessions are all rostered archived (ADR-0034 workspace convergence)', async () => {
  const { plugin } = loadClientInSandbox();

  const DEAD_WS = '/repos/infra/dsh-dead';
  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-cl-live': { id: 'session-cl-live', title: '集群存活任务', cwd: CLUSTER_WS, status: 'idle', updatedAt: 5000 },
    'session-dead-1': { id: 'session-dead-1', title: '死区任务一', cwd: DEAD_WS, status: 'idle', updatedAt: 6000 },
    'session-dead-2': { id: 'session-dead-2', title: '死区任务二', cwd: DEAD_WS, status: 'idle', updatedAt: 6500 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesList: { items: [], pinnedSessionIds: [], archivedSessionIds: ['session-dead-1', 'session-dead-2'] }
  });
  const src = getRegisteredSource();

  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );
  assert.equal(level1.length, 2, 'Level 1 must keep only workspaces with unarchived sessions');
  assert.ok(!level1.some(item => item.name === 'dsh-dead'), 'Workspace left with only rostered archived sessions must not appear at Level 1');

  const deadLevel2 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: DEAD_WS, drilled: true }
  );
  assert.equal(deadLevel2.length, 0, 'Drilling a dead workspace must yield zero rostered candidates');
});

test('Peer Session Reference: level 1 keeps workspaces with live sessions and preserves pinning and ordering (ADR-0034 workspace convergence)', async () => {
  const { plugin } = loadClientInSandbox();

  const MIXED_WS = '/repos/projects/dsh-mixed';
  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
    'session-cl-live': { id: 'session-cl-live', title: '集群存活任务', cwd: CLUSTER_WS, status: 'idle', updatedAt: 5000 },
    'session-mixed-live': { id: 'session-mixed-live', title: '混合区存活任务', cwd: MIXED_WS, status: 'idle', updatedAt: 4000 },
    'session-mixed-dead': { id: 'session-mixed-dead', title: '混合区名单任务', cwd: MIXED_WS, status: 'idle', updatedAt: 4500 }
  };

  const { getRegisteredSource } = setupMockContext(plugin, {
    sessionsById,
    hasWorkspacesService: true,
    workspacesList: { items: [], pinnedSessionIds: [], archivedSessionIds: ['session-mixed-dead'] }
  });
  const src = getRegisteredSource();

  const level1 = await src.candidates(
    { sessionId: 'session-curr' },
    { query: '', drilled: false }
  );
  assert.equal(level1.length, 3, 'Workspaces still owning unarchived sessions must keep appearing at Level 1');

  // 当前工作区置顶与既有路径字母序排序不受名单影响
  assert.equal(level1[0].name, 'dsh-call-session', 'Current workspace must stay pinned first');
  assert.equal(level1[1].name, 'dsh-agent-cluster', 'Path-alphabetical ordering must be preserved');
  assert.equal(level1[2].name, 'dsh-mixed', 'Mixed workspace stays visible through its live session');
  assert.equal(JSON.parse(level1[2].value).isCurrent, false, 'Non-current workspaces must stay unflagged');
});

test('Peer Session Reference: section copy is plain and bilingual symmetric (ADR-0034 bilingual localization)', async () => {
  const { plugin } = loadClientInSandbox();

  assert.equal(plugin.zh['section.workspaces'], '工作区');
  assert.equal(plugin.en['section.workspaces'], 'Workspaces');

  // 双语对称：同一词典键在中英两侧都存在且非空
  assert.ok(plugin.zh['section.workspaces'].length > 0);
  assert.ok(plugin.en['section.workspaces'].length > 0);

  // 一级候选实际携带该区块文案
  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '当前会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 }
  };
  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();
  const level1 = await src.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(level1[0].section, '工作区');
});

test('Peer Session Reference: Native @ candidates drop every subagent and follow update-time order', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionRow = (id, label) => ({
    name: label,
    section: 'conversation',
    value: JSON.stringify({
      kind: 'session',
      label,
      mention: `@[${label}](dsh-session:${Buffer.from(JSON.stringify(id), 'utf8').toString('base64url')})`
    })
  });

  const sessionsById = {
    cur: { id: 'cur', cwd: CURRENT_WS, title: 'current session', updatedAt: 20000 },
    peer: { id: 'peer', cwd: CURRENT_WS, title: 'peer session', updatedAt: 5000 },
    'foreign-child': { id: 'foreign-child', cwd: CURRENT_WS, title: 'Spec review', origin: 'subagent', parentId: 'other', updatedAt: 19000 },
    'own-child': { id: 'own-child', cwd: CURRENT_WS, title: 'own subagent', origin: 'subagent', parentId: 'cur', updatedAt: 18000 },
    'parented-peer': { id: 'parented-peer', cwd: CURRENT_WS, title: 'parented peer', origin: null, parentSessionId: 'other', updatedAt: 9000 },
    'archived-peer': { id: 'archived-peer', cwd: CURRENT_WS, title: 'archived peer', archived: true, updatedAt: 12000 },
    'rostered-peer': { id: 'rostered-peer', cwd: CURRENT_WS, title: 'rostered peer', updatedAt: 11000 }
  };

  const nativeRows = [
    sessionRow('foreign-child', 'Spec review'),
    sessionRow('peer', 'peer session'),
    sessionRow('own-child', 'own subagent'),
    sessionRow('parented-peer', 'parented peer'),
    sessionRow('archived-peer', 'archived peer'),
    sessionRow('rostered-peer', 'rostered peer'),
    sessionRow('unknown-snapshot-peer', 'unknown snapshot peer'),
    { name: 'session-list.ts', section: 'files', value: JSON.stringify({ kind: 'file', path: 'session-list.ts' }) },
    { name: 'malformed-row', value: 'not-json' }
  ];

  let nativeCalls = 0;
  const nativeSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    candidates: async () => {
      nativeCalls += 1;
      return nativeRows.map((row) => ({ ...row }));
    }
  };

  const originalCandidates = nativeSource.candidates;
  const live = { sources: [nativeSource] };
  let registeredSource = null;
  const inputTriggers = {
    live,
    registerSource: (src) => {
      registeredSource = src;
      live.sources.push(src);
      return () => {};
    }
  };

  let disposePlugin = null;
  const mockCtx = {
    effect: (fn) => {
      const disposer = fn();
      if (typeof disposer === 'function') disposePlugin = disposer;
    },
    locale: {
      register: () => {},
      bind: () => (key) => plugin.zh[key] || key
    },
    slots: {
      inject: () => {},
      register: () => {}
    },
    get: (serviceName) => {
      if (serviceName === 'inputTriggers') return inputTriggers;
      if (serviceName === 'sessions') {
        return { list: { getSnapshot: () => ({ byId: sessionsById }) } };
      }
      if (serviceName === 'workspaces') {
        return { list: { getSnapshot: () => ({ archivedSessionIds: ['rostered-peer'] }) } };
      }
      return null;
    }
  };

  plugin.apply(mockCtx);

  assert.notEqual(nativeSource.candidates, originalCandidates, 'Only the host candidates function is expected to be replaced');
  assert.equal(nativeSource.trigger, '@', 'Host trigger identity must stay untouched');
  assert.equal(nativeSource.name, 'reference', 'Host source name must stay untouched');
  assert.equal(nativeSource.showGroupTitle, false, 'Host display flag must stay untouched');

  const filtered = await nativeSource.candidates({ sessionId: 'cur' }, { query: '', quoted: false, drilled: false });
  assert.deepEqual(
    Array.from(filtered, (item) => item.name),
    ['parented peer', 'peer session', 'unknown snapshot peer', 'session-list.ts', 'malformed-row'],
    'Every subagent row disappears, archived rows disappear, remaining session rows follow update time descending, unknown session rows keep original slot, file and malformed rows keep their slots'
  );
  assert.ok(!filtered.some((item) => item.name === 'Spec review' || item.name === 'own subagent'), 'No subagent row may survive, including this session own children');
  assert.ok(!filtered.some((item) => item.name === 'archived peer' || item.name === 'rostered peer'), 'No archived or rostered dead session row may survive');
  assert.equal(nativeCalls, 1, 'Native candidates must be invoked exactly once per fetch');

  await registeredSource.candidates({ sessionId: 'cur' }, { query: '', drilled: false });
  await nativeSource.candidates({ sessionId: 'cur' }, { query: '', drilled: false });
  assert.equal(nativeCalls, 2, 'Repeated installs must not stack wrappers');

  assert.ok(typeof disposePlugin === 'function', 'Activation must return a disposer');
  disposePlugin();
  assert.equal(nativeSource.candidates, originalCandidates, 'Disposing the plugin must hand the host implementation back');
});
