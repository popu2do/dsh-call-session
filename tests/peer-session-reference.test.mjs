import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

import { loadClientBundle, loadClientInSandbox } from './helpers/canvas-harness.mjs';

const CURRENT_WS = '/repos/TSPR/dsh-call-session';
const CLUSTER_WS = '/repos/infra/dsh-agent-cluster';
const GATEWAY_WS = '/repos/infra/dsh-gateway';
const SPACE_WS = '/repos/projects/project with spaces';

function setupMockContext(plugin, options = {}) {
  const {
    sessionsById = {},
    locale = 'zh',
    hasInputTriggers = true,
    hasSessionsService = true,
    initialActiveCalls = 0,
    hasWorkspacesService = false,
    workspacesList = null,
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
            getSnapshot: () => ({ byId: sessionsById })
          }
        };
      }
      if (serviceName === 'workspaces') {
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 5000 },
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
  assert.ok(level2Local.every(item => item.name !== '#curr0000' && !item.label.includes('主会话')));
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

test('Peer Session Reference: Prioritize call-session registered sessions then by recency (ADR-0034)', async () => {
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
  // 第一优先：call-session 注册过的已协作会话置顶（内部按更新时间倒序：4000 > 2000）
  assert.equal(list[0].label, '已协作新任务', 'call-session registered session with updatedAt 4000 must be first');
  assert.equal(list[1].label, '已协作旧任务', 'call-session registered session with updatedAt 2000 must be second');
  // 第二优先：未协作会话即使更新时间更新（8000），排在已协作会话之后
  assert.equal(list[2].label, '未协作新任务', 'Unregistered session must rank after registered sessions');
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

test('Peer Session Reference: Bug Repro - filter subagents with parentSessionId and review task titles', async () => {
  const { plugin } = loadClientInSandbox();

  const sessionsById = {
    'session-curr': { id: 'session-curr', title: '分析dsh 同级会话功能', cwd: CURRENT_WS, status: 'running', updatedAt: 99999 },
    // 真实子智能体样本（真实宿主中只有 parentSessionId，无 origin 或无子代理关键字）
    'sub-1': { id: 'sub-1', title: 'Spec axis re-review for HEAD vs main', cwd: CURRENT_WS, parentSessionId: 'session-curr', updatedAt: 10000 },
    'sub-2': { id: 'sub-2', title: 'Standards axis re-review for HEAD vs main', cwd: CURRENT_WS, parentSessionId: 'session-curr', updatedAt: 10000 },
    'sub-3': { id: 'sub-3', title: 'agent-teams:peer-session-mention:docs-auditor', cwd: CURRENT_WS, parentSessionId: 'session-curr', updatedAt: 9000 },
    'sub-4': { id: 'sub-4', title: 'Implement Ticket 01: Peer session discovery', cwd: CURRENT_WS, parentSessionId: 'session-curr', updatedAt: 8000 },
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

  // 2. 严格断言同级会话数量
  assert.equal(list.length, 3, 'Must only contain the 3 root peer sessions');

  // 3. 严格断言排序：call-session 协作会话排在第一优先，且组内按时间倒序
  assert.equal(list[0].label, '优化README的 @ 功能展示...', 'First must be active collaborator 1');
  assert.equal(list[1].label, '查找开发者社区技能', 'Second must be active collaborator 2');
  assert.equal(list[2].label, 'task_report回传提醒机制', 'Third must be ordinary peer session');
});

test('Peer Session Reference: Non-intrusive source registration and priority order without monkey-patching', async () => {
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 },
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
    'session-curr': { id: 'session-curr', title: '主会话', cwd: CURRENT_WS, status: 'running', updatedAt: 9000 }
  };
  const { getRegisteredSource } = setupMockContext(plugin, { sessionsById });
  const src = getRegisteredSource();
  const level1 = await src.candidates({ sessionId: 'session-curr' }, { query: '', drilled: false });
  assert.equal(level1[0].section, '工作区');
});
