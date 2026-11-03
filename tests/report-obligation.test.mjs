import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CallTelemetryRingBuffer,
  formatPendingTaskReminderText
} from '../lib/call-telemetry.mjs';
import { CALL_TYPE_INTENTS, buildTransportPayload } from '../lib/native-message-transport.mjs';
import { executeSessionCall } from '../lib/session-call.mjs';
import { buildToolDefinitions } from '../lib/tools-registry.mjs';
import { apply } from '../index.mjs';
import { createMockAgent } from './helpers/mock-agent.mjs';

function createMockContext() {
  const contexts = new Map();
  const promptSections = new Map();
  const tools = new Map();
  const eventHandlers = new Map();
  const agents = new Map();

  const ctx = {
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
  // CALL_TYPE_INTENTS check
  assert.deepEqual(Object.keys(CALL_TYPE_INTENTS).sort(), ['notice', 'task_hard', 'task_report', 'task_soft'].sort());
  assert.equal(CALL_TYPE_INTENTS.task_dispatch, undefined, 'task_dispatch must be removed');

  // buildTransportPayload defaults to task_soft
  const payloadDefault = buildTransportPayload('hello', { callerSessionId: 's1' });
  assert.match(payloadDefault, /\[From: s1 \(Session\) \| CallType: task_soft\]/);

  // Tools schema declaration
  const tools = buildToolDefinitions({}, {});
  const sessionCall = tools.find(t => t.name === 'session_call');
  assert.ok(sessionCall);
  const callTypeSchema = sessionCall.parameters.properties.call_type;
  assert.deepEqual(callTypeSchema.enum.sort(), ['notice', 'task_hard', 'task_report', 'task_soft'].sort());
  assert.equal(callTypeSchema.default, 'task_soft');

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

test('2. Telemetry Ledger: task_soft and task_hard record obligations, task_report settles FIFO, notice does not record obligation', () => {
  const telemetry = new CallTelemetryRingBuffer(200);

  // Notice records call but no pending task
  telemetry.record({
    callerSessionId: 'session-a',
    targetSessionId: 'session-b',
    callType: 'notice',
    messagePayload: 'FYI only'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);

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

  // session-b reports back to session-a: FIFO settles task 1
  telemetry.record({
    callerSessionId: 'session-b',
    targetSessionId: 'session-a',
    callType: 'task_report',
    messagePayload: 'Step 1 complete'
  });
  const remaining = telemetry.getPendingTasksForSession('session-b');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].callId, 'call-2');

  // Verify call-1 record in telemetry is marked settled
  const queryRec1 = telemetry.query().find(r => r.id === 'call-1');
  assert.equal(queryRec1.status, 'settled');

  // session-b reports back again: FIFO settles task 2
  telemetry.record({
    callerSessionId: 'session-b',
    targetSessionId: 'session-a',
    callType: 'task_report',
    messagePayload: 'Step 2 complete'
  });
  assert.equal(telemetry.getPendingTasksForSession('session-b').length, 0);
  const queryRec2 = telemetry.query().find(r => r.id === 'call-2');
  assert.equal(queryRec2.status, 'settled');
});

test('3. Lifecycle Cascade: cleanupSession removes pending tasks and settles records', () => {
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
    steerFn: async (msg) => { steeredMessage = msg; }
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
  assert.match(steeredMessage, /Master/);
  assert.match(steeredMessage, /task_report/);
});
