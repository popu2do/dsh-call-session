#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Runs on `npm install` inside a clone. Consumers installing the published
// tarball have neither .githooks nor a git dir, so this is a silent no-op there.
if (!fs.existsSync('.githooks')) process.exit(0);

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
console.log('hooks: core.hooksPath -> .githooks');
