/**
 * Mention Demo Contract: the bilingual @ mention figures, their manifest
 * registration and the documentation that carries them.
 *
 * Covers the figure geometry, the manifest pairing, the README binding, the
 * showcase section shape, and whether the rendered markup depicts the gesture.
 * Existence, PNG signature and byte budget belong to the shared asset gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHtml, VIEWPORT, figureModel } from './helpers/render-mention-demo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const SHORT_ID = /^#[0-9a-f]{8}$/;

const FIGURES = [
  { locale: 'en', asset: 'assets/mention-demo.png', readme: 'README.md', heading: '## Mention' },
  { locale: 'zh', asset: 'assets/mention-demo-zh.png', readme: 'README_ZH.md', heading: '## 会话引用' }
];

const CANVAS_FIGURE = { en: './assets/canvas-demo.png', zh: './assets/canvas-demo-zh.png' };

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function lines(text) {
  return text.split(/\r?\n/);
}

function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function pngSize(relPath) {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(path.join(rootDir, relPath), 'r');
  try {
    fs.readSync(fd, header, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

test('mention figures: both match the canvas figure geometry, so the README keeps one cadence', () => {
  const canvasSize = pngSize(CANVAS_FIGURE.en.replace('./', ''));

  assert.deepEqual(
    { width: VIEWPORT.width, height: VIEWPORT.height },
    canvasSize,
    'the mention figure must be authored at the same size as the canvas figure (contract: figure geometry)'
  );

  for (const figure of FIGURES) {
    assert.deepEqual(
      pngSize(figure.asset),
      canvasSize,
      figure.asset + ' must ship at the canvas figure size (contract: figure geometry)'
    );
  }
});

test('mention figures: both are registered in the screenshot manifest', () => {
  const manifest = JSON.parse(readText('screenshots.json'));
  assert.ok(Array.isArray(manifest), 'screenshots.json must hold an array of asset paths (contract: figure manifest)');

  for (const figure of FIGURES) {
    assert.ok(
      manifest.includes(figure.asset),
      'screenshots.json must list ' + figure.asset + ' (contract: figure manifest)'
    );
  }

});

test('mention figure content: two workspaces, five candidates with short IDs and statuses, one picked', () => {
  for (const figure of FIGURES) {
    const model = figureModel(figure.locale);

    assert.equal(model.workspaces.length, 2, figure.locale + ' figure must show exactly two workspaces (contract: figure content)');
    assert.equal(
      model.workspaces.filter((w) => w.current).length,
      1,
      figure.locale + ' figure must mark exactly one workspace as current (contract: figure content)'
    );

    assert.equal(model.sessions.length, 5, figure.locale + ' figure must show five candidates (contract: figure content)');

    for (const session of model.sessions) {
      assert.match(
        session.shortId,
        SHORT_ID,
        figure.locale + ' figure candidates must carry a # plus 8 lowercase hex characters, found ' + session.shortId +
          ' (contract: figure content)'
      );
      assert.ok(session.title.length > 0, figure.locale + ' figure candidates must have a title (contract: figure content)');
      assert.ok(session.status.length > 0, figure.locale + ' figure candidates must show a status (contract: figure content)');
    }

    assert.equal(
      model.sessions.filter((s) => s.picked).length,
      1,
      figure.locale + ' figure must mark exactly one candidate as picked (contract: figure content)'
    );
  }
});

test('mention figure markup: the picked title appears in the composer as well as the candidate list', () => {
  for (const figure of FIGURES) {
    const html = buildHtml(figure.locale, VIEWPORT);
    const model = figureModel(figure.locale);

    assert.ok(html.includes(model.pathRoot), figure.locale + ' figure must name the workspace path root (contract: figure content)');

    for (const workspace of model.workspaces) {
      assert.ok(html.includes(workspace.name), figure.locale + ' figure must name workspace ' + workspace.name + ' (contract: figure content)');
    }

    for (const session of model.sessions) {
      assert.ok(html.includes(session.title), figure.locale + ' figure must name candidate ' + session.title + ' (contract: figure content)');
      assert.ok(html.includes(session.shortId), figure.locale + ' figure must show short ID ' + session.shortId + ' (contract: figure content)');
      assert.ok(html.includes(session.status), figure.locale + ' figure must show the status of ' + session.title + ' (contract: figure content)');
    }

    // The picked title appears in both the candidate list and the composer, so
    // this assertion pins the composer occurrence.
    assert.equal(
      countOf(html, 'chip-label">' + model.pickedTitle + '</span>'),
      1,
      figure.locale + ' figure must draw the picked title as exactly one reference chip (contract: figure content)'
    );

    assert.ok(html.includes(model.composerLead), figure.locale + ' figure composer must carry its lead-in text (contract: figure content)');
    assert.ok(html.includes(model.composerTail), figure.locale + ' figure composer must carry its trailing text (contract: figure content)');
  }
});

test('mention documentation: each README shows its own language figure, after the canvas', () => {
  for (const figure of FIGURES) {
    const all = lines(readText(figure.readme));

    const headingLine = all.findIndex((line) => line.trim() === figure.heading);
    assert.ok(headingLine >= 0, figure.readme + ' must contain the "' + figure.heading + '" section (contract: mention showcase)');

    const figureLine = all.findIndex((line) => line.includes(figure.asset));
    assert.ok(figureLine >= 0, figure.readme + ' must reference ' + figure.asset + ' (contract: bilingual figure binding)');
    assert.ok(
      figureLine > headingLine,
      figure.readme + ' must place its mention figure inside the showcase section (contract: mention showcase)'
    );

    const canvasLine = all.findIndex((line) => line.includes(CANVAS_FIGURE[figure.locale]));
    assert.ok(canvasLine >= 0, figure.readme + ' must keep referencing ' + CANVAS_FIGURE[figure.locale] + ' (contract: canvas showcase preserved)');
    assert.ok(
      canvasLine < headingLine,
      figure.readme + ' must keep the canvas showcase ahead of the mention showcase (contract: showcase cadence)'
    );
  }
});

test('mention documentation: both READMEs point at the same feature with the same structure', () => {
  const en = readText('README.md');
  const zh = readText('README_ZH.md');

  // The two files use different heading depths by existing convention, so
  // parity is asserted on presence, not on a hardcoded level.
  const mentionsReference = (text) =>
    lines(text).some((line) => /^#{3,4}\s+/.test(line) && /Reference Session|引用会话/.test(line));

  assert.equal(
    mentionsReference(en),
    mentionsReference(zh),
    'both READMEs must carry a reference-session scenario, or neither (contract: bilingual parity)'
  );
  assert.ok(mentionsReference(en), 'README.md must document the reference-session scenario (contract: scenario coverage)');
});

test('mention documentation: the showcase section is one sentence and at most two bullets, like the canvas one', () => {
  for (const figure of FIGURES) {
    const all = lines(readText(figure.readme));
    const start = all.findIndex((line) => line.trim() === figure.heading);
    assert.ok(start >= 0, figure.readme + ' must carry the ' + figure.heading + ' section (contract: mention showcase)');

    const section = [];
    for (const line of all.slice(start + 1)) {
      if (/^##\s+/.test(line)) break;
      section.push(line);
    }

    const prose = section.filter(
      (line) => line.trim() && line.trim() !== '---' && !/^<\/?p|^<img/.test(line.trim())
    );
    const bullets = prose.filter((line) => /^-\s+/.test(line.trim()));
    const sentences = prose.filter((line) => !/^-\s+/.test(line.trim()));

    assert.equal(
      sentences.length,
      1,
      figure.readme + ' showcase must open with exactly one sentence, found ' + sentences.length +
        ' (contract: mention showcase)'
    );
    assert.equal(
      bullets.length,
      2,
      figure.readme + ' showcase must carry exactly two bullets, found ' + bullets.length +
        ' (contract: mention showcase)'
    );
  }
});

test('mention documentation: the scenario shows the @ path and the plain-language alternative', () => {
  for (const figure of FIGURES) {
    const all = lines(readText(figure.readme));
    const sectionStart = all.findIndex((line) => /^#{3,4}\s+/.test(line) && /Reference Session|引用会话/.test(line));
    assert.ok(sectionStart >= 0, figure.readme + ' must carry the reference-session scenario (contract: scenario coverage)');

    const rest = all.slice(sectionStart + 1).join('\n');
    const sectionEnd = rest.search(/\n#{2,4}\s/);
    const section = sectionEnd >= 0 ? rest.slice(0, sectionEnd) : rest;

    assert.ok(section.includes('@'), figure.readme + ' reference scenario must show the @ path (contract: scenario coverage)');
    assert.ok(
      /Ask the|让\S*智能体/.test(section),
      figure.readme + ' reference scenario must also show the plain-language alternative to @ (contract: scenario coverage)'
    );
  }
});
