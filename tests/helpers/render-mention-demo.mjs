/**
 * tests/helpers/render-mention-demo.mjs
 *
 * Deterministic headless renderer for the bilingual @ mention demos:
 * - assets/mention-demo.png (English)
 * - assets/mention-demo-zh.png (Chinese)
 *
 * The figure walks one gesture end to end: pick a workspace, pick a session,
 * and watch the title appear inside the composer as a reference chip.
 *
 * Layout is authored at a 960-wide base and scaled by ZOOM, so the text stays
 * legible when a README renders the figure at roughly 800px.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureCache, FIGURE_SIZE, FONT_DIR, FONT_SOURCES, SCRATCH_DIR, fontFaceCss, renderFigures } from './screenshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

// Authored at a 960-wide base and scaled up, so text stays legible when the
// README renders the figure at roughly 800px.
export const VIEWPORT = { ...FIGURE_SIZE, zoom: 1.5 };

const WORKSPACES = [
  { name: 'dsh-call-session', current: true },
  { name: 'dsh-agent-cluster', current: false }
];

// The picked candidate is the first row. Its title is the single source for the
// composer chip, so the two can never drift apart.
const PICKED_INDEX = 0;

const STATUS_LABELS = {
  zh: { running: '运行中', idle: '就绪', error: '异常' },
  en: { running: 'Running', idle: 'Idle', error: 'Error' }
};

// Identity and state are locale-independent; only the titles differ, so the two
// locales cannot drift on short id or tone.
const CANDIDATES = [
  { shortId: '#a3f9c2e1', tone: 'running', zh: '架构评审智能体', en: 'Architecture Review Agent' },
  { shortId: '#7b21d0f4', tone: 'idle', zh: '契约校验智能体', en: 'Contract Checking Agent' },
  { shortId: '#c48e15ba', tone: 'idle', zh: '发布核对智能体', en: 'Release Audit Agent' },
  { shortId: '#2d70aa93', tone: 'error', zh: '依赖整理智能体', en: 'Dependency Agent' },
  { shortId: '#58b6ee07', tone: 'idle', zh: '回归巡查智能体', en: 'Regression Patrol Agent' }
];

// The plugin-owned level-1 section word (ADR-0034): copy shared by every
// figure so the rendered menus cannot drift from the shipped dictionary.
const SECTION_WORKSPACES = { zh: '工作区', en: 'Workspaces' };

const COPY = {
  zh: {
    sectionWorkspaces: SECTION_WORKSPACES.zh,
    current: '当前',
    pathRoot: '工作区根目录',
    workspaceLabel: 'dsh-call-session',
    composerLead: '把改后的契约交给',
    composerTail: '再核一遍。'
  },
  en: {
    sectionWorkspaces: SECTION_WORKSPACES.en,
    current: 'Current',
    pathRoot: 'Workspace Root',
    workspaceLabel: 'dsh-call-session',
    composerLead: 'Hand the revised contract to',
    composerTail: 'for another pass.'
  }
};

const FOLDER_ACTIVE = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#2563eb" stroke-width="1.4"><path d="M1.5 4.2c0-.6.5-1.1 1.1-1.1h3l1.3 1.5h5.6c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z"/></svg>';
const FOLDER_MUTED = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#64748b" stroke-width="1.4"><path d="M1.5 4.2c0-.6.5-1.1 1.1-1.1h3l1.3 1.5h5.6c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z"/></svg>';
const CHAT_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#475569" stroke-width="1.4"><path d="M2 4.3c0-.7.6-1.3 1.3-1.3h9.4c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3H6.6L3.5 13.2V11h-.2c-.7 0-1.3-.6-1.3-1.3z"/></svg>';
const SEND_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="#ffffff" stroke-width="1.5"><path d="M2.4 8h11.2M9 3.4L13.6 8 9 12.6"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#cbd5e1" stroke-width="1.6"><path d="M4 12h15M14 7l5 5-5 5"/></svg>';

/**
 * The candidate rows as data. Both the markup and the test read this, so the
 * status label and the picked flag are derived in exactly one place.
 */
function sessionRows(locale, candidates = CANDIDATES, pickedIndex = PICKED_INDEX) {
  const statusLabels = STATUS_LABELS[locale];
  return candidates.map((candidate, index) => ({
    title: candidate[locale],
    shortId: candidate.shortId,
    tone: candidate.tone,
    status: statusLabels[candidate.tone],
    picked: index === pickedIndex
  }));
}

