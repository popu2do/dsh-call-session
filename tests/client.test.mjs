import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Loads and materializes lib/client.js via the DSH Web ModuleLoader contract
 */
function loadClientBundle() {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  assert.ok(fs.existsSync(clientPath), 'lib/client.js must exist on disk');
  const code = fs.readFileSync(clientPath, 'utf8');

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => {
        registration = payload;
      }
    }
  };

  const sandbox = {
    window: mockWindow,
    console,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Math,
    JSON,
    URLSearchParams,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  assert.ok(registration, 'lib/client.js must invoke window.__ModuleLoader__.load');
  assert.equal(registration.id, 'dsh-call-session', 'ModuleLoader id must match dsh-call-session');
  assert.equal(typeof registration.factory, 'function', 'registration.factory must be a function');

  return registration.factory(() => null);
}

test('Client Package Configuration: package.json exports and dsh.client specification', () => {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // Verify ./client export
  assert.ok(pkg.exports, 'package.json must contain exports');
  assert.ok(pkg.exports['./client'], 'package.json must export ./client');
  assert.equal(pkg.exports['./client'].default, './lib/client.js');
  assert.equal(pkg.exports['./client'].types, './types/client.d.ts');

  // Verify dsh.client configuration
  assert.ok(pkg.dsh, 'package.json must contain dsh section');
  assert.ok(pkg.dsh.client, 'package.json must contain dsh.client section');
  assert.equal(pkg.dsh.client.platform, 'web', 'dsh.client.platform must be web');
  assert.ok(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject must be an array');
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
});

test('Client Plugin Contract: lib/client.js exports and zero-emoji compliance (ADR-0009)', () => {
  const plugin = loadClientBundle();

  // Metadata verification
  assert.equal(typeof plugin.apply, 'function', 'plugin.apply must be a function');
  assert.equal(plugin.inject[0], 'slots');
  assert.equal(plugin.inject[1], 'locale');
  assert.equal(plugin.inject.length, 2);
  assert.equal(plugin.NS, 'dsh-canvas', 'plugin.NS must be dsh-canvas');

  // Verify dictionaries
  assert.ok(plugin.zh && typeof plugin.zh === 'object', 'zh dictionary must exist');
  assert.ok(plugin.en && typeof plugin.en === 'object', 'en dictionary must exist');

  assert.equal(plugin.zh['view.canvas'], '看板');
  assert.equal(plugin.en['view.canvas'], 'Canvas');
  assert.ok(plugin.zh['toolbar.workspace']);
  assert.ok(plugin.zh['toolbar.fitView']);
  assert.ok(plugin.zh['drawer.title']);
  assert.ok(plugin.zh['drawer.readonlyBadge']);
  assert.ok(plugin.zh['drawer.copy']);

  // Anti-slop check: Zero Emoji in all dictionaries (PRD 2.5 & ADR-0009)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  for (const [key, val] of Object.entries(plugin.zh)) {
    assert.equal(emojiRegex.test(val), false, `zh key ${key} must not contain emoji`);
  }
  for (const [key, val] of Object.entries(plugin.en)) {
    assert.equal(emojiRegex.test(val), false, `en key ${key} must not contain emoji`);
  }
});

