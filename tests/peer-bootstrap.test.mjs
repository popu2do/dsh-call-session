import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PeerBootstrapper,
  formatInitialMessage,
  dispatchInitialMessage,
  publishBootstrapNotice,
  bootstrapPeerSession
} from '../lib/peer-bootstrap.mjs';

function createMockAgent({
  id = 'peer-agent-1',
  status = 'idle',
  title = 'Target Peer',
  generation = 1,
  shouldFail = false
} = {}) {
  const received = [];
  return {
    id,
    status,
    title,
    generation,
    steer(msg) {
      if (shouldFail) throw new Error('steer dispatch failed');
      received.push({ type: 'steer', msg });
      return Promise.resolve();
    },
    followup(msg) {
      if (shouldFail) throw new Error('followup dispatch failed');
      received.push({ type: 'followup', msg });
      return Promise.resolve();
    },
    _received: received
  };
}

function createMockBoardStore({ shouldFail = false } = {}) {
  const posts = [];
  return {
    posts,
    post(payload) {
      if (shouldFail) throw new Error('boardStore.post failed');
      const item = { ...payload, id: payload.id || 'mock-post-1' };
      posts.push(item);
      return item;
    },
    clear({ id, topic } = {}) {
      if (id) {
        const idx = posts.findIndex(p => p.id === id);
        if (idx !== -1) posts.splice(idx, 1);
      } else if (topic) {
        let i = posts.length;
        while (i--) {
          if (posts[i].topic === topic) posts.splice(i, 1);
        }
      }
      return { success: true };
    }
  };
}

test('formatInitialMessage: cleans empty and invalid initialMessage', () => {
  assert.equal(formatInitialMessage({ initialMessage: undefined }), null);
  assert.equal(formatInitialMessage({ initialMessage: null }), null);
  assert.equal(formatInitialMessage({ initialMessage: '' }), null);
  assert.equal(formatInitialMessage({ initialMessage: '   \n\t  ' }), null);
  assert.equal(formatInitialMessage({ initialMessage: 12345 }), null);
  assert.equal(formatInitialMessage(), null);
});

test('formatInitialMessage: builds standard UserMessage structure', () => {
  const customIdGen = () => 'msg-custom-id-999';
  const msg = formatInitialMessage({
    initialMessage: 'Analyze system architecture',
    callerTitle: 'CaptainAgent',
    generateMessageId: customIdGen
  });

  assert.ok(msg);
  assert.equal(msg.id, 'msg-custom-id-999');
  assert.equal(msg.role, 'user');
  assert.deepEqual(msg.content, [{ type: 'text', text: 'Analyze system architecture' }]);
  assert.equal(msg.source.kind, 'plugin');
  assert.equal(msg.source.plugin, 'dsh-call-session');
  assert.equal(msg.source.form, 'session_create');
  assert.equal(msg.source.summary, '[Peer Session Bootstrap] from CaptainAgent: Analyze system architecture');

  // Default ID generator
  const msgDefault = formatInitialMessage({
    initialMessage: 'Hello world'
  });
  assert.ok(msgDefault);
  assert.ok(typeof msgDefault.id === 'string' && msgDefault.id.length > 0);
  assert.equal(msgDefault.source.summary, '[Peer Session Bootstrap] from Session: Hello world');
});

test('formatInitialMessage: formats contextPostIds with # and prefix ref', () => {
  const msg = formatInitialMessage({
    initialMessage: 'Investigate deadlock',
    contextPostIds: ['post-101', '#post-202', '  #post-303  ', '', null],
    callerTitle: 'Investigator'
  });

  assert.ok(msg);
  assert.equal(
    msg.content[0].text,
    '> Context Ref: #post-101, #post-202, #post-303\n\nInvestigate deadlock'
  );
  assert.equal(msg.source.summary, '[Peer Session Bootstrap] from Investigator: Investigate deadlock');
});

test('formatInitialMessage: truncates summary to 120 chars when exceeding length', () => {
  const longTask = 'A'.repeat(200);
  const msg = formatInitialMessage({
    initialMessage: longTask,
    callerTitle: 'ParentAgent'
  });

  assert.ok(msg);
  assert.equal(msg.source.summary.length, 120);
  assert.ok(msg.source.summary.endsWith('...'));
  assert.ok(msg.source.summary.startsWith('[Peer Session Bootstrap] from ParentAgent: '));
});

test('formatInitialMessage: normalizes whitespaces in summary', () => {
  const msg = formatInitialMessage({
    initialMessage: 'Line 1\n\n  Line 2\t\tLine 3  ',
    callerTitle: 'Worker'
  });

  assert.ok(msg);
  assert.equal(
    msg.source.summary,
    '[Peer Session Bootstrap] from Worker: Line 1 Line 2 Line 3'
  );
});

