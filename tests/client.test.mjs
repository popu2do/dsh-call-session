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
function loadClientBundle(requireFn = () => null) {
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

  return registration.factory(requireFn);
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
  assert.ok(plugin.zh['toolbar.fitView']);
  assert.ok(plugin.zh['drawer.title']);
  assert.ok(plugin.zh['drawer.readonlyBadge']);
  assert.ok(plugin.zh['drawer.copy']);

  // 断言已废弃的工具栏键名与无用配置已被移除
  assert.equal(plugin.zh['toolbar.workspace'], undefined);
  assert.equal(plugin.zh['toolbar.refresh'], undefined);
  assert.equal(plugin.zh['stats.idleSessions'], undefined);
  assert.equal(plugin.zh['blackboard.topic'], undefined);
  assert.equal(plugin.zh['blackboard.ttl'], undefined);
  assert.equal(plugin.zh['blackboard.tags'], undefined);
  assert.equal(plugin.zh['drawer.messageSnippet'], undefined);
  assert.equal(plugin.zh['session.offline'], '会话已离线');
  assert.equal(plugin.en['toolbar.workspace'], undefined);
  assert.equal(plugin.en['toolbar.refresh'], undefined);
  assert.equal(plugin.en['stats.idleSessions'], undefined);
  assert.equal(plugin.en['blackboard.topic'], undefined);
  assert.equal(plugin.en['blackboard.ttl'], undefined);
  assert.equal(plugin.en['blackboard.tags'], undefined);
  assert.equal(plugin.en['drawer.messageSnippet'], undefined);
  assert.equal(plugin.en['session.offline'], 'Session Offline');

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

test('Topology Visual Layout Engine: Multi-workspace columns and session node positioning', () => {
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

  // Bezier curve generation (PRD 3.1 & 4.1: Cubic Bezier C trimmed to ellipse boundary)
  const path1 = calculateBezierPath(100, 100, 300, 200, 0, 1);
  assert.ok(path1.startsWith('M ') && path1.includes(' C '), 'Path must start with M and use cubic Bezier C');
  assert.ok(/M \d+\.\d+ \d+\.\d+ C \d+\.\d+ \d+\.\d+, \d+\.\d+ \d+\.\d+, \d+\.\d+ \d+\.\d+/.test(path1));

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

test('L3 Read-Only Inspector Drawer: Read-only integrity', () => {
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

test('Scope & AST Audit: Slot Scope and Mutation Check', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  // 1. Strict Unique Slot Scope Verification
  const slotInjectMatches = [...code.matchAll(/ctx\.slots\.inject\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.equal(slotInjectMatches.length, 1, 'ctx.slots.inject must be called exactly once');
  assert.equal(slotInjectMatches[0], 'conversation.view', 'Slot injection target must strictly be conversation.view');

  // Check slots.register parameters
  assert.ok(code.includes("name: 'conversation.view'"), 'Registered slot name must be conversation.view');
  assert.ok(code.includes("id: 'canvas'"), 'Registered slot id must be canvas');
  assert.ok(code.includes('order: 15'), 'Registered slot order must be 15');

  // 2. Zero Tool / Command / Slash Registration
  assert.equal(/ctx\.(?:tools|tool|command|slash)\s*\./.test(code), false, 'Client must not register any tools or commands');

  // 3. Zero Mutative HTTP Methods
  assert.equal(/method\s*:\s*['"](?:POST|PUT|DELETE|PATCH)['"]/i.test(code), false, 'Client must not make mutative HTTP requests');

  // 4. Zero Form / Editable Input Elements
  assert.equal(/h\(\s*['"](?:input|textarea|select|form)['"]/i.test(code), false, 'Client must not render form input elements');
  assert.equal(/contenteditable/i.test(code), false, 'Client must not declare contentEditable elements');

  // 5. Zero Emoji Across Entire File
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(code), false, 'lib/client.js must contain zero emojis');
});

test('Drawer Mutation Resistance: Element Traversal and Mutation Action Check', () => {
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;

  function traverseElements(element, callback) {
    if (!element || typeof element !== 'object') return;
    callback(element);
    if (Array.isArray(element.children)) {
      for (const child of element.children) {
        traverseElements(child, callback);
      }
    }
  }

  const entities = [
    {
      kind: 'session',
      id: 'session-001',
      title: 'Worker Session',
      workspace: '/workspace/app',
      status: 'running',
      agentType: 'engineer',
      stats: { inboundCalls: 2, outboundCalls: 5, postsCount: 3 }
    },
    {
      kind: 'call',
      id: 'call-001',
      callType: 'task_dispatch',
      deliveryMode: 'steer',
      durationMs: 42,
      timestamp: Date.now(),
      callerSessionId: 'sess-a',
      callerTitle: 'Caller',
      targetSessionId: 'sess-b',
      targetTitle: 'Target',
      contextPostIds: ['p1', 'p2'],
      messageSnippet: 'Dispatch payload',
      messagePayload: 'Detailed payload to review',
      status: 'active'
    },
    {
      kind: 'post',
      id: 'post-001',
      topic: 'task:build',
      tags: ['build', 'ci'],
      ttlRemainingMs: 1800000,
      authorSessionId: 'sess-author',
      workspace: '/workspace/app',
      content: 'CI build passed'
    }
  ];

  const forbiddenActionWords = [
    '编辑', '删除', '重发', '派发', '新建', '修改', '发送',
    'edit', 'delete', 'resend', 'dispatch', 'create', 'modify', 'send'
  ];

  for (const entity of entities) {
    let closeButtonCount = 0;
    let copyButtonCount = 0;
    let otherInteractiveCount = 0;

    const drawer = plugin.CanvasDrawer({
      entity,
      onClose: () => {},
      t,
      copiedKey: null,
      setCopiedKey: () => {}
    });

    traverseElements(drawer, (el) => {
      const tag = String(el.type || '').toLowerCase();
      assert.notEqual(tag, 'input');
      assert.notEqual(tag, 'textarea');
      assert.notEqual(tag, 'select');
      assert.notEqual(tag, 'form');

      if (el.props) {
        assert.equal(el.props.contentEditable, undefined);
        assert.equal(el.props.disabled, undefined);
      }

      if (tag === 'button') {
        const className = String(el.props?.className || '');
        const childrenText = (el.children || []).map(c => typeof c === 'string' ? c : '').join(' ');

        for (const word of forbiddenActionWords) {
          assert.equal(
            childrenText.toLowerCase().includes(word),
            false,
            `Drawer button must not contain mutative word "${word}", found "${childrenText}"`
          );
        }

        if (className.includes('dsh-canvas-copy-btn')) {
          copyButtonCount++;
        } else if (className.includes('dsh-canvas-btn') && (childrenText === '关闭' || childrenText === 'Close')) {
          closeButtonCount++;
        } else {
          otherInteractiveCount++;
        }
      }
    });

    assert.equal(closeButtonCount, 1, `Drawer for ${entity.kind} must have exactly 1 close button`);
    assert.ok(copyButtonCount >= 1, `Drawer for ${entity.kind} must have at least 1 copy button`);
    assert.equal(otherInteractiveCount, 0, `Drawer for ${entity.kind} must have 0 non-read-only interactive buttons`);
  }
});

test('Clipboard Copy Functionality: navigator.clipboard mock verification', async () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  let clipboardWritten = null;
  let copiedKeySet = null;

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => {
        registration = payload;
      }
    },
    requestAnimationFrame: (cb) => cb()
  };

  const sandbox = {
    window: mockWindow,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          clipboardWritten = text;
        }
      }
    },
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
    setTimeout: (fn, delay) => {
      fn();
      return 1;
    },
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(registration, 'ModuleLoader registration must be invoked');
  const plugin = registration.factory(() => null);

  const t = (k) => plugin.zh[k] || k;
  const drawer = plugin.CanvasDrawer({
    entity: {
      kind: 'post',
      id: 'post-clip-test',
      topic: 'test:copy',
      tags: ['copy'],
      content: 'Secret payload to copy',
      ttlRemainingMs: 100000
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: (k) => { copiedKeySet = k; }
  });

  let copyContentBtn = null;
  function findBtn(el) {
    if (!el || typeof el !== 'object') return;
    if (el.type === 'button' && el.props?.className?.includes('dsh-canvas-copy-btn')) {
      if (el.props.onClick) {
        copyContentBtn = el;
      }
    }
    if (Array.isArray(el.children)) el.children.forEach(findBtn);
  }
  findBtn(drawer);

  assert.ok(copyContentBtn, 'Copy button for content must exist');
  copyContentBtn.props.onClick();

  await new Promise(r => setImmediate(r));

  assert.equal(clipboardWritten, 'Secret payload to copy');
  assert.equal(copiedKeySet, null, 'CopiedKey must reset after timeout in mock');
});

test('Three-State Time-Decayed Bezier: Exact Millisecond Boundary Assertions', () => {
  const plugin = loadClientBundle();
  const { getCallEdgeDecay, calculateBezierPath } = plugin;
  const now = 1726000000000;

  // 1. Exact Boundary 0s -> State 1
  const decay0 = getCallEdgeDecay({ timestamp: now, status: 'active' }, now);
  assert.equal(decay0.opacity, 1.0);
  assert.equal(decay0.strokeWidth, 2.2);
  assert.equal(decay0.isFlowing, true);
  assert.equal(decay0.className, 'dsh-flow-edge');

  // 2. Exact Boundary 14,999ms (< 15s) -> State 1
  const decay14s = getCallEdgeDecay({ timestamp: now - 14999, status: 'active' }, now);
  assert.equal(decay14s.opacity, 1.0);
  assert.equal(decay14s.isFlowing, true);
  assert.equal(decay14s.className, 'dsh-flow-edge');

  // 3. Exact Boundary 15,001ms (> 15s && <= 60s) -> State 2
  const decay15s = getCallEdgeDecay({ timestamp: now - 15001, status: 'active' }, now);
  assert.equal(decay15s.opacity, 0.65);
  assert.equal(decay15s.strokeWidth, 1.6);
  assert.equal(decay15s.isFlowing, true);
  assert.equal(decay15s.className, 'dsh-flow-edge-slow');

  // 4. Exact Boundary 59,999ms (<= 60s) -> State 2
  const decay59s = getCallEdgeDecay({ timestamp: now - 59999, status: 'active' }, now);
  assert.equal(decay59s.opacity, 0.65);
  assert.equal(decay59s.isFlowing, true);
  assert.equal(decay59s.className, 'dsh-flow-edge-slow');

  // 5. Exact Boundary 60,001ms (> 60s) -> State 3
  const decay60s = getCallEdgeDecay({ timestamp: now - 60001, status: 'active' }, now);
  assert.equal(decay60s.opacity, 0.3);
  assert.equal(decay60s.strokeWidth, 1.2);
  assert.equal(decay60s.isFlowing, false);
  assert.equal(decay60s.className, '');

  // 6. Settled status overrides timestamp -> State 3
  const decaySettled = getCallEdgeDecay({ timestamp: now - 1000, status: 'settled' }, now);
  assert.equal(decaySettled.opacity, 0.3);
  assert.equal(decaySettled.isFlowing, false);
  assert.equal(decaySettled.className, '');

  // 7. Parallel Bezier curves offset spread verification
  const pathIdx0 = calculateBezierPath(100, 100, 300, 100, 0, 4);
  const pathIdx1 = calculateBezierPath(100, 100, 300, 100, 1, 4);
  assert.notEqual(pathIdx0, pathIdx1, 'Parallel paths with different indices must have distinct control points');

  // 8. Self-loop Bezier curve verification
  const selfPath = calculateBezierPath(200, 200, 200, 200, 0, 1);
  assert.ok(selfPath.includes('C '), 'Self-loop must use cubic Bezier (C)');
});

test('Multi-Workspace Columns & Layout: Empty State, Boundary Separation and Isolation', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  // Case 1: Empty workspaces array, fallback to currentWorkspace
  const emptyLayout = computeLayout([], [{ id: 's1', workspace: '/repo/root' }], [], '/repo/root', false);
  assert.equal(emptyLayout.workspaceBounds.length, 1);
  assert.equal(emptyLayout.workspaceBounds[0].id, '/repo/root');
  assert.ok(emptyLayout.nodePositions['s1']);

  // Case 2: 4 distinct workspaces with 10 sessions
  const multiWorkspaces = [
    { id: '/ws/1', name: 'ws-1', isCurrent: true, sessionIds: ['s1', 's2', 's3', 's4'] },
    { id: '/ws/2', name: 'ws-2', isCurrent: false, sessionIds: ['s5', 's6'] },
    { id: '/ws/3', name: 'ws-3', isCurrent: false, sessionIds: ['s7'] },
    { id: '/ws/4', name: 'ws-4', isCurrent: false, sessionIds: ['s8', 's9', 's10'] }
  ];
  const allSessions = [
    { id: 's1', workspace: '/ws/1' }, { id: 's2', workspace: '/ws/1' },
    { id: 's3', workspace: '/ws/1' }, { id: 's4', workspace: '/ws/1' },
    { id: 's5', workspace: '/ws/2' }, { id: 's6', workspace: '/ws/2' },
    { id: 's7', workspace: '/ws/3' },
    { id: 's8', workspace: '/ws/4' }, { id: 's9', workspace: '/ws/4' }, { id: 's10', workspace: '/ws/4' }
  ];

  // Default: crossWorkspace: false
  const isolatedLayout = computeLayout(multiWorkspaces, allSessions, [], '/ws/1', false);
  assert.equal(isolatedLayout.workspaceBounds.length, 1);
  assert.equal(isolatedLayout.workspaceBounds[0].id, '/ws/1');
  assert.ok(isolatedLayout.nodePositions['s1']);
  assert.ok(isolatedLayout.nodePositions['s4']);
  assert.equal(isolatedLayout.nodePositions['s5'], undefined, 'Cross-workspace session s5 must be excluded');
  assert.equal(isolatedLayout.nodePositions['s8'], undefined, 'Cross-workspace session s8 must be excluded');

  // Permissive: crossWorkspace: true
  const fullLayout = computeLayout(multiWorkspaces, allSessions, [], '/ws/1', true);
  assert.equal(fullLayout.workspaceBounds.length, 4);
  for (let i = 0; i < fullLayout.workspaceBounds.length - 1; i++) {
    const curr = fullLayout.workspaceBounds[i];
    const next = fullLayout.workspaceBounds[i + 1];
    assert.ok(
      next.x >= curr.x + curr.width + 30,
      `Workspace column ${i+1} (${next.name}) must be separated from ${i} (${curr.name}) by at least 30px`
    );
  }
  for (const s of allSessions) {
    assert.ok(fullLayout.nodePositions[s.id], `Session ${s.id} must be positioned in multi-workspace layout`);
  }
});

test('Topology Visual Layout Engine: Blackboard strip, side-by-side workspace columns, and single-column session coordinates', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  const workspaces = [
    { id: '/ws/alpha', name: 'alpha', isCurrent: true, sessionIds: ['s1', 's2', 's3'] },
    { id: '/ws/beta', name: 'beta', isCurrent: false, sessionIds: ['s4', 's5'] }
  ];
  const sessions = [
    { id: 's1', workspace: '/ws/alpha' },
    { id: 's2', workspace: '/ws/alpha' },
    { id: 's3', workspace: '/ws/alpha' },
    { id: 's4', workspace: '/ws/beta' },
    { id: 's5', workspace: '/ws/beta' }
  ];
  const posts = [
    { id: 'p1', topic: 'task:spec' },
    { id: 'p2', topic: 'task:impl' },
    { id: 'p3', topic: 'task:qa' }
  ];

  const layout = computeLayout(workspaces, sessions, posts, '/ws/alpha', true);

  // 1. 顶部黑板栏 (Top blackboard strip) 边界坐标断言
  assert.ok(layout.blackboardBound, 'blackboardBound must be returned');
  assert.equal(layout.blackboardBound.x, 40, 'Top blackboard strip x must be 40');
  assert.equal(layout.blackboardBound.y, 24, 'Top blackboard strip y must be 24');
  assert.equal(layout.blackboardBound.height, 96, 'Top blackboard strip height must be 96');
  // bbWidth = Math.max(1080, bbWidthFromWs, bbWidthFromPosts)
  // bbWidthFromWs = 2 * (260 + 36) - 36 + 80 = 636
  // bbWidthFromPosts = 56 + 3 * (180 + 16) + 40 = 684
  assert.equal(layout.blackboardBound.width, 1080, 'Top blackboard strip width must be at least 1080');

  // 黑板条目方块坐标断言
  assert.equal(layout.postPositions['p1'].x, 56, 'First post x must be 56');
  assert.equal(layout.postPositions['p1'].y, 52, 'First post y must be 52');
  assert.equal(layout.postPositions['p1'].width, 180, 'Post card width must be 180');
  assert.equal(layout.postPositions['p1'].height, 48, 'Post card height must be 48');

  assert.equal(layout.postPositions['p2'].x, 56 + 196, 'Second post x must be 56 + 196 = 252');
  assert.equal(layout.postPositions['p2'].y, 52, 'Second post y must be 52');
  assert.equal(layout.postPositions['p3'].x, 56 + 2 * 196, 'Third post x must be 56 + 392 = 448');

  // 2. 并排工作区列 (Side-by-side vertical workspace columns) 坐标断言
  assert.equal(layout.workspaceBounds.length, 2);
  const laneAlpha = layout.workspaceBounds[0];
  const laneBeta = layout.workspaceBounds[1];

  assert.equal(laneAlpha.x, 40, 'First workspace column x must be 40');
  assert.equal(laneAlpha.y, 150, 'Workspace columns y start must be 150');
  assert.equal(laneAlpha.width, 260, 'Workspace column width must be 260');
  assert.equal(laneAlpha.height, 480, 'Workspace column minHeight must be 480 (76 + 3*72 + 24 = 316 < 480)');

  assert.equal(laneBeta.x, 40 + 260 + 36, 'Second workspace column x must be 336 (40 + 260 + 36)');
  assert.equal(laneBeta.y, 150, 'Second workspace column y start must be 150');
  assert.equal(laneBeta.width, 260, 'Second workspace column width must be 260');
  assert.equal(laneBeta.height, 480, 'Second workspace column minHeight must be 480');

  // 3. 工作区列内单列 session 坐标断言 (Single-column vertical centered session nodes)
  // Lane Alpha: cx = 40 + 130 = 170
  assert.equal(layout.nodePositions['s1'].x, 170, 's1 cx must be centered in column at 170');
  assert.equal(layout.nodePositions['s1'].y, 240, 's1 cy must start at 240');

  assert.equal(layout.nodePositions['s2'].x, 170, 's2 cx must stay in single column at 170');
  assert.equal(layout.nodePositions['s2'].y, 240 + 72, 's2 cy must be 240 + 72 = 312');

  assert.equal(layout.nodePositions['s3'].x, 170, 's3 cx must stay in single column at 170');
  assert.equal(layout.nodePositions['s3'].y, 240 + 2 * 72, 's3 cy must be 240 + 144 = 384');

  // Lane Beta: cx = 336 + 130 = 466
  assert.equal(layout.nodePositions['s4'].x, 466, 's4 cx must be centered in swimlane at 466');
  assert.equal(layout.nodePositions['s4'].y, 240, 's4 cy must start at 240');

  assert.equal(layout.nodePositions['s5'].x, 466, 's5 cx must stay in single column at 466');
  assert.equal(layout.nodePositions['s5'].y, 312, 's5 cy must be 312');

  // 单列纵向居中不变式：同工作区列内的全部会话 x 坐标必须严格相同
  const alphaXSet = new Set(['s1', 's2', 's3'].map(id => layout.nodePositions[id].x));
  assert.equal(alphaXSet.size, 1, 'All sessions in alpha swimlane must share identical x coordinate (single-column)');
  const betaXSet = new Set(['s4', 's5'].map(id => layout.nodePositions[id].x));
  assert.equal(betaXSet.size, 1, 'All sessions in beta swimlane must share identical x coordinate (single-column)');
});

test('Three Relationship Edge Classes: Edge generation and boundary tolerance (missing author, empty context, non-existent sessions)', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => { registration = payload; }
    },
    requestAnimationFrame: (cb) => cb()
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
  assert.ok(registration);

  const mockTelemetry = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/main',
    workspaces: [{ id: '/ws/main', name: 'main', isCurrent: true, sessionIds: ['s1', 's2'] }],
    sessions: [
      { id: 's1', workspace: '/ws/main', status: 'running', title: 'Session 1' },
      { id: 's2', workspace: '/ws/main', status: 'idle', title: 'Session 2' }
    ],
    posts: [
      // 1. 正常归属发布条目
      { id: 'post-valid', topic: 'task:valid', authorSessionId: 's1' },
      // 2. 边界 1: 缺失 authorSessionId
      { id: 'post-missing-author-1', topic: 'task:no-author' },
      { id: 'post-missing-author-2', topic: 'task:null-author', authorSessionId: null },
      { id: 'post-missing-author-3', topic: 'task:empty-author', authorSessionId: '' },
      // 3. 边界 3: authorSessionId 指向不存在会话
      { id: 'post-orphan-author', topic: 'task:orphan', authorSessionId: 'session-ghost' }
    ],
    calls: [
      // 1. 正常调用与关联黑板引用
      {
        id: 'call-valid-with-ctx',
        callerSessionId: 's1',
        targetSessionId: 's2',
        callType: 'task_dispatch',
        contextPostIds: ['post-valid'],
        timestamp: Date.now() - 5000,
        status: 'active'
      },
      // 2. 边界 2: 空 contextPostIds (或非数组/null/undefined)
      {
        id: 'call-empty-ctx',
        callerSessionId: 's1',
        targetSessionId: 's2',
        callType: 'notice',
        contextPostIds: [],
        timestamp: Date.now() - 5000,
        status: 'active'
      },
      {
        id: 'call-null-ctx',
        callerSessionId: 's1',
        targetSessionId: 's2',
        callType: 'task_report',
        contextPostIds: null,
        timestamp: Date.now() - 5000,
        status: 'active'
      },
      // 3. 边界 3: 指向不存在会话的调用 (caller 或 target 不在当前 nodePositions 中)
      {
        id: 'call-orphan-caller',
        callerSessionId: 'session-ghost-caller',
        targetSessionId: 's2',
        callType: 'task_dispatch',
        contextPostIds: ['post-valid'],
        timestamp: Date.now() - 5000,
        status: 'active'
      },
      {
        id: 'call-orphan-target',
        callerSessionId: 's1',
        targetSessionId: 'session-ghost-target',
        callType: 'task_dispatch',
        contextPostIds: ['post-valid'],
        timestamp: Date.now() - 5000,
        status: 'active'
      }
    ],
    metrics: { totalSessions: 2, runningSessions: 1, activeCalls: 1, totalPosts: 1 }
  };

  const mockReact = {
    useState: (initial) => {
      if (initial && typeof initial === 'object' && 'sessions' in initial) {
        return [mockTelemetry, () => {}];
      }
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const plugin = registration.factory((name) => name === 'react' ? mockReact : null);
  const view = plugin.CanvasView({ sessionId: 's1', t: (k) => k });

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && node.props.id === id) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  // 1. 审查第一类边：发布归属边 (dsh-canvas-author-edges)
  const authorEdgesGroup = findNodeById(view, 'dsh-canvas-author-edges');
  assert.ok(authorEdgesGroup, 'dsh-canvas-author-edges group must exist');
  const validAuthorPaths = authorEdgesGroup.children.filter(Boolean);

  // 断言：仅为有合法 authorSessionId 且目标会话存在的条目生成边
  assert.equal(validAuthorPaths.length, 1, '仅生成 1 条合法的 session->post 归属边');
  assert.equal(validAuthorPaths[0].props.key, 'author-s1->post-valid');
  assert.ok(validAuthorPaths[0].props.d.startsWith('M 266.0 240.0 C '), '归属边必须从 session 右侧边界 (170+96=266, 240) 发起并使用三次贝塞尔走外侧通道');
  assert.ok(validAuthorPaths[0].props.d.includes(' 146.0 100.0'), '归属边终点连接至 post 下边界 (56+90=146, 52+48=100)');
  assert.equal(validAuthorPaths[0].props.stroke, '#64748b', '归属边默认描边颜色为 #64748b');
  assert.equal(validAuthorPaths[0].props.strokeWidth, '1.2', '归属边默认线宽必须提升至 1.2px');
  assert.equal(validAuthorPaths[0].props.strokeDasharray, '4 3', '归属边默认虚线样式为 4 3');
  assert.equal(validAuthorPaths[0].props.strokeOpacity, 0.5, '归属边默认透明度必须提升至 0.50 (WCAG 2.1 对比度标准)');

  // 边界 1 & 边界 3 验证：缺失 authorSessionId 与指向不存在会话的 4 条 post 均安全返回 null，不产生边且不抛错
  const nullAuthorItems = authorEdgesGroup.children.filter(c => c === null);
  assert.equal(nullAuthorItems.length, 4, '缺失 authorSessionId 或指向不存在会话的条目全部安全返回 null');

  // 2. 审查第二类边：调用引用黑板边 (dsh-canvas-context-edges)
  const contextEdgesGroup = findNodeById(view, 'dsh-canvas-context-edges');
  assert.ok(contextEdgesGroup, 'dsh-canvas-context-edges group must exist');
  const validContextPaths = contextEdgesGroup.children.filter(Boolean).flat().filter(Boolean);

  // 断言：仅为包含 contextPostIds 且 caller/target/post 均存在的调用生成引用边
  assert.equal(validContextPaths.length, 1, '仅生成 1 条合法的 call->post 引用边');
  assert.equal(validContextPaths[0].props.key, 'ctx-call-valid-with-ctx->post-valid');
  assert.ok(validContextPaths[0].props.d.startsWith('M '), '引用边必须生成合法的二次贝塞尔曲线');
  assert.ok(validContextPaths[0].props.d.includes(' 146.0 100.0'), '引用边终点连接至 post 下边界');
  assert.equal(validContextPaths[0].props.stroke, '#fbbf24', '引用边描边颜色必须采用高辨识度琥珀色 #fbbf24');
  assert.equal(validContextPaths[0].props.strokeWidth, '1.0', '引用边默认线宽必须调整为 1.0px');
  assert.equal(validContextPaths[0].props.strokeDasharray, '3 3', '引用边虚线样式为 3 3');
  assert.equal(validContextPaths[0].props.strokeOpacity, 0.45, '引用边默认透明度必须提升至 0.45 (WCAG 2.1 对比度标准)');

  // 边界 2 & 边界 3 验证：空 contextPostIds 或指向不存在会话的调用均不生成 context 边
  const nullContextItems = contextEdgesGroup.children.filter(c => c === null);
  assert.equal(nullContextItems.length, 4, '空 contextPostIds 或指向不存在会话的调用必须安全返回 null');

  // 3. 审查第三类边：会话间调用边 (dsh-canvas-call-edges)
  const callEdgesGroup = findNodeById(view, 'dsh-canvas-call-edges');
  assert.ok(callEdgesGroup, 'dsh-canvas-call-edges group must exist');
  const validCallNodes = callEdgesGroup.children.filter(Boolean);

  // 断言：仅当 caller 和 target 会话都在 nodePositions 中时才生成调用连线
  // 5 条调用中，2 条指向不存在会话 (call-orphan-caller, call-orphan-target)，3 条合法 (call-valid-with-ctx, call-empty-ctx, call-null-ctx)
  assert.equal(validCallNodes.length, 3, '仅为合法会话对生成 3 条调用边');
  const callKeys = validCallNodes.map(n => n.props.key);
  assert.deepEqual(callKeys, ['call-valid-with-ctx', 'call-empty-ctx', 'call-null-ctx']);

  // 边界 3 验证：指向不存在会话的调用安全返回 null
  const nullCallItems = callEdgesGroup.children.filter(c => c === null);
  assert.equal(nullCallItems.length, 2, '指向不存在会话的调用必须安全返回 null');

  // 验证连线具有精确椭圆边界裁剪与正确的 markerEnd 箭头
  const callG = validCallNodes[0];
  const strokePath = callG.children[1];
  assert.ok(strokePath.props.d.startsWith('M '), '调用边必须包含路径点');
  assert.equal(strokePath.props.markerEnd, 'url(#dsh-arrow-dispatch)');
});

test('Text Truncation by Rendered Width: Chinese, English, and mixed inputs (PRD 5.4)', () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  const fnMatch = clientSource.match(/function truncateTextByWidth[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'truncateTextByWidth implementation must exist in lib/client.js');
  const truncateTextByWidth = new Function(`return (${fnMatch[0]});`)();

  // 1. 纯中文输入 (Wide chars: 12.5px, Ellipsis: 16px)
  // 短中文：4 * 12.5 = 50px <= 80px -> 原样返回
  assert.equal(truncateTextByWidth('深度协同', 80), '深度协同');
  // 边界相等：6 * 12.5 = 75px <= 80px -> 原样返回
  assert.equal(truncateTextByWidth('会话协同全景', 80), '会话协同全景');
  // 超长中文截断：maxWidth = 80, limitW = 80 - 16 = 64px. 64 / 12.5 = 5.12 -> 截取前 5 个字 + '...'
  // '深度思考智能体全流程协同' -> '深度思考智...' (5 * 12.5 = 62.5 <= 64)
  assert.equal(truncateTextByWidth('深度思考智能体全流程协同', 80), '深度思考智...');

  // 2. 纯英文输入 (ASCII chars: 7.2px, Ellipsis: 16px)
  // 短英文：7 * 7.2 = 50.4px <= 80px -> 原样返回
  assert.equal(truncateTextByWidth('Session', 80), 'Session');
  // 超长英文截断：maxWidth = 80, limitW = 80 - 16 = 64px. 64 / 7.2 = 8.88 -> 截取前 8 个字母 + '...'
  // 'SessionCallDispatcherEngine' -> 'SessionC...' (8 * 7.2 = 57.6 <= 64)
  assert.equal(truncateTextByWidth('SessionCallDispatcherEngine', 80), 'SessionC...');

  // 3. 中英混排输入 (ASCII 7.2px, Wide 12.5px)
  // 短混排：'DSH看板' = 3 * 7.2 + 2 * 12.5 = 21.6 + 25 = 46.6px <= 80px -> 原样返回
  assert.equal(truncateTextByWidth('DSH看板', 80), 'DSH看板');
  // 长混排截断：'DSH协同画板Canvas拓扑分析'
  // 'DSH' (21.6) + '协同' (25) = 46.6. '画' (12.5) -> 59.1 <= 64. '板' (12.5) -> 71.6 > 64.
  // 故截断在 'DSH协同画' + '...'
  assert.equal(truncateTextByWidth('DSH协同画板Canvas拓扑分析', 80), 'DSH协同画...');

  // 4. 边界异常值测试
  assert.equal(truncateTextByWidth('', 80), '');
  assert.equal(truncateTextByWidth(null, 80), '');
  assert.equal(truncateTextByWidth(undefined, 80), '');
  assert.equal(truncateTextByWidth('abc', 0), '...');
});

test('Session Short Code Normalization: lib/client.js parity with telemetry specification', () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  const fnMatch = clientSource.match(/function computeSessionShortId[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'computeSessionShortId implementation must exist in lib/client.js');
  const computeSessionShortId = new Function(`return (${fnMatch[0]});`)();

  // 1. session- 前缀形态
  assert.equal(
    computeSessionShortId('session-da929b7d-7912-4e03-a95a-8e76231ed1b7'),
    'da929b7d'
  );
  assert.equal(
    computeSessionShortId('SESSION-A1B2C3D4-5678-90AB'),
    'a1b2c3d4'
  );
  assert.equal(computeSessionShortId('session-xyz'), 'xyz');

  // 2. 裸 uuid 形态
  assert.equal(
    computeSessionShortId('da929b7d-7912-4e03-a95a-8e76231ed1b7'),
    'da929b7d'
  );
  assert.equal(
    computeSessionShortId('A1B2C3D4-5678-90AB'),
    'a1b2c3d4'
  );
  assert.equal(computeSessionShortId('9988aabb'), '9988aabb');

  // 3. 边界值测试
  assert.equal(computeSessionShortId(null), 'unknown');
  assert.equal(computeSessionShortId(undefined), 'unknown');
  assert.equal(computeSessionShortId(''), 'unknown');
  assert.equal(computeSessionShortId('session-'), 'unknown');
  assert.equal(computeSessionShortId('___---___'), 'unknown');
});

test('SVG Transform Invariants: Breathing indicator transform-box and transform-origin compliance', () => {
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');

  // 1. CSS 声明检查：.dsh-pulse-dot 必须声明 transform-box: fill-box !important
  assert.ok(
    clientSource.includes('.dsh-pulse-dot {'),
    'CSS must define .dsh-pulse-dot rule'
  );
  assert.ok(
    clientSource.includes('transform-box: fill-box !important;'),
    'CSS .dsh-pulse-dot must declare transform-box: fill-box !important to prevent SVG viewport origin skew'
  );
  assert.ok(
    clientSource.includes('transform-origin: center !important;'),
    'CSS .dsh-pulse-dot must declare transform-origin: center !important'
  );

  // 2. 运行期 DOM 节点检查：running 会话节点必须挂载 dsh-pulse-dot 样式类，idle 会话节点不挂载
  const mockTelemetry = {
    timestamp: Date.now(),
    currentWorkspace: '/ws',
    workspaces: [{ id: '/ws', name: 'ws', isCurrent: true, sessionIds: ['s-run', 's-idle'] }],
    sessions: [
      { id: 's-run', workspace: '/ws', status: 'running', title: 'Running Worker' },
      { id: 's-idle', workspace: '/ws', status: 'idle', title: 'Idle Worker' }
    ],
    posts: [],
    calls: [],
    metrics: { totalSessions: 2, runningSessions: 1, activeCalls: 0, totalPosts: 0 }
  };

  const mockReact = {
    useState: (initial) => {
      if (initial && typeof initial === 'object' && 'sessions' in initial) {
        return [mockTelemetry, () => {}];
      }
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const plugin = loadClientBundle((name) => name === 'react' ? mockReact : null);
  const view = plugin.CanvasView({ sessionId: 's-run', t: (k) => k });

  function findCircles(node, acc = []) {
    if (!node || typeof node !== 'object') return acc;
    if (node.type === 'circle') acc.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) findCircles(child, acc);
    }
    return acc;
  }

  const circles = findCircles(view);
  // 每个 session node 在椭圆外侧有一个状态指示灯 circle
  const runningCircle = circles.find(c => c.props && c.props.className === 'dsh-pulse-dot');
  assert.ok(runningCircle, 'Running session node must have status circle with dsh-pulse-dot className');
  assert.equal(Number(runningCircle.props.r), 4.5, 'Pulse circle radius must be 4.5');

  const idleCircle = circles.find(c => c.props && c.props.className === '');
  assert.ok(idleCircle, 'Idle session node must have status circle without dsh-pulse-dot');
});

test('Strict Read-Only Invariants: Zero input controls, zero mutative actions, zero emoji across client', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  // 1. 无输入表单控件
  assert.equal(/<input/i.test(code), false, 'lib/client.js must not contain <input');
  assert.equal(/<textarea/i.test(code), false, 'lib/client.js must not contain <textarea');
  assert.equal(/<select/i.test(code), false, 'lib/client.js must not contain <select');
  assert.equal(/<form/i.test(code), false, 'lib/client.js must not contain <form');
  assert.equal(/contenteditable/i.test(code), false, 'lib/client.js must not declare contenteditable');

  // 2. 无写方法调用与变异 HTTP
  assert.equal(/method\s*:\s*['"](?:POST|PUT|DELETE|PATCH)['"]/i.test(code), false, 'Must not make mutative HTTP requests');
  assert.equal(/ctx\.(?:tools|tool|command|slash)\./.test(code), false, 'Must not register tools or commands');

  // 3. 全文与国际化字典零 Emoji
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(code), false, 'lib/client.js must contain zero emoji');

  // 4. CanvasView 虚拟 DOM 全树遍历检查
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;
  const view = plugin.CanvasView({ sessionId: 'session-ro', t });

  function traverse(node) {
    if (!node || typeof node !== 'object') return;
    const tag = String(node.type || '').toLowerCase();
    assert.notEqual(tag, 'input');
    assert.notEqual(tag, 'textarea');
    assert.notEqual(tag, 'select');
    assert.notEqual(tag, 'form');
    if (node.props) {
      assert.equal(node.props.contentEditable, undefined);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) traverse(child);
    }
  }
  traverse(view);
});

test('协作看板实测缺陷回归：真实标题、黑板空态、抽屉遮罩与加载状态', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => { registration = payload; }
    },
    requestAnimationFrame: (cb) => cb()
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
  assert.ok(registration);

  const mockTelemetry = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/test',
    workspaces: [{ id: '/ws/test', name: 'test', isCurrent: true, sessionIds: ['session-s1'] }],
    sessions: [{ id: 'session-s1', title: '测试会话', workspace: '/ws/test', state: 'idle' }],
    posts: [],
    calls: []
  };

  const mockReact = {
    useState: (initial) => {
      if (initial && typeof initial === 'object' && 'sessions' in initial) {
        return [mockTelemetry, () => {}];
      }
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const plugin = registration.factory((name) => name === 'react' ? mockReact : null);
  const t = (k) => plugin.zh[k] || k;

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  // 1. 验证黑板条目为 0 时的空态呈现与居中自适应
  const emptyView = plugin.CanvasView({ sessionId: 'session-s1', t });

  // 验证空态下黑板图层存在空态提示文本
  const bbLayer = findNodeById(emptyView, 'dsh-canvas-blackboard-layer');
  assert.ok(bbLayer, '黑板图层必须渲染');
  const emptyText = bbLayer.children.find(c => c && c.type === 'text' && c.children && c.children.includes(plugin.zh['blackboard.empty']));
  assert.ok(emptyText, '黑板条目为 0 时必须渲染“暂无活跃条目”');

  // 2. 验证会话标题正常渲染真实标题
  const nodeLayer = findNodeById(emptyView, 'dsh-canvas-nodes');
  assert.ok(nodeLayer, '节点图层必须渲染');
  const sessionG = nodeLayer.children[0];
  const texts = sessionG.children.filter(c => c && c.type === 'text');
  assert.equal(texts[1].children[0], '测试会话', '有标题时正确渲染真实标题');

  // 3. 验证抽屉只读角标在英文环境下为 Read-Only
  const drawer = plugin.CanvasDrawer({
    entity: { kind: 'post', id: 'p1', topic: 'test', status: 'active' },
    onClose: () => {},
    t: (k) => plugin.en[k] || k,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  const header = drawer.children[0];
  const titleGroup = header.children[0];
  const readonlyBadge = titleGroup.children[1];
  assert.equal(readonlyBadge.children[0], 'Read-Only', '英文环境下角标必须为 Read-Only，严禁硬编码篡改为中文“只读”');

  // 4. 验证 CSS 隔离属性与 PRD 9.2 避让安全区
  assert.ok(code.includes('isolation: isolate;'), '必须包含 isolation: isolate 防止背景穿透');
  assert.ok(code.includes('flex: 1 1 0%;'), '必须包含 flex: 1 1 0% 遵循标准文档流');
  assert.ok(code.includes('padding-right: 76px !important;'), '必须包含 padding-right: 76px !important 避让安全区 (PRD 9.2)');

  // 5. 验证抽屉选中时存在背景遮罩层并具备关闭回调 (PRD 7.3)
  let maskClicked = false;
  let stateCallCount = 0;
  const mockSelectedReact = {
    useState: (initial) => {
      stateCallCount++;
      if (stateCallCount === 1) {
        return [mockTelemetry, () => {}];
      }
      if (stateCallCount === 2) {
        return [{ id: 's1', title: 'Session 1', workspace: '/ws/1' }, (val) => {
          if (val === null) maskClicked = true;
        }];
      }
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };
  const selectedPlugin = registration.factory((name) => name === 'react' ? mockSelectedReact : null);
  const viewVNode = selectedPlugin.CanvasView({ sessionId: 's1', t: (k) => k });
  
  // 递归查找 VNode 树中的遮罩层节点
  function findVNode(node, predicate) {
    if (!node) return null;
    if (predicate(node)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findVNode(child, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  const maskNode = findVNode(viewVNode, (n) => n && n.props && n.props.className === 'dsh-canvas-drawer-mask');
  assert.ok(maskNode, '必须真实渲染出 className 为 dsh-canvas-drawer-mask 的遮罩节点 (PRD 7.3)');
  assert.equal(typeof maskNode.props.onClick, 'function', '抽屉遮罩层必须挂载 onClick 关闭回调函数');
  maskNode.props.onClick();
  assert.equal(maskClicked, true, '点击抽屉遮罩层必须触发 setSelectedEntity(null) 关闭抽屉');
});

test('全量合规审查：三次贝塞尔外切、无重复节点渲染、工作区分组容器头部高度与交互契约', () => {
  const plugin = loadClientBundle();
  const { calculateBezierPath, computeLayout, getCallEdgeDecay } = plugin;

  // 1. 自环调用三次贝塞尔外切无穿透验证
  const cx = 150, cy = 120;
  const selfPath = calculateBezierPath(cx, cy, cx, cy, 0, 1);
  assert.ok(selfPath.includes('C '), '自环必须采用平滑三次贝塞尔曲线 (C)');
  const mMatch = selfPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(mMatch, '自环路径必须以 M 起点开始');
  const startX = parseFloat(mMatch[1]);
  const startY = parseFloat(mMatch[2]);
  const normDist = Math.pow((startX - cx) / 96, 2) + Math.pow((startY - cy) / 26, 2);
  assert.ok(Math.abs(normDist - 1.0) < 0.08, `自环起点必须精确落在椭圆轮廓上，实测归一化距离: ${normDist}`);

  // 2. nodePositions 唯一性断言（防止大小写重复插入导致渲染翻倍）
  const sessions = [
    { id: 'Session-Alpha', title: 'Alpha', workspace: '/ws/1' },
    { id: 'SESSION-BETA', title: 'Beta', workspace: '/ws/1' },
    { id: 'session-gamma', title: 'Gamma', workspace: '/ws/1' }
  ];
  const layout = computeLayout([{ id: '/ws/1', name: 'ws-1', isCurrent: true }], sessions, [], '/ws/1', false);
  const keys = Object.keys(layout.nodePositions);
  assert.equal(keys.length, 3, 'nodePositions 字典只保留原始 session.id，禁止插入额外小写副本导致重复渲染');
  assert.ok(keys.includes('Session-Alpha'));
  assert.ok(keys.includes('SESSION-BETA'));
  assert.ok(keys.includes('session-gamma'));

  // 3. 工作区分组容器头部尺寸规格验证
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  assert.ok(clientSource.includes('height: 38,'), '工作区列头部高度必须严格为 38px (PRD 3.1)');
  assert.ok(clientSource.includes("fill: '#94a3b8'"), '工作区列头部文字色值必须为 #94a3b8');
  assert.ok(clientSource.includes("z-index: 100;"), 'L2 Tooltip z-index 必须为 100 置顶');
  assert.ok(clientSource.includes("transform-box: fill-box !important;"), '呼吸指示灯必须声明 transform-box: fill-box !important');

  // 窗口失焦与聚焦时遥测轮询退避与恢复的运行时动态行为验证
  let registeredListeners = {};
  let currentIntervalMs = null;
  let timerClearedCount = 0;
  let fetchCount = 0;

  const mockRuntimeWindow = {
    addEventListener: (event, handler) => {
      registeredListeners[event] = handler;
    },
    removeEventListener: (event, handler) => {
      if (registeredListeners[event] === handler) {
        delete registeredListeners[event];
      }
    },
    cancelAnimationFrame: () => {}
  };

  const mockRuntimeDocument = {
    addEventListener: (event, handler) => {
      registeredListeners[event] = handler;
    },
    removeEventListener: (event, handler) => {
      if (registeredListeners[event] === handler) {
        delete registeredListeners[event];
      }
    },
    getElementById: () => null,
    createElement: () => ({ setAttribute: () => {}, textContent: '' }),
    head: { appendChild: () => {} },
    hidden: false
  };

  const mockEffectReact = {
    useState: (initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    _cleanups: [],
    useEffect: (fn) => {
      // 真实触发副作用执行并保存 cleanup 函数
      const cleanup = fn();
      if (typeof cleanup === 'function') {
        mockEffectReact._cleanups.push(cleanup);
      }
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const runtimeSandbox = {
    window: mockRuntimeWindow,
    document: mockRuntimeDocument,
    setInterval: (fn, ms) => {
      currentIntervalMs = ms;
      return 12345;
    },
    clearInterval: (id) => {
      timerClearedCount++;
    },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    console,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Math,
    JSON,
    URLSearchParams
  };

  let runtimeRegistration = null;
  mockRuntimeWindow.__ModuleLoader__ = {
    load: (payload) => {
      runtimeRegistration = payload;
    }
  };

  vm.createContext(runtimeSandbox);
  vm.runInContext(clientSource, runtimeSandbox);
  const runtimePlugin = runtimeRegistration.factory((name) => name === 'react' ? mockEffectReact : null);

  // 挂载 CanvasView 触发 useEffect 启动轮询
  runtimePlugin.CanvasView({
    sessionId: 'session-runtime-test',
    t: (k) => k,
    fetchTelemetry: async () => {
      fetchCount++;
      return { sessions: [], calls: [], posts: [], workspaces: [] };
    }
  });

  // 初始状态断言：默认 1500ms 高频轮询，已绑定 blur 与 focus
  assert.equal(currentIntervalMs, 1500, '挂载初始轮询周期必须为 1500ms');
  assert.equal(typeof registeredListeners['blur'], 'function', '必须向 window 注册 blur 事件监听函数');
  assert.equal(typeof registeredListeners['focus'], 'function', '必须向 window 注册 focus 事件监听函数');

  // 派发 window blur 事件：断言退避至 5000ms 低频
  registeredListeners['blur']();
  assert.equal(currentIntervalMs, 5000, '失焦后轮询周期必须退避至 5000ms');

  // 派发 window focus 事件：断言恢复 1500ms 高频并即时拉取快照
  const prevFetchCount = fetchCount;
  registeredListeners['focus']();
  assert.equal(currentIntervalMs, 1500, '重新聚焦后轮询周期必须恢复至 1500ms');
  assert.ok(fetchCount > prevFetchCount, '重新聚焦时必须立即触发一次遥测拉取 fetchSnapshot');

  // 执行卸载 cleanup：断言解绑 blur 与 focus，并清理定时器
  mockEffectReact._cleanups.forEach((cleanup) => cleanup());
  assert.equal(registeredListeners['blur'], undefined, '卸载时必须解绑 window blur 监听');
  assert.equal(registeredListeners['focus'], undefined, '卸载时必须解绑 window focus 监听');
  assert.ok(timerClearedCount >= 3, '卸载时必须显式调用 clearInterval 清除定时器');

  // 虚拟端点缺省标题回退验证（无显式标题时保底为 Agent 短码格式）
  const fallbackCall = {
    id: 'c-fallback',
    callerSessionId: 's-fallback-1',
    callerWorkspace: '/ws/1',
    callerTitle: '',
    callerOffline: true,
    status: 'settled'
  };
  const fallbackLayout = computeLayout([{ id: '/ws/1', name: 'ws-1', isCurrent: true }], [], [], '/ws/1', false, [fallbackCall]);
  const fallbackNode = fallbackLayout.nodePositions['s-fallback-1'];
  assert.ok(fallbackNode, '虚拟端点节点必须存在');
  assert.equal(fallbackNode.session.title.startsWith('Agent '), true, '无标题虚拟端点必须安全回退为 Agent 短码格式');

  // 离线/虚拟端点状态消费验证（PRD 缺陷 5 完整实现：渲染 session.offline）
  const offlineSessionDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'session',
      id: 'session-offline-1',
      title: 'Offline Agent',
      isArchived: true,
      isVirtual: true,
      workspace: '/ws/1',
      status: 'idle'
    },
    onClose: () => {},
    t: (k) => plugin.zh[k] || k,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  // 查找抽屉字段列表中的状态字段
  const drawerBody = offlineSessionDrawer.children[1];
  const metaSection = drawerBody.children[0];
  const fields = metaSection.children.slice(1);
  const statusField = fields.find((f) => f && f.children && f.children[0] && f.children[0].children && f.children[0].children[0] === '状态');
  assert.ok(statusField, '必须渲染状态字段');
  const statusValueSpan = statusField.children[1].children[0];
  assert.equal(statusValueSpan.children[0], '会话已离线', '离线/归档端点必须展示「会话已离线」(session.offline)');

  // 英文抽屉状态消费验证
  const offlineSessionDrawerEn = plugin.CanvasDrawer({
    entity: {
      kind: 'session',
      id: 'session-offline-en',
      title: 'Offline Agent En',
      isArchived: true,
      isVirtual: true,
      workspace: '/ws/1',
      status: 'idle'
    },
    onClose: () => {},
    t: (k) => plugin.en[k] || k,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  const drawerBodyEn = offlineSessionDrawerEn.children[1];
  const metaSectionEn = drawerBodyEn.children[0];
  const fieldsEn = metaSectionEn.children.slice(1);
  const statusFieldEn = fieldsEn.find((f) => f && f.children && f.children[0] && f.children[0].children && f.children[0].children[0] === 'Status');
  assert.ok(statusFieldEn, '必须渲染 English Status 字段');
  const statusValueSpanEn = statusFieldEn.children[1].children[0];
  assert.equal(statusValueSpanEn.children[0], 'Session Offline', '英文抽屉中必须展示「Session Offline」');

  // 历史调用连线留存验证（PRD 3.1 & 3.3：>1800s 不物理抹除，保持 Settled 历史虚线）
  const longTaskCall = {
    id: 'call-long-history',
    callerSessionId: 's1',
    targetSessionId: 's2',
    status: 'settled',
    timestamp: Date.now() - 3600 * 1000 // 1小时前
  };
  const historyDecay = getCallEdgeDecay(longTaskCall, Date.now());
  assert.equal(historyDecay.opacity, 0.3, '长任务历史调用必须保持 0.3 不透明度，严禁物理抹除为 0');
  assert.equal(historyDecay.strokeWidth, 1.2, '长任务历史调用保持 1.2px 虚线');
  assert.equal(historyDecay.isFlowing, false);
});

test('协作看板缺陷回归验证：session.offline 端到端消费、抽屉统一口径、Post Tags 展示、Fit View 真实包围盒与无可选链语法', () => {
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  // 1. 断言 lib/client.js 中严格无可选链语法 (?.)，确保严格 ES5 兼容性
  assert.equal(code.includes('?.'), false, 'lib/client.js 严禁包含可选链语法 (?.) 以确保浏览器环境兼容');

  // 2. 抽屉无全量计数口径矛盾断言 (PRD 6.4)
  // 当 blackboard_hub 带有 activeCount 与 totalCount 时，抽屉仅展示活跃条目数，绝不出现 totalCount/stats.totalPosts
  const hubDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'blackboard_hub',
      id: 'hub-1',
      activeCount: 3,
      totalCount: 8
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  function findVNodes(node, predicate, acc = []) {
    if (!node) return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        findVNodes(child, predicate, acc);
      }
    }
    return acc;
  }
  const fieldRows = findVNodes(hubDrawer, (n) => n && n.props && n.props.className === 'dsh-canvas-drawer-field');
  assert.equal(fieldRows.length, 2, '黑板 Hub 抽屉仅允许渲染 hub 标识与 activeCount 计数字段，严禁包含 totalCount 冗余行');
  const activePostField = fieldRows.find((f) => findVNodes(f, (n) => n && n.children && n.children.includes(t('blackboard.activePosts'))).length > 0);
  assert.ok(activePostField, '黑板 Hub 抽屉必须包含活跃条目计数字段');
  const countSpan = findVNodes(activePostField, (n) => n && n.children && n.children.includes('3'));
  assert.ok(countSpan.length > 0, '黑板 Hub 抽屉必须正确展示 activeCount 计数值 3');
  const forbiddenTotalSpan = findVNodes(hubDrawer, (n) => n && n.children && (n.children.includes('8') || n.children.includes(8)));
  assert.equal(forbiddenTotalSpan.length, 0, '黑板 Hub 抽屉严禁展示包含已撤销/过期的全量条目数 8');

  // 3. session.offline 在离线会话抽屉中的状态展示验证
  const offlineSessionDrawer = plugin.CanvasDrawer({
    entity: {
      kind: 'session',
      id: 's-offline-target',
      title: 'Agent Offline',
      isArchived: true,
      workspace: '/ws/1',
      status: 'idle'
    },
    onClose: () => {},
    t,
    copiedKey: null,
    setCopiedKey: () => {}
  });
  const offlineTexts = findVNodes(offlineSessionDrawer, (n) => n && n.children && n.children.includes('会话已离线'));
  assert.ok(offlineTexts.length > 0, '离线会话抽屉必须渲染「会话已离线」(session.offline)');

  // 4. L2 Tooltip 防御性断言：session.offline、call 离线端点警告、post tags 展示
  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => { registration = payload; }
    }
  };
  const sandbox = {
    window: mockWindow,
    console, Date, Set, Map, Array, Object, String, Math, JSON, URLSearchParams,
    setInterval, clearInterval, setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  function createHoverView(hoveredEntity, lang = 'zh') {
    let callIdx = 0;
    const mockReact = {
      useState: (initial) => {
        callIdx++;
        if (callIdx === 1) return [{
          timestamp: Date.now(),
          currentWorkspace: '/ws/1',
          workspaces: [{ id: '/ws/1', name: 'ws-1', isCurrent: true }],
          sessions: [],
          posts: [],
          calls: [],
          metrics: { totalSessions: 0, runningSessions: 0, activeCalls: 0, totalPosts: 0 }
        }, () => {}];
        if (callIdx === 2) return [null, () => {}];
        if (callIdx === 3) return [null, () => {}];
        if (callIdx === 4) return [hoveredEntity, () => {}];
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
    const p = registration.factory((name) => name === 'react' ? mockReact : null);
    const translator = lang === 'en' ? (k) => p.en[k] || k : (k) => p.zh[k] || k;
    return p.CanvasView({ sessionId: 's-test', t: translator });
  }

  // 4.1 悬停离线 Session 节点：Tooltip 展示警告文案与警告色 #f59e0b
  const sessionHoverView = createHoverView({
    kind: 'session',
    id: 's-hover-offline',
    entity: {
      id: 'session-hover-1',
      shortId: 'hover001',
      title: 'Offline Worker',
      isArchived: true,
      workspace: '/ws/1'
    },
    x: 200,
    y: 200
  });
  const sessionTooltip = findVNodes(sessionHoverView, (n) => n && n.props && n.props.className === 'dsh-canvas-tooltip')[0];
  assert.ok(sessionTooltip, '必须渲染悬停 Session Tooltip');
  const offlineStatusNode = findVNodes(sessionTooltip, (n) => n && n.props && n.props.style && n.props.style.color === '#f59e0b')[0];
  assert.ok(offlineStatusNode, 'Session Tooltip 离线状态必须使用警告色 #f59e0b');
  assert.equal(offlineStatusNode.children[0], '会话已离线', 'Session Tooltip 必须渲染「会话已离线」');

  // 4.2 悬停带有离线端点的 Call 连线：Tooltip 展示离线警告行
  const callHoverView = createHoverView({
    kind: 'call',
    id: 'c-hover-offline',
    entity: {
      id: 'call-1',
      callerSessionId: 'session-c1-12345678',
      targetSessionId: 'session-c2-87654321',
      callerOffline: true,
      targetOffline: false,
      callType: 'task_dispatch',
      deliveryMode: 'steer',
      durationMs: 120
    },
    x: 200,
    y: 200
  });
  const callTooltip = findVNodes(callHoverView, (n) => n && n.props && n.props.className === 'dsh-canvas-tooltip')[0];
  assert.ok(callTooltip, '必须渲染悬停 Call Tooltip');
  const callWarningRow = findVNodes(callTooltip, (n) => n && n.props && n.props.style && n.props.style.color === '#f59e0b')[0];
  assert.ok(callWarningRow, 'Call Tooltip 必须渲染离线警告行且使用警告色 #f59e0b');
  const callWarningOfflineLabel = findVNodes(callWarningRow, (n) => n && n.children && n.children.includes('会话已离线'));
  assert.ok(callWarningOfflineLabel.length > 0, 'Call Tooltip 离线端点警告必须消费 session.offline');

  // 4.3 悬停 Post 条目：Tooltip 展示完整 Tags 行 (PRD 7.2)
  const postHoverView = createHoverView({
    kind: 'post',
    id: 'p-hover-tags',
    entity: {
      id: 'post-1',
      topic: 'task:audit',
      authorSessionId: 'session-author-1234',
      status: 'active',
      tags: ['p0', 'security-review', 'ready-for-qa'],
      ttlRemainingMs: 3600000
    },
    x: 200,
    y: 200
  });
  const postTooltip = findVNodes(postHoverView, (n) => n && n.props && n.props.className === 'dsh-canvas-tooltip')[0];
  assert.ok(postTooltip, '必须渲染悬停 Post Tooltip');
  const postTagsLabel = findVNodes(postTooltip, (n) => n && n.children && n.children.includes('标签'));
  assert.ok(postTagsLabel.length > 0, 'Post Tooltip 必须渲染「标签」行 (drawer.tags)');
  const postTagsValue = findVNodes(postTooltip, (n) => n && n.children && n.children.includes('p0, security-review, ready-for-qa'));
  assert.ok(postTagsValue.length > 0, 'Post Tooltip 必须渲染完整 Tags 内容');

  // 5. 单工作区 Fit View 包围盒算法与居中计算验证 (PRD 8.2)
  // 单工作区 (宽 260)，顶部黑板栏 min-width 1080 (右边界 40 + 1080 = 1120)
  const singleWsLayout = plugin.computeLayout(
    [{ id: '/ws/single', name: 'single-ws', isCurrent: true }],
    [{ id: 's1', workspace: '/ws/single', title: 'Agent 1', status: 'idle' }],
    [],
    '/ws/single',
    false
  );
  assert.ok(singleWsLayout.blackboardBound, '必须存在 blackboardBound');
  assert.equal(singleWsLayout.blackboardBound.width, 1080, '顶部黑板栏最小宽度必须为 1080px');
  assert.equal(singleWsLayout.blackboardBound.x, 40, '顶部黑板栏起始 X 必须为 40px');
  const blackboardRight = singleWsLayout.blackboardBound.x + singleWsLayout.blackboardBound.width;
  assert.equal(blackboardRight, 1120, '顶部黑板栏右边界必须达到 1120px');

  // 验证无任何 340px 欺骗性截断逻辑残余
  assert.equal(code.includes('maxX = Math.max(maxX, 340)'), false, '严禁保留 340px 硬编码作弊截断分支');
  assert.equal(code.includes('maxX = Math.max(maxX, blackboardBound.x + blackboardBound.width)'), true, 'Fit View 必须基于真实的 blackboardBound.x + blackboardBound.width 计算 maxX');
  assert.equal(code.includes('x: blackboardBound.x + blackboardBound.width / 2'), true, '黑板空态占位文字必须基于黑板区域中心居中');
});

test('协作看板点击自适应居中、假零值防御、44px 工具栏校正与 ResizeObserver 响应式适配', () => {
  const plugin = loadClientBundle();
  const code = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');

  // 1. 静态源码特征与防假零值断言
  assert.equal(code.includes('var rawW = (viewport && viewport.clientWidth > 0)'), true, '必须通过真实测量保护避免假零值');
  assert.equal(code.includes('container.clientHeight - 44'), true, '必须显式扣除 44px 工具栏垂直高度计算视口居中');
  assert.equal(code.includes('ResizeObserver'), true, '必须接入 ResizeObserver 实现视口尺寸响应式感知');

  // 2. 初始状态自适应居中验证（避免 translate3d(0px, 0px, 0px) scale(1) 贴左截断）
  const t = (k) => k;
  const initialVNode = plugin.CanvasView({ sessionId: 'session-test', t });
  function findVNodes(node, predicate, acc = []) {
    if (!node) return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node.children)) {
      node.children.forEach((c) => findVNodes(c, predicate, acc));
    }
    return acc;
  }
  const svgSurface = findVNodes(initialVNode, (n) => n && n.props && n.props.className === 'dsh-canvas-surface')[0];
  assert.ok(svgSurface, '必须渲染 dsh-canvas-surface SVG 节点');
  const transform = svgSurface.props.style.transform;
  assert.equal(transform.includes('translate3d(0px, 0px, 0px) scale(1)'), false, '首屏严禁为硬编码未居中的 (0, 0) scale(1)');
  assert.ok(transform.includes('translate3d(') && transform.includes('scale('), '必须包含 translate3d 与 scale 变换样式');

  // 3. 运行时沙箱模拟：ResizeObserver 挂载、假零值恢复、Tab 激活与卸载断言
  let roObservedEl = null;
  let roDisconnectCalled = false;
  let roCallback = null;

  class MockResizeObserver {
    constructor(callback) {
      roCallback = callback;
    }
    observe(el) {
      roObservedEl = el;
    }
    disconnect() {
      roDisconnectCalled = true;
    }
  }

  let capturedPan = null;
  let capturedZoom = null;
  let registeredListeners = {};
  const mockCleanups = [];

  const mockReact = {
    useState: (initial) => {
      let state = initial;
      const setter = (next) => {
        if (typeof next === 'function') next = next(state);
        state = next;
        if (state && typeof state === 'object' && 'x' in state && 'y' in state) {
          capturedPan = state;
        } else if (typeof state === 'number') {
          capturedZoom = state;
        }
      };
      return [initial, setter];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') mockCleanups.push(cleanup);
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const runtimeWindow = {
    ResizeObserver: MockResizeObserver,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (event, handler) => { registeredListeners[event] = handler; },
    removeEventListener: (event, handler) => { if (registeredListeners[event] === handler) delete registeredListeners[event]; },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: () => {}
  };

  const runtimeDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
    querySelector: (sel) => (sel === '.dsh-canvas-container' ? containerMock : null)
  };

  let loadedReg = null;
  const runtimeLoader = {
    load: (payload) => { loadedReg = payload; }
  };

  const testSandbox = {
    window: runtimeWindow,
    document: runtimeDocument,
    ResizeObserver: MockResizeObserver,
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
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {}
  };
  runtimeWindow.__ModuleLoader__ = runtimeLoader;

  vm.createContext(testSandbox);
  vm.runInContext(code, testSandbox);
  const runtimePlugin = loadedReg.factory((name) => name === 'react' ? mockReact : null);

  const containerMock = {
    clientWidth: 0,
    clientHeight: 0,
    querySelector: (sel) => (sel === '.dsh-canvas-viewport' ? viewportMock : null)
  };
  const viewportMock = {
    clientWidth: 0,
    clientHeight: 0
  };

  const activeView = runtimePlugin.CanvasView({
    sessionId: 's-ro-test',
    t,
    fetchTelemetry: async () => ({
      sessions: [{ id: 's1', workspace: '/ws/1', title: 'Agent 1', status: 'running' }],
      calls: [],
      posts: [],
      workspaces: [{ id: '/ws/1', name: 'ws-1', isCurrent: true }]
    })
  });

  assert.ok(roCallback, '必须通过 ResizeObserver 注册监听回调');

  // 模拟 Tab 切换恢复：从宽度 0 变为 1200x700
  containerMock.clientWidth = 1200;
  containerMock.clientHeight = 744; // 含 44px 工具栏
  viewportMock.clientWidth = 1200;
  viewportMock.clientHeight = 700; // 视口净高 700px

  roCallback([{
    target: containerMock,
    contentRect: { width: 1200, height: 744 }
  }]);

  // 断言卸载正常清理
  mockCleanups.forEach((c) => c());
  assert.equal(roDisconnectCalled, true, '组件卸载时必须断开 ResizeObserver 监听');
});

test('协作看板黑板标题口径与卡片视觉状态强化（PRD §6.4 与 §11 缺陷2）', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => { registration = payload; }
    }
  };

  const sandbox = {
    window: mockWindow,
    console, Date, Set, Map, Array, Object, String, Math, JSON, URLSearchParams,
    setInterval, clearInterval, setTimeout, clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(registration);

  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  // 1. 测试场景：存在非 active 条目（0 活跃 / 3 总计：2 撤销 + 1 过期，重现用户截图同屏矛盾）
  const telemetryWithMixedPosts = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/1',
    workspaces: [{ id: '/ws/1', name: 'ws-1', isCurrent: true, sessionIds: ['session-s1'] }],
    sessions: [{ id: 'session-s1', title: 'Agent 1', workspace: '/ws/1', state: 'idle' }],
    posts: [
      { id: 'post-1', topic: 'topic-archived-1', status: 'archived', authorSessionId: 'session-s1', ttlRemainingMs: 0 },
      { id: 'post-2', topic: 'topic-archived-2', status: 'archived', authorSessionId: 'session-s1', ttlRemainingMs: 0 },
      { id: 'post-3', topic: 'topic-expired-1', status: 'expired', authorSessionId: 'session-s1', ttlRemainingMs: 0 }
    ],
    calls: []
  };

  const react1 = createMockReact(telemetryWithMixedPosts);
  const pluginZh = registration.factory((name) => name === 'react' ? react1 : null);
  const tZh = (k) => pluginZh.zh[k] || k;
  const viewZh = pluginZh.CanvasView({ sessionId: 'session-s1', t: tZh, locale: 'zh' });

  // 1.1 标题口径显式化断言（中文环境）：必须清晰显示 '(0 活跃 / 3 总计)'，避免 (0) 与 3 张卡片的同屏矛盾
  const titleGroup = findNodeById(viewZh, 'dsh-canvas-blackboard-title-group');
  assert.ok(titleGroup, '顶部黑板栏标题分组必须存在');
  const titleTexts = titleGroup.children.filter(c => c && c.type === 'text');
  assert.equal(titleTexts.length, 2, '黑板栏标题必须包含标签与计数字符节点');
  assert.equal(titleTexts[0].children[0], '公共黑板');
  assert.equal(titleTexts[1].children[0], '(0 活跃 / 3 总计)', '当存在非 active 条目时，标题必须标注口径 (0 活跃 / 3 总计)');

  // 1.2 标题口径显式化断言（英文环境）：'Blackboard (0 active / 3 total)'
  const pluginEn = registration.factory((name) => name === 'react' ? react1 : null);
  const tEn = (k) => pluginEn.en[k] || k;
  const viewEn = pluginEn.CanvasView({ sessionId: 'session-s1', t: tEn, locale: 'en' });
  const titleGroupEn = findNodeById(viewEn, 'dsh-canvas-blackboard-title-group');
  const titleTextsEn = titleGroupEn.children.filter(c => c && c.type === 'text');
  assert.equal(titleTextsEn[0].children[0], 'Blackboard');
  assert.equal(titleTextsEn[1].children[0], '(0 active / 3 total)', '英文环境下标注口径必须为 (0 active / 3 total)');

  // 1.3 非 active 卡片视觉状态强化断言：低饱和度、虚线边框、顶部明确灰底状态标签
  const bbLayer = findNodeById(viewZh, 'dsh-canvas-blackboard-layer');
  assert.ok(bbLayer, '黑板图层必须渲染');

  // 查找 post-1 卡片（archived 已撤销）
  const cardArchived = findNodeById(bbLayer, 'post-1');
  assert.ok(cardArchived, 'post-1 卡片必须渲染');
  const rectArchived = cardArchived.children.find(c => c && c.type === 'rect');
  assert.equal(rectArchived.props.strokeDasharray, '2 3', '已撤销卡片边框必须为虚线 2 3');
  assert.equal(rectArchived.props.fill, 'rgba(15, 23, 42, 0.35)', '已撤销卡片背景必须为低饱和暗色填充');

  // 断言卡片顶部灰底状态标签 [已撤销]
  const badgeArchived = cardArchived.children.find(c => c && c.props && c.props.className === 'dsh-canvas-post-badge');
  assert.ok(badgeArchived, '已撤销卡片顶部必须包含灰底状态标签徽章');
  const badgeRectArch = badgeArchived.children.find(c => c && c.type === 'rect');
  assert.equal(badgeRectArch.props.fill, '#334155', '状态标签背景必须为深冷灰 (#334155)');
  const badgeTextArch = badgeArchived.children.find(c => c && c.type === 'text');
  assert.equal(badgeTextArch.children[0], '[已撤销]', '已撤销卡片顶部标签文本必须为 [已撤销]');

  // 查找 post-3 卡片（expired 已过期）
  const cardExpired = findNodeById(bbLayer, 'post-3');
  assert.ok(cardExpired, 'post-3 卡片必须渲染');
  const rectExpired = cardExpired.children.find(c => c && c.type === 'rect');
  assert.equal(rectExpired.props.strokeDasharray, '1 3', '已过期卡片边框必须为点虚线 1 3');
  const badgeExpired = cardExpired.children.find(c => c && c.props && c.props.className === 'dsh-canvas-post-badge');
  assert.ok(badgeExpired, '已过期卡片顶部必须包含灰底状态标签徽章');
  const badgeTextExp = badgeExpired.children.find(c => c && c.type === 'text');
  assert.equal(badgeTextExp.children[0], '[已过期]', '已过期卡片顶部标签文本必须为 [已过期]');

  // 2. 测试场景：全部为 active 条目（2 活跃 / 2 总计）
  const telemetryAllActive = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/1',
    workspaces: [{ id: '/ws/1', name: 'ws-1', isCurrent: true, sessionIds: ['session-s1'] }],
    sessions: [{ id: 'session-s1', title: 'Agent 1', workspace: '/ws/1', state: 'idle' }],
    posts: [
      { id: 'post-act-1', topic: 'topic-active-1', status: 'active', authorSessionId: 'session-s1', ttlRemainingMs: 3600000 },
      { id: 'post-act-2', topic: 'topic-active-2', status: 'active', authorSessionId: 'session-s1', ttlRemainingMs: 7200000 }
    ],
    calls: []
  };

  const react2 = createMockReact(telemetryAllActive);
  const pluginActive = registration.factory((name) => name === 'react' ? react2 : null);
  const viewActive = pluginActive.CanvasView({ sessionId: 'session-s1', t: tZh, locale: 'zh' });

  // 2.1 全为活跃时，标题仅展示 '(2)'，不显示冗余总计
  const titleGroupActive = findNodeById(viewActive, 'dsh-canvas-blackboard-title-group');
  const activeTitleTexts = titleGroupActive.children.filter(c => c && c.type === 'text');
  assert.equal(activeTitleTexts[1].children[0], '(2)', '全为活跃条目时标题必须显示 (2)');

  // 2.2 活跃卡片无顶部非活跃状态标签，展示高亮话题色与 TTL 剩余时间
  const bbLayerActive = findNodeById(viewActive, 'dsh-canvas-blackboard-layer');
  const cardActive = findNodeById(bbLayerActive, 'post-act-1');
  const badgeActive = cardActive.children.find(c => c && c.props && c.props.className === 'dsh-canvas-post-badge');
  assert.equal(badgeActive, undefined, '活跃卡片严禁渲染非活跃灰底状态标签');
  const topicTextActive = cardActive.children.find(c => c && c.type === 'text' && c.children && c.children.includes('topic-active-1'));
  assert.equal(topicTextActive.props.fill, '#e2e8f0', '活跃卡片话题文字采用高亮 #e2e8f0');

  // 3. 测试场景：空黑板（0 条目）
  const telemetryEmpty = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/1',
    workspaces: [{ id: '/ws/1', name: 'ws-1', isCurrent: true, sessionIds: ['session-s1'] }],
    sessions: [{ id: 'session-s1', title: 'Agent 1', workspace: '/ws/1', state: 'idle' }],
    posts: [],
    calls: []
  };
  const react3 = createMockReact(telemetryEmpty);
  const pluginEmpty = registration.factory((name) => name === 'react' ? react3 : null);
  const viewEmpty = pluginEmpty.CanvasView({ sessionId: 'session-s1', t: tZh, locale: 'zh' });
  const titleGroupEmpty = findNodeById(viewEmpty, 'dsh-canvas-blackboard-title-group');
  const emptyTitleTexts = titleGroupEmpty.children.filter(c => c && c.type === 'text');
  assert.equal(emptyTitleTexts[1].children[0], '(0)', '空黑板时标题必须显示 (0)');
});

test('ADR-0013 看板默认全局透视、首列固定当前工作区、移除跨区开关与当前会话发光锚点', () => {
  const plugin = loadClientBundle();
  const { isMatchingSession } = plugin;

  // 1. isMatchingSession 匹配逻辑单元断言
  assert.equal(typeof isMatchingSession, 'function', 'isMatchingSession 必须作为函数导出');
  assert.equal(isMatchingSession('s1', 's1'), true, '精确全等必须匹配');
  assert.equal(isMatchingSession('Session-Abcd', 'session-ABCD'), true, '大小写差异必须归一化匹配');
  assert.equal(isMatchingSession('session-12345678', '12345678'), true, '剥离 session- 前缀后必须匹配');
  assert.equal(isMatchingSession('session-7b3391ba-df1b-4b9d', '7b3391ba'), true, '8 位 shortId 必须匹配');
  assert.equal(isMatchingSession('s1', 's2'), false, '不同会话 ID 严禁误匹配');
  assert.equal(isMatchingSession('s1', ''), false, '目标 ID 为空时必须返回 false');
  assert.equal(isMatchingSession('', 's1'), false, '源 ID 为空时必须返回 false');
  assert.equal(isMatchingSession(null, 's1'), false, '源 ID 为 null 时安全返回 false');

  // 2. 模拟双工作区遥测数据（/ws/main 当前工作区，/ws/peer 外部隔离工作区）
  const telemetryMultiWs = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/main',
    workspaces: [
      { id: '/ws/main', name: 'main-repo', isCurrent: true, sessionIds: ['session-cur', 'session-other'] },
      { id: '/ws/peer', name: 'peer-repo', isCurrent: false, sessionIds: ['session-peer'] }
    ],
    sessions: [
      { id: 'session-cur', title: 'Cur Agent', workspace: '/ws/main', state: 'running' },
      { id: 'session-other', title: 'Other Agent', workspace: '/ws/main', state: 'idle' },
      { id: 'session-peer', title: 'Peer Agent', workspace: '/ws/peer', state: 'running' }
    ],
    posts: [],
    calls: []
  };

  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  function findVNodes(node, predicate, acc = []) {
    if (!node || typeof node !== 'object') return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) findVNodes(child, predicate, acc);
    }
    return acc;
  }

  const reactZh = createMockReact(telemetryMultiWs);
  const pluginZh = loadClientBundle((name) => name === 'react' ? reactZh : null);
  const tZh = (k) => pluginZh.zh[k] || k;

  // 2.1 默认全局透视断言（ADR-0013：无参数时直接渲染全部工作区列，且当前工作区自动排在最左侧首列）
  const defaultGlobalView = pluginZh.CanvasView({
    sessionId: 'session-cur',
    t: tZh,
    locale: 'zh'
  });

  const swimlanesLayer = findNodeById(defaultGlobalView, 'dsh-canvas-swimlanes');
  assert.ok(swimlanesLayer, 'dsh-canvas-swimlanes 必须存在');
  assert.equal(swimlanesLayer.children.length, 2, '默认全局模式下渲染全部工作区列');
  assert.equal(swimlanesLayer.children[0].props.key, '/ws/main', '首列工作区必须自动重排固定为当前工作区 /ws/main');

  const nodesLayer = findNodeById(defaultGlobalView, 'dsh-canvas-nodes');
  assert.ok(nodesLayer, 'dsh-canvas-nodes 必须存在');
  const renderedNodeIds = nodesLayer.children.map(n => n.props.key);
  assert.ok(renderedNodeIds.includes('session-cur'), '当前工程会话 session-cur 必须渲染');
  assert.ok(renderedNodeIds.includes('session-other'), '当前工程会话 session-other 必须渲染');
  assert.ok(renderedNodeIds.includes('session-peer'), '外部工作区 session-peer 默认全局呈现');

  // 工具栏移除跨工作区开关断言
  const toolbarButtons = findVNodes(defaultGlobalView, (n) => n && n.type === 'button' && n.props && n.props.className && n.props.className.includes('dsh-canvas-btn'));
  const crossWsBtn = toolbarButtons.find(b => b.children && b.children.includes('跨工作区拓扑'));
  assert.equal(crossWsBtn, undefined, '顶部工具栏移除「跨工作区拓扑」按钮');

  const locateBtn = toolbarButtons.find(b => b.children && b.children.includes('定位当前会话'));
  assert.ok(locateBtn, '当传入 sessionId 时顶部工具栏必须提供「定位当前会话」按钮');

  // 2.2 验证 computeLayout 对当前工作区首列固定与 isCurrent 补齐
  const { computeLayout } = pluginZh;
  const unpinnedWorkspaces = [
    { id: '/ws/other', name: 'other', isCurrent: false },
    { id: '/ws/target', name: 'target', isCurrent: true }
  ];
  const layoutPinned = computeLayout(unpinnedWorkspaces, [], [], '/ws/target');
  assert.equal(layoutPinned.workspaceBounds[0].id, '/ws/target', '目标工作区必须重排至首位');
  assert.equal(layoutPinned.workspaceBounds[0].isCurrent, true, '重排后的首位工作区必须拥有 isCurrent: true');

  // 当工作区原本在首位但缺少 isCurrent 时，必须安全补齐 isCurrent: true
  const firstWithoutIsCurrent = [
    { id: '/ws/target', name: 'target' },
    { id: '/ws/other', name: 'other' }
  ];
  const layoutFirstPinned = computeLayout(firstWithoutIsCurrent, [], [], '/ws/target');
  assert.equal(layoutFirstPinned.workspaceBounds[0].id, '/ws/target');
  assert.equal(layoutFirstPinned.workspaceBounds[0].isCurrent, true, '首位工作区必须被补齐 isCurrent: true');

  // 当外部未传递 currentWorkspace 但工作区列表中存在 isCurrent: true 时，仍能可靠置首
  const implicitCurrentWorkspaces = [
    { id: '/ws/first', name: 'first', isCurrent: false },
    { id: '/ws/second', name: 'second', isCurrent: true }
  ];
  const layoutImplicitPinned = computeLayout(implicitCurrentWorkspaces, [], [], '');
  assert.equal(layoutImplicitPinned.workspaceBounds[0].id, '/ws/second', '未显式传参时根据内部 isCurrent 依然可靠重排至首位');
  assert.equal(layoutImplicitPinned.workspaceBounds[0].isCurrent, true);

  // 当 currentWorkspace 不在已有工作区列表中时，自动补齐并置首
  const missingCurrentWorkspaces = [
    { id: '/ws/first', name: 'first', isCurrent: false },
    { id: '/ws/second', name: 'second', isCurrent: false }
  ];
  const layoutMissingPinned = computeLayout(missingCurrentWorkspaces, [], [], '/ws/missing-target');
  assert.equal(layoutMissingPinned.workspaceBounds[0].id, '/ws/missing-target', '缺失当前工作区时自动补齐并置于首位');
  assert.equal(layoutMissingPinned.workspaceBounds[0].isCurrent, true);
  assert.equal(layoutMissingPinned.workspaceBounds.length, 3, '总工作区列数正确增补为 3 列');

  // 当显式 currentWorkspace 存在时，路径匹配优先于列表中其他陈旧的 isCurrent 标识
  const staleIsCurrentWorkspaces = [
    { id: '/ws/stale', name: 'stale', isCurrent: true },
    { id: '/ws/explicit-target', name: 'explicit', isCurrent: false }
  ];
  const layoutPriorityPinned = computeLayout(staleIsCurrentWorkspaces, [], [], '/ws/explicit-target');
  assert.equal(layoutPriorityPinned.workspaceBounds[0].id, '/ws/explicit-target', '显式传入路径必须优先于已有陈旧 isCurrent 标记并置首');
  assert.equal(layoutPriorityPinned.workspaceBounds[0].isCurrent, true);

  // 校验当前工作区排他性：即使输入列表中多个工作区标记了 isCurrent: true，也仅有首列为 true，其余强制重置为 false
  const multiCurrentWorkspaces = [
    { id: '/ws/first', name: 'first', isCurrent: true },
    { id: '/ws/second', name: 'second', isCurrent: true },
    { id: '/ws/third', name: 'third', isCurrent: true }
  ];
  const layoutExclusivePinned = computeLayout(multiCurrentWorkspaces, [], [], '/ws/second');
  assert.equal(layoutExclusivePinned.workspaceBounds[0].id, '/ws/second', '目标工作区成功置首');
  assert.equal(layoutExclusivePinned.workspaceBounds[0].isCurrent, true, '首列必须为当前工作区');
  assert.equal(layoutExclusivePinned.workspaceBounds[1].isCurrent, false, '第二列必须重置为 false');
  assert.equal(layoutExclusivePinned.workspaceBounds[2].isCurrent, false, '第三列必须重置为 false');

  // 当显式 currentWorkspace 在列表中缺失，但列表中存在陈旧 isCurrent: true 时，绝不被陈旧标记截胡，依然自动补齐真实目标并置首
  const missingWithStaleIsCurrent = [
    { id: '/ws/stale-hijack', name: 'stale-hijack', isCurrent: true },
    { id: '/ws/other', name: 'other', isCurrent: false }
  ];
  const layoutAntiHijack = computeLayout(missingWithStaleIsCurrent, [], [], '/ws/real-missing');
  assert.equal(layoutAntiHijack.workspaceBounds[0].id, '/ws/real-missing', '真实缺失的工作区必须成功补齐并置首');
  assert.equal(layoutAntiHijack.workspaceBounds[0].isCurrent, true, '真实缺失的工作区为当前工作区');
  assert.equal(layoutAntiHijack.workspaceBounds[1].isCurrent, false, '陈旧工作区 isCurrent 必须被强制重置为 false');
  assert.equal(layoutAntiHijack.workspaceBounds.length, 3, '总工作区列数正确增补为 3 列');

  // 3. 当前会话高亮发光锚点与 [当前] 状态标签断言
  const curNodeGroup = findNodeById(nodesLayer, 'dsh-canvas-node-session-cur');
  assert.ok(curNodeGroup, '当前会话节点必须带有专属元素 ID');
  assert.ok(curNodeGroup.props.className.includes('dsh-canvas-node-current'), '当前会话节点外层必须带有 dsh-canvas-node-current 类名');

  const curEllipse = curNodeGroup.children.find(c => c && c.type === 'ellipse');
  assert.ok(curEllipse, '当前会话椭圆节点必须存在');
  assert.equal(curEllipse.props.stroke, '#38bdf8', '当前会话椭圆边框采用专属高亮青色 (#38bdf8)');
  assert.equal(curEllipse.props.strokeWidth, '2.4', '当前会话椭圆边框加粗至 2.4px');
  assert.equal(curEllipse.props.strokeDasharray, 'none', '当前会话椭圆边框为实线');
  assert.equal(curEllipse.props.style.filter, 'drop-shadow(0 0 8px #38bdf8)', '当前会话椭圆外围必须渲染 drop-shadow(0 0 8px #38bdf8) 发光光晕');

  // 状态标签断言（中文环境）
  const curBadge = curNodeGroup.children.find(c => c && c.props && c.props.className === 'dsh-canvas-session-current-badge');
  assert.ok(curBadge, '当前会话标题旁必须渲染状态标签分组');
  const curBadgeText = curBadge.children.find(c => c && c.type === 'text');
  assert.equal(curBadgeText.children[0], '[当前]', '中文环境下状态标签必须渲染 [当前]');

  // 对比非当前会话 session-other
  const otherNodeGroup = findNodeById(nodesLayer, 'dsh-canvas-node-session-other');
  assert.ok(otherNodeGroup, '非当前会话节点存在');
  assert.equal(otherNodeGroup.props.className.includes('dsh-canvas-node-current'), false, '非当前会话严禁携带 dsh-canvas-node-current');
  const otherEllipse = otherNodeGroup.children.find(c => c && c.type === 'ellipse');
  assert.notEqual(otherEllipse.props.style.filter, 'drop-shadow(0 0 8px #38bdf8)', '非当前会话严禁具备当前会话专属光晕');
  const otherBadge = otherNodeGroup.children.find(c => c && c.props && c.props.className === 'dsh-canvas-session-current-badge');
  assert.equal(otherBadge, undefined, '非当前会话严禁渲染 [当前] 状态标签');

  // 4. 英文环境下状态标签断言
  const reactEn = createMockReact(telemetryMultiWs);
  const pluginEn = loadClientBundle((name) => name === 'react' ? reactEn : null);
  const tEn = (k) => pluginEn.en[k] || k;
  const viewEn = pluginEn.CanvasView({
    sessionId: 'session-cur',
    t: tEn,
    locale: 'en'
  });
  const nodesLayerEn = findNodeById(viewEn, 'dsh-canvas-nodes');
  const curNodeGroupEn = findNodeById(nodesLayerEn, 'dsh-canvas-node-session-cur');
  const curBadgeEn = curNodeGroupEn.children.find(c => c && c.props && c.props.className === 'dsh-canvas-session-current-badge');
  assert.ok(curBadgeEn, '英文环境下当前会话状态标签分组必须存在');
  const curBadgeTextEn = curBadgeEn.children.find(c => c && c.type === 'text');
  assert.equal(curBadgeTextEn.children[0], '[Current]', '英文环境下状态标签必须渲染 [Current]');

  // 5. 无 sessionId 传入时：不渲染定位按钮，所有节点均无发光光晕与 [当前] 标签
  const noSessionView = pluginZh.CanvasView({ t: tZh });
  const noSessionButtons = findVNodes(noSessionView, (n) => n && n.type === 'button' && n.props && n.props.className && n.props.className.includes('dsh-canvas-btn'));
  const noLocateBtn = noSessionButtons.find(b => b.children && b.children.includes('定位当前会话'));
  assert.equal(noLocateBtn, undefined, '无 sessionId 传入时严禁渲染定位当前会话按钮');

  // 6. 当服务端 telemetry 未返回 currentWorkspace 时，CanvasView 自动基于当前 sessionId 反查所属工作区并置首
  const missingWsTelemetry = {
    timestamp: Date.now(),
    currentWorkspace: '',
    workspaces: [
      { id: '/ws/other', name: 'other', isCurrent: false, sessionIds: ['session-other'] },
      { id: '/ws/inferred', name: 'inferred', isCurrent: false, sessionIds: ['session-inferred'] }
    ],
    sessions: [
      { id: 'session-other', workspace: '/ws/other', state: 'running', title: 'Other' },
      { id: 'session-inferred', workspace: '/ws/inferred', state: 'running', title: 'Inferred' }
    ],
    posts: [],
    calls: []
  };
  const reactInferred = createMockReact(missingWsTelemetry);
  const pluginInferred = loadClientBundle((name) => name === 'react' ? reactInferred : null);
  const viewInferred = pluginInferred.CanvasView({
    sessionId: 'session-inferred',
    t: tZh
  });
  const swimlanesInferred = findNodeById(viewInferred, 'dsh-canvas-swimlanes');
  assert.ok(swimlanesInferred, 'dsh-canvas-swimlanes 必须存在');
  assert.equal(swimlanesInferred.children[0].props.key, '/ws/inferred', '基于当前 sessionId 反查的工作区必须成功置首');
});

