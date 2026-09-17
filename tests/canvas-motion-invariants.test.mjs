import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');

test('ADR-0018 不变量 1: 连线呼吸动画必须拥有独立关键帧且严禁几何缩放 transform: scale', () => {
  // ADR-0018 §2.1: 拓扑连线严禁使用 transform: scale，防止端点以 SVG 原点脱节漂移
  const pulseEdgeRule = clientSource.match(/\.dsh-canvas-container\s+\.dsh-pulse-edge\s*\{([^}]+)\}/);
  assert.ok(pulseEdgeRule, 'CSS 必须定义 .dsh-pulse-edge 规则');
  assert.ok(
    !pulseEdgeRule[1].includes('dshPulseDot'),
    '.dsh-pulse-edge 严禁复用 dshPulseDot (transform: scale 会导致路径与会话节点脱节)'
  );

  const pulseEdgeKeyframes = clientSource.match(/@keyframes\s+dshPulseEdge\s*\{([^}]+)\}/);
  assert.ok(pulseEdgeKeyframes, 'CSS 必须声明 @keyframes dshPulseEdge');
  assert.ok(
    !pulseEdgeKeyframes[1].includes('transform'),
    '@keyframes dshPulseEdge 严禁使用 transform 几何缩放'
  );
  assert.ok(
    pulseEdgeKeyframes[1].includes('opacity'),
    '@keyframes dshPulseEdge 必须针对 opacity 透明度进行呼吸动画'
  );
});

test('ADR-0018 不变量 2: 浅色主题作用域下必须压制深色模式的高强度霓虹发光滤镜', () => {
  // ADR-0018 §2.2: .dsh-canvas-light 作用域下清空发光滤镜 (filter: none)，避免白底晕轮
  const lightEdgeRule = clientSource.match(/\.dsh-canvas-container\.dsh-canvas-light[^{]*\.dsh-(?:pulse|flow)-edge[^{]*\{([^}]+)\}/);
  assert.ok(
    lightEdgeRule,
    '.dsh-canvas-light 必须定义针对 .dsh-pulse-edge / .dsh-flow-edge 的作用域覆盖规则'
  );
  assert.ok(
    lightEdgeRule[1].includes('filter: none'),
    '.dsh-canvas-light 连线规则必须显式声明 filter: none'
  );
});

test('ADR-0018 不变量 3: 链路聚焦高亮态必须为实线且与流动虚线样式互斥', () => {
  // ADR-0018 §2.3: 高亮态连线必须为实线，并独占 dsh-pulse-edge 类名，避免流动虚线样式覆盖
  assert.ok(
    clientSource.includes("(isCallHovered || isConnected) ? 'dsh-pulse-edge' : decay.className"),
    '高亮调用边必须严格使用 dsh-pulse-edge 且不可与 decay.className 叠加'
  );
});

test('ADR-0018 不变量 4: 无障碍 prefers-reduced-motion 媒体查询支持', () => {
  // ADR-0018 §2.4: 响应 prefers-reduced-motion: reduce 媒体查询，在减弱动态效果下停用无限循环动画
  assert.ok(
    clientSource.includes('prefers-reduced-motion: reduce'),
    'CSS 必须声明 @media (prefers-reduced-motion: reduce) 媒体查询以冻结连线流动与呼吸动画'
  );
});

test('ADR-0018 不变量 5: 深色模式 flow-edge 投影模糊半径不得超过 3px', () => {
  // ADR-0018 §2.2: 深色模式下的 drop-shadow 模糊半径严格限制在 <= 3px
  const flowEdgeRule = clientSource.match(/\.dsh-canvas-container\s+\.dsh-flow-edge\s*\{([^}]+)\}/);
  assert.ok(flowEdgeRule, 'CSS 必须定义 .dsh-flow-edge 规则');
  const shadowMatch = flowEdgeRule[1].match(/drop-shadow\(\s*0\s+0\s+(\d+)px/);
  assert.ok(shadowMatch, '.dsh-flow-edge 必须声明 drop-shadow 滤镜');
  const blurRadius = parseInt(shadowMatch[1], 10);
  assert.ok(
    blurRadius <= 3,
    `深色模式 .dsh-flow-edge drop-shadow 模糊半径必须 <= 3px (遵循 ADR-0018 §2.2)，当前: ${blurRadius}px`
  );
});

test('ADR-0014 & ADR-0018 不变量 6: 连线类名解析保持常态低噪无高亮', () => {
  // ADR-0014 §2.2: 静态黑板发布归属线默认保持低噪呈现 (0.50 细虚线)
  // ADR-0018 §2.3: 聚焦高亮互斥，常态连线不得挂载高亮类名
  assert.ok(
    clientSource.includes("function resolveEdgeClassName(isDimmed, isHighlighted)"),
    '必须定义 resolveEdgeClassName 连线类名映射函数'
  );
  assert.ok(
    clientSource.includes("className: resolveEdgeClassName(isDimmed, isHighlighted)"),
    '归属边与上下文边必须统一通过 resolveEdgeClassName 解析类名'
  );
});

test('ADR-0014 & ADR-0018 不变量 7: 上下文调用边高亮必须使用 1.00 满不透明度实线与 dsh-pulse-edge', () => {
  // ADR-0014 §2.2 & ADR-0018 §2.3: 上下文调用边高亮时必须转为 1.00 满不透明度实线，并使用 dsh-pulse-edge
  assert.ok(
    clientSource.includes("strokeDasharray: isHighlighted ? 'none' : '3 3'"),
    '上下文调用边高亮态必须切换为实线 (strokeDasharray: none)'
  );
  assert.ok(
    clientSource.includes("strokeOpacity: isHighlighted ? 1.0 : 0.45"),
    '上下文调用边高亮态必须达到 1.0 满不透明度 (遵循 ADR-0014 §2.2)'
  );
});

test('规范不变量: prefers-reduced-motion 媒体查询选择器必须严格约束在 .dsh-canvas-container 容器下', () => {
  const reducedMotionMatch = clientSource.match(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?\n\s*\})/);
  assert.ok(reducedMotionMatch, '必须定义 prefers-reduced-motion 媒体查询代码块');
  const innerCss = reducedMotionMatch[1];

  assert.ok(
    innerCss.includes('.dsh-canvas-container .dsh-pulse-dot'),
    'prefers-reduced-motion 内部的 .dsh-pulse-dot 必须以 .dsh-canvas-container 为前缀'
  );
  assert.ok(
    !innerCss.includes('\n    .dsh-pulse-dot {') && !innerCss.includes('\n  .dsh-pulse-dot {'),
    '检测到未限定作用域的 .dsh-pulse-dot 选择器，必须带有 .dsh-canvas-container 前缀以防止全局污染'
  );
});
