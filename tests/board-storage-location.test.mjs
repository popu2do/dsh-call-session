/**
 * ADR-0035: the blackboard lives under the harness home and survives upgrades.
 *
 * Covers the default path, the environment precedence, and the one-time copy of
 * a blackboard left behind in the plugin directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BoardStore,
  defaultStoragePath,
  migrateLegacyStorage,
  resolveDshHome
} from '../lib/board-store.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-storage-'));
}

function seeded(id) {
  return {
    posts: [{
      id,
      topic: 'storage:location',
      content: 'seeded',
      tags: [],
      authorSessionId: 's1',
      authorTitle: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      status: 'active',
      scope: 'workspace',
      metadata: {}
    }]
  };
}

test('默认存储位置在 harness home 下的数据目录', () => {
  assert.equal(
    defaultStoragePath({}),
    path.join(os.homedir(), '.dsh', 'dsh-call-session', 'board.json'),
    '无覆盖时默认路径必须是 ~/.dsh/dsh-call-session/board.json'
  );
});

test('DSH_HOME 覆盖默认 home，空白值视为未设置', () => {
  const override = path.join(os.tmpdir(), 'dsh-home-override');
  assert.equal(
    defaultStoragePath({ DSH_HOME: override }),
    path.join(override, 'dsh-call-session', 'board.json'),
    'DSH_HOME 必须覆盖默认 home'
  );
  assert.equal(
    defaultStoragePath({ DSH_HOME: '   ' }),
    path.join(os.homedir(), '.dsh', 'dsh-call-session', 'board.json'),
    '空白的 DSH_HOME 必须视为未设置，不得退化为工作目录'
  );
  assert.equal(resolveDshHome({}), path.join(os.homedir(), '.dsh'), '无覆盖时 home 必须是 ~/.dsh');
  assert.equal(resolveDshHome({ DSH_HOME: '~/nested' }), path.join(os.homedir(), 'nested'), '波浪号必须展开为 home');
});

test('缺省构造的实例使用默认路径', async () => {
  const homeRoot = await tempDir();
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = homeRoot;
  try {
    const store = new BoardStore({ logger: silent });
    assert.equal(store.storagePath, defaultStoragePath(), '缺省实例必须使用默认存储路径');
    assert.ok(store.storagePath.startsWith(homeRoot + path.sep), '缺省实例必须落在 harness home 内');
    await store.close();
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});

test('首次启动把旧黑板搬到新位置，且不删除旧文件', async () => {
  const legacyRoot = await tempDir();
  const homeRoot = await tempDir();
  const legacyPath = path.join(legacyRoot, 'board.json');
  writeFileSync(legacyPath, JSON.stringify(seeded('post-legacy')), 'utf8');
  writeFileSync(`${legacyPath}.bak`, JSON.stringify(seeded('post-legacy')), 'utf8');

  const targetPath = path.join(homeRoot, 'dsh-call-session', 'board.json');
  assert.equal(migrateLegacyStorage(legacyPath, targetPath), true, '迁移必须报告已执行');

  assert.ok(existsSync(targetPath), '迁移后新位置必须存在黑板文件');
  assert.ok(existsSync(`${targetPath}.bak`), '旧备份必须一并搬到新位置');
  assert.ok(existsSync(legacyPath), '迁移不得删除旧文件，回滚仍需可用');
  assert.equal(
    JSON.parse(await fs.readFile(targetPath, 'utf8')).posts[0].id,
    'post-legacy',
    '迁移必须带上原有条目'
  );

  const store = new BoardStore({ storagePath: targetPath, logger: silent });
  assert.ok(store.posts.has('post-legacy'), '迁移后内存中必须已有旧条目');
  await store.close();
});

test('仅有旧备份时也迁移，不静默初始化为空', async () => {
  const legacyRoot = await tempDir();
  const homeRoot = await tempDir();
  const legacyPath = path.join(legacyRoot, 'board.json');
  writeFileSync(`${legacyPath}.bak`, JSON.stringify(seeded('post-from-backup')), 'utf8');

  const targetPath = path.join(homeRoot, 'dsh-call-session', 'board.json');
  assert.equal(migrateLegacyStorage(legacyPath, targetPath), true, '仅存备份时也必须迁移');
  assert.equal(
    JSON.parse(await fs.readFile(targetPath, 'utf8')).posts[0].id,
    'post-from-backup',
    '旧备份中的条目必须被结转'
  );
});

test('新位置已有文件时不覆盖', async () => {
  const legacyRoot = await tempDir();
  const homeRoot = await tempDir();
  const legacyPath = path.join(legacyRoot, 'board.json');
  const targetPath = path.join(homeRoot, 'board.json');
  writeFileSync(legacyPath, JSON.stringify(seeded('post-legacy')), 'utf8');
  writeFileSync(targetPath, JSON.stringify(seeded('post-current')), 'utf8');

  assert.equal(migrateLegacyStorage(legacyPath, targetPath), false, '目标已存在时不得迁移');
  assert.equal(
    JSON.parse(await fs.readFile(targetPath, 'utf8')).posts[0].id,
    'post-current',
    '目标文件必须保持原样，不得被旧数据覆盖'
  );
});
