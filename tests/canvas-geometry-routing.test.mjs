import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientBundle } from './helpers/canvas-harness.mjs';

const plugin = loadClientBundle();
const {
  calculateBezierPath,
  getEllipseIntersection,
  computePostEdgeCoordinates,
  GUTTER_CONFIG
} = plugin;

/**
 * 解析标准 SVG M ... C ... 贝塞尔路径
 */
function parseBezierPath(d) {
  assert.ok(typeof d === 'string', '路径必须为字符串');
  assert.ok(d.startsWith('M '), '路径必须以 M 开头');
  const mMatch = d.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  if (!mMatch) {
    throw new Error('无法解析三次贝塞尔路径: ' + d);
  }
  return {
    startX: parseFloat(mMatch[1]),
    startY: parseFloat(mMatch[2]),
    c1x: parseFloat(mMatch[3]),
    c1y: parseFloat(mMatch[4]),
    c2x: parseFloat(mMatch[5]),
    c2y: parseFloat(mMatch[6]),
    endX: parseFloat(mMatch[7]),
    endY: parseFloat(mMatch[8])
  };
}

test('纯数学几何导出与配置契约完整性', () => {
  assert.equal(typeof calculateBezierPath, 'function', '必须导出 calculateBezierPath');
  assert.equal(typeof getEllipseIntersection, 'function', '必须导出 getEllipseIntersection');
  assert.equal(typeof computePostEdgeCoordinates, 'function', '必须导出 computePostEdgeCoordinates');
  assert.ok(GUTTER_CONFIG && typeof GUTTER_CONFIG === 'object', '必须导出 GUTTER_CONFIG 配置常量');
  assert.equal(GUTTER_CONFIG.NODE_RX, 96, '椭圆水平半轴必须为 96px');
  assert.equal(GUTTER_CONFIG.NODE_RY, 26, '椭圆垂直半轴必须为 26px');
  assert.equal(GUTTER_CONFIG.CHANNEL_MIN_OFFSET, 106, '同列走线通道内轨必须为 106px');
  assert.equal(GUTTER_CONFIG.CHANNEL_MAX_OFFSET, 126, '同列走线通道外轨必须为 126px');
  assert.equal(GUTTER_CONFIG.POST_OUTER_OFFSET, 130, '黑板专属通道起始必须为 130px');
});

test('椭圆外切交点计算 (getEllipseIntersection)：正交与斜向射线精确外切几何', () => {
  const cx = 200;
  const cy = 300;
  const a = 96;
  const b = 26;

  // 1. 正右方向射线 (dx > 0, dy = 0)
  const rightPt = getEllipseIntersection(cx, cy, cx + 150, cy, a, b);
  assert.equal(rightPt.x, cx + a, '正右射线外切交点 X 应为 cx + a');
  assert.equal(rightPt.y, cy, '正右射线外切交点 Y 应为 cy');

  // 2. 正左方向射线 (dx < 0, dy = 0)
  const leftPt = getEllipseIntersection(cx, cy, cx - 150, cy, a, b);
  assert.equal(leftPt.x, cx - a, '正左射线外切交点 X 应为 cx - a');
  assert.equal(leftPt.y, cy, '正左射线外切交点 Y 应为 cy');

  // 3. 正下方向射线 (dx = 0, dy > 0)
  const downPt = getEllipseIntersection(cx, cy, cx, cy + 100, a, b);
  assert.equal(downPt.x, cx, '正下射线外切交点 X 应为 cx');
  assert.equal(downPt.y, cy + b, '正下射线外切交点 Y 应为 cy + b');

  // 4. 正上方向射线 (dx = 0, dy < 0)
  const upPt = getEllipseIntersection(cx, cy, cx, cy - 100, a, b);
  assert.equal(upPt.x, cx, '正上射线外切交点 X 应为 cx');
  assert.equal(upPt.y, cy - b, '正上射线外切交点 Y 应为 cy - b');

  // 5. 斜向 45 度交点满足标准椭圆方程 (x-cx)^2 / a^2 + (y-cy)^2 / b^2 = 1
  const diagPt = getEllipseIntersection(cx, cy, cx + 100, cy + 100, a, b);
  const ellipseEquation = Math.pow((diagPt.x - cx) / a, 2) + Math.pow((diagPt.y - cy) / b, 2);
  assert.ok(Math.abs(ellipseEquation - 1.0) < 1e-6, `外切交点必须位于椭圆曲线上: ${ellipseEquation}`);

  // 6. 零向量与极小偏移退化保护
  const originPt = getEllipseIntersection(cx, cy, cx, cy, a, b);
  assert.equal(originPt.x, cx);
  assert.equal(originPt.y, cy);

  const tinyPt = getEllipseIntersection(cx, cy, cx + 0.00001, cy + 0.00001, a, b);
  assert.equal(tinyPt.x, cx);
  assert.equal(tinyPt.y, cy);
});

