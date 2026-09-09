import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Discover all *.test.mjs in tests/ directory and execute in-process
const entries = await fs.readdir(__dirname);
const testFiles = entries
  .filter(f => f.endsWith('.test.mjs'))
  .sort();

for (const file of testFiles) {
  const fullPath = path.join(__dirname, file);
  await import(pathToFileURL(fullPath).href);
}