test('Client Lifecycle & Slot Registration: conversation.view Tab「看板」', async () => {
  const plugin = loadClientBundle();

  let registeredNS = null;
  let registeredDict = null;
  let injectedSlotName = null;
  let registeredSlotDef = null;
  let registeredComponent = null;

  // Mock Cordis client context
  const mockCtx = {
    effect: (fn) => fn(),
    locale: {
      register: (ns, dicts) => {
        registeredNS = ns;
        registeredDict = dicts;
      },
      bind: (ns) => (key) => registeredDict.zh[key] || key
    },
    slots: {
      inject: (slotName, factory) => {
        injectedSlotName = slotName;
        factory();
      },
      register: (slotDef, component) => {
        registeredSlotDef = slotDef;
        registeredComponent = component;
      }
    },
    get: (name) => {
      if (name === 'canvasTelemetry') {
        return {
          getSnapshot: async () => ({
            timestamp: Date.now(),
            currentWorkspace: '/test',
            workspaces: [],
            sessions: [],
            posts: [],
            calls: [],
            metrics: { totalSessions: 0, runningSessions: 0, activeCalls: 0, totalPosts: 0 }
          })
        };
      }
      return null;
    }
  };

  plugin.apply(mockCtx);

  // Assert locale registration
  assert.equal(registeredNS, 'dsh-canvas');
  assert.ok(registeredDict.zh && registeredDict.en);

  // Assert slot registration
  assert.equal(injectedSlotName, 'conversation.view');
  assert.ok(registeredSlotDef, 'Slot definition must be registered');
  assert.equal(registeredSlotDef.name, 'conversation.view');
  assert.equal(registeredSlotDef.id, 'canvas');
  assert.equal(registeredSlotDef.order, 15);
  assert.equal(registeredSlotDef.locale, 'dsh-canvas');
  assert.equal(registeredSlotDef.label(), '看板');

  // Test slot inject function
  const injection = registeredSlotDef.inject('session-test-456');
  assert.equal(injection.sessionId, 'session-test-456');
  assert.equal(typeof injection.fetchTelemetry, 'function');

  const snapshot = await injection.fetchTelemetry();
  assert.ok(snapshot);
  assert.equal(snapshot.currentWorkspace, '/test');

  // Real link integrity: the HTTP fallback must target the host-registered route.
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  assert.ok(
    clientSource.includes("'/plugins/dsh-call-session/telemetry?'"),
    'client must call the canonical host route /plugins/dsh-call-session/telemetry'
  );
  assert.ok(
    !clientSource.includes('/api/dsh-call-session/telemetry'),
    'client must not retain the unregistered /api/... route'
  );

  // Verify component
  assert.ok(registeredComponent, 'View component must be supplied');
  assert.equal(typeof registeredComponent, 'function');
});

test('Topology Visual Layout Engine: Multi-workspace swimlanes and session node positioning', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;
  assert.equal(typeof computeLayout, 'function');

  const workspaces = [
    { id: '/ws/main', name: 'main', isCurrent: true, sessionIds: ['s1', 's2'] },
    { id: '/ws/peer', name: 'peer', isCurrent: false, sessionIds: ['s3'] }
  ];
  const sessions = [
    { id: 's1', workspace: '/ws/main' },
    { id: 's2', workspace: '/ws/main' },
    { id: 's3', workspace: '/ws/peer' }
  ];

  // 1. Default: single workspace mode (crossWorkspace: false)
  const layoutSingle = computeLayout(workspaces, sessions, [], '/ws/main', false);
  assert.equal(layoutSingle.workspaceBounds.length, 1);
  assert.equal(layoutSingle.workspaceBounds[0].id, '/ws/main');
  assert.ok(layoutSingle.nodePositions['s1']);
  assert.ok(layoutSingle.nodePositions['s2']);
  assert.equal(layoutSingle.nodePositions['s3'], undefined, 's3 in peer workspace must not be in single-ws layout');

  // 2. Cross-workspace mode (crossWorkspace: true)
  const layoutMulti = computeLayout(workspaces, sessions, [], '/ws/main', true);
  assert.equal(layoutMulti.workspaceBounds.length, 2);
  assert.ok(layoutMulti.nodePositions['s1']);
  assert.ok(layoutMulti.nodePositions['s2']);
  assert.ok(layoutMulti.nodePositions['s3'], 's3 must be positioned in multi-ws swimlane');

  // Verify swimlanes do not overlap horizontally
  const ws1 = layoutMulti.workspaceBounds[0];
  const ws2 = layoutMulti.workspaceBounds[1];
  assert.ok(ws2.x >= ws1.x + ws1.width, 'Workspace swimlanes must be laid out side-by-side without overlapping');
});

test('Three-State Time-Decayed Connection Lines: getCallEdgeDecay and smooth Bezier calculation', () => {
  const plugin = loadClientBundle();
  const { getCallEdgeDecay, calculateBezierPath } = plugin;
  assert.equal(typeof getCallEdgeDecay, 'function');
  assert.equal(typeof calculateBezierPath, 'function');

  const now = 1726000000000;

  // State 1: Fresh active call (< 15 seconds)
  const freshCall = { timestamp: now - 5000, status: 'active' };
  const freshDecay = getCallEdgeDecay(freshCall, now);
  assert.equal(freshDecay.opacity, 1.0);
  assert.equal(freshDecay.strokeWidth, 2.2);
  assert.equal(freshDecay.isFlowing, true);
  assert.equal(freshDecay.className, 'dsh-flow-edge');

  // State 2: Recent decayed call (15s ~ 60s)
  const recentCall = { timestamp: now - 30000, status: 'active' };
  const recentDecay = getCallEdgeDecay(recentCall, now);
  assert.equal(recentDecay.opacity, 0.65);
  assert.equal(recentDecay.strokeWidth, 1.6);
  assert.equal(recentDecay.isFlowing, true);
  assert.equal(recentDecay.className, 'dsh-flow-edge-slow');

  // State 3: Settled or older call (> 60s or status === 'settled')
  const olderCall = { timestamp: now - 90000, status: 'active' };
  const olderDecay = getCallEdgeDecay(olderCall, now);
  assert.equal(olderDecay.opacity, 0.3);
  assert.equal(olderDecay.strokeWidth, 1.2);
  assert.equal(olderDecay.isFlowing, false);
  assert.equal(olderDecay.className, '');

  const settledCall = { timestamp: now - 2000, status: 'settled' };
  const settledDecay = getCallEdgeDecay(settledCall, now);
  assert.equal(settledDecay.opacity, 0.3);
  assert.equal(settledDecay.isFlowing, false);

  // Bezier curve generation
  const path1 = calculateBezierPath(100, 100, 300, 200, 0, 1);
  assert.ok(path1.startsWith('M 100.0 100.0 Q '));
  assert.ok(path1.endsWith(' 300.0 200.0'));

  // Self-loop path
  const selfLoop = calculateBezierPath(100, 100, 100, 100, 0, 1);
  assert.ok(selfLoop.includes('C '), 'Self-loop must generate cubic curve arc');
});

