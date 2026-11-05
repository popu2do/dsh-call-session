import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_TYPES,
  resolveCallType,
  sanitizeContextPostIds,
  buildNativeUserMessage
} from '../lib/native-message-transport.mjs';
import { executeSessionCall } from '../lib/session-call.mjs';
import { CallTelemetryRingBuffer } from '../lib/call-telemetry.mjs';
import { createMockAgent, silentLogger } from './helpers/mock-agent.mjs';

// The guard assertions here encode what a live host accepts; the crash that motivated
// them is recorded in docs/agents/evidence/0020-turn-stopping.md.

function callCtx(agents, telemetry = new CallTelemetryRingBuffer(20)) {
  const agentsService = {
    list: () => agents,
    get: (id) => agents.find((a) => a.id === id) || null
  };
  return {
    get: (k) => (k === 'agents' ? agentsService : k === 'callTelemetry' ? telemetry : null),
    logger: () => silentLogger
  };
}

test('Boundary Exploration: 1. call_type input validation & edge cases', async () => {
  // 1.1 Canonical types are strictly these four; the array order is not part of the contract
  assert.deepEqual([...CALL_TYPES].sort(), ['notice', 'task_hard', 'task_report', 'task_soft']);

  // 1.2 Uppercase variants must be rejected (case-sensitive)
  for (const invalidType of ['TASK_HARD', 'Task_Soft', 'Notice', 'TASK_REPORT']) {
    assert.throws(
      () => resolveCallType(invalidType, 'test'),
      /\[InvalidParameter\] test: invalid call_type/
    );
  }

  // 1.3 Whitespace padded strings must be rejected
  for (const paddedType of [' task_hard', 'task_soft ', ' notice\n', '\ttask_report']) {
    assert.throws(
      () => resolveCallType(paddedType, 'test'),
      /\[InvalidParameter\] test: invalid call_type/
    );
  }

  // 1.4 Non-existent or legacy types must be rejected
  for (const legacy of ['task_dispatch', 'dispatch', 'sync', 'ping', 'query', 'task']) {
    assert.throws(
      () => resolveCallType(legacy, 'session_call'),
      (err) => err.message.includes(`invalid call_type "${legacy}"`)
    );
  }

  // 1.5 Non-string values
  for (const nonStr of [null, undefined, 123, true, {}, []]) {
    assert.throws(
      () => resolveCallType(nonStr, 'test'),
      /\[InvalidParameter\]/
    );
  }
});

test('Boundary Exploration: 2. Message length and content boundaries', async () => {
  const caller = createMockAgent({ id: 'session-caller-0001', status: 'idle' });
  const target = createMockAgent({ id: 'session-target-0002', status: 'idle' });
  const ledger = new CallTelemetryRingBuffer(20);
  const ctx = callCtx([caller, target], ledger);

  // 2.1 Empty and whitespace-only message rejection
  for (const emptyMsg of ['', '   ', '\t\n\r  ']) {
    await assert.rejects(
      async () => executeSessionCall(ctx, { target_session_id: target.id, message: emptyMsg }, { agent: caller }),
      /\[InvalidParameter\] session_call: non-empty message parameter is required\./
    );
  }

  // 2.2 Exactly 4000 characters is allowed
  const exact4000 = 'a'.repeat(4000);
  const res4000 = await executeSessionCall(
    ctx,
    { target_session_id: target.id, message: exact4000, call_type: 'notice' },
    { agent: caller }
  );
  assert.equal(res4000.success, true);

  // 2.2a A notice carries no obligation: the ledger must stay empty (T-D 4)
  assert.deepEqual(ledger.getPendingTasksForSession(target.id), [], 'notice never enqueues');

  // 2.2b The obligation lands only after the message actually left (T-D 1)
  const hardResult = await executeSessionCall(
    ctx,
    { target_session_id: target.id, message: 'do the thing', call_type: 'task_hard' },
    { agent: caller }
  );
  assert.equal(hardResult.success, true);
  assert.equal(ledger.getPendingTasksForSession(target.id).length, 1, 'a delivered task_hard enqueues exactly one obligation');

  // 2.2c A dispatch that blows up enqueues nothing: the obligation is written by the
  // onDispatched callback, so a throw before delivery must leave the ledger untouched
  const flaky = createMockAgent({
    id: 'session-target-flaky',
    status: 'idle',
    followupFn: () => { throw new Error('dispatch exploded'); }
  });
  const flakyCtx = callCtx([caller, flaky], ledger);
  const before = ledger.getPendingTasksForSession(flaky.id).length;
  const flakyResult = await executeSessionCall(
    flakyCtx,
    { target_session_id: flaky.id, message: 'never lands', call_type: 'task_hard' },
    { agent: caller }
  );
  assert.equal(flakyResult.success, false, 'a failed dispatch is reported as a failure');
  assert.equal(
    ledger.getPendingTasksForSession(flaky.id).length,
    before,
    'a failed dispatch must not enqueue an obligation'
  );

  // 2.3 4001 characters must be rejected
  const overflow4001 = 'a'.repeat(4001);
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: target.id, message: overflow4001 }, { agent: caller }),
    /\[InvalidParameter\] session_call: message exceeds maximum length of 4000 characters\./
  );
});

