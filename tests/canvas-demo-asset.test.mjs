import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('Visual Asset Integrity: assets/canvas-demo.png and canvas-demo-zh.png conform to ADR-0023/ADR-0026', () => {
  const screenshotsJsonPath = path.join(rootDir, 'screenshots.json');
  const screenshots = JSON.parse(fs.readFileSync(screenshotsJsonPath, 'utf8'));

  const files = [
    { file: 'assets/canvas-demo.png', desc: 'English canvas screenshot' },
    { file: 'assets/canvas-demo-zh.png', desc: 'Chinese canvas screenshot' }
  ];

  for (const item of files) {
    const assetPath = path.join(rootDir, item.file);
    assert.ok(fs.existsSync(assetPath), `${item.file} must exist`);
    assert.ok(screenshots.includes(item.file), `screenshots.json must include ${item.file}`);

    const stat = fs.statSync(assetPath);
    assert.ok(stat.size > 50000, `${item.file} size must be greater than 50KB`);

    // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
    const fd = fs.openSync(assetPath, 'r');
    const buffer = Buffer.alloc(24);
    fs.readSync(fd, buffer, 0, 24, 0);
    fs.closeSync(fd);

    assert.equal(buffer[0], 0x89, 'PNG signature byte 0 must be 0x89');
    assert.equal(buffer[1], 0x50, 'PNG signature byte 1 must be 0x50');
    assert.equal(buffer[2], 0x4e, 'PNG signature byte 2 must be 0x4e');
    assert.equal(buffer[3], 0x47, 'PNG signature byte 3 must be 0x47');

    // IHDR width and height (bytes 16-23)
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    assert.equal(width, 1440, `${item.file} width must be 1440`);
    assert.equal(height, 840, `${item.file} height must be 840`);
  }

  // Verify documentation alignment (ADR-0023 bilingual parity)
  const readmeEn = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  assert.ok(readmeEn.includes('./assets/canvas-demo.png'), 'README.md must reference assets/canvas-demo.png');

  const readmeZh = fs.readFileSync(path.join(rootDir, 'README_ZH.md'), 'utf8');
  assert.ok(readmeZh.includes('./assets/canvas-demo-zh.png'), 'README_ZH.md must reference assets/canvas-demo-zh.png');
});
