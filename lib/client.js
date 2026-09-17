/**
 * DSH Collaboration Canvas Web Client Plugin
 * Registers conversation.view Tab「看板」
 */

(function () {
  'use strict';

  var NS = 'dsh-canvas';

  var zh = {
    'view.canvas': '看板',
    'toolbar.fitView': '自适应居中',
    'toolbar.locateCurrentSession': '定位当前会话',
    'toolbar.zoomIn': '放大',
    'toolbar.zoomOut': '缩小',
    'stats.totalSessions': '会话',
    'stats.runningSessions': '运行',
    'stats.totalPosts': '黑板条目',
    'stats.activeCalls': '活跃调用',
    'toolbar.themeLight': '切换浅色模式',
    'toolbar.themeDark': '切换深色模式',
    'blackboard.hub': '公共黑板',
    'blackboard.empty': '暂无黑板条目',
    'blackboard.activePosts': '条活跃条目',
    'session.running': '运行中',
    'session.idle': '就绪',
    'session.offline': '会话已离线',
    'session.current': '当前',
    'workspace.current': '当前',
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
    'toolbar.fitView': 'Fit View',
    'toolbar.locateCurrentSession': 'Locate Current Session',
    'toolbar.zoomIn': 'Zoom In',
    'toolbar.zoomOut': 'Zoom Out',
    'stats.totalSessions': 'Sessions',
    'stats.runningSessions': 'Running',
    'stats.totalPosts': 'Blackboard Posts',
    'stats.activeCalls': 'Active Calls',
    'toolbar.themeLight': 'Switch to Light Mode',
    'toolbar.themeDark': 'Switch to Dark Mode',
    'blackboard.hub': 'Blackboard',
    'blackboard.empty': 'No blackboard posts',
    'blackboard.activePosts': 'active posts',
    'session.running': 'Running',
    'session.idle': 'Idle',
    'session.offline': 'Session Offline',
    'session.current': 'Current',
    'workspace.current': 'Current',
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
    '.dsh-canvas-container {',
    '  --dsh-font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace;',
    '  --dsh-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;',
    '  position: relative;',
    '  flex: 1 1 0%;',
    '  min-height: 0;',
    '  width: 100%;',
    '  height: 100%;',
    '  background-color: #0b0f19;',
    '  color: #e2e8f0;',
    '  font-family: var(--dsh-font-sans);',
    '  overflow: hidden;',
    '  isolation: isolate;',
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
    '  overflow: visible;',
    '}',
    '.dsh-canvas-dimmed {',
    '  opacity: 0.2 !important;',
    '  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);',
    '}',
    '.dsh-canvas-highlighted {',
    '  opacity: 1 !important;',
    '  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);',
    '}',
    '.dsh-canvas-drawer-mask {',
    '  position: absolute;',
    '  top: 0;',
    '  left: 0;',
    '  right: 0;',
    '  bottom: 0;',
    '  z-index: 24 !important;',
    '  background: rgba(0, 0, 0, 0.4);',
    '  backdrop-filter: blur(2px);',
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
    '  z-index: 100;',
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
    '.dsh-canvas-container .dsh-pulse-dot {',
    '  transform-box: fill-box !important;',
    '  transform-origin: center !important;',
    '  animation: dshPulseDot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;',
    '}',
    '@keyframes dshFlowDash {',
    '  to { stroke-dashoffset: -20; }',
    '}',
    '.dsh-canvas-container .dsh-flow-edge {',
    '  stroke-dasharray: 6 4;',
    '  animation: dshFlowDash 1.5s linear infinite;',
    '  filter: drop-shadow(0 0 3px rgba(129, 140, 248, 0.45));',
    '}',
    '.dsh-canvas-container .dsh-flow-edge-slow {',
    '  stroke-dasharray: 6 4;',
    '  animation: dshFlowDash 3s linear infinite;',
    '  filter: drop-shadow(0 0 2px rgba(129, 140, 248, 0.25));',
    '}',
    '@keyframes dshPulseEdge {',
    '  0% { opacity: 0.75; }',
    '  50% { opacity: 1; }',
    '  100% { opacity: 0.75; }',
    '}',
    '.dsh-canvas-container .dsh-pulse-edge {',
    '  animation: dshPulseEdge 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;',
    '  filter: drop-shadow(0 0 3px rgba(56, 189, 248, 0.45));',
    '}',
    '/* Scoped Light Theme */',
    '.dsh-canvas-container.dsh-canvas-light {',
    '  background-color: var(--dsw-alias-bg-subtle, #f8fafc);',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-toolbar {',
    '  background: var(--dsw-alias-bg-surface, #ffffff);',
    '  border-bottom: 1px solid var(--dsw-alias-border-default, #e2e8f0);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-title {',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-badge {',
    '  background: var(--dsw-alias-bg-muted, #f1f5f9);',
    '  color: var(--dsw-alias-text-secondary, #475569);',
    '  border-color: var(--dsw-alias-border-default, #e2e8f0);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-btn {',
    '  background: var(--dsw-alias-bg-muted, #f1f5f9);',
    '  border-color: var(--dsw-alias-border-subtle, #cbd5e1);',
    '  color: var(--dsw-alias-text-secondary, #334155);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-btn:hover {',
    '  background: var(--dsw-alias-bg-surface-hover, #e2e8f0);',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '  border-color: var(--dsw-alias-border-strong, #94a3b8);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-drawer {',
    '  background: var(--dsw-alias-bg-surface, rgba(255, 255, 255, 0.98));',
    '  border-left: 1px solid var(--dsw-alias-border-default, #e2e8f0);',
    '  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-drawer-header {',
    '  background: var(--dsw-alias-bg-surface, #ffffff);',
    '  border-bottom: 1px solid var(--dsw-alias-border-default, #e2e8f0);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-drawer-title {',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-section-title {',
    '  color: var(--dsw-alias-text-tertiary, #64748b);',
    '  border-bottom: 1px solid var(--dsw-alias-border-default, #e2e8f0);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-drawer-value-row {',
    '  background: var(--dsw-alias-bg-subtle, #f8fafc);',
    '  border-color: var(--dsw-alias-border-default, #e2e8f0);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-drawer-value {',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-copy-btn {',
    '  background: var(--dsw-alias-bg-surface-hover, #e2e8f0);',
    '  border-color: var(--dsw-alias-border-subtle, #cbd5e1);',
    '  color: var(--dsw-alias-text-secondary, #334155);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-payload-box {',
    '  background: var(--dsw-alias-bg-subtle, #f8fafc);',
    '  border-color: var(--dsw-alias-border-default, #e2e8f0);',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-tooltip {',
    '  background: var(--dsw-alias-bg-surface, rgba(255, 255, 255, 0.98));',
    '  border-color: var(--dsw-alias-border-subtle, #cbd5e1);',
    '  color: var(--dsw-alias-text-secondary, #334155);',
    '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-canvas-tooltip-header {',
    '  color: var(--dsw-alias-text-primary, #0f172a);',
    '}',
    '.dsh-canvas-container.dsh-canvas-light .dsh-pulse-edge,',
    '.dsh-canvas-container.dsh-canvas-light .dsh-flow-edge,',
    '.dsh-canvas-container.dsh-canvas-light .dsh-flow-edge-slow {',
    '  filter: none;',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .dsh-canvas-container .dsh-flow-edge,',
    '  .dsh-canvas-container .dsh-flow-edge-slow,',
    '  .dsh-canvas-container .dsh-pulse-edge,',
    '  .dsh-canvas-container .dsh-pulse-dot {',
    '    animation: none !important;',
    '  }',
    '}'
  ].join('\n');

  function ensureStyles() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return;
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

  function copyToClipboard(text, key, setCopiedKey, timerRef) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(function () {
        if (typeof setCopiedKey === 'function') setCopiedKey(key);
        if (timerRef && timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        var handle = setTimeout(function () {
          if (typeof setCopiedKey === 'function') setCopiedKey(null);
          if (timerRef) timerRef.current = null;
        }, 1400);
        if (timerRef) timerRef.current = handle;
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

  var GUTTER_CONFIG = Object.freeze({
    NODE_RX: 96,
    NODE_RY: 26,
    GUTTER_OFFSET: 118,
    MAX_INTRA_SPREAD: 12,
    CHANNEL_MIN_OFFSET: 106,
    POST_OUTER_OFFSET: 130,
    SESSION_SLOT_HEIGHT: 72,
    POST_LEAD_Y: 40,
    POST_CEILING_Y: 130,
    CROSS_COLUMN_THRESHOLD: 200,
    TOP_CORRIDOR_Y: 130,
    TOP_CORRIDOR_ENTRY_Y: 145,
    TOP_CORRIDOR_ARC_Y: 115
  });

  var POST_COLOR_PALETTES = Object.freeze({
    dark: {
      active: {
        stroke: '#38bdf8',
        fill: 'rgba(15, 23, 42, 0.85)',
        status: '#38bdf8',
        text: '#e2e8f0',
        badgeFill: '#334155',
        badgeStroke: '#334155',
        badgeText: '#94a3b8',
        ttl: '#94a3b8'
      },
      archived: {
        stroke: '#334155',
        fill: 'rgba(15, 23, 42, 0.35)',
        status: '#64748b',
        text: '#94a3b8',
        badgeFill: '#334155',
        badgeStroke: '#475569',
        badgeText: '#94a3b8',
        ttl: '#94a3b8'
      },
      expired: {
        stroke: '#1e293b',
        fill: 'rgba(15, 23, 42, 0.35)',
        status: '#475569',
        text: '#94a3b8',
        badgeFill: '#334155',
        badgeStroke: '#334155',
        badgeText: '#94a3b8',
        ttl: '#94a3b8'
      },
      normal: {
        stroke: '#64748b',
        fill: 'rgba(30, 41, 59, 0.45)',
        status: '#38bdf8',
        text: '#e2e8f0',
        badgeFill: '#334155',
        badgeStroke: '#334155',
        badgeText: '#94a3b8',
        ttl: '#94a3b8'
      }
    },
    light: {
      active: {
        stroke: '#38bdf8',
        fill: '#ffffff',
        status: '#38bdf8',
        text: '#0f172a',
        badgeFill: '#e2e8f0',
        badgeStroke: '#cbd5e1',
        badgeText: '#475569',
        ttl: '#64748b'
      },
      archived: {
        stroke: '#cbd5e1',
        fill: '#f1f5f9',
        status: '#64748b',
        text: '#64748b',
        badgeFill: '#e2e8f0',
        badgeStroke: '#cbd5e1',
        badgeText: '#475569',
        ttl: '#64748b'
      },
      expired: {
        stroke: '#e2e8f0',
        fill: '#f1f5f9',
        status: '#475569',
        text: '#64748b',
        badgeFill: '#e2e8f0',
        badgeStroke: '#cbd5e1',
        badgeText: '#475569',
        ttl: '#64748b'
      },
      normal: {
        stroke: '#94a3b8',
        fill: '#ffffff',
        status: '#38bdf8',
        text: '#0f172a',
        badgeFill: '#e2e8f0',
        badgeStroke: '#cbd5e1',
        badgeText: '#475569',
        ttl: '#64748b'
      }
    }
  });

  var POST_STROKE_CONFIGS = Object.freeze({
    active: { strokeWidth: '1.8', strokeDash: 'none' },
    archived: { strokeWidth: '1', strokeDash: '2 3' },
    expired: { strokeWidth: '1', strokeDash: '1 3' },
    normal: { strokeWidth: '1.2', strokeDash: '4 3' }
  });

  function resolvePostColors(post, isPostActive, isDark) {
    var isArchived = post.status === 'archived';
    var isExpired = post.status === 'expired';
    var isInactive = post.status !== 'active';

    var themeKey = isDark ? 'dark' : 'light';
    var stateKey = isPostActive ? 'active' : (isArchived ? 'archived' : (isExpired ? 'expired' : 'normal'));
    var palette = POST_COLOR_PALETTES[themeKey][stateKey];
    var strokeConfig = POST_STROKE_CONFIGS[stateKey] || POST_STROKE_CONFIGS.normal;

    return {
      isArchived: isArchived,
      isExpired: isExpired,
      isInactive: isInactive,
      strokeColor: palette.stroke,
      strokeWidth: strokeConfig.strokeWidth,
      strokeDash: strokeConfig.strokeDash,
      fillColor: palette.fill,
      statusColor: palette.status,
      textColor: palette.text,
      badgeFill: palette.badgeFill,
      badgeStroke: palette.badgeStroke,
      badgeText: palette.badgeText,
      ttlColor: palette.ttl
    };
  }

  /**
   * Generates a curved smooth cubic Bezier path string between two coordinates (ADR-0014 Right-Exit Left-Enter)
   */
  function calculateBezierPath(x1, y1, x2, y2, index) {
    var dx = x2 - x1;
    var dy = y2 - y1;

    // 自环调用外切于椭圆顶部轮廓
    // 计算在椭圆顶部的两个对称外切端点
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
      var selfLoopStart = getEllipseIntersection(x1, y1, x1 - 45, y1 - 60, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
      var selfLoopEnd = getEllipseIntersection(x1, y1, x1 + 45, y1 - 60, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
      var loopControl1X = x1 - 50;
      var loopControl1Y = y1 - 75;
      var loopControl2X = x1 + 50;
      var loopControl2Y = y1 - 75;
      return 'M ' + selfLoopStart.x.toFixed(1) + ' ' + selfLoopStart.y.toFixed(1) +
             ' C ' + loopControl1X.toFixed(1) + ' ' + loopControl1Y.toFixed(1) + ', ' +
             loopControl2X.toFixed(1) + ' ' + loopControl2Y.toFixed(1) + ', ' +
             selfLoopEnd.x.toFixed(1) + ' ' + selfLoopEnd.y.toFixed(1);
    }

    // Dynamic curve offset to avoid overlapping parallel lines
    var curveIndex = typeof index === 'number' ? index : 0;
    var spread = (curveIndex % 2 === 0 ? 1 : -1) * Math.min(25 + Math.floor(curveIndex / 2) * 15, 60);

    var controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y;
    var intraOffset = GUTTER_CONFIG.GUTTER_OFFSET + (Math.abs(spread) % GUTTER_CONFIG.MAX_INTRA_SPREAD);
    if (Math.abs(dx) < 2) {
      // ADR-0019 通道分流走线：同工作区列内上下调用严格执行上下行双通道隔离，绝不横穿列中轴
      var hopCount = Math.max(1, Math.round(Math.abs(dy) / GUTTER_CONFIG.SESSION_SLOT_HEIGHT));
      var concentricOffset = GUTTER_CONFIG.CHANNEL_MIN_OFFSET + Math.min(hopCount * 6, 16) + (Math.abs(curveIndex) % 2) * 2;
      var verticalLead = Math.min(Math.max(Math.abs(dy) * 0.3, 20), 45);

      if (dy >= 0) {
        // 向下单播：右出右进（走右侧通道），接触点与控制点位于椭圆右侧
        controlPoint1X = x1 + concentricOffset;
        controlPoint1Y = y1 + verticalLead;
        controlPoint2X = x2 + concentricOffset;
        controlPoint2Y = y2 - verticalLead;
        var startNodePoint = getEllipseIntersection(x1, y1, controlPoint1X, y1 + 15, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        var endNodePoint = getEllipseIntersection(x2, y2, controlPoint2X, y2 - 15, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        return 'M ' + startNodePoint.x.toFixed(1) + ' ' + startNodePoint.y.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + controlPoint1Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + controlPoint2Y.toFixed(1) + ', ' +
               endNodePoint.x.toFixed(1) + ' ' + endNodePoint.y.toFixed(1);
      } else {
        // 向上单播：左出左进（走左侧通道），接触点与控制点位于椭圆左侧
        controlPoint1X = x1 - concentricOffset;
        controlPoint1Y = y1 - verticalLead;
        controlPoint2X = x2 - concentricOffset;
        controlPoint2Y = y2 + verticalLead;
        var startNodePoint = getEllipseIntersection(x1, y1, controlPoint1X, y1 - 15, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        var endNodePoint = getEllipseIntersection(x2, y2, controlPoint2X, y2 + 15, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        return 'M ' + startNodePoint.x.toFixed(1) + ' ' + startNodePoint.y.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + controlPoint1Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + controlPoint2Y.toFixed(1) + ', ' +
               endNodePoint.x.toFixed(1) + ' ' + endNodePoint.y.toFixed(1);
      }
    } else if (dx > 0) {
      // 正向跨工作区调用（从左往右）：右出左进平滑贝塞尔
      var forwardStepX = Math.max(dx * 0.45, 120);
      controlPoint1X = x1 + forwardStepX;
      controlPoint1Y = y1 + spread * 0.5;
      controlPoint2X = x2 - forwardStepX;
      controlPoint2Y = y2 + spread * 0.5;
    } else {
      // 反向跨工作区调用（从右往左）：右侧出线折返，左侧进线，通过列间空隙平滑过渡
      controlPoint1X = x1 + intraOffset;
      controlPoint2X = x2 - intraOffset;

      // 跨列反向调用 (|dx| >= 200，跨列物理最小间距为 296px)：通过顶层走线通道 (y <= 130) 横跨避障，绝不穿透卡片
      if (Math.abs(dx) >= GUTTER_CONFIG.CROSS_COLUMN_THRESHOLD) {
        var topCorridorY = GUTTER_CONFIG.TOP_CORRIDOR_Y;
        var reverseStartPoint = getEllipseIntersection(x1, y1, controlPoint1X, y1 - 25, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        var reverseEndPoint = getEllipseIntersection(x2, y2, controlPoint2X, y2 - 25, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
        return 'M ' + reverseStartPoint.x.toFixed(1) + ' ' + reverseStartPoint.y.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + (y1 - 25).toFixed(1) + ', ' +
               controlPoint1X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ENTRY_Y.toFixed(1) + ', ' +
               controlPoint1X.toFixed(1) + ' ' + topCorridorY.toFixed(1) +
               ' C ' + controlPoint1X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ARC_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ARC_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + topCorridorY.toFixed(1) +
               ' C ' + controlPoint2X.toFixed(1) + ' ' + GUTTER_CONFIG.TOP_CORRIDOR_ENTRY_Y.toFixed(1) + ', ' +
               controlPoint2X.toFixed(1) + ' ' + (y2 - 25).toFixed(1) + ', ' +
               reverseEndPoint.x.toFixed(1) + ' ' + reverseEndPoint.y.toFixed(1);
      }

      controlPoint1Y = y1 + (dy >= 0 ? 25 : -25);
      controlPoint2Y = y2 + (dy >= 0 ? -25 : 25);
    }

    var startPoint = getEllipseIntersection(x1, y1, controlPoint1X, controlPoint1Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);
    var endPoint = getEllipseIntersection(x2, y2, controlPoint2X, controlPoint2Y, GUTTER_CONFIG.NODE_RX, GUTTER_CONFIG.NODE_RY);

    return 'M ' + startPoint.x.toFixed(1) + ' ' + startPoint.y.toFixed(1) +
           ' C ' + controlPoint1X.toFixed(1) + ' ' + controlPoint1Y.toFixed(1) + ', ' +
           controlPoint2X.toFixed(1) + ' ' + controlPoint2Y.toFixed(1) + ', ' +
           endPoint.x.toFixed(1) + ' ' + endPoint.y.toFixed(1);
  }

  /**
   * Computes three-state time-decay visual parameters for call lines (PRD 3.3)
   */
  function getCallEdgeDecay(call, now) {
    var timestamp = call.timestamp || now;
    var ageSec = Math.max(0, (now - timestamp) / 1000);
    var isSettled = call.status === 'settled';

    // Settled status or historical (>60s): 30% opacity, static dash
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

    // State 1: Fresh active (<= 15s): 100% opacity, fast flow, glowing pulse
    return {
      opacity: 1.0,
      strokeWidth: 2.2,
      isFlowing: true,
      className: 'dsh-flow-edge'
    };
  }

  function isSameWorkspace(a, b) {
    if (!a || !b) return false;
    return a === b || String(a).toLowerCase() === String(b).toLowerCase();
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

  function resolveEdgeClassName(isDimmed, isHighlighted) {
    return isDimmed ? 'dsh-canvas-dimmed' : (isHighlighted ? 'dsh-pulse-edge' : '');
  }

  function computePostEdgeCoordinates(sourceNode, targetPost, edgeIndex) {
    var startY = sourceNode.y;
    var idx = typeof edgeIndex === 'number' ? edgeIndex : 0;
    var ySpread = (idx % 5) * 2;
    // ADR-0019 黑板发布专属外轨 (130px ~ 136px)，与内轨调用线 [106px, 126px] 物理解耦
    var gutterX = sourceNode.x + GUTTER_CONFIG.POST_OUTER_OFFSET + (idx % 3) * 2;
    var gutterY = Math.min(startY - GUTTER_CONFIG.POST_LEAD_Y, GUTTER_CONFIG.POST_CEILING_Y) - ySpread;
    return {
      startX: sourceNode.x + GUTTER_CONFIG.NODE_RX,
      startY: startY,
      gutterX: gutterX,
      gutterY: gutterY,
      targetX: targetPost.x + 90,
      targetY: targetPost.y + 48
    };
  }

  /**
   * Multi-workspace, session, and blackboard layout engine
   */
  function computeLayout(workspaces, sessions, posts, currentWorkspace, crossWorkspace, calls) {
    var workspaceList = workspaces && workspaces.length ? workspaces.slice() : [];
    if (!workspaceList.length && currentWorkspace) {
      workspaceList = [createDefaultWorkspaceNode(currentWorkspace, (sessions || []).map(function (session) { return session.id; }))];
    }

    // ADR-0013: 当前工作区始终固定排在最左侧首列 (index 0) 并标注 isCurrent（显式路径严格优先，未匹配时自动补齐，杜绝陈旧 isCurrent 截胡）
    if (currentWorkspace) {
      var currentWorkspaceIndex = workspaceList.findIndex(function (workspace) {
        return isSameWorkspace(workspace.id, currentWorkspace);
      });
      if (currentWorkspaceIndex > 0) {
        promoteWorkspaceToFirst(workspaceList, currentWorkspaceIndex);
      } else if (currentWorkspaceIndex === 0) {
        workspaceList[0].isCurrent = true;
      } else {
        // currentWorkspaceIndex === -1: 当前工作区在输入列表中缺失，安全补齐并置首
        workspaceList.unshift(createDefaultWorkspaceNode(currentWorkspace, (sessions || []).filter(function (session) {
          return isSameWorkspace(session.workspace, currentWorkspace);
        }).map(function (session) { return session.id; })));
      }
    } else if (workspaceList.length > 0) {
      var existingCurrentWorkspaceIndex = workspaceList.findIndex(function (workspace) { return workspace.isCurrent; });
      promoteWorkspaceToFirst(workspaceList, existingCurrentWorkspaceIndex);
    }

    // ADR-0013: 工作区当前状态排他性保障：仅第 0列持有 isCurrent: true，其余列严格重置为 false
    for (var workspaceIndex = 0; workspaceIndex < workspaceList.length; workspaceIndex++) {
      workspaceList[workspaceIndex].isCurrent = (workspaceIndex === 0 && (Boolean(currentWorkspace) || Boolean(workspaceList[0].isCurrent)));
    }

    // ADR-0013: 默认全量采纳多工作区；仅当显式传入 false 时才做单工作区过滤（兼容离线单列测试契约）
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

    var startX = 40;
    var startY = 150;
    var columnWidth = 260;
    var columnGap = 36;
    var columnMinHeight = 480;
    var sessionSlotHeight = 72;
    var headerOffsetY = 10;
    var headerHeight = 38;
    var headerClearanceGap = 16;
    var nodeRadiusY = 26;
    var firstNodeTopOffset = headerOffsetY + headerHeight + headerClearanceGap;
    var sessionStartY = startY + firstNodeTopOffset + nodeRadiusY;

    function computeSessionCenterY(slotIndex) {
      return sessionStartY + slotIndex * sessionSlotHeight;
    }

    activeWorkspaces.forEach(function (workspace, activeWorkspaceIndex) {
      var workspaceX = startX + activeWorkspaceIndex * (columnWidth + columnGap);
      var workspaceSessions = (sessions || []).filter(function (session) {
        if (workspace.sessionIds && workspace.sessionIds.length) {
          return workspace.sessionIds.includes(session.id);
        }
        return isSameWorkspace(session.workspace, workspace.id);
      });

      var workspaceHeight = Math.max(columnMinHeight, 76 + workspaceSessions.length * 72 + 24);

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
        var centerX = workspaceX + 130;
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

    // 为已归档/离线但具有调用记录的端点补齐虚拟节点坐标，防止大小写或归档端点缺失丢线
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

          var centerX = boundWorkspaceX + 130;
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
            matchedWorkspaceBound.height = Math.max(matchedWorkspaceBound.height, centerY - matchedWorkspaceBound.y + 60);
          }
        });
      });
    }

    var postList = posts || [];
    var totalWorkspaceCount = Math.max(activeWorkspaces.length, 1);
    var blackboardWidthFromWorkspaces = totalWorkspaceCount * (columnWidth + columnGap) - columnGap + 80;
    var blackboardWidth = Math.max(1080, blackboardWidthFromWorkspaces);
    var hasPosts = postList.length > 0;
    var blackboardHeight = hasPosts ? 96 : 38;

    var blackboardBound = {
      x: 40,
      y: 24,
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

    var maxVisiblePosts = Math.max(1, Math.floor((blackboardWidth - 56 - 40 + 16) / (180 + 16)));
    sortedPosts.slice(0, maxVisiblePosts).forEach(function (post, postIndex) {
      postPositions[post.id] = {
        x: 56 + postIndex * (180 + 16),
        y: 52,
        width: 180,
        height: 48,
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
      var copyTimerRef = React ? React.useRef(null) : { current: null };

      if (React && React.useEffect) {
        React.useEffect(function () {
          return function () {
            if (copyTimerRef.current) {
              clearTimeout(copyTimerRef.current);
              copyTimerRef.current = null;
            }
          };
        }, []);
      }

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
              onClick: function () { copyToClipboard(value, copyId, setCopiedKey, copyTimerRef); }
            }, copiedKey === copyId ? t('drawer.copied') : t('drawer.copy')) : null
          )
        );
      }

      if (entity.kind === 'session') {
        metadataRows.push(renderField(t('drawer.sessionId'), entity.sessionId || entity.id, 'sessionId'));
        metadataRows.push(renderField(t('drawer.sessionTitle'), entity.title, 'title'));
        metadataRows.push(renderField(t('drawer.workspace'), entity.workspace || entity.cwd, 'cwd'));
        var isSessionOffline = entity.isArchived || entity.isVirtual || entity.status === 'offline' || entity.state === 'offline';
        var sessionStatusText = isSessionOffline
          ? t('session.offline')
          : (entity.status === 'running' || entity.state === 'running' ? t('session.running') : t('session.idle'));
        metadataRows.push(renderField(t('drawer.status'), sessionStatusText));
        if (entity.createdAt) {
          metadataRows.push(renderField(t('drawer.timestamp'), formatTime(entity.createdAt)));
        }
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
                onClick: function () { copyToClipboard(entity.messagePayload, 'payload', setCopiedKey, copyTimerRef); }
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

        if (entity.createdAt) {
          metadataRows.push(renderField(t('drawer.timestamp'), formatTime(entity.createdAt)));
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
                onClick: function () { copyToClipboard(entity.content, 'post-content', setCopiedKey, copyTimerRef); }
              }, copiedKey === 'post-content' ? t('drawer.copied') : t('drawer.copy'))
            )
          );
        }
      } else if (entity.kind === 'blackboard_hub') {
        metadataRows.push(renderField(t('blackboard.hub'), t('view.canvas')));
        metadataRows.push(renderField(t('blackboard.activePosts'), String(entity.activeCount || 0)));
        if (entity.summary) {
          payloadRows.push(
            h('div', { className: 'dsh-canvas-drawer-field', key: 'hub-summary' },
              h('div', { className: 'dsh-canvas-drawer-label' }, t('blackboard.hub')),
              h('pre', { className: 'dsh-canvas-payload-box' }, entity.summary),
              h('button', {
                className: 'dsh-canvas-copy-btn' + (copiedKey === 'hub-summary' ? ' copied' : ''),
                style: { alignSelf: 'flex-start', marginTop: '4px' },
                onClick: function () { copyToClipboard(entity.summary, 'hub-summary', setCopiedKey, copyTimerRef); }
              }, copiedKey === 'hub-summary' ? t('drawer.copied') : t('drawer.copy'))
            )
          );
        }
      }

      var badgeLabel = typeof t === 'function' ? (t('drawer.readonlyBadge') || '只读') : '只读';

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

      // L1 Click-to-Focus State: { kind, id }
      var focusedEntityState = React ? React.useState(null) : [null, function () {}];
      var focusedEntity = focusedEntityState[0];
      var setFocusedEntity = focusedEntityState[1];

      // L2 Hover State: { kind, id, entity, x, y }
      var hoveredEntityState = React ? React.useState(null) : [null, function () {}];
      var hoveredEntity = hoveredEntityState[0];
      var setHoveredEntity = hoveredEntityState[1];

      // ADR-0014: Scoped Theme State & Host Theme Synchronization
      var initialIsDark = (typeof document !== 'undefined' && document.body)
        ? document.body.hasAttribute('data-ds-dark-theme')
        : true;
      var isDarkState = React ? React.useState(initialIsDark) : [initialIsDark, function () {}];
      var isDark = isDarkState[0];
      var setIsDark = isDarkState[1];

      var toggleTheme = function () {
        var nextDark = !isDark;
        var nextTheme = nextDark ? 'dark' : 'light';
        if (props && props.theme && typeof props.theme.setTheme === 'function') {
          props.theme.setTheme(nextTheme);
        } else if (typeof window !== 'undefined' && window.__DSH_CTX__ && window.__DSH_CTX__.theme && typeof window.__DSH_CTX__.theme.setTheme === 'function') {
          window.__DSH_CTX__.theme.setTheme(nextTheme);
        }
        // ADR-0014: 严格作用域隔离，绝不修改宿主外部 document.body 属性
        setIsDark(nextDark);
      };

      var initialViewport = (function () {
        var vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1000;
        var vh = (typeof window !== 'undefined' && window.innerHeight) ? Math.max(300, window.innerHeight - 44) : 656;
        var minX = 40;
        var minY = 24;
        var contentW = 1080;
        var contentH = 626;
        var padding = 48;
        var availW = Math.max(vw - padding * 2, 100);
        var availH = Math.max(vh - padding * 2, 100);
        var fitZoom = Math.min(Math.max(Math.min(availW / contentW, availH / contentH), 0.30), 1.20);
        var fitPanX = (vw - contentW * fitZoom) / 2 - minX * fitZoom;
        var fitPanY = (vh - contentH * fitZoom) / 2 - minY * fitZoom;
        return {
          pan: { x: Math.round(fitPanX), y: Math.round(fitPanY) },
          zoom: Number(fitZoom.toFixed(2))
        };
      })();

      var panState = React ? React.useState(initialViewport.pan) : [initialViewport.pan, function () {}];
      var pan = panState[0];
      var setPan = panState[1];

      var zoomState = React ? React.useState(initialViewport.zoom) : [initialViewport.zoom, function () {}];
      var zoom = zoomState[0];
      var setZoom = zoomState[1];

      var copiedKeyState = React ? React.useState(null) : [null, function () {}];
      var copiedKey = copiedKeyState[0];
      var setCopiedKey = copiedKeyState[1];

      var containerRef = React ? React.useRef(null) : { current: null };
      var viewportRef = React ? React.useRef(null) : { current: null };
      var isDraggingRef = React ? React.useRef(false) : { current: false };
      var userInteractedRef = React ? React.useRef(false) : { current: false };
      var dragOriginRef = React ? React.useRef({ x: 0, y: 0, panX: 0, panY: 0 }) : { current: { x: 0, y: 0, panX: 0, panY: 0 } };
      var dragDistanceRef = React ? React.useRef(0) : { current: 0 };
      var animFrameRef = React ? React.useRef(null) : { current: null };

      var hoverTimerRef = React ? React.useRef(null) : { current: null };
      var leaveTimerRef = React ? React.useRef(null) : { current: null };
      var prevChecksumRef = React ? React.useRef('') : { current: '' };
      var initialFitDoneRef = React ? React.useRef(false) : { current: false };
      var receivedFirstTelemetryRef = React ? React.useRef(false) : { current: false };
      var lastObservedWidthRef = React ? React.useRef(0) : { current: 0 };
      var fitViewRef = React ? React.useRef(null) : { current: null };
      var telemetryRef = React ? React.useRef(telemetry) : { current: telemetry };
      telemetryRef.current = telemetry;
      var fitTimeoutRef = React ? React.useRef(null) : { current: null };
      var transitionTimeoutRef = React ? React.useRef(null) : { current: null };
      var fetchSeqRef = React ? React.useRef(0) : { current: 0 };
      var isTransitioningState = React ? React.useState(false) : [false, function () {}];
      var isTransitioning = isTransitioningState[0];
      var setIsTransitioning = isTransitioningState[1];

      var fetchSnapshot = function () {
        var seq = ++fetchSeqRef.current;
        var applyData = function (data) {
          if (seq !== fetchSeqRef.current) return;
          if (!data) return;
          var now = Date.now();
          var sessionSig = (data.sessions || []).map(function (s) { return s.id + ':' + (s.state || s.status) + ':' + (s.title || ''); }).join(';');
          var callSig = (data.calls || []).map(function (c) {
            var ageSec = Math.max(0, (now - (c.timestamp || now)) / 1000);
            var bucket = ageSec > 1800 ? 'expired' : (ageSec < 60 ? 'fresh' : (ageSec <= 300 ? 'decay' : 'settled'));
            return c.id + ':' + (c.state || c.status) + ':' + bucket;
          }).join(';');
          var postSig = (data.posts || []).map(function (p) {
            var ttlSec = Math.max(0, Math.floor((p.ttlRemainingMs || 0) / 1000));
            return p.id + ':' + (p.status || '') + ':' + ttlSec;
          }).join(';');
          var checksum = sessionSig + '|' + callSig + '|' + postSig;
          if (prevChecksumRef.current === checksum) return;
          prevChecksumRef.current = checksum;
          receivedFirstTelemetryRef.current = true;
          setTelemetry(data);
        };

        if (typeof props.fetchTelemetry === 'function') {
          props.fetchTelemetry().then(function (data) {
            applyData(data);
          }).catch(function () {});
          return;
        }
        if (typeof fetch === 'function') {
          var query = new URLSearchParams();
          if (sessionId) query.set('sessionId', sessionId);
          fetch('/plugins/dsh-call-session/telemetry?' + query.toString()).then(function (res) {
            if (res.ok) return res.json();
            throw new Error('HTTP ' + res.status);
          }).then(function (data) {
            applyData(data);
          }).catch(function () {});
        }
      };

      if (React && React.useEffect) {
        React.useEffect(function () {
          if (typeof document === 'undefined' || !document.body) return;
          var checkTheme = function () {
            setIsDark(document.body.hasAttribute('data-ds-dark-theme'));
          };
          checkTheme();
          if (typeof MutationObserver !== 'undefined') {
            var observer = new MutationObserver(function (mutations) {
              for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].attributeName === 'data-ds-dark-theme') {
                  checkTheme();
                  break;
                }
              }
            });
            observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
            return function () { observer.disconnect(); };
          }
        }, []);

        React.useEffect(function () {
          var hasData = Boolean(
            receivedFirstTelemetryRef.current ||
            (telemetry.sessions && telemetry.sessions.length > 0) ||
            (telemetry.posts && telemetry.posts.length > 0) ||
            (telemetry.workspaces && telemetry.workspaces.length > 0) ||
            telemetry.currentWorkspace
          );
          if (hasData && !initialFitDoneRef.current) {
            var container = containerRef.current;
            var viewport = viewportRef.current || (container && container.querySelector ? container.querySelector('.dsh-canvas-viewport') : null);
            var rawW = (viewport && viewport.clientWidth > 0) ? viewport.clientWidth : ((container && container.clientWidth > 0) ? container.clientWidth : 0);
            var rawH = (viewport && viewport.clientHeight > 0) ? viewport.clientHeight : ((container && container.clientHeight > 0) ? Math.max(100, container.clientHeight - 44) : 0);
            if (rawW > 0 && rawH > 0) {
              initialFitDoneRef.current = true;
              if (typeof fitViewRef.current === 'function') {
                fitViewRef.current(false, true);
              }
            }
          }
        }, [telemetry]);

        React.useEffect(function () {
          ensureStyles();
          fetchSnapshot();

          var timer = null;
          var startPolling = function (intervalMs) {
            if (timer) clearInterval(timer);
            timer = setInterval(function () { fetchSnapshot(); }, intervalMs);
          };

          startPolling(1500);

          var handleVisibilityChange = function () {
            if (typeof document === 'undefined') return;
            if (document.hidden) {
              startPolling(5000);
            } else {
              fetchSnapshot();
              startPolling(1500);
            }
          };

          var handleBlur = function () {
            startPolling(5000);
          };

          var handleFocus = function () {
            fetchSnapshot();
            startPolling(1500);
          };

          var handleResize = function () {
            if (typeof window === 'undefined') return;
            var container = containerRef.current;
            var viewport = viewportRef.current || (container && container.querySelector ? container.querySelector('.dsh-canvas-viewport') : null);
            var rawW = (viewport && viewport.clientWidth > 0) ? viewport.clientWidth : ((container && container.clientWidth > 0) ? container.clientWidth : 0);
            var rawH = (viewport && viewport.clientHeight > 0) ? viewport.clientHeight : ((container && container.clientHeight > 0) ? Math.max(100, container.clientHeight - 44) : 0);
            if (rawW > 0 && rawH > 0 && (!userInteractedRef.current || !initialFitDoneRef.current)) {
              if (typeof fitViewRef.current === 'function') {
                fitViewRef.current(false);
              }
            }
          };

          if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
          }
          if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('blur', handleBlur);
            window.addEventListener('focus', handleFocus);
            window.addEventListener('resize', handleResize);
          }

          var resizeObserver = null;
          var RO = (typeof ResizeObserver !== 'undefined') ? ResizeObserver : (typeof window !== 'undefined' && window.ResizeObserver ? window.ResizeObserver : null);
          if (RO) {
            var targetEl = containerRef.current || (typeof document !== 'undefined' && document.querySelector ? document.querySelector('.dsh-canvas-container') : null);
            if (targetEl) {
              resizeObserver = new RO(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                  var entry = entries[i];
                  var cr = entry.contentRect;
                  var width = cr ? cr.width : (entry.target ? entry.target.clientWidth : 0);
                  var height = cr ? cr.height : (entry.target ? entry.target.clientHeight : 0);
                  if (width > 0 && height > 0) {
                    var wasZero = lastObservedWidthRef.current <= 0;
                    lastObservedWidthRef.current = width;
                    if (!initialFitDoneRef.current || wasZero || !userInteractedRef.current) {
                      var curTelemetry = telemetryRef.current;
                      var hasData = Boolean(
                        receivedFirstTelemetryRef.current ||
                        (curTelemetry.sessions && curTelemetry.sessions.length > 0) ||
                        (curTelemetry.posts && curTelemetry.posts.length > 0) ||
                        (curTelemetry.workspaces && curTelemetry.workspaces.length > 0) ||
                        curTelemetry.currentWorkspace
                      );
                      if (hasData) {
                        initialFitDoneRef.current = true;
                        if (typeof fitViewRef.current === 'function') {
                          fitViewRef.current(false, true);
                        }
                      }
                    }
                  } else {
                    lastObservedWidthRef.current = 0;
                  }
                }
              });
              try {
                resizeObserver.observe(targetEl);
              } catch (e) {}
            }
          }

          return function () {
            if (timer) clearInterval(timer);
            if (typeof document !== 'undefined' && document.removeEventListener) {
              document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            if (typeof window !== 'undefined' && window.removeEventListener) {
              window.removeEventListener('blur', handleBlur);
              window.removeEventListener('focus', handleFocus);
              window.removeEventListener('resize', handleResize);
            }
            if (resizeObserver && typeof resizeObserver.disconnect === 'function') {
              resizeObserver.disconnect();
            }
            if (animFrameRef.current && typeof window !== 'undefined') {
              window.cancelAnimationFrame(animFrameRef.current);
            }
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
            if (fitTimeoutRef.current) clearTimeout(fitTimeoutRef.current);
            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
          };
        }, [sessionId]);

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

        // Displacement threshold to distinguish dragging from clicking
        if (dist > 3) {
          userInteractedRef.current = true;
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
        userInteractedRef.current = true;

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
      if (!currentWorkspace && sessionId && sessions.length) {
        var matchedSession = sessions.find(function (s) { return s.id === sessionId; });
        if (matchedSession && matchedSession.workspace) {
          currentWorkspace = matchedSession.workspace;
        }
      }
      var now = Date.now();

      var activePostsCount = posts.filter(function (p) { return p.status === 'active'; }).length;

      var metrics = {
        totalSessions: sessions.length,
        runningSessions: sessions.filter(function (s) { return s.state === 'running' || s.status === 'running'; }).length,
        idleSessions: sessions.filter(function (s) { return s.state !== 'running' && s.status !== 'running'; }).length,
        activeCalls: calls.filter(function (c) { return c.status === 'active'; }).length,
        totalPosts: activePostsCount
      };

      var layout = computeLayout(workspaces, sessions, posts, currentWorkspace, undefined, calls);
      var nodePositions = layout.nodePositions;
      var nodeIdIndex = layout.nodeIdIndex || {};
      var workspaceBounds = layout.workspaceBounds;
      var blackboardBound = layout.blackboardBound;
      var postPositions = layout.postPositions;

      var getNodePosition = function (id) {
        if (!id) return null;
        var sid = String(id);
        var lower = sid.toLowerCase();
        if (nodePositions[sid]) return nodePositions[sid];
        var targetId = nodeIdIndex[sid] || nodeIdIndex[lower];
        if (targetId && nodePositions[targetId]) return nodePositions[targetId];
        if (nodePositions[lower]) return nodePositions[lower];
        for (var k in nodePositions) {
          if (k.toLowerCase() === lower) return nodePositions[k];
        }
        return null;
      };

      // 适配内容边界并执行自适应居中
      var fitView = function (smooth, preferCurrentSession) {
        var container = containerRef.current;
        var viewport = viewportRef.current || (container && container.querySelector ? container.querySelector('.dsh-canvas-viewport') : null);
        var rawW = (viewport && viewport.clientWidth > 0) ? viewport.clientWidth : ((container && container.clientWidth > 0) ? container.clientWidth : 0);
        var rawH = (viewport && viewport.clientHeight > 0) ? viewport.clientHeight : ((container && container.clientHeight > 0) ? Math.max(100, container.clientHeight - 44) : 0);
        var hasValidMeasurement = rawW > 0 && rawH > 0;
        var vw = rawW > 0 ? rawW : ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1000);
        var vh = rawH > 0 ? rawH : ((typeof window !== 'undefined' && window.innerHeight) ? Math.max(100, window.innerHeight - 120) : 656);

        var currentNode = null;
        if (preferCurrentSession && sessionId) {
          currentNode = getNodePosition(sessionId);
          if (!currentNode) {
            for (var sidKey in nodePositions) {
              var sObj = nodePositions[sidKey].session;
              var sShort = (sObj && sObj.shortId) || computeSessionShortId(sidKey);
              if (isMatchingSession(sidKey, sessionId, sShort)) {
                currentNode = nodePositions[sidKey];
                break;
              }
            }
          }
        }

        var fitZoom;
        var fitPanX;
        var fitPanY;

        if (currentNode) {
          fitZoom = 1.0;
          fitPanX = (vw / 2) - currentNode.x * fitZoom;
          fitPanY = (vh / 2) - currentNode.y * fitZoom;
        } else {
          var minX = Infinity;
          var minY = Infinity;
          var maxX = -Infinity;
          var maxY = -Infinity;

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

          if (blackboardBound) {
            minX = Math.min(minX, blackboardBound.x);
            minY = Math.min(minY, blackboardBound.y);
            maxX = Math.max(maxX, blackboardBound.x + blackboardBound.width);
            maxY = Math.max(maxY, blackboardBound.y + blackboardBound.height);
          }

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

          fitZoom = Math.min(Math.max(Math.min(availW / contentW, availH / contentH), 0.30), 1.20);
          fitPanX = (vw - contentW * fitZoom) / 2 - minX * fitZoom;
          fitPanY = (vh - contentH * fitZoom) / 2 - minY * fitZoom;
        }

        if (smooth) {
          setIsTransitioning(true);
          if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = setTimeout(function () {
            setIsTransitioning(false);
          }, 320);
        }

        setZoom(fitZoom);
        setPan({ x: Math.round(fitPanX), y: Math.round(fitPanY) });
        return hasValidMeasurement;
      };
      fitViewRef.current = fitView;

      var zoomIn = function () {
        userInteractedRef.current = true;
        setZoom(Math.min(zoom + 0.2, 2.5));
      };

      var zoomOut = function () {
        userInteractedRef.current = true;
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

      // Connected sub-graph calculation for 1-hop highlight
      var connectedSessionIds = new Set();
      var connectedCallIds = new Set();
      var connectedPostIds = new Set();
      var connectedAuthorEdgeKeys = new Set();
      var connectedContextEdgeKeys = new Set();

      // Active entity for 1-hop highlighting (hover takes precedence, fallback to focused)
      var activeHighlight = hoveredEntity || focusedEntity;
      var activeId = activeHighlight ? activeHighlight.id : null;
      var activeKind = activeHighlight ? activeHighlight.kind : null;

      if (activeHighlight) {
        var hid = activeHighlight.id;
        var normHid = String(hid).toLowerCase();
        var hkind = activeHighlight.kind;

        if (hkind === 'session') {
          connectedSessionIds.add(normHid);
          connectedSessionIds.add(hid);
          calls.forEach(function (call) {
            var cCaller = String(call.callerSessionId || '').toLowerCase();
            var cTarget = String(call.targetSessionId || '').toLowerCase();
            if (cCaller === normHid || cTarget === normHid) {
              connectedCallIds.add(call.id);
              if (cCaller) {
                connectedSessionIds.add(cCaller);
                connectedSessionIds.add(call.callerSessionId);
              }
              if (cTarget) {
                connectedSessionIds.add(cTarget);
                connectedSessionIds.add(call.targetSessionId);
              }
              if (Array.isArray(call.contextPostIds)) {
                call.contextPostIds.forEach(function (pid) {
                  connectedPostIds.add(pid);
                  connectedContextEdgeKeys.add(call.id + '->' + pid);
                });
              }
            }
          });
          posts.forEach(function (post) {
            var pAuthor = String(post.authorSessionId || '').toLowerCase();
            if (pAuthor === normHid) {
              connectedPostIds.add(post.id);
              if (post.authorSessionId) connectedSessionIds.add(post.authorSessionId);
              connectedAuthorEdgeKeys.add(normHid + '->' + post.id);
            }
          });
        } else if (hkind === 'call') {
          var callEntity = activeHighlight.entity || calls.find(function (c) { return c.id === hid; });
          if (callEntity) {
            connectedCallIds.add(callEntity.id);
            var cCaller = String(callEntity.callerSessionId || '').toLowerCase();
            var cTarget = String(callEntity.targetSessionId || '').toLowerCase();
            if (cCaller) {
              connectedSessionIds.add(cCaller);
              connectedSessionIds.add(callEntity.callerSessionId);
            }
            if (cTarget) {
              connectedSessionIds.add(cTarget);
              connectedSessionIds.add(callEntity.targetSessionId);
            }
            if (Array.isArray(callEntity.contextPostIds)) {
              callEntity.contextPostIds.forEach(function (pid) {
                connectedPostIds.add(pid);
                connectedContextEdgeKeys.add(callEntity.id + '->' + pid);
              });
            }
          }
        } else if (hkind === 'post') {
          var postEntity = activeHighlight.entity || posts.find(function (p) { return p.id === hid; });
          if (postEntity) {
            connectedPostIds.add(postEntity.id);
            if (postEntity.authorSessionId) {
              var pAuthor = String(postEntity.authorSessionId).toLowerCase();
              connectedSessionIds.add(pAuthor);
              connectedSessionIds.add(postEntity.authorSessionId);
              connectedAuthorEdgeKeys.add(pAuthor + '->' + postEntity.id);
            }
            calls.forEach(function (c) {
              if (Array.isArray(c.contextPostIds) && c.contextPostIds.includes(postEntity.id)) {
                connectedCallIds.add(c.id);
                var cCaller = String(c.callerSessionId || '').toLowerCase();
                var cTarget = String(c.targetSessionId || '').toLowerCase();
                if (cCaller) {
                  connectedSessionIds.add(cCaller);
                  connectedSessionIds.add(c.callerSessionId);
                }
                if (cTarget) {
                  connectedSessionIds.add(cTarget);
                  connectedSessionIds.add(c.targetSessionId);
                }
                connectedContextEdgeKeys.add(c.id + '->' + postEntity.id);
              }
            });
          }
        }
      }

      var callColors = {
        task_dispatch: '#818cf8',
        task_report: '#34d399',
        notice: '#94a3b8'
      };

      return h('div', {
        ref: containerRef,
        className: 'dsh-canvas-container' + (isDark ? ' dsh-canvas-dark' : ' dsh-canvas-light'),
        style: {
          flex: '1 1 0%',
          isolation: 'isolate'
        },
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onMouseLeave: function () { isDraggingRef.current = false; },
        onWheel: handleWheel
      },
        // Top Toolbar (strictly Title, Fit View, Zoom In/Out, and 4 Metric Badges)
        h('div', { className: 'dsh-canvas-toolbar' },
          h('div', { className: 'dsh-canvas-toolbar-group' },
            h('span', { className: 'dsh-canvas-title' }, t('view.canvas')),
            h('button', { className: 'dsh-canvas-btn', onClick: function () { userInteractedRef.current = false; fitView(true, false); } }, t('toolbar.fitView')),
            sessionId ? h('button', { className: 'dsh-canvas-btn', onClick: function () { userInteractedRef.current = false; fitView(true, true); } }, t('toolbar.locateCurrentSession')) : null,
            h('button', { className: 'dsh-canvas-btn', onClick: zoomIn }, t('toolbar.zoomIn')),
            h('button', { className: 'dsh-canvas-btn', onClick: zoomOut }, t('toolbar.zoomOut'))
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
            ),
            h('button', {
              id: 'dsh-canvas-theme-toggle',
              className: 'dsh-canvas-btn',
              title: isDark ? t('toolbar.themeLight') : t('toolbar.themeDark'),
              onClick: toggleTheme,
              style: { padding: '0 8px', marginLeft: '4px' },
              'aria-label': isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'
            },
              isDark
                ? h('svg', { width: '13', height: '13', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
                    h('circle', { cx: '12', cy: '12', r: '5' }),
                    h('line', { x1: '12', y1: '1', x2: '12', y2: '3' }),
                    h('line', { x1: '12', y1: '21', x2: '12', y2: '23' }),
                    h('line', { x1: '4.22', y1: '4.22', x2: '5.64', y2: '5.64' }),
                    h('line', { x1: '18.36', y1: '18.36', x2: '19.78', y2: '19.78' }),
                    h('line', { x1: '1', y1: '12', x2: '3', y2: '12' }),
                    h('line', { x1: '21', y1: '12', x2: '23', y2: '12' }),
                    h('line', { x1: '4.22', y1: '19.78', x2: '5.64', y2: '18.36' }),
                    h('line', { x1: '18.36', y1: '5.64', x2: '19.78', y2: '4.22' })
                  )
                : h('svg', { width: '13', height: '13', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
                    h('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' })
                  )
            )
          )
        ),
        h('div', { ref: viewportRef, className: 'dsh-canvas-viewport' },
          h('svg', {
            className: 'dsh-canvas-surface',
            style: {
              transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0px) scale(' + zoom + ')',
              transition: isTransitioning ? 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)' : 'none',
              willChange: 'transform',
              width: '100%',
              height: '100%'
            },
            onClick: function (e) {
              if (dragDistanceRef.current <= 3 && (e.target.id === 'dsh-canvas-bg' || e.target.tagName === 'svg')) {
                setFocusedEntity(null);
              }
            },
            onDoubleClick: function (e) {
              if (e.target.id === 'dsh-canvas-bg') {
                userInteractedRef.current = false;
                fitView(true);
              }
            }
          },
            h('defs', null,
              h('pattern', { id: 'dsh-grid-dots', width: '32', height: '32', patternUnits: 'userSpaceOnUse' },
                h('circle', { cx: '2', cy: '2', r: '1', fill: isDark ? '#334155' : '#cbd5e1', opacity: isDark ? '0.4' : '0.6' })
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

            blackboardBound ? (function () {
              var isBbHovered = hoveredEntity && (hoveredEntity.kind === 'post' || hoveredEntity.kind === 'blackboard_hub' || connectedPostIds.size > 0);
              return h('g', { id: 'dsh-canvas-blackboard-layer' },
                h('rect', {
                  x: blackboardBound.x,
                  y: blackboardBound.y,
                  width: blackboardBound.width,
                  height: blackboardBound.height,
                  rx: 8,
                  ry: 8,
                  fill: isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(241, 245, 249, 0.85)',
                  stroke: isDark ? (isBbHovered ? '#38bdf8' : '#475569') : (isBbHovered ? '#0284c7' : '#cbd5e1'),
                  strokeWidth: isBbHovered ? 2.0 : 1.2,
                  strokeDasharray: isBbHovered ? 'none' : '6 4',
                  filter: isBbHovered ? 'drop-shadow(0 0 6px rgba(56, 189, 248, 0.25))' : 'none'
                }),
                (function () {
                  var hubTitle = t('blackboard.hub');
                  var isEn = hubTitle === 'Blackboard' || props.locale === 'en';
                  var countText = activePostsCount !== posts.length
                    ? '(' + activePostsCount + ' ' + (isEn ? 'active' : '活跃') + ' / ' + posts.length + ' ' + (isEn ? 'total' : '总计') + ')'
                    : '(' + activePostsCount + ')';
                  var countX = isEn ? 78 : 58;

                  var isBbEmpty = posts.length === 0;
                  var titleTranslateY = isBbEmpty ? (blackboardBound.y + 23) : (blackboardBound.y + 18);

                  return h('g', {
                    id: 'dsh-canvas-blackboard-title-group',
                    transform: 'translate(' + (blackboardBound.x + 16) + ', ' + titleTranslateY + ')',
                    style: { cursor: 'pointer' },
                    onDoubleClick: function (e) {
                      e.stopPropagation();
                      setSelectedEntity({
                        kind: 'blackboard_hub',
                        id: 'hub',
                        topic: 'blackboard:hub',
                        activeCount: activePostsCount,
                        summary: posts.map(function (p) {
                          return '[' + (p.status || 'active') + '] ' + p.topic + ' (by ' + computeSessionShortId(p.authorSessionId) + ')\n' + (p.content || '-');
                        }).join('\n\n') || t('blackboard.empty')
                      });
                    }
                  },
                    h('text', { className: 'dsh-canvas-blackboard-title-label', fill: '#94a3b8', fontSize: '11', fontWeight: '600' }, hubTitle),
                    h('text', {
                      className: 'dsh-canvas-blackboard-title-count',
                      x: countX,
                      fill: '#38bdf8',
                      fontSize: '11',
                      fontWeight: '600',
                      fontFamily: 'var(--dsh-font-mono)'
                    }, countText)
                  );
                })(),
                posts.length === 0 ? h('text', {
                  x: blackboardBound.x + blackboardBound.width / 2,
                  y: blackboardBound.y + (blackboardBound.height <= 48 ? 23 : 54),
                  textAnchor: 'middle',
                  fill: '#64748b',
                  fontSize: '12',
                  fontFamily: 'var(--dsh-font-sans)',
                  fontStyle: 'italic',
                  pointerEvents: 'none'
                }, t('blackboard.empty')) : null,
                posts.map(function (post, pIdx) {
                var pos = postPositions[post.id];
                if (!pos) return null;

                var isPostActive = activeId === post.id;
                var isPostHovered = hoveredEntity && hoveredEntity.id === post.id;
                var isConnected = connectedPostIds.has(post.id);
                var isDimmed = activeHighlight && !isConnected && !isPostActive;

                var postColors = resolvePostColors(post, isPostActive, isDark);
                var isArchived = postColors.isArchived;
                var isExpired = postColors.isExpired;
                var isInactive = postColors.isInactive;
                var strokeColor = postColors.strokeColor;
                var strokeWidth = postColors.strokeWidth;
                var strokeDash = postColors.strokeDash;
                var fillColor = postColors.fillColor;
                var statusColor = postColors.statusColor;
                var statusText = isArchived ? t('status.archived') : (isExpired ? t('status.expired') : t('status.active'));

                return h('g', {
                  key: post.id || pIdx,
                  transform: 'translate(' + pos.x + ', ' + pos.y + ')',
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onClick: function (e) {
                    e.stopPropagation();
                    if (dragDistanceRef.current <= 3) {
                      setFocusedEntity(focusedEntity && focusedEntity.id === post.id ? null : { kind: 'post', id: post.id, entity: post });
                    }
                  },
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
                      createdAt: post.createdAt,
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
                  isInactive ? h('g', { className: 'dsh-canvas-post-badge' },
                    h('rect', {
                      x: pos.width - 58,
                      y: 7,
                      width: 48,
                      height: 14,
                      rx: 3,
                      ry: 3,
                      fill: postColors.badgeFill,
                      stroke: postColors.badgeStroke,
                      strokeWidth: '0.8'
                    }),
                    h('text', {
                      className: 'dsh-canvas-post-badge-text',
                      x: pos.width - 34,
                      y: 17,
                      textAnchor: 'middle',
                      fill: postColors.badgeText,
                      fontSize: '9',
                      fontWeight: '600',
                      fontFamily: 'var(--dsh-font-sans)'
                    }, '[' + statusText + ']')
                  ) : null,
                  h('text', {
                    x: 10,
                    y: 20,
                    fill: postColors.textColor,
                    fontSize: '11',
                    fontWeight: '600'
                  }, truncateTextByWidth(post.topic || 'post', isInactive ? 96 : 110)),
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
                    fill: postColors.ttlColor,
                    fontSize: '10',
                    fontFamily: 'var(--dsh-font-mono)'
                  }, formatTTL(post.ttlRemainingMs)) : null
                );
              })
            ); })() : null,

            h('g', { id: 'dsh-canvas-swimlanes' },
              workspaceBounds.map(function (ws) {
                var isWsHovered = hoveredEntity && (hoveredEntity.workspace === ws.id || (hoveredEntity.entity && hoveredEntity.entity.workspace === ws.id));
                var isDimmed = hoveredEntity && !isWsHovered && !sessions.some(function (s) {
                  var sid = String(s.id);
                  return s.workspace === ws.id && (connectedSessionIds.has(sid) || connectedSessionIds.has(sid.toLowerCase()));
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
                    fill: isDark ? 'rgba(15, 23, 42, 0.2)' : 'rgba(241, 245, 249, 0.6)',
                    stroke: isWsHovered ? '#60a5fa' : (ws.isCurrent ? (isDark ? '#64748b' : '#3b82f6') : (isDark ? '#334155' : '#cbd5e1')),
                    strokeWidth: isWsHovered ? '2.0' : (ws.isCurrent ? '1.4' : '1.2'),
                    strokeDasharray: isWsHovered ? 'none' : (ws.isCurrent ? '6 3' : '6 4'),
                    opacity: isWsHovered ? 0.95 : (ws.isCurrent ? 0.75 : 0.45)
                  }),
                  h('g', { transform: 'translate(12, 10)' },
                    h('rect', {
                      x: 0,
                      y: 0,
                      width: ws.width - 24,
                      height: 38,
                      rx: 4,
                      fill: ws.isCurrent ? (isDark ? '#1e3a8a' : '#dbeafe') : (isDark ? '#1e293b' : '#f1f5f9'),
                      stroke: ws.isCurrent ? '#3b82f6' : (isDark ? '#475569' : '#cbd5e1'),
                      strokeWidth: '1'
                    }),
                    h('text', {
                      x: 12,
                      y: 24,
                      fill: ws.isCurrent ? (isDark ? '#93c5fd' : '#1d4ed8') : (isDark ? '#94a3b8' : '#475569'),
                      fontSize: '12',
                      fontWeight: '600'
                    }, truncateTextByWidth(ws.name || 'Workspace', 160) + (ws.isCurrent ? (' [' + (t('workspace.current') || '当前') + ']') : ''))
                  )
                );
              })
            ),

            h('g', { id: 'dsh-canvas-author-edges' },
              posts.map(function (post, pIdx) {
                if (!post.authorSessionId) return null;
                var source = getNodePosition(post.authorSessionId);
                var targetPost = postPositions[post.id];
                if (!source || !targetPost) return null;

                var edgeKey = post.authorSessionId + '->' + post.id;
                var isHighlighted = connectedAuthorEdgeKeys.has(edgeKey);
                var isDimmed = hoveredEntity && !isHighlighted;

                // Right-Exit Gutter Routing with slot staggering
                var edgeCoords = computePostEdgeCoordinates(source, targetPost, pIdx);

                // 两段式外侧通道完全避障走线：
                // 第一段沿右侧通道纵向直达工作区顶部 (y=130)，第二段自顶部外围平滑汇入条目底端
                var pathD = 'M ' + edgeCoords.startX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) +
                  ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) + ', ' +
                  edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) + ', ' +
                  edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) +
                  ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + (edgeCoords.gutterY - 15).toFixed(1) + ', ' +
                  edgeCoords.targetX.toFixed(1) + ' ' + (edgeCoords.targetY + 15).toFixed(1) + ', ' +
                  edgeCoords.targetX.toFixed(1) + ' ' + edgeCoords.targetY.toFixed(1);

                return h('path', {
                  key: 'author-' + edgeKey,
                  d: pathD,
                  fill: 'none',
                  stroke: isHighlighted ? '#38bdf8' : '#64748b',
                  strokeWidth: isHighlighted ? '2.0' : '1.2',
                  strokeDasharray: isHighlighted ? 'none' : '4 3',
                  strokeOpacity: isHighlighted ? 1.0 : 0.5,
                  className: resolveEdgeClassName(isDimmed, isHighlighted),
                  style: { transition: 'stroke-width 0.18s ease, stroke-opacity 0.18s ease' }
                });
              })
            ),

            h('g', { id: 'dsh-canvas-context-edges' },
              calls.map(function (call, cIdx) {
                if (!Array.isArray(call.contextPostIds) || !call.contextPostIds.length) return null;
                var callerNode = getNodePosition(call.callerSessionId);
                var targetNode = getNodePosition(call.targetSessionId);
                if (!callerNode || !targetNode) return null;

                return call.contextPostIds.map(function (pid, pidIdx) {
                  var pPos = postPositions[pid];
                  if (!pPos) return null;

                  var edgeKey = call.id + '->' + pid;
                  var isHighlighted = connectedContextEdgeKeys.has(edgeKey);
                  var isDimmed = hoveredEntity && !isHighlighted;

                  // ADR-0014: 右侧走线通道引出，经顶部外围通道汇入黑板条目，严禁斜切卡片
                  var slotIndex = (cIdx * 7 + pidIdx) % 20;
                  var edgeCoords = computePostEdgeCoordinates(callerNode, pPos, slotIndex);

                  var pathD = 'M ' + edgeCoords.startX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) +
                    ' C ' + edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.startY.toFixed(1) + ', ' +
                    edgeCoords.gutterX.toFixed(1) + ' ' + edgeCoords.gutterY.toFixed(1) + ', ' +
                    edgeCoords.targetX.toFixed(1) + ' ' + edgeCoords.targetY.toFixed(1);

                  return h('path', {
                    key: 'ctx-' + edgeKey,
                    d: pathD,
                    fill: 'none',
                    stroke: '#fbbf24',
                    strokeWidth: isHighlighted ? '1.6' : '1.0',
                    strokeDasharray: isHighlighted ? 'none' : '3 3',
                    strokeOpacity: isHighlighted ? 1.0 : 0.45,
                    className: resolveEdgeClassName(isDimmed, isHighlighted),
                    style: { transition: 'stroke-width 0.18s ease, stroke-opacity 0.18s ease' }
                  });
                });
              })
            ),

            h('g', { id: 'dsh-canvas-call-edges' },
              calls.map(function (call, cIdx) {
                var source = getNodePosition(call.callerSessionId);
                var target = getNodePosition(call.targetSessionId);
                if (!source || !target) return null;

                var decay = getCallEdgeDecay(call, now);
                if (!decay || decay.opacity <= 0) return null;
                var isCallActive = activeId === call.id;
                var isCallHovered = hoveredEntity && hoveredEntity.id === call.id;
                var isConnected = connectedCallIds.has(call.id);
                var isDimmed = activeHighlight && !isConnected && !isCallActive;

                // ADR-0019 常态按需显影：未交互时已结算历史调用完全隐藏，杜绝大盘蜘蛛网
                var isHighlighted = isCallActive || isConnected || isCallHovered;
                var ageSec = Math.max(0, (now - (call.timestamp || now)) / 1000);
                var isSettledOrHistorical = call.status === 'settled' || ageSec > 15;
                if (!activeHighlight && isSettledOrHistorical && !isHighlighted) {
                  return null;
                }

                var highlightColors = {
                  task_dispatch: '#a5b4fc',
                  task_report: '#6ee7b7',
                  notice: '#cbd5e1'
                };
                var strokeColor = (isCallActive || isConnected)
                  ? (highlightColors[call.callType] || '#a5b4fc')
                  : (callColors[call.callType] || '#818cf8');
                var markerUrl = call.callType === 'task_report'
                  ? 'url(#dsh-arrow-report)'
                  : call.callType === 'notice'
                    ? 'url(#dsh-arrow-notice)'
                    : 'url(#dsh-arrow-dispatch)';

                var dx = target.x - source.x;
                var dy = target.y - source.y;
                var dist = Math.sqrt(dx * dx + dy * dy);

                var pathD = calculateBezierPath(source.x, source.y, target.x, target.y, cIdx);

                return h('g', {
                  key: call.id || cIdx,
                  className: isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted',
                  style: { cursor: 'pointer' },
                  onClick: function (e) {
                    e.stopPropagation();
                    if (dragDistanceRef.current <= 3) {
                      setFocusedEntity(focusedEntity && focusedEntity.id === call.id ? null : { kind: 'call', id: call.id, entity: call });
                    }
                  },
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
                    className: (isCallHovered || isConnected) ? 'dsh-pulse-edge' : decay.className,
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
                var isSessionActive = activeId === sid;
                var isSessionHovered = hoveredEntity && hoveredEntity.id === sid;
                var isConnected = connectedSessionIds.has(sid) || connectedSessionIds.has(sid.toLowerCase());
                var isDimmed = activeHighlight && !isConnected && !isSessionActive;
                var shortId = session.shortId || computeSessionShortId(sid);
                var isCurrentSession = isMatchingSession(sid, sessionId, shortId);

                var isHighlighted = isSessionActive || isConnected;
                var strokeColor = isCurrentSession
                  ? '#38bdf8'
                  : (isHighlighted
                    ? (isRunning ? '#4ade80' : '#93c5fd')
                    : (isRunning ? '#22c55e' : '#64748b'));
                var strokeWidth = isCurrentSession
                  ? '2.4'
                  : (isHighlighted ? '2.2' : (isRunning ? '1.5' : '1.2'));
                var strokeDash = isCurrentSession
                  ? 'none'
                  : (isHighlighted ? 'none' : (isRunning ? '5 3' : '4 4'));

                var hasCallBadge = Boolean(session.stats && (session.stats.outboundCalls || session.stats.inboundCalls));
                var titleMaxWidth = isCurrentSession ? 64 : (hasCallBadge ? 105 : 140);

                return h('g', {
                  key: sid,
                  id: 'dsh-canvas-node-' + sid,
                  transform: 'translate(' + node.x + ', ' + node.y + ')',
                  className: (isDimmed ? 'dsh-canvas-dimmed' : 'dsh-canvas-highlighted') + (isCurrentSession ? ' dsh-canvas-node-current' : ''),
                  style: {
                    cursor: 'pointer',
                    transition: 'opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
                  },
                  onClick: function (e) {
                    e.stopPropagation();
                    if (dragDistanceRef.current <= 3) {
                      setFocusedEntity(focusedEntity && focusedEntity.id === sid ? null : { kind: 'session', id: sid, entity: session });
                    }
                  },
                  onMouseEnter: function (e) { handleEntityEnter('session', session, e); },
                  onMouseLeave: handleEntityLeave,
                  onDoubleClick: function (e) {
                    e.stopPropagation();
                    var isSessionOffline = session.isArchived || session.isVirtual || session.status === 'offline' || session.state === 'offline';
                    setSelectedEntity({
                      kind: 'session',
                      id: sid,
                      sessionId: sid,
                      title: session.title,
                      cwd: session.workspace || session.cwd,
                      workspace: session.workspace || session.cwd,
                      status: isSessionOffline ? 'offline' : (isRunning ? 'running' : 'idle'),
                      isArchived: session.isArchived,
                      isVirtual: session.isVirtual,
                      createdAt: session.createdAt,
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
                    fill: isDark ? '#090d16' : '#ffffff',
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    strokeDasharray: strokeDash,
                    style: {
                      filter: isCurrentSession
                        ? 'drop-shadow(0 0 8px #38bdf8)'
                        : (isHighlighted ? (isRunning ? 'drop-shadow(0 0 8px rgba(74, 222, 128, 0.45))' : 'drop-shadow(0 0 8px rgba(147, 197, 253, 0.45))') : 'none')
                    }
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
                    className: 'dsh-canvas-session-title',
                    x: -52,
                    y: 12,
                    fill: isCurrentSession ? '#38bdf8' : (isDark ? '#f1f5f9' : '#0f172a'),
                    fontSize: '12',
                    fontFamily: 'var(--dsh-font-sans)',
                    fontWeight: isCurrentSession ? '600' : 'normal'
                  }, truncateTextByWidth(session.title || ('Agent ' + shortId), titleMaxWidth)),
                  isCurrentSession ? h('g', { className: 'dsh-canvas-session-current-badge' },
                    h('rect', {
                      x: 18,
                      y: 1,
                      width: props.locale === 'en' ? 48 : 40,
                      height: 14,
                      rx: 3,
                      ry: 3,
                      fill: 'rgba(56, 189, 248, 0.15)',
                      stroke: '#38bdf8',
                      strokeWidth: '0.8'
                    }),
                    h('text', {
                      className: 'dsh-canvas-session-current-tag',
                      x: 18 + (props.locale === 'en' ? 24 : 20),
                      y: 11,
                      textAnchor: 'middle',
                      fill: '#38bdf8',
                      fontSize: '9',
                      fontWeight: '600',
                      fontFamily: 'var(--dsh-font-sans)'
                    }, '[' + (t('session.current') || (props.locale === 'en' ? 'Current' : '当前')) + ']')
                  ) : null,
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
            var tipX = 0;
            var tipY = 0;

            // 实体吸附定位计算
            var tipHeightEst = kind === 'session' ? 26 : (kind === 'call' ? 95 : 100);

            if (kind === 'session') {
              var sNode = nodePositions[ent.id] || getNodePosition(ent.id);
              if (sNode) {
                var screenX = pan.x + sNode.x * zoom;
                var screenY = pan.y + sNode.y * zoom;
                tipX = screenX - 110; // 居中 220px 单行胶囊 (max-width 260px)
                // 优先置于卡片下方净间隙 (椭圆 ry=26)，绝不遮挡上方卡片文字与左右端口
                tipY = screenY + 26 * zoom + 4;
              } else {
                tipX = hoveredEntity.x + 12;
                tipY = hoveredEntity.y + 12;
              }
            } else if (kind === 'post') {
              var pPos = postPositions[ent.id];
              if (pPos) {
                var pScreenX = pan.x + (pPos.x + pPos.width / 2) * zoom;
                var pScreenY = pan.y + (pPos.y + pPos.height) * zoom;
                tipX = pScreenX - 140;
                tipY = pScreenY + 8;
              } else {
                tipX = hoveredEntity.x + 12;
                tipY = hoveredEntity.y + 12;
              }
            } else if (kind === 'call') {
              var cSource = getNodePosition(ent.callerSessionId);
              var cTarget = getNodePosition(ent.targetSessionId);
              if (cSource && cTarget) {
                var isSelf = Math.abs(cSource.x - cTarget.x) < 2 && Math.abs(cSource.y - cTarget.y) < 2;
                var midX = (cSource.x + cTarget.x) / 2;
                var midY = isSelf ? (cSource.y - 75) : ((cSource.y + cTarget.y) / 2);
                var callScreenX = pan.x + midX * zoom;
                var callScreenY = pan.y + midY * zoom;
                tipX = callScreenX - 140;
                if (callScreenY - tipHeightEst - 8 >= 10) {
                  tipY = callScreenY - 8 - tipHeightEst;
                } else {
                  tipY = callScreenY + 8;
                }
              } else {
                tipX = hoveredEntity.x - 140;
                tipY = hoveredEntity.y - 80;
              }
            } else {
              tipX = hoveredEntity.x - 140;
              tipY = hoveredEntity.y - 80;
            }

            var containerW = (containerRef.current && containerRef.current.clientWidth) || 800;
            var containerH = (containerRef.current && containerRef.current.clientHeight) || 600;
            tipX = Math.min(Math.max(12, tipX), containerW - 292);
            tipY = Math.min(Math.max(12, tipY), containerH - 140);

            if (kind === 'session') {
              var isSessionOffline = ent.isArchived || ent.isVirtual || ent.status === 'offline' || ent.state === 'offline';
              var sessionStatusText = isSessionOffline
                ? t('session.offline')
                : (ent.state === 'running' || ent.status === 'running' ? t('session.running') : t('session.idle'));
              var statusColor = isSessionOffline ? '#f59e0b' : (ent.state === 'running' || ent.status === 'running' ? '#22c55e' : '#94a3b8');
              var shortId = ent.shortId || computeSessionShortId(ent.id);
              var displayTitle = ent.title || ('Agent ' + shortId);

              return h('div', {
                className: 'dsh-canvas-tooltip',
                style: {
                  left: tipX + 'px',
                  top: tipY + 'px',
                  height: '26px',
                  padding: '3px 10px',
                  borderRadius: '13px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box'
                }
              },
                h('span', {
                  className: 'dsh-canvas-capsule-dot',
                  style: {
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: statusColor,
                    flexShrink: 0
                  }
                }),
                h('span', {
                  style: {
                    color: statusColor,
                    fontSize: '11px',
                    fontWeight: '600'
                  }
                }, sessionStatusText),
                h('span', {
                  style: {
                    color: '#f1f5f9',
                    fontSize: '11px',
                    fontWeight: '500',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }
                }, displayTitle),
                h('span', {
                  style: {
                    fontFamily: 'var(--dsh-font-mono, monospace)',
                    fontSize: '10px',
                    color: '#94a3b8',
                    flexShrink: 0
                  }
                }, shortId)
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
                (ent.callerOffline || ent.targetOffline) ? h('div', {
                  className: 'dsh-canvas-tooltip-row',
                  style: { color: '#f59e0b', marginTop: '4px' }
                },
                  h('span', null, t('session.offline')),
                  h('span', { style: { color: '#f59e0b', fontFamily: 'var(--dsh-font-mono)' } },
                    ent.callerOffline && ent.targetOffline
                      ? (computeSessionShortId(ent.callerSessionId) + ' & ' + computeSessionShortId(ent.targetSessionId))
                      : computeSessionShortId(ent.callerOffline ? ent.callerSessionId : ent.targetSessionId)
                  )
                ) : null,
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
                ent.tags && ent.tags.length ? h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.tags')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, ent.tags.join(', '))
                ) : null,
                ent.status === 'active' || (!ent.status && ent.ttlRemainingMs > 0) ? h('div', { className: 'dsh-canvas-tooltip-row' },
                  h('span', null, t('drawer.ttl')),
                  h('span', { style: { fontFamily: 'var(--dsh-font-mono)' } }, formatTTL(ent.ttlRemainingMs))
                ) : null
              );
            }
            return null;
          })() : null,

          sessions.length === 0 && posts.length === 0 ? h('div', {
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
        selectedEntity ? h('div', {
          className: 'dsh-canvas-drawer-mask',
          onClick: function () { setSelectedEntity(null); }
        }) : null,
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
      isMatchingSession: isMatchingSession,
      truncateTextByWidth: truncateTextByWidth,
      calculateBezierPath: calculateBezierPath,
      getCallEdgeDecay: getCallEdgeDecay,
      computeLayout: computeLayout,
      resolvePostColors: resolvePostColors,
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