test('Boundary Exploration: 3. Target session identification & forbidden targets', async () => {
  const caller = createMockAgent({ id: 'session-caller-0001', status: 'idle' });
  const targetA = createMockAgent({ id: 'session-target-aaaa-1111', status: 'idle' });
  const targetB = createMockAgent({ id: 'session-target-aaaa-2222', status: 'idle' });
  const ctx = callCtx([caller, targetA, targetB]);

  // 3.1 Self-call forbidden (exact and prefix)
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: caller.id, message: 'ping' }, { agent: caller }),
    /\[SelfCallForbidden\] session_call: cannot call self session ID\./
  );
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: 'session-caller', message: 'ping' }, { agent: caller }),
    /\[SelfCallForbidden\] session_call: cannot call self session ID\./
  );

  // 3.2 Wildcards forbidden
  for (const wildcard of ['*', 'all', '@all', '@everyone', 'broadcast']) {
    await assert.rejects(
      async () => executeSessionCall(ctx, { target_session_id: wildcard, message: 'ping' }, { agent: caller }),
      /\[WildcardForbidden\] session_call: wildcard targets/
    );
  }

  // 3.3 Short prefix (< 8 chars) forbidden
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: 'sess', message: 'ping' }, { agent: caller }),
    /\[InvalidParameter\] session_call: prefix "sess" must be at least 8 characters\./
  );

  // 3.4 Ambiguous prefix matching multiple live sessions
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: 'session-target-aaaa', message: 'ping' }, { agent: caller }),
    /\[AmbiguousPrefix\] session_call: prefix "session-target-aaaa" matches multiple live sessions/
  );

  // 3.5 Target not found
  await assert.rejects(
    async () => executeSessionCall(ctx, { target_session_id: 'session-nonexistent-9999', message: 'ping' }, { agent: caller }),
    /\[TargetNotFound\] session_call: live session matching "session-nonexistent-9999" not found/
  );
});

test('Boundary Exploration: 4. Context Post IDs sanitization & deduplication', async () => {
  // 4.1 Stripping hash prefix, trimming, dropping blanks and de-duplicating in first-seen order.
  // The non-array tolerance cases live in tests/native-message-transport.test.mjs.
  const rawList = ['#post-001', 'post-002', '  #post-003  ', '#post-001', null, undefined, '', '   '];
  const sanitized = sanitizeContextPostIds(rawList);
  assert.deepEqual(sanitized, ['post-001', 'post-002', 'post-003']);
});