test('Topology Relationship Edges Contrast & WCAG 2.1 Compliance (PRD §3.1, §4.1 & Task t10)', () => {
  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  const telemetryWithEdges = {
    workspaces: [
      { id: '/path/to/main', name: 'main', isCurrent: true, sessionIds: ['session-auth', 'session-call-src', 'session-call-dst'] }
    ],
    sessions: [
      { id: 'session-auth', title: 'Author Node', state: 'idle', status: 'idle', workspace: '/path/to/main' },
      { id: 'session-call-src', title: 'Caller Node', state: 'running', status: 'running', workspace: '/path/to/main' },
      { id: 'session-call-dst', title: 'Target Node', state: 'idle', status: 'idle', workspace: '/path/to/main' }
    ],
    posts: [
      { id: 'post-1', topic: 'task:design', status: 'active', authorSessionId: 'session-auth', ttlRemainingMs: 3600000 }
    ],
    calls: [
      {
        id: 'call-1',
        callerSessionId: 'session-call-src',
        targetSessionId: 'session-call-dst',
        callType: 'task_dispatch',
        deliveryMode: 'steer',
        durationMs: 120,
        timestamp: Date.now(),
        contextPostIds: ['post-1'],
        status: 'active'
      }
    ]
  };

  const reactMock = createMockReact(telemetryWithEdges);
  const plugin = loadClientBundle((name) => name === 'react' ? reactMock : null);
  const t = (k) => plugin.zh[k] || k;
  const view = plugin.CanvasView({ t: t });

  // 1. 发布归属边 (Author Edge) 默认态与规格断言
  const authorEdgesGroup = findNodeById(view, 'dsh-canvas-author-edges');
  assert.ok(authorEdgesGroup, 'dsh-canvas-author-edges 图层必须存在');
  const validAuthorPaths = authorEdgesGroup.children.filter(Boolean);
  assert.equal(validAuthorPaths.length, 1, '必须生成 1 条发布归属边');
  const authorEdge = validAuthorPaths[0];

  assert.equal(authorEdge.props.stroke, '#64748b', '归属边默认描边色为 #64748b');
  assert.equal(authorEdge.props.strokeWidth, '1.2', '归属边默认线宽必须提升至 1.2px');
  assert.equal(authorEdge.props.strokeDasharray, '4 3', '归属边默认虚线样式必须设置为 4 3');
  assert.equal(authorEdge.props.strokeOpacity, 0.5, '归属边默认透明度必须提升至 0.50');

  // 2. 上下文引用边 (Context Edge) 默认态与规格断言
  const contextEdgesGroup = findNodeById(view, 'dsh-canvas-context-edges');
  assert.ok(contextEdgesGroup, 'dsh-canvas-context-edges 图层必须存在');
  const validContextPaths = contextEdgesGroup.children.filter(Boolean).flat().filter(Boolean);
  assert.equal(validContextPaths.length, 1, '必须生成 1 条上下文引用边');
  const contextEdge = validContextPaths[0];

  assert.equal(contextEdge.props.stroke, '#fbbf24', '上下文引用边必须采用高辨识度琥珀色 #fbbf24');
  assert.equal(contextEdge.props.strokeWidth, '1.0', '上下文引用边默认线宽必须调整为 1.0px');
  assert.equal(contextEdge.props.strokeDasharray, '3 3', '上下文引用边虚线样式必须设置为 3 3');
  assert.equal(contextEdge.props.strokeOpacity, 0.45, '上下文引用边默认透明度必须提升至 0.45');

  // 3. WCAG 2.1 对比度量化数学校验 (对齐 #0b0f19 与 #090d16 背景)
  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function getLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }
  function calcContrast(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const bgDark = [11, 15, 25]; // #0b0f19
  const bgBlack = [9, 13, 22]; // #090d16
  const amber = [251, 191, 36]; // #fbbf24 (琥珀色)

  // 琥珀色引用边在 0.45 透明度混合下的实际像素对比度
  [bgDark, bgBlack].forEach((bg) => {
    const blendedContext = [
      Math.round(amber[0] * 0.45 + bg[0] * 0.55),
      Math.round(amber[1] * 0.45 + bg[1] * 0.55),
      Math.round(amber[2] * 0.45 + bg[2] * 0.55)
    ];
    const bgLum = getLuminance(...bg);
    const edgeLum = getLuminance(...blendedContext);
    const ratio = calcContrast(edgeLum, bgLum);
    assert.ok(ratio >= 3.0, `上下文引用边在深色背景下的对比度 (${ratio.toFixed(2)}:1) 必须达到 WCAG 2.1 >= 3:1 标准`);
  });

  // 纯色描边色对比度：琥珀色对背景对比度 > 10:1，归属边 #64748b 对背景对比度 > 4:1
  [bgDark, bgBlack].forEach((bg) => {
    const bgLum = getLuminance(...bg);
    const amberLum = getLuminance(...amber);
    const slateLum = getLuminance(100, 116, 139); // #64748b
    assert.ok(calcContrast(amberLum, bgLum) >= 3.0, '琥珀色描边对比度达标');
    assert.ok(calcContrast(slateLum, bgLum) >= 3.0, '灰色归属边描边对比度达标');
  });
});

