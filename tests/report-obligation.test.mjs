/**
 * Turn-stopping payload shapes used here come from live host captures recorded in
 * docs/agents/evidence/0020-turn-stopping.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CallTelemetryRingBuffer,
  formatPendingTaskReminderText
} from '../lib/call-telemetry.mjs';
import { CALL_TYPES, buildNativeUserMessage, buildTransportPayload } from '../lib/native-message-transport.mjs';
import { executeSessionCall } from '../lib/session-call.mjs';
import { buildToolDefinitions } from '../lib/tools-registry.mjs';
import { apply, runtimeSelfCheck } from '../index.mjs';
import { assertNativeUserMessage, createMockAgent } from './helpers/mock-agent.mjs';

function createMockContext() {
  const contexts = new Map();
  const promptSections = new Map();
  const tools = new Map();
  const eventHandlers = new Map();
  const agents = new Map();
  const logs = [];

  const ctx = {
    logs,
    logger(scope) {
      const record = (level) => (message) => logs.push({ scope, level, message });
      return { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') };
    },
    systemPrompt: {
      context(def) { contexts.set(def.name, def); },
      getContext(name) { return contexts.get(name); },
      add(id, getter, options) { promptSections.set(id, { getter, options }); }
    },
    tools: {
      register(tool) { tools.set(tool.name, tool); },
      get(name) { return tools.get(name); }
    },
    agents: {
      get(id) { return agents.get(id) || null; },
      list() { return Array.from(agents.values()); }
    },
    workspaces: {
      getWorkspaces() { return [{ id: 'proj-1', path: '/workspace/proj-1' }]; }
    },
    on(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event).push(handler);
    },
    emit(event, ...args) {
      const handlers = eventHandlers.get(event) || [];
      for (const h of handlers) h(...args);
    },
    getEventHandlers(event) {
      return eventHandlers.get(event) || [];
    },
    addAgent(agent) {
      agents.set(agent.id, agent);
    }
  };
  return ctx;
}

test('1. Transport & Schema: call_type accepts notice, task_soft, task_hard, task_report; rejects task_dispatch', async () => {
  // 枚举单一来源，且已退役的 task_dispatch 不在其中
  assert.deepEqual([...CALL_TYPES].sort(), ['notice', 'task_hard', 'task_report', 'task_soft'].sort());
  assert.ok(!CALL_TYPES.includes('task_dispatch'), 'task_dispatch must be removed');

  // 缺省沿用 task_soft（spec 0020 默认值）；枚举外的取值一律参数错误，绝不静默降级
  assert.match(
    buildTransportPayload('hello', { callerSessionId: 's1' }),
    /CallType: task_soft\]/
  );
  assert.throws(
    () => buildTransportPayload('hello', { callerSessionId: 's1', callType: 'task_dispatch' }),
    /\[InvalidParameter\]/
  );

  // Tools schema declaration
  const tools = buildToolDefinitions({}, {});
  const sessionCall = tools.find(t => t.name === 'session_call');
  assert.ok(sessionCall);
  const callTypeSchema = sessionCall.parameters.properties.call_type;
  assert.deepEqual(callTypeSchema.enum.sort(), ['notice', 'task_hard', 'task_report', 'task_soft'].sort());
  assert.equal(callTypeSchema.default, 'task_soft');
  // 工具 Schema 的枚举直接取自运行时单一来源，新增类型不会只落一半
  assert.deepEqual(
    [...callTypeSchema.enum].sort(),
    [...CALL_TYPES].sort(),
    'the tool schema enum must be derived from CALL_TYPES'
  );

  // executeSessionCall rejects task_dispatch
  const ctx = createMockContext();
  const caller = createMockAgent('caller-1');
  const target = createMockAgent('target-1');
  ctx.addAgent(caller);
  ctx.addAgent(target);

  await assert.rejects(
    async () => {
      await executeSessionCall(ctx, {
        target_session_id: 'target-1',
        message: 'test',
        call_type: 'task_dispatch'
      }, { agent: caller });
    },
    (err) => {
      assert.match(err.message, /\[InvalidParameter\]/);
      assert.match(err.message, /task_dispatch/);
      return true;
    }
  );
});

test('2. Telemetry Ledger: a task is enqueued after delivery, reports settle strictly first-in-first-out, and only the receiver owes a report', () => {
  const telemetry = new CallTelemetryRingBuffer(200);

  // Notice records call but no pending task
  telemetry.record({
    callerSessionId: 'session-a',
    targetSessionId: 'session-b',
    callType: 'notice',
    messagePayload: 'FYI only'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);
  assert.equal(telemetry.getPendingTasksForSession('session-a').length, 0, 'a notice owes nobody a report');

  // Dispatch soft task 1
  const rec1 = telemetry.record({
    id: 'call-1',
    callerSessionId: 'session-a',
    callerTitle: 'Alice',
    targetSessionId: 'session-b',
    callType: 'task_soft',
    messagePayload: 'Do step 1'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 1);
  assert.equal(rec1.status, 'active');

  // Dispatch hard task 2
  const rec2 = telemetry.record({
    id: 'call-2',
    callerSessionId: 'session-a',
    callerTitle: 'Alice',
    targetSessionId: 'session-b',
    callType: 'task_hard',
    messagePayload: 'Do step 2'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 2);

  // The obligation sits on the receiver only: the caller is waiting for a report, it owes none.
  assert.equal(telemetry.getPendingTasksForSession('session-a').length, 0, 'the caller owes nothing while it waits');

  // session-b reports back to session-a. The oldest owed task is the soft one, so that is
  // the single entry the report settles; the hard task stays on the books and keeps chasing.
  telemetry.record({
    callerSessionId: 'session-b',
    targetSessionId: 'session-a',
    callType: 'task_report',
    messagePayload: 'Step 1 complete'
  });
  assert.equal(telemetry.query().find(r => r.id === 'call-1').status, 'settled', 'the oldest owed task is the one a report settles');
  assert.equal(telemetry.query().find(r => r.id === 'call-2').status, 'active', 'a report settles exactly one entry');
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 1);

  // A second report closes the hard one.
  telemetry.record({
    callerSessionId: 'session-b',
    targetSessionId: 'session-a',
    callType: 'task_report',
    messagePayload: 'Step 2 complete'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);
  assert.equal(telemetry.query().find(r => r.id === 'call-2').status, 'settled');

  // A report with nothing left to settle is a no-op, not a throw.
  assert.doesNotThrow(() => telemetry.record({
    callerSessionId: 'session-b',
    targetSessionId: 'session-a',
    callType: 'task_report',
    messagePayload: 'Duplicate'
  }));
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);
  assert.equal(telemetry.lastUnmatchedReport?.callerSessionId, 'session-b', 'a report that settles nothing still leaves a trace');

  // Strict FIFO is queue order, not per-type order: an earlier soft task is settled
  // before a later hard one, in the order the obligations were taken on.
  const fifo = new CallTelemetryRingBuffer(200);
  fifo.record({ id: 'f-soft', callerSessionId: 'a', targetSessionId: 'b', callType: 'task_soft' });
  fifo.record({ id: 'f-hard', callerSessionId: 'a', targetSessionId: 'b', callType: 'task_hard' });
  fifo.record({ callerSessionId: 'b', targetSessionId: 'a', callType: 'task_report' });
  assert.equal(fifo.query().find(r => r.id === 'f-soft').status, 'settled', 'the queue settles its oldest entry');
  assert.equal(fifo.query().find(r => r.id === 'f-hard').status, 'active');

  // Pairing still gates the sweep: a report only settles work from the pair it names.
  fifo.record({ id: 'f-other', callerSessionId: 'c', targetSessionId: 'b', callType: 'task_hard' });
  fifo.record({ callerSessionId: 'b', targetSessionId: 'a', callType: 'task_report' });
  assert.equal(fifo.query().find(r => r.id === 'f-hard').status, 'settled');
  assert.equal(fifo.query().find(r => r.id === 'f-other').status, 'active', 'another caller\'s order stays owed');
});

test('3. Lifecycle Cascade: cleanupSession removes pending tasks and settles records', async () => {
  const telemetry = new CallTelemetryRingBuffer(200);
  telemetry.record({
    id: 'c-1',
    callerSessionId: 'session-a',
    targetSessionId: 'session-b',
    callType: 'task_soft',
    messagePayload: 'Task'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 1);

  telemetry.cleanupSession('session-b');
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);
  const c1 = telemetry.query().find(r => r.id === 'c-1');
  assert.equal(c1.status, 'settled');

  // Verify session/dispose event hook triggers telemetry cleanup
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });
  ctx.callTelemetry.record({
    id: 'c-disp',
    callerSessionId: 'session-caller',
    targetSessionId: 'session-target',
    callType: 'task_hard'
  });
  assert.equal(ctx.callTelemetry.getPendingTasksForSession('session-target').length, 1);
  const disposeHandlers = ctx.getEventHandlers('session/dispose');
  assert.ok(disposeHandlers.length > 0, 'session/dispose event handler must be registered');
  for (const h of disposeHandlers) {
    await h({ session: { id: 'session-target' } });
  }
  assert.equal(ctx.callTelemetry.getPendingTasksForSession('session-target').length, 0, 'session/dispose must cascade cleanup pending tasks');
});

test('4. Dynamic Context: task:remind injects context in systemPrompt', () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  const remindContext = ctx.systemPrompt.getContext('task:remind');
  assert.ok(remindContext, 'task:remind must be registered');
  assert.equal(remindContext.order, 131);

  const callee = createMockAgent('agent-b', { title: 'Worker B' });
  ctx.addAgent(callee);

  // Initially empty
  assert.equal(remindContext.text({ agent: callee }), '');

  // Dispatch task from agent-a
  const telemetry = ctx.callTelemetry;
  telemetry.record({
    id: 'call-x',
    callerSessionId: 'agent-a',
    callerTitle: 'Captain A',
    targetSessionId: 'agent-b',
    callType: 'task_soft'
  });

  const injected = remindContext.text({ agent: callee });
  assert.match(injected, /Pending Tasks/);
  assert.match(injected, /Captain A/);
  assert.match(injected, /task_report/);
});

test('5. Hard task interception: agent/turn-stopping triggers steer on pending task_hard', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  let steeredMessage = null;
  const callee = createMockAgent('agent-worker', {
    // A bare string here would pass the mock and crash the live turn.
    steerFn: async (msg) => { steeredMessage = assertNativeUserMessage(msg); }
  });
  ctx.addAgent(callee);

  // Dispatch soft task only -> turn-stopping should NOT steer
  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_soft'
  });

  const handlers = ctx.getEventHandlers('agent/turn-stopping');
  assert.ok(handlers.length > 0, 'agent/turn-stopping handler must be registered');

  for (const h of handlers) {
    await h({ agent: callee, turn: 1 });
  }
  assert.equal(steeredMessage, null, 'task_soft must not trigger turn-stopping steer');

  // Dispatch hard task -> turn-stopping MUST steer
  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });

  for (const h of handlers) {
    await h({ agent: callee, turn: 2 });
  }
  assert.ok(steeredMessage, 'task_hard must trigger steer');
  assert.match(steeredMessage.content[0].text, /Master/);
  assert.match(steeredMessage.content[0].text, /task_report/);

  // The first report settles the oldest owed task, which is the soft one, so the mandatory
  // task is still owed and the chase continues.
  ctx.callTelemetry.record({
    callerSessionId: 'agent-worker',
    targetSessionId: 'agent-master',
    callType: 'task_report',
    messagePayload: 'Soft task completed'
  });
  steeredMessage = null;
  for (const h of handlers) {
    await h({ agent: callee, turn: 3 });
  }
  assert.ok(steeredMessage, 'a report settles one entry, so the hard task keeps chasing');

  // Report 2 settles the hard task; nothing is owed any more.
  ctx.callTelemetry.record({
    callerSessionId: 'agent-worker',
    targetSessionId: 'agent-master',
    callType: 'task_report',
    messagePayload: 'Hard task completed'
  });
  steeredMessage = null;
  for (const h of handlers) {
    await h({ agent: callee, turn: 4 });
  }
  assert.equal(steeredMessage, null, 'settled task_hard must not steer on turn-stopping');
});

/**
 * The payload shape below mirrors real host output recorded in
 * docs/agents/evidence/0020-turn-stopping.md: `{ turn, signal, agent }`, where `agent`
 * is the live agent instance and `signal` is the turn's AbortSignal.
 */
