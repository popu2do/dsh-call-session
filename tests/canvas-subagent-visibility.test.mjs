/**
 * Issue #11：看板默认隐藏子会话。
 *
 * 宿主已在看板数据里给出 isTopLevel 单一真实源，此处只验证消费端：隐藏的会话
 * 不进入几何与计数，端点为隐藏会话的调用连线与黑板归属线一并消失，既有几何
 * 不变量不受影响。
 *
 * 夹具刻意保留宿主收窄后不会下发的形态（workspaces.sessionIds 含隐藏会话、
 * 调用记录带隐藏端点），用于覆盖客户端 §2.2.5 的防御性重过滤。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanvasRuntime,
  findVNodes,
  loadClientBundle,
  standardCanvasTelemetry
} from './helpers/canvas-harness.mjs';

const plugin = loadClientBundle();

/** 三个顶层会话，外加一个宿主标记为非顶层的子会话 */
function subagentTelemetry(extra = {}) {
  const workspaces = [
    { id: '/ws/w0', name: 'w0', isCurrent: true, sessionIds: ['session-a', 'session-b', 'subagent-x'] },
    { id: '/ws/w1', name: 'w1', isCurrent: false, sessionIds: ['session-c'] }
  ];
  const sessions = [
    { id: 'session-a', workspace: '/ws/w0', title: 'Agent A', state: 'idle', isTopLevel: true },
    { id: 'session-b', workspace: '/ws/w0', title: 'Agent B', state: 'running', isTopLevel: true },
    { id: 'subagent-x', workspace: '/ws/w0', title: 'Worker X', state: 'running', isTopLevel: false },
    { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', state: 'idle', isTopLevel: true }
  ];
  return Object.assign({
    timestamp: Date.now(),
    currentWorkspace: '/ws/w0',
    workspaces,
    sessions,
    calls: [],
    posts: []
  }, extra);
}

function callRecord(overrides) {
  return Object.assign({
    callerWorkspace: '/ws/w0',
    callerTitle: 'Agent A',
    targetWorkspace: '/ws/w0',
    targetTitle: 'Agent B',
    callType: 'task_dispatch',
    status: 'active',
    timestamp: Date.now(),
    contextPostIds: []
  }, overrides);
}

function sessionLayer(runtime, view) {
  const layer = runtime.nodesLayerOf(view);
  assert.ok(layer, '看板必须渲染会话节点层');
  return layer;
}

function sessionNodeIds(runtime, view) {
  return sessionLayer(runtime, view).children
    .filter((child) => child && child.props && typeof child.props.id === 'string')
    .map((child) => child.props.id.replace('dsh-canvas-node-', ''));
}

function sessionTransform(runtime, view, sessionId) {
  const node = sessionLayer(runtime, view).children
    .find((child) => child && child.props && child.props.id === 'dsh-canvas-node-' + sessionId);
  return node ? node.props.transform : null;
}

function parseTransform(transform) {
  const match = /^translate\(([-\d.]+),\s*([-\d.]+)\)$/.exec(transform);
  assert.ok(match, '会话节点必须使用 translate(x, y) 定位，实际为 ' + transform);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** 顶栏徽标展示的数值 */
function badgeValueOf(view, className) {
  const badge = findVNodes(view, (n) => n && n.props && n.props.className === className)[0];
  assert.ok(badge, '顶栏必须渲染 ' + className + ' 徽标');
  return badge.children[badge.children.length - 1];
}

/** 指定边层渲染出的路径列表 */
function pathsOf(view, layerId) {
  const layer = findVNodes(view, (n) => n && n.props && n.props.id === layerId)[0];
  assert.ok(layer, '看板必须渲染 ' + layerId + ' 层');
  return findVNodes(layer, (n) => n.type === 'path');
}

test('看板可见性 1: isTopLevel 为 false 的会话不生成会话节点', () => {
  const runtime = createCanvasRuntime({ telemetry: subagentTelemetry() });
  const view = runtime.render('session-a');

  const ids = sessionNodeIds(runtime, view);
  assert.deepEqual(
    ids.slice().sort(),
    ['session-a', 'session-b', 'session-c'],
    '看板只能呈现顶层会话，实际节点为 ' + ids.join(', ')
  );
  assert.equal(sessionTransform(runtime, view, 'subagent-x'), null, '隐藏的会话不得以任何形式回流为会话节点');
});

test('看板可见性 2: isTopLevel 缺省视为顶层，节点数量与布局几何保持不变', () => {
  const telemetry = standardCanvasTelemetry();
  for (const session of telemetry.sessions) {
    assert.equal(session.isTopLevel, undefined, '缺省顶层语义的用例不得携带 isTopLevel 标记');
  }

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  const ids = sessionNodeIds(runtime, view);
  assert.deepEqual(ids.slice().sort(), ['session-a', 'session-b', 'session-c'], '缺省顶层标记时三个会话都必须呈现');

  const layout = plugin.computeLayout(telemetry.workspaces, telemetry.sessions, telemetry.posts, telemetry.currentWorkspace, undefined, telemetry.calls);
  for (const session of telemetry.sessions) {
    const expected = layout.nodePositions[session.id];
    assert.ok(expected, '布局引擎必须为顶层会话 ' + session.id + ' 产出坐标');
    assert.deepEqual(
      parseTransform(sessionTransform(runtime, view, session.id)),
      { x: expected.x, y: expected.y },
      '顶层会话 ' + session.id + ' 的节点坐标必须与布局引擎一致'
    );
  }
});

test('看板可见性 3: 顶栏会话计数只统计参与绘制的会话', () => {
  const runtime = createCanvasRuntime({ telemetry: subagentTelemetry() });
  const view = runtime.render('session-a');

  assert.equal(badgeValueOf(view, 'dsh-canvas-badge green'), '1', '运行中会话数必须排除隐藏的运行中子会话');
  assert.equal(badgeValueOf(view, 'dsh-canvas-badge'), '3', '会话总数必须排除隐藏的子会话');
});

test('看板可见性 4: 端点为隐藏会话的调用连线与黑板归属线不渲染', () => {
  const now = Date.now();
  const telemetry = subagentTelemetry({
    calls: [
      callRecord({
        id: 'call-hidden-active',
        callerSessionId: 'session-a',
        targetSessionId: 'subagent-x',
        targetTitle: 'Worker X',
        status: 'active'
      }),
      callRecord({
        id: 'call-hidden-settled',
        callerSessionId: 'subagent-x',
        callerTitle: 'Worker X',
        callerArchived: true,
        targetSessionId: 'session-a',
        callType: 'task_report',
        status: 'settled'
      }),
      callRecord({
        id: 'call-visible',
        callerSessionId: 'session-b',
        callerTitle: 'Agent B',
        targetSessionId: 'session-c',
        targetWorkspace: '/ws/w1',
        targetTitle: 'Agent C',
        callType: 'task_report'
      })
    ],
    posts: [
      { id: 'post-hidden', topic: 'worker', content: 'hidden author', status: 'active', authorSessionId: 'subagent-x', createdAt: now, ttlRemainingMs: 60000 },
      { id: 'post-visible', topic: 'main', content: 'visible author', status: 'active', authorSessionId: 'session-a', createdAt: now, ttlRemainingMs: 60000 }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  assert.deepEqual(
    sessionNodeIds(runtime, view).slice().sort(),
    ['session-a', 'session-b', 'session-c'],
    '隐藏端点不得凭在途或已落定调用记录补出离线虚拟节点'
  );
  assert.equal(pathsOf(view, 'dsh-canvas-call-edges').length, 2, '仅存活的可见调用应渲染两条路径（命中路径与描边路径）');

  const authorEdges = pathsOf(view, 'dsh-canvas-author-edges');
  assert.equal(authorEdges.length, 1, '隐藏会话发布的黑板条目不得渲染归属连线');
  assert.ok(authorEdges[0].props.d.startsWith('M '), '可见黑板归属线必须拥有有效路径');

  assert.equal(pathsOf(view, 'dsh-canvas-context-edges').length, 0, '无上下文引用时上下线层必须为空');
});

test('看板可见性 5: 隐藏非顶层会话后既有几何不变量仍然成立', () => {
  const telemetry = subagentTelemetry({
    calls: [
      callRecord({
        id: 'call-visible',
        callerSessionId: 'session-a',
        targetSessionId: 'session-c',
        targetWorkspace: '/ws/w1',
        targetTitle: 'Agent C'
      })
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  const ids = sessionNodeIds(runtime, view);
  const positions = ids.map((id) => parseTransform(sessionTransform(runtime, view, id)));

  const seen = new Set();
  for (const position of positions) {
    const key = position.x + ',' + position.y;
    assert.ok(!seen.has(key), '会话节点坐标严禁重叠，冲突坐标 ' + key);
    seen.add(key);
  }

  const columnX = parseTransform(sessionTransform(runtime, view, 'session-a')).x;
  const columnYs = ids
    .map((id) => parseTransform(sessionTransform(runtime, view, id)))
    .filter((position) => position.x === columnX)
    .map((position) => position.y);
  for (let i = 1; i < columnYs.length; i++) {
    assert.equal(columnYs[i] - columnYs[i - 1], 72, '同列会话节点必须保持 72px 步长且无空槽');
  }

  for (const path of pathsOf(view, 'dsh-canvas-call-edges')) {
    assert.ok(path.props.d.startsWith('M '), '调用连线必须落在已渲染端点之间，实际路径 ' + path.props.d);
  }
});

test('看板可见性 6: 只含隐藏会话的工作区不留下空列', () => {
  const telemetry = subagentTelemetry({
    workspaces: [
      { id: '/ws/w0', name: 'w0', isCurrent: true, sessionIds: ['session-a', 'session-b'] },
      { id: '/ws/w1', name: 'w1', isCurrent: false, sessionIds: ['session-c'] },
      { id: '/ws/w2', name: 'w2', isCurrent: false, sessionIds: ['subagent-y'] }
    ],
    sessions: [
      { id: 'session-a', workspace: '/ws/w0', title: 'Agent A', state: 'idle', isTopLevel: true },
      { id: 'session-b', workspace: '/ws/w0', title: 'Agent B', state: 'running', isTopLevel: true },
      { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', state: 'idle', isTopLevel: true },
      { id: 'subagent-y', workspace: '/ws/w2', title: 'Worker Y', state: 'running', isTopLevel: false }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  const workspaceGroupColumns = findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-workspace-group-columns')[0];
  assert.ok(workspaceGroupColumns, '看板必须渲染工作区分组列层');
  const columns = workspaceGroupColumns.children.filter((child) => child && child.props && child.props.transform);
  assert.equal(columns.length, 2, '只含隐藏会话的工作区不得占据分组列');
  assert.deepEqual(
    sessionNodeIds(runtime, view).slice().sort(),
    ['session-a', 'session-b', 'session-c'],
    '分组列收窄不得连带隐藏顶层会话'
  );
});

test('看板可见性 7: 当前会话自身非顶层时不回流也不误标当前', () => {
  const runtime = createCanvasRuntime({ telemetry: subagentTelemetry() });
  const view = runtime.render('subagent-x');

  assert.deepEqual(
    sessionNodeIds(runtime, view).slice().sort(),
    ['session-a', 'session-b', 'session-c'],
    '当前会话被隐藏时不得仅为它破例回流'
  );
  assert.equal(
    findVNodes(view, (n) => n && n.props && n.props.className === 'dsh-canvas-session-current-badge').length,
    0,
    '没有任何节点被绘制时不得出现当前会话标记'
  );
  assert.equal(
    findVNodes(view, (n) => n && n.props && n.props.className === 'dsh-canvas-session-current-tag').length,
    0,
    '没有任何节点被绘制时不得出现当前会话角标'
  );
});
test('看板可见性 8: 当前工作区只剩隐藏会话时不留空列也不误标当前', () => {
  const telemetry = subagentTelemetry({
    workspaces: [
      { id: '/ws/w0', name: 'w0', isCurrent: true, sessionIds: ['subagent-x'] },
      { id: '/ws/w1', name: 'w1', isCurrent: false, sessionIds: ['session-c'] }
    ],
    sessions: [
      { id: 'subagent-x', workspace: '/ws/w0', title: 'Worker X', state: 'running', isTopLevel: false },
      { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', state: 'idle', isTopLevel: true }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-c');

  const workspaceGroupColumns = findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-workspace-group-columns')[0];
  assert.ok(workspaceGroupColumns, '看板必须渲染工作区分组列层');
  const columns = workspaceGroupColumns.children.filter((child) => child && child.props && child.props.transform);
  assert.equal(columns.length, 1, '当前工作区已无绘制会话时不得保留零节点的空列');
  assert.deepEqual(sessionNodeIds(runtime, view), ['session-c'], '仅存的顶层会话必须落在保留的列内');

  const headerTexts = findVNodes(workspaceGroupColumns, (n) => n && n.type === 'text' && Array.isArray(n.children));
  assert.equal(
    headerTexts.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('当前'))),
    false,
    '没有列承载当前工作区时不得在任何列头标记 [当前]'
  );
});

test('看板可见性 9: 隐藏会话发布的黑板条目仍然渲染', () => {
  const now = Date.now();
  const telemetry = subagentTelemetry({
    posts: [
      { id: 'post-hidden', topic: 'worker-topic', content: 'hidden author post', status: 'active', authorSessionId: 'subagent-x', createdAt: now, ttlRemainingMs: 60000 }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  const blackboard = findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-blackboard-layer')[0];
  assert.ok(blackboard, '看板必须渲染公共黑板层');
  const texts = findVNodes(blackboard, (n) => n && n.type === 'text' && Array.isArray(n.children));
  assert.equal(
    texts.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('worker-topic'))),
    true,
    '隐藏作者的黑板条目属于全局信息，必须照常渲染'
  );
  assert.equal(pathsOf(view, 'dsh-canvas-author-edges').length, 0, '作者不在绘制集合时归属连线必须一并消失');
});
test('看板可见性 10: 当前会话被隐藏时不出「定位当前会话」按钮', () => {
  const runtime = createCanvasRuntime({ telemetry: subagentTelemetry() });
  const hiddenView = runtime.render('subagent-x');
  const hiddenButtons = findVNodes(hiddenView, (n) => n && n.type === 'button' && Array.isArray(n.children));
  assert.equal(
    hiddenButtons.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('定位当前会话'))),
    false,
    '没有可定位的节点时不得提供定位按钮'
  );

  const visibleView = runtime.render('session-a');
  const visibleButtons = findVNodes(visibleView, (n) => n && n.type === 'button' && Array.isArray(n.children));
  assert.equal(
    visibleButtons.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('定位当前会话'))),
    true,
    '当前会话仍在绘制集合时必须保留定位按钮'
  );
});

test('看板可见性 11: 归档端点只凭记录来源标记也不得回流为虚拟离线节点', () => {
  const now = Date.now();
  const telemetry = subagentTelemetry({
    sessions: [
      { id: 'session-a', workspace: '/ws/w0', title: 'Agent A', state: 'idle', isTopLevel: true },
      { id: 'session-b', workspace: '/ws/w0', title: 'Agent B', state: 'running', isTopLevel: true },
      { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', state: 'idle', isTopLevel: true }
    ],
    calls: [
      callRecord({
        callerSessionId: 'session-a',
        targetSessionId: 'subagent-x',
        targetTitle: 'Worker X',
        targetNonTopLevel: true,
        targetOffline: true,
        status: 'settled',
        timestamp: now
      })
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  assert.deepEqual(
    sessionNodeIds(runtime, view).slice().sort(),
    ['session-a', 'session-b', 'session-c'],
    '归档后只留记录来源标记的端点不得被布局补成虚拟节点'
  );
  assert.equal(pathsOf(view, 'dsh-canvas-call-edges').length, 0, '端点为隐藏来源的调用连线不得绘制');
});

test('看板可见性 12: 作者不在会话集合中的黑板条目仍渲染且不产生归属线', () => {
  const now = Date.now();
  const telemetry = subagentTelemetry({
    posts: [
      { id: 'post-absent', topic: 'ghost-topic', content: 'post from a roster-absent author', status: 'active', authorSessionId: 'session-ghost', createdAt: now, ttlRemainingMs: 60000 }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-a');

  const blackboard = findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-blackboard-layer')[0];
  const texts = findVNodes(blackboard, (n) => n && n.type === 'text' && Array.isArray(n.children));
  assert.equal(
    texts.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('ghost-topic'))),
    true,
    '宿主不会为 roster 外的作者合成会话，条目本身必须照常渲染'
  );
  assert.equal(pathsOf(view, 'dsh-canvas-author-edges').length, 0, '作者无端点时归属连线不得绘制');
});

test('看板可见性 13: 当前会话按短 id 匹配时仍提供定位按钮', () => {
  const runtime = createCanvasRuntime({ telemetry: subagentTelemetry() });
  const view = runtime.render('a');

  assert.deepEqual(sessionNodeIds(runtime, view).slice().sort(), ['session-a', 'session-b', 'session-c'], '短 id 不得改变绘制集合');
  const buttons = findVNodes(view, (n) => n && n.type === 'button' && Array.isArray(n.children));
  assert.equal(
    buttons.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('定位当前会话'))),
    true,
    '短 id 指向已绘制会话时必须保留定位按钮'
  );
});
test('看板可见性 14: 宿主下发的空当前列照旧渲染并标当前', () => {
  const telemetry = subagentTelemetry({
    workspaces: [
      { id: '/ws/w0', name: 'w0', isCurrent: true, sessionIds: [] },
      { id: '/ws/w1', name: 'w1', isCurrent: false, sessionIds: ['session-c'] }
    ],
    sessions: [
      { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', state: 'idle', isTopLevel: true }
    ]
  });

  const runtime = createCanvasRuntime({ telemetry });
  const view = runtime.render('session-c');

  const workspaceGroupColumns = findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-workspace-group-columns')[0];
  const columns = workspaceGroupColumns.children.filter((child) => child && child.props && child.props.transform);
  assert.equal(columns.length, 2, '收窄没有隐藏任何会话，宿主下发的空当前列必须保留');

  const headerTexts = findVNodes(workspaceGroupColumns, (n) => n && n.type === 'text' && Array.isArray(n.children));
  assert.equal(
    headerTexts.some((node) => node.children.some((text) => typeof text === 'string' && text.includes('当前'))),
    true,
    '保留的当前列必须仍标 [当前]'
  );
  assert.deepEqual(sessionNodeIds(runtime, view), ['session-c'], '空列不得凭空生成节点');
});