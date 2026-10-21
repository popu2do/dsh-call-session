/**
 * tests/helpers/render-canvas-demo.mjs
 *
 * Deterministic live React UI headless renderer for bilingual canvas demos:
 * - assets/canvas-demo.png (English)
 * - assets/canvas-demo-zh.png (Chinese)
 * Conforms to ADR-0023 (Bilingual Localization) & ADR-0026 (Rounded Card Canvas).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureCache,
  FIGURE_SIZE,
  FONT_DIR,
  FONT_SOURCES,
  fontFaceCss,
  renderFigures,
  SCRATCH_DIR
} from './screenshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// Only the canvas figure renders a React component; the two UMD bundles are
// its alone.
const SCRIPTS = {
  'react.production.min.js': 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'react-dom.production.min.js': 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js'
};

const scriptPath = (name) => path.join(SCRATCH_DIR, name);

function buildHtml(locale) {
  const isZh = locale === 'zh';
  const clientJsPath = path.join(rootDir, 'lib', 'client.js');

  const sessions = isZh ? [
    { id: 'coord', workspace: '/core-service', title: '任务调度智能体', status: 'running', stats: { outboundCalls: 4, inboundCalls: 2, postsCount: 1 } },
    { id: 'arch', workspace: '/core-service', title: '架构评审智能体', status: 'idle', stats: { outboundCalls: 1, inboundCalls: 2, postsCount: 1 } },
    { id: 'sec', workspace: '/core-service', title: '安全审计智能体', status: 'idle', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 0 } },
    { id: 'etl', workspace: '/data-pipeline', title: '数据流处理智能体', status: 'running', stats: { outboundCalls: 2, inboundCalls: 1, postsCount: 0 } },
    { id: 'eval', workspace: '/data-pipeline', title: '指标评测智能体', status: 'idle', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 1 } },
    { id: 'ui', workspace: '/web-client', title: '界面构建智能体', status: 'running', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 0 } }
  ] : [
    { id: 'coord', workspace: '/core-service', title: 'Task Dispatcher Agent', status: 'running', stats: { outboundCalls: 4, inboundCalls: 2, postsCount: 1 } },
    { id: 'arch', workspace: '/core-service', title: 'Architecture Review Agent', status: 'idle', stats: { outboundCalls: 1, inboundCalls: 2, postsCount: 1 } },
    { id: 'sec', workspace: '/core-service', title: 'Security Audit Agent', status: 'idle', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 0 } },
    { id: 'etl', workspace: '/data-pipeline', title: 'Data Pipeline Agent', status: 'running', stats: { outboundCalls: 2, inboundCalls: 1, postsCount: 0 } },
    { id: 'eval', workspace: '/data-pipeline', title: 'Metrics Evaluation Agent', status: 'idle', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 1 } },
    { id: 'ui', workspace: '/web-client', title: 'UI Construction Agent', status: 'running', stats: { outboundCalls: 0, inboundCalls: 1, postsCount: 0 } }
  ];

  const posts = [
    { id: 'post-1', topic: 'metric:benchmark', status: 'active', ttlRemainingMs: 58 * 60 * 1000, authorSessionId: 'eval' },
    { id: 'post-2', topic: 'release:gate-audit', status: 'active', ttlRemainingMs: 55 * 60 * 1000, authorSessionId: 'coord' },
    { id: 'post-3', topic: 'spec:schema-v2', status: 'active', ttlRemainingMs: 45 * 60 * 1000, authorSessionId: 'arch' }
  ];

  const calls = [
    { id: 'c1', callerSessionId: 'coord', targetSessionId: 'arch', timestamp: Date.now() - 5000, status: 'active', callType: 'task_dispatch' },
    { id: 'c2', callerSessionId: 'arch', targetSessionId: 'coord', timestamp: Date.now() - 10000, status: 'active', callType: 'task_report' },
    { id: 'c3', callerSessionId: 'coord', targetSessionId: 'etl', timestamp: Date.now() - 15000, status: 'active', callType: 'task_dispatch' },
    { id: 'c4', callerSessionId: 'etl', targetSessionId: 'ui', timestamp: Date.now() - 20000, status: 'active', callType: 'task_dispatch' },
    { id: 'c5', callerSessionId: 'coord', targetSessionId: 'sec', timestamp: Date.now() - 25000, status: 'active', callType: 'notice' }
  ];

  const telemetry = {
    timestamp: Date.now(),
    currentWorkspace: '/core-service',
    workspaces: [
      { id: '/core-service', name: 'core-service', isCurrent: true, sessionIds: ['coord', 'arch', 'sec'] },
      { id: '/data-pipeline', name: 'data-pipeline', isCurrent: false, sessionIds: ['etl', 'eval'] },
      { id: '/web-client', name: 'web-client', isCurrent: false, sessionIds: ['ui'] }
    ],
    sessions,
    posts,
    calls,
    metrics: {
      runningSessions: 3,
      totalSessions: 6,
      activeCalls: 5,
      totalPosts: 3
    }
  };

  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${FIGURE_SIZE.width}, height=${FIGURE_SIZE.height}, initial-scale=1">
<title>dsh-call-session Canvas Demo (${locale})</title>
<style>
${fontFaceCss()}* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${FIGURE_SIZE.width}px;
  height: ${FIGURE_SIZE.height}px;
  overflow: hidden;
  background: #ffffff;
  font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
#root {
  width: ${FIGURE_SIZE.width}px;
  height: ${FIGURE_SIZE.height}px;
  position: relative;
  display: flex;
  flex-direction: column;
}
.dsh-canvas-container text,
.dsh-canvas-toolbar,
.dsh-canvas-btn,
button {
  font-family: 'Noto Sans SC', sans-serif !important;
}
</style>
<script src="${scriptPath('react.production.min.js')}"></script>
<script src="${scriptPath('react-dom.production.min.js')}"></script>
</head>
<body>
<div id="root"></div>

<script>
window.__ModuleLoader__ = {
  load: function(payload) {
    window.__dsh_plugin__ = payload.factory(function(m) {
      if (m === 'react') return window.React;
      return null;
    });
  }
};
</script>
<script src="${clientJsPath}"></script>

<script>
const telemetry = ${JSON.stringify(telemetry)};
const plugin = window.__dsh_plugin__;
plugin.ensureStyles();

const dict = plugin.${locale};
const t = function(key) {
  return (dict && dict[key]) || key;
};

const CanvasView = plugin.CanvasView;
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(React.createElement(CanvasView, {
  sessionId: 'coord',
  edgeMode: 'full',
  t: t,
  fetchTelemetry: function() {
    return Promise.resolve(telemetry);
  }
}));
</script>
</body>
</html>`;
}

export async function renderAllDemos() {
  await ensureCache(FONT_DIR, FONT_SOURCES);
  await ensureCache(SCRATCH_DIR, SCRIPTS);

  return renderFigures(['en', 'zh'].map((locale) => ({
    name: 'render-' + locale,
    html: buildHtml(locale),
    out: path.join(rootDir, 'assets', locale === 'en' ? 'canvas-demo.png' : 'canvas-demo-zh.png'),
    size: FIGURE_SIZE
  })));
}

if (process.argv[1] && process.argv[1].endsWith('render-canvas-demo.mjs')) {
  renderAllDemos().then((paths) => {
    console.log('[render] Successfully rendered bilingual demos:', paths);
  }).catch((err) => {
    console.error('[render] Error:', err);
    process.exit(1);
  });
}