test('自环调用走线 (|dx|<2 && |dy|<2)：顶部对称出入，控制点完全高于卡片', () => {
  const cx = 250;
  const cy = 400;
  const path = calculateBezierPath(cx, cy, cx, cy, 0);
  const parsed = parseBezierPath(path);

  // 控制点严格位于卡片上方 (y - 75)
  assert.equal(parsed.c1x, cx - 50, '第一控制点 X 必须在左侧 50px');
  assert.equal(parsed.c1y, cy - 75, '第一控制点 Y 必须在上方 75px');
  assert.equal(parsed.c2x, cx + 50, '第二控制点 X 必须在右侧 50px');
  assert.equal(parsed.c2y, cy - 75, '第二控制点 Y 必须在上方 75px');

  // 起点与终点均在椭圆上半轮廓 (y < cy)
  assert.ok(parsed.startY < cy, '自环起点必须位于椭圆上半边缘');
  assert.ok(parsed.endY < cy, '自环终点必须位于椭圆上半边缘');
  assert.ok(parsed.startX < cx, '自环起点位于中心左侧');
  assert.ok(parsed.endX > cx, '自环终点位于中心右侧');
});

test('同列向下单播分流 (dy >= 0)：右出右进，零横切中轴与同心通道外扩', () => {
  const x = 170;
  const y1 = 240;
  const y2 = 312; // 1 跳 (72px)
  const y3 = 384; // 2 跳 (144px)
  const y4 = 456; // 3 跳 (216px)

  const hop1 = parseBezierPath(calculateBezierPath(x, y1, x, y2, 0));
  const hop2 = parseBezierPath(calculateBezierPath(x, y1, x, y3, 0));
  const hop3 = parseBezierPath(calculateBezierPath(x, y1, x, y4, 0));

  // 右出右进断言：起点与终点 X 严格大于中心轴
  assert.ok(hop1.startX > x, '下行起点位于右侧');
  assert.ok(hop1.endX > x, '下行终点位于右侧');
  assert.ok(hop1.c1x > x, '控制点1位于右侧通道');
  assert.ok(hop1.c2x > x, '控制点2位于右侧通道');

  // 通道区间 [106, 126]px 约束
  assert.ok(hop1.c1x >= x + 106 && hop1.c1x <= x + 126, `1跳控制点1在通道区间内: ${hop1.c1x}`);
  assert.ok(hop1.c2x >= x + 106 && hop1.c2x <= x + 126, `1跳控制点2在通道区间内: ${hop1.c2x}`);

  // 同心嵌套跳数自适应递增
  assert.ok(hop2.c1x > hop1.c1x, '2跳控制点外扩半径大于1跳');
  assert.ok(hop3.c1x > hop2.c1x, '3跳控制点外扩半径大于2跳');

  // 极限长跳数 (10跳) 钳位在 CHANNEL_MAX_OFFSET (126px)
  const extremeHop = parseBezierPath(calculateBezierPath(x, y1, x, y1 + 72 * 10, 1));
  assert.equal(extremeHop.c1x, x + 126, '极限跳数控制点1必须钳位在通道最大值 126px');
  assert.equal(extremeHop.c2x, x + 126, '极限跳数控制点2必须钳位在通道最大值 126px');
});