test('Session Node Title Dynamic Space & Word-Boundary Truncation (PRD §5.1 & Task t11)', () => {
  const plugin = loadClientBundle();
  const { truncateTextByWidth } = plugin;
  assert.equal(typeof truncateTextByWidth, 'function', 'truncateTextByWidth 必须由客户端插件导出');

  // 1. 英文单词边界感知（Word-Boundary Awareness）断言
  // 场景 1.1：超长带空格英文文本，截断点切入单词内部时优先回退至前一个单词边界空格处
  // 'Agent Workspace Isolation Plan', maxWidth=105, limitW=89.
  // 'Agent ' (43.2) + 'Worksp' (43.2) -> 86.4 <= 89. 'Workspace' 单词未完，回退至空格处
  assert.equal(
    truncateTextByWidth('Agent Workspace Isolation Plan', 105),
    'Agent...',
    '105px 阈值下英文单词腰斩时必须回退到单词边界'
  );

  // 场景 1.2：放宽至 140px（无徽章留白空间），可完整容纳前两个英文单词
  // 'Agent Workspace ' (43.2 + 72.0 = 115.2 <= 124) -> 'Agent Workspace...'
  assert.equal(
    truncateTextByWidth('Agent Workspace Isolation Plan', 140),
    'Agent Workspace...',
    '140px 留白空间下可完整容纳两个单词且在边界截断'
  );

  // 场景 1.3：更多英文语句单词边界验证
  assert.equal(
    truncateTextByWidth('Quick brown fox jumps over lazy dog', 105),
    'Quick brown...',
    '避免将 fox 腰斩为 f'
  );
  assert.equal(
    truncateTextByWidth('Quick brown fox jumps over lazy dog', 140),
    'Quick brown fox...',
    '放宽留白空间后可完整呈现至 fox 单词边界'
  );

  // 场景 1.4：无空格单长词按字符截断
  assert.equal(
    truncateTextByWidth('SingleLongUnbrokenWordThatExceedsLimit', 105),
    'SingleLongUn...',
    '无空格单长词按字符级截断'
  );

  // 场景 1.5：末尾空白字符自动修剪
  assert.equal(
    truncateTextByWidth('Trailing spaces text   ', 105),
    'Trailing...',
    '截断追加省略号前必须修剪末尾空白字符'
  );

  // 2. 中文与中英混排动态留白空间截断断言
  // 场景 2.1：纯长中文在不同动态阈值下的容纳能力对比
  // 64px（当前会话展示 [当前] 标签）：limitW = 48 -> 3 个中文字符 (3 * 12.5 = 37.5 <= 48)
  assert.equal(
    truncateTextByWidth('深度思考智能体全流程协同', 64),
    '深度思...',
    '当前会话 64px 空间容纳 3 个汉字'
  );
  // 105px（存在调用计数徽章）：limitW = 89 -> 7 个中文字符 (7 * 12.5 = 87.5 <= 89)
  assert.equal(
    truncateTextByWidth('深度思考智能体全流程协同', 105),
    '深度思考智能体...',
    '带调用徽章会话 105px 空间容纳 7 个汉字'
  );
  // 140px（无徽章普通会话，充分利用右侧留白）：limitW = 124 -> 9 个中文字符 (9 * 12.5 = 112.5 <= 124)
  assert.equal(
    truncateTextByWidth('深度思考智能体全流程协同', 140),
    '深度思考智能体全流...',
    '无徽章普通会话 140px 空间容纳 9 个汉字（比 105px 多容纳 2 个汉字）'
  );

  // 场景 2.2：中文带空格文本不误删中文字符
  assert.equal(
    truncateTextByWidth('中文 包含 空格 的 文本 测试', 105),
    '中文 包含 空...',
    '中文空格不影响后续中文字符正常保留截断'
  );

  // 3. CanvasView 会话节点 VNode 渲染动态留白与单词边界集成断言
  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  function findVNodes(node, predicate, acc = []) {
    if (!node || typeof node !== 'object') return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        findVNodes(child, predicate, acc);
      }
    }
    return acc;
  }

  const telemetryData = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/main',
    workspaces: [{ id: '/ws/main', name: 'main-ws', isCurrent: true, sessionIds: ['s-cur', 's-call', 's-plain'] }],
    sessions: [
      {
        id: 's-cur',
        title: 'Agent Workspace Isolation Plan',
        workspace: '/ws/main',
        state: 'running'
      },
      {
        id: 's-call',
        title: 'Agent Workspace Isolation Plan',
        workspace: '/ws/main',
        state: 'idle',
        stats: { outboundCalls: 3, inboundCalls: 1 }
      },
      {
        id: 's-plain',
        title: 'Agent Workspace Isolation Plan',
        workspace: '/ws/main',
        state: 'idle',
        stats: { outboundCalls: 0, inboundCalls: 0 }
      }
    ],
    posts: [],
    calls: []
  };

  const reactMock = createMockReact(telemetryData);
  const clientPlugin = loadClientBundle((name) => name === 'react' ? reactMock : null);
  const view = clientPlugin.CanvasView({
    sessionId: 's-cur',
    locale: 'zh',
    t: (k) => clientPlugin.zh[k] || k
  });

  const nodesLayer = findNodeById(view, 'dsh-canvas-nodes');
  assert.ok(nodesLayer, 'dsh-canvas-nodes 容器必须存在');

  // 当前会话 s-cur：具备 [当前] 状态徽章，titleMaxWidth = 64px -> 'Agent...'
  const curGroup = findNodeById(nodesLayer, 'dsh-canvas-node-s-cur');
  const curTitle = findVNodes(curGroup, n => n.props && n.props.className === 'dsh-canvas-session-title')[0];
  assert.equal(curTitle.children[0], 'Agent...', '当前会话节点分配 64px 空间截断标题');

  // 具备调用徽章会话 s-call：具备右侧数字徽章，titleMaxWidth = 105px -> 'Agent...'
  const callGroup = findNodeById(nodesLayer, 'dsh-canvas-node-s-call');
  const callTitle = findVNodes(callGroup, n => n.props && n.props.className === 'dsh-canvas-session-title')[0];
  assert.equal(callTitle.children[0], 'Agent...', '带调用计数徽章节点分配 105px 空间截断标题');

  // 普通会话 s-plain：无任何右侧徽章，充分利用留白，titleMaxWidth = 140px -> 'Agent Workspace...'
  const plainGroup = findNodeById(nodesLayer, 'dsh-canvas-node-s-plain');
  const plainTitle = findVNodes(plainGroup, n => n.props && n.props.className === 'dsh-canvas-session-title')[0];
  assert.equal(plainTitle.children[0], 'Agent Workspace...', '无徽章普通会话放宽至 140px 留白空间，完整呈现两个英文单词');
});

