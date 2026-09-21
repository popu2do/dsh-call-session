import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, '..', '..');

/** 画布工具栏高度：视口位于容器内部工具栏之下 */
const TOOLBAR_HEIGHT = 44;

/**
 * Loads and materializes lib/client.js via the DSH Web ModuleLoader contract.
 */
export function loadClientBundle(requireFn = () => null) {
  const clientPath = path.join(rootDir, 'lib', 'client.js');
  assert.ok(fs.existsSync(clientPath), 'lib/client.js must exist on disk');
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

  assert.ok(registration, 'lib/client.js must invoke window.__ModuleLoader__.load');
  assert.equal(registration.id, 'dsh-call-session', 'ModuleLoader id must match dsh-call-session');
  assert.equal(typeof registration.factory, 'function', 'registration.factory must be a function');

  return registration.factory(requireFn);
}

/**
 * Standard two-workspace canvas fixture: the current workspace pinned first with
 * two sessions, plus one peer workspace with a single session.
 */
export function standardCanvasTelemetry() {
  const workspaces = [
    { id: '/ws/w0', name: 'w0', isCurrent: true, sessionIds: ['session-a', 'session-b'] },
    { id: '/ws/w1', name: 'w1', isCurrent: false, sessionIds: ['session-c'] }
  ];
  const sessions = [
    { id: 'session-a', workspace: '/ws/w0', title: 'Agent A', status: 'idle' },
    { id: 'session-b', workspace: '/ws/w0', title: 'Agent B', status: 'running' },
    { id: 'session-c', workspace: '/ws/w1', title: 'Agent C', status: 'idle' }
  ];
  return { timestamp: Date.now(), currentWorkspace: '/ws/w0', workspaces, sessions, calls: [], posts: [] };
}

/**
 * Wide canvas fixture whose aggregate column width exceeds a standard viewport,
 * used to exercise locate clamping.
 */
export function wideCanvasTelemetry(workspaceCount = 5) {
  const workspaces = [];
  const sessions = [];
  for (let i = 0; i < workspaceCount; i++) {
    workspaces.push({ id: '/ws/w' + i, name: 'w' + i, isCurrent: i === 0, sessionIds: ['session-s' + i] });
    sessions.push({
      id: 'session-s' + i,
      workspace: '/ws/w' + i,
      title: 'Agent ' + i,
      status: i === 0 ? 'running' : 'idle'
    });
  }
  return { timestamp: Date.now(), currentWorkspace: '/ws/w0', workspaces, sessions, calls: [], posts: [] };
}

/**
 * Stateless React stub for tests that only render once: state setters are no-ops,
 * refs are recreated per render. Use createCanvasRuntime when a test needs renders
 * to persist refs and state across a host-side session switch.
 */
export function createStatelessMockReact(telemetryData) {
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

export function findVNodes(node, predicate, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (predicate(node)) acc.push(node);
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => findVNodes(child, predicate, acc));
  }
  return acc;
}

/**
 * Mounts CanvasView in a Node VM sandbox with a mock React that persists refs and
 * state across renders, mirroring real React hook semantics. Call render(sessionId)
 * to simulate a re-render after a host-side session switch.
 */
