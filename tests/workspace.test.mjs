import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspace, isSameWorkspace } from '../lib/workspace.mjs';

test('normalizeWorkspace: 基础路径规约、Windows 盘符小写与末尾斜杠去除', () => {
  assert.equal(normalizeWorkspace(''), '');
  assert.equal(normalizeWorkspace(null), '');
  assert.equal(normalizeWorkspace(undefined), '');
  assert.equal(normalizeWorkspace('   '), '');
  assert.equal(normalizeWorkspace('C:\\Users\\dev\\project\\'), 'c:/Users/dev/project');
  assert.equal(normalizeWorkspace('/var/project/'), '/var/project');
  assert.equal(normalizeWorkspace('/var/project///'), '/var/project');
  assert.equal(normalizeWorkspace('d:\\work\\repo'), 'd:/work/repo');
});

test('isSameWorkspace: 工作区等价性判定', () => {
  assert.equal(isSameWorkspace('/var/repo', '/var/repo/'), true);
  assert.equal(isSameWorkspace('C:\\Repo\\app', 'c:/Repo/app/'), true);
  assert.equal(isSameWorkspace('/var/repo', '/var/other'), false);
  assert.equal(isSameWorkspace('', '/var/repo'), false);
  assert.equal(isSameWorkspace(null, null), false);
});