test('黑板区域在无条目时的平滑压缩与空状态过渡 (PRD §3.1 & Task t12)', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  const tZh = (k) => plugin.zh[k] || k;
  const tEn = (k) => plugin.en[k] || k;

  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  // 1. 无条目场景 (posts.length === 0)：黑板区域平滑收缩为 38px 轻量状态条
  const emptyLayout = computeLayout(
    [{ id: '/ws/1', name: 'proj-1', isCurrent: true }],
    [{ id: 's1', workspace: '/ws/1', title: 'Worker 1', state: 'idle' }],
    [],
    '/ws/1',
    false
  );

  assert.ok(emptyLayout.blackboardBound, 'blackboardBound 必须存在');
  assert.equal(emptyLayout.blackboardBound.x, 40, '起始 X 为 40px');
  assert.equal(emptyLayout.blackboardBound.y, 24, '起始 Y 为 24px');
  assert.equal(emptyLayout.blackboardBound.width, 1080, '最小宽度保持 1080px');
  assert.equal(emptyLayout.blackboardBound.height, 38, '无条目时顶部黑板栏高度收缩为 38px 轻量状态条');

  // 2. 有条目场景 (posts.length > 0)：黑板区域维持 96px 标准高度容纳条目方块
  const populatedLayout = computeLayout(
    [{ id: '/ws/1', name: 'proj-1', isCurrent: true }],
    [{ id: 's1', workspace: '/ws/1', title: 'Worker 1', state: 'idle' }],
    [
      { id: 'p1', topic: 'task:review', status: 'active', authorSessionId: 's1' },
      { id: 'p2', topic: 'task:qa', status: 'active', authorSessionId: 's1' }
    ],
    '/ws/1',
    false
  );

  assert.equal(populatedLayout.blackboardBound.height, 96, '有条目时顶部黑板栏高度扩展为 96px 标准高度');
  assert.equal(populatedLayout.postPositions['p1'].y, 52, '第一张条目方块 y 坐标位于 52px');
  assert.equal(populatedLayout.postPositions['p1'].height, 48, '条目方块高度为 48px');

  // 3. VNode 渲染验证：空状态文字与垂直居中
  const telemetryEmpty = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/1',
    workspaces: [{ id: '/ws/1', name: 'proj-1', isCurrent: true, sessionIds: ['s1'] }],
    sessions: [{ id: 's1', title: 'Worker 1', workspace: '/ws/1', state: 'idle' }],
    posts: [],
    calls: []
  };

  const reactMockZh = createMockReact(telemetryEmpty);
  const pluginZh = loadClientBundle((name) => name === 'react' ? reactMockZh : null);
  const viewZh = pluginZh.CanvasView({ sessionId: 's1', t: tZh, locale: 'zh' });

  const bbLayerZh = findNodeById(viewZh, 'dsh-canvas-blackboard-layer');
  assert.ok(bbLayerZh, '必须渲染黑板图层');

  // 背景矩形高度断言
  const bgRect = bbLayerZh.children.find(c => c && c.type === 'rect' && c.props && c.props.x === 40);
  assert.ok(bgRect, '必须包含背景矩形');
  assert.equal(bgRect.props.height, 38, '空态下背景矩形高度严格为 38px');

  // 标题组垂直偏移断言 (blackboardBound.y + 23)
  const titleGroup = findNodeById(viewZh, 'dsh-canvas-blackboard-title-group');
  assert.ok(titleGroup, '必须包含标题组');
  assert.equal(titleGroup.props.transform, 'translate(56, 47)', '空态下标题组纵向偏移调整为 y + 23 = 47px 保持垂直居中');

  // 居中空态提示文本断言
  const emptyTextNode = bbLayerZh.children.find(c => c && c.type === 'text' && c.children && c.children.includes('暂无黑板条目'));
  assert.ok(emptyTextNode, '必须渲染「暂无黑板条目」空态提示文本');
  assert.equal(emptyTextNode.props.x, 40 + 1080 / 2, '空态提示文本水平严格居中');
  assert.equal(emptyTextNode.props.y, 47, '空态提示文本纵向与 38px 状态条居中对齐 (24 + 23 = 47)');
  assert.equal(emptyTextNode.props.textAnchor, 'middle', '文本锚点为 middle');

  // 英文空态文案断言
  const reactMockEn = createMockReact(telemetryEmpty);
  const pluginEn = loadClientBundle((name) => name === 'react' ? reactMockEn : null);
  const viewEn = pluginEn.CanvasView({ sessionId: 's1', t: tEn, locale: 'en' });
  const bbLayerEn = findNodeById(viewEn, 'dsh-canvas-blackboard-layer');
  const emptyTextEn = bbLayerEn.children.find(c => c && c.type === 'text' && c.children && c.children.includes('No blackboard posts'));
  assert.ok(emptyTextEn, '英文环境下必须渲染「No blackboard posts」');

  // 4. 包围盒自适应排除过高预留留白断言
  const emptyBlackboardBottom = emptyLayout.blackboardBound.y + emptyLayout.blackboardBound.height;
  const populatedBlackboardBottom = populatedLayout.blackboardBound.y + populatedLayout.blackboardBound.height;
  assert.equal(emptyBlackboardBottom, 62, '空态黑板下边缘收缩至 62px');
  assert.equal(populatedBlackboardBottom, 120, '有条目黑板下边缘为 120px');
  assert.equal(populatedBlackboardBottom - emptyBlackboardBottom, 58, '自适应排除 58px 无效预留留白');
});