test('同列向上单播分流 (dy < 0)：左出左进，零横切中轴与同心通道外扩', () => {
  const x = 170;
  const y1 = 384;
  const y2 = 312; // 1 跳 (-72px)
  const y3 = 240; // 2 跳 (-144px)

  const hop1 = parseBezierPath(calculateBezierPath(x, y1, x, y2, 0));
  const hop2 = parseBezierPath(calculateBezierPath(x, y1, x, y3, 0));

  // 左出左进断言：起点与终点 X 严格小于中心轴
  assert.ok(hop1.startX < x, '上行起点位于左侧');
  assert.ok(hop1.endX < x, '上行终点位于左侧');
  assert.ok(hop1.c1x < x, '控制点1位于左侧通道');
  assert.ok(hop1.c2x < x, '控制点2位于左侧通道');

  // 通道区间 [106, 126]px 约束 (偏左: [x-126, x-106])
  assert.ok(hop1.c1x <= x - 106 && hop1.c1x >= x - 126, `1跳控制点1在左侧通道内: ${hop1.c1x}`);
  assert.ok(hop1.c2x <= x - 106 && hop1.c2x >= x - 126, `1跳控制点2在左侧通道内: ${hop1.c2x}`);

  // 同心嵌套跳数自适应递增 (向左进一步外扩)
  assert.ok(hop2.c1x < hop1.c1x, '2跳控制点更偏左');

  // 极限长跳数 (10跳) 钳位在 CHANNEL_MAX_OFFSET (126px)
  const extremeHop = parseBezierPath(calculateBezierPath(x, y1, x, y1 - 72 * 10, 1));
  assert.equal(extremeHop.c1x, x - 126, '极限跳数控制点1必须钳位在左侧通道最大外扩 126px');
  assert.equal(extremeHop.c2x, x - 126, '极限跳数控制点2必须钳位在左侧通道最大外扩 126px');
});

test('正向跨列走线 (dx > 0)：右出左进平滑单段贝塞尔', () => {
  const x1 = 170;
  const y1 = 240;
  const x2 = 466;
  const y2 = 240;

  const path = calculateBezierPath(x1, y1, x2, y2, 0);
  const parsed = parseBezierPath(path);

  assert.ok(parsed.startX > x1, '正向跨列发起端自节点右侧引出');
  assert.ok(parsed.endX < x2, '正向跨列目标端自目标左侧接入');
  assert.ok(parsed.c1x > x1, '第一控制点向右延伸');
  assert.ok(parsed.c2x < x2, '第二控制点向左延伸');
  assert.equal(path.split('C').length, 2, '正向跨列必须为单段三次贝塞尔');
});

test('反向跨列走线 (|dx| >= 200)：顶层避障通道三段复合贝塞尔', () => {
  const x1 = 466;
  const y1 = 240;
  const x2 = 170;
  const y2 = 240;

  const path = calculateBezierPath(x1, y1, x2, y2, 0);
  assert.ok(path.startsWith('M '), '反向跨列必须以 M 开头');

  const cSegments = [...path.matchAll(/C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/g)];
  assert.equal(cSegments.length, 3, '反向跨列必须为三段复合贝塞尔');

  // 第一段：自发起节点右侧垂直爬升至顶层通道 (y=130)
  const seg1EndY = parseFloat(cSegments[0][6]);
  assert.equal(seg1EndY, 130, '第一段终点 Y 必须为顶层走线通道 130px');

  // 第二段：在顶层通道内平滑横跨 (y=130)
  const seg2EndY = parseFloat(cSegments[1][6]);
  assert.equal(seg2EndY, 130, '第二段终点 Y 必须维持在顶层走线通道 130px');

  // 第三段：自通道下降接入目标左侧
  const seg3EndX = parseFloat(cSegments[2][5]);
  assert.ok(seg3EndX < x2, '第三段接入目标节点左边缘');
});

