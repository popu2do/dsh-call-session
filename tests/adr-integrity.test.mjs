/**
 * Architecture Decision Records (ADRs) Static Integrity & Verification Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const adrsDir = path.join(repoRoot, 'docs', 'adrs');
const readmePath = path.join(adrsDir, 'README.md');

let cachedAdrFiles = null;
let cachedFileContents = null;

async function getAdrFiles() {
  if (!cachedAdrFiles) {
    const entries = await fs.readdir(adrsDir);
    cachedAdrFiles = entries.filter(f => /^\d{4}-.*\.md$/.test(f)).sort();
  }
  return cachedAdrFiles;
}

async function getFileContents() {
  if (!cachedFileContents) {
    const files = await getAdrFiles();
    cachedFileContents = new Map();
    for (const file of files) {
      const text = await fs.readFile(path.join(adrsDir, file), 'utf8');
      cachedFileContents.set(file, text);
    }
  }
  return cachedFileContents;
}

test('ADR 目录完整性：全部 ADR 文件存在且编号连续无断层', async () => {
  const adrFiles = await getAdrFiles();
  assert.ok(adrFiles.length >= 30, 'ADR 数量应至少为 30 篇');

  for (let i = 1; i <= adrFiles.length; i++) {
    const prefix = String(i).padStart(4, '0');
    const matched = adrFiles.find(f => f.startsWith(prefix));
    assert.ok(matched, `ADR 编号 ${prefix} 必须存在且连续`);
  }
});

test('ADR 索引一致性：README.md 目录矩阵与物理磁盘文件 1:1 双向对齐', async () => {
  const adrFiles = await getAdrFiles();
  const readme = await fs.readFile(readmePath, 'utf8');

  for (const file of adrFiles) {
    assert.ok(
      readme.includes(file),
      `README.md 索引必须包含物理文件引用：${file}`
    );
  }

  const linkMatches = Array.from(readme.matchAll(/\[(.*?)\]\(\.\/(\d{4}-[^)]+\.md)\)/g));
  assert.ok(linkMatches.length >= 30, 'README 中引用的 ADR 链接应不少于 30 个');
  for (const match of linkMatches) {
    const linkedFile = match[2];
    assert.ok(
      adrFiles.includes(linkedFile),
      `README 中引用的文件必须存在于 docs/adrs/：${linkedFile}`
    );
  }
});

test('ADR 结构规范性：每篇 ADR 均包含标准 H1 标题、Status 字段、Context 与 Decision 核心段落', async () => {
  const contents = await getFileContents();

  for (const [file, content] of contents.entries()) {
    const lines = content.split('\n');

    const h1 = lines.find(l => /^#\s+ADR-\d{4}:\s+.+/.test(l.trim()));
    assert.ok(h1, `${file} 必须包含合法的 H1 标题`);

    const statusLine = lines.find(l => /^-\s+\*\*Status\*\*:\s+.+/.test(l.trim()));
    assert.ok(statusLine, `${file} 必须包含 Status 字段`);
    assert.ok(
      /Accepted|Proposed|Deprecated|Superseded/i.test(statusLine),
      `${file} Status 必须包含规范状态值：${statusLine}`
    );

    const hasContext = lines.some(l => /^##+\s+.*(Context|背景)/i.test(l.trim()));
    assert.ok(hasContext, `${file} 必须包含 Context 或背景段落`);

    const hasDecision = lines.some(l => /^##+\s+.*(Decision|Invariants|Outcome|决策|支柱)/i.test(l.trim()));
    assert.ok(hasDecision, `${file} 必须包含 Decision 或 Invariants 核心决策段落`);
  }
});

test('ADR 替代关系有效性：标记为 Superseded 的记录必须包含有效后继 ADR 目标', async () => {
  const adrFiles = await getAdrFiles();
  const contents = await getFileContents();

  for (const [file, content] of contents.entries()) {
    const statusLine = content.split('\n').find(l => /^-\s+\*\*Status\*\*:\s+.+/.test(l.trim())) || '';

    if (/superseded.*ADR-(\d{4})/i.test(statusLine)) {
      const targetMatches = Array.from(statusLine.matchAll(/ADR-(\d{4})/gi));
      for (const m of targetMatches) {
        const targetId = m[1];
        if (file.startsWith(targetId)) continue;
        const targetExists = adrFiles.some(f => f.startsWith(targetId));
        assert.ok(
          targetExists,
          `${file} 中的替代目标 ADR-${targetId} 必须存在于 docs/adrs/ 目录中`
        );
      }
    }
  }
});
