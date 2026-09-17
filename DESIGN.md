---
version: 0.1.0
name: "DSH Canvas Design System"
description: "Design system and visual tokens for the DSH Collaboration Canvas and blackboard UI. This is the base/light theme specification with dark theme semantic mappings."

colors:
  # ── Background surfaces ──
  background-100: "#ffffff"

  # ── Gray (solid — text, borders, and fills) ──
  gray-1000: "#0f172a"
  gray-900: "#475569"

  # ── Accent — Blue (brand, focus, primary action) ──
  blue-700: "#0284c7"

  # ── Accent — Red (error, offline, destructive) ──
  red-700: "#e11d48"

  # ── Accent — Amber (warning, decaying, caution) ──
  amber-700: "#d97706"

typography:
  # ── Body text ──
  copy-16:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0

  # ── Headings ──
  heading-32:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em

spacing:
  base: 4px
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px

rounded:
  sm: 6px

---

<!-- COMPLETENESS_LEVEL: 1 — last audited 2026-09-17 -->

# DSH Canvas Design System

DSH Canvas Design System defines the visual language, design tokens, geometry constraints, and interaction hierarchy for the Visual Collaboration Canvas ([`lib/client.js`](lib/client.js)) and the associated Blackboard UI.

## Overview & Aesthetic Principles

1. **Information Density with Structural Calm**: The canvas is an operational cockpit for multi-agent collaboration. Spatial rhythm, contrast, and alignment minimize cognitive load without sacrificing telemetry granularity.
2. **Strict Scope Isolation**: The canvas operates inside host environments (such as DSH Web). All styles are scoped strictly within `.dsh-canvas-container` to guarantee zero side-effects on host frames.
3. **WCAG 2.1 AA Accessibility Compliance**: Foreground text must achieve a minimum 4.5:1 contrast ratio against card and canvas surfaces in both light and dark modes.
4. **Deterministic Geometry**: Topology coordinates, Bezier control corridors, and ellipse intersections follow explicit mathematical invariants rather than arbitrary visual heuristics.

## Breakpoints

The collaboration canvas adapts dynamically to host container viewports:

| Breakpoint | Viewport Width | Layout Behavior |
|---|---|---|
| **Compact** | `< 768px` | Single-column collapsed workspace, toolbar wraps to compact icons, drawer occupies 100vw full width. |
| **Standard** | `>= 768px` | Multi-column swimlanes horizontally laid out, side drawer fixed at 420px (max 90vw). |

## Theme Tokens & Dual-Theme Architecture

The canvas supports native dark mode (default) and light mode (`.dsh-canvas-light`).

| Token Role | Base / Light (`.dsh-canvas-light`) | Dark (Default) | Notes |
|---|---|---|---|
| `canvas-bg` | `#f8fafc` | `#0b0f19` | Viewport infinite surface |
| `workspace-surface` | `#ffffff` | `#111827` | Swimlane column surface |
| `workspace-border` | `#e2e8f0` | `#1f2937` | Swimlane boundary |
| `node-surface` | `#ffffff` | `#1e293b` | Agent session card surface |
| `node-border` | `#cbd5e1` | `#334155` | Agent session card boundary |
| `node-text-primary` | `#0f172a` (`gray-1000`) | `#f8fafc` | Contrast ratio `> 10:1` |
| `node-text-secondary` | `#475569` (`gray-900`) | `#94a3b8` | Contrast ratio `> 4.5:1` |
| `call-dispatch` | `#0284c7` (`blue-700`) | `#38bdf8` | Task dispatch active edge |
| `call-report` | `#16a34a` | `#4ade80` | Task report edge |
| `call-notice` | `#d97706` (`amber-700`) | `#fbbf24` | Notice broadcast edge |
| `error-offline` | `#e11d48` (`red-700`) | `#f43f5e` | Offline / error indicator |

## Canvas Geometric Constants (SSOT)

All layout and routing calculations in [`lib/client.js`](lib/client.js) adhere to the following geometric constants:

- **Node Ellipse Dimensions**: Horizontal radius `NODE_RX = 96px`, vertical radius `NODE_RY = 26px` (total node size 192px × 52px).
- **Gutter Channel Offset**: `GUTTER_OFFSET = 118px` from node center (guaranteeing minimum 22px clearance from ellipse boundary).
- **Maximum Intra-Spread**: `MAX_INTRA_SPREAD = 12px`.
- **Top Corridor Elevation**: `TOP_CORRIDOR_Y = 130px` (safe corridor for reverse cross-column routing).
- **Workspace Column Metrics**: `columnWidth = 260px`, `columnGap = 36px`, `columnMinHeight = 480px`.

## Layer Hierarchy (Z-Index Architecture)

To resolve stacking context penetration between tooltips, drawers, and viewports:

| Layer | Z-Index | Component Selector | Purpose |
|---|---|---|---|
| **Background** | `1` | `.dsh-canvas-viewport` | Pan/Zoom infinite transform layer |
| **Entities** | `2` | `.dsh-canvas-node`, `.dsh-canvas-edge` | Interactive SVG graph elements |
| **Toolbar** | `10` | `.dsh-canvas-toolbar` | View controls, theme toggle, stats |
| **Tooltip** | `20` | `.dsh-canvas-tooltip` | Hover telemetry popovers |
| **Drawer Mask** | `30` | `.dsh-canvas-drawer-mask` | Backdrop dimming barrier |
| **Drawer Panel** | `40` | `.dsh-canvas-drawer` | L3 deep-dive inspection sidebar |
