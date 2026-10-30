import test from 'node:test';
import assert from 'node:assert/strict';
import { buildToolDefinitions } from '../lib/tools-registry.mjs';
import { BoardStore } from '../lib/board-store.mjs';
import { BoardToolsAdapter } from '../lib/board-tools-adapter.mjs';
import { defaultSafeguard } from '../lib/session-safeguard.mjs';
import { createMockAgent } from './helpers/mock-agent.mjs';

function createMockWorkspaceContext(overrides = {}) {
  return {
    agents: {
      get() { return null; },
      list() { return []; },
      create() {
        return { id: 'created-peer', options: {} };
      },
      ...overrides.agents
    },
    workspaces: {
      getWorkspaces() {
        return [{ id: 'proj-main', path: '/workspace/proj-main' }];
      },
      ...overrides.workspaces
    }
  };
}

async function assertInvalidParameterRejected(executeFn, expectedKey) {
  let threw = false;
  try {
    await executeFn();
  } catch (err) {
    threw = true;
    assert.match(
      err.message,
      /\[InvalidParameter\]/,
      `Error message must include [InvalidParameter], got: ${err.message}`
    );
    assert.match(
      err.message,
      new RegExp(expectedKey),
      `Error message must name offending key ${expectedKey}, got: ${err.message}`
    );
  }
  assert.equal(threw, true, `Execution must throw when undeclared argument ${expectedKey} is passed`);
}

test('Strict arguments validation: all six tools declare additionalProperties: false and reject undeclared arguments with [InvalidParameter]', async () => {
  const tools = buildToolDefinitions({}, {});
  assert.equal(tools.length, 6);

  const toolSpecificUnknownKeys = {
    board_post: 'extra_markdown_header',
    board_list: 'tags',
    board_clear: 'purge_all',
    session_call: 'caller_id_override',
    session_query: 'active_only',
    session_create: 'cwd'
  };

  for (const tool of tools) {
    assert.equal(
      tool.parameters.additionalProperties,
      false,
      `Tool ${tool.name} parameters must declare additionalProperties: false`
    );

    const unknownKey = toolSpecificUnknownKeys[tool.name] || 'unexpected_param';
    await assertInvalidParameterRejected(
      () => tool.execute({ [unknownKey]: 'forbidden_value' }, {}),
      unknownKey
    );
  }
});

test('Strict arguments validation: session_create rejection has zero side effects on quotas and reservations', async () => {
  let createdCount = 0;
  defaultSafeguard.reset();

  const mockCtx = createMockWorkspaceContext({
    agents: {
      create() {
        createdCount++;
        return { id: 'created-peer', options: {} };
      }
    }
  });

  const tools = buildToolDefinitions(mockCtx, {});
  const sessionCreateTool = tools.find(t => t.name === 'session_create');
  assert.ok(sessionCreateTool, 'session_create tool must exist');

  await assertInvalidParameterRejected(
    () => sessionCreateTool.execute(
      {
        title: 'Worktree Peer',
        initial_message: 'Do work in worktree',
        cwd: '/workspace/proj-main/.scratch/worktrees/issue-14'
      },
      {}
    ),
    'cwd'
  );

  assert.equal(createdCount, 0, 'No agent must be created when rejected');
  assert.equal(defaultSafeguard.inFlightTitlesByWorkspace.size, 0, 'No in-flight title should be reserved in any workspace');
  assert.equal(defaultSafeguard.inFlightLeasesByWorkspace.size, 0, 'No concurrent-run quota lease should be reserved in any workspace');
  assert.equal(defaultSafeguard.rateLimits.size, 0, 'No rate-limit quota should be recorded');
});

test('Strict arguments validation: declared arguments for all six tools behave as before without errors', async () => {
  const store = new BoardStore({ persistPath: false });
  const adapter = new BoardToolsAdapter(store);

  const mockTarget = createMockAgent('session-target-1', {
    title: 'Target Session',
    cwd: '/workspace/proj-main'
  });
  mockTarget.status = 'idle';

  const mockCtx = createMockWorkspaceContext({
    agents: {
      get(id) {
        if (id === 'session-target-1') return mockTarget;
        return null;
      },
      list() {
        return [mockTarget];
      },
      create: async (options) => {
        const id = options.sessionId || 'session-new-peer';
        const agent = createMockAgent(id, {
          title: options.title || options.meta?.title || '',
          cwd: options.cwd || options.meta?.cwd || '/workspace/proj-main',
          generation: options.meta?.generation || 1
        });
        agent.status = 'idle';
        return agent;
      }
    }
  });

  const exec = {
    agent: createMockAgent('caller-session-id', {
      title: 'Caller Session',
      cwd: '/workspace/proj-main'
    })
  };

  const tools = buildToolDefinitions(mockCtx, { boardToolsAdapter: adapter });

  const postTool = tools.find(t => t.name === 'board_post');
  const postRes = await postTool.execute({
    topic: 'test-topic',
    content: 'test-content',
    tags: ['tag1'],
    ttl: 3600,
    metadata: { key: 'val' }
  }, exec);
  assert.equal(postRes.success, true);
  assert.ok(postRes.postId);

  const listTool = tools.find(t => t.name === 'board_list');
  const listRes = await listTool.execute({
    id: postRes.postId,
    topic: 'test-topic',
    topic_prefix: 'test',
    tag: 'tag1',
    active_only: true,
    cross_workspace: false,
    titles_only: true,
    limit: 10
  }, exec);
  assert.equal(listRes.success, true);

  const clearTool = tools.find(t => t.name === 'board_clear');
  const clearRes = await clearTool.execute({
    id: postRes.postId,
    mode: 'dismiss'
  }, exec);
  assert.equal(clearRes.success, true);

  const queryTool = tools.find(t => t.name === 'session_query');
  const queryRes = await queryTool.execute({
    query: 'target',
    running_only: false,
    cross_workspace: false,
    top_level_only: true,
    limit: 10
  }, exec);
  assert.equal(queryRes.success, true);

  const callTool = tools.find(t => t.name === 'session_call');
  const callRes = await callTool.execute({
    target_session_id: 'session-target-1',
    message: 'hello target',
    call_type: 'task_dispatch',
    context_post_ids: []
  }, exec);
  assert.equal(callRes.success, true);

  const createTool = tools.find(t => t.name === 'session_create');
  const createRes = await createTool.execute({
    title: 'Valid Peer Session',
    initial_message: 'start working',
    context_post_ids: [],
    model: 'gpt-4o',
    reasoning_effort: 'medium',
    preset: 'default',
    workspace: '/workspace/proj-main',
    wait_ms: 0
  }, exec);
  assert.equal(createRes.success, true);
});