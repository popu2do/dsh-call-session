/**
 * DSH Collaboration Canvas Web Client Plugin
 * Registers conversation.view Tab「看板」
 */

(function () {
  'use strict';

  var NS = 'dsh-canvas';

  var zh = {
    'view.canvas': '看板',
    'toolbar.workspace': '工作区',
    'toolbar.currentWorkspace': '当前工程',
    'toolbar.allWorkspaces': '多工程泳道',
    'toolbar.fitView': '自适应居中',
    'toolbar.refresh': '刷新',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomOut': '缩小',
    'stats.totalSessions': '会话',
    'stats.runningSessions': '运行',
    'stats.idleSessions': '就绪',
    'stats.totalPosts': '黑板条目',
    'stats.activeCalls': '活跃调用',
    'blackboard.hub': '公共黑板',
    'blackboard.empty': '暂无活跃条目',
    'blackboard.activePosts': '条活跃条目',
    'blackboard.topic': '主题',
    'blackboard.tags': '标签',
    'blackboard.ttl': '有效剩余',
    'session.running': '运行中',
    'session.idle': '就绪',
    'session.offline': '会话已离线',
    'call.dispatch': '任务派发',
    'call.report': '任务汇报',
    'call.notice': '状态同步',
    'call.steer': '引导',
    'call.followup': '唤醒',
    'status.active': '活跃',
    'status.archived': '已撤销',
    'status.expired': '已过期',
    'drawer.title': '实体详情',
    'drawer.readonlyBadge': '只读',
    'drawer.copy': '复制',
    'drawer.copied': '已复制',
    'drawer.close': '关闭',
    'drawer.metadataSection': '元数据',
    'drawer.lineageSection': '关联链路',
    'drawer.payloadSection': '消息正文',
    'drawer.sessionId': '会话 ID',
    'drawer.sessionTitle': '会话标题',
    'drawer.workspace': '工作区',
    'drawer.status': '状态',
    'drawer.agentType': '智能体类型',
    'drawer.callsIn': '呼入',
    'drawer.callsOut': '呼出',
    'drawer.postsCount': '黑板发布',
    'drawer.callId': '调用 ID',
    'drawer.callType': '调用意图',
    'drawer.deliveryMode': '交付模式',
    'drawer.duration': '耗时',
    'drawer.timestamp': '发生时间',
    'drawer.caller': '发起方会话',
    'drawer.target': '接收方会话',
    'drawer.contextPostIds': '关联黑板条目',
    'drawer.messageSnippet': '消息摘要',
    'drawer.messagePayload': '消息正文',
    'drawer.postId': '条目 ID',
    'drawer.topic': '主题',
    'drawer.tags': '标签',
    'drawer.author': '发布会话',
    'drawer.ttl': '有效剩余',
    'drawer.content': '条目正文',
    'empty.title': '协作看板就绪',
    'empty.desc': '暂无活跃会话或黑板条目，发起调用或发布条目后在此呈现。'
  };

  var en = {
    'view.canvas': 'Canvas',
    'toolbar.workspace': 'Workspace',
    'toolbar.currentWorkspace': 'Current Project',
    'toolbar.allWorkspaces': 'Multi-Project Swimlanes',
    'toolbar.fitView': 'Fit View',
    'toolbar.refresh': 'Refresh',
    'toolbar.zoomIn': 'Zoom In',
    'toolbar.zoomOut': 'Zoom Out',
    'stats.totalSessions': 'Sessions',
    'stats.runningSessions': 'Running',
    'stats.idleSessions': 'Idle',
    'stats.totalPosts': 'Blackboard Posts',
    'stats.activeCalls': 'Active Calls',
    'blackboard.hub': 'Blackboard',
    'blackboard.empty': 'No active posts',
    'blackboard.activePosts': 'active posts',
    'blackboard.topic': 'Topic',
    'blackboard.tags': 'Tags',
    'blackboard.ttl': 'TTL Left',
    'session.running': 'Running',
    'session.idle': 'Idle',
    'session.offline': 'Session Offline',
    'call.dispatch': 'Task Dispatch',
    'call.report': 'Task Report',
    'call.notice': 'Notice',
    'call.steer': 'Steer',
    'call.followup': 'Followup',
    'status.active': 'Active',
    'status.archived': 'Archived',
    'status.expired': 'Expired',
    'drawer.title': 'Entity Details',
    'drawer.readonlyBadge': 'Read-Only',
    'drawer.copy': 'Copy',
    'drawer.copied': 'Copied',
    'drawer.close': 'Close',
    'drawer.metadataSection': 'Metadata',
    'drawer.lineageSection': 'Related Lineage',
    'drawer.payloadSection': 'Message Payload',
    'drawer.sessionId': 'Session ID',
    'drawer.sessionTitle': 'Session Title',
    'drawer.workspace': 'Workspace',
    'drawer.status': 'Status',
    'drawer.agentType': 'Agent Type',
    'drawer.callsIn': 'Inbound Calls',
    'drawer.callsOut': 'Outbound Calls',
    'drawer.postsCount': 'Blackboard Posts',
    'drawer.callId': 'Call ID',
    'drawer.callType': 'Call Intent',
    'drawer.deliveryMode': 'Delivery Mode',
    'drawer.duration': 'Duration',
    'drawer.timestamp': 'Timestamp',
    'drawer.caller': 'Caller Session',
    'drawer.target': 'Target Session',
    'drawer.contextPostIds': 'Linked Blackboard Posts',
    'drawer.messageSnippet': 'Message Snippet',
    'drawer.messagePayload': 'Message Payload',
    'drawer.postId': 'Post ID',
    'drawer.topic': 'Topic',
    'drawer.tags': 'Tags',
    'drawer.author': 'Author Session',
    'drawer.ttl': 'TTL Left',
    'drawer.content': 'Post Content',
    'empty.title': 'Collaboration Canvas Ready',
    'empty.desc': 'No active sessions or blackboard posts. Content will appear here once calls are made or posts are published.'
  };

  var inject = ['slots', 'locale'];

  var CANVAS_CSS = [
    ':root {',
    '  --dsh-font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace;',
    '  --dsh-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
    '}',
    '.dsh-canvas-container {',
    '  position: relative;',
    '  width: 100%;',
    '  height: 100%;',
    '  background-color: #0b0f19;',
    '  color: #e2e8f0;',
    '  font-family: var(--dsh-font-sans);',
    '  overflow: hidden;',
    '  user-select: none;',
    '  display: flex;',
    '  flex-direction: column;',
    '}',
    '.dsh-canvas-toolbar {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  height: 44px;',
    '  padding: 0 16px;',
    '  padding-right: 76px !important;',
    '  background: #111827;',
    '  border-bottom: 1px solid #1f2937;',
    '  z-index: 10;',
    '}',
    '.dsh-canvas-toolbar-group {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '}',
    '.dsh-canvas-title {',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  color: #f3f4f6;',
    '  margin-right: 8px;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '}',
    '.dsh-canvas-badge {',
    '  font-size: 11px;',
    '  padding: 2px 6px;',
    '  border-radius: 4px;',
    '  background: #1e293b;',
    '  color: #94a3b8;',
    '  border: 1px solid #334155;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 4px;',
    '  font-family: var(--dsh-font-mono);',
    '}',
    '.dsh-canvas-badge.green {',
    '  background: rgba(16, 185, 129, 0.15);',
    '  color: #34d399;',
    '  border-color: rgba(16, 185, 129, 0.3);',
    '}',
    '.dsh-canvas-badge.purple {',
    '  background: rgba(139, 92, 246, 0.15);',
    '  color: #a78bfa;',
    '  border-color: rgba(139, 92, 246, 0.3);',
    '}',
    '.dsh-canvas-badge.cyan {',
    '  background: rgba(6, 182, 212, 0.15);',
    '  color: #22d3ee;',
    '  border-color: rgba(6, 182, 212, 0.3);',
    '}',
    '.dsh-canvas-btn {',
    '  height: 28px;',
    '  padding: 0 10px;',
    '  background: #1f2937;',
    '  border: 1px solid #374151;',
    '  border-radius: 4px;',
    '  color: #d1d5db;',
    '  font-size: 12px;',
    '  font-weight: 500;',
    '  cursor: pointer;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 4px;',
    '  transition: all 0.15s ease;',
    '}',
    '.dsh-canvas-btn:hover {',
    '  background: #374151;',
    '  color: #ffffff;',
    '  border-color: #4b5563;',
    '}',
    '.dsh-canvas-btn.active {',
    '  background: #2563eb;',
    '  border-color: #3b82f6;',
    '  color: #ffffff;',
    '}',
    '.dsh-canvas-viewport {',
    '  flex: 1;',
    '  position: relative;',
    '  width: 100%;',
    '  height: 100%;',
    '  overflow: hidden;',
    '  cursor: grab;',
    '  contain: layout style;',
    '}',
    '.dsh-canvas-viewport:active {',
    '  cursor: grabbing;',
    '}',
    '.dsh-canvas-surface {',
    '  position: absolute;',
    '  top: 0;',
    '  left: 0;',
    '  width: 100%;',
    '  height: 100%;',
    '  transform-origin: 0 0;',
    '  will-change: transform;',
    '}',
    '.dsh-canvas-dimmed {',
    '  opacity: 0.2 !important;',
    '  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);',
    '}',
    '.dsh-canvas-highlighted {',
    '  opacity: 1 !important;',
    '  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);',
    '}',
    '.dsh-canvas-drawer {',
    '  position: absolute;',
    '  top: 0;',
    '  right: 0;',
    '  bottom: 0;',
    '  width: 420px;',
    '  max-width: 90vw;',
    '  background: rgba(17, 24, 39, 0.96);',
    '  backdrop-filter: blur(16px);',
    '  border-left: 1px solid #374151;',
    '  z-index: 25;',
    '  display: flex;',
    '  flex-direction: column;',
    '  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);',
    '  animation: dshCanvasDrawerIn 0.24s cubic-bezier(0, 0, 0.2, 1);',
    '  will-change: transform;',
    '}',
    '@keyframes dshCanvasDrawerIn {',
    '  from { transform: translate3d(100%, 0, 0); }',
    '  to { transform: translate3d(0, 0, 0); }',
    '}',
    '.dsh-canvas-drawer-header {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  padding: 14px 18px;',
    '  border-bottom: 1px solid #1f2937;',
    '  background: #111827;',
    '}',
    '.dsh-canvas-drawer-title {',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  color: #f9fafb;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '}',
    '.dsh-canvas-drawer-readonly {',
    '  font-size: 10px;',
    '  padding: 1px 6px;',
    '  border-radius: 3px;',
    '  background: rgba(59, 130, 246, 0.15);',
    '  color: #60a5fa;',
    '  border: 1px solid rgba(59, 130, 246, 0.3);',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '  font-weight: 600;',
    '}',
    '.dsh-canvas-drawer-body {',
    '  flex: 1;',
    '  overflow-y: auto;',
    '  padding: 18px;',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 16px;',
    '}',
    '.dsh-canvas-section-title {',
    '  font-size: 11px;',
    '  font-weight: 600;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '  color: #94a3b8;',
    '  border-bottom: 1px solid #1e293b;',
    '  padding-bottom: 4px;',
    '  margin-bottom: 8px;',
    '}',
    '.dsh-canvas-drawer-field {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 4px;',
    '}',
    '.dsh-canvas-drawer-label {',
    '  font-size: 11px;',
    '  color: #9ca3af;',
    '  font-weight: 500;',
    '}',
    '.dsh-canvas-drawer-value-row {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  background: #1f2937;',
    '  padding: 6px 10px;',
    '  border-radius: 4px;',
    '  border: 1px solid #374151;',
    '}',
    '.dsh-canvas-drawer-value {',
    '  font-family: var(--dsh-font-mono);',
    '  font-size: 12px;',
    '  color: #f3f4f6;',
    '  word-break: break-all;',
    '}',
    '.dsh-canvas-copy-btn {',
    '  padding: 2px 7px;',
    '  font-size: 11px;',
    '  background: #374151;',
    '  border: 1px solid #4b5563;',
    '  border-radius: 3px;',
    '  color: #d1d5db;',
    '  cursor: pointer;',
    '  margin-left: 8px;',
    '  white-space: nowrap;',
    '  transition: all 0.15s ease;',
    '}',
    '.dsh-canvas-copy-btn:hover {',
    '  background: #4b5563;',
    '  color: #ffffff;',
    '}',
    '.dsh-canvas-copy-btn.copied {',
    '  background: rgba(16, 185, 129, 0.2);',
    '  border-color: #10b981;',
    '  color: #34d399;',
    '}',
    '.dsh-canvas-payload-box {',
    '  background: #0f172a;',
    '  border: 1px solid #1e293b;',
    '  border-radius: 4px;',
    '  padding: 10px 12px;',
    '  font-family: var(--dsh-font-mono);',
    '  font-size: 12px;',
    '  line-height: 1.5;',
    '  color: #cbd5e1;',
    '  max-height: 220px;',
    '  overflow-y: auto;',
    '  white-space: pre-wrap;',
    '  word-break: break-word;',
    '}',
    '.dsh-canvas-tooltip {',
    '  position: absolute;',
    '  background: rgba(15, 23, 42, 0.96);',
    '  border: 1px solid #334155;',
    '  border-radius: 6px;',
    '  padding: 8px 12px;',
    '  font-size: 11px;',
    '  color: #cbd5e1;',
    '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);',
    '  backdrop-filter: blur(8px);',
    '  pointer-events: none;',
    '  z-index: 20;',
    '  max-width: 280px;',
    '  animation: dshTooltipIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);',
    '}',
    '@keyframes dshTooltipIn {',
    '  from { opacity: 0; transform: translateY(4px); }',
    '  to { opacity: 1; transform: translateY(0); }',
    '}',
    '.dsh-canvas-tooltip-header {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  gap: 8px;',
    '  margin-bottom: 4px;',
    '  font-weight: 600;',
    '  color: #f1f5f9;',
    '}',
    '.dsh-canvas-tooltip-row {',
    '  display: flex;',
    '  justify-content: space-between;',
    '  gap: 8px;',
    '  margin-top: 2px;',
    '  color: #94a3b8;',
    '}',
    '@keyframes dshPulseDot {',
    '  0% { transform: scale(0.92); opacity: 0.75; }',
    '  50% { transform: scale(1.22); opacity: 1; }',
    '  100% { transform: scale(0.92); opacity: 0.75; }',
    '}',
    '.dsh-pulse-dot {',
    '  transform-box: fill-box !important;',
    '  transform-origin: center !important;',
    '  animation: dshPulseDot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;',
    '}',
    '@keyframes dshFlowDash {',
    '  to { stroke-dashoffset: -20; }',
    '}',
    '.dsh-flow-edge {',
    '  stroke-dasharray: 6 4;',
    '  animation: dshFlowDash 1.2s linear infinite;',
    '}',
    '.dsh-flow-edge-slow {',
    '  stroke-dasharray: 6 4;',
    '  animation: dshFlowDash 2.4s linear infinite;',
    '}'
  ].join('\n');

  function ensureStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dsh-canvas-styles')) return;
    var style = document.createElement('style');
    style.id = 'dsh-canvas-styles';
    style.textContent = CANVAS_CSS;
    document.head.appendChild(style);
  }

  function formatTTL(ttlMs) {
    if (!ttlMs || ttlMs <= 0) return '0s';
    var sec = Math.floor(ttlMs / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    var hr = Math.floor(min / 60);
    return hr + 'h ' + (min % 60) + 'm';
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    try {
      var d = new Date(timestamp);
      if (isNaN(d.getTime())) return String(timestamp);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      var ss = String(d.getSeconds()).padStart(2, '0');
      return hh + ':' + mm + ':' + ss;
    } catch (e) {
      return String(timestamp);
    }
  }

  function copyToClipboard(text, key, setCopiedKey) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(function () {
        if (typeof setCopiedKey === 'function') setCopiedKey(key);
        setTimeout(function () {
          if (typeof setCopiedKey === 'function') setCopiedKey(null);
        }, 1400);
      }).catch(function () {});
    }
  }

  /**
   * Computes normalized 8-character session short code
   */
  function computeSessionShortId(rawId) {
    if (!rawId || typeof rawId !== 'string') return 'unknown';
    var stripped = rawId.replace(/^session-/i, '').replace(/[^a-zA-Z0-9]/g, '');
    return stripped.slice(0, 8).toLowerCase() || 'unknown';
  }

  /**
   * Truncates text based on rendered pixel width with ellipsis
   * ASCII chars: 7.2px, Wide chars: 12.5px, Ellipsis: 16px
   */
  function truncateTextByWidth(text, maxWidth, charWidthAscii, charWidthWide) {
    if (!text) return '';
    var str = String(text);
    var asciiW = typeof charWidthAscii === 'number' ? charWidthAscii : 7.2;
    var wideW = typeof charWidthWide === 'number' ? charWidthWide : 12.5;
    var ellipsisW = 16;

    var totalW = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      totalW += (code >= 0 && code <= 255) ? asciiW : wideW;
    }
    if (totalW <= maxWidth) return str;

    var limitW = maxWidth - ellipsisW;
    var curW = 0;
    var cutIdx = 0;
    for (var j = 0; j < str.length; j++) {
      var c = str.charCodeAt(j);
      var w = (c >= 0 && c <= 255) ? asciiW : wideW;
      if (curW + w > limitW) break;
      curW += w;
      cutIdx = j + 1;
    }
    return str.slice(0, cutIdx) + '...';
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
    var ea = a || 96;
    var eb = b || 26;
    var factor = Math.sqrt((dx / ea) * (dx / ea) + (dy / eb) * (dy / eb));
    if (factor < 0.0001) return { x: cx, y: cy };
    var t = 1 / factor;
    return {
      x: cx + t * dx,
      y: cy + t * dy
    };
  }

  /**
   * Generates a curved quadratic Bezier path string between two coordinates
   */
  function calculateBezierPath(x1, y1, x2, y2, index, total) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) dist = 1;

    // Self-call loop
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
      return 'M ' + (x1 - 10) + ' ' + (y1 - 20) +
             ' C ' + (x1 - 40) + ' ' + (y1 - 60) + ', ' +
             (x1 + 40) + ' ' + (y1 - 60) + ', ' +
             (x1 + 10) + ' ' + (y1 - 20);
    }

    // Dynamic curve offset to avoid overlapping parallel lines
    var idx = typeof index === 'number' ? index : 0;
    var spread = (idx % 2 === 0 ? 1 : -1) * Math.min(30 + Math.floor(idx / 2) * 20, 80);

    var nx = -dy / dist;
    var ny = dx / dist;

    var mx = (x1 + x2) / 2 + nx * spread;
    var my = (y1 + y2) / 2 + ny * spread;

    return 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
           ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) +
           ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
  }

  /**
   * Computes three-state time-decay visual parameters for call lines
   */
  function getCallEdgeDecay(call, now) {
    var timestamp = call.timestamp || now;
    var ageSec = Math.max(0, (now - timestamp) / 1000);
    var isSettled = call.status === 'settled';

    // State 1: Historical / Settled (>60s or settled status): 30% opacity, static dashed
    if (isSettled || ageSec > 60) {
      return {
        opacity: 0.3,
        strokeWidth: 1.2,
        isFlowing: false,
        className: ''
      };
    }

    // State 2: Recent decay (15s ~ 60s): 65% opacity, slow flow
    if (ageSec > 15) {
      return {
        opacity: 0.65,
        strokeWidth: 1.6,
        isFlowing: true,
        className: 'dsh-flow-edge-slow'
      };
    }

    // State 3: Fresh active (<15s): 100% opacity, fast flow, glowing pulse
    return {
      opacity: 1.0,
      strokeWidth: 2.2,
      isFlowing: true,
      className: 'dsh-flow-edge'
    };
  }

  /**
   * Multi-workspace, session, and blackboard layout engine
   */
  function computeLayout(workspaces, sessions, posts, currentWorkspace, crossWorkspace) {
    var wsList = workspaces && workspaces.length ? workspaces : [];
    if (!wsList.length && currentWorkspace) {
      wsList = [{
        id: currentWorkspace,
        name: currentWorkspace.split(/[\\/]/).filter(Boolean).pop() || currentWorkspace,
        isCurrent: true,
        sessionIds: (sessions || []).map(function (s) { return s.id; })
      }];
    }

    var activeWorkspaces = crossWorkspace
      ? wsList
      : wsList.filter(function (w) { return w.isCurrent; });
    if (!activeWorkspaces.length && wsList.length) {
      activeWorkspaces = [wsList[0]];
    }

    var nodePositions = {};
    var workspaceBounds = [];
    var postPositions = {};

    var startX = 40;
    var startY = 150;
    var swimlaneWidth = 260;
    var swimlaneGap = 36;
    var swimlaneMinHeight = 480;

    activeWorkspaces.forEach(function (ws, wsIdx) {
      var wsX = startX + wsIdx * (swimlaneWidth + swimlaneGap);
      var wsSessions = (sessions || []).filter(function (s) {
        if (ws.sessionIds && ws.sessionIds.length) {
          return ws.sessionIds.includes(s.id);
        }
        return s.workspace === ws.id;
      });

      var wsHeight = Math.max(swimlaneMinHeight, 76 + wsSessions.length * 72 + 24);

      workspaceBounds.push({
        id: ws.id,
        name: ws.name,
        isCurrent: ws.isCurrent,
        x: wsX,
        y: startY,
        width: swimlaneWidth,
        height: wsHeight
      });

      wsSessions.forEach(function (session, sIdx) {
        var cx = wsX + 130;
        var cy = 214 + sIdx * 72;

        nodePositions[session.id] = {
          x: cx,
          y: cy,
          session: session
        };
      });
    });

    var postList = posts || [];
    var totalWsCount = Math.max(activeWorkspaces.length, 1);
    var bbWidthFromWs = totalWsCount * (swimlaneWidth + swimlaneGap) - swimlaneGap + 80;
    var bbWidthFromPosts = 56 + postList.length * (180 + 16) + 40;
    var bbWidth = Math.max(1080, bbWidthFromWs, bbWidthFromPosts);

    var blackboardBound = {
      x: 40,
      y: 24,
      width: bbWidth,
      height: 96
    };

    postList.forEach(function (post, pIdx) {
      postPositions[post.id] = {
        x: 56 + pIdx * (180 + 16),
        y: 52,
        width: 180,
        height: 48,
        post: post
      };
    });

    return {
      workspaceBounds: workspaceBounds,
      nodePositions: nodePositions,
      blackboardBound: blackboardBound,
      postPositions: postPositions
    };
  }

  function createClientPlugin(requireFn) {
    var React = (function () {
      try {
        return typeof requireFn === 'function' ? requireFn('react') : globalThis.React;
      } catch (e) {
        return globalThis.React;
      }
    })();

    function h(type, props) {
      var children = [];
      for (var i = 2; i < arguments.length; i++) {
        var child = arguments[i];
        if (Array.isArray(child)) {
          for (var j = 0; j < child.length; j++) children.push(child[j]);
        } else if (child !== null && child !== undefined && child !== false) {
          children.push(child);
        }
      }
      if (React && React.createElement) {
        return React.createElement.apply(React, [type, props].concat(children));
      }
      return { type: type, props: props || {}, children: children };
    }

    /**
     * L3 Read-only Slide-over Inspector Drawer (420px)
     */
    function CanvasDrawer(props) {
      var entity = props.entity;
      var onClose = props.onClose;
      var t = props.t;
      var copiedKey = props.copiedKey;
      var setCopiedKey = props.setCopiedKey;

      if (!entity) return null;

      var metadataRows = [];
      var lineageRows = [];
      var payloadRows = [];

      function renderField(label, value, copyId) {
        return h('div', { className: 'dsh-canvas-drawer-field', key: label },
          h('div', { className: 'dsh-canvas-drawer-label' }, label),
          h('div', { className: 'dsh-canvas-drawer-value-row' },
            h('span', { className: 'dsh-canvas-drawer-value' }, String(value || '-')),
            copyId ? h('button', {
              className: 'dsh-canvas-copy-btn' + (copiedKey === copyId ? ' copied' : ''),
              onClick: function () { copyToClipboard(value, copyId, setCopiedKey); }
            }, copiedKey === copyId ? t('drawer.copied') : t('drawer.copy')) : null
          )
        );
      }

      if (entity.kind === 'session') {
        metadataRows.push(renderField(t('drawer.sessionId'), entity.sessionId || entity.id, 'sessionId'));
        metadataRows.push(renderField(t('drawer.sessionTitle'), entity.title, 'title'));
        metadataRows.push(renderField(t('drawer.workspace'), entity.workspace || entity.cwd, 'cwd'));
        metadataRows.push(renderField(t('drawer.status'), entity.status === 'running' ? t('session.running') : t('session.idle')));
        if (entity.agentType) {
          metadataRows.push(renderField(t('drawer.agentType'), entity.agentType));
        }

        if (entity.stats) {
          lineageRows.push(renderField(t('drawer.callsIn'), String(entity.stats.inboundCalls || entity.stats.callsIn || 0)));
          lineageRows.push(renderField(t('drawer.callsOut'), String(entity.stats.outboundCalls || entity.stats.callsOut || 0)));
          lineageRows.push(renderField(t('drawer.postsCount'), String(entity.stats.postsCount || 0)));
        }
      } else if (entity.kind === 'call') {
        metadataRows.push(renderField(t('drawer.callId'), entity.id, 'callId'));
        metadataRows.push(renderField(t('drawer.callType'), t('call.' + (entity.callType === 'task_dispatch' ? 'dispatch' : entity.callType === 'task_report' ? 'report' : 'notice')) || entity.callType));
        metadataRows.push(renderField(t('drawer.deliveryMode'), t('call.' + entity.deliveryMode) || entity.deliveryMode));
        metadataRows.push(renderField(t('drawer.duration'), entity.durationMs ? entity.durationMs + 'ms' : '0ms'));
        metadataRows.push(renderField(t('drawer.timestamp'), formatTime(entity.timestamp)));

        var callerLabel = entity.callerTitle ? entity.callerTitle + ' (' + computeSessionShortId(entity.callerSessionId) + ')' : entity.callerSessionId;
        var targetLabel = entity.targetTitle ? entity.targetTitle + ' (' + computeSessionShortId(entity.targetSessionId) + ')' : entity.targetSessionId;
        lineageRows.push(renderField(t('drawer.caller'), callerLabel, 'callerSessionId'));
        lineageRows.push(renderField(t('drawer.target'), targetLabel, 'targetSessionId'));
        if (Array.isArray(entity.contextPostIds) && entity.contextPostIds.length) {
          lineageRows.push(renderField(t('drawer.contextPostIds'), entity.contextPostIds.join(', '), 'contextPostIds'));
        }

        if (entity.messagePayload) {
          payloadRows.push(
            h('div', { className: 'dsh-canvas-drawer-field', key: 'payload' },
              h('div', { className: 'dsh-canvas-drawer-label' }, t('drawer.messagePayload')),
              h('pre', { className: 'dsh-canvas-payload-box' }, entity.messagePayload),
              h('button', {
                className: 'dsh-canvas-copy-btn' + (copiedKey === 'payload' ? ' copied' : ''),
                style: { alignSelf: 'flex-start', marginTop: '4px' },
                onClick: function () { copyToClipboard(entity.messagePayload, 'payload', setCopiedKey); }
              }, copiedKey === 'payload' ? t('drawer.copied') : t('drawer.copy'))
            )
          );
        }
      } else if (entity.kind === 'post') {
        metadataRows.push(renderField(t('drawer.postId'), entity.id, 'postId'));
        metadataRows.push(renderField(t('drawer.topic'), entity.topic, 'topic'));

        var statusLabel = entity.status === 'archived' ? t('status.archived') : (entity.status === 'expired' ? t('status.expired') : t('status.active'));
        metadataRows.push(renderField(t('drawer.status'), statusLabel));
        metadataRows.push(renderField(t('drawer.tags'), Array.isArray(entity.tags) && entity.tags.length ? entity.tags.join(', ') : '-'));

        // Non-active posts zero out TTL and display state label instead of remaining time
        if (entity.status === 'active' || (!entity.status && entity.ttlRemainingMs > 0)) {
          metadataRows.push(renderField(t('drawer.ttl'), formatTTL(entity.ttlRemainingMs || (entity.ttl ? entity.ttl * 1000 : 0))));
        }

        if (entity.authorSessionId) {
          lineageRows.push(renderField(t('drawer.author'), entity.authorSessionId, 'authorSessionId'));
        }
        if (entity.workspace) {
          lineageRows.push(renderField(t('drawer.workspace'), entity.workspace, 'workspace'));
        }

        if (entity.content) {
          payloadRows.push(
            h('div', { className: 'dsh-canvas-drawer-field', key: 'post-content' },
              h('div', { className: 'dsh-canvas-drawer-label' }, t('drawer.content')),
              h('pre', { className: 'dsh-canvas-payload-box' }, entity.content),
              h('button', {
                className: 'dsh-canvas-copy-btn' + (copiedKey === 'post-content' ? ' copied' : ''),
                style: { alignSelf: 'flex-start', marginTop: '4px' },
                onClick: function () { copyToClipboard(entity.content, 'post-content', setCopiedKey); }
              }, copiedKey === 'post-content' ? t('drawer.copied') : t('drawer.copy'))
            )
          );
        }
      } else if (entity.kind === 'blackboard_hub') {
        metadataRows.push(renderField(t('blackboard.hub'), t('view.canvas')));
        metadataRows.push(renderField(t('stats.totalPosts'), String(entity.activeCount || 0)));
        if (entity.totalCount !== undefined) {
          metadataRows.push(renderField(t('blackboard.activePosts'), String(entity.totalCount || 0)));
        }
        if (entity.summary) {
          payloadRows.push(
            h('div', { className: 'dsh-canvas-drawer-field', key: 'hub-summary' },
              h('div', { className: 'dsh-canvas-drawer-label' }, t('blackboard.hub')),
              h('pre', { className: 'dsh-canvas-payload-box' }, entity.summary),
              h('button', {
                className: 'dsh-canvas-copy-btn' + (copiedKey === 'hub-summary' ? ' copied' : ''),
                style: { alignSelf: 'flex-start', marginTop: '4px' },
                onClick: function () { copyToClipboard(entity.summary, 'hub-summary', setCopiedKey); }
              }, copiedKey === 'hub-summary' ? t('drawer.copied') : t('drawer.copy'))
            )
          );
        }
      }

      var badgeLabel = typeof t === 'function' ? (t('drawer.readonlyBadge') || '只读') : '只读';
      if (badgeLabel !== '只读' && badgeLabel.toUpperCase() === 'READ-ONLY') {
        badgeLabel = '只读';
      }

      return h('div', { className: 'dsh-canvas-drawer' },
        h('div', { className: 'dsh-canvas-drawer-header' },
          h('div', { className: 'dsh-canvas-drawer-title' },
            h('span', null, t('drawer.title')),
            h('span', { className: 'dsh-canvas-drawer-readonly' }, badgeLabel)
          ),
          h('button', { className: 'dsh-canvas-btn', onClick: onClose }, t('drawer.close'))
        ),
        h('div', { className: 'dsh-canvas-drawer-body' },
          metadataRows.length ? h('div', null,
            h('div', { className: 'dsh-canvas-section-title' }, t('drawer.metadataSection')),
            metadataRows
          ) : null,
          lineageRows.length ? h('div', null,
            h('div', { className: 'dsh-canvas-section-title' }, t('drawer.lineageSection')),
            lineageRows
          ) : null,
          payloadRows.length ? h('div', null,
            h('div', { className: 'dsh-canvas-section-title' }, t('drawer.payloadSection')),
            payloadRows
          ) : null
        )
      );
    }

    /**
     * Primary CanvasView topology component
     */
    function CanvasView(props) {
      var t = props.t || function (k) { return zh[k] || k; };
      var sessionId = props.sessionId || '';

      var crossWorkspaceState = React ? React.useState(false) : [false, function () {}];
      var crossWorkspace = crossWorkspaceState[0];
      var setCrossWorkspace = crossWorkspaceState[1];

      var telemetryState = React ? React.useState({
        timestamp: Date.now(),
        currentWorkspace: '',
        workspaces: [],
        sessions: [],
        posts: [],
        calls: [],
        metrics: { totalSessions: 0, runningSessions: 0, activeCalls: 0, totalPosts: 0 }
      }) : [{
        timestamp: Date.now(),
        currentWorkspace: '',
        workspaces: [],
        sessions: [],
        posts: [],
        calls: [],
        metrics: { totalSessions: 0, runningSessions: 0, activeCalls: 0, totalPosts: 0 }
      }, function () {}];
      var telemetry = telemetryState[0];
      var setTelemetry = telemetryState[1];

      var selectedEntityState = React ? React.useState(null) : [null, function () {}];
      var selectedEntity = selectedEntityState[0];
      var setSelectedEntity = selectedEntityState[1];

      // L2 Hover State: { kind, id, entity, x, y }
      var hoveredEntityState = React ? React.useState(null) : [null, function () {}];
      var hoveredEntity = hoveredEntityState[0];
      var setHoveredEntity = hoveredEntityState[1];

      var panState = React ? React.useState({ x: 0, y: 0 }) : [{ x: 0, y: 0 }, function () {}];
      var pan = panState[0];
      var setPan = panState[1];

      var zoomState = React ? React.useState(1) : [1, function () {}];
      var zoom = zoomState[0];
      var setZoom = zoomState[1];

      var copiedKeyState = React ? React.useState(null) : [null, function () {}];
      var copiedKey = copiedKeyState[0];
      var setCopiedKey = copiedKeyState[1];

      var containerRef = React ? React.useRef(null) : { current: null };
      var isDraggingRef = React ? React.useRef(false) : { current: false };
      var dragOriginRef = React ? React.useRef({ x: 0, y: 0, panX: 0, panY: 0 }) : { current: { x: 0, y: 0, panX: 0, panY: 0 } };
      var dragDistanceRef = React ? React.useRef(0) : { current: 0 };
      var animFrameRef = React ? React.useRef(null) : { current: null };

      var hoverTimerRef = React ? React.useRef(null) : { current: null };
      var leaveTimerRef = React ? React.useRef(null) : { current: null };
      var prevChecksumRef = React ? React.useRef('') : { current: '' };

      var fetchSnapshot = function () {
        var applyData = function (data) {
          if (!data) return;
          var checksum = String(data.timestamp || '') + ':' +
            (data.sessions ? data.sessions.length : 0) + ':' +
            (data.calls ? data.calls.length : 0) + ':' +
            (data.posts ? data.posts.length : 0);
          if (prevChecksumRef.current === checksum) return;
          prevChecksumRef.current = checksum;
          setTelemetry(data);
        };

        if (typeof props.fetchTelemetry === 'function') {
          props.fetchTelemetry({ crossWorkspace: crossWorkspace }).then(function (data) {
            applyData(data);
          }).catch(function () {});
          return;
        }
        if (typeof fetch === 'function') {
          var query = new URLSearchParams();
          if (sessionId) query.set('sessionId', sessionId);
          if (crossWorkspace) query.set('crossWorkspace', 'true');
          fetch('/plugins/dsh-call-session/telemetry?' + query.toString()).then(function (res) {
            if (res.ok) return res.json();
          }).then(function (data) {
            applyData(data);
          }).catch(function () {});
        }
      };

      if (React && React.useEffect) {
        React.useEffect(function () {
          ensureStyles();
          fetchSnapshot();
          var timer = setInterval(fetchSnapshot, 3000);
          return function () {
            clearInterval(timer);
            if (animFrameRef.current && typeof window !== 'undefined') {
              window.cancelAnimationFrame(animFrameRef.current);
            }
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
          };
        }, [crossWorkspace, sessionId]);

        // Keyboard navigation (ESC to close drawer)
        React.useEffect(function () {
          var handleKeyDown = function (e) {
            if (e.key === 'Escape' && selectedEntity) {
              setSelectedEntity(null);
            }
          };
          window.addEventListener('keydown', handleKeyDown);
          return function () { window.removeEventListener('keydown', handleKeyDown); };
        }, [selectedEntity]);
      }

      var handleMouseDown = function (e) {
        if (e.target.closest && (e.target.closest('.dsh-canvas-drawer') || e.target.closest('.dsh-canvas-toolbar'))) return;
        isDraggingRef.current = false;
        dragDistanceRef.current = 0;
        dragOriginRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      };

      var handleMouseMove = function (e) {
        if (dragOriginRef.current.x === 0 && dragOriginRef.current.y === 0) return;
        var dx = e.clientX - dragOriginRef.current.x;
        var dy = e.clientY - dragOriginRef.current.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        dragDistanceRef.current = dist;

        // 3px Euclidean displacement threshold to distinguish dragging from clicking
        if (dist > 3) {
          isDraggingRef.current = true;
          var nextX = dragOriginRef.current.panX + dx;
          var nextY = dragOriginRef.current.panY + dy;

          if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            if (animFrameRef.current) {
              window.cancelAnimationFrame(animFrameRef.current);
            }
            animFrameRef.current = window.requestAnimationFrame(function () {
              setPan({ x: nextX, y: nextY });
            });
          } else {
            setPan({ x: nextX, y: nextY });
          }
        }
      };

      var handleMouseUp = function () {
        dragOriginRef.current = { x: 0, y: 0, panX: 0, panY: 0 };
        isDraggingRef.current = false;
      };

      // Cursor-anchored wheel zooming
      var handleWheel = function (e) {
        if (e.target.closest && e.target.closest('.dsh-canvas-drawer')) return;
        e.preventDefault();

        var container = containerRef.current;
        var rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;

        var k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        var currentZoom = zoom;
        var nextZoom = Math.min(Math.max(currentZoom * k, 0.25), 2.5);

        if (nextZoom === currentZoom) return;

        var nextPanX = mx - (mx - pan.x) * (nextZoom / currentZoom);
        var nextPanY = my - (my - pan.y) * (nextZoom / currentZoom);

        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
      };

      var sessions = telemetry.sessions || [];
      var calls = telemetry.calls || [];
      var posts = telemetry.posts || [];
      var workspaces = telemetry.workspaces || [];
      var currentWorkspace = telemetry.currentWorkspace || '';
      var now = Date.now();

      var activePostsCount = posts.filter(function (p) { return p.status === 'active'; }).length;

      var metrics = {
        totalSessions: sessions.length,
        runningSessions: sessions.filter(function (s) { return s.state === 'running' || s.status === 'running'; }).length,
        idleSessions: sessions.filter(function (s) { return s.state !== 'running' && s.status !== 'running'; }).length,
        activeCalls: calls.filter(function (c) { return c.status === 'active'; }).length,
        totalPosts: activePostsCount
      };

      var layout = computeLayout(workspaces, sessions, posts, currentWorkspace, crossWorkspace);
      var nodePositions = layout.nodePositions;
      var workspaceBounds = layout.workspaceBounds;
      var blackboardBound = layout.blackboardBound;
      var postPositions = layout.postPositions;

      // Fit View based on content bounding box
      var fitView = function () {
        var container = containerRef.current;
        var vw = container ? container.clientWidth : 1000;
        var vh = container ? container.clientHeight : 700;

        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;

        if (blackboardBound) {
          minX = Math.min(minX, blackboardBound.x);
          minY = Math.min(minY, blackboardBound.y);
          maxX = Math.max(maxX, blackboardBound.x + blackboardBound.width);
          maxY = Math.max(maxY, blackboardBound.y + blackboardBound.height);
        }

        workspaceBounds.forEach(function (ws) {
          minX = Math.min(minX, ws.x);
          minY = Math.min(minY, ws.y);
          maxX = Math.max(maxX, ws.x + ws.width);
          maxY = Math.max(maxY, ws.y + ws.height);
        });

        Object.keys(nodePositions).forEach(function (sid) {
          var node = nodePositions[sid];
          minX = Math.min(minX, node.x - 96);
          minY = Math.min(minY, node.y - 26);
          maxX = Math.max(maxX, node.x + 96);
          maxY = Math.max(maxY, node.y + 26);
        });

        if (!isFinite(minX) || !isFinite(maxX)) {
          minX = 40; minY = 24; maxX = 1120; maxY = 650;
        }

        var contentW = maxX - minX;
        var contentH = maxY - minY;
        if (contentW < 50) contentW = 50;
        if (contentH < 50) contentH = 50;

        var padding = 48;
        var availW = Math.max(vw - padding * 2, 100);
        var availH = Math.max(vh - padding * 2, 100);

        var fitZoom = Math.min(Math.max(Math.min(availW / contentW, availH / contentH), 0.30), 1.20);
        var fitPanX = (vw - contentW * fitZoom) / 2 - minX * fitZoom;
        var fitPanY = (vh - contentH * fitZoom) / 2 - minY * fitZoom;

        setZoom(fitZoom);
        setPan({ x: fitPanX, y: fitPanY });
      };

      var zoomIn = function () {
        setZoom(Math.min(zoom + 0.2, 2.5));
      };

      var zoomOut = function () {
        setZoom(Math.max(zoom - 0.2, 0.25));
      };

      // L2 Hover Handler (150ms debounce, 100ms leave buffer)
      var handleEntityEnter = function (kind, entity, evt) {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        var cx = evt.clientX;
        var cy = evt.clientY;
        var container = containerRef.current;
        var rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
        var relX = cx - rect.left;
        var relY = cy - rect.top;

        hoverTimerRef.current = setTimeout(function () {
          setHoveredEntity({
            kind: kind,
            id: entity.id,
            entity: entity,
            x: relX,
            y: relY
          });
        }, 150);
      };

      var handleEntityLeave = function () {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }
        leaveTimerRef.current = setTimeout(function () {
          setHoveredEntity(null);
        }, 100);
      };

      // 1-Hop connected sub-graph calculation
      var connectedSessionIds = new Set();
      var connectedCallIds = new Set();
      var connectedPostIds = new Set();
      var connectedAuthorEdgeKeys = new Set();
      var connectedContextEdgeKeys = new Set();

      if (hoveredEntity) {
        var hid = hoveredEntity.id;
        var hkind = hoveredEntity.kind;

        if (hkind === 'session') {
          connectedSessionIds.add(hid);
          calls.forEach(function (call) {
            if (call.callerSessionId === hid || call.targetSessionId === hid) {
              connectedCallIds.add(call.id);
              connectedSessionIds.add(call.callerSessionId);
              connectedSessionIds.add(call.targetSessionId);
              if (Array.isArray(call.contextPostIds)) {
                call.contextPostIds.forEach(function (pid) {
                  connectedPostIds.add(pid);
                  connectedContextEdgeKeys.add(call.id + '->' + pid);
                });
              }
            }
          });
          posts.forEach(function (post) {
            if (post.authorSessionId === hid) {
              connectedPostIds.add(post.id);
              connectedAuthorEdgeKeys.add(hid + '->' + post.id);
            }
          });
        } else if (hkind === 'call') {
          var callEntity = hoveredEntity.entity;
          connectedCallIds.add(callEntity.id);
          connectedSessionIds.add(callEntity.callerSessionId);
          connectedSessionIds.add(callEntity.targetSessionId);
          if (Array.isArray(callEntity.contextPostIds)) {
            callEntity.contextPostIds.forEach(function (pid) {
              connectedPostIds.add(pid);
              connectedContextEdgeKeys.add(callEntity.id + '->' + pid);
            });
          }
        } else if (hkind === 'post') {
          var postEntity = hoveredEntity.entity;
          connectedPostIds.add(postEntity.id);
          if (postEntity.authorSessionId) {
            connectedSessionIds.add(postEntity.authorSessionId);
            connectedAuthorEdgeKeys.add(postEntity.authorSessionId + '->' + postEntity.id);
          }
          calls.forEach(function (c) {
            if (Array.isArray(c.contextPostIds) && c.contextPostIds.includes(postEntity.id)) {
              connectedCallIds.add(c.id);
              connectedSessionIds.add(c.callerSessionId);
              connectedSessionIds.add(c.targetSessionId);
              connectedContextEdgeKeys.add(c.id + '->' + postEntity.id);
            }
          });
        }
      }

      var callColors = {
        task_dispatch: '#818cf8',
        task_report: '#34d399',
        notice: '#94a3b8'
      };

      return h('div', {
        ref: containerRef,
        className: 'dsh-canvas-container',
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onWheel: handleWheel
      },
        // Top Toolbar
        h('div', { className: 'dsh-canvas-toolbar' },
          h('div', { className: 'dsh-canvas-toolbar-group' },
            h('span', { className: 'dsh-canvas-title' }, t('view.canvas')),
            h('button', {
              className: 'dsh-canvas-btn' + (crossWorkspace ? ' active' : ''),
              onClick: function () { setCrossWorkspace(!crossWorkspace); }
            }, crossWorkspace ? t('toolbar.allWorkspaces') : t('toolbar.currentWorkspace')),
            h('button', { className: 'dsh-canvas-btn', onClick: fitView }, t('toolbar.fitView')),
            h('button', { className: 'dsh-canvas-btn', onClick: zoomIn }, t('toolbar.zoomIn')),
            h('button', { className: 'dsh-canvas-btn', onClick: zoomOut }, t('toolbar.zoomOut')),
            h('button', { className: 'dsh-canvas-btn', onClick: fetchSnapshot }, t('toolbar.refresh'))
          ),
          h('div', { className: 'dsh-canvas-toolbar-group' },
            h('span', { className: 'dsh-canvas-badge green' },
              h('span', { style: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' } }),
              t('stats.runningSessions') + ': ' + metrics.runningSessions
            ),
            h('span', { className: 'dsh-canvas-badge' },
              t('stats.totalSessions') + ': ' + metrics.totalSessions
            ),
            h('span', { className: 'dsh-canvas-badge purple' },
              t('stats.activeCalls') + ': ' + metrics.activeCalls
            ),
            h('span', { className: 'dsh-canvas-badge cyan' },
              t('stats.totalPosts') + ': ' + metrics.totalPosts
            )
          )
        ),
        h('div', { className: 'dsh-canvas-viewport' },
          h('svg', {
            className: 'dsh-canvas-surface',
            style: {
              transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0px) scale(' + zoom + ')',
              willChange: 'transform',
              width: '100%',
              height: '100%'
            },
            onDoubleClick: function (e) {
              if (e.target.id === 'dsh-canvas-bg') fitView();
            }
          },
            h('defs', null,
              h('pattern', { id: 'dsh-grid-dots', width: '32', height: '32', patternUnits: 'userSpaceOnUse' },
                h('circle', { cx: '2', cy: '2', r: '1', fill: '#334155', opacity: '0.4' })
              ),
              h('marker', { id: 'dsh-arrow-dispatch', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L6,3 z', fill: '#818cf8' })
              ),
              h('marker', { id: 'dsh-arrow-report', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L6,3 z', fill: '#34d399' })
              ),
              h('marker', { id: 'dsh-arrow-notice', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L6,3 z', fill: '#94a3b8' })
              )
            ),
            h('rect', { id: 'dsh-canvas-bg', width: '16000', height: '16000', x: '-8000', y: '-8000', fill: 'url(#dsh-grid-dots)' }),

            blackboardBound ? h('g', { id: 'dsh-canvas-blackboard-layer' },
              h('rect', {
                x: blackboardBound.x,
                y: blackboardBound.y,
                width: blackboardBound.width,
                height: blackboardBound.height,
                rx: 8,
                ry: 8,
                fill: 'rgba(15, 23, 42, 0.35)',
                stroke: '#475569',
                strokeWidth: 1.2,
                strokeDasharray: '6 4'
              }),
              h('g', {
                transform: 'translate(' + (blackboardBound.x + 16) + ', ' + (blackboardBound.y + 18) + ')',
                style: { cursor: 'pointer' },
                onDoubleClick: function (e) {
                  e.stopPropagation();
                  setSelectedEntity({
                    kind: 'blackboard_hub',
                    id: 'hub',
                    topic: 'blackboard:hub',
                    activeCount: activePostsCount,
                    totalCount: posts.length,
                    summary: posts.map(function (p) {
                      return '[' + (p.status || 'active') + '] ' + p.topic + ' (by ' + computeSessionShortId(p.authorSessionId) + ')\n' + (p.content || '-');
                    }).join('\n\n') || t('blackboard.empty')
                  });
                }
              },
                h('text', { fill: '#94a3b8', fontSize: '11', fontWeight: '600' }, t('blackboard.hub')),
                h('text', { x: 62, fill: '#38bdf8', fontSize: '11', fontWeight: '600', fontFamily: 'var(--dsh-font-mono)' }, '(' + activePostsCount + ')')
              ),
              posts.map(function (post, pIdx) {
                var pos = postPositions[post.id];
                if (!pos) return null;

                var isHovered = hoveredEntity && hoveredEntity.id === post.id;
                var isConnected = connectedPostIds.has(post.id);
                var isDimmed = hoveredEntity && !isConnected && !isHovered;

                var isArchived = post.status === 'archived';
                var isExpired = post.status === 'expired';

                var strokeColor = isHovered ? '#38bdf8' : (isArchived ? '#334155' : (isExpired ? '#1e293b' : '#64748b'));
                var strokeWidth = isHovered ? '1.8' : (isArchived || isExpired ? '1' : '1.2');
                var strokeDash = isHovered ? 'none' : (isArchived ? '2 3' : (isExpired ? '1 3' : '4 3'));
                var fillColor = isHovered ? 'rgba(15, 23, 42, 0.85)' : 'rgba(30, 41, 59, 0.45)';

                var statusText = isArchived ? t('status.archived') : (isExpired ? t('status.expired') : t('status.active'));
                var statusColor = isArchived ? '#64748b' : (isExpired ? '#475569' : '#38bdf8');

                return h('g', {
                  key: post.id || pIdx,
                  transform: 'translate(' + pos.x + ', ' + pos.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onDoubleClick: function (e) {
                    e.stopPropagation();
                    setSelectedEntity({
                      kind: 'post',
                      id: post.id,
                      topic: post.topic,
                      tags: post.tags,
                      authorSessionId: post.authorSessionId,
                      workspace: post.workspace,
                      ttlRemainingMs: post.ttlRemainingMs,
                      status: post.status,
                      content: post.content,
                      metadata: post.metadata
                    });
                  },
                  onMouseEnter: function (e) { handleEntityEnter('post', post, e); },
                  onMouseLeave: handleEntityLeave
                },
                  h('rect', {
                    x: 0,
                    y: 0,
                    width: pos.width,
                    height: pos.height,
                    rx: 6,
                    ry: 6,
                    fill: fillColor,
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    strokeDasharray: strokeDash
                  }),
                  h('text', {
                    x: 10,
                    y: 20,
                    fill: '#e2e8f0',
                    fontSize: '11',
                    fontWeight: '600'
                  }, truncateTextByWidth(post.topic || 'post', 110)),
                  h('text', {
                    x: 10,
                    y: 36,
                    fill: statusColor,
                    fontSize: '10',
                    fontWeight: '500'
                  }, statusText),
                  !isArchived && !isExpired ? h('text', {
                    x: pos.width - 10,
                    y: 36,
                    textAnchor: 'end',
                    fill: '#94a3b8',
                    fontSize: '10',
                    fontFamily: 'var(--dsh-font-mono)'
                  }, formatTTL(post.ttlRemainingMs)) : null
                );
              })
            ) : null,

            h('g', { id: 'dsh-canvas-swimlanes' },
              workspaceBounds.map(function (ws) {
                var isDimmed = hoveredEntity && !sessions.some(function (s) {
                  return s.workspace === ws.id && connectedSessionIds.has(s.id);
                });

                return h('g', {
                  key: ws.id,
                  transform: 'translate(' + ws.x + ', ' + ws.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted'
                },
                  h('rect', {
                    x: 0,
                    y: 0,
                    width: ws.width,
                    height: ws.height,
                    rx: 10,
                    ry: 10,
                    fill: 'rgba(15, 23, 42, 0.2)',
                    stroke: ws.isCurrent ? '#64748b' : '#334155',
                    strokeWidth: ws.isCurrent ? '1.4' : '1.2',
                    strokeDasharray: ws.isCurrent ? '6 3' : '6 4',
                    opacity: ws.isCurrent ? 0.75 : 0.45
                  }),
                  h('g', { transform: 'translate(12, 10)' },
                    h('rect', {
                      x: 0,
                      y: 0,
                      width: ws.width - 24,
                      height: 26,
                      rx: 4,
                      fill: ws.isCurrent ? '#1e3a8a' : '#1e293b',
                      stroke: ws.isCurrent ? '#3b82f6' : '#475569',
                      strokeWidth: '1'
                    }),
                    h('text', {
                      x: 10,
                      y: 17,
                      fill: ws.isCurrent ? '#93c5fd' : '#cbd5e1',
                      fontSize: '11',
                      fontWeight: '600'
                    }, truncateTextByWidth(ws.name || 'Workspace', 160) + (ws.isCurrent ? ' [Current]' : ''))
                  )
                );
              })
            ),

            h('g', { id: 'dsh-canvas-author-edges' },
              posts.map(function (post) {
                if (!post.authorSessionId) return null;
                var source = nodePositions[post.authorSessionId];
                var targetPost = postPositions[post.id];
                if (!source || !targetPost) return null;

                var edgeKey = post.authorSessionId + '->' + post.id;
                var isHighlighted = connectedAuthorEdgeKeys.has(edgeKey);
                var isDimmed = hoveredEntity && !isHighlighted;

                // Connect from top of session ellipse to bottom of post block
                var sx = source.x;
                var sy = source.y - 26;
                var tx = targetPost.x + 90;
                var ty = targetPost.y + 48;
                var mx = (sx + tx) / 2;
                var my = (sy + ty) / 2 - 20;

                var pathD = 'M ' + sx.toFixed(1) + ' ' + sy.toFixed(1) +
                  ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) +
                  ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1);

                return h('path', {
                  key: 'author-' + edgeKey,
                  d: pathD,
                  fill: 'none',
                  stroke: isHighlighted ? '#38bdf8' : '#64748b',
                  strokeWidth: isHighlighted ? '1.8' : '1.0',
                  strokeDasharray: isHighlighted ? '4 2' : '2 4',
                  strokeOpacity: isHighlighted ? 0.9 : 0.22,
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { transition: 'stroke-width 0.18s ease, stroke-opacity 0.18s ease' }
                });
              })
            ),

            h('g', { id: 'dsh-canvas-context-edges' },
              calls.map(function (call, cIdx) {
                if (!Array.isArray(call.contextPostIds) || !call.contextPostIds.length) return null;
                var source = nodePositions[call.callerSessionId];
                var target = nodePositions[call.targetSessionId];
                if (!source || !target) return null;

                var dx = target.x - source.x;
                var dy = target.y - source.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) dist = 1;

                var spread = (cIdx % 2 === 0 ? 1 : -1) * Math.min(30 + Math.floor(cIdx / 2) * 20, 80);
                var nx = -dy / dist;
                var ny = dx / dist;
                var mx = (source.x + target.x) / 2 + nx * spread;
                var my = (source.y + target.y) / 2 + ny * spread;

                var startClip = getEllipseIntersection(source.x, source.y, mx, my, 96, 26);
                var endClip = getEllipseIntersection(target.x, target.y, mx, my, 96, 26);

                var callMidX = 0.25 * startClip.x + 0.5 * mx + 0.25 * endClip.x;
                var callMidY = 0.25 * startClip.y + 0.5 * my + 0.25 * endClip.y;

                return call.contextPostIds.map(function (pid) {
                  var pPos = postPositions[pid];
                  if (!pPos) return null;

                  var edgeKey = call.id + '->' + pid;
                  var isHighlighted = connectedContextEdgeKeys.has(edgeKey);
                  var isDimmed = hoveredEntity && !isHighlighted;

                  var tx = pPos.x + 90;
                  var ty = pPos.y + 48;
                  var cx = (callMidX + tx) / 2;
                  var cy = (callMidY + ty) / 2 - 15;

                  var pathD = 'M ' + callMidX.toFixed(1) + ' ' + callMidY.toFixed(1) +
                    ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) +
                    ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1);

                  return h('path', {
                    key: 'ctx-' + edgeKey,
                    d: pathD,
                    fill: 'none',
                    stroke: isHighlighted ? '#fbbf24' : '#475569',
                    strokeWidth: isHighlighted ? '1.6' : '0.8',
                    strokeDasharray: isHighlighted ? '3 3' : '2 4',
                    strokeOpacity: isHighlighted ? 0.85 : 0.12,
                    className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                    style: { transition: 'stroke-width 0.18s ease, stroke-opacity 0.18s ease' }
                  });
                });
              })
            ),

            h('g', { id: 'dsh-canvas-call-edges' },
              calls.map(function (call, cIdx) {
                var source = nodePositions[call.callerSessionId];
                var target = nodePositions[call.targetSessionId];
                if (!source || !target) return null;

                var decay = getCallEdgeDecay(call, now);
                var isCallHovered = hoveredEntity && hoveredEntity.id === call.id;
                var isConnected = connectedCallIds.has(call.id);
                var isDimmed = hoveredEntity && !isConnected && !isCallHovered;

                var strokeColor = callColors[call.callType] || '#818cf8';
                var markerUrl = call.callType === 'task_report'
                  ? 'url(#dsh-arrow-report)'
                  : call.callType === 'notice'
                    ? 'url(#dsh-arrow-notice)'
                    : 'url(#dsh-arrow-dispatch)';

                var dx = target.x - source.x;
                var dy = target.y - source.y;
                var dist = Math.sqrt(dx * dx + dy * dy);

                var pathD = '';
                if (dist < 2) {
                  pathD = calculateBezierPath(source.x, source.y, target.x, target.y, cIdx, calls.length);
                } else {
                  var spread = (cIdx % 2 === 0 ? 1 : -1) * Math.min(30 + Math.floor(cIdx / 2) * 20, 80);
                  var nx = -dy / dist;
                  var ny = dx / dist;
                  var mx = (source.x + target.x) / 2 + nx * spread;
                  var my = (source.y + target.y) / 2 + ny * spread;

                  var pStart = getEllipseIntersection(source.x, source.y, mx, my, 96, 26);
                  var pEnd = getEllipseIntersection(target.x, target.y, mx, my, 96, 26);
                  pathD = 'M ' + pStart.x.toFixed(1) + ' ' + pStart.y.toFixed(1) +
                    ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) +
                    ' ' + pEnd.x.toFixed(1) + ' ' + pEnd.y.toFixed(1);
                }

                return h('g', {
                  key: call.id || cIdx,
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onMouseEnter: function (e) { handleEntityEnter('call', call, e); },
                  onMouseLeave: handleEntityLeave,
                  onDoubleClick: function (e) {
                    e.stopPropagation();
                    setSelectedEntity({
                      kind: 'call',
                      id: call.id,
                      callType: call.callType,
                      deliveryMode: call.deliveryMode,
                      durationMs: call.durationMs,
                      timestamp: call.timestamp,
                      callerSessionId: call.callerSessionId,
                      callerTitle: call.callerTitle,
                      targetSessionId: call.targetSessionId,
                      targetTitle: call.targetTitle,
                      contextPostIds: call.contextPostIds,
                      messageSnippet: call.messageSnippet,
                      messagePayload: call.messagePayload,
                      status: call.status
                    });
                  }
                },
                  // Transparent wider click path
                  h('path', {
                    d: pathD,
                    fill: 'none',
                    stroke: 'transparent',
                    strokeWidth: '14'
                  }),
                  h('path', {
                    d: pathD,
                    fill: 'none',
                    stroke: isCallHovered || isConnected ? strokeColor : strokeColor,
                    strokeWidth: isCallHovered || isConnected ? '2.2' : String(decay.strokeWidth),
                    opacity: isCallHovered || isConnected ? 1.0 : decay.opacity,
                    strokeDasharray: isCallHovered || isConnected ? 'none' : (decay.isFlowing ? '6 4' : '4 4'),
                    markerEnd: markerUrl,
                    className: decay.className,
                    style: { transition: 'stroke-width 0.18s ease, opacity 0.18s ease' }
                  })
                );
              })
            ),

            h('g', { id: 'dsh-canvas-nodes' },
              Object.keys(nodePositions).map(function (sid) {
                var node = nodePositions[sid];
                var session = node.session;
                var isRunning = session.state === 'running' || session.status === 'running';
                var isSessionHovered = hoveredEntity && hoveredEntity.id === sid;
                var isConnected = connectedSessionIds.has(sid);
                var isDimmed = hoveredEntity && !isConnected && !isSessionHovered;
                var shortId = session.shortId || computeSessionShortId(sid);

                var strokeColor = isSessionHovered
                  ? (isRunning ? '#4ade80' : '#93c5fd')
                  : (isRunning ? '#22c55e' : '#64748b');
                var strokeWidth = isSessionHovered ? '2.2' : (isRunning ? '1.5' : '1.2');
                var strokeDash = isSessionHovered ? 'none' : (isRunning ? '5 3' : '4 4');

                return h('g', {
                  key: sid,
                  transform: 'translate(' + node.x + ', ' + node.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: {
                    cursor: 'pointer',
                    transition: 'opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
                  },
                  onMouseEnter: function (e) { handleEntityEnter('session', session, e); },
                  onMouseLeave: handleEntityLeave,
                  onDoubleClick: function (e) {
                    e.stopPropagation();
                    setSelectedEntity({
                      kind: 'session',
                      id: sid,
                      sessionId: sid,
                      title: session.title,
                      cwd: session.workspace || session.cwd,
                      workspace: session.workspace || session.cwd,
                      status: isRunning ? 'running' : 'idle',
                      agentType: session.agentType,
                      stats: session.stats || { callsIn: 0, callsOut: 0, postsCount: 0 }
                    });
                  }
                },
                  h('ellipse', {
                    cx: 0,
                    cy: 0,
                    rx: 96,
                    ry: 26,
                    fill: '#090d16',
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    strokeDasharray: strokeDash
                  }),
                  h('circle', {
                    cx: -68,
                    cy: 0,
                    r: 4.5,
                    fill: isRunning ? '#22c55e' : '#64748b',
                    className: isRunning ? 'dsh-pulse-dot' : ''
                  }),
                  h('text', {
                    x: -52,
                    y: -2,
                    fill: '#38bdf8',
                    fontSize: '11',
                    fontFamily: 'var(--dsh-font-mono)',
                    fontWeight: '600'
                  }, shortId),
                  h('text', {
                    x: -52,
                    y: 12,
                    fill: '#f1f5f9',
                    fontSize: '11',
                    fontFamily: 'var(--dsh-font-sans)'
                  }, truncateTextByWidth(session.title || 'Session', 105)),
                  session.stats && (session.stats.outboundCalls || session.stats.inboundCalls) ? h('g', { transform: 'translate(70, 0)' },
                    h('circle', { r: 9, fill: '#1e293b', stroke: '#334155', strokeWidth: 1 }),
                    h('text', {
                      y: 3,
                      textAnchor: 'middle',
                      fill: '#94a3b8',
                      fontSize: '9',
                      fontWeight: '600',
                      fontFamily: 'var(--dsh-font-mono)'
                    }, String((session.stats.outboundCalls || 0) + (session.stats.inboundCalls || 0)))
                  ) : null
                );
              })
            )
          ),

          hoveredEntity ? (function () {
            var ent = hoveredEntity.entity;
            var kind = hoveredEntity.kind;
            var tipX = Math.min(Math.max(12, hoveredEntity.x + 12), (containerRef.current?.clientWidth || 800) - 280);
            var tipY = Math.min(Math.max(12, hoveredEntity.y + 12), (containerRef.current?.clientHeight || 600) - 160);

            if (kind === 'session') {
              return h('div', {
                className: 'dsh-canvas-tooltip',
                style: { left: tipX + 'px', top: tipY + 'px' }
              },
                h('div', { className: 'dsh-canvas-tooltip-header' },
                  h('span', null, ent.shortId || computeSessionShortId(ent.id)),
                  h('span', { style: { color: ent.state === 'running' || ent.status === 'running' ? '#22c55e' : '#94a3b8' } },
                    ent.state === 'running' || ent.status === 'running' ? t('session.running') : t('session.idle'))
                ),
                h('div', { style: { fontWeight: '500', color: '#f1f5f9', marginBottom: '4px' } }, ent.title || 'Session'),
                h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.workspace')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, ent.workspace ? ent.workspace.split(/[\\/]/).filter(Boolean).pop() : '-')
                ),
                h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.callsIn') + ' / ' + t('drawer.callsOut')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, (ent.stats?.inboundCalls || 0) + ' / ' + (ent.stats?.outboundCalls || 0))
                )
              );
            } else if (kind === 'call') {
              return h('div', {
                className: 'dsh-canvas-tooltip',
                style: { left: tipX + 'px', top: tipY + 'px' }
              },
                h('div', { className: 'dsh-canvas-tooltip-header' },
                  h('span', null, t('call.' + (ent.callType === 'task_dispatch' ? 'dispatch' : ent.callType === 'task_report' ? 'report' : 'notice')) || ent.callType),
                  h('span', { style: { color: '#38bdf8' } }, t('call.' + ent.deliveryMode) || ent.deliveryMode)
                ),
                h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.duration')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, (ent.durationMs || 0) + 'ms')
                ),
                h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.contextPostIds')),
                  h('span', null, (ent.contextPostIds ? ent.contextPostIds.length : 0))
                ),
                ent.messageSnippet ? h('div', { style: { marginTop: '4px', color: '#cbd5e1', fontSize: '10px' } }, ent.messageSnippet) : null
              );
            } else if (kind === 'post') {
              return h('div', {
                className: 'dsh-canvas-tooltip',
                style: { left: tipX + 'px', top: tipY + 'px' }
              },
                h('div', { className: 'dsh-canvas-tooltip-header' },
                  h('span', null, ent.topic),
                  h('span', { style: { color: ent.status === 'archived' ? '#64748b' : (ent.status === 'expired' ? '#475569' : '#38bdf8') } },
                    ent.status === 'archived' ? t('status.archived') : (ent.status === 'expired' ? t('status.expired') : t('status.active')))
                ),
                h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.author')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, computeSessionShortId(ent.authorSessionId))
                ),
                ent.status === 'active' || (!ent.status && ent.ttlRemainingMs > 0) ? h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.ttl')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, formatTTL(ent.ttlRemainingMs))
                ) : null
              );
            }
            return null;
          })() : null,

          sessions.length === 0 ? h('div', {
            style: {
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              maxWidth: '420px',
              padding: '24px'
            }
          },
            h('div', {
              style: {
                fontSize: '14px',
                fontWeight: '600',
                color: '#f1f5f9',
                marginBottom: '8px'
              }
            }, t('empty.title')),
            h('div', {
              style: {
                fontSize: '12px',
                color: '#94a3b8',
                lineHeight: '1.6'
              }
            }, t('empty.desc'))
          ) : null
        ),
        h(CanvasDrawer, {
          entity: selectedEntity,
          onClose: function () { setSelectedEntity(null); },
          t: t,
          copiedKey: copiedKey,
          setCopiedKey: setCopiedKey
        })
      );
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: zh,
          en: en
        });
      }, 'dsh-canvas: dictionaries');

      var t = ctx.locale.bind(NS);

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register({
          name: 'conversation.view',
          id: 'canvas',
          order: 15,
          locale: NS,
          label: function () { return t('view.canvas'); },
          inject: function (sessionId) {
            return {
              sessionId: sessionId,
              fetchTelemetry: function (options) {
                if (typeof ctx.get === 'function' && ctx.get('canvasTelemetry') && ctx.get('canvasTelemetry').getSnapshot) {
                  return ctx.get('canvasTelemetry').getSnapshot(options);
                }
                if (typeof fetch === 'function') {
                  var query = new URLSearchParams();
                  if (sessionId) query.set('sessionId', sessionId);
                  if (options && options.crossWorkspace) query.set('crossWorkspace', 'true');
                  if (options && options.limit) query.set('limit', String(options.limit));
                  return fetch('/plugins/dsh-call-session/telemetry?' + query.toString()).then(function (res) {
                    if (res.ok) return res.json();
                    return null;
                  }).catch(function () { return null; });
                }
                return Promise.resolve(null);
              }
            };
          }
        }, CanvasView);
      });
    }

    return {
      name: 'dsh-call-session/client',
      inject: inject,
      apply: apply,
      NS: NS,
      zh: zh,
      en: en,
      CanvasView: CanvasView,
      CanvasDrawer: CanvasDrawer,
      calculateBezierPath: calculateBezierPath,
      getCallEdgeDecay: getCallEdgeDecay,
      computeLayout: computeLayout,
      formatTTL: formatTTL,
      formatTime: formatTime
    };
  }

  // Register with DSH client module system if running in browser
  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-call-session',
      factory: function (requireFn) {
        return createClientPlugin(requireFn);
      }
    });
  }

  // Support CommonJS / Node.js import for test suites
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = createClientPlugin(typeof require === 'function' ? require : null);
  }
})();