// Settlement is global FIFO guarded by the caller↔target pair: a report settles the oldest
// obligation between those two sessions, never one owed to somebody else (ADR-0042 账本 2).
test('Boundary Exploration: 5. Ledger FIFO settlement underflow & cross-session isolation', async () => {
  const buffer = new CallTelemetryRingBuffer(20);
  const targetId = 'session-worker-1';
  const callerA = 'session-caller-A';
  const callerB = 'session-caller-B';

  // 5.1 Underflow safety: a report with nothing owed does not crash, leaves a trace,
  // and must not touch an obligation that belongs to somebody else (T-D 3)
  assert.equal(buffer.getPendingTasksForSession(targetId).length, 0);
  buffer.record({
    callerSessionId: callerB,
    targetSessionId: targetId,
    callType: 'task_hard',
    messagePayload: 'Unrelated work'
  });
  buffer.record({
    callerSessionId: targetId,
    targetSessionId: callerA,
    callType: 'task_report',
    messagePayload: 'Unmatched report'
  });
  const survivor = buffer.getPendingTasksForSession(targetId);
  assert.equal(survivor.length, 1, 'an unmatched report damages no other entry');
  assert.equal(survivor[0].callerSessionId, callerB);
  assert.equal(buffer.lastUnmatchedReport.callerSessionId, targetId);
  assert.equal(buffer.lastUnmatchedReport.targetSessionId, callerA);

  // 5.2 Cross-session isolation: Caller A and Caller B both dispatch tasks to Worker
  buffer.cleanupSession(targetId, 'purge');
  buffer.record({
    callerSessionId: callerA,
    targetSessionId: targetId,
    callType: 'task_hard',
    messagePayload: 'Task 1 from A'
  });
  buffer.record({
    callerSessionId: callerB,
    targetSessionId: targetId,
    callType: 'task_soft',
    messagePayload: 'Task 1 from B'
  });
  buffer.record({
    callerSessionId: callerA,
    targetSessionId: targetId,
    callType: 'task_soft',
    messagePayload: 'Task 2 from A'
  });

  // Total pending on worker is 3
  const pendingBefore = buffer.getPendingTasksForSession(targetId);
  assert.equal(pendingBefore.length, 3);
  assert.equal(pendingBefore[0].callerSessionId, callerA);
  assert.equal(pendingBefore[0].callType, 'task_hard');
  assert.equal(pendingBefore[1].callerSessionId, callerB);
  assert.equal(pendingBefore[1].callType, 'task_soft');
  assert.equal(pendingBefore[2].callerSessionId, callerA);
  assert.equal(pendingBefore[2].callType, 'task_soft');

  // Worker reports to Caller A: ONLY Caller A's oldest task (Task 1, task_hard) is settled
  buffer.record({
    callerSessionId: targetId,
    targetSessionId: callerA,
    callType: 'task_report',
    messagePayload: 'Report to A'
  });
  const pendingAfterA = buffer.getPendingTasksForSession(targetId);
  assert.equal(pendingAfterA.length, 2);
  // Caller B's task is untouched at index 0
  assert.equal(pendingAfterA[0].callerSessionId, callerB);
  assert.equal(pendingAfterA[0].callType, 'task_soft');
  // Caller A's second task is now at index 1
  assert.equal(pendingAfterA[1].callerSessionId, callerA);
  assert.equal(pendingAfterA[1].callType, 'task_soft');

  // Worker reports to Caller B: Caller B's task is settled
  buffer.record({
    callerSessionId: targetId,
    targetSessionId: callerB,
    callType: 'task_report',
    messagePayload: 'Report to B'
  });
  const pendingAfterB = buffer.getPendingTasksForSession(targetId);
  assert.equal(pendingAfterB.length, 1);
  assert.equal(pendingAfterB[0].callerSessionId, callerA);

  // Worker reports again to Caller A: Caller A's last task is settled
  buffer.record({
    callerSessionId: targetId,
    targetSessionId: callerA,
    callType: 'task_report',
    messagePayload: 'Second report to A'
  });
  assert.equal(buffer.getPendingTasksForSession(targetId).length, 0);

  // 5.3 Extra report to Caller A when empty: safe underflow, records lastUnmatchedReport
  buffer.record({
    callerSessionId: targetId,
    targetSessionId: callerA,
    callType: 'task_report',
    messagePayload: 'Third report to A'
  });
  assert.equal(buffer.getPendingTasksForSession(targetId).length, 0);
  assert.equal(buffer.lastUnmatchedReport.callerSessionId, targetId);
});