export function createCanvasRuntime(options = {}) {
  const telemetry = options.telemetry || {
    timestamp: Date.now(),
    currentWorkspace: '',
    workspaces: [],
    sessions: [],
    calls: [],
    posts: []
  };
  const containerWidth = options.containerWidth !== undefined ? options.containerWidth : 1200;
  const containerHeight = options.containerHeight !== undefined ? options.containerHeight : 744;
  const viewportWidth = options.viewportWidth !== undefined ? options.viewportWidth : 1200;
  const viewportHeight = options.viewportHeight !== undefined ? options.viewportHeight : 700;
  const windowWidth = options.windowWidth !== undefined ? options.windowWidth : 1200;
  const windowHeight = options.windowHeight !== undefined ? options.windowHeight : 800;

  const pans = [];
  const zooms = [];
  const refStore = [];
  const stateStore = [];
  const cleanups = [];
  const windowListeners = {};
  const resizeObservers = [];
  let refCursor = 0;
  let stateCursor = 0;

  const mockReact = {
    useState: (initial) => {
      const idx = stateCursor++;
      if (!(idx in stateStore)) {
        stateStore[idx] = (initial && typeof initial === 'object' && 'sessions' in initial) ? telemetry : initial;
      }
      const setter = (next) => {
        const prev = stateStore[idx];
        if (typeof next === 'function') next = next(prev);
        stateStore[idx] = next;
        if (next && typeof next === 'object' && 'x' in next && 'y' in next) pans.push({ ...next });
        else if (typeof next === 'number') zooms.push(next);
      };
      return [stateStore[idx], setter];
    },
    useRef: (initial) => {
      const idx = refCursor++;
      if (!(idx in refStore)) refStore[idx] = { current: initial };
      return refStore[idx];
    },
    useEffect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    createElement: (type, props, ...children) => {
      const node = { type, props: props || {}, children };
      // 真实 React 在挂载后写入 ref.current；此处按 className 还原同样的 DOM 引用，
      // 使组件测量到的容器与视口尺寸随 resize() 变化，与浏览器行为一致。
      const ref = node.props.ref;
      if (ref && typeof ref === 'object') {
        const cls = typeof node.props.className === 'string' ? node.props.className : '';
        if (cls.includes('dsh-canvas-viewport')) ref.current = mockViewport;
        else if (cls.includes('dsh-canvas-container')) ref.current = mockContainer;
      }
      return node;
    }
  };

  const mockContainer = {
    clientWidth: containerWidth,
    clientHeight: containerHeight,
    querySelector: (sel) => (sel === '.dsh-canvas-viewport' ? mockViewport : null)
  };
  const mockViewport = { clientWidth: viewportWidth, clientHeight: viewportHeight };

  class MockResizeObserver {
    constructor(callback) { this.callback = callback; resizeObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }

  const runtimeWindow = {
    ResizeObserver: MockResizeObserver,
    innerWidth: windowWidth,
    innerHeight: windowHeight,
    addEventListener: (event, handler) => { windowListeners[event] = handler; },
    removeEventListener: (event) => { delete windowListeners[event]; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  };

  const injectedStyles = [];
  const runtimeDocument = {
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (el) => { if (el && typeof el.textContent === 'string') injectedStyles.push(el.textContent); } },
    querySelector: (sel) => (sel === '.dsh-canvas-container' ? mockContainer : (sel === '.dsh-canvas-viewport' ? mockViewport : null))
  };

  // 记录挂起的 setTimeout 与 clearTimeout，使测试能断言「定时清除」而非仅断言「出现」
  const pendingTimers = [];
  let timerSeq = 1;
  const sandboxSetTimeout = (fn, delay) => {
    const id = timerSeq++;
    pendingTimers.push({ id, fn, delay });
    return id;
  };
  const sandboxClearTimeout = (id) => {
    const idx = pendingTimers.findIndex((timer) => timer.id === id);
    if (idx >= 0) pendingTimers.splice(idx, 1);
  };

  let registration = null;
  const sandbox = {
    window: runtimeWindow,
    document: runtimeDocument,
    ResizeObserver: MockResizeObserver,
    console, Date, Set, Map, Array, Object, String, Math, JSON, URLSearchParams,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: sandboxSetTimeout,
    clearTimeout: sandboxClearTimeout
  };
  runtimeWindow.__ModuleLoader__ = { load: (payload) => { registration = payload; } };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'lib', 'client.js'), 'utf8'), sandbox);
  const plugin = registration.factory((name) => (name === 'react' ? mockReact : null));
  const t = (key) => plugin.zh[key] || key;

  function render(sessionId) {
    refCursor = 0;
    stateCursor = 0;
    return plugin.CanvasView({ sessionId, t });
  }

  function surfaceOf(view) {
    return findVNodes(view, (n) => n && n.props && n.props.className === 'dsh-canvas-surface')[0];
  }

  function buttonOf(view, label) {
    return findVNodes(view, (n) => n && n.type === 'button' && n.props && typeof n.props.className === 'string' && n.props.className.includes('dsh-canvas-btn'))
      .find((b) => b.children && b.children.includes(label));
  }

  function nodesLayerOf(view) {
    return findVNodes(view, (n) => n && n.props && n.props.id === 'dsh-canvas-nodes')[0];
  }

  function nodeOf(view, nodeId) {
    const layer = nodesLayerOf(view);
    if (!layer) return null;
    return layer.children.find((c) => c && c.props && c.props.id === 'dsh-canvas-node-' + nodeId);
  }

  function ellipseOf(view, nodeId) {
    const node = nodeOf(view, nodeId);
    if (!node) return null;
    return node.children.find((c) => c && c.type === 'ellipse');
  }

  function latestObserver() {
    return resizeObservers[resizeObservers.length - 1];
  }

  function resize(width, height) {
    mockContainer.clientWidth = width;
    mockContainer.clientHeight = height;
    // 视口嵌在容器内部、位于工具栏之下，与浏览器中的真实高度差一致
    mockViewport.clientWidth = width;
    mockViewport.clientHeight = Math.max(100, height - TOOLBAR_HEIGHT);
    latestObserver().callback([{ target: mockContainer, contentRect: { width, height } }]);
  }

  function cleanupAll() {
    cleanups.forEach((c) => c());
  }

  function pendingDelays() {
    return pendingTimers.map((timer) => timer.delay);
  }

  function fireTimers(delay) {
    const due = pendingTimers.filter((timer) => delay === undefined || timer.delay === delay);
    due.forEach((timer) => {
      const idx = pendingTimers.indexOf(timer);
      if (idx >= 0) pendingTimers.splice(idx, 1);
      timer.fn();
    });
  }

  return {
    plugin, render, pans, zooms, injectedStyles, mockViewport,
    surfaceOf, buttonOf, nodesLayerOf, ellipseOf, resize, cleanupAll,
    pendingDelays, fireTimers
  };
}
