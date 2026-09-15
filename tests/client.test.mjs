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

  // 断言已废弃的工具栏键名与无用死键已被彻底移除（无痕设计）
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

test('Multi-Workspace Swimlanes & Layout: Empty State, Boundary Separation and Isolation', () => {
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
      `Swimlane ${i+1} (${next.name}) must be separated from ${i} (${curr.name}) by at least 30px`
    );
  }
  for (const s of allSessions) {
    assert.ok(fullLayout.nodePositions[s.id], `Session ${s.id} must be positioned in multi-workspace layout`);
  }
});

test('Topology Visual Layout Engine: Blackboard strip, side-by-side swimlanes, and single-column session coordinates', () => {
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

  // 1. 黑板通条 (Top blackboard strip) 边界坐标断言
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

  // 2. 并排竖泳道 (Side-by-side vertical swimlanes) 坐标断言
  assert.equal(layout.workspaceBounds.length, 2);
  const laneAlpha = layout.workspaceBounds[0];
  const laneBeta = layout.workspaceBounds[1];

  assert.equal(laneAlpha.x, 40, 'First swimlane x must be 40');
  assert.equal(laneAlpha.y, 150, 'Swimlanes y start must be 150');
  assert.equal(laneAlpha.width, 260, 'Swimlane width must be 260');
  assert.equal(laneAlpha.height, 480, 'Swimlane minHeight must be 480 (76 + 3*72 + 24 = 316 < 480)');

  assert.equal(laneBeta.x, 40 + 260 + 36, 'Second swimlane x must be 336 (40 + 260 + 36)');
  assert.equal(laneBeta.y, 150, 'Second swimlane y start must be 150');
  assert.equal(laneBeta.width, 260, 'Second swimlane width must be 260');
  assert.equal(laneBeta.height, 480, 'Second swimlane minHeight must be 480');

  // 3. 泳道内单列 session 坐标断言 (Single-column vertical centered session nodes)
  // Lane Alpha: cx = 40 + 130 = 170
  assert.equal(layout.nodePositions['s1'].x, 170, 's1 cx must be centered in swimlane at 170');
  assert.equal(layout.nodePositions['s1'].y, 214, 's1 cy must start at 214');

  assert.equal(layout.nodePositions['s2'].x, 170, 's2 cx must stay in single column at 170');
  assert.equal(layout.nodePositions['s2'].y, 214 + 72, 's2 cy must be 214 + 72 = 286');

  assert.equal(layout.nodePositions['s3'].x, 170, 's3 cx must stay in single column at 170');
  assert.equal(layout.nodePositions['s3'].y, 214 + 2 * 72, 's3 cy must be 214 + 144 = 358');

  // Lane Beta: cx = 336 + 130 = 466
  assert.equal(layout.nodePositions['s4'].x, 466, 's4 cx must be centered in swimlane at 466');
  assert.equal(layout.nodePositions['s4'].y, 214, 's4 cy must start at 214');

  assert.equal(layout.nodePositions['s5'].x, 466, 's5 cx must stay in single column at 466');
  assert.equal(layout.nodePositions['s5'].y, 286, 's5 cy must be 286');

  // 单列纵向居中不变式：同泳道内的全部会话 x 坐标必须严格相同
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
  assert.ok(validAuthorPaths[0].props.d.startsWith('M 170.0 188.0 Q '), '归属边必须从 session 上顶点 (170, 214-26=188) 发起');
  assert.ok(validAuthorPaths[0].props.d.includes(' 146.0 100.0'), '归属边终点连接至 post 下边界 (56+90=146, 52+48=100)');

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

test('协作看板实测缺陷回归：真实标题、黑板空态、抽屉遮罩与礼貌性加载', () => {
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

test('全量合规审查：三次贝塞尔外切、无重复节点渲染、泳道头部高度与交互契约', () => {
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

  // 2. nodePositions 唯一性断言（杜绝大小写重复插入导致渲染翻倍）
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

  // 3. 泳道头部尺寸规格验证
  const clientSource = fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8');
  assert.ok(clientSource.includes('height: 38,'), '泳道头部高度必须严格为 38px (PRD 3.1)');
  assert.ok(clientSource.includes("fill: '#94a3b8'"), '泳道头部文字色值必须为 #94a3b8');
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

  // 离线/虚拟端点状态消费验证（PRD 缺陷 5 彻底闭环：渲染 session.offline）
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
  // 单工作区 (宽 260)，顶部通条 min-width 1080 (右边界 40 + 1080 = 1120)
  const singleWsLayout = plugin.computeLayout(
    [{ id: '/ws/single', name: 'single-ws', isCurrent: true }],
    [{ id: 's1', workspace: '/ws/single', title: 'Agent 1', status: 'idle' }],
    [],
    '/ws/single',
    false
  );
  assert.ok(singleWsLayout.blackboardBound, '必须存在 blackboardBound');
  assert.equal(singleWsLayout.blackboardBound.width, 1080, '通条最小宽度必须为 1080px');
  assert.equal(singleWsLayout.blackboardBound.x, 40, '通条起始 X 必须为 40px');
  const blackboardRight = singleWsLayout.blackboardBound.x + singleWsLayout.blackboardBound.width;
  assert.equal(blackboardRight, 1120, '顶部通条右边界必须达到 1120px');

  // 验证无任何 340px 欺骗性截断逻辑残余
  assert.equal(code.includes('maxX = Math.max(maxX, 340)'), false, '严禁保留 340px 硬编码作弊截断分支');
  assert.equal(code.includes('maxX = Math.max(maxX, blackboardBound.x + blackboardBound.width)'), true, 'Fit View 必须基于真实的 blackboardBound.x + blackboardBound.width 计算 maxX');
  assert.equal(code.includes('x: blackboardBound.x + blackboardBound.width / 2'), true, '黑板空态占位文字必须基于通条中心居中');
});