test('dispatchInitialMessage: returns idle when messagePayload is null or undefined', () => {
  const targetAgent = createMockAgent();
  assert.equal(dispatchInitialMessage(targetAgent, null), 'idle');
  assert.equal(dispatchInitialMessage(targetAgent, undefined), 'idle');
  assert.equal(targetAgent._received.length, 0);
});

test('dispatchInitialMessage: dispatches to running or idle agent and returns running on success', () => {
  const agent = createMockAgent({ status: 'idle' });
  const payload = {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }]
  };

  const status = dispatchInitialMessage(agent, payload);
  assert.equal(status, 'running');
  assert.equal(agent._received.length, 1);
  assert.equal(agent._received[0].type, 'followup');
});

test('dispatchInitialMessage: safely catches dispatch error, logs warn, and returns idle', () => {
  const agent = createMockAgent({ shouldFail: true });
  const payload = {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }]
  };

  const loggedWarnings = [];
  const mockLogger = {
    warn: (msg) => loggedWarnings.push(msg)
  };

  const status = dispatchInitialMessage(agent, payload, { logger: mockLogger });
  assert.equal(status, 'idle');
  assert.equal(loggedWarnings.length, 1);
  assert.ok(loggedWarnings[0].includes('Failed to dispatch initial message'));
});

test('publishBootstrapNotice: returns null when boardStore is missing or invalid', () => {
  const result = publishBootstrapNotice(null, {
    peerSessionId: 'peer-1',
    finalTitle: 'Peer Session'
  });
  assert.equal(result, null);

  const resultNoPost = publishBootstrapNotice({}, {
    peerSessionId: 'peer-1'
  });
  assert.equal(resultNoPost, null);
});

test('publishBootstrapNotice: publishes topic session:bootstrap with TTL and metadata', () => {
  const boardStore = createMockBoardStore();
  const startTime = Date.now();

  const postId = publishBootstrapNotice(boardStore, {
    peerSessionId: 'peer-123',
    finalTitle: 'Feature Worker',
    callerSessionId: 'caller-456',
    callerTitle: 'Caller Session',
    callerWorkspace: '/workspace/project-a',
    targetGeneration: 2
  });

  assert.ok(postId);
  assert.equal(boardStore.posts.length, 1);
  const post = boardStore.posts[0];

  assert.equal(post.topic, 'session:bootstrap');
  assert.deepEqual(post.tags, ['peer-session', 'bootstrap']);
  assert.equal(post.authorSessionId, 'caller-456');
  assert.equal(post.authorTitle, 'Caller Session');
  assert.equal(post.authorWorkspace, '/workspace/project-a');
  assert.equal(post.scope, '/workspace/project-a');
  assert.equal(post.status, 'active');
  assert.ok(post.content.includes('[peer-123]'));
  assert.ok(post.content.includes('("Feature Worker")'));
  assert.ok(post.content.includes('工作区: /workspace/project-a'));
  assert.ok(post.content.includes('创建方: caller-456'));

  // TTL: 1 hour (3600 * 1000)
  assert.equal(post.expiresAtMs - post.createdAtMs, 3600 * 1000);
  assert.ok(post.createdAtMs >= startTime);

  // Metadata verification
  assert.deepEqual(post.metadata, {
    peerSessionId: 'peer-123',
    title: 'Feature Worker',
    generation: 2,
    creatorSessionId: 'caller-456'
  });
});

test('publishBootstrapNotice: fallback properties when partial parameters given', () => {
  const boardStore = createMockBoardStore();
  const agent = createMockAgent({ id: 'agent-fallback', title: 'Fallback Title', generation: 2 });
  const postId = publishBootstrapNotice(boardStore, { targetAgent: agent });

  assert.ok(postId);
  const post = boardStore.posts[0];
  assert.equal(post.metadata.peerSessionId, 'agent-fallback');
  assert.equal(post.metadata.title, 'Fallback Title');
  assert.equal(post.metadata.generation, 2);
  assert.equal(post.scope, 'global');
});

test('publishBootstrapNotice: catches boardStore.post error, logs warn, and returns null', () => {
  const failingBoardStore = createMockBoardStore({ shouldFail: true });
  const loggedWarnings = [];
  const mockLogger = {
    warn: (msg) => loggedWarnings.push(msg)
  };

  const result = publishBootstrapNotice(failingBoardStore, {
    peerSessionId: 'peer-1',
    finalTitle: 'Test'
  }, { logger: mockLogger });

  assert.equal(result, null);
  assert.equal(loggedWarnings.length, 1);
  assert.ok(loggedWarnings[0].includes('Failed to post session:bootstrap notice'));
});