test('工作区列在 1 列、2 列、3 列不同规模下的包围盒边界与 Fit View 收敛性 (Task t12)', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  function evaluateFitView(layout, vw = 1280, vh = 800) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    layout.workspaceBounds.forEach(ws => {
      minX = Math.min(minX, ws.x);
      minY = Math.min(minY, ws.y);
      maxX = Math.max(maxX, ws.x + ws.width);
      maxY = Math.max(maxY, ws.y + ws.height);
    });

    Object.keys(layout.nodePositions).forEach(sid => {
      const node = layout.nodePositions[sid];
      minX = Math.min(minX, node.x - 96);
      minY = Math.min(minY, node.y - 26);
      maxX = Math.max(maxX, node.x + 96);
      maxY = Math.max(maxY, node.y + 26);
    });

    if (layout.blackboardBound) {
      minX = Math.min(minX, layout.blackboardBound.x);
      minY = Math.min(minY, layout.blackboardBound.y);
      maxX = Math.max(maxX, layout.blackboardBound.x + layout.blackboardBound.width);
      maxY = Math.max(maxY, layout.blackboardBound.y + layout.blackboardBound.height);
    }

    const contentW = Math.max(maxX - minX, 50);
    const contentH = Math.max(maxY - minY, 50);
    const padding = 48;
    const availW = Math.max(vw - padding * 2, 100);
    const availH = Math.max(vh - padding * 2, 100);

    const fitZoom = Math.min(Math.max(Math.min(availW / contentW, availH / contentH), 0.30), 1.20);
    const fitPanX = (vw - contentW * fitZoom) / 2 - minX * fitZoom;
    const fitPanY = (vh - contentH * fitZoom) / 2 - minY * fitZoom;

    return { minX, minY, maxX, maxY, contentW, contentH, fitZoom, fitPanX, fitPanY };
  }

  // -------------------------------------------------------------
  // 1 规模验证：单列工作区 (1 Column)
  // -------------------------------------------------------------
  const ws1 = [{ id: '/ws/single', name: 'single-col', isCurrent: true }];
  const sessions1 = [
    { id: 's1-1', workspace: '/ws/single', title: 'Single Worker 1', state: 'running' },
    { id: 's1-2', workspace: '/ws/single', title: 'Single Worker 2', state: 'idle' }
  ];
  const layout1 = computeLayout(ws1, sessions1, [], '/ws/single', false);

  assert.equal(layout1.workspaceBounds.length, 1, '包含 1 个工作区列');
  assert.equal(layout1.workspaceBounds[0].x, 40, '第 1 列 X 起始坐标为 40px');
  assert.equal(layout1.workspaceBounds[0].width, 260, '第 1 列宽度严格为 260px');
  assert.equal(layout1.workspaceBounds[0].x + layout1.workspaceBounds[0].width, 300, '第 1 列右边界为 300px');
  assert.equal(layout1.blackboardBound.width, 1080, '顶部黑板栏保持 1080px 最小规约宽度');
  assert.equal(layout1.blackboardBound.height, 38, '空黑板高度收缩为 38px');

  const fit1 = evaluateFitView(layout1, 1280, 800);
  assert.equal(fit1.minX, 40, '1 列包围盒 minX 为 40px');
  assert.equal(fit1.maxX, 1120, '1 列包围盒 maxX 由 1080px 黑板决定为 1120px');
  assert.equal(fit1.contentW, 1080, '1 列内容宽度为 1080px');
  assert.ok(fit1.fitZoom >= 0.90 && fit1.fitZoom <= 1.20, '1 列在 1280px 下缩放比例保持舒适可读');
  assert.ok(fit1.fitPanX > 0, 'fitPanX 正向居中，无左偏出屏');

  // -------------------------------------------------------------
  // 2 规模验证：两列工作区 (2 Columns)
  // -------------------------------------------------------------
  const ws2 = [
    { id: '/ws/alpha', name: 'alpha-col', isCurrent: true },
    { id: '/ws/beta', name: 'beta-col', isCurrent: false }
  ];
  const sessions2 = [
    { id: 's2-1', workspace: '/ws/alpha', title: 'Alpha 1', state: 'running' },
    { id: 's2-2', workspace: '/ws/beta', title: 'Beta 1', state: 'idle' }
  ];
  const layout2 = computeLayout(ws2, sessions2, [], '/ws/alpha', true);

  assert.equal(layout2.workspaceBounds.length, 2, '包含 2 个工作区列');
  assert.equal(layout2.workspaceBounds[0].x, 40, '第 1 列 X 坐标为 40px');
  assert.equal(layout2.workspaceBounds[1].x, 40 + 260 + 36, '第 2 列 X 坐标为 336px (40 + 260 + 36)');
  assert.equal(layout2.workspaceBounds[1].x + layout2.workspaceBounds[1].width, 596, '第 2 列右边界为 596px');
  assert.equal(layout2.blackboardBound.width, 1080, '2 列总跨度 636px <= 1080px，黑板宽保持 1080px');

  const fit2 = evaluateFitView(layout2, 1280, 800);
  assert.equal(fit2.minX, 40);
  assert.equal(fit2.maxX, 1120);
  assert.equal(fit2.contentW, 1080);
  assert.ok(fit2.fitZoom > 0.85);

  // -------------------------------------------------------------
  // 3 规模验证：三列工作区 (3 Columns) —— 验证第 3 列不被截断
  // -------------------------------------------------------------
  const ws3 = [
    { id: '/ws/col-1', name: 'col-1', isCurrent: true },
    { id: '/ws/col-2', name: 'col-2', isCurrent: false },
    { id: '/ws/col-3', name: 'col-3', isCurrent: false }
  ];
  const sessions3 = [
    { id: 's3-1', workspace: '/ws/col-1', title: 'Col 1 Worker', state: 'running' },
    { id: 's3-2', workspace: '/ws/col-2', title: 'Col 2 Worker', state: 'idle' },
    { id: 's3-3', workspace: '/ws/col-3', title: 'Col 3 Worker', state: 'running' }
  ];
  const layout3 = computeLayout(ws3, sessions3, [], '/ws/col-1', true);

  assert.equal(layout3.workspaceBounds.length, 3, '包含 3 个工作区列');
  assert.equal(layout3.workspaceBounds[0].x, 40, '第 1 列 X 坐标为 40px');
  assert.equal(layout3.workspaceBounds[1].x, 336, '第 2 列 X 坐标为 336px');
  assert.equal(layout3.workspaceBounds[2].x, 632, '第 3 列 X 坐标为 632px (40 + 2 * 296)');
  const col3Right = layout3.workspaceBounds[2].x + layout3.workspaceBounds[2].width;
  assert.equal(col3Right, 892, '第 3 列右边界为 892px (632 + 260)');

  // 黑板宽度计算：3 * 296 - 36 + 80 = 932 <= 1080，因此黑板宽度仍为 1080px
  assert.equal(layout3.blackboardBound.width, 1080, '3 列黑板宽度为 1080px');
  assert.equal(layout3.blackboardBound.x + layout3.blackboardBound.width, 1120, '黑板右边界为 1120px');
  assert.ok(col3Right < 1120, '关键断言：第 3 列右边界 (892px) 完全位于黑板右边界 (1120px) 内部');

  const fit3 = evaluateFitView(layout3, 1280, 800);
  assert.equal(fit3.minX, 40, '3 列包围盒 minX 必须严格收敛至 40px');
  assert.equal(fit3.maxX, 1120, '3 列包围盒 maxX 必须严格收敛至 1120px');
  assert.equal(fit3.contentW, 1080, '3 列全量包围盒宽度严格为 1080px');

  // 关键收敛性断言：在 1280px 常见宽度下，第 3 列在经过 fitZoom/fitPanX 变换后必须完全位于可视区内
  const col3TransformedLeft = fit3.fitPanX + layout3.workspaceBounds[2].x * fit3.fitZoom;
  const col3TransformedRight = fit3.fitPanX + col3Right * fit3.fitZoom;
  assert.ok(col3TransformedLeft > 0, `第 3 列变换后左边界 (${col3TransformedLeft.toFixed(1)}px) 必须大于 0`);
  assert.ok(col3TransformedRight < 1280, `第 3 列变换后右边界 (${col3TransformedRight.toFixed(1)}px) 必须小于视口宽 1280px，避免截断`);
  assert.ok(1280 - col3TransformedRight >= 48, `第 3 列右侧保留安全留白边距 (${(1280 - col3TransformedRight).toFixed(1)}px >= 48px)`);

  // -------------------------------------------------------------
  // 4 状态对比：空黑板 vs 填充黑板 在 3 列下的包围盒收缩与单调性
  // -------------------------------------------------------------
  const layout3Populated = computeLayout(
    ws3,
    sessions3,
    [{ id: 'p1', topic: 'spec:1' }, { id: 'p2', topic: 'spec:2' }, { id: 'p3', topic: 'spec:3' }],
    '/ws/col-1',
    true
  );
  assert.equal(layout3Populated.blackboardBound.height, 96, '填充态黑板高为 96px');
  assert.equal(layout3.blackboardBound.height, 38, '空态黑板高为 38px');

  const fit3Populated = evaluateFitView(layout3Populated, 1280, 800);
  assert.equal(fit3.minX, fit3Populated.minX, '空态与填充态 minX 保持严格一致');
  assert.equal(fit3.maxX, fit3Populated.maxX, '空态与填充态 maxX 保持严格一致');
  assert.equal(fit3.contentW, fit3Populated.contentW, '空态与填充态 contentW 保持严格一致');
  assert.equal(layout3.workspaceBounds[2].x, layout3Populated.workspaceBounds[2].x, '工作区列坐标不受黑板条目增减影响');
});