function hostTurnPayload(agent, turn, { aborted = false, reason = undefined } = {}) {
  const controller = new AbortController();
  if (aborted) controller.abort(reason);
  return { turn, signal: controller.signal, agent };
}

test('6. Guard resolves the session from the real payload shape { turn, signal, agent }', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  let steeredMessage = null;
  const callee = createMockAgent('agent-worker', {
    // A bare string here would pass the mock and crash the live turn.
    steerFn: async (msg) => { steeredMessage = assertNativeUserMessage(msg); }
  });
  ctx.addAgent(callee);

  // A soft task alone must never chase the turn closed.
  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_soft'
  });
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 1));
  }
  assert.equal(steeredMessage, null, 'task_soft must not chase');

  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 2));
  }
  assert.ok(steeredMessage, 'task_hard must chase via steer');
  assert.match(steeredMessage.content[0].text, /Master/);
  assert.match(steeredMessage.content[0].text, /task_report/);
});

test('7. Guard never steers once the host turn signal is aborted', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  const steered = [];
  const callee = createMockAgent('agent-worker', {
    steerFn: async (msg) => { steered.push(assertNativeUserMessage(msg)); }
  });
  ctx.addAgent(callee);

  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });

  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 1, { aborted: true, reason: 'user stop' }));
  }
  assert.deepEqual(steered, [], 'an aborted turn must not be resurrected');

  // The stop must return immediately: the ledger is not even consulted, so no
  // budget is spent and nothing is logged for a turn the operator ended.
  const warnings = ctx.logs.filter((entry) => entry.level === 'warn');
  assert.deepEqual(warnings, [], 'an aborted turn must not consume budget or warn');

  // A later healthy turn still gets the full chase budget.
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 1));
  }
  assert.equal(steered.length, 1, 'the aborted turn must not have spent this turn\'s budget');
});