test('bootstrapPeerSession: coordinates initial message and board bootstrap notice', () => {
  const agent = createMockAgent({ id: 'peer-session-99' });
  const boardStore = createMockBoardStore();

  const result = bootstrapPeerSession({
    targetAgent: agent,
    callerSessionId: 'root-1',
    callerTitle: 'Coordinator',
    callerWorkspace: '/app',
    initialMessage: 'Task prompt',
    contextPostIds: ['ctx-1'],
    boardStore,
    targetGeneration: 1,
    finalTitle: 'Worker-99'
  });

  assert.equal(result.status, 'running');
  assert.ok(result.bootstrapPostId);
  assert.equal(agent._received.length, 1);
  assert.equal(boardStore.posts.length, 1);
  assert.equal(boardStore.posts[0].id, result.bootstrapPostId);
});

test('bootstrapPeerSession: returns idle status when no initialMessage provided', () => {
  const agent = createMockAgent({ id: 'peer-session-100' });
  const boardStore = createMockBoardStore();

  const result = bootstrapPeerSession({
    targetAgent: agent,
    callerSessionId: 'root-1',
    callerTitle: 'Coordinator',
    callerWorkspace: '/app',
    boardStore,
    targetGeneration: 1,
    finalTitle: 'Worker-100'
  });

  assert.equal(result.status, 'idle');
  assert.ok(result.bootstrapPostId);
  assert.equal(agent._received.length, 0);
  assert.equal(boardStore.posts.length, 1);
});

test('PeerBootstrapper class: supports instance and static methods', () => {
  const agent = createMockAgent({ id: 'peer-inst' });
  const boardStore = createMockBoardStore();
  const bootstrapper = new PeerBootstrapper({ boardStore });

  // Instance methods
  const msg = bootstrapper.formatInitialMessage({ initialMessage: 'instance task' });
  assert.ok(msg);
  const status = bootstrapper.dispatchInitialMessage(agent, msg);
  assert.equal(status, 'running');

  // Instance publishBootstrapNotice with bound boardStore
  const noticeId = bootstrapper.publishBootstrapNotice({
    peerSessionId: 'peer-inst',
    finalTitle: 'Inst-Title'
  });
  assert.ok(noticeId);

  // Instance publishBootstrapNotice with explicit boardStore override
  const otherStore = createMockBoardStore();
  const overrideNoticeId = bootstrapper.publishBootstrapNotice(otherStore, {
    peerSessionId: 'peer-override',
    finalTitle: 'Override-Title'
  });
  assert.ok(overrideNoticeId);
  assert.equal(otherStore.posts.length, 1);

  const res = bootstrapper.bootstrap({
    targetAgent: agent,
    initialMessage: 'run again',
    finalTitle: 'Inst-Peer'
  });
  assert.equal(res.status, 'running');
  assert.ok(res.bootstrapPostId);

  // Static methods
  const staticMsg = PeerBootstrapper.formatInitialMessage({ initialMessage: 'static task' });
  assert.ok(staticMsg);
  const staticStatus = PeerBootstrapper.dispatchInitialMessage(agent, staticMsg);
  assert.equal(staticStatus, 'running');
  const staticNoticeId = PeerBootstrapper.publishBootstrapNotice(boardStore, {
    peerSessionId: 'peer-static'
  });
  assert.ok(staticNoticeId);
  const staticRes = PeerBootstrapper.bootstrap({
    targetAgent: agent,
    boardStore,
    initialMessage: 'static bootstrap'
  });
  assert.equal(staticRes.status, 'running');
  assert.ok(staticRes.bootstrapPostId);
});

test('ADR-0025 不变量 4 (Zero-Trace Blackboard Hygiene): 会话就绪公告具有 1 小时确定性 TTL 且支持级联清理零残留', () => {
  const store = createMockBoardStore();
  const agent = createMockAgent();

  const res = bootstrapPeerSession({
    targetAgent: agent,
    boardStore: store,
    callerSessionId: 'caller-hygiene',
    callerTitle: 'HygieneCaller',
    callerWorkspace: 'c:/workspace/hygiene',
    targetGeneration: 1,
    finalTitle: 'HygienePeer'
  });

  assert.ok(res.bootstrapPostId);
  assert.equal(store.posts.length, 1);

  const post = store.posts[0];
  assert.equal(post.topic, 'session:bootstrap');
  assert.equal(post.expiresAtMs - post.createdAtMs, 3600 * 1000, '必须严格设定 1 小时确定性 TTL');

  // 模拟生命周期清理联动：通过 boardStore.clear({ id }) 级联清理就绪公告
  const clearRes = store.clear({ id: res.bootstrapPostId });
  assert.equal(clearRes.success, true);
  assert.equal(store.posts.length, 0, '清理后必须保持零残留');
});
