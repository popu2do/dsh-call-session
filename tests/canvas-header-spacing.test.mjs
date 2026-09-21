import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientBundle } from './helpers/canvas-harness.mjs';

const HEADER_OFFSET_Y = 10;
const HEADER_HEIGHT = 38;
const NODE_RY = 26;
const STANDARD_HEADER_GAP = 16;
const SESSION_SLOT_HEIGHT = 72;
const DERIVED_OFFSET_FROM_WS_Y = HEADER_OFFSET_Y + HEADER_HEIGHT + STANDARD_HEADER_GAP + NODE_RY;

const plugin = loadClientBundle();
const { computeLayout } = plugin;

function computeHeaderGap(ws, node) {
  const headerBottom = ws.y + HEADER_OFFSET_Y + HEADER_HEIGHT;
  const nodeTop = node.y - NODE_RY;
  return {
    headerBottom,
    nodeTop,
    gap: nodeTop - headerBottom
  };
}

test('工作区头部与首个会话节点间距（头间距）：首个节点顶部必须在工作区头部矩形下方且留有正向净间距', () => {
  const workspaces = [{ id: '/ws/test', name: 'dsh-call-session', isCurrent: true }];
  const sessions = [
    { id: 's1', workspace: '/ws/test', title: '首个会话' },
    { id: 's2', workspace: '/ws/test', title: '第二个会话' }
  ];
  const layout = computeLayout(workspaces, sessions, [], '/ws/test', false);

  const ws = layout.workspaceBounds[0];
  const firstNode = layout.nodePositions['s1'];
  const { headerBottom, nodeTop, gap } = computeHeaderGap(ws, firstNode);

  assert.equal(
    gap,
    STANDARD_HEADER_GAP,
    `工作区头部底边 (${headerBottom}px) 与首个会话节点顶边 (${nodeTop}px) 必须保持标准 16px 留白，实际为 ${gap}px`
  );
  assert.equal(
    firstNode.y,
    ws.y + DERIVED_OFFSET_FROM_WS_Y,
    `首节点中心 Y 坐标必须严格从 ws.y 加上推导偏移 (${DERIVED_OFFSET_FROM_WS_Y}px) 得出，实际为 ${firstNode.y}px`
  );
});

test('多工作区拓扑：各工作区首个节点均严格遵循 16px 头间距不变量', () => {
  const workspaces = [
    { id: '/ws/alpha', name: 'Alpha', isCurrent: true },
    { id: '/ws/beta', name: 'Beta', isCurrent: false }
  ];
  const sessions = [
    { id: 's-alpha-1', workspace: '/ws/alpha', title: 'Alpha Node 1' },
    { id: 's-beta-1', workspace: '/ws/beta', title: 'Beta Node 1' }
  ];
  const layout = computeLayout(workspaces, sessions, [], '/ws/alpha', true);

  for (const ws of layout.workspaceBounds) {
    const wsSessions = sessions.filter(s => s.workspace === ws.id);
    if (!wsSessions.length) continue;
    const firstNode = layout.nodePositions[wsSessions[0].id];
    const { headerBottom, nodeTop, gap } = computeHeaderGap(ws, firstNode);

    assert.equal(
      gap,
      STANDARD_HEADER_GAP,
      `工作区 ${ws.name} 头部底边 (${headerBottom}px) 与首节点顶边 (${nodeTop}px) 间距必须为 16px，实际为 ${gap}px`
    );
  }
});

test('虚拟归档节点：仅有虚拟归档节点的列同样保持 16px 头间距不变量', () => {
  const workspaces = [{ id: '/ws/archived', name: 'Archived Only', isCurrent: true }];
  const calls = [
    {
      callerSessionId: 'virt-1',
      callerWorkspace: '/ws/archived',
      callerTitle: 'Virtual Session 1',
      callerArchived: true,
      targetSessionId: 'virt-2',
      targetWorkspace: '/ws/archived',
      targetTitle: 'Virtual Session 2',
      targetArchived: true,
      status: 'settled',
      contextPostIds: []
    }
  ];

  const layout = computeLayout(workspaces, [], [], '/ws/archived', false, calls);
  const ws = layout.workspaceBounds[0];
  const firstVirtualNode = layout.nodePositions['virt-1'];

  assert.ok(firstVirtualNode, '必须生成首个虚拟节点');
  const { headerBottom, nodeTop, gap } = computeHeaderGap(ws, firstVirtualNode);

  assert.equal(
    gap,
    STANDARD_HEADER_GAP,
    `虚拟节点工作区头部底边 (${headerBottom}px) 与首个虚拟节点顶边 (${nodeTop}px) 间距必须为 16px，实际为 ${gap}px`
  );
});

test('节点步进几何：列内会话节点必须按 72px 步长纵向依次排布且无重叠', () => {
  const workspaces = [{ id: '/ws/steps', name: 'Steps', isCurrent: true }];
  const sessions = [
    { id: 'step-1', workspace: '/ws/steps', title: 'Step 1' },
    { id: 'step-2', workspace: '/ws/steps', title: 'Step 2' },
    { id: 'step-3', workspace: '/ws/steps', title: 'Step 3' }
  ];
  const layout = computeLayout(workspaces, sessions, [], '/ws/steps', false);

  const n1 = layout.nodePositions['step-1'];
  const n2 = layout.nodePositions['step-2'];
  const n3 = layout.nodePositions['step-3'];

  assert.equal(n2.y - n1.y, SESSION_SLOT_HEIGHT, '首节点与次节点间距步长必须严格为 72px');
  assert.equal(n3.y - n2.y, SESSION_SLOT_HEIGHT, '次节点与第三节点间距步长必须严格为 72px');
});