test('ADR-0014 & ADR-0019 拓扑通道分流走线与上下行解耦几何规约', () => {
  const plugin = loadClientBundle();
  const { calculateBezierPath } = plugin;

  // 1. 同工作区列向下调用：右出右进（相邻节点 dy=72 > 0），走右侧通道，零横切中轴
  const intraColDownPath = calculateBezierPath(170, 214, 170, 286, 0, 1);
  assert.ok(intraColDownPath.startsWith('M '), '同列向下调用必须以 M 起点开始');
  assert.ok(intraColDownPath.includes(' C '), '同列向下调用必须使用三次贝塞尔');
  const mMatchDown = intraColDownPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(mMatchDown, '同列向下调用正则匹配合规三次贝塞尔');
  const downStartX = parseFloat(mMatchDown[1]);
  const downC1x = parseFloat(mMatchDown[3]);
  const downC2x = parseFloat(mMatchDown[5]);
  const downEndX = parseFloat(mMatchDown[7]);
  // 右出右进断言（零横切中轴）
  assert.ok(downStartX > 170, '向下起点必须位于节点右侧 (downStartX > 170)');
  assert.ok(downC1x > 170 + 96 && downC1x <= 170 + 126, '向下第一控制点必须严格在右走线通道内 (266 < c1x <= 296)');
  assert.ok(downC2x > 170 + 96 && downC2x <= 170 + 126, '向下第二控制点必须严格在右走线通道内 (266 < c2x <= 296)');
  assert.ok(downEndX > 170, '向下终点必须自目标右侧接入 (downEndX > 170，右出右进)');

  // 1.1 同工作区列向上调用：左出左进（相邻节点 dy=-72 < 0），走左侧通道，零横切中轴
  const intraColUpPath = calculateBezierPath(170, 286, 170, 214, 0, 1);
  assert.ok(intraColUpPath.startsWith('M '), '同列向上调用必须以 M 起点开始');
  assert.ok(intraColUpPath.includes(' C '), '同列向上调用必须使用三次贝塞尔');
  const mMatchUp = intraColUpPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(mMatchUp, '同列向上调用正则匹配合规三次贝塞尔');
  const upStartX = parseFloat(mMatchUp[1]);
  const upC1x = parseFloat(mMatchUp[3]);
  const upC2x = parseFloat(mMatchUp[5]);
  const upEndX = parseFloat(mMatchUp[7]);
  // 左出左进断言（零横切中轴）
  assert.ok(upStartX < 170, '向上起点必须位于节点左侧 (upStartX < 170)');
  assert.ok(upC1x < 170 - 96 && upC1x >= 170 - 126, '向上第一控制点必须严格在左走线通道内 (44 <= c1x < 74)');
  assert.ok(upC2x < 170 - 96 && upC2x >= 170 - 126, '向上第二控制点必须严格在左走线通道内 (44 <= c2x < 74)');
  assert.ok(upEndX < 170, '向上终点必须自目标左侧接入 (upEndX < 170，左出左进)');

  // 1.2 同工作区列跨层非相邻向下调用（dy=144 > 80）：同心外扩嵌套，严格钳位在列宽内
  const intraNonAdjPath = calculateBezierPath(170, 214, 170, 358, 0, 1);
  assert.ok(intraNonAdjPath.startsWith('M '), '跨层调用必须以 M 起点开始');
  const mMatchNonAdj = intraNonAdjPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(mMatchNonAdj, '跨层调用生成合规三次贝塞尔');
  const nonAdjStartX = parseFloat(mMatchNonAdj[1]);
  const nonAdjC1x = parseFloat(mMatchNonAdj[3]);
  const nonAdjEndX = parseFloat(mMatchNonAdj[7]);
  assert.ok(nonAdjStartX > 170, '跨层向下起点严格位于节点右侧');
  assert.ok(nonAdjC1x > downC1x, '跨层调用第一控制点外扩半径大于相邻调用（同心嵌套）');
  assert.ok(nonAdjC1x <= 170 + 126, '跨层第一控制点严格限制在列宽边界内 (<= 296)');
  assert.ok(nonAdjEndX > 170, '跨层向下终点严格自目标右侧接入');

  // 2. 正向跨工作区调用 (从左向右)：右出左进平滑贝塞尔
  const crossForwardPath = calculateBezierPath(170, 214, 466, 214, 0, 1);
  const mMatchCross = crossForwardPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(mMatchCross);
  assert.ok(parseFloat(mMatchCross[1]) > 170, '正向跨列发起端自右侧引出');
  assert.ok(parseFloat(mMatchCross[7]) < 466, '正向跨列接收端自左侧接入');

  // 3. 相邻列反向跨工作区调用 (从右向左，|dx|=296 >= 200)：顶层避障通道走线
  const crossReversePath = calculateBezierPath(466, 214, 170, 214, 0, 1);
  assert.ok(crossReversePath.startsWith('M '), '反向跨列调用以 M 开始');
  const adjRevCMatches = [...crossReversePath.matchAll(/C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/g)];
  assert.equal(adjRevCMatches.length, 3, '相邻列反向跨列调用必须生成三段式顶层走线通道贝塞尔');
  const mMatchRev = crossReversePath.match(/^M\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(parseFloat(mMatchRev[1]) > 466, '反向跨列发起端自右侧出线 (startX > 466)');
  assert.equal(parseFloat(adjRevCMatches[0][6]), 130, '第一段升至顶层避障通道高度 y=130');
  assert.equal(parseFloat(adjRevCMatches[1][6]), 130, '第二段在顶层避障通道 y=130 横跨');
  assert.ok(parseFloat(adjRevCMatches[2][5]) < 170, '第三段自目标左侧接入 (endX < 170)');

  // 3.1 跨多列反向调用 (|dx| = 592 >= 200)：通过顶层走线通道 (y <= 130) 横跨避障，绝不穿透中间卡片
  const multiColRevPath = calculateBezierPath(762, 214, 170, 214, 0, 1);
  assert.ok(multiColRevPath.startsWith('M '), '多列反向调用以 M 开始');
  const revCMatches = [...multiColRevPath.matchAll(/C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/g)];
  assert.equal(revCMatches.length, 3, '多列反向调用必须生成三段式顶层走线通道贝塞尔');
  const mStartRev = multiColRevPath.match(/^M\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(parseFloat(mStartRev[1]) > 762, '多列反向发起端严格自右侧出线 (startX > 762)');
  assert.equal(parseFloat(revCMatches[0][6]), 130, '第一段升至顶层避障通道高度 y=130');
  assert.equal(parseFloat(revCMatches[1][6]), 130, '第二段在顶层避障通道 y=130 横跨');
  assert.ok(parseFloat(revCMatches[2][5]) < 170, '第三段严格自目标左侧接入 (endX < 170)');

  // 4. 国际化字典中当前工作区标记完整性 (ADR-0013 [Current])
  assert.equal(plugin.en['workspace.current'], 'Current', '英文字典必须包含 workspace.current 且值为 Current');
  assert.equal(plugin.zh['workspace.current'], '当前', '中文字典必须包含 workspace.current 且值为 当前');
});

test('ADR-0014 严格插件作用域双色主题与工具栏切换映射', () => {
  let themeCalledWith = null;
  const mockTheme = {
    setTheme: (pref) => {
      themeCalledWith = pref;
    }
  };

  const telemetryEmpty = {
    timestamp: Date.now(),
    currentWorkspace: '/ws/1',
    workspaces: [{ id: '/ws/1', name: 'proj-1', isCurrent: true, sessionIds: ['s1'] }],
    sessions: [{ id: 's1', title: 'Worker 1', workspace: '/ws/1', state: 'idle' }],
    posts: [],
    calls: []
  };

  function createMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  const reactMock = createMockReact(telemetryEmpty);
  const plugin = loadClientBundle((name) => name === 'react' ? reactMock : null);
  const t = (k) => plugin.zh[k] || k;

  const view = plugin.CanvasView({
    sessionId: 's1',
    theme: mockTheme,
    t: t
  });

  // 1. 工具栏存在主题切换按钮
  const themeBtn = findNodeById(view, 'dsh-canvas-theme-toggle');
  assert.ok(themeBtn, '工具栏必须包含 #dsh-canvas-theme-toggle 按钮');
  assert.equal(typeof themeBtn.props.onClick, 'function', '主题切换按钮必须绑定点击事件');

  // 2. 点击触发宿主主题接口映射
  themeBtn.props.onClick();
  assert.equal(themeCalledWith, 'light', '首次点击必须向宿主 setTheme 发起 light 切换');

  // 3. 容器类名具备双色自适应
  assert.ok(view.props.className.includes('dsh-canvas-container'), '根容器必须具备 dsh-canvas-container 基础类');
  assert.ok(view.props.className.includes('dsh-canvas-dark') || view.props.className.includes('dsh-canvas-light'), '根容器必须标记明暗主题类名');
});

test('ADR-0014 严格作用域隔离验证：CSS 严禁使用宿主 body 选择器', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');
  assert.ok(!code.includes('body:not'), '严禁使用 body:not([data-ds-dark-theme]) 污染宿主全局选择器');
  assert.ok(!code.includes('body .dsh-canvas'), '严禁包含 body 级别样式选择器前缀');
});

test('Spec 002 & ADR-0014: 浅色模式黑板卡片文字对比度符合 WCAG 2.1 AA 规范', () => {
  const plugin = loadClientBundle();
  const activePost = { id: 'p1', topic: 'test topic', status: 'active' };
  const inactivePost = { id: 'p2', topic: 'old topic', status: 'expired' };

  // 浅色模式验证
  const lightActive = plugin.resolvePostColors(activePost, true, false);
  const lightInactive = plugin.resolvePostColors(inactivePost, false, false);
  assert.equal(lightActive.textColor, '#0f172a', '浅色模式活跃卡片文本必须为深色高对比度 (#0f172a)');
  assert.equal(lightActive.fillColor, '#ffffff', '浅色模式活跃卡片背景为白色');
  assert.equal(lightInactive.textColor, '#64748b', '浅色模式非活跃卡片文本必须具备充足对比度 (#64748b)');

  // 深色模式验证
  const darkActive = plugin.resolvePostColors(activePost, true, true);
  assert.equal(darkActive.textColor, '#e2e8f0', '深色模式活跃卡片文本为亮色 (#e2e8f0)');
  assert.equal(darkActive.strokeWidth, '1.8', '活跃卡片描边宽度必须为 1.8');
  assert.equal(darkActive.strokeDash, 'none', '活跃卡片描边样式为实线');
  assert.equal(lightInactive.strokeWidth, '1', '过期卡片描边宽度为 1');
  assert.equal(lightInactive.strokeDash, '1 3', '过期卡片描边虚线模式');
});

test('Spec 002 & ADR-0014: 宿主主题接口缺失时主题切换严格作用域隔离且不污染外部属性', () => {
  function createLocalMockReact(telemetryData) {
    return {
      useState: (initial) => {
        if (initial && typeof initial === 'object' && 'sessions' in initial) {
          return [telemetryData, () => {}];
        }
        return [initial, () => {}];
      },
      useRef: (initial) => ({ current: initial }),
      useEffect: () => {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children })
    };
  }
  function findLocalNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && (node.props.id === id || node.props.key === id)) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findLocalNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }
  const reactMock = createLocalMockReact({ workspaces: [], sessions: [], posts: [], calls: [] });
  let docAttribute = null;
  const mockDoc = {
    body: {
      hasAttribute: (n) => docAttribute !== null,
      getAttribute: (n) => docAttribute,
      setAttribute: (n, v) => { docAttribute = v; },
      removeAttribute: (n) => { docAttribute = null; }
    }
  };

  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');
  let registration = null;
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (p) => { registration = p; } },
      innerWidth: 1000,
      innerHeight: 700
    },
    document: mockDoc,
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
  const clientPlugin = registration.factory((name) => name === 'react' ? reactMock : null);

  const view = clientPlugin.CanvasView({
    sessionId: 's1',
    theme: null, // 无宿主主题接口
    t: (k) => clientPlugin.zh[k] || k
  });

  const themeBtn = findLocalNodeById(view, 'dsh-canvas-theme-toggle');
  assert.ok(themeBtn, '主题按钮必须存在');

  // 点击触发主题切换：验证严格作用域隔离，不向外部 document.body 写入属性
  themeBtn.props.onClick();
  assert.equal(docAttribute, null, '宿主接口缺失时绝不向外部 document.body 写入属性，保持严格作用域隔离');
});

