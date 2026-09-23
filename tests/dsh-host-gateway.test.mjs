/**
 * DSH Host Gateway Unit Tests
 *
 * Comprehensive tests for DshHostGateway and host service adapters:
 * - Cordis Host Service Probing (multi-layer fallback, agents, models, presets, titles, workspaces)
 * - Model Resolution (caller inheritance, defaults fallback, override parsing, reasoning effort reset)
 * - Preset & Setup Resolution (composeAgent, resolve/mount, custom setup chaining)
 * - Root Agent Creation (deep freeze safety, metadata isolation, meta cleaning)
 * - Title Event Append (sessionTitle service, fallback session.append)
 * - Workspace Attachment (workspaceRegistry lookup, path normalization, safe error handling)
 * - Facade & Instance Consistency
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DshHostGateway,
  resolveCordisService,
  resolveRootAgentsService,
  resolveEffectiveModel,
  resolvePeerAgentOptions,
  resolvePresetSetup,
  resolvePeerPresetAndSetup,
  createRootAgent,
  appendTitleEvent,
  attachWorkspace
} from '../lib/dsh-host-gateway.mjs';

function createMockSession({
  id = 'session-test-1',
  title = 'Test Session',
  cwd = '/workspaces/project-1',
  frozenHeader = false,
  metadata = {}
} = {}) {
  const header = { cwd, title };
  if (frozenHeader) {
    Object.freeze(header);
  }

  const appendedEvents = [];
  return {
    id,
    title,
    header,
    metadata: { ...metadata },
    append: async (type, payload) => {
      appendedEvents.push({ type, payload });
      return { id: `evt-${appendedEvents.length}` };
    },
    _appendedEvents: appendedEvents
  };
}

function createMockAgent({
  id = 'agent-test-1',
  title = 'Test Agent',
  cwd = '/workspaces/project-1',
  generation = 0,
  options = {},
  frozenHeader = false,
  metadata = {}
} = {}) {
  const session = createMockSession({ id, title, cwd, frozenHeader, metadata });
  return {
    id,
    title,
    generation,
    options,
    session,
    _session: session
  };
}

// -----------------------------------------------------------------------------
// 1. Cordis 宿主服务探测 (Host Service Probing)
// -----------------------------------------------------------------------------

test('Host Probing - resolveCordisService: 多层回退探测机制', () => {
  // 1. ctx.get('name', false)
  const mockSvc1 = { name: 'svc1' };
  const ctx1 = {
    get: (name, active) => {
      assert.equal(active, false);
      return name === 'target' ? mockSvc1 : undefined;
    }
  };
  assert.equal(resolveCordisService(ctx1, 'target'), mockSvc1);

  // 2. ctx.root.get('name', false)
  const mockSvc2 = { name: 'svc2' };
  const ctx2 = {
    root: {
      get: (name, active) => {
        assert.equal(active, false);
        return name === 'target' ? mockSvc2 : undefined;
      }
    }
  };
  assert.equal(resolveCordisService(ctx2, 'target'), mockSvc2);

  // 3. direct property ctx[name]
  const mockSvc3 = { name: 'svc3' };
  const ctx3 = { target: mockSvc3 };
  assert.equal(resolveCordisService(ctx3, 'target'), mockSvc3);

  // 4. direct property ctx.root[name]
  const mockSvc4 = { name: 'svc4' };
  const ctx4 = { root: { target: mockSvc4 } };
  assert.equal(resolveCordisService(ctx4, 'target'), mockSvc4);

  // 5. 不存在服务或 ctx 为空
  assert.equal(resolveCordisService(null, 'target'), undefined);
  assert.equal(resolveCordisService(undefined, 'target'), undefined);
  assert.equal(resolveCordisService({}, 'nonexistent'), undefined);

  // 6. get() 抛出异常时不崩溃
  const ctxThrow = {
    get: () => { throw new Error('cordis internal error'); }
  };
  assert.equal(resolveCordisService(ctxThrow, 'target'), undefined);
});

test('Host Probing - resolveRootAgentsService: 根级 Agents 服务深度探测', () => {
  const mockAgents = { create: async () => ({}) };

  // ctx.root.get('agents', false)
  const ctx1 = { root: { get: (name) => name === 'agents' ? mockAgents : null } };
  assert.equal(resolveRootAgentsService(ctx1), mockAgents);

  // ctx.root.agents
  const ctx2 = { root: { agents: mockAgents } };
  assert.equal(resolveRootAgentsService(ctx2), mockAgents);

  // ctx.get('agents', false)
  const ctx3 = { get: (name) => name === 'agents' ? mockAgents : null };
  assert.equal(resolveRootAgentsService(ctx3), mockAgents);

  // ctx.agents
  const ctx4 = { agents: mockAgents };
  assert.equal(resolveRootAgentsService(ctx4), mockAgents);

  // exec.agent.ctx.root 兜底
  const ctx5 = {};
  const exec5 = {
    agent: {
      ctx: {
        root: {
          get: (name) => name === 'agents' ? mockAgents : null
        }
      }
    }
  };
  assert.equal(resolveRootAgentsService(ctx5, exec5), mockAgents);
});

// -----------------------------------------------------------------------------
// 2. 有效模型解析 (resolveEffectiveModel)
// -----------------------------------------------------------------------------

test('Effective Model - 继承调用方模型与默认回退', () => {
  // 无调用方配置，回退全局 agentDefaultModel
  const ctxWithDefault = {
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'anthropic', model: 'claude-3-5-sonnet', reasoningEffort: 'medium' })
    }
  };
  const gateway = new DshHostGateway(ctxWithDefault);
  const res1 = gateway.resolveEffectiveModel();
  assert.deepEqual(res1, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    reasoningEffort: 'medium'
  });

  // 支持 agentDefaultModel.selection 对象
  const ctxSelection = {
    agentDefaultModel: {
      selection: { provider: 'openai', model: 'gpt-4o' }
    }
  };
  const resSelection = new DshHostGateway(ctxSelection).resolveEffectiveModel();
  assert.deepEqual(resSelection, { provider: 'openai', model: 'gpt-4o' });

  // 继承 callerAgent.options
  const callerAgent = createMockAgent({
    options: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0.7
    }
  });
  const res2 = gateway.resolveEffectiveModel({ callerAgent });
  assert.equal(res2.provider, 'deepseek');
  assert.equal(res2.model, 'deepseek-chat');
  assert.equal(res2.temperature, 0.7);

  // 支持 callerAgent.session.requestHeader().config 覆盖
  const callerWithHeader = {
    ...callerAgent,
    session: {
      requestHeader: () => ({
        config: {
          provider: 'custom-prov',
          model: 'custom-model',
          reasoningEffort: 'high'
        }
      })
    }
  };
  const resHeader = gateway.resolveEffectiveModel({ callerAgent: callerWithHeader });
  assert.equal(resHeader.provider, 'custom-prov');
  assert.equal(resHeader.model, 'custom-model');
  assert.equal(resHeader.reasoningEffort, 'high');
});

test('Effective Model - 显式入参覆盖与模型/推理强度重置', () => {
  const gateway = new DshHostGateway();
  const callerAgent = createMockAgent({
    options: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'high'
    }
  });

  // 1. 'provider/model' 格式
  const resSlash = gateway.resolveEffectiveModel({
    callerAgent,
    model: 'google/gemini-2.0-flash'
  });
  assert.equal(resSlash.provider, 'google');
  assert.equal(resSlash.model, 'gemini-2.0-flash');
  // 模型切换且未指定推理强度时，清空原有推理强度
  assert.equal(resSlash.reasoningEffort, undefined);

  // 2. 'provider:model' 格式
  const resColon = gateway.resolveEffectiveModel({
    callerAgent,
    model: 'bedrock:claude-3-haiku'
  });
  assert.equal(resColon.provider, 'bedrock');
  assert.equal(resColon.model, 'claude-3-haiku');
  assert.equal(resColon.reasoningEffort, undefined);

  // 3. 纯模型名称（保留原 provider）
  const resPure = gateway.resolveEffectiveModel({
    callerAgent,
    model: 'deepseek-reasoner'
  });
  assert.equal(resPure.provider, 'deepseek');
  assert.equal(resPure.model, 'deepseek-reasoner');
  assert.equal(resPure.reasoningEffort, undefined);

  // 4. 显式指定 reasoningEffort 覆写
  const resEffort = gateway.resolveEffectiveModel({
    callerAgent,
    model: 'deepseek-reasoner',
    reasoningEffort: 'low'
  });
  assert.equal(resEffort.reasoningEffort, 'low');

  // 5. 别名与独立函数 resolvePeerAgentOptions 一致性
  const resAlias = resolvePeerAgentOptions({
    callerAgent,
    model: 'google/gemini-2.0-pro'
  });
  assert.equal(resAlias.provider, 'google');
  assert.equal(resAlias.model, 'gemini-2.0-pro');
});

// -----------------------------------------------------------------------------
// 3. 预设与设置解析 (resolvePresetSetup)
// -----------------------------------------------------------------------------

test('Preset & Setup - 解析预设候选来源与 sessionController 组合', async () => {
  let composedArg = null;
  const mockSessionController = {
    agents: {
      composeAgent: async (presetId) => {
        composedArg = presetId;
        return {
          agentPreset: 'composed-preset-id',
          setup: async (agentCtx) => {
            agentCtx.installed = true;
          }
        };
      }
    }
  };

  const ctx = {
    sessionController: mockSessionController
  };
  const gateway = new DshHostGateway(ctx);

  // 显式 args.preset
  const res1 = await gateway.resolvePresetSetup({ args: { preset: 'coder' } });
  assert.equal(composedArg, 'coder');
  assert.equal(res1.presetId, 'composed-preset-id');
  assert.equal(typeof res1.setup, 'function');

  const testAgentCtx = {};
  await res1.setup(testAgentCtx);
  assert.equal(testAgentCtx.installed, true);

  // 从 callerAgent 继承 preset
  const callerAgent = createMockAgent();
  callerAgent.session.metadata.agentPreset = 'architect';
  const res2 = await gateway.resolvePresetSetup({ callerAgent });
  assert.equal(composedArg, 'architect');
  assert.equal(res2.presetId, 'composed-preset-id');
});

test('Preset & Setup - 回退 agentPresets.resolve 与挂载钩子', async () => {
  let mountedWith = null;
  let installedCalled = false;

  const mockAgentPresets = {
    resolve: async (presetId) => ({ id: `resolved-${presetId}` }),
    mount: async (agentCtx, presetId) => {
      mountedWith = presetId;
    }
  };
  const mockSessionController = {
    agents: {
      installSelection: (agentCtx) => {
        installedCalled = true;
      }
    }
  };

  const ctx = {
    agentPresets: mockAgentPresets,
    sessionController: mockSessionController
  };
  const gateway = new DshHostGateway(ctx);

  const res = await gateway.resolvePresetSetup({ args: { preset: 'researcher' } });
  assert.equal(res.presetId, 'resolved-researcher');
  assert.equal(typeof res.setup, 'function');

  const testCtx = {};
  await res.setup(testCtx);
  assert.equal(installedCalled, true);
  assert.equal(mountedWith, 'resolved-researcher');
});

test('Preset & Setup - 支持组合自定义 setup 扩展', async () => {
  const steps = [];
  const mockSessionController = {
    agents: {
      composeAgent: async () => ({
        agentPreset: 'base-preset',
        setup: async () => { steps.push('host-setup'); }
      })
    }
  };

  const ctx = { sessionController: mockSessionController };
  const gateway = new DshHostGateway(ctx);

  const customSetup = async () => { steps.push('custom-setup'); };
  const res = await gateway.resolvePresetSetup({
    args: { preset: 'base' },
    options: { setup: customSetup }
  });

  await res.setup({});
  assert.deepEqual(steps, ['host-setup', 'custom-setup']);
});

// -----------------------------------------------------------------------------
// 4. 根智能体创建 (createRootAgent) - 冻结安全与元数据隔离
// -----------------------------------------------------------------------------

test('createRootAgent - 严格验证 agentsService 可用性', async () => {
  const gateway = new DshHostGateway({});
  await assert.rejects(
    () => gateway.createRootAgent({}),
    { message: /\[ServiceUnavailable\].*agents.*create/i }
  );
});

test('createRootAgent - 构造干净 meta，彻底清洗 origin 和 parentSession', async () => {
  let capturedPayload = null;
  const mockAgentsService = {
    create: async (payload) => {
      capturedPayload = payload;
      return createMockAgent({ id: payload.sessionId });
    }
  };

  const gateway = new DshHostGateway({});
  await gateway.createRootAgent({
    agentsService: mockAgentsService,
    sessionId: 'session-root-123',
    title: 'Root Peer Session',
    cwd: '/workspace/demo',
    generation: 1,
    creatorSessionId: 'caller-session-999',
    agentOptions: { provider: 'test', model: 'test' },
    presetId: 'coder'
  });

  assert.ok(capturedPayload);
  assert.equal(capturedPayload.sessionId, 'session-root-123');
  assert.equal(capturedPayload.title, 'Root Peer Session');
  assert.equal(capturedPayload.cwd, '/workspace/demo');
  assert.deepEqual(capturedPayload.agentOptions, { provider: 'test', model: 'test' });

  // 严格校验 meta 属性
  assert.equal(capturedPayload.meta.title, 'Root Peer Session');
  assert.equal(capturedPayload.meta.cwd, '/workspace/demo');
  assert.equal(capturedPayload.meta.generation, 1);
  assert.equal(capturedPayload.meta.creatorSessionId, 'caller-session-999');
  assert.equal(capturedPayload.meta.agentPreset, 'coder');
  assert.equal(capturedPayload.meta.origin, undefined, 'meta.origin 必须被隔离移除');
  assert.equal(capturedPayload.meta.parentSession, undefined, 'meta.parentSession 必须被隔离移除');
});

test('createRootAgent - 宿主 SessionHeader 深度冻结 (deepFreeze) 防御安全', async () => {
  const mockAgentsService = {
    create: async (payload) => {
      // 模拟宿主底层返回已冻结的 header（如 Object.freeze）
      return createMockAgent({
        id: payload.sessionId,
        title: 'Original Title',
        cwd: '/orig/cwd',
        frozenHeader: true
      });
    }
  };

  const gateway = new DshHostGateway({});
  // 必须平稳执行，不能抛出 TypeError: Cannot assign to read only property
  const agent = await gateway.createRootAgent({
    agentsService: mockAgentsService,
    sessionId: 'session-frozen-test',
    title: 'New Dynamic Title',
    cwd: '/new/cwd',
    generation: 1,
    creatorSessionId: 'caller-1'
  });

  assert.ok(agent);
  assert.equal(agent.id, 'session-frozen-test');
  assert.equal(agent.title, 'New Dynamic Title');
  // 确认在 header 冻结情况下未被破坏性写入，避免抛异常
  assert.ok(Object.isFrozen(agent.session.header));
  assert.equal(agent.session.title, 'New Dynamic Title');
});

test('createRootAgent - 协作元数据挂载至 session.metadata 且与底层隔离', async () => {
  const mockAgentsService = {
    create: async (payload) => {
      const raw = createMockAgent({ id: payload.sessionId, frozenHeader: false });
      return raw;
    }
  };

  const gateway = new DshHostGateway({});
  const agent = await gateway.createRootAgent({
    agentsService: mockAgentsService,
    sessionId: 'session-meta-test',
    title: 'Dynamic Agent',
    cwd: '/workspace/repo',
    generation: 2,
    creatorSessionId: 'caller-agent-parent',
    presetId: 'data-scientist'
  });

  // 非冻结状态下 header 被正常更新
  assert.equal(agent.session.header.title, 'Dynamic Agent');
  assert.equal(agent.session.header.cwd, '/workspace/repo');
  assert.equal(agent.session.header.agentPreset, 'data-scientist');

  // metadata 隔离与挂载
  assert.ok(agent.session.metadata);
  assert.equal(agent.session.metadata.generation, 2);
  assert.equal(agent.session.metadata.creatorSessionId, 'caller-agent-parent');
  assert.equal(agent.session.metadata.origin, 'peer_created');
  assert.equal(agent.session.metadata.agentPreset, 'data-scientist');
});

// -----------------------------------------------------------------------------
// 5. 标题持久化 (appendTitleEvent - ADR-0017)
// -----------------------------------------------------------------------------

test('Title Event - 优先使用 sessionTitle.rename 服务', async () => {
  let renameCalled = false;
  let renamedTarget = null;
  let renamedTitle = null;

  const mockSessionTitle = {
    rename: async (targetSession, title) => {
      renameCalled = true;
      renamedTarget = targetSession;
      renamedTitle = title;
    }
  };

  const ctx = { sessionTitle: mockSessionTitle };
  const gateway = new DshHostGateway(ctx);
  const agent = createMockAgent();

  const success = await gateway.appendTitleEvent(agent, 'New Session Title');
  assert.equal(success, true);
  assert.equal(renameCalled, true);
  assert.equal(renamedTarget, agent.session);
  assert.equal(renamedTitle, 'New Session Title');
  // 未触发 fallback session.append
  assert.equal(agent.session._appendedEvents.length, 0);
});

test('Title Event - 回退至 session.append("session/title") 事件流', async () => {
  const ctx = {}; // 无 sessionTitle 服务
  const gateway = new DshHostGateway(ctx);
  const agent = createMockAgent();

  const success = await gateway.appendTitleEvent(agent, 'Appended Title');
  assert.equal(success, true);
  assert.equal(agent.session._appendedEvents.length, 1);
  const evt = agent.session._appendedEvents[0];
  assert.equal(evt.type, 'session/title');
  assert.deepEqual(evt.payload, {
    title: 'Appended Title',
    messageSeqs: [],
    source: { kind: 'user' }
  });
});

test('Title Event - 容错处理：宿主 rename 抛错自动回退 append', async () => {
  const mockSessionTitle = {
    rename: async () => {
      throw new Error('sessionTitle.rename network error');
    }
  };
  const ctx = { sessionTitle: mockSessionTitle };
  const gateway = new DshHostGateway(ctx);
  const agent = createMockAgent();

  const success = await gateway.appendTitleEvent(agent, 'Resilient Title');
  assert.equal(success, true);
  // 自动回退触发了 session.append
  assert.equal(agent.session._appendedEvents.length, 1);
  assert.equal(agent.session._appendedEvents[0].payload.title, 'Resilient Title');
});

test('Title Event - 容错处理：append 抛错不中断流程', async () => {
  const ctx = {};
  const gateway = new DshHostGateway(ctx);
  const agent = createMockAgent();
  agent.session.append = async () => {
    throw new Error('disk full');
  };

  const success = await gateway.appendTitleEvent(agent, 'Safe Title');
  assert.equal(success, false);
});

// -----------------------------------------------------------------------------
// 6. 工作区挂载 (attachWorkspace)
// -----------------------------------------------------------------------------

test('Workspace Attachment - 成功匹配工作区并挂载会话', async () => {
  let attachedSessionId = null;
  const mockWorkspace = {
    id: 'ws-alpha',
    path: '/workspaces/project-alpha',
    attachSession: async (sid) => {
      attachedSessionId = sid;
    }
  };
  const mockRegistry = {
    list: () => [mockWorkspace]
  };

  const ctx = { workspaceRegistry: mockRegistry };
  const gateway = new DshHostGateway(ctx);

  const success = await gateway.attachWorkspace('session-target-1', '/workspaces/project-alpha');
  assert.equal(success, true);
  assert.equal(attachedSessionId, 'session-target-1');
});

test('Workspace Attachment - 路径斜杠大小写规范化与未命中处理', async () => {
  const mockWorkspace = {
    id: 'ws-beta',
    path: 'C:\\Projects\\ProjectBeta',
    attachSession: async () => {}
  };
  const mockRegistry = {
    list: () => [mockWorkspace]
  };

  const ctx = { workspaceRegistry: mockRegistry };
  const gateway = new DshHostGateway(ctx);

  // 跨平台斜杠与规范化匹配
  const successMatched = await gateway.attachWorkspace('session-1', 'c:/Projects/ProjectBeta');
  assert.equal(successMatched, true);

  // 未找到对应工作区
  const successMissing = await gateway.attachWorkspace('session-2', '/unknown/path');
  assert.equal(successMissing, false);
});

test('Workspace Attachment - 容错保护：attachSession 抛错不向外抛异常', async () => {
  const mockWorkspace = {
    id: 'ws-err',
    path: '/workspaces/faulty',
    attachSession: async () => {
      throw new Error('database locked');
    }
  };
  const mockRegistry = {
    list: () => [mockWorkspace]
  };

  const ctx = { workspaceRegistry: mockRegistry };
  const gateway = new DshHostGateway(ctx);

  const success = await gateway.attachWorkspace('session-faulty', '/workspaces/faulty');
  assert.equal(success, false);
});

// -----------------------------------------------------------------------------
// 7. 独立函数导出与门面一致性 (Functional Adapters)
// -----------------------------------------------------------------------------

test('Functional Adapters - 独立函数与 DshHostGateway 实例行为一致', async () => {
  const ctx = {
    agentDefaultModel: {
      selection: { provider: 'test-prov', model: 'test-model' }
    }
  };

  // 函数模式
  const modelRes = resolveEffectiveModel({ ctx });
  assert.deepEqual(modelRes, { provider: 'test-prov', model: 'test-model' });

  // 独立适配器 createRootAgent
  let created = false;
  const mockAgents = {
    create: async () => {
      created = true;
      return createMockAgent({ id: 's-standalone' });
    }
  };
  const agent = await createRootAgent(ctx, {
    agentsService: mockAgents,
    sessionId: 's-standalone',
    title: 'Standalone Agent'
  });
  assert.equal(created, true);
  assert.equal(agent.id, 's-standalone');

  // 独立适配器 appendTitleEvent
  const titleSuccess = await appendTitleEvent(ctx, agent, 'Updated Title');
  assert.equal(titleSuccess, true);

  // 独立适配器 attachWorkspace
  const wsSuccess = await attachWorkspace(ctx, 's-standalone', '/nonexistent');
  assert.equal(wsSuccess, false);
});
