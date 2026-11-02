/**
 * @file lib/canvas-geometry.mjs
 * Canvas geometry and viewport calculation engine.
 * Single source of truth for headless canvas topology and viewport transforms.
 *
 * ATTENTION:
 * The region enclosed by @generated-region-start and @generated-region-end is
 * deterministically embedded into lib/client.js via scripts/embed-canvas-geometry.mjs.
 * That region MUST remain pure ES5 (no const, let, arrow functions, classes, template literals).
 */

// <BEGIN> lib/canvas-geometry.mjs 生成区，禁止手改
  var GUTTER_CONFIG = Object.freeze({
    NODE_RX: 96,
    NODE_RY: 26,
    NODE_RADIUS: 8,
    GUTTER_OFFSET: 118,
    MAX_INTRA_SPREAD: 12,
    CHANNEL_MIN_OFFSET: 106,
    CHANNEL_MAX_OFFSET: 126,
    CHANNEL_HOP_SPREAD: 4,
    CHANNEL_MAX_SPREAD: 18,
    CHANNEL_JITTER_STEP: 2,
    POST_OUTER_OFFSET: 130,
    SESSION_SLOT_HEIGHT: 72,
    POST_LEAD_Y: 40,
    POST_CEILING_Y: 130,
    CROSS_COLUMN_THRESHOLD: 200,
    TOP_CORRIDOR_Y: 130,
    TOP_CORRIDOR_ENTRY_Y: 145,
    TOP_CORRIDOR_ARC_Y: 115
  });

  var VIEWPORT_FRAMING = Object.freeze({
    PADDING: 48,
    TOP_MARGIN: 24,
    BOTTOM_MARGIN: 24,
    MACRO_MIN_ZOOM: 0.30,
    MACRO_MAX_ZOOM: 1.20,
    LOCATE_MIN_ZOOM: 0.8,
    LOCATE_MAX_ZOOM: 1.2
  });

  var CANVAS_FALLBACK_BOUNDS = Object.freeze({ minX: 40, minY: 24, maxX: 1120, maxY: 650 });
  var SESSION_NODE_HALF_WIDTH = 96;
  var SESSION_NODE_HALF_HEIGHT = 26;
  var SESSION_NODE_CORNER_RADIUS = 8;

  var FONT_METRICS = Object.freeze({
    LATIN_WIDTH: 7.2,
    CJK_WIDTH: 12.5,
    ELLIPSIS_WIDTH: 16
  });
  try { (new Array()).constructor.constructor('return this')().FONT_METRICS = FONT_METRICS; } catch (e) {}

  var BEZIER_OFFSETS = Object.freeze({
    SELF_LOOP_HANDLE_X: 45,
    SELF_LOOP_HANDLE_Y: 60,
    SELF_LOOP_CTRL_X: 50,
    SELF_LOOP_CTRL_Y: 75,
    INTRA_CHANNEL_LEAD: 15,
    REVERSE_CORRIDOR_LEAD: 25,
    BASE_SPREAD: 25,
    SPREAD_STEP: 15,
    MAX_SPREAD: 60,
    FORWARD_STEP_RATIO: 0.45,
    FORWARD_STEP_MIN: 120
  });

  var LAYOUT_METRICS = Object.freeze({
    START_X: 40,
    START_Y: 150,
    COLUMN_WIDTH: 260,
    COLUMN_GAP: 36,
    COLUMN_MIN_HEIGHT: 480,
    SESSION_SLOT_HEIGHT: 72,
    HEADER_OFFSET_Y: 10,
    HEADER_HEIGHT: 38,
    HEADER_CLEARANCE_GAP: 16,
    NODE_RADIUS_Y: 26,
    NODE_CENTER_OFFSET_X: 130,
    WORKSPACE_PAD_TOP: 76,
    WORKSPACE_PAD_BOTTOM: 24,
    BLACKBOARD_X: 40,
    BLACKBOARD_Y: 24,
    BLACKBOARD_MIN_WIDTH: 1080,
    BLACKBOARD_WORKSPACES_EXTRA: 80,
    BLACKBOARD_HEIGHT_EMPTY: 38,
    BLACKBOARD_HEIGHT_POSTS: 96,
    POST_START_X: 56,
    POST_START_Y: 52,
    POST_WIDTH: 180,
    POST_HEIGHT: 48,
    POST_GAP_X: 16,
    POST_MIN_MARGIN_RIGHT: 40,
    POST_EDGE_TARGET_X_OFFSET: 90,
    POST_EDGE_TARGET_Y_OFFSET: 48,
    VIRTUAL_NODE_EXTRA_HEIGHT: 60,
    JITTER_SLOT_MODULO_A: 5,
    JITTER_SLOT_MODULO_B: 3,
    JITTER_STEP: 2
  });

  var VIEWPORT_LIMITS = Object.freeze({
    MIN_ZOOM: 0.25,
    MAX_ZOOM: 2.5,
    WHEEL_STEP: 1.1
  });

  /**
   * Computes normalized 8-character session short code
   */
  function computeSessionShortId(rawId) {
    if (!rawId || typeof rawId !== 'string') return 'unknown';
    var stripped = rawId.replace(/^session-/i, '').replace(/[^a-zA-Z0-9]/g, '');
    return stripped.slice(0, 8).toLowerCase() || 'unknown';
  }

  /**
   * Matches session id against target id with support for shortId and session- prefix stripping
   */
  function isMatchingSession(sid, targetId, sessionShortId) {
    if (!targetId || !sid) return false;
    var s1 = String(sid).trim().toLowerCase();
    var s2 = String(targetId).trim().toLowerCase();
    if (s1 === s2) return true;
    if (s1.replace(/^session-/i, '') === s2.replace(/^session-/i, '')) return true;
    var short1 = (sessionShortId && sessionShortId !== 'unknown') ? sessionShortId.toLowerCase() : computeSessionShortId(s1);
    var short2 = computeSessionShortId(s2);
    if (short1 !== 'unknown' && short1 === short2) return true;
    return false;
  }

  /**
   * Computes string pixel width based on rendered character metrics
   */
  function measureTextWidth(text, charWidthAscii, charWidthWide) {
    if (!text) return 0;
    var str = String(text);
    var asciiW = typeof charWidthAscii === 'number' ? charWidthAscii : FONT_METRICS.LATIN_WIDTH;
    var wideW = typeof charWidthWide === 'number' ? charWidthWide : FONT_METRICS.CJK_WIDTH;
    var totalW = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      totalW += (code >= 0 && code <= 255) ? asciiW : wideW;
    }
    return totalW;
  }

  /**
   * Truncates text based on rendered pixel width with ellipsis
   * ASCII chars: 7.2px, Wide chars: 12.5px, Ellipsis: 16px
   */
  function truncateTextByWidth(text, maxWidth, charWidthAscii, charWidthWide) {
    if (!text) return '';
    var str = String(text);
    var asciiW = typeof charWidthAscii === 'number' ? charWidthAscii : FONT_METRICS.LATIN_WIDTH;
    var wideW = typeof charWidthWide === 'number' ? charWidthWide : FONT_METRICS.CJK_WIDTH;
    var totalW = measureTextWidth(str, asciiW, wideW);
    if (totalW <= maxWidth) return str;
    var ellipsisW = FONT_METRICS.ELLIPSIS_WIDTH;

    var limitW = maxWidth - ellipsisW;
    if (limitW <= 0) return '...';

    var curW = 0;
    var cutIdx = 0;
    for (var j = 0; j < str.length; j++) {
      var c = str.charCodeAt(j);
      var w = (c >= 0 && c <= 255) ? asciiW : wideW;
      if (curW + w > limitW) break;
      curW += w;
      cutIdx = j + 1;
    }

    var cutStr = str.slice(0, cutIdx);
    if (cutIdx < str.length) {
      var prevChar = str.charAt(cutIdx - 1);
      var nextChar = str.charAt(cutIdx);
      if (/[A-Za-z0-9]/.test(prevChar) && /[A-Za-z0-9]/.test(nextChar)) {
        var lastSpaceIdx = cutStr.search(/\s[^\s]*$/);
        if (lastSpaceIdx > 0) {
          var wordCut = cutStr.slice(0, lastSpaceIdx).trimEnd();
          if (wordCut.length > 0) {
            return wordCut + '...';
          }
        }
      }
    }

    return cutStr.trimEnd() + '...';
  }

  /**
   * Calculates intersection of line from (cx, cy) to (tx, ty) with ellipse outline
   * Semi-major a = 96, semi-minor b = 26
   */
  function getEllipseIntersection(cx, cy, tx, ty, a, b) {
    var dx = tx - cx;
    var dy = ty - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return { x: cx, y: cy };
    }
    var ea = a || GUTTER_CONFIG.NODE_RX;
    var eb = b || GUTTER_CONFIG.NODE_RY;
    var factor = Math.sqrt((dx / ea) * (dx / ea) + (dy / eb) * (dy / eb));
    if (factor < 0.0001) return { x: cx, y: cy };
    var t = 1 / factor;
    return {
      x: cx + t * dx,
      y: cy + t * dy
    };
  }

  /**
   * Calculates intersection of line from (cx, cy) to (tx, ty) with rounded rectangle outline
   * Semi-major a = 96, semi-minor b = 26, corner radius r = 8
   */
  function getRoundedRectIntersection(cx, cy, tx, ty, a, b, r) {
    var dx = tx - cx;
    var dy = ty - cy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return { x: cx, y: cy };
    }
    var halfWidth = typeof a === 'number' ? a : GUTTER_CONFIG.NODE_RX;
    var halfHeight = typeof b === 'number' ? b : GUTTER_CONFIG.NODE_RY;
    var cornerRadius = typeof r === 'number' ? r : GUTTER_CONFIG.NODE_RADIUS;

    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);

    // 1. 平直垂直边缘（左右出入通道核心区间，覆盖偏角 dy <= 18px）
    if (absDy * halfWidth <= (halfHeight - cornerRadius) * absDx) {
      var signX = dx >= 0 ? 1 : -1;
      return {
        x: cx + signX * halfWidth,
        y: cy + dy * (halfWidth / absDx)
      };
    }

    // 2. 平直水平边缘（上下边缘）
    if (absDx * halfHeight <= (halfWidth - cornerRadius) * absDy) {
      var signY = dy >= 0 ? 1 : -1;
      return {
        x: cx + dx * (halfHeight / absDy),
        y: cy + signY * halfHeight
      };
    }

    // 3. 四个角圆弧相交（斜向对角线区间）
    var cornerCenterX = (dx >= 0 ? 1 : -1) * (halfWidth - cornerRadius);
    var cornerCenterY = (dy >= 0 ? 1 : -1) * (halfHeight - cornerRadius);
    var A = dx * dx + dy * dy;
    var B = -2 * (cornerCenterX * dx + cornerCenterY * dy);
    var C = cornerCenterX * cornerCenterX + cornerCenterY * cornerCenterY - cornerRadius * cornerRadius;
    var disc = B * B - 4 * A * C;
    var t = disc > 0 ? (-B + Math.sqrt(disc)) / (2 * A) : 1;

    return {
      x: cx + t * dx,
      y: cy + t * dy
    };
  }

  /**
   * Generates a curved smooth cubic Bezier path string between two coordinates (ADR-0014 Right-Exit Left-Enter)
   */
  function formatCubicBezier(p0, p1, p2, p3) {
    return 'M ' + p0.x.toFixed(1) + ' ' + p0.y.toFixed(1) +
      ' C ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + ', ' +
      p2.x.toFixed(1) + ' ' + p2.y.toFixed(1) + ', ' +
      p3.x.toFixed(1) + ' ' + p3.y.toFixed(1);
  }

  function calculateBezierPath(x1, y1, x2, y2, index) {
    var dx = x2 - x1;
    var dy = y2 - y1;

    // 自环调用外切于椭圆顶部轮廓
    // 计算在椭圆顶部的两个对称外切端点
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
      var selfLoopStart = getRoundedRectIntersection(x1, y1, x1 - BEZIER_OFFSETS.SELF_LOOP_HANDLE_X, y1 - BEZIER_OFFSETS.SELF_LOOP_HANDLE_Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
      var selfLoopEnd = getRoundedRectIntersection(x1, y1, x1 + BEZIER_OFFSETS.SELF_LOOP_HANDLE_X, y1 - BEZIER_OFFSETS.SELF_LOOP_HANDLE_Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
      var loopControl1X = x1 - BEZIER_OFFSETS.SELF_LOOP_CTRL_X;
      var loopControl1Y = y1 - BEZIER_OFFSETS.SELF_LOOP_CTRL_Y;
      var loopControl2X = x1 + BEZIER_OFFSETS.SELF_LOOP_CTRL_X;
      var loopControl2Y = y1 - BEZIER_OFFSETS.SELF_LOOP_CTRL_Y;
      return formatCubicBezier(
        selfLoopStart,
        { x: loopControl1X, y: loopControl1Y },
        { x: loopControl2X, y: loopControl2Y },
        selfLoopEnd
      );
    }

    // Dynamic curve offset to avoid overlapping parallel lines
    var curveIndex = typeof index === 'number' ? index : 0;
    var spread = (curveIndex % 2 === 0 ? 1 : -1) * Math.min(BEZIER_OFFSETS.BASE_SPREAD + Math.floor(curveIndex / 2) * BEZIER_OFFSETS.SPREAD_STEP, BEZIER_OFFSETS.MAX_SPREAD);

    var controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y;
    var intraOffset = GUTTER_CONFIG.GUTTER_OFFSET + (Math.abs(spread) % GUTTER_CONFIG.MAX_INTRA_SPREAD);
    if (Math.abs(dx) < 2) {
      // ADR-0019 通道分流走线：同工作区列内上下调用执行上下行双通道隔离，避免横穿列中轴
      var hopCount = Math.max(1, Math.round(Math.abs(dy) / GUTTER_CONFIG.SESSION_SLOT_HEIGHT));
      var dynamicSpread = Math.min((hopCount - 1) * GUTTER_CONFIG.CHANNEL_HOP_SPREAD, GUTTER_CONFIG.CHANNEL_MAX_SPREAD) + (Math.abs(curveIndex) % 2) * GUTTER_CONFIG.CHANNEL_JITTER_STEP;
      var concentricOffset = Math.min(GUTTER_CONFIG.CHANNEL_MIN_OFFSET + dynamicSpread, GUTTER_CONFIG.CHANNEL_MAX_OFFSET);
      var verticalLead = Math.min(Math.max(Math.abs(dy) * 0.3, 20), 45);

      if (dy >= 0) {
        // 向下单播：右出右进（走右侧通道），接触点与控制点位于卡片右侧
        controlPoint1X = x1 + concentricOffset;
        controlPoint1Y = y1 + verticalLead;
        controlPoint2X = x2 + concentricOffset;
        controlPoint2Y = y2 - verticalLead;
        var startNodePoint = getRoundedRectIntersection(x1, y1, controlPoint1X, y1 + BEZIER_OFFSETS.INTRA_CHANNEL_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        var endNodePoint = getRoundedRectIntersection(x2, y2, controlPoint2X, y2 - BEZIER_OFFSETS.INTRA_CHANNEL_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        return formatCubicBezier(
          startNodePoint,
          { x: controlPoint1X, y: controlPoint1Y },
          { x: controlPoint2X, y: controlPoint2Y },
          endNodePoint
        );
      } else {
        // 向上单播：左出左进（走左侧通道），接触点与控制点位于卡片左侧
        controlPoint1X = x1 - concentricOffset;
        controlPoint1Y = y1 - verticalLead;
        controlPoint2X = x2 - concentricOffset;
        controlPoint2Y = y2 + verticalLead;
        var startNodePoint = getRoundedRectIntersection(x1, y1, controlPoint1X, y1 - BEZIER_OFFSETS.INTRA_CHANNEL_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        var endNodePoint = getRoundedRectIntersection(x2, y2, controlPoint2X, y2 + BEZIER_OFFSETS.INTRA_CHANNEL_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        return formatCubicBezier(
          startNodePoint,
          { x: controlPoint1X, y: controlPoint1Y },
          { x: controlPoint2X, y: controlPoint2Y },
          endNodePoint
        );
      }
    } else if (dx > 0) {
      // 正向跨工作区调用（从左往右）：右出左进平滑贝塞尔
      var forwardStepX = Math.max(dx * BEZIER_OFFSETS.FORWARD_STEP_RATIO, BEZIER_OFFSETS.FORWARD_STEP_MIN);
      controlPoint1X = x1 + forwardStepX;
      controlPoint1Y = y1 + spread * 0.5;
      controlPoint2X = x2 - forwardStepX;
      controlPoint2Y = y2 + spread * 0.5;
    } else {
      // 反向跨工作区调用（从右往左）：右侧出线折返，左侧进线，通过列间空隙平滑过渡
      controlPoint1X = x1 + intraOffset;
      controlPoint2X = x2 - intraOffset;

      // 跨列反向调用 (|dx| >= 200，跨列物理最小间距为 296px)：通过顶层走线通道 (y <= 130) 横跨避障，避免穿透卡片
      if (Math.abs(dx) >= GUTTER_CONFIG.CROSS_COLUMN_THRESHOLD) {
        var topCorridorY = GUTTER_CONFIG.TOP_CORRIDOR_Y;
        var reverseStartPoint = getRoundedRectIntersection(x1, y1, controlPoint1X, y1 - BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        var reverseEndPoint = getRoundedRectIntersection(x2, y2, controlPoint2X, y2 - BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
        return 'M ' + reverseStartPoint.x.toFixed(1) + ' ' + reverseStartPoint.y.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + (y1 - BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD).toFixed(1) + ', ' +
               controlPoint1X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ENTRY_Y.toFixed(1) + ', ' +
               controlPoint1X.toFixed(1) + ' ' + topCorridorY.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ARC_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ARC_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + topCorridorY.toFixed(1) +
               ' C ' + controlPoint2X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ENTRY_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + (y2 - BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD).toFixed(1) + ', ' +
               reverseEndPoint.x.toFixed(1) + ' ' + reverseEndPoint.y.toFixed(1);
      }

      controlPoint1Y = y1 + (dy >= 0 ? BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD : -BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD);
      controlPoint2Y = y2 + (dy >= 0 ? -BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD : BEZIER_OFFSETS.REVERSE_CORRIDOR_LEAD);
    }

    var startPoint = getRoundedRectIntersection(x1, y1, controlPoint1X, controlPoint1Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);
    var endPoint = getRoundedRectIntersection(x2, y2, controlPoint2X, controlPoint2Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY, GUTTER_CONFIG.NODE_RADIUS);

    return formatCubicBezier(
      startPoint,
      { x: controlPoint1X, y: controlPoint1Y },
      { x: controlPoint2X, y: controlPoint2Y },
      endPoint
    );
  }

  function computePostEdgeCoordinates(sourceNode, targetPost, edgeIndex) {
    var startY = sourceNode.y;
    var idx = typeof edgeIndex === 'number' ? edgeIndex : 0;
    var ySpread = (idx % LAYOUT_METRICS.JITTER_SLOT_MODULO_A) * LAYOUT_METRICS.JITTER_STEP;
    var gutterX = sourceNode.x + GUTTER_CONFIG.POST_OUTER_OFFSET + (idx % LAYOUT_METRICS.JITTER_SLOT_MODULO_B) * LAYOUT_METRICS.JITTER_STEP;
    var gutterY = Math.min(startY - GUTTER_CONFIG.POST_LEAD_Y, GUTTER_CONFIG.POST_CEILING_Y) - ySpread;
    return {
      startX: sourceNode.x + GUTTER_CONFIG.NODE_RX,
      startY: startY,
      gutterX: gutterX,
      gutterY: gutterY,
      targetX: targetPost.x + LAYOUT_METRICS.POST_EDGE_TARGET_X_OFFSET,
      targetY: targetPost.y + LAYOUT_METRICS.POST_EDGE_TARGET_Y_OFFSET
    };
  }

  function calculateAuthorEdgePath(sourceNode, targetPost, edgeIndex) {
    var edgeCoords = computePostEdgeCoordinates(sourceNode, targetPost, edgeIndex);
    return 'M ' + edgeCoords.startX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) +
      ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) + ', ' +
      edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) + ', ' +
      edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) +
      ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + (edgeCoords.gutterY - BEZIER_OFFSETS.INTRA_CHANNEL_LEAD).toFixed(1) + ', ' +
      edgeCoords.targetX.toFixed(1) + ' ' + (edgeCoords.targetY + BEZIER_OFFSETS.INTRA_CHANNEL_LEAD).toFixed(1) + ', ' +
      edgeCoords.targetX.toFixed(1) + ' ' + edgeCoords.targetY.toFixed(1);
  }

  function calculateContextEdgePath(sourceNode, targetPost, edgeIndex) {
    var edgeCoords = computePostEdgeCoordinates(sourceNode, targetPost, edgeIndex);
    return 'M ' + edgeCoords.startX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) +
      ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) + ', ' +
      edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) + ', ' +
      edgeCoords.targetX.toFixed(1) + ' ' + edgeCoords.targetY.toFixed(1);
  }

  function isSameWorkspace(w1, w2) {
    if (!w1 || !w2) return false;
    var norm1 = String(w1).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    var norm2 = String(w2).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return norm1 === norm2;
  }

  function workspaceOwnsSession(workspace, session) {
    if (!workspace || !session) return false;
    var sessionList = workspace.sessionIds || [];
    if (sessionList.length > 0) {
      return sessionList.some(function (id) {
        return isMatchingSession(id, session.id || session);
      });
    }
    return isSameWorkspace(session.workspace, workspace.id);
  }

  function extractWorkspaceName(wsPath) {
    if (!wsPath) return 'Workspace';
    return String(wsPath).split(/[\\/]/).filter(Boolean).pop() || String(wsPath);
  }

  function promoteWorkspaceToFirst(list, index) {
    if (index > 0 && index < list.length) {
      var item = list.splice(index, 1)[0];
      item.isCurrent = true;
      list.unshift(item);
    }
  }

  function createDefaultWorkspaceNode(workspacePath, sessionIds) {
    return {
      id: workspacePath,
      name: extractWorkspaceName(workspacePath),
      isCurrent: true,
      sessionIds: sessionIds || []
    };
  }

  function computeLayout(workspaces, sessions, posts, currentWorkspace, crossWorkspace, calls) {
    var workspaceList = workspaces && workspaces.length ? workspaces.slice() : [];

    if (!workspaceList.length && currentWorkspace) {
      workspaceList = [createDefaultWorkspaceNode(currentWorkspace, (sessions || []).map(function (session) { return session.id; }))];
    }

    if (currentWorkspace) {
      var currentWorkspaceIndex = workspaceList.findIndex(function (workspace) {
        return isSameWorkspace(workspace.id, currentWorkspace);
      });
      if (currentWorkspaceIndex > 0) {
        promoteWorkspaceToFirst(workspaceList, currentWorkspaceIndex);
      } else if (currentWorkspaceIndex === 0) {
        workspaceList[0].isCurrent = true;
      } else {
        var currentDrawnIds = (sessions || []).filter(function (session) {
          return Boolean(session) && isSameWorkspace(session.workspace, currentWorkspace);
        }).map(function (session) { return session.id; });
        if (!(sessions || []).length || currentDrawnIds.length > 0) {
          workspaceList.unshift(createDefaultWorkspaceNode(currentWorkspace, currentDrawnIds));
        }
      }
    } else if (workspaceList.length > 0) {
      var existingCurrentWorkspaceIndex = workspaceList.findIndex(function (workspace) { return workspace.isCurrent; });
      promoteWorkspaceToFirst(workspaceList, existingCurrentWorkspaceIndex);
    }

    for (var workspaceIndex = 0; workspaceIndex < workspaceList.length; workspaceIndex++) {
      workspaceList[workspaceIndex].isCurrent = currentWorkspace
        ? isSameWorkspace(workspaceList[workspaceIndex].id, currentWorkspace)
        : (workspaceIndex === 0 && Boolean(workspaceList[0].isCurrent));
    }

    var activeWorkspaces = (crossWorkspace === false)
      ? workspaceList.filter(function (workspace) { return workspace.isCurrent; })
      : workspaceList;
    if (!activeWorkspaces.length && workspaceList.length) {
      activeWorkspaces = [workspaceList[0]];
    }

    var nodePositions = {};
    var nodeIdIndex = {};
    var workspaceBounds = [];
    var postPositions = {};

    var startX = LAYOUT_METRICS.START_X;
    var startY = LAYOUT_METRICS.START_Y;
    var columnWidth = LAYOUT_METRICS.COLUMN_WIDTH;
    var columnGap = LAYOUT_METRICS.COLUMN_GAP;
    var columnMinHeight = LAYOUT_METRICS.COLUMN_MIN_HEIGHT;
    var sessionSlotHeight = LAYOUT_METRICS.SESSION_SLOT_HEIGHT;
    var headerOffsetY = LAYOUT_METRICS.HEADER_OFFSET_Y;
    var headerHeight = LAYOUT_METRICS.HEADER_HEIGHT;
    var headerClearanceGap = LAYOUT_METRICS.HEADER_CLEARANCE_GAP;
    var nodeRadiusY = LAYOUT_METRICS.NODE_RADIUS_Y;
    var firstNodeTopOffset = headerOffsetY + headerHeight + headerClearanceGap;
    var sessionStartY = startY + firstNodeTopOffset + nodeRadiusY;

    function computeSessionCenterY(slotIndex) {
      return sessionStartY + slotIndex * sessionSlotHeight;
    }

    activeWorkspaces.forEach(function (workspace, activeWorkspaceIndex) {
      var workspaceX = startX + activeWorkspaceIndex * (columnWidth + columnGap);
      var workspaceSessions = (sessions || []).filter(function (session) {
        return workspaceOwnsSession(workspace, session);
      });

      var workspaceHeight = Math.max(columnMinHeight, LAYOUT_METRICS.WORKSPACE_PAD_TOP + workspaceSessions.length * sessionSlotHeight + LAYOUT_METRICS.WORKSPACE_PAD_BOTTOM);

      workspaceBounds.push({
        id: workspace.id,
        name: workspace.name,
        isCurrent: workspace.isCurrent,
        x: workspaceX,
        y: startY,
        width: columnWidth,
        height: workspaceHeight
      });

      workspaceSessions.forEach(function (session, sessionIndex) {
        var centerX = workspaceX + LAYOUT_METRICS.NODE_CENTER_OFFSET_X;
        var centerY = computeSessionCenterY(sessionIndex);

        var node = {
          x: centerX,
          y: centerY,
          session: session
        };
        nodePositions[session.id] = node;
        nodeIdIndex[session.id] = session.id;
        if (typeof session.id === 'string') {
          nodeIdIndex[session.id.toLowerCase()] = session.id;
        }
      });
    });

    if (calls && calls.length) {
      calls.forEach(function (callRecord) {
        var endpoints = [];
        if (callRecord.callerArchived || callRecord.callerOffline || (callRecord.status === 'settled' && callRecord.callerTitle)) {
          endpoints.push({ id: callRecord.callerSessionId, ws: callRecord.callerWorkspace, title: callRecord.callerTitle });
        }
        if (callRecord.targetArchived || callRecord.targetOffline || (callRecord.status === 'settled' && callRecord.targetTitle)) {
          endpoints.push({ id: callRecord.targetSessionId, ws: callRecord.targetWorkspace, title: callRecord.targetTitle });
        }
        endpoints.forEach(function (endpoint) {
          if (!endpoint.id) return;
          var endpointSessionId = String(endpoint.id);
          var lowerSessionId = endpointSessionId.toLowerCase();
          if (nodeIdIndex[endpointSessionId] || nodeIdIndex[lowerSessionId] || nodePositions[endpointSessionId] || nodePositions[lowerSessionId]) return;

          var targetWorkspace = activeWorkspaces.find(function (workspace) {
            return isSameWorkspace(workspace.id, endpoint.ws);
          }) || activeWorkspaces[0];

          var matchedWorkspaceBound = workspaceBounds.find(function (workspaceBound) { return workspaceBound.id === (targetWorkspace ? targetWorkspace.id : null); }) || workspaceBounds[0];
          var boundWorkspaceX = matchedWorkspaceBound ? matchedWorkspaceBound.x : startX;
          var sessionCountInWorkspace = Object.keys(nodePositions).filter(function (key) {
            return nodePositions[key].session && nodePositions[key].session.workspace === (targetWorkspace ? targetWorkspace.id : null);
          }).length;

          var centerX = boundWorkspaceX + LAYOUT_METRICS.NODE_CENTER_OFFSET_X;
          var centerY = computeSessionCenterY(sessionCountInWorkspace);
          var shortId = computeSessionShortId(endpointSessionId);
          var virtualSession = {
            id: endpointSessionId,
            shortId: shortId,
            title: (endpoint.title && typeof endpoint.title === 'string' && endpoint.title.trim()) ? endpoint.title.trim() : ('Agent ' + shortId),
            workspace: targetWorkspace ? targetWorkspace.id : currentWorkspace,
            state: 'offline',
            status: 'offline',
            isArchived: true,
            isVirtual: true
          };

          var virtualNode = {
            x: centerX,
            y: centerY,
            session: virtualSession
          };
          nodePositions[endpointSessionId] = virtualNode;
          nodeIdIndex[endpointSessionId] = endpointSessionId;
          nodeIdIndex[lowerSessionId] = endpointSessionId;

          if (matchedWorkspaceBound) {
            matchedWorkspaceBound.height = Math.max(matchedWorkspaceBound.height, centerY - matchedWorkspaceBound.y + LAYOUT_METRICS.VIRTUAL_NODE_EXTRA_HEIGHT);
          }
        });
      });
    }

    var postList = posts || [];
    var totalWorkspaceCount = Math.max(activeWorkspaces.length, 1);
    var blackboardWidthFromWorkspaces = totalWorkspaceCount * (columnWidth + columnGap) - columnGap + LAYOUT_METRICS.BLACKBOARD_WORKSPACES_EXTRA;
    var blackboardWidth = Math.max(LAYOUT_METRICS.BLACKBOARD_MIN_WIDTH, blackboardWidthFromWorkspaces);
    var hasPosts = postList.length > 0;
    var blackboardHeight = hasPosts ? LAYOUT_METRICS.BLACKBOARD_HEIGHT_POSTS : LAYOUT_METRICS.BLACKBOARD_HEIGHT_EMPTY;

    var blackboardBound = {
      x: LAYOUT_METRICS.BLACKBOARD_X,
      y: LAYOUT_METRICS.BLACKBOARD_Y,
      width: blackboardWidth,
      height: blackboardHeight
    };

    var sortedPosts = postList.slice().sort(function (a, b) {
      var aActive = a.status === 'active';
      var bActive = b.status === 'active';
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      var aTime = a.createdAt || 0;
      var bTime = b.createdAt || 0;
      return bTime - aTime;
    });

    var maxVisiblePosts = Math.max(1, Math.floor((blackboardWidth - LAYOUT_METRICS.POST_START_X - LAYOUT_METRICS.POST_MIN_MARGIN_RIGHT + LAYOUT_METRICS.POST_GAP_X) / (LAYOUT_METRICS.POST_WIDTH + LAYOUT_METRICS.POST_GAP_X)));
    sortedPosts.slice(0, maxVisiblePosts).forEach(function (post, postIndex) {
      postPositions[post.id] = {
        x: LAYOUT_METRICS.POST_START_X + postIndex * (LAYOUT_METRICS.POST_WIDTH + LAYOUT_METRICS.POST_GAP_X),
        y: LAYOUT_METRICS.POST_START_Y,
        width: LAYOUT_METRICS.POST_WIDTH,
        height: LAYOUT_METRICS.POST_HEIGHT,
        post: post
      };
    });

    return {
      workspaceBounds: workspaceBounds,
      nodePositions: nodePositions,
      nodeIdIndex: nodeIdIndex,
      blackboardBound: blackboardBound,
      postPositions: postPositions
    };
  }

  /**
   * ADR-0013: 看板视口取景引擎
   * 纯函数，不读取组件 refs 与状态。宏观取景与夹紧定位共用同一套边界几何。
   */
  function computeViewportFraming(options) {
    var opts = options || {};
    var vw = Number(opts.viewportWidth) > 0 ? Number(opts.viewportWidth) : 1000;
    var vh = Number(opts.viewportHeight) > 0 ? Number(opts.viewportHeight) : 656;
    var bounds = opts.bounds || {};
    var anchor = opts.anchor || null;
    var isLocate = opts.mode === 'locate';
    var padding = VIEWPORT_FRAMING.PADDING;

    var minX = isFinite(bounds.minX) ? bounds.minX : CANVAS_FALLBACK_BOUNDS.minX;
    var minY = isFinite(bounds.minY) ? bounds.minY : CANVAS_FALLBACK_BOUNDS.minY;
    var maxX = isFinite(bounds.maxX) ? bounds.maxX : CANVAS_FALLBACK_BOUNDS.maxX;
    var maxY = isFinite(bounds.maxY) ? bounds.maxY : CANVAS_FALLBACK_BOUNDS.maxY;

    var contentW = Math.max(maxX - minX, 50);
    var contentH = Math.max(maxY - minY, 50);

    var zoom;
    var panX;
    var panY;

    if (isLocate && anchor) {
      // 定位模式：维持用户视距，双向夹紧至可读区间，禁止粗暴重置为 1.0
      var baseZoom = Number(opts.currentZoom);
      if (!isFinite(baseZoom) || baseZoom <= 0) baseZoom = 1;
      zoom = Math.min(Math.max(baseZoom, VIEWPORT_FRAMING.LOCATE_MIN_ZOOM), VIEWPORT_FRAMING.LOCATE_MAX_ZOOM);

      // 水平夹紧居中：内容整体容纳于视口时居中，超出时首列左边缘对齐安全边距，避免左侧空白断层
      var centeredPanX = (vw - contentW * zoom) / 2 - minX * zoom;
      panX = contentW * zoom <= vw ? centeredPanX : padding - minX * zoom;

      // 垂直边界约束：目标会话居中为基线；列高适配视口时受顶部黑板与列底双向夹紧。
      var anchorY = Number(anchor.y) || 0;
      var centeredPanY = (vh / 2) - anchorY * zoom;
      var topBoundPanY = VIEWPORT_FRAMING.TOP_MARGIN - minY * zoom;
      var fitsVertically = contentH * zoom <= vh - VIEWPORT_FRAMING.TOP_MARGIN - VIEWPORT_FRAMING.BOTTOM_MARGIN;
      if (fitsVertically) {
        var bottomBoundPanY = vh - VIEWPORT_FRAMING.BOTTOM_MARGIN - maxY * zoom;
        panY = Math.min(Math.max(centeredPanY, topBoundPanY), bottomBoundPanY);
      } else {
        // 列高超出视口：节点可见性优先；仅当保留顶部黑板不会推出目标会话时才抬升 panY
        var topAnchoredPanY = Math.max(centeredPanY, topBoundPanY);
        var anchorScreenY = anchorY * zoom + topAnchoredPanY;
        panY = (anchorScreenY >= VIEWPORT_FRAMING.TOP_MARGIN && anchorScreenY <= vh - VIEWPORT_FRAMING.BOTTOM_MARGIN)
          ? topAnchoredPanY
          : centeredPanY;
      }
    } else {
      // 宏观取景：完整框定公共黑板与全部工作区分组列
      var availW = Math.max(vw - padding * 2, 100);
      var availH = Math.max(vh - padding * 2, 100);
      zoom = Math.min(Math.max(Math.min(availW / contentW, availH / contentH), VIEWPORT_FRAMING.MACRO_MIN_ZOOM), VIEWPORT_FRAMING.MACRO_MAX_ZOOM);
      panX = (vw - contentW * zoom) / 2 - minX * zoom;
      panY = (vh - contentH * zoom) / 2 - minY * zoom;
    }

    return { zoom: zoom, panX: panX, panY: panY };
  }

  /**
   * Computes bounding rectangle enclosing workspaces, session nodes, and blackboard
   */
  function computeContentBounds(options) {
    var opts = options || {};
    var workspaceBounds = opts.workspaceBounds || [];
    var nodePositions = opts.nodePositions || {};
    var blackboardBound = opts.blackboardBound || null;

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;

    workspaceBounds.forEach(function (ws) {
      if (!ws) return;
      minX = Math.min(minX, ws.x);
      minY = Math.min(minY, ws.y);
      maxX = Math.max(maxX, ws.x + ws.width);
      maxY = Math.max(maxY, ws.y + ws.height);
    });

    Object.keys(nodePositions).forEach(function (sid) {
      var node = nodePositions[sid];
      if (!node) return;
      minX = Math.min(minX, node.x - SESSION_NODE_HALF_WIDTH);
      minY = Math.min(minY, node.y - SESSION_NODE_HALF_HEIGHT);
      maxX = Math.max(maxX, node.x + SESSION_NODE_HALF_WIDTH);
      maxY = Math.max(maxY, node.y + SESSION_NODE_HALF_HEIGHT);
    });

    if (blackboardBound) {
      minX = Math.min(minX, blackboardBound.x);
      minY = Math.min(minY, blackboardBound.y);
      maxX = Math.max(maxX, blackboardBound.x + blackboardBound.width);
      maxY = Math.max(maxY, blackboardBound.y + blackboardBound.height);
    }

    if (!isFinite(minX) || !isFinite(maxX)) {
      return {
        minX: CANVAS_FALLBACK_BOUNDS.minX,
        minY: CANVAS_FALLBACK_BOUNDS.minY,
        maxX: CANVAS_FALLBACK_BOUNDS.maxX,
        maxY: CANVAS_FALLBACK_BOUNDS.maxY
      };
    }

    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function resolveViewport(viewport) {
    var vp = viewport || { panX: 0, panY: 0, zoom: 1 };
    var px = typeof vp.panX === 'number' ? vp.panX : 0;
    var py = typeof vp.panY === 'number' ? vp.panY : 0;
    var z = typeof vp.zoom === 'number' ? vp.zoom : 1;
    return { panX: px, panY: py, zoom: z };
  }

  function worldToScreen(point, viewport) {
    var p = point || { x: 0, y: 0 };
    var vp = resolveViewport(viewport);
    return {
      x: vp.panX + p.x * vp.zoom,
      y: vp.panY + p.y * vp.zoom
    };
  }

  function screenToWorld(point, viewport) {
    var p = point || { x: 0, y: 0 };
    var vp = resolveViewport(viewport);
    var z = vp.zoom || 1;
    return {
      x: (p.x - vp.panX) / z,
      y: (p.y - vp.panY) / z
    };
  }

  function clampZoom(zoom, minZoom, maxZoom) {
    var z = typeof zoom === 'number' ? zoom : 1;
    var min = typeof minZoom === 'number' ? minZoom : VIEWPORT_LIMITS.MIN_ZOOM;
    var max = typeof maxZoom === 'number' ? maxZoom : VIEWPORT_LIMITS.MAX_ZOOM;
    return Math.min(Math.max(z, min), max);
  }

  function computeZoomAtPoint(viewport, cursor, factor) {
    var vp = resolveViewport(viewport);
    var c = cursor || { x: 0, y: 0 };
    var f = typeof factor === 'number' ? factor : 1;
    var currentZoom = vp.zoom;
    var nextZoom = clampZoom(currentZoom * f);
    if (nextZoom === currentZoom) {
      return { panX: vp.panX, panY: vp.panY, zoom: currentZoom };
    }
    var nextPanX = c.x - (c.x - vp.panX) * (nextZoom / currentZoom);
    var nextPanY = c.y - (c.y - vp.panY) * (nextZoom / currentZoom);
    return {
      panX: nextPanX,
      panY: nextPanY,
      zoom: nextZoom
    };
  }

  function computeDragPan(origin, cursor) {
    var orig = origin || { x: 0, y: 0, panX: 0, panY: 0 };
    var c = cursor || { x: 0, y: 0 };
    var dx = c.x - orig.x;
    var dy = c.y - orig.y;
    var originPanX = typeof orig.panX === 'number' ? orig.panX : 0;
    var originPanY = typeof orig.panY === 'number' ? orig.panY : 0;
    return {
      panX: originPanX + dx,
      panY: originPanY + dy
    };
  }

  function viewportTransformStyle(viewport) {
    var vp = resolveViewport(viewport);
    return 'translate3d(' + vp.panX + 'px, ' + vp.panY + 'px, 0px) scale(' + vp.zoom + ')';
  }
// <END>

export {
  GUTTER_CONFIG,
  VIEWPORT_FRAMING,
  CANVAS_FALLBACK_BOUNDS,
  SESSION_NODE_HALF_WIDTH,
  SESSION_NODE_HALF_HEIGHT,
  SESSION_NODE_CORNER_RADIUS,
  FONT_METRICS,
  BEZIER_OFFSETS,
  LAYOUT_METRICS,
  VIEWPORT_LIMITS,
  computeSessionShortId,
  isMatchingSession,
  measureTextWidth,
  truncateTextByWidth,
  getEllipseIntersection,
  getRoundedRectIntersection,
  formatCubicBezier,
  calculateBezierPath,
  computePostEdgeCoordinates,
  calculateAuthorEdgePath,
  calculateContextEdgePath,
  extractWorkspaceName,
  promoteWorkspaceToFirst,
  createDefaultWorkspaceNode,
  isSameWorkspace,
  workspaceOwnsSession,
  computeLayout,
  computeViewportFraming,
  computeContentBounds,
  resolveViewport,
  worldToScreen,
  screenToWorld,
  clampZoom,
  computeZoomAtPoint,
  computeDragPan,
  viewportTransformStyle
};
