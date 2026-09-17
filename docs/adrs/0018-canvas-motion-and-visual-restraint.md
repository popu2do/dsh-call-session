# ADR-0018: Canvas Motion Token, Geometric Invariant, and Visual Restraint Specification

- **Status**: Accepted
- **Date**: 2026-09-17
- **Deciders**: Architect, Frontend Lead, Core Maintainers
- **Consulted**: QA Automation Lead, UX Reviewer
- **Informed**: All DSH Web Users, Canvas Maintainers

---

## 1. Context and Problem Statement

### 1.1 Background & Motion Regressions
ADR-0012 建立了可视化协作看板，提出“瞬态调用流动与脉冲”；ADR-0014 补充了走线通道与链路聚焦规范（“1.00 实线与脉冲发光”）。然而在前端实现演进中，动效设计暴露出四项严重缺陷：
1. **边线几何拉伸畸变（Geometric Dislocation）**：代码将原本专为节点状态圆点设计的 `@keyframes dshPulseDot`（包含 `scale(0.92)` 至 `1.22`）错误套用于 SVG `<path>` 连线（`.dsh-pulse-edge`）。由于路径缺乏局部原点且跨越视口，导致整条曲线以 SVG 画布 (0,0) 为原点整体伸缩漂移，端点脱离会话卡片。
2. **浅色主题漫射光斑（Light Theme Over-Bloom）**：活跃与聚焦连线沿用深色模式专用的高强度高斯发光（`drop-shadow(0 0 6px ...)`），在浅色白底点阵背景上形成脏灰色漫射晕轮，严重降低连线与文本可读性，违反 ADR-0009 克制极简与 WCAG 2.1 AA 对比度要求。
3. **实线与流动虚线类名冲突（Class Override Conflict）**：聚焦高亮链路本应呈现为清晰实线，但由于 CSS 中 `.dsh-flow-edge` 声明强制定义了 `stroke-dasharray: 6 4`，覆盖了内联实线属性，造成状态冲突与无意义的虚线位移动画。
4. **高频 GPU 重绘与掉帧**：全量 SVG path 叠加大半径发光滤镜并常驻执行无限循环动画，破坏 ADR-0012 承诺的 60fps 流畅度。

---

## 2. Decision Outcome

我们确立以下四项看板动效与视觉约束规范：

### 2.1 拓扑边线几何不变式（Geometric Invariant for Edges）
1. **绝对禁止几何缩放**：任何表示拓扑连线的 SVG `<path>` 元素，严禁在其 CSS 动画或过渡中施加 `transform: scale(...)`、`transform: translate(...)` 或矩阵变换。
2. **动效作用域受敛**：连线的所有动态效果严格限定在纯视觉渲染属性：
   - 流动指示：仅允许改变 `stroke-dashoffset`；
   - 脉冲发光：仅允许改变 `opacity` 或 `stroke-width`（微幅呼吸 `1.0 ~ 1.2` 倍）。

### 2.2 浅色主题去发光与 WCAG 对比度（Theme Scoped Restraint）
1. **浅色模式清晰呈现**：在 `.dsh-canvas-light` 作用域下，边线移除发光阴影（`filter: none`），改以高对比度单色实线或深色低对比虚线呈现，消除浅色底色下的晕轮伪影。
2. **深色模式受限发光**：深色模式下的 `drop-shadow` 模糊半径限制在 `<= 3px`，透明度 `<= 0.45`，避免过度发光，保持界面视觉克制（对齐 ADR-0009 规范）。

### 2.3 聚焦高亮互斥与状态明确（Focus State Exclusivity）
1. **高亮态实线固化**：当会话或调用处于悬停或选中高亮状态时，连接线统一切换为实线（`stroke-dasharray: none`），停止 `dshFlowDash` 位移动画，转为专用轻量呼吸类名（`.dsh-pulse-edge`）。
2. **类名完全解耦**：实线脉冲类名与流动虚线类名互斥，防止 CSS 属性冲突。

### 2.4 可访问性与减弱动态效果（Reduced Motion Parity）
1. 媒体查询支持：支持 `@media (prefers-reduced-motion: reduce)`，在系统减弱动态效果开启时，自动停用无限循环流动动画（`animation: none`），保留静态连线。

---

## 3. Consequences

### 3.1 Positive
- 消除连线端点脱离卡片位置的几何偏移问题。
- 浅色模式下看板清晰干练，对比度达到 WCAG 2.1 AA 标准。
- 消除高斯发光导致的持续重绘，稳定达成 60fps 渲染。

### 3.2 Negative & Mitigations
- 动效视觉表现趋于克制，由数据流动与状态呼吸取代，对齐 ADR-0009 规范。

---

## 4. Compliance & Verification

1. **静态特征检查**：`tests/canvas-motion-invariants.test.mjs` 断言 `.dsh-pulse-edge` 不含 `transform: scale` 与 `dshPulseDot`。
2. **浅色主题断言**：断言 `.dsh-canvas-light` 下发光滤镜被显式置为 `none`。
3. **端到端测试**：全量测试套件执行通过。