/**
 * The figure as data. Tests read this instead of the markup, so a style change
 * does not look like a content regression and a content change cannot hide
 * behind a class name.
 */
export function figureModel(locale) {
  const copy = COPY[locale];
  const sessions = sessionRows(locale);
  const picked = sessions.find((session) => session.picked);

  return {
    workspaces: WORKSPACES.map((ws) => ({ name: ws.name, current: ws.current })),
    sessions,
    pickedTitle: picked.title,
    pathRoot: copy.pathRoot,
    composerLead: copy.composerLead,
    composerTail: copy.composerTail
  };
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function workspaceColumn(copy, workspaces) {
  const rows = workspaces.map((ws) => {
    const sub = ws.current
      ? '<span class="row-sub">' + esc(copy.current) + '</span>'
      : '<span class="row-sub row-sub-empty">&nbsp;</span>';
    return '<div class="menu-row">' +
      '<span class="row-icon">' + (ws.current ? FOLDER_ACTIVE : FOLDER_MUTED) + '</span>' +
      '<span class="row-main"><span class="row-title">' + esc(ws.name) + '</span>' + sub + '</span>' +
      '</div>';
  }).join('');
  return '<section class="panel panel-menu">' +
    '<header class="panel-head">' + esc(copy.sectionWorkspaces) + '</header>' +
    '<div class="menu-body">' + rows + '</div>' +
    '</section>';
}

function sessionColumn(copy, rows) {
  const cells = rows.map((session) => {
    const picked = session.picked ? ' is-picked' : '';
    return '<div class="menu-row session-row' + picked + '">' +
      '<span class="row-icon">' + CHAT_ICON + '</span>' +
      '<span class="row-main">' +
        '<span class="row-title">' + esc(session.title) + '</span>' +
        '<span class="row-sub"><i class="dot dot-' + session.tone + '"></i>' + esc(session.status) + '</span>' +
      '</span>' +
      '<span class="row-badge">' + esc(session.shortId) + '</span>' +
      '</div>';
  }).join('');
  return '<section class="panel panel-menu panel-menu-wide">' +
    '<header class="panel-head path-header">' +
      '<span class="path-root">' + esc(copy.pathRoot) + '</span>' +
      '<span class="path-sep">/</span>' +
      '<span class="path-current">' + esc(copy.workspaceLabel) + '</span>' +
    '</header>' +
    '<div class="menu-body">' + cells + '</div>' +
    '</section>';
}

function composerColumn(locale) {
  const copy = COPY[locale];
  const pickedTitle = sessionRows(locale).find((session) => session.picked).title;
  return '<section class="panel panel-composer">' +
    '<div class="composer">' +
      '<div class="composer-line">' +
        '<span class="composer-text">' + esc(copy.composerLead) + '</span>' +
        '<span class="chip">' + CHAT_ICON + '<span class="chip-label">' + esc(pickedTitle) + '</span></span>' +
        '<span class="composer-text">' + esc(copy.composerTail) + '</span>' +
      '</div>' +
      '<div class="composer-foot">' +
        '<span class="composer-send">' + SEND_ICON + '</span>' +
      '</div>' +
    '</div>' +
    '</section>';
}

/** The shared visual chrome both figures embed; a style edit lands in one place. */
function figureCss(config) {
  const baseWidth = config.width / config.zoom;
  const baseHeight = config.height / config.zoom;
  return '* { box-sizing: border-box; margin: 0; padding: 0; }\n' +
'html, body { width: ' + config.width + 'px; height: ' + config.height + 'px; overflow: hidden; background: #f8fafc;' +
" font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;" +
' -webkit-font-smoothing: antialiased; }\n' +
'.stage { width: ' + baseWidth + 'px; height: ' + baseHeight + 'px; zoom: ' + config.zoom + ';' +
' display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 24px; }\n' +
'.panel { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px;' +
' box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.05); }\n' +
'.panel-menu { width: 218px; overflow: hidden; }\n' +
'.panel-menu-wide { width: 314px; }\n' +
'.panel-composer { width: 356px; padding: 16px 16px 14px; }\n' +
'.panel-head { height: 34px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #eef2f7;' +
' font-size: 10px; font-weight: 500; letter-spacing: .05em; text-transform: uppercase; color: #526074; }\n' +
'.path-header { text-transform: none; letter-spacing: 0; font-size: 10.5px; gap: 5px; }\n' +
'.path-root { color: #526074; }\n.path-sep { color: #526074; }\n' +
'.path-current { color: #334155; font-weight: 500; }\n' +
'.menu-body { padding: 5px; }\n' +
'.menu-row { display: flex; align-items: center; gap: 8px; padding: 8px 8px; border-radius: 7px; }\n' +
'.session-row + .session-row { border-top: 1px solid #f1f5f9; border-radius: 0; }\n' +
'.session-row.is-picked { background: #eff6ff; box-shadow: inset 0 0 0 1px #bfdbfe; border-radius: 7px; border-top-color: transparent; }\n' +
'.row-icon { display: flex; align-items: center; justify-content: center; width: 16px; flex: none; }\n' +
'.row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }\n' +
'.row-title { font-size: 11.5px; color: #1e293b; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
'.row-sub { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #526074; line-height: 1.2; }\n' +
'.row-sub-empty { visibility: hidden; }\n' +
'.dot { width: 5px; height: 5px; border-radius: 50%; flex: none; display: inline-block; }\n' +
'.dot-running { background: #10b981; }\n.dot-idle { background: #64748b; }\n.dot-error { background: #ef4444; }\n' +
'.row-badge { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5px; color: #526074;' +
' background: #f1f5f9; border-radius: 4px; padding: 2px 5px; flex: none; }\n' +
'.session-row.is-picked .row-badge { background: #dbeafe; color: #1d4ed8; }\n' +
'.gap-arrow { display: flex; align-items: center; justify-content: center; flex: none; width: 18px; }\n' +
'.composer { border: 1px solid #e2e8f0; border-radius: 9px; background: #fbfdff; padding: 12px 12px 10px; }\n' +
'.composer-line { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-height: 24px; }\n' +
'.composer-text { font-size: 11.5px; color: #334155; line-height: 1.5; }\n' +
'.chip { display: inline-flex; align-items: center; gap: 5px; background: #dbeafe; border: 1px solid #bfdbfe;' +
' border-radius: 6px; padding: 3px 7px; }\n' +
'.chip svg { stroke: #1d4ed8; width: 13px; height: 13px; }\n' +
'.chip-label { font-size: 11px; color: #1d4ed8; font-weight: 500; line-height: 1.4; }\n' +
'.composer-foot { display: flex; align-items: center; justify-content: flex-end; margin-top: 14px; padding-top: 10px;' +
' border-top: 1px solid #eef2f7; }\n' +
'.composer-send { width: 26px; height: 26px; border-radius: 7px; background: #2563eb; display: flex; align-items: center;' +
' justify-content: center; }\n' +
'.composer-send svg { width: 14px; height: 14px; }\n' +
'.row-icon svg { width: 14px; height: 14px; }\n'
}

export function buildHtml(locale, viewport) {
  const config = viewport || VIEWPORT;
  return '<!DOCTYPE html>\n' +
'<html lang="' + (locale === 'zh' ? 'zh-CN' : 'en') + '">\n' +
'<head>\n<meta charset="utf-8">\n' +
'<title>dsh-call-session Mention Demo (' + locale + ')</title>\n' +
'<style>\n' +
fontFaceCss() +
figureCss(config) +
'</style>\n</head>\n<body>\n<div class="stage">\n' +
workspaceColumn(COPY[locale], WORKSPACES) + '\n<div class="gap-arrow">' + ARROW + '</div>\n' +
sessionColumn(COPY[locale], sessionRows(locale)) + '\n<div class="gap-arrow">' + ARROW + '</div>\n' +
composerColumn(locale) +
'\n</div>\n</body>\n</html>';
}

export async function renderMentionDemos() {
  await ensureCache(FONT_DIR, FONT_SOURCES);

  return renderFigures(['en', 'zh'].map((locale) => ({
    name: 'mention-' + locale,
    html: buildHtml(locale, VIEWPORT),
    out: path.join(rootDir, 'assets', locale === 'en' ? 'mention-demo.png' : 'mention-demo-zh.png'),
    size: VIEWPORT
  })));
}

if (process.argv[1] && process.argv[1].endsWith('render-mention-demo.mjs')) {
  const job = process.argv[2] === 'archived' ? renderArchivedDemos() : renderMentionDemos();
  job
    .then((paths) => console.log('[render] mention demos:', paths))
    .catch((err) => {
      console.error('[render] Error:', err);
      process.exit(1);
    });
}

/**
 * Archived-filter evidence figure backing the ADR-0034 contract. Same three-panel
 * cadence as the gesture demo, but the menu shows the post-013 state: the
 * section carries the plugin-owned plain word, rostered archived
 * sessions and the dead workspace appear in the model yet never in the
 * markup, so tests can assert the exclusion against the scenario data.
 * Copy and live rows derive from the shared gesture constants, so the two
 * figures cannot drift on locale strings or row identity.
 */

// Workspaces the menu keeps: the current one and one live peer. The dead
// workspace owns only roster-archived sessions, so aggregation drops it.
const ARCHIVED_WORKSPACES = [
  { name: 'dsh-call-session', current: true },
  { name: 'dsh-agent-cluster', current: false }
];
const DEAD_WORKSPACES = [{ name: 'dsh-archive-bin', current: false }];

// The drilled level-2 panel renders only live sessions drawn from the shared
// candidate rows; the archived rows carry ids the native workspaces roster
// holds, which is why they stay out of the candidates.
const ARCHIVED_LIVE = [CANDIDATES[0], CANDIDATES[1], CANDIDATES[4]];
const ARCHIVED_ROSTERED = [
  { id: 'session-archived-1', shortId: '#9f01ce4d', tone: 'idle', zh: '历史归档会话', en: 'Archived History Session' },
  { id: 'session-archived-2', shortId: '#4b7a10e6', tone: 'idle', zh: '名单归档会话', en: 'Rostered Archive Session' }
];
const ARCHIVED_ROSTER = ARCHIVED_ROSTERED.map((session) => session.id);

/**
 * The archived-filter figure as data; tests assert exclusion against these
 * scenario rows instead of parsing pixels.
 */
export function archivedFigureModel(locale) {
  const copy = COPY[locale];
  const sessions = sessionRows(locale, ARCHIVED_LIVE, 0);
  const archived = ARCHIVED_ROSTERED.map((session) => ({
    id: session.id,
    title: session[locale],
    shortId: session.shortId
  }));
  return {
    sectionWorkspaces: copy.sectionWorkspaces,
    workspaces: ARCHIVED_WORKSPACES.map((ws) => ({ name: ws.name, current: ws.current })),
    deadWorkspaces: DEAD_WORKSPACES.map((ws) => ({ name: ws.name })),
    roster: ARCHIVED_ROSTER.slice(),
    sessions,
    archivedSessions: archived,
    pickedTitle: sessions[0].title,
    pathRoot: copy.pathRoot
  };
}

function archivedComposerColumn(locale) {
  const pickedTitle = sessionRows(locale, ARCHIVED_LIVE, 0)[0].title;
  return '<section class="panel panel-composer">' +
    '<div class="composer">' +
      '<div class="composer-line">' +
        '<span class="chip">' + CHAT_ICON + '<span class="chip-label">' + esc(pickedTitle) + '</span></span>' +
      '</div>' +
    '</div>' +
    '</section>';
}

export function buildArchivedHtml(locale, viewport) {
  const config = viewport || VIEWPORT;
  return '<!DOCTYPE html>\n' +
'<html lang="' + (locale === 'zh' ? 'zh-CN' : 'en') + '">\n' +
'<head>\n<meta charset="utf-8">\n' +
'<title>dsh-call-session Mention Archived Demo (' + locale + ')</title>\n' +
'<style>\n' +
fontFaceCss() +
figureCss(config) +
'</style>\n</head>\n<body>\n<div class="stage">\n' +
workspaceColumn(COPY[locale], ARCHIVED_WORKSPACES) + '\n<div class="gap-arrow">' + ARROW + '</div>\n' +
sessionColumn(COPY[locale], sessionRows(locale, ARCHIVED_LIVE, 0)) + '\n<div class="gap-arrow">' + ARROW + '</div>\n' +
archivedComposerColumn(locale) +
'\n</div>\n</body>\n</html>';
}

/**
 * Renders the archived-filter evidence figures into the scratch directory.
 * They are review references for the live-machine check, not shipped README
 * figures, so they stay out of assets/ and the screenshot manifest.
 */
export async function renderArchivedDemos() {
  await ensureCache(FONT_DIR, FONT_SOURCES);

  return renderFigures(['en', 'zh'].map((locale) => ({
    name: 'mention-archived-' + locale,
    html: buildArchivedHtml(locale, VIEWPORT),
    out: path.join(SCRATCH_DIR, locale === 'en' ? 'mention-archived-demo-en.png' : 'mention-archived-demo-zh.png'),
    size: VIEWPORT
  })));
}