test('黑板归属线外轨专属通道 (130~136px) 与封顶高度 (130px) 几何契约', () => {
  const sourceNode = { x: 170, y: 240 };
  const targetPost = { x: 100, y: 20 };

  for (let idx = 0; idx < 6; idx++) {
    const coords = computePostEdgeCoordinates(sourceNode, targetPost, idx);

    // 起点位于节点右侧轮廓 (x + 96)
    assert.equal(coords.startX, sourceNode.x + 96, '黑板线起点必须在会话节点右轮廓');
    assert.equal(coords.startY, sourceNode.y, '黑板线起点 Y 坐标对齐节点中心');

    // 外轨专属通道：[130, 136]px，与同列调用 [106, 126]px 物理隔离
    assert.ok(
      coords.gutterX >= sourceNode.x + 130 && coords.gutterX <= sourceNode.x + 136,
      `黑板外轨走线 X (${coords.gutterX}) 必须在 [130, 136]px 专属通道内`
    );

    // 封顶高度必须 <= 130px
    assert.ok(coords.gutterY <= 130, `黑板走线通道折点 Y (${coords.gutterY}) 必须 <= 130px 封顶线`);

    // 终点接入黑板条目底边中点
    assert.equal(coords.targetX, targetPost.x + 90, '目标 X 对齐条目宽度中点 (90px)');
    assert.equal(coords.targetY, targetPost.y + 48, '目标 Y 对齐条目高度底边 (48px)');
  }
});
test('黑板归属线路径生成函数 (calculateAuthorEdgePath & calculateContextEdgePath)：路径拓扑契约', () => {
  const { calculateAuthorEdgePath, calculateContextEdgePath } = plugin;
  assert.equal(typeof calculateAuthorEdgePath, 'function', '必须导出 calculateAuthorEdgePath');
  assert.equal(typeof calculateContextEdgePath, 'function', '必须导出 calculateContextEdgePath');

  const sourceNode = { x: 170, y: 240 };
  const targetPost = { x: 100, y: 20 };

  // 1. Author edge 两段式复合贝塞尔 (进入顶部通道后汇入条目底端)
  const authorPath = calculateAuthorEdgePath(sourceNode, targetPost, 0);
  assert.ok(authorPath.startsWith('M '), 'authorPath 必须以 M 开头');
  const authorCSegments = authorPath.split('C');
  assert.equal(authorCSegments.length, 3, 'authorPath 必须包含两段 C 曲线 (M ... C ... C ...)');

  // 2. Context edge 单段贝塞尔 (直接汇入条目)
  const ctxPath = calculateContextEdgePath(sourceNode, targetPost, 0);
  assert.ok(ctxPath.startsWith('M '), 'ctxPath 必须以 M 开头');
  const ctxCSegments = ctxPath.split('C');
  assert.equal(ctxCSegments.length, 2, 'ctxPath 必须包含一段 C 曲线 (M ... C ...)');
});

test('极值射线外切与跨列多通道边界不变式：几何极限与退化鲁棒性', () => {
  const cx = 300;
  const cy = 400;
  const a = 96;
  const b = 26;

  // 1. 远距离大坐标极值射线 (100,000px 级) 外切点数值稳定性与收敛性
  const farRight = getEllipseIntersection(cx, cy, cx + 1e6, cy, a, b);
  assert.equal(Math.round(farRight.x), cx + a, '大坐标极值正右射线外切 X 坐标收敛于 cx + a');
  assert.equal(Math.round(farRight.y), cy, '大坐标极值正右射线外切 Y 坐标收敛于 cy');

  const farTop = getEllipseIntersection(cx, cy, cx, cy - 1e6, a, b);
  assert.equal(Math.round(farTop.x), cx, '大坐标极值正上射线外切 X 坐标收敛于 cx');
  assert.equal(Math.round(farTop.y), cy - b, '大坐标极值正上射线外切 Y 坐标收敛于 cy - b');

  // 2. 反向近邻列走线 (|dx| < 200)：非高架走线折返过渡几何
  const nearReversePath = calculateBezierPath(300, 200, 180, 260, 2);
  const parsedNear = parseBezierPath(nearReversePath);
  assert.ok(parsedNear.startX > 300, '反向近邻列发起端依然从右侧引出');
  assert.ok(parsedNear.endX < 180, '反向近邻列接收端从左侧接入');
  assert.ok(!Number.isNaN(parsedNear.c1x) && !Number.isNaN(parsedNear.c2x), '控制点绝无 NaN');

  // 3. 多列大跨度正向走线：平滑单段三次贝塞尔与控制点单调性
  const wideSpanPath = calculateBezierPath(100, 200, 1000, 300, 3);
  const parsedWide = parseBezierPath(wideSpanPath);
  assert.ok(parsedWide.c1x > 100, '多列大跨度第一控制点大幅向右延伸');
  assert.ok(parsedWide.c2x < 1000, '多列大跨度第二控制点向左延伸');
  assert.ok(parsedWide.c1x < parsedWide.c2x, '大跨度控制点空间顺序单调无倒挂');
});

