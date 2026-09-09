/**
 * DSH Collaboration Canvas Web Client Plugin
 * Registers conversation.view Tab「看板」
 *
 * Implements 60fps GPU-accelerated visual topology canvas:
 * - Top blackboard post pills & hub
 * - Multi-workspace swimlanes / clusters
 * - Session state breathing pulse nodes (running/idle)
 * - Three-state time-decay connection lines (task_dispatch, task_report, notice)
 * - Hover 1-hop connected focus lighting (20% dimming invariant)
 * - Double-click / Click slide-over read-only inspector drawer (420px)
 * - Zero emoji, anti-slop professional engineering aesthetic
 */

(function () {
  'use strict';

  var NS = 'dsh-canvas';

  var zh = {
    'view.canvas': '看板',
    'toolbar.workspace': '工作区',
    'toolbar.currentWorkspace': '当前工程',
    'toolbar.allWorkspaces': '多工程泳道',
    'toolbar.fitView': '重置视口',
    'toolbar.refresh': '刷新',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomOut': '缩小',
    'stats.totalSessions': '会话',
    'stats.runningSessions': '运行',
    'stats.idleSessions': '就绪',
    'stats.totalPosts': '黑板条目',
    'stats.activeCalls': '活跃连线',
    'blackboard.hub': '公共黑板',
    'blackboard.empty': '黑板暂无活跃条目',
    'blackboard.activePosts': '条活跃公告',
    'blackboard.topic': '主题',
    'blackboard.tags': '标签',
    'blackboard.ttl': '有效剩余',
    'session.running': '运行中',
    'session.idle': '就绪',
    'session.offline': '已离线',
    'call.dispatch': '任务派发',
    'call.report': '任务汇报',
    'call.notice': '状态同步',
    'call.steer': '引导 steer',
    'call.followup': '唤醒 followup',
    'drawer.title': '实体详情透视',
    'drawer.readonlyBadge': '只读',
    'drawer.copy': '复制',
    'drawer.copied': '已复制',
    'drawer.close': '关闭',
    'drawer.metadataSection': '核心元数据',
    'drawer.lineageSection': '关联链路',
    'drawer.payloadSection': '正文载荷 只读',
    'drawer.sessionId': '会话 ID',
    'drawer.sessionTitle': '会话标题',
    'drawer.workspace': '工作区根目录',
    'drawer.status': '运行状态',
    'drawer.agentType': '智能体类型',
    'drawer.callsIn': '呼入统计',
    'drawer.callsOut': '呼出统计',
    'drawer.postsCount': '黑板发布',
    'drawer.callId': '调用流水号',
    'drawer.callType': '调用意图',
    'drawer.deliveryMode': '交付模式',
    'drawer.duration': '投递耗时',
    'drawer.timestamp': '发生时间',
    'drawer.caller': '发起方会话',
    'drawer.target': '接收方会话',
    'drawer.contextPostIds': '关联黑板条目',
    'drawer.messageSnippet': '消息摘要',
    'drawer.messagePayload': '消息正文 只读',
    'drawer.postId': '条目 ID',
    'drawer.topic': '业务主题',
    'drawer.tags': '标签列表',
    'drawer.author': '发布会话',
    'drawer.ttl': '剩余生存期',
    'drawer.content': '条目正文',
    'empty.title': '协作拓扑就绪',
    'empty.desc': '当前工作区暂未检测到其他活跃会话或黑板数据。发起 session_call 或发布 board_post 后拓扑将实时流转。'
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
    'stats.totalPosts': 'Board Posts',
    'stats.activeCalls': 'Active Calls',
    'blackboard.hub': 'Blackboard Hub',
    'blackboard.empty': 'No active blackboard posts',
    'blackboard.activePosts': 'active posts',
    'blackboard.topic': 'Topic',
    'blackboard.tags': 'Tags',
    'blackboard.ttl': 'TTL Left',
    'session.running': 'Running',
    'session.idle': 'Idle',
    'session.offline': 'Offline',
    'call.dispatch': 'Task Dispatch',
    'call.report': 'Task Report',
    'call.notice': 'Notice',
    'call.steer': 'Steer',
    'call.followup': 'Followup',
    'drawer.title': 'Entity Inspector',
    'drawer.readonlyBadge': 'READ-ONLY',
    'drawer.copy': 'Copy',
    'drawer.copied': 'Copied',
    'drawer.close': 'Close',
    'drawer.metadataSection': 'Core Metadata',
    'drawer.lineageSection': 'Related Lineage',
    'drawer.payloadSection': 'Message Payload (Read-only)',
    'drawer.sessionId': 'Session ID',
    'drawer.sessionTitle': 'Session Title',
    'drawer.workspace': 'Workspace Dir',
    'drawer.status': 'Status',
    'drawer.agentType': 'Agent Type',
    'drawer.callsIn': 'Inbound Calls',
    'drawer.callsOut': 'Outbound Calls',
    'drawer.postsCount': 'Blackboard Posts',
    'drawer.callId': 'Trace ID',
    'drawer.callType': 'Call Type',
    'drawer.deliveryMode': 'Delivery Mode',
    'drawer.duration': 'Duration',
    'drawer.timestamp': 'Timestamp',
    'drawer.caller': 'Caller Session',
    'drawer.target': 'Target Session',
    'drawer.contextPostIds': 'Linked Post IDs',
    'drawer.messageSnippet': 'Snippet',
    'drawer.messagePayload': 'Message Payload (Read-only)',
    'drawer.postId': 'Post ID',
    'drawer.topic': 'Topic',
    'drawer.tags': 'Tags',
    'drawer.author': 'Author Session',
    'drawer.ttl': 'TTL Left',
    'drawer.content': 'Post Content',
    'empty.title': 'Collaboration Canvas Ready',
    'empty.desc': 'No active peer sessions or blackboard posts detected. Topology will stream dynamically as sessions communicate.'
  };

  var inject = ['slots', 'locale'];

  var CANVAS_CSS = [
    '.dsh-canvas-container {',
    '  position: relative;',
    '  width: 100%;',
    '  height: 100%;',
    '  background-color: #0b0f19;',
    '  color: #e2e8f0;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
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
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
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
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
    '  font-size: 12px;',
    '  line-height: 1.5;',
    '  color: #cbd5e1;',
    '  max-height: 220px;',
    '  overflow-y: auto;',
    '  white-space: pre-wrap;',
    '  word-break: break-word;',
    '}',
    '@keyframes dshPulseDot {',
    '  0% { transform: scale(0.95); opacity: 0.8; }',
    '  50% { transform: scale(1.25); opacity: 1; }',
    '  100% { transform: scale(0.95); opacity: 0.8; }',
    '}',
    '.dsh-pulse-dot {',
    '  animation: dshPulseDot 2s infinite ease-in-out;',
    '  transform-origin: center;',
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
        setCopiedKey(key);
        setTimeout(function () { setCopiedKey(null); }, 1400);
      }).catch(function () {});
    }
  }

  /**
   * Generates a curved quadratic Bezier path string between two nodes
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
   * Multi-workspace and session layout engine
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

    // Filter to current workspace when crossWorkspace is disabled
    var activeWorkspaces = crossWorkspace
      ? wsList
      : wsList.filter(function (w) { return w.isCurrent; });
    if (!activeWorkspaces.length && wsList.length) {
      activeWorkspaces = [wsList[0]];
    }

    var nodePositions = {};
    var workspaceBounds = [];

    var startX = 60;
    var startY = 120;
    var swimlaneWidth = 460;
    var swimlaneMinHeight = 440;

    activeWorkspaces.forEach(function (ws, wsIdx) {
      var wsX = startX + wsIdx * (swimlaneWidth + 30);
      var wsSessions = (sessions || []).filter(function (s) {
        if (ws.sessionIds && ws.sessionIds.length) {
          return ws.sessionIds.includes(s.id);
        }
        return s.workspace === ws.id;
      });

      var rowsCount = Math.max(Math.ceil(wsSessions.length / 2), 2);
      var wsHeight = Math.max(swimlaneMinHeight, 80 + rowsCount * 85);

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
        var col = sIdx % 2;
        var row = Math.floor(sIdx / 2);
        var cx = wsX + 115 + col * 230;
        var cy = startY + 80 + row * 85;

        nodePositions[session.id] = {
          x: cx,
          y: cy,
          session: session
        };
      });
    });

    return {
      workspaceBounds: workspaceBounds,
      nodePositions: nodePositions
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

        lineageRows.push(renderField(t('drawer.caller'), (entity.callerTitle ? entity.callerTitle + ' (' + entity.callerSessionId.slice(0, 8) + ')' : entity.callerSessionId), 'callerSessionId'));
        lineageRows.push(renderField(t('drawer.target'), (entity.targetTitle ? entity.targetTitle + ' (' + entity.targetSessionId.slice(0, 8) + ')' : entity.targetSessionId), 'targetSessionId'));
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
        metadataRows.push(renderField(t('drawer.tags'), Array.isArray(entity.tags) && entity.tags.length ? entity.tags.join(', ') : '-'));
        metadataRows.push(renderField(t('drawer.ttl'), formatTTL(entity.ttlRemainingMs || (entity.ttl ? entity.ttl * 1000 : 0))));

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
      }

      return h('div', { className: 'dsh-canvas-drawer' },
        h('div', { className: 'dsh-canvas-drawer-header' },
          h('div', { className: 'dsh-canvas-drawer-title' },
            h('span', null, t('drawer.title')),
            h('span', { className: 'dsh-canvas-drawer-readonly' }, t('drawer.readonlyBadge'))
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

      var hoveredEntityState = React ? React.useState(null) : [null, function () {}];
      var hoveredEntityId = hoveredEntityState[0];
      var setHoveredEntityId = hoveredEntityState[1];

      var panState = React ? React.useState({ x: 0, y: 0 }) : [{ x: 0, y: 0 }, function () {}];
      var pan = panState[0];
      var setPan = panState[1];

      var zoomState = React ? React.useState(1) : [1, function () {}];
      var zoom = zoomState[0];
      var setZoom = zoomState[1];

      var copiedKeyState = React ? React.useState(null) : [null, function () {}];
      var copiedKey = copiedKeyState[0];
      var setCopiedKey = copiedKeyState[1];

      var isDraggingRef = React ? React.useRef(false) : { current: false };
      var dragOriginRef = React ? React.useRef({ x: 0, y: 0 }) : { current: { x: 0, y: 0 } };

      var fetchSnapshot = function () {
        if (typeof props.fetchTelemetry === 'function') {
          props.fetchTelemetry({ crossWorkspace: crossWorkspace }).then(function (data) {
            if (data) setTelemetry(data);
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
            if (data) setTelemetry(data);
          }).catch(function () {});
        }
      };

      if (React && React.useEffect) {
        React.useEffect(function () {
          ensureStyles();
          fetchSnapshot();
          var timer = setInterval(fetchSnapshot, 3000);
          return function () { clearInterval(timer); };
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
        if (e.target.closest('.dsh-canvas-drawer') || e.target.closest('.dsh-canvas-toolbar')) return;
        isDraggingRef.current = true;
        dragOriginRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      };

      var handleMouseMove = function (e) {
        if (!isDraggingRef.current) return;
        // RAF-based batching for 60fps pan
        var nextX = e.clientX - dragOriginRef.current.x;
        var nextY = e.clientY - dragOriginRef.current.y;
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          window.requestAnimationFrame(function () {
            setPan({ x: nextX, y: nextY });
          });
        } else {
          setPan({ x: nextX, y: nextY });
        }
      };

      var handleMouseUp = function () {
        isDraggingRef.current = false;
      };

      var handleWheel = function (e) {
        if (e.target.closest('.dsh-canvas-drawer')) return;
        e.preventDefault();
        var delta = e.deltaY < 0 ? 0.1 : -0.1;
        var nextZoom = Math.min(Math.max(zoom + delta, 0.25), 2.5);
        setZoom(nextZoom);
      };

      var resetView = function () {
        setPan({ x: 0, y: 0 });
        setZoom(1);
      };

      var zoomIn = function () {
        setZoom(Math.min(zoom + 0.2, 2.5));
      };

      var zoomOut = function () {
        setZoom(Math.max(zoom - 0.2, 0.25));
      };

      var sessions = telemetry.sessions || [];
      var calls = telemetry.calls || [];
      var posts = telemetry.posts || [];
      var workspaces = telemetry.workspaces || [];
      var currentWorkspace = telemetry.currentWorkspace || '';
      var now = Date.now();

      var metrics = telemetry.metrics || {
        totalSessions: sessions.length,
        runningSessions: sessions.filter(function (s) { return s.state === 'running' || s.status === 'running'; }).length,
        activeCalls: calls.filter(function (c) { return c.status === 'active'; }).length,
        totalPosts: posts.filter(function (p) { return !p.isDismissed; }).length
      };

      // 1-Hop connected sub-graph calculation for L2 hover
      var connectedSessionIds = new Set();
      var connectedCallIds = new Set();
      var connectedPostIds = new Set();

      if (hoveredEntityId) {
        connectedSessionIds.add(hoveredEntityId);
        calls.forEach(function (call) {
          if (call.callerSessionId === hoveredEntityId || call.targetSessionId === hoveredEntityId) {
            connectedCallIds.add(call.id);
            connectedSessionIds.add(call.callerSessionId);
            connectedSessionIds.add(call.targetSessionId);
            if (Array.isArray(call.contextPostIds)) {
              call.contextPostIds.forEach(function (pid) { connectedPostIds.add(pid); });
            }
          }
        });
        posts.forEach(function (post) {
          if (post.authorSessionId === hoveredEntityId || connectedPostIds.has(post.id)) {
            connectedPostIds.add(post.id);
          }
        });
      }

      // Compute visual layout for workspaces and nodes
      var layout = computeLayout(workspaces, sessions, posts, currentWorkspace, crossWorkspace);
      var nodePositions = layout.nodePositions;
      var workspaceBounds = layout.workspaceBounds;

      // Color mapping for call types
      var callColors = {
        task_dispatch: '#8b5cf6',
        task_report: '#10b981',
        notice: '#06b6d4'
      };

      return h('div', {
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
            h('button', { className: 'dsh-canvas-btn', onClick: resetView }, t('toolbar.fitView')),
            h('button', { className: 'dsh-canvas-btn', onClick: zoomIn }, t('toolbar.zoomIn')),
            h('button', { className: 'dsh-canvas-btn', onClick: zoomOut }, t('toolbar.zoomOut')),
            h('button', { className: 'dsh-canvas-btn', onClick: fetchSnapshot }, t('toolbar.refresh'))
          ),
          h('div', { className: 'dsh-canvas-toolbar-group' },
            h('span', { className: 'dsh-canvas-badge green' },
              h('span', { style: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' } }),
              t('stats.runningSessions') + ': ' + (metrics.runningSessions || 0)
            ),
            h('span', { className: 'dsh-canvas-badge' },
              t('stats.totalSessions') + ': ' + (metrics.totalSessions || 0)
            ),
            h('span', { className: 'dsh-canvas-badge purple' },
              t('stats.activeCalls') + ': ' + (metrics.activeCalls || 0)
            ),
            h('span', { className: 'dsh-canvas-badge cyan' },
              t('stats.totalPosts') + ': ' + (metrics.totalPosts || 0)
            )
          )
        ),
        // Topology Canvas Viewport
        h('div', { className: 'dsh-canvas-viewport' },
          h('svg', {
            className: 'dsh-canvas-surface',
            style: {
              transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0px) scale(' + zoom + ')',
              willChange: 'transform',
              width: '100%',
              height: '100%'
            }
          },
            h('defs', null,
              h('pattern', { id: 'dsh-grid-dots', width: '32', height: '32', patternUnits: 'userSpaceOnUse' },
                h('circle', { cx: '2', cy: '2', r: '1', fill: '#334155', opacity: '0.4' })
              ),
              h('marker', { id: 'dsh-arrow-dispatch', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#8b5cf6' })
              ),
              h('marker', { id: 'dsh-arrow-report', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#10b981' })
              ),
              h('marker', { id: 'dsh-arrow-notice', markerWidth: '8', markerHeight: '8', refX: '6', refY: '3', orient: 'auto' },
                h('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#06b6d4' })
              )
            ),
            h('rect', { width: '8000', height: '8000', x: '-4000', y: '-4000', fill: 'url(#dsh-grid-dots)' }),

            // Layer 1: Blackboard Top Pills & Hub
            h('g', { id: 'dsh-canvas-blackboard-hub', transform: 'translate(60, 20)' },
              // Blackboard Hub Header
              h('g', {
                style: { cursor: 'pointer' },
                onClick: function () {
                  setSelectedEntity({
                    kind: 'post',
                    id: 'hub',
                    topic: 'blackboard:hub',
                    tags: ['hub', 'shared'],
                    ttlRemainingMs: 3600000,
                    content: posts.length ? JSON.stringify(posts, null, 2) : t('blackboard.empty')
                  });
                }
              },
                h('rect', {
                  x: '0',
                  y: '0',
                  width: '160',
                  height: '32',
                  rx: '6',
                  fill: '#1e293b',
                  stroke: '#3b82f6',
                  strokeWidth: '1.2'
                }),
                h('text', {
                  x: '80',
                  y: '20',
                  textAnchor: 'middle',
                  fill: '#f8fafc',
                  fontSize: '11',
                  fontWeight: '600'
                }, t('blackboard.hub') + ' (' + posts.length + ')')
              ),
              // Blackboard Post Pills Row
              posts.slice(0, 10).map(function (post, pIdx) {
                var pillX = 180 + pIdx * 170;
                var isHovered = hoveredEntityId === post.id;
                var isDimmed = hoveredEntityId && !connectedPostIds.has(post.id);
                var isDismissed = post.isDismissed;

                return h('g', {
                  key: post.id || pIdx,
                  transform: 'translate(' + pillX + ', 0)',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onDoubleClick: function () {
                    setSelectedEntity({
                      kind: 'post',
                      id: post.id,
                      topic: post.topic,
                      tags: post.tags,
                      authorSessionId: post.authorSessionId,
                      workspace: post.workspace,
                      ttlRemainingMs: post.ttlRemainingMs,
                      content: post.content,
                      metadata: post.metadata
                    });
                  },
                  onClick: function () {
                    setSelectedEntity({
                      kind: 'post',
                      id: post.id,
                      topic: post.topic,
                      tags: post.tags,
                      authorSessionId: post.authorSessionId,
                      workspace: post.workspace,
                      ttlRemainingMs: post.ttlRemainingMs,
                      content: post.content,
                      metadata: post.metadata
                    });
                  }
                },
                  h('rect', {
                    x: '0',
                    y: '0',
                    width: '160',
                    height: '32',
                    rx: '16',
                    fill: isHovered ? '#1e293b' : (isDismissed ? '#1e293b' : '#0f172a'),
                    stroke: isHovered ? '#60a5fa' : (isDismissed ? '#475569' : '#0284c7'),
                    strokeWidth: isHovered ? '2' : '1.2',
                    strokeDasharray: isDismissed ? '3 3' : 'none'
                  }),
                  h('text', {
                    x: '14',
                    y: '20',
                    fill: '#f1f5f9',
                    fontSize: '10',
                    fontWeight: '600'
                  }, (post.topic || 'post').slice(0, 14)),
                  h('text', {
                    x: '146',
                    y: '20',
                    textAnchor: 'end',
                    fill: '#94a3b8',
                    fontSize: '9',
                    fontFamily: 'ui-monospace, monospace'
                  }, formatTTL(post.ttlRemainingMs))
                );
              })
            ),

            // Layer 2: Workspace Swimlanes
            h('g', { id: 'dsh-canvas-swimlanes' },
              workspaceBounds.map(function (ws) {
                var isDimmed = hoveredEntityId && !sessions.some(function (s) {
                  return s.workspace === ws.id && connectedSessionIds.has(s.id);
                });

                return h('g', {
                  key: ws.id,
                  transform: 'translate(' + ws.x + ', ' + ws.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted'
                },
                  h('rect', {
                    x: '0',
                    y: '0',
                    width: ws.width,
                    height: ws.height,
                    rx: '12',
                    fill: 'rgba(15, 23, 42, 0.45)',
                    stroke: ws.isCurrent ? 'rgba(59, 130, 246, 0.5)' : '#334155',
                    strokeWidth: '1.2',
                    strokeDasharray: '6 4'
                  }),
                  // Workspace Header Badge
                  h('g', { transform: 'translate(16, 16)' },
                    h('rect', {
                      x: '0',
                      y: '0',
                      width: '180',
                      height: '26',
                      rx: '4',
                      fill: ws.isCurrent ? '#1e3a8a' : '#1e293b',
                      stroke: ws.isCurrent ? '#3b82f6' : '#475569',
                      strokeWidth: '1'
                    }),
                    h('text', {
                      x: '12',
                      y: '17',
                      fill: ws.isCurrent ? '#93c5fd' : '#cbd5e1',
                      fontSize: '11',
                      fontWeight: '600'
                    }, (ws.name || 'Workspace').slice(0, 18) + (ws.isCurrent ? ' *' : ''))
                  )
                );
              })
            ),

            // Layer 3: Three-State Time-Decayed Bezier Call Lines
            h('g', { id: 'dsh-canvas-call-edges' },
              calls.map(function (call, cIdx) {
                var source = nodePositions[call.callerSessionId];
                var target = nodePositions[call.targetSessionId];
                if (!source || !target) return null;

                var decay = getCallEdgeDecay(call, now);
                var isCallHovered = hoveredEntityId === call.id;
                var isConnected = connectedCallIds.has(call.id);
                var isDimmed = hoveredEntityId && !isConnected && !isCallHovered;

                var strokeColor = callColors[call.callType] || '#8b5cf6';
                var markerUrl = call.callType === 'task_report'
                  ? 'url(#dsh-arrow-report)'
                  : call.callType === 'notice'
                    ? 'url(#dsh-arrow-notice)'
                    : 'url(#dsh-arrow-dispatch)';

                var pathD = calculateBezierPath(source.x, source.y, target.x, target.y, cIdx, calls.length);

                return h('g', {
                  key: call.id || cIdx,
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onMouseEnter: function () { setHoveredEntityId(call.id); },
                  onMouseLeave: function () { setHoveredEntityId(null); },
                  onDoubleClick: function () {
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
                  },
                  onClick: function () {
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
                  // Background wider click target
                  h('path', {
                    d: pathD,
                    fill: 'none',
                    stroke: 'transparent',
                    strokeWidth: '14'
                  }),
                  // Visible decayed bezier line
                  h('path', {
                    d: pathD,
                    fill: 'none',
                    stroke: strokeColor,
                    strokeWidth: isCallHovered || isConnected ? '2.8' : String(decay.strokeWidth),
                    opacity: isCallHovered || isConnected ? 1 : decay.opacity,
                    markerEnd: markerUrl,
                    className: decay.className,
                    style: {
                      transition: 'stroke-width 0.18s ease, opacity 0.18s ease'
                    }
                  })
                );
              })
            ),

            // Layer 4: Session Breathing Pulse Nodes
            h('g', { id: 'dsh-canvas-nodes' },
              Object.keys(nodePositions).map(function (sid) {
                var node = nodePositions[sid];
                var session = node.session;
                var isRunning = session.state === 'running' || session.status === 'running';
                var isSessionHovered = hoveredEntityId === sid;
                var isConnected = connectedSessionIds.has(sid);
                var isDimmed = hoveredEntityId && !isConnected && !isSessionHovered;
                var shortId = String(sid || '').slice(0, 8);

                return h('g', {
                  key: sid,
                  transform: 'translate(' + node.x + ', ' + node.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: {
                    cursor: 'pointer',
                    transition: 'opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
                  },
                  onMouseEnter: function () { setHoveredEntityId(sid); },
                  onMouseLeave: function () { setHoveredEntityId(null); },
                  onDoubleClick: function () {
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
                  },
                  onClick: function () {
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
                  // Capsule background
                  h('rect', {
                    x: '-90',
                    y: '-22',
                    width: '180',
                    height: '44',
                    rx: '22',
                    fill: isSessionHovered ? '#1e293b' : '#0f172a',
                    stroke: isSessionHovered ? '#60a5fa' : (isRunning ? '#10b981' : '#475569'),
                    strokeWidth: isSessionHovered ? '2.5' : (isRunning ? '1.8' : '1.2')
                  }),
                  // State Indicator Breathing Pulse Dot
                  h('circle', {
                    cx: '-66',
                    cy: '0',
                    r: '4.5',
                    fill: isRunning ? '#10b981' : '#6b7280',
                    className: isRunning ? 'dsh-pulse-dot' : ''
                  }),
                  // Short Session ID
                  h('text', {
                    x: '-50',
                    y: '-2',
                    fill: '#f3f4f6',
                    fontSize: '11',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: '600'
                  }, shortId),
                  // Truncated Title
                  h('text', {
                    x: '-50',
                    y: '12',
                    fill: '#94a3b8',
                    fontSize: '10'
                  }, (session.title || 'Session').slice(0, 14)),
                  // Call count pill in node right corner
                  session.stats && (session.stats.outboundCalls || session.stats.inboundCalls) ? h('g', { transform: 'translate(62, 0)' },
                    h('circle', { r: '8', fill: '#334155' }),
                    h('text', {
                      y: '3',
                      textAnchor: 'middle',
                      fill: '#cbd5e1',
                      fontSize: '9',
                      fontWeight: '600'
                    }, String((session.stats.outboundCalls || 0) + (session.stats.inboundCalls || 0)))
                  ) : null
                );
              })
            )
          ),
          // Empty State Prompt when no sessions exist
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
        // L3 Slide-Over Drawer
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
