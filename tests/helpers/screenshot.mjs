/**
 * tests/helpers/screenshot.mjs
 *
 * Shared plumbing for the deterministic figure renderers: the cache that keeps
 * a checkout from going online twice, and the single headless capture call.
 * Both figures go through here, so a browser flag, a font source or the cache
 * layout changes in one place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

export const SCRATCH_DIR = path.join(rootDir, '.scratch');
export const FONT_DIR = path.join(SCRATCH_DIR, 'fonts');

const FONT_FILES = {
  regular: 'noto-sans-sc-400.woff2',
  medium: 'noto-sans-sc-500.woff2'
};

const FONT_PATHS = {
  regular: path.join(FONT_DIR, FONT_FILES.regular),
  medium: path.join(FONT_DIR, FONT_FILES.medium)
};

// Both figures ship at the canvas size fixed by ADR-0023 and ADR-0026, so the
// README keeps one visual cadence. The test asserts against this same constant.
export const FIGURE_SIZE = { width: 1440, height: 840 };

/** The CJK face declarations both figures embed. */
export function fontFaceCss() {
  return "@font-face { font-family: 'Noto Sans SC'; font-weight: 400; src: url('file://" + FONT_PATHS.regular + "') format('woff2'); }\n" +
    "@font-face { font-family: 'Noto Sans SC'; font-weight: 500; src: url('file://" + FONT_PATHS.medium + "') format('woff2'); }\n";
}

/** The CJK faces both figures need, keyed by file name. */
export const FONT_SOURCES = {
  [FONT_FILES.regular]:
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.19/files/noto-sans-sc-chinese-simplified-400-normal.woff2',
  [FONT_FILES.medium]:
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.0.19/files/noto-sans-sc-chinese-simplified-500-normal.woff2'
};

/**
 * Populates a cache directory with the files a figure needs. An entry already
 * on disk is left alone, so a warm checkout never goes online.
 */
export async function ensureCache(cacheDir, sources) {
  fs.mkdirSync(cacheDir, { recursive: true });

  for (const [name, source] of Object.entries(sources)) {
    const target = path.join(cacheDir, name);
    if (fs.existsSync(target)) continue;

    const res = await fetch(source);
    if (!res.ok) throw new Error('download failed for ' + name + ': HTTP ' + res.status);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  }
}

/**
 * Writes each figure's HTML into the scratch directory and screenshots it to
 * its asset path. A browser that reports success without leaving a file behind
 * is treated as a failure here, not three steps later.
 */
export function renderFigures(figures) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });

  return figures.map((figure) => {
    const htmlPath = path.join(SCRATCH_DIR, figure.name + '.html');
    fs.writeFileSync(htmlPath, figure.html, 'utf8');

    execFileSync('chromium', [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=' + figure.size.width + ',' + figure.size.height,
      '--virtual-time-budget=2000',
      '--screenshot=' + figure.out,
      'file://' + htmlPath
    ], { stdio: 'pipe' });

    if (!fs.existsSync(figure.out)) {
      throw new Error('Failed to create screenshot at ' + figure.out);
    }

    return figure.out;
  });
}