test('8. Guard budget is per turn: 3 chases, then one warning, and a new turn starts fresh', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });
  const warnings = () => ctx.logs.filter((entry) => entry.level === 'warn').map((entry) => entry.message);

  const steered = [];
  const callee = createMockAgent('agent-worker', {
    steerFn: async (msg) => { steered.push(assertNativeUserMessage(msg)); }
  });
  ctx.addAgent(callee);

  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });

  // Exhaust turn 1: three chases, then silence while the task stays pending.
  for (let i = 0; i < 6; i += 1) {
    for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
      await handler(hostTurnPayload(callee, 1));
    }
  }
  assert.equal(steered.length, 3, 'at most 3 chases within one host turn');
  assert.equal(warnings().length, 1, 'the exhausted budget must be reported exactly once, not per hook call');
  assert.match(warnings()[0], /agent-worker/, 'the warning must name the session that ran out of chases');
  assert.match(warnings()[0], /1 pending task\(s\)/, 'the warning must state how much work is still owed, in ledger terms');

  // Turn 2 is a fresh budget, not a continuation of the exhausted one.
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 2));
  }
  assert.equal(steered.length, 4, 'a new turn must regain its own chase budget');
});

test('9. Guard stops chasing the moment the hard task is settled', async () => {
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  const steered = [];
  const callee = createMockAgent('agent-worker', {
    steerFn: async (msg) => { steered.push(assertNativeUserMessage(msg)); }
  });
  ctx.addAgent(callee);

  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 1));
  }
  assert.equal(steered.length, 1);

  ctx.callTelemetry.record({
    callerSessionId: 'agent-worker',
    targetSessionId: 'agent-master',
    callType: 'task_report',
    messagePayload: 'done'
  });
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 2));
  }
  assert.equal(steered.length, 1, 'a settled task must not be chased again');

  // The caller is a party to the obligation, but it owes nothing: its own turn must not be
  // chased while it is still waiting for the report.
  const caller = createMockAgent('agent-master', { steerFn: async () => { steered.push('caller'); } });
  ctx.addAgent(caller);
  const obligationHeldByCaller = ctx.callTelemetry.record({
    callerSessionId: 'agent-worker',
    callerTitle: 'Worker',
    targetSessionId: 'agent-master',
    callType: 'task_hard'
  });
  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(caller, 1));
  }
  assert.equal(steered.length, 2, 'a session that owes a hard report must be chased');
  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    targetSessionId: 'agent-worker',
    callType: 'task_report',
    messagePayload: 'done'
  });
  assert.equal(obligationHeldByCaller.status, 'settled', 'reporting back settles the obligation placed on the caller');
});


