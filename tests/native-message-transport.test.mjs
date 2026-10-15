import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMessageId,
  sanitizeContextPostIds,
  buildTransportPayload,
  buildNativeUserMessage,
  dispatchNativeMessage,
  CALL_TYPE_INTENTS
} from '../lib/native-message-transport.mjs';

test('NativeMessageTransport - 消息标识生成与意图常量导出', () => {
  const id1 = generateMessageId();
  const id2 = generateMessageId();
  assert.ok(typeof id1 === 'string' && id1.length > 0);
  assert.ok(typeof id2 === 'string' && id2.length > 0);
  assert.notEqual(id1, id2);

  assert.equal(CALL_TYPE_INTENTS.task_dispatch, 'TASK_DISPATCH');
  assert.equal(CALL_TYPE_INTENTS.task_report, 'TASK_REPORT');
  assert.equal(CALL_TYPE_INTENTS.notice, 'NOTICE');
});

test('NativeMessageTransport - 上下文黑板条目引用清洗与去重 (sanitizeContextPostIds)', () => {
  assert.deepEqual(sanitizeContextPostIds(null), []);
  assert.deepEqual(sanitizeContextPostIds(undefined), []);
  assert.deepEqual(sanitizeContextPostIds('not-an-array'), []);

  // 混合输入：包含裸 ID、带有 # 前缀、空串、纯 # 符号、重复项
  const rawList = ['post-101', 'post-102', '  post-103  ', '', '#', 'post-101', 'post-102', null, undefined];
  const cleaned = sanitizeContextPostIds(rawList);
  assert.deepEqual(cleaned, ['post-101', 'post-102', 'post-103']);

  // 跨前缀重复项去重验证：post-dup 与 #post-dup 必须被归一化去重
  assert.deepEqual(sanitizeContextPostIds(['post-dup', '#post-dup', '##post-dup']), ['post-dup']);

  // 统一剥离前缀去重：输出元素保证不含井号前缀，杜绝格式漂移
  assert.deepEqual(sanitizeContextPostIds(['#post-a', '#post-b', '#post-a']), ['post-a', 'post-b']);
});

test('NativeMessageTransport - 客观传输报头装配与零正文篡改 (buildTransportPayload)', () => {
  const rawMsg = '  function test() {\n    return 42;\n  }\n';
  const payload = buildTransportPayload(rawMsg, {
    callerSessionId: 'session-alpha',
    callerTitle: 'Coordinator',
    callType: 'task_dispatch',
    contextPostIds: ['post-abc', 'post-def']
  });

  const expectedHeader = '[From: session-alpha (Coordinator) | CallType: task_dispatch]\n> Context Ref: #post-abc, #post-def';
  assert.ok(payload.startsWith(expectedHeader));
  assert.ok(payload.endsWith(`\n\n${rawMsg}`));

  // 回退边界处理
  const fallbackPayload = buildTransportPayload('Hello fallback');
  assert.ok(fallbackPayload.startsWith('[From: unknown-caller (Session) | CallType: task_dispatch]\n\nHello fallback'));
});

test('NativeMessageTransport - 标准 DSH UserMessage 原子装配与摘要截断 (buildNativeUserMessage)', () => {
  // 1. form: 'notice' 单播消息
  const noticeMsg = buildNativeUserMessage({
    rawMessage: 'Execute step A immediately',
    form: 'notice',
    callerSessionId: 'session-master',
    callerTitle: 'Leader',
    callType: 'task_dispatch',
    contextPostIds: ['#post-1']
  });

  assert.ok(typeof noticeMsg.id === 'string' && noticeMsg.id.length > 0);
  assert.equal(noticeMsg.role, 'user');
  assert.equal(noticeMsg.content.length, 1);
  assert.equal(noticeMsg.content[0].type, 'text');
  assert.equal(noticeMsg.source.kind, 'plugin:dsh-call-session');
  assert.equal(noticeMsg.source.form, 'notice');
  assert.equal(noticeMsg.source.summary, '[Cross-Session TASK_DISPATCH] from Leader: Execute step A immediately');

  // 2. form: 'session_create' 同级会话初始消息
  const bootstrapMsg = buildNativeUserMessage({
    rawMessage: 'Hello new peer worker',
    form: 'session_create',
    callerSessionId: 'session-creator-999',
    callerTitle: 'Creator',
    contextPostIds: ['post-root']
  });
  assert.equal(bootstrapMsg.source.form, 'session_create');
  assert.equal(bootstrapMsg.source.summary, '[Peer Session Bootstrap] from Creator: Hello new peer worker');
  assert.equal(
    bootstrapMsg.content[0].text,
    '[From: session-creator-999 (Creator) | CallType: task_dispatch]\n> Context Ref: #post-root\n\nHello new peer worker'
  );

  // 2.1 针对空白发件人容错回退至 root-session (Spec 011)
  const bootstrapBlankCaller = buildNativeUserMessage({
    rawMessage: 'Hello fallback',
    form: 'session_create',
    callerSessionId: '   \t  \n  ',
    callerTitle: ''
  });
  assert.equal(
    bootstrapBlankCaller.content[0].text,
    '[From: root-session (Session) | CallType: task_dispatch]\n\nHello fallback'
  );

  // 3. 超长正文摘要截断至 120 字符
  const longText = 'A'.repeat(200);
  const truncatedMsg = buildNativeUserMessage({
    rawMessage: longText,
    form: 'notice',
    callerTitle: 'Caller'
  });
  assert.ok(truncatedMsg.source.summary.length <= 120);
  assert.ok(truncatedMsg.source.summary.endsWith('...'));
});

test('NativeMessageTransport - 状态感知原生通道派发 (dispatchNativeMessage)', () => {
  const userMsg = { id: 'msg-1', role: 'user', content: [] };

  // 运行态 -> steer
  let steerCalled = false;
  const runningAgent = {
    id: 'agent-run',
    status: 'running',
    steer(msg) {
      assert.equal(msg, userMsg);
      steerCalled = true;
    }
  };
  const modeRun = dispatchNativeMessage(runningAgent, userMsg);
  assert.equal(modeRun, 'steer');
  assert.equal(steerCalled, true);

  // 空闲态带 followup -> followup
  let followupCalled = false;
  const idleFollowupAgent = {
    id: 'agent-idle-1',
    status: 'idle',
    followup(msg) {
      assert.equal(msg, userMsg);
      followupCalled = true;
    }
  };
  const modeIdle1 = dispatchNativeMessage(idleFollowupAgent, userMsg);
  assert.equal(modeIdle1, 'followup');
  assert.equal(followupCalled, true);

  // 空闲态回退 send -> followup
  let sendCalled = false;
  const idleSendAgent = {
    id: 'agent-idle-2',
    status: 'idle',
    send(msg, turn, urgent) {
      assert.equal(msg, userMsg);
      assert.equal(turn, 'next-turn');
      assert.equal(urgent, true);
      sendCalled = true;
    }
  };
  const modeIdle2 = dispatchNativeMessage(idleSendAgent, userMsg);
  assert.equal(modeIdle2, 'followup');
  assert.equal(sendCalled, true);

  // 异常拦截
  assert.throws(() => dispatchNativeMessage(null, userMsg), /[InvalidParameter]/);
  assert.throws(() => dispatchNativeMessage({ id: 'broken', status: 'idle' }, userMsg), /[ServiceUnavailable]/);
});