test('Boundary Exploration: 6. Turn-stopping guard budget, turn reset & abort signal', async () => {
  const { createTurnStoppingGuard } = await import('../lib/turn-stopping-guard.mjs');
  const buffer = new CallTelemetryRingBuffer(20);
  const workerSessionId = 'session-worker-guard';
  const callerId = 'session-caller-guard';

  // Seed a pending task_hard
  buffer.record({
    callerSessionId: callerId,
    targetSessionId: workerSessionId,
    callType: 'task_hard',
    messagePayload: 'Critical task requiring report'
  });

  // 不覆盖 steer：默认替身会校验载荷是不是宿主能接收的原生 UserMessage，
  // 一旦守卫退化成投递字符串，这里直接抛错而不是默默计数（见 docs/agents/evidence/0020-turn-stopping.md）。
  const workerAgent = createMockAgent({ id: workerSessionId, status: 'running' });
  const steered = () => workerAgent.received.filter((r) => r.method === 'steer');

  const guard = createTurnStoppingGuard({
    getPendingTasksForSession: (id) => buffer.getPendingTasksForSession(id),
    buildReminder: (tasks) => `Reminder: you have ${tasks.length} pending hard task(s). Please invoke session_call(call_type='task_report') to report results.`,
    buildUserMessage: (text, agent) => buildNativeUserMessage({
      rawMessage: text,
      form: 'notice',
      callerSessionId: callerId,
      callerTitle: 'Guard Caller',
      callType: 'notice'
    }),
    logger: silentLogger
  });

  // 6.1 Turn 1: 3 chasers allowed
  for (let i = 1; i <= 3; i++) {
    await guard.hookListener({ agent: workerAgent, turn: 1, signal: { aborted: false } });
    assert.equal(steered().length, i, `Chaser ${i} should be steered`);
  }

  // 载荷必须与宿主接收的形状一致：原生 UserMessage，报头标 notice 而不是任务类型，
  // 否则守卫会给自己造出新的强制待办（自激循环）
  const samplePayload = steered()[0].msg;
  assert.equal(samplePayload.role, 'user');
  assert.equal(samplePayload.source.kind, 'plugin:dsh-call-session');
  // 报头既要点名发件方，也必须是 notice 而不是任务类型
  assert.match(
    samplePayload.content[0].text,
    /^\[From: session-caller-guard \(Guard Caller\) \| CallType: notice\]/,
    '报头点名发件方，不能是被催会话自己；类型是 notice 才不会自激'
  );

  // 4th chaser in turn 1 must be skipped (exhausted budget = 3)
  await guard.hookListener({ agent: workerAgent, turn: 1, signal: { aborted: false } });
  assert.equal(steered().length, 3, 'Exceeded budget must not steer 4th reminder');

  // 6.2 A fresh turn gets a full budget again
  await guard.hookListener({ agent: workerAgent, turn: 2, signal: { aborted: false } });
  assert.equal(steered().length, 4, 'Turn 2 should allow new steer');

  // 6.3 Aborted turn: skipped while the budget is still untouched, so a later
  // healthy turn in the same session still gets all three chases
  for (let i = 0; i < 3; i++) {
    await guard.hookListener({ agent: workerAgent, turn: 3, signal: { aborted: true } });
  }
  assert.equal(steered().length, 4, 'Aborted turn must not chase');
  for (let i = 1; i <= 3; i++) {
    await guard.hookListener({ agent: workerAgent, turn: 4, signal: { aborted: false } });
    assert.equal(steered().length, 4 + i, `Turn 4 chase ${i} proves the aborted turn spent no budget`);
  }

  // 6.4 Settling the task_hard: a brand-new turn stays quiet because nothing is owed.
  // Turn 5 has never chased, so the silence cannot be explained by an exhausted budget.
  buffer.record({
    callerSessionId: workerSessionId,
    targetSessionId: callerId,
    callType: 'task_report',
    messagePayload: 'Finished'
  });
  await guard.hookListener({ agent: workerAgent, turn: 5, signal: { aborted: false } });
  assert.equal(steered().length, 7, 'Settled task must not trigger chaser');
});

test('Boundary Exploration: 7. Session cleanup modes: settle vs purge', async () => {
  const buffer = new CallTelemetryRingBuffer(20);
  const workerA = 'session-cleanup-worker-a';
  const workerB = 'session-cleanup-worker-b';
  const caller = 'session-cleanup-caller';

  buffer.record({
    callerSessionId: caller,
    targetSessionId: workerA,
    callType: 'task_hard',
    messagePayload: 'Work for A'
  });
  buffer.record({
    callerSessionId: caller,
    targetSessionId: workerB,
    callType: 'task_soft',
    messagePayload: 'Work for B'
  });

  assert.equal(buffer.getPendingTasksForSession(workerA).length, 1);
  assert.equal(buffer.getPendingTasksForSession(workerB).length, 1);

  // 7.1 Settle cleanup: clears pending obligations, keeps historical records in buffer marked settled
  buffer.cleanupSession(workerA, 'settle');
  assert.equal(buffer.getPendingTasksForSession(workerA).length, 0);
  const entriesA = buffer.query({ sessionId: workerA });
  assert.equal(entriesA.length, 1);
  assert.equal(entriesA[0].status, 'settled');

  // 7.2 Purge cleanup: completely scrubs records from memory
  buffer.cleanupSession(workerB, 'purge');
  assert.equal(buffer.getPendingTasksForSession(workerB).length, 0);
  const entriesB = buffer.query({ sessionId: workerB });
  assert.equal(entriesB.length, 0);
});
