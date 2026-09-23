import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientBundle } from './helpers/canvas-harness.mjs';

const plugin = loadClientBundle();
const {
  computeViewportFraming,
  VIEWPORT_FRAMING,
  CANVAS_FALLBACK_BOUNDS
} = plugin;

test('视口取景常量与默认边界规范导出契约', () => {
  assert.equal(typeof computeViewportFraming, 'function', '必须导出 computeViewportFraming 纯函数');
  assert.ok(VIEWPORT_FRAMING && typeof VIEWPORT_FRAMING === 'object', '必须导出 VIEWPORT_FRAMING 常量');
  assert.equal(VIEWPORT_FRAMING.PADDING, 48, '双向边距必须为 48px');
  assert.equal(VIEWPORT_FRAMING.TOP_MARGIN, 24, '顶部安全间距必须为 24px');
  assert.equal(VIEWPORT_FRAMING.BOTTOM_MARGIN, 24, '底部安全间距必须为 24px');
  assert.equal(VIEWPORT_FRAMING.MACRO_MIN_ZOOM, 0.30, '宏观最小缩放必须为 0.30');
  assert.equal(VIEWPORT_FRAMING.MACRO_MAX_ZOOM, 1.20, '宏观最大缩放必须为 1.20');
  assert.equal(VIEWPORT_FRAMING.LOCATE_MIN_ZOOM, 0.80, '定位最小缩放必须为 0.80');
  assert.equal(VIEWPORT_FRAMING.LOCATE_MAX_ZOOM, 1.20, '定位最大缩放必须为 1.20');

  assert.ok(CANVAS_FALLBACK_BOUNDS && typeof CANVAS_FALLBACK_BOUNDS === 'object', '必须导出 CANVAS_FALLBACK_BOUNDS');
  assert.equal(CANVAS_FALLBACK_BOUNDS.minX, 40);
  assert.equal(CANVAS_FALLBACK_BOUNDS.minY, 24);
});

test('宏观自适应取景 (macro)：双向 padding=48px 与 zoom [0.30, 1.20] 夹紧居中', () => {
  const vw = 1000;
  const vh = 600;

  // 1. 标准拓扑内容：完全适配并居中
  const normalBounds = { minX: 100, minY: 50, maxX: 600, maxY: 450 }; // w=500, h=400
  // 可用宽度: 1000 - 96 = 904; 可用高度: 600 - 96 = 504
  // scaleX = 904 / 500 = 1.808; scaleY = 504 / 400 = 1.26 => min(1.808, 1.26) = 1.26 => clamped to 1.20
  const resultNormal = computeViewportFraming({
    mode: 'macro',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: normalBounds
  });
  assert.equal(resultNormal.zoom, 1.20, '未超出时缩放上限必须钳位在 1.20');
  // 居中公式: panX = (vw - contentW * zoom) / 2 - minX * zoom
  const expectedPanX = (vw - 500 * 1.2) / 2 - 100 * 1.2;
  const expectedPanY = (vh - 400 * 1.2) / 2 - 50 * 1.2;
  assert.equal(resultNormal.panX, expectedPanX, '水平方向必须数学居中');
  assert.equal(resultNormal.panY, expectedPanY, '垂直方向必须数学居中');

  // 2. 超大宽幅多列拓扑：zoom 钳位在下限 0.30
  const hugeBounds = { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
  const resultHuge = computeViewportFraming({
    mode: 'macro',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: hugeBounds
  });
  assert.equal(resultHuge.zoom, 0.30, '超大拓扑缩放必须钳位在下限 0.30');
  assert.equal(resultHuge.panX, (vw - 4000 * 0.30) / 2);
  assert.equal(resultHuge.panY, (vh - 3000 * 0.30) / 2);

  // 3. 兜底边界与缺失参数防御
  const fallbackResult = computeViewportFraming();
  assert.ok(fallbackResult.zoom >= 0.30 && fallbackResult.zoom <= 1.20);
  assert.ok(Number.isFinite(fallbackResult.panX));
  assert.ok(Number.isFinite(fallbackResult.panY));
});

test('定位取景 (locate)：视距双向夹紧至 [0.80, 1.20]，严禁粗暴重置', () => {
  const vw = 1200;
  const vh = 800;
  const bounds = { minX: 100, minY: 50, maxX: 900, maxY: 650 };
  const anchor = { x: 500, y: 350 };

  // 1. 过小当前视距 (0.4) 夹紧至 0.80
  const rSmall = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds,
    anchor,
    currentZoom: 0.4
  });
  assert.equal(rSmall.zoom, 0.80, '低于 0.80 的当前视距必须平滑夹紧至 0.80，禁止重置');

  // 2. 过大当前视距 (2.5) 夹紧至 1.20
  const rLarge = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds,
    anchor,
    currentZoom: 2.5
  });
  assert.equal(rLarge.zoom, 1.20, '高于 1.20 的当前视距必须平滑夹紧至 1.20，禁止重置');

  // 3. 适中视距 (1.05) 完美继承
  const rNormal = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds,
    anchor,
    currentZoom: 1.05
  });
  assert.equal(rNormal.zoom, 1.05, '在区间内视距保持原样继承');

  // 4. 无效视距 (undefined / NaN / <=0) 兜底为 1.0
  const rDefault = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds,
    anchor
  });
  assert.equal(rDefault.zoom, 1.0, '缺失当前视距时兜底为 1.0');
});

