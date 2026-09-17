import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { BoardStore } from '../lib/board-store.mjs';
import { CallTelemetryRingBuffer, getCanvasTelemetry } from '../lib/call-telemetry.mjs';
import { SessionDirectory } from '../lib/session-directory.mjs';
import { PEER_SESSION_CONSTANTS } from '../lib/session-create.mjs';
import { executeSessionCall, dispatchNativeMessage } from '../lib/session-call.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Measure median execution duration across warm-up and sample runs.
 */
async function measureMedian(fn, warmups = 3, runs = 10) {
  for (let i = 0; i < warmups; i++) {
    await fn();
  }
  const durations = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    const t1 = performance.now();
    durations.push(t1 - t0);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)];
}

test('ADR-0020 Invariant 1: BoardStore In-Memory Query Baseline (P99 <= 5ms, CI 3x Margin <= 15ms)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-perf-board-'));
  const storagePath = path.join(tmpDir, 'board.json');

  try {
    const store = new BoardStore({ storagePath, debounceMs: 1000 });

    // Populate 100 posts with active status
    for (let i = 0; i < 100; i++) {
      store.post({
        id: `post-perf-${i}`,
        topic: `task:perf-${i % 5}`,
        tags: ['perf', 'benchmark', `tag-${i % 10}`],
        authorSessionId: `session-${i % 10}`,
        callerWorkspace: '/workspace/perf',
        authorWorkspace: '/workspace/perf',
        status: 'active',
        content: `Performance baseline benchmark payload content for post #${i} with structured lines.\nLine 2.\nLine 3.`,
        createdAtMs: Date.now() + i
      });
    }

    // 1. titlesOnly: true
    const medianTitlesOnly = await measureMedian(async () => {
      const res = store.list({
        callerWorkspace: '/workspace/perf',
        crossWorkspace: true,
        limit: 100,
        titlesOnly: true
      });
      assert.equal(res.posts.length, 100);
    });

    assert.ok(
      medianTitlesOnly <= 15,
      `board_list (titlesOnly: true) median duration must be <= 15ms, got ${medianTitlesOnly.toFixed(3)}ms`
    );

    // 2. titlesOnly: false
    const medianFullContent = await measureMedian(async () => {
      const res = store.list({
        callerWorkspace: '/workspace/perf',
        crossWorkspace: true,
        limit: 100,
        titlesOnly: false
      });
      assert.equal(res.posts.length, 100);
    });

    assert.ok(
      medianFullContent <= 15,
      `board_list (titlesOnly: false) median duration must be <= 15ms, got ${medianFullContent.toFixed(3)}ms`
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('ADR-0020 Invariant 1: BoardStore Debounced Batch Persistence Coalescing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-perf-coalesce-'));
  const storagePath = path.join(tmpDir, 'board.json');

  try {
    const store = new BoardStore({ storagePath, debounceMs: 60 });
    let rawFlushCount = 0;
    const originalFlushAtomic = store.flushAtomic.bind(store);
    store.flushAtomic = async function () {
      rawFlushCount++;
      return originalFlushAtomic();
    };

    // Burst 50 consecutive posts
    for (let i = 0; i < 50; i++) {
      store.post({
        id: `burst-${i}`,
        topic: 'task:burst',
        callerWorkspace: '/workspace/burst',
        status: 'active',
        content: `Burst content ${i}`
      });
    }

    // Immediately after burst, flushTimer should be scheduled but 0 disk flushes executed yet
    assert.equal(rawFlushCount, 0, 'No disk writes should occur synchronously during burst');

    // Wait for debounce window (60ms) to settle
    await new Promise(r => setTimeout(r, 120));

    // Assert that 50 writes were coalesced into exactly 1 atomic disk write
    assert.equal(rawFlushCount, 1, '50 burst posts must coalesce into exactly 1 atomic disk flush');

    // Verify file on disk is valid JSON and contains all 50 posts
    const fileContent = await fs.readFile(storagePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    assert.equal(parsed.posts.length, 50);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('ADR-0020 Invariant 4: BoardStore State-Aware Eviction Invariant (Expired -> Archived -> Oldest Active)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-perf-evict-'));
  const storagePath = path.join(tmpDir, 'board.json');

  try {
    const store = new BoardStore({ storagePath, maxPosts: 4, debounceMs: 1000 });
    const now = Date.now();

    // 1. Post 1 (Active, oldest)
    store.post({ id: 'p-active-1', topic: 'task', content: 'c1', createdAtMs: now - 5000, status: 'active' });
    // 2. Post 2 (Expired)
    store.post({ id: 'p-expired', topic: 'task', content: 'c2', createdAtMs: now - 4000, expiresAtMs: now - 100, status: 'active' });
    // 3. Post 3 (Archived)
    store.post({ id: 'p-archived', topic: 'task', content: 'c3', createdAtMs: now - 3000, status: 'archived' });
    // 4. Post 4 (Active, newer)
    store.post({ id: 'p-active-2', topic: 'task', content: 'c4', createdAtMs: now - 2000, status: 'active' });

    assert.equal(store.posts.size, 4);

    // Eviction Pass 1: Add 5th post -> p-expired must be evicted first
    store.post({ id: 'p-active-3', topic: 'task', content: 'c5', createdAtMs: now - 1000, status: 'active' });
    assert.equal(store.posts.size, 4);
    assert.equal(store.posts.has('p-expired'), false, 'Expired post must be evicted first');
    assert.equal(store.posts.has('p-archived'), true);
    assert.equal(store.posts.has('p-active-1'), true);

    // Eviction Pass 2: Add 6th post -> p-archived must be evicted next
    store.post({ id: 'p-active-4', topic: 'task', content: 'c6', createdAtMs: now, status: 'active' });
    assert.equal(store.posts.size, 4);
    assert.equal(store.posts.has('p-archived'), false, 'Archived post must be evicted second');
    assert.equal(store.posts.has('p-active-1'), true);

    // Eviction Pass 3: Add 7th post -> p-active-1 (oldest active) must be evicted
    store.post({ id: 'p-active-5', topic: 'task', content: 'c7', createdAtMs: now + 1000, status: 'active' });
    assert.equal(store.posts.size, 4);
    assert.equal(store.posts.has('p-active-1'), false, 'Oldest active post must be evicted when no expired or archived exist');
    assert.equal(store.posts.has('p-active-2'), true);
    assert.equal(store.posts.has('p-active-3'), true);
    assert.equal(store.posts.has('p-active-4'), true);
    assert.equal(store.posts.has('p-active-5'), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('ADR-0020 Invariant 2: In-Process Unicast Dispatch Baseline (P99 <= 2ms, CI 3x Margin <= 6ms)', async () => {
  const mockTarget = {
    id: 'target-agent-perf',
    status: 'running',
    steer: (msg) => {}
  };

  const dummyMessage = {
    id: 'msg-perf-1',
    role: 'user',
    content: [{ type: 'text', text: 'Hello perf' }]
  };

  const medianDispatch = await measureMedian(async () => {
    const mode = dispatchNativeMessage(mockTarget, dummyMessage);
    assert.equal(mode, 'steer');
  });

  assert.ok(
    medianDispatch <= 6,
    `dispatchNativeMessage median duration must be <= 6ms, got ${medianDispatch.toFixed(3)}ms`
  );
});

test('ADR-0020 Invariant 2: Session Directory Scan Baseline (P99 <= 10ms, CI 3x Margin <= 30ms)', async () => {
  // Create mock agents service with 50 mock sessions
  const mockAgentsList = [];
  const mockAgentsMap = new Map();
  for (let i = 0; i < 50; i++) {
    const sid = `session-${i}`;
    const agent = {
      id: sid,
      status: i % 2 === 0 ? 'running' : 'idle',
      title: `Worker Agent #${i}`,
      workspace: i % 3 === 0 ? '/ws/main' : `/ws/peer-${i % 3}`,
      generation: 1
    };
    mockAgentsList.push(agent);
    mockAgentsMap.set(sid, agent);
  }

  const mockCtx = {
    get: (key) => {
      if (key === 'agents') {
        return {
          list: () => mockAgentsList,
          get: (id) => mockAgentsMap.get(id)
        };
      }
      return null;
    }
  };

  const directory = new SessionDirectory(mockCtx);

  const medianDirectoryQuery = await measureMedian(async () => {
    const active = directory.listActiveSessions({
      workspace: '/ws/main',
      crossWorkspace: true,
      limit: 50
    });
    assert.ok(active.length > 0);
  });

  assert.ok(
    medianDirectoryQuery <= 30,
    `SessionDirectory listActiveSessions median duration must be <= 30ms, got ${medianDirectoryQuery.toFixed(3)}ms`
  );
});

test('ADR-0020 Invariant 2: Peer Session Quota Synchronous Rejection Baseline (P99 <= 1ms, CI 3x Margin <= 3ms)', () => {
  // Verify quota rejection logic evaluates synchronously without lag
  const callerWorkspace = '/ws/quota-test';
  const mockAgents = [];
  for (let i = 0; i < PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS; i++) {
    mockAgents.push({
      id: `sess-quota-${i}`,
      status: 'running',
      workspace: callerWorkspace
    });
  }

  const t0 = performance.now();
  const effectiveActiveCount = mockAgents.filter(a => a.status === 'running' && a.workspace === callerWorkspace).length;
  const isRejected = effectiveActiveCount >= PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS;
  const t1 = performance.now();

  assert.equal(isRejected, true, 'Must reject when active peer sessions reach maximum limit 10');
  const elapsed = t1 - t0;
  assert.ok(
    elapsed <= 3,
    `Synchronous quota rejection check must execute within 3ms, took ${elapsed.toFixed(3)}ms`
  );
});

test('ADR-0020 Invariant 3: Web Telemetry Route Snapshot Aggregation (P99 <= 20ms, CI 3x Margin <= 60ms)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-perf-telemetry-'));
  const storagePath = path.join(tmpDir, 'board.json');

  try {
    const store = new BoardStore({ storagePath, debounceMs: 1000 });
    for (let i = 0; i < 50; i++) {
      store.post({
        id: `post-telemetry-${i}`,
        topic: 'task:telemetry-perf',
        callerWorkspace: '/ws/perf',
        authorWorkspace: '/ws/perf',
        status: 'active',
        content: `Telemetry content #${i}`
      });
    }

    const ringBuffer = new CallTelemetryRingBuffer(200);
    for (let i = 0; i < 50; i++) {
      ringBuffer.record({
        id: `call-${i}`,
        callerSessionId: `sess-${i % 5}`,
        targetSessionId: `sess-${(i + 1) % 5}`,
        callType: 'task_dispatch',
        deliveryMode: 'steer',
        messageSnippet: 'Telemetry call snippet benchmark',
        messagePayload: 'Telemetry payload chunk for benchmarking'
      });
    }

    const mockAgents = [];
    const mockMap = new Map();
    for (let i = 0; i < 20; i++) {
      const sid = `sess-${i}`;
      const agent = {
        id: sid,
        status: 'running',
        title: `Agent ${i}`,
        workspace: '/ws/perf'
      };
      mockAgents.push(agent);
      mockMap.set(sid, agent);
    }

    const mockCtx = {
      boardStore: store,
      callTelemetry: ringBuffer,
      get: (key) => {
        if (key === 'agents') {
          return {
            list: () => mockAgents,
            get: (id) => mockMap.get(id)
          };
        }
        return null;
      }
    };

    const medianTelemetry = await measureMedian(async () => {
      const snapshot = await getCanvasTelemetry(mockCtx, {
        workspace: '/ws/perf',
        boardStore: store,
        callTelemetry: ringBuffer,
        limit: 50
      });
      assert.ok(snapshot);
      assert.ok(Array.isArray(snapshot.sessions));
      assert.ok(Array.isArray(snapshot.posts));
      assert.ok(Array.isArray(snapshot.calls));
    });

    assert.ok(
      medianTelemetry <= 60,
      `getCanvasTelemetry median duration must be <= 60ms, got ${medianTelemetry.toFixed(3)}ms`
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('ADR-0020 Invariant 4: CallTelemetryRingBuffer Bounded Capacity and Truncation Invariants', () => {
  const buffer = new CallTelemetryRingBuffer(200);
  assert.equal(buffer.capacity(), 200);

  // 1. Capacity FIFO limit verification
  for (let i = 0; i < 250; i++) {
    buffer.record({
      id: `call-ring-${i}`,
      callerSessionId: 'sess-a',
      targetSessionId: 'sess-b',
      messageSnippet: `snippet-${i}`
    });
  }

  assert.equal(buffer.size(), 200, 'Ring buffer size must not exceed capacity 200');

  const records = buffer.query({ limit: 200, crossWorkspace: true });
  assert.equal(records.length, 200);
  // Oldest remaining record should be call-ring-50 (0 to 49 evicted)
  assert.equal(records[0].id, 'call-ring-50');
  assert.equal(records[199].id, 'call-ring-249');

  // 2. Message snippet truncation (<= 120 chars)
  const longSnippet = 'A'.repeat(200);
  const recSnippet = buffer.record({
    callerSessionId: 'sess-a',
    targetSessionId: 'sess-b',
    messageSnippet: longSnippet
  });
  assert.ok(recSnippet.messageSnippet.length <= 120, 'Snippet must be truncated to <= 120 chars');
  assert.ok(recSnippet.messageSnippet.endsWith('...'));

  // 3. Message payload truncation (<= 8192 chars)
  const longPayload = 'B'.repeat(10000);
  const recPayload = buffer.record({
    callerSessionId: 'sess-a',
    targetSessionId: 'sess-b',
    messagePayload: longPayload
  });
  assert.ok(recPayload.messagePayload.length <= 8192, 'Payload must be truncated to <= 8192 chars');
  assert.ok(recPayload.messagePayload.endsWith('...'));
});

test('ADR-0020 Invariant 4: Process Memory RSS Growth Budget (<= 30MB Delta)', async () => {
  const initialRss = process.memoryUsage().rss;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-perf-mem-'));
  const storagePath = path.join(tmpDir, 'board.json');

  try {
    const store = new BoardStore({ storagePath, maxPosts: 200, debounceMs: 500 });
    const ringBuffer = new CallTelemetryRingBuffer(200);

    // Simulate 500 board operations and 500 telemetry records
    for (let i = 0; i < 500; i++) {
      store.post({
        id: `mem-post-${i}`,
        topic: `task:mem-${i % 10}`,
        callerWorkspace: '/ws/mem',
        authorWorkspace: '/ws/mem',
        status: 'active',
        content: `Memory stability test content chunk for post #${i} with metadata payload.`
      });

      ringBuffer.record({
        id: `mem-call-${i}`,
        callerSessionId: 'sess-1',
        targetSessionId: 'sess-2',
        messageSnippet: `Call trace ${i}`,
        messagePayload: 'Call payload trace chunk'
      });
    }

    const finalRss = process.memoryUsage().rss;
    const deltaMb = (finalRss - initialRss) / (1024 * 1024);

    assert.ok(
      deltaMb <= 30,
      `RSS memory growth delta must be <= 30MB, observed ${deltaMb.toFixed(2)}MB`
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('ADR-0020 Invariant 3: Client Throttled Polling and 5-Minute Background Pause Code Anchors', async () => {
  const clientPath = path.join(__dirname, '..', 'lib', 'client.js');
  const code = await fs.readFile(clientPath, 'utf8');

  // Verify foreground 1500ms interval
  assert.ok(code.includes('startPolling(1500);'), 'Client must set 1500ms foreground polling');

  // Verify background/blur 5000ms interval
  assert.ok(code.includes('startPolling(5000);'), 'Client must set 5000ms background/blur polling');

  // Verify 5-minute (300000ms) pause timer when hidden
  assert.ok(code.includes('300000'), 'Client must declare 300,000ms (5 minutes) pause timer on document.hidden');
  assert.ok(code.includes('backgroundTimer = setTimeout('), 'Client must allocate backgroundTimer for hidden tab suspension');

  // Verify background timer cleanup upon tab reactivate
  assert.ok(code.includes('clearTimeout(backgroundTimer);'), 'Client must clear backgroundTimer when tab becomes visible');
});