test('Format Helpers: formatTTL and formatTime compact outputs', () => {
  const plugin = loadClientBundle();
  const { formatTTL, formatTime } = plugin;

  assert.equal(formatTTL(45000), '45s');
  assert.equal(formatTTL(125000), '2m');
  assert.equal(formatTTL(3700000), '1h 1m');
  assert.equal(formatTTL(0), '0s');

  const formatted = formatTime(1726000000000);
  assert.match(formatted, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(formatTime(null), '-');
});

test('L3 Read-Only Inspector Drawer: Strict read-only integrity (Anti-Side-Effect)', () => {
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;

  // Session Drawer inspection
  const sessionDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'session',
      id: 'session-arch-001',
      title: 'Architect Worker',
      workspace: '/workspace/project',
      status: 'running',
      agentType: 'architect',
      stats: { inboundCalls: 3, outboundCalls: 8, postsCount: 2 }
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  assert.ok(sessionDrawer);
  assert.equal(sessionDrawer.props.className, 'dsh-canvas-drawer');

  // Call Trace Drawer inspection
  const callDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'call',
      id: 'call-999',
      callType: 'task_dispatch',
      deliveryMode: 'followup',
      durationMs: 38,
      timestamp: Date.now(),
      callerSessionId: 'sess-a',
      callerTitle: 'Caller A',
      targetSessionId: 'sess-b',
      targetTitle: 'Target B',
      contextPostIds: ['post-1', 'post-2'],
      messageSnippet: 'Dispatch task review',
      messagePayload: 'Full immutable payload content',
      status: 'active'
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  assert.ok(callDrawer);

  // Blackboard Post Drawer inspection
  const postDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'post',
      id: 'post-101',
      topic: 'task:audit',
      tags: ['p0', 'security'],
      ttlRemainingMs: 3600000,
      authorSessionId: 'sess-auth',
      workspace: '/workspace/project',
      content: 'Audit report details'
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  assert.ok(postDrawer);

  // Verify READ-ONLY badge exists
  const header = sessionDrawer.children[0];
  const titleGroup = header.children[0];
  const badge = titleGroup.children[1];
  assert.equal(badge.props.className, 'dsh-canvas-drawer-readonly');
  assert.equal(badge.children[0], '只读');
});

test('GPU Hardware Acceleration & 60fps Style Invariants: translate3d, will-change and transition timings', () => {
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;

  const view = plugin.CanvasView({
    sessionId: 'session-gpu-test',
    t
  });

  // Verify viewport container contains hardware-accelerated SVG surface
  const viewport = view.children[1];
  assert.equal(viewport.props.className, 'dsh-canvas-viewport');

  const svgSurface = viewport.children[0];
  assert.equal(svgSurface.props.className, 'dsh-canvas-surface');
  assert.ok(svgSurface.props.style.transform.includes('translate3d('), 'SVG transform must use translate3d for GPU rasterization');
  assert.ok(svgSurface.props.style.willChange === 'transform', 'SVG transform must declare will-change: transform');

  // Verify CSS contains PRD Section 6.1 performance easing and timings
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  assert.ok(code.includes('cubic-bezier(0.16, 1, 0.3, 1)'), 'Must apply PRD 6.1 high-performance easing curve');
  assert.ok(code.includes('0.18s'), '1-hop dimming transition must be 180ms per PRD');
  assert.ok(code.includes('contain: layout style'), 'Must use CSS containment for reflow isolation');
});