test('10. Transport never fabricates a call type: unknown types are rejected, and bootstrap keeps the real one', () => {
  // An unknown type must never be echoed into the header, nor quietly swapped for one.
  assert.throws(
    () => buildTransportPayload('x', { callerSessionId: 's1', callType: 'task_dispatch' }),
    /\[InvalidParameter\].*task_dispatch/,
    'a retired call type is a parameter error, not a silent substitution'
  );
  assert.throws(
    () => buildNativeUserMessage({ rawMessage: 'x', callType: 'task_dispatch' }),
    /\[InvalidParameter\]/,
    'the message builder must reject it too, before any header is written'
  );

  // A real type survives the bootstrap form instead of being pinned to task_soft.
  const bootstrap = buildNativeUserMessage({
    rawMessage: 'boot',
    form: 'session_create',
    callerSessionId: 'parent',
    callerTitle: 'Parent',
    callType: 'task_hard'
  });
  assert.match(bootstrap.content[0].text, /\| CallType: task_hard\]/);
});

test('11. Guard steers a native UserMessage, never a bare string', async () => {
  // Live capture: a string reached agent.steer, the host spliced it into the inbox
  // and then failed the turn with "Cannot read properties of undefined (reading 'kind')".
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });

  const steered = [];
  const callee = createMockAgent('agent-worker', { title: 'Worker W' });
  ctx.addAgent(callee);

  ctx.callTelemetry.record({
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    targetSessionId: 'agent-worker',
    callType: 'task_hard'
  });

  for (const handler of ctx.getEventHandlers('agent/turn-stopping')) {
    await handler(hostTurnPayload(callee, 1));
  }

  assert.equal(steered.length, 0, 'the default mock collects instead of failing');
  const delivered = callee.received.filter((entry) => entry.method === 'steer');
  assert.equal(delivered.length, 1, 'exactly one reminder per stopped turn');
  const message = delivered[0].msg;

  assert.doesNotThrow(() => assertNativeUserMessage(message), 'the host only accepts a UserMessage');
  assert.equal(message.role, 'user');
  assert.equal(message.source.kind, 'plugin:dsh-call-session', 'the reminder is attributed to this plugin');
  assert.match(message.content[0].text, /CallType: notice\]/, 'the reminder is an advisory notice, not a second hard task');
  assert.match(message.content[0].text, /task_report/, 'the reminder still names the reporting call');
  assert.match(message.content[0].text, /Master/, 'the reminder still names the caller');
});