test('画布视口防裁切：.dsh-canvas-surface 显式声明 overflow: visible 防变换硬切', () => {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');
  const surfaceRuleMatch = code.match(/\.dsh-canvas-surface\s*\{([^}]*)\}/);
  assert.ok(surfaceRuleMatch, '.dsh-canvas-surface 样式规则必须存在');
  const surfaceStyles = surfaceRuleMatch[1];
  assert.ok(
    surfaceStyles.includes('overflow: visible') || surfaceStyles.includes('overflow:visible'),
    '.dsh-canvas-surface 必须显式声明 overflow: visible，防止浏览器对 scale/translate3d 的 SVG 内容进行 100% 矩形视口硬裁切'
  );
});

test('黑板栏防膨胀规约 (PRD §3.2)：大量历史过期条目下宽度不超标且活跃项优先置首', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  const sessions = Array.from({ length: 11 }, (_, i) => ({
    id: 's-' + i,
    workspace: '/ws/main',
    state: 'idle'
  }));

  // 35 条已过期条目 + 2 条活跃条目（模拟真实黑板历史累积）
  const posts = [
    ...Array.from({ length: 35 }, (_, i) => ({
      id: 'expired-' + i,
      topic: 'sync:task-' + i,
      status: 'expired',
      createdAt: 1000 + i
    })),
    { id: 'active-1', topic: 'sync:urgent-1', status: 'active', createdAt: 5000 },
    { id: 'active-2', topic: 'sync:urgent-2', status: 'active', createdAt: 6000 }
  ];

  const layout = computeLayout(
    [{ id: '/ws/main', name: 'main', isCurrent: true }],
    sessions,
    posts,
    '/ws/main',
    false
  );

  // 1. 黑板宽度严格遵循 PRD §3.2 公式：单工作区为 1080px，严禁线性膨胀至 7000+ px
  assert.equal(
    layout.blackboardBound.width,
    1080,
    '单工作区黑板栏宽度必须严格遵循 PRD §3.2 的 1080px 规约，严禁被历史过期条目撑爆'
  );

  // 2. 活跃条目优先排布：2 条 active 条目必须被赋予可视坐标，且排在最前
  assert.ok(layout.postPositions['active-1'], '活跃条目 active-1 必须成功分配可视坐标');
  assert.ok(layout.postPositions['active-2'], '活跃条目 active-2 必须成功分配可视坐标');
  assert.equal(layout.postPositions['active-2'].x, 56, '最新活跃条目必须排在黑板第 1 位 (x=56)');
  assert.equal(layout.postPositions['active-1'].x, 56 + 196, '次新活跃条目排在第 2 位 (x=252)');

  // 3. 超出黑板容量的条目不分配越界坐标（防止连线穿向 7000px 虚空）
  const visiblePositions = Object.values(layout.postPositions);
  assert.ok(
    visiblePositions.length <= 5,
    `1080px 黑板栏内仅容纳不多于 5 张卡片，实际分配 ${visiblePositions.length} 张`
  );
  for (const pos of visiblePositions) {
    assert.ok(
      pos.x + pos.width <= layout.blackboardBound.x + layout.blackboardBound.width,
      `卡片右边界 (${pos.x + pos.width}) 严禁超出黑板边界 (${layout.blackboardBound.x + layout.blackboardBound.width})`
    );
  }
});