test('定位取景 (locate)：水平方向容纳时居中，超出时首列安全边距对齐', () => {
  const vh = 800;
  const anchor = { x: 200, y: 300 };

  // 1. 内容宽度 600px 能够完全容纳在视口 1000px 内 (zoom=1.0)
  const fitBounds = { minX: 100, minY: 50, maxX: 700, maxY: 500 };
  const rFit = computeViewportFraming({
    mode: 'locate',
    viewportWidth: 1000,
    viewportHeight: vh,
    bounds: fitBounds,
    anchor,
    currentZoom: 1.0
  });
  const expectedCenterPanX = (1000 - 600 * 1.0) / 2 - 100 * 1.0;
  assert.equal(rFit.panX, expectedCenterPanX, '内容能容纳于视口时水平整体居中');

  // 2. 内容宽度 1500px 超出视口 1000px 内 (zoom=1.0)
  const overflowBounds = { minX: 100, minY: 50, maxX: 1600, maxY: 500 };
  const rOverflow = computeViewportFraming({
    mode: 'locate',
    viewportWidth: 1000,
    viewportHeight: vh,
    bounds: overflowBounds,
    anchor,
    currentZoom: 1.0
  });
  // 必须对齐左侧安全边距 padding=48px
  const expectedPaddingPanX = 48 - 100 * 1.0;
  assert.equal(rOverflow.panX, expectedPaddingPanX, '超出时首列左边缘必须对齐 48px 安全边距');
});

test('定位取景 (locate)：垂直边界约束——基线居中、上下双向夹紧与黑板优先保护', () => {
  const vw = 1000;
  const vh = 800;

  // 1. 垂直高度能完全容纳：在 [TOP_MARGIN=24, BOTTOM_MARGIN=24] 间双向夹紧
  // contentH = 300 * 1.0 = 300 <= 800 - 48 = 752 (容纳)
  const fitBounds = { minX: 100, minY: 50, maxX: 600, maxY: 350 };
  // 锚点靠中：anchor.y = 200 => centeredPanY = 400 - 200 = 200
  // topBoundPanY = 24 - 50 = -26; bottomBoundPanY = 800 - 24 - 350 = 426
  // centeredPanY=200 落在 [-26, 426] 之间 => panY = 200
  const rFitMiddle = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: fitBounds,
    anchor: { x: 200, y: 200 },
    currentZoom: 1.0
  });
  assert.equal(rFitMiddle.panY, 200, '中间锚点居中无需夹紧');

  // 锚点极靠上：anchor.y = 50 (顶部节点) => centeredPanY = 400 - 50 = 350
  // topBoundPanY = 24 - 50 = -26; panY 不得小于 topBoundPanY
  // 若锚点极低导致内容顶部被顶出屏幕下方... 见下：
  // 锚点极高 (y=0): centeredPanY = 400; topBoundPanY = -26; bottomBoundPanY = 426
  // 假若 minY = 400, maxY = 700: topBoundPanY = 24 - 400 = -376; bottomBoundPanY = 776 - 700 = 76
  const lowBounds = { minX: 100, minY: 400, maxX: 600, maxY: 700 };
  const rClampTop = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: lowBounds,
    anchor: { x: 200, y: 700 }, // centeredPanY = 400 - 700 = -300
    currentZoom: 1.0
  });
  // topBound = 24 - 400 = -376, bottomBound = 76. centeredPanY=-300 介于 -376 与 76 之间
  assert.equal(rClampTop.panY, -300);

  // 2. 超长列垂直高度超出视口 (contentH = 1200 > 752)
  const tallBounds = { minX: 100, minY: 50, maxX: 600, maxY: 1250 };

  // 2.1 目标靠近顶部会话 (y=150)：此时优先抬升保留顶部黑板 (topBoundPanY = 24 - 50 = -26)
  // centeredPanY = 400 - 150 = 250
  // topBoundPanY = -26. topAnchoredPanY = max(250, -26) = 250
  // anchorScreenY = 150 + 250 = 400，在 [24, 776] 内 => 保持 250
  const rTallTop = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: tallBounds,
    anchor: { x: 200, y: 150 },
    currentZoom: 1.0
  });
  assert.equal(rTallTop.panY, 250);

  // 2.2 目标处于很深的底部节点 (y=1100)
  // centeredPanY = 400 - 1100 = -700
  // 若抬升至 topBoundPanY = -26: anchorScreenY = 1100 - 26 = 1074 > 776 (节点被推出屏幕外！)
  // 算法必须优先保障目标节点可见性，退回 centeredPanY (-700)！
  const rTallDeep = computeViewportFraming({
    mode: 'locate',
    viewportWidth: vw,
    viewportHeight: vh,
    bounds: tallBounds,
    anchor: { x: 200, y: 1100 },
    currentZoom: 1.0
  });
  assert.equal(rTallDeep.panY, -700, '目标节点过深时必须确保目标可见性，不能盲目抬升黑板');
  const screenY = 1100 * 1.0 + rTallDeep.panY;
  assert.equal(screenY, 400, '目标节点屏幕坐标必须稳定居中在 400px');
});

test('纯数学纯函数无副作用契约：不可变性与幂等性', () => {
  const options = {
    mode: 'macro',
    viewportWidth: 1000,
    viewportHeight: 600,
    bounds: { minX: 100, minY: 50, maxX: 600, maxY: 450 }
  };
  const snapshotBefore = JSON.stringify(options);

  const res1 = computeViewportFraming(options);
  const res2 = computeViewportFraming(options);

  // 幂等性
  assert.deepEqual(res1, res2, '相同输入多次调用结果必须完全一致');

  // 不可变性
  assert.equal(JSON.stringify(options), snapshotBefore, '输入 options 严禁被内部修改');
});
