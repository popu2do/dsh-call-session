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