test('12. session_create carries the caller-chosen call type into the initial message', async () => {
  const { formatInitialMessage } = await import('../lib/peer-bootstrap.mjs');
  const hard = formatInitialMessage({
    initialMessage: '请回执',
    callerSessionId: 'agent-master',
    callerTitle: 'Master',
    callType: 'task_hard'
  });
  assert.match(hard.content[0].text, /\| CallType: task_hard\]/, 'the chosen type must survive bootstrap');
  assert.throws(
    () => formatInitialMessage({ initialMessage: 'x', callType: 'task_dispatch' }),
    /\[InvalidParameter\]/,
    'a retired type is rejected at the schema boundary too'
  );

  const def = formatInitialMessage({ initialMessage: 'hi', callerSessionId: 'agent-master' });
  assert.match(def.content[0].text, /\| CallType: task_soft\]/, 'without a choice the documented default applies');

  const tools = buildToolDefinitions({}, {});
  const createSchema = tools.find(t => t.name === 'session_create').parameters.properties.call_type;
  assert.deepEqual([...createSchema.enum].sort(), [...CALL_TYPES].sort(), 'session_create exposes every live type');
});

test('13. Reminders say nothing when nothing is owed, and are bilingual', async () => {
  const zh = (await import('../lib/locales/zh.mjs')).default.prompts;
  const en = (await import('../lib/locales/en.mjs')).default.prompts;
  for (const prompts of [zh, en]) {
    assert.equal(prompts.taskHardTurnReminder([]), '', 'no pending work means no injected text');
    assert.equal(prompts.taskHardTurnReminder(undefined), '');
    assert.match(prompts.taskHardTurnReminder([{ callerSessionId: 'agent-master', callerTitle: 'Master' }]), /task_report/);
  }

  // And the prompt section itself contributes nothing once the ledger is clear.
  const ctx = createMockContext();
  apply(ctx, { locale: 'zh' });
  const worker = createMockAgent('agent-worker', { title: 'Worker W' });
  ctx.addAgent(worker);
  const section = ctx.systemPrompt.getContext('task:remind');
  assert.equal(await section.text({ agent: worker }), '');
});

test('14. Restart self-check answers what this process actually loaded', async () => {
  // The check must read the live plugin instance, not a module-level copy: it is
  // the gate that separates "the new code never loaded" from "the new code is inert".
  const ctx = createMockContext();
  const registered = [];
  ctx.provide = (key, value) => registered.push([key, value]);
  apply(ctx, { locale: 'zh' });

  const exposed = new Map(registered);
  assert.equal(typeof exposed.get('callSessionSelfCheck'), 'function', 'the host can query the plugin state');

  const snapshot = exposed.get('callSessionSelfCheck')();
  assert.deepEqual(snapshot.callTypes, ['notice', 'task_soft', 'task_hard', 'task_report']);
  assert.equal(snapshot.defaultCallType, 'task_soft');
  assert.equal(snapshot.guard.registered, true);
  assert.equal(snapshot.guard.listening, true, 'the guard is actually on the turn-stopping hook');
  assert.equal(snapshot.guard.maxRemindersPerTurn, 3);
  assert.equal(snapshot.ledger.attached, true);

  // A host that never wired the guard must report it instead of pretending.
  const inert = runtimeSelfCheck(createMockContext(), { getPendingTasksForSession() {} }, null);
  assert.equal(inert.guard.registered, false);
  assert.equal(inert.guard.listening, null);
});