test('通道走线槽位离散 (ADR-0014)：多条黑板连线右侧通道离散走线避免单点重叠', () => {
  const sessions = [
    { id: 's1', workspace: '/ws/main', state: 'idle' },
    { id: 's2', workspace: '/ws/main', state: 'idle' }
  ];

  // 同一会话发布 4 条黑板条目
  const posts = [
    { id: 'p-0', topic: 'task-0', status: 'active', authorSessionId: 's1', createdAt: 4000 },
    { id: 'p-1', topic: 'task-1', status: 'active', authorSessionId: 's1', createdAt: 3000 },
    { id: 'p-2', topic: 'task-2', status: 'active', authorSessionId: 's1', createdAt: 2000 },
    { id: 'p-3', topic: 'task-3', status: 'active', authorSessionId: 's1', createdAt: 1000 }
  ];

  const mockTelemetry = {
    metrics: { runningSessions: 0, totalSessions: 2, activeCalls: 0, totalPosts: 4 },
    workspaces: [{ id: '/ws/main', name: 'main', isCurrent: true, sessionIds: ['s1', 's2'] }],
    sessions,
    posts,
    calls: []
  };

  const mockReact = {
    useState: (initial) => {
      if (initial && typeof initial === 'object' && 'sessions' in initial) {
        return [mockTelemetry, () => {}];
      }
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const clientPath = path.join(rootDir, 'lib', 'client.js');
  const code = fs.readFileSync(clientPath, 'utf8');
  let registration = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (p) => { registration = p; } } },
    document: { getElementById: () => null, createElement: () => ({ id: '', textContent: '' }), head: { appendChild: () => {} } },
    console, Date, Set, Map, Array, Object, String, Math, JSON, URLSearchParams,
    setInterval, clearInterval, setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const plugin = registration.factory((name) => name === 'react' ? mockReact : null);

  const view = plugin.CanvasView({ sessionId: 's1', t: (k) => k });

  function findNodeById(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (node.props && node.props.id === id) return node;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  const authorEdgesGroup = findNodeById(view, 'dsh-canvas-author-edges');
  assert.ok(authorEdgesGroup, 'authorEdgesGroup 必须存在');
  const validAuthorPaths = authorEdgesGroup.children.filter(Boolean);
  assert.equal(validAuthorPaths.length, 4, '必须生成 4 条发布归属边');

  // 提取每条边的通道过渡坐标 (gutterX, gutterY)
  const gutterPoints = new Set();
  for (const p of validAuthorPaths) {
    const d = p.props.d;
    const m = d.match(/C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
    assert.ok(m, '边路径必须匹配合规两段式贝塞尔');
    gutterPoints.add(m[5] + ',' + m[6]);
  }

  // 关键断言：多条连线严禁全部塌陷在单一的 (288.0, 130.0) 坐标点上
  assert.ok(
    gutterPoints.size > 1,
    `多条归属边在右侧通道内必须离散分布（当前检测到 ${gutterPoints.size} 个通道点: ${[...gutterPoints].join('; ')}），避免单点重叠`
  );
});

test('多会话工作区纵向自适应居中 (PRD §8.2)：11会话工作区底端安全容纳在视口内', () => {
  const plugin = loadClientBundle();
  const { computeLayout } = plugin;

  const sessions = Array.from({ length: 11 }, (_, i) => ({
    id: 's-' + i,
    workspace: '/ws/main',
    state: 'idle'
  }));

  const layout = computeLayout(
    [{ id: '/ws/main', name: 'main', isCurrent: true }],
    sessions,
    [],
    '/ws/main',
    false
  );

  const ws = layout.workspaceBounds[0];
  const lastSession = layout.nodePositions['s-10'];

  // 视口尺寸设为标准 1000 x 700 (可用高度 700 - 44 顶栏 = 656)
  const vw = 1000;
  const vh = 656;
  const padding = 48;
  const availH = vh - padding * 2;

  // 自适应缩放计算
  const contentW = layout.blackboardBound.width;
  const contentH = (ws.y + ws.height) - layout.blackboardBound.y;
  const fitZoom = Math.min(Math.max(Math.min((vw - padding * 2) / contentW, availH / contentH), 0.30), 1.20);
  const fitPanY = (vh - contentH * fitZoom) / 2 - layout.blackboardBound.y * fitZoom;

  // 验证在自适应居中下，工作区底端与最后一个会话完全容纳在可视高度内
  const wsBottomScreenY = (ws.y + ws.height) * fitZoom + fitPanY;
  const lastSessionBottomScreenY = (lastSession.y + 26) * fitZoom + fitPanY;

  assert.ok(
    wsBottomScreenY <= vh - 20,
    `工作区底端屏幕位置 (${wsBottomScreenY.toFixed(1)}px) 必须在视口高度 (${vh}px) 安全边距内`
  );
  assert.ok(
    lastSessionBottomScreenY <= vh - 20,
    `第 11 个会话底端 (${lastSessionBottomScreenY.toFixed(1)}px) 必须完全可见且不被截断`
  );
});

function createTestCanvasHarness(canvasData, hoveredEntity = null) {
  let hookCounter = 0;
  const mockReact = {
    useState: (initial) => {
      hookCounter++;
      // 1: canvasData, 2: selectedEntity, 3: focusedEntity, 4: hoveredEntity
      if (hookCounter === 1) return [canvasData, () => {}];
      if (hoveredEntity && hookCounter === 4) return [hoveredEntity, () => {}];
      return [initial, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props || {}, children })
  };

  const plugin = loadClientBundle((name) => name === 'react' ? mockReact : null);
  const view = plugin.CanvasView({ sessionId: 's1', t: (k) => k });
  return { view };
}

function findVNodesInTree(node, predicate) {
  const results = [];
  if (!node || typeof node !== 'object') return results;
  if (predicate(node)) results.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      results.push(...findVNodesInTree(child, predicate));
    }
  }
  return results;
}

function parseBezierPath(path) {
  const m = path.match(/^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/);
  assert.ok(m, '路径必须为有效贝塞尔曲线');
  return {
    startX: parseFloat(m[1]),
    startY: parseFloat(m[2]),
    c1x: parseFloat(m[3]),
    c1y: parseFloat(m[4]),
    c2x: parseFloat(m[5]),
    c2y: parseFloat(m[6]),
    endX: parseFloat(m[7]),
    endY: parseFloat(m[8])
  };
}

test('ADR-0019 常态按需显影与历史调用连线抑制测试', () => {
  const now = Date.now();
  const mockCanvasData = {
    workspaces: [{ id: '/ws/1', name: 'main', isCurrent: true }],
    sessions: [
      { id: 's1', workspace: '/ws/1', title: 'Agent 1', status: 'idle', state: 'idle' },
      { id: 's2', workspace: '/ws/1', title: 'Agent 2', status: 'idle', state: 'idle' }
    ],
    posts: [],
    calls: [
      // 活跃调用 (5s 内)：常态下必须渲染
      { id: 'call-fresh', callerSessionId: 's1', targetSessionId: 's2', callType: 'task_dispatch', timestamp: now - 5000, status: 'active' },
      // 已结算调用：常态下返回 null，避免连线冗余
      { id: 'call-settled', callerSessionId: 's1', targetSessionId: 's2', callType: 'task_report', timestamp: now - 3000, status: 'settled' },
      // 历史过期调用 (>15s)：常态下必须完全抑制（返回 null）
      { id: 'call-historical', callerSessionId: 's1', targetSessionId: 's2', callType: 'notice', timestamp: now - 20000, status: 'active' }
    ],
    metrics: { totalSessions: 2, runningSessions: 0, activeCalls: 1, totalPosts: 0 }
  };

  // 1. 常态下无交互：已结算和历史过期连线完全抑制，仅渲染 1 条活跃新鲜调用
  const { view: defaultView } = createTestCanvasHarness(mockCanvasData);
  const defaultEdgesGroup = findVNodesInTree(defaultView, (n) => n && n.props && n.props.id === 'dsh-canvas-call-edges')[0];
  assert.ok(defaultEdgesGroup, 'dsh-canvas-call-edges 容器必须存在');

  const renderedEdges = defaultEdgesGroup.children.filter(Boolean);
  assert.equal(renderedEdges.length, 1, '常态下仅渲染 1 条活跃新鲜调用边');
  assert.equal(renderedEdges[0].props.key, 'call-fresh', '常态下渲染的边必须为活跃新鲜调用');

  // 2. 悬停交互：悬停 s1 节点时，按需显影点亮关联链路，赋予 dsh-pulse-edge 脉冲实线且不透明度为 1.0
  const hoveredSession = { kind: 'session', id: 's1', entity: mockCanvasData.sessions[0], x: 200, y: 200 };
  const { view: activeView } = createTestCanvasHarness(mockCanvasData, hoveredSession);
  const activeEdgesGroup = findVNodesInTree(activeView, (n) => n && n.props && n.props.id === 'dsh-canvas-call-edges')[0];
  const highlightedEdges = activeEdgesGroup.children.filter(Boolean);
  assert.equal(highlightedEdges.length, 3, '悬停时所有一度关联调用（含历史与已结算）必须全部显影复苏');
  assert.ok(highlightedEdges.some((e) => e.props.key === 'call-settled'), '常态抑制的已结算调用在悬停时显影复苏');
  assert.ok(highlightedEdges.some((e) => e.props.key === 'call-historical'), '常态抑制的历史过期调用在悬停时显影复苏');

  const freshEdge = highlightedEdges.find((e) => e.props.key === 'call-fresh');
  assert.ok(freshEdge, '活跃调用边存在');
  const pulsePath = findVNodesInTree(freshEdge, (n) => n && n.props && n.props.className && n.props.className.includes('dsh-pulse-edge'))[0];
  assert.ok(pulsePath, '高亮关联连线中的可视化路径必须包含 dsh-pulse-edge 脉冲类');
  assert.equal(pulsePath.props.opacity, 1.0, '高亮关联连线不透明度严格为 1.0');
});

test('ADR-0019 超轻量单行胶囊 Tooltip 结构与尺寸测试', () => {
  const mockCanvasData = {
    workspaces: [{ id: '/ws/1', name: 'main', isCurrent: true }],
    sessions: [
      { id: 's1', workspace: '/ws/1', title: 'Agent Worker', status: 'running', state: 'running' }
    ],
    posts: [],
    calls: [],
    metrics: { totalSessions: 1, runningSessions: 1, activeCalls: 0, totalPosts: 0 }
  };

  const hoveredSession = { kind: 'session', id: 's1', entity: mockCanvasData.sessions[0], x: 200, y: 200 };
  const { view } = createTestCanvasHarness(mockCanvasData, hoveredSession);

  const tooltipNode = findVNodesInTree(view, (n) => n && n.props && n.props.className === 'dsh-canvas-tooltip')[0];
  assert.ok(tooltipNode, '必须渲染 Session Tooltip');
  assert.equal(tooltipNode.props.style.height, '26px', 'Tooltip 胶囊高度严格为 26px (<= 28px)');
  assert.equal(tooltipNode.props.style.display, 'inline-flex', 'Tooltip 采用 inline-flex 单行布局');

  // 端口避让几何断言：Tooltip 锚定在卡片下边缘之外 (y >= 200 + 26)，完全避让 y=200 处的左右端口
  const tipTop = parseFloat(tooltipNode.props.style.top);
  assert.ok(tipTop >= 200 + 26, 'Tooltip 严格锚定在卡片下边缘之外，完全不遮挡 y=200 处侧向端口');

  const dotNode = findVNodesInTree(tooltipNode, (n) => n && n.props && n.props.className === 'dsh-canvas-capsule-dot')[0];
  assert.ok(dotNode, '胶囊必须包含状态圆点');
  assert.equal(dotNode.props.style.backgroundColor, '#22c55e', '运行中状态圆点颜色为绿色 #22c55e');
});

test('ADR-0019 通道分流几何同心外扩与端口避让严格几何断言', () => {
  const plugin = loadClientBundle();
  const { calculateBezierPath } = plugin;

  // 1. 同列向下调用 (dy > 0)：起点终点在右侧轮廓，右侧通道同心递增且严格 <= 170 + 126
  // ADR-0014: 首会话纵向基准中心为 240px
  const hop1Path = calculateBezierPath(170, 240, 170, 312, 0);
  const hop2Path = calculateBezierPath(170, 240, 170, 384, 0);
  const hop3Path = calculateBezierPath(170, 240, 170, 456, 0);

  const hop1Bezier = parseBezierPath(hop1Path);
  const hop2Bezier = parseBezierPath(hop2Path);
  const hop3Bezier = parseBezierPath(hop3Path);

  // 同心嵌套严格递增：hop1 (106) < hop2 (110) < hop3 (114)
  assert.ok(hop1Bezier.c1x < hop2Bezier.c1x, '下行2跳外扩半径严格大于1跳');
  assert.ok(hop2Bezier.c1x < hop3Bezier.c1x, '下行3跳外扩半径严格大于2跳');
  assert.equal(hop1Bezier.c1x, 170 + 106, '下行1跳控制点精确落在 CHANNEL_MIN_OFFSET (106px)');

  // 下行起点与终点均位于节点右侧轮廓且零横切中轴
  assert.ok(hop1Bezier.startX >= 170 + 80, '下行起点必须位于节点右侧轮廓');
  assert.ok(hop1Bezier.endX >= 170 + 80, '下行终点必须位于目标节点右侧轮廓');

  // 极限长跳数与奇数抖动下的通道上限钳位断言 (10跳 + 奇数抖动)：严格受 CHANNEL_MAX_OFFSET (126px) 限制
  const extremeDownPath = calculateBezierPath(170, 240, 170, 240 + 72 * 10, 1);
  const extremeDownBezier = parseBezierPath(extremeDownPath);
  assert.ok(extremeDownBezier.c1x <= 170 + 126, '下行极限跳数与奇数抖动控制点严格在列宽安全边距内 (<= 296)');
  assert.ok(extremeDownBezier.c2x <= 170 + 126, '下行极限跳数控制点2严格在列宽安全边距内 (<= 296)');

  // 2. 同列向上调用 (dy < 0)：起点终点在左侧轮廓，左侧通道同心递减且严格 >= 170 - 126
  const upwardHop1Path = calculateBezierPath(170, 312, 170, 240, 0);
  const upwardHop2Path = calculateBezierPath(170, 384, 170, 240, 0);
  const upwardHop1Bezier = parseBezierPath(upwardHop1Path);
  const upwardHop2Bezier = parseBezierPath(upwardHop2Path);

  // 上行起点与终点均位于节点左侧轮廓且零横切中轴
  assert.ok(upwardHop1Bezier.startX <= 170 - 80, '上行起点必须位于节点左侧轮廓');
  assert.ok(upwardHop1Bezier.endX <= 170 - 80, '上行终点必须位于目标节点左侧轮廓');
  assert.ok(upwardHop1Bezier.c1x <= 170 - 106, '上行控制点严格位于左侧通道');
  assert.ok(upwardHop1Bezier.c1x >= 170 - 126, '上行控制点严格在左侧列宽安全边距内');
  assert.ok(upwardHop2Bezier.c1x < upwardHop1Bezier.c1x, '上行2跳外扩距离严格大于1跳 (更偏左)');

  // 极限长跳数与奇数抖动下的上行通道下限钳位断言 (10跳 + 奇数抖动)：严格受 CHANNEL_MAX_OFFSET (126px) 限制
  const extremeUpwardPath = calculateBezierPath(170, 240 + 72 * 10, 170, 240, 1);
  const extremeUpwardBezier = parseBezierPath(extremeUpwardPath);
  assert.ok(extremeUpwardBezier.c1x >= 170 - 126, '上行极限跳数与奇数抖动控制点严格在左侧列宽安全边距内 (>= 44)');
  assert.ok(extremeUpwardBezier.c2x >= 170 - 126, '上行极限跳数控制点2严格在左侧列宽安全边距内 (>= 44)');
});

