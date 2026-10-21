import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionDirectory, executeSessionQuery, resolveNativeSessionStatus, classifyError } from '../lib/session-directory.mjs';
import { createMockAgent } from './helpers/mock-agent.mjs';
import { normalizeWorkspace } from '../lib/board-store.mjs';

function createMockCordis(liveAgents = [], archivedIds = []) {
  const archivedSet = new Set(archivedIds);
  return {
    agents: {
      list: () => liveAgents,
      get: (id) => liveAgents.find(a => a.id === id) || null,
      resume: async ({ resumeSessionId }) => {
        const found = liveAgents.find(a => a.id === resumeSessionId);
        return found ? { agent: found } : null;
      }
    },
    workspaceRegistry: {
      archivedSessionIds: archivedSet
    },
    get(name) {
      if (name === 'agents') return this.agents;
      if (name === 'workspaceRegistry') return this.workspaceRegistry;
      return null;
    }
  };
}


test('SessionDirectory: resolveCwd and resolveWorkspace', () => {
  const dir = new SessionDirectory({});
  const agent1 = createMockAgent({ id: 's-1', cwd: 'C:\\Projects\\Repo' });
  assert.equal(dir.resolveCwd(agent1), 'C:\\Projects\\Repo');
  assert.equal(dir.resolveWorkspace(agent1), 'c:/Projects/Repo');

  const agentEmpty = { id: 's-empty' };
  assert.equal(dir.resolveCwd(agentEmpty), '');
  assert.equal(dir.resolveWorkspace(agentEmpty), '');
});

test('SessionDirectory: resolveShortId', () => {
  const dir = new SessionDirectory({});
  assert.equal(dir.resolveShortId('session-a1b2c3d4-e5f6'), 'a1b2c3d4');
  assert.equal(dir.resolveShortId('1234567890'), '12345678');
  assert.equal(dir.resolveShortId(''), 'unknown');
  assert.equal(dir.resolveShortId(null), 'unknown');
});

test('SessionDirectory: resolveTitle with fallbacks', () => {
  const dir = new SessionDirectory({});
  
  // 显式标题直接提取
  const a1 = createMockAgent({ id: 's-1', title: 'Main Agent' });
  assert.equal(dir.resolveTitle(a1), 'Main Agent');

  // 事件日志标题回退
  const a2 = {
    id: 's-2',
    session: {
      id: 's-2',
      events: [
        { type: 'session/other' },
        { type: 'session/title', data: { title: 'Event-Sourced Title' } }
      ]
    }
  };
  assert.equal(dir.resolveTitle(a2), 'Event-Sourced Title');

  // 规范化兜底展示标题
  const a3 = { id: 'session-fedcba98' };
  assert.equal(dir.resolveDisplayTitle(a3), 'Agent fedcba98');
});

test('SessionDirectory: resolveIdentity returns complete metadata', () => {
  const dir = new SessionDirectory({});
  const agent = createMockAgent({
    id: 'session-42',
    title: 'Worker',
    cwd: '/home/user/repo',
    status: 'running',
    origin: 'subagent'
  });

  const idInfo = dir.resolveIdentity(agent);
  assert.equal(idInfo.sessionId, 'session-42');
  assert.equal(idInfo.title, 'Worker');
  assert.equal(idInfo.displayTitle, 'Worker');
  assert.equal(idInfo.shortId, '42');
  assert.equal(idInfo.cwd, '/home/user/repo');
  assert.equal(idInfo.workspace, '/home/user/repo');
  assert.equal(idInfo.status, 'running');
  assert.equal(idInfo.isSubagent, true);
});

test('SessionDirectory: listActiveSessions with workspace and status filters', () => {
  const a1 = createMockAgent({ id: 's-1', title: 'A1', cwd: '/app/repo1', status: 'running' });
  const a2 = createMockAgent({ id: 's-2', title: 'A2', cwd: '/app/repo1', status: 'idle' });
  const a3 = createMockAgent({ id: 's-3', title: 'A3', cwd: '/app/repo2', status: 'running' });
  const aSub = createMockAgent({ id: 's-sub', title: 'Sub', cwd: '/app/repo1', origin: 'subagent' });
  const aArchived = createMockAgent({ id: 's-old', title: 'Old', cwd: '/app/repo1' });

  const ctx = createMockCordis([a1, a2, a3, aSub, aArchived], ['s-old']);
  const dir = new SessionDirectory(ctx);

  // 工作区隔离过滤（排除异地工作区、子代理与归档项）
  const list1 = dir.listActiveSessions({ workspace: '/app/repo1' });
  assert.equal(list1.length, 2);
  assert.deepEqual(list1.map(s => s.sessionId), ['s-1', 's-2']);

  // 仅活跃状态过滤
  const listRunning = dir.listActiveSessions({ workspace: '/app/repo1', runningOnly: true });
  assert.equal(listRunning.length, 1);
  assert.equal(listRunning[0].sessionId, 's-1');

  // 跨工作区透视查询
  const listAll = dir.listActiveSessions({ crossWorkspace: true });
  assert.equal(listAll.length, 3);
  assert.deepEqual(listAll.map(s => s.sessionId), ['s-1', 's-2', 's-3']);
});

test('SessionDirectory: inspectWorkspace for quota and active title tracking (running quota vs unarchived titles)', () => {
  // a1 is running, a2 is idle; both in /app/repo
  const a1 = createMockAgent({ id: 's-1', title: 'Planning Agent', cwd: '/app/repo', status: 'running' });
  const a2 = createMockAgent({ id: 's-2', title: 'Execution Agent', cwd: '/app/repo', status: 'idle' });
  const aOther = createMockAgent({ id: 's-3', title: 'Other', cwd: '/other/repo', status: 'running' });

  const ctx = createMockCordis([a1, a2, aOther]);
  const dir = new SessionDirectory(ctx);

  const res = dir.inspectWorkspace('/app/repo');
  // Concurrency quota count strictly reflects running sessions (1)
  assert.equal(res.count, 1);
  // Title deduplication tracks all unarchived workspace sessions (both running and idle)
  assert.ok(res.activeTitles.has('planning agent'));
  assert.ok(res.activeTitles.has('execution agent'));
  assert.equal(res.activeTitles.has('other'), false);
});

test('SessionDirectory: resolveTarget with exact match, prefix match, and guards', async () => {
  const a1 = createMockAgent({ id: 'session-12345678-aaaa', title: 'Alpha', cwd: '/repo' });
  const a2 = createMockAgent({ id: 'session-12345678-bbbb', title: 'Beta', cwd: '/repo' });
  const a3 = createMockAgent({ id: 'session-99999999-cccc', title: 'Gamma', cwd: '/repo' });

  const ctx = createMockCordis([a1, a2, a3]);
  const dir = new SessionDirectory(ctx);

  // 通配符拦截保护
  await assert.rejects(
    () => dir.resolveTarget('*'),
    /\[WildcardForbidden\]/
  );

  // 自呼叫拦截保护
  await assert.rejects(
    () => dir.resolveTarget('session-12345678-aaaa', { callerSessionId: 'session-12345678-aaaa' }),
    /\[SelfCallForbidden\]/
  );

  // 自呼叫前缀拦截忽略同前缀已归档项
  const ctxWithArchived = createMockCordis(
    [a1, createMockAgent({ id: 'session-12345678-archived', title: 'Archived Same Prefix' })],
    ['session-12345678-archived']
  );
  const dirArchived = new SessionDirectory(ctxWithArchived);
  await assert.rejects(
    () => dirArchived.resolveTarget('session-12345678', { callerSessionId: 'session-12345678-aaaa' }),
    /\[SelfCallForbidden\]/
  );

  // 精确匹配
  const exact = await dir.resolveTarget('session-99999999-cccc', { callerSessionId: 'caller-1' });
  assert.equal(exact.targetAgent.id, 'session-99999999-cccc');
  assert.equal(exact.targetTitle, 'Gamma');

  // 歧义多重前缀拦截
  await assert.rejects(
    () => dir.resolveTarget('session-12345678', { callerSessionId: 'caller-1' }),
    /\[AmbiguousPrefix\]/
  );

  // 唯一前缀（>= 8 位）安全命中
  const prefix = await dir.resolveTarget('session-99999999', { callerSessionId: 'caller-1' });
  assert.equal(prefix.targetAgent.id, 'session-99999999-cccc');

  // 短前缀（< 8 位）防御拦截
  await assert.rejects(
    () => dir.resolveTarget('session', { callerSessionId: 'caller-1' }),
    /\[InvalidParameter\]/
  );

  // 未找到目标会话
  await assert.rejects(
    () => dir.resolveTarget('session-00000000', { callerSessionId: 'caller-1' }),
    /\[TargetNotFound\]/
  );
});

test('SessionDirectory.prototype.query: 完整状态统计与元数据汇总契约', () => {
  const wsA = 'c:/workspace/proj-a';
  const wsB = 'c:/workspace/proj-b';

  const a1 = createMockAgent({ id: 's-running-1', status: 'running', cwd: wsA });
  const a2 = createMockAgent({ id: 's-running-2', status: 'running', cwd: wsA });
  const a3 = createMockAgent({ id: 's-idle-1', status: 'idle', cwd: wsA });
  const a4 = createMockAgent({ id: 's-other-ws', status: 'running', cwd: wsB });

  const ctx = createMockCordis([a1, a2, a3, a4]);
  const dir = new SessionDirectory(ctx);

  const callerAgent = createMockAgent({ id: 's-caller', cwd: wsA });
  const res = dir.query({}, { agent: callerAgent });

  assert.equal(res.success, true);
  assert.equal(res.count, 3);
  assert.equal(res.totalCount, 3);
  assert.equal(res.activeCount, 2);
  assert.equal(res.idleCount, 1);
  assert.equal(res.scope, normalizeWorkspace(wsA));
  assert.equal(res.sessions.length, 3);

  // 跨工作区查询
  const globalRes = dir.query({ cross_workspace: true }, { agent: callerAgent });
  assert.equal(globalRes.count, 4);
  assert.equal(globalRes.totalCount, 4);
  assert.equal(globalRes.activeCount, 3);
  assert.equal(globalRes.idleCount, 1);
  assert.equal(globalRes.scope, 'global');

  // 未提供 callerAgent 时回退到 normalizeWorkspace(process.cwd())
  const fallbackRes = dir.query({}, {});
  assert.equal(fallbackRes.scope, normalizeWorkspace(process.cwd()));
});

test('executeSessionQuery 模块函数导出: 兼容对象参数与位置参数重载', () => {
  const ws = 'c:/workspace/proj-a';
  const a1 = createMockAgent({ id: 's-fn-1', status: 'running', cwd: ws });
  const a2 = createMockAgent({ id: 's-fn-2', status: 'idle', cwd: ws });

  const ctx = createMockCordis([a1, a2]);
  const caller = createMockAgent({ id: 's-caller', cwd: ws });

  // 1. 对象包装形式
  const objRes = executeSessionQuery({
    ctx,
    args: { running_only: true },
    exec: { agent: caller }
  });
  assert.equal(objRes.count, 1);
  assert.equal(objRes.activeCount, 1);
  assert.equal(objRes.idleCount, 0);

  // 2. 位置参数形式
  const posRes = executeSessionQuery(ctx, {}, { agent: caller });
  assert.equal(posRes.count, 2);
  assert.equal(posRes.activeCount, 1);
  assert.equal(posRes.idleCount, 1);
});

test('resolveNativeSessionStatus: running 状态判定与原生 phase 优先原则', () => {
  // 1. phase.kind 为 running
  const runningAgent = {
    id: 's-run',
    status: 'idle',
    phase: { kind: 'running', turn: 1 }
  };
  assert.deepEqual(resolveNativeSessionStatus(runningAgent), { status: 'running', error: null });

  // 2. agent.status 为 running
  const runningStatusAgent = {
    id: 's-status-run',
    status: 'running',
    phase: { kind: 'idle' }
  };
  assert.deepEqual(resolveNativeSessionStatus(runningStatusAgent), { status: 'running', error: null });
});

test('resolveNativeSessionStatus: 崩溃会话精准推导为 error 并提取原生错误信息', () => {
  const crashedAgent = {
    id: 's-crash',
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 1 },
    session: {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        {
          type: 'turn/end',
          data: {
            turn: 1,
            reason: {
              kind: 'error',
              error: { message: 'Plugin hook threw unhandled exception', code: 'HOOK_CRASH' }
            }
          }
        }
      ]
    }
  };

  const res = resolveNativeSessionStatus(crashedAgent);
  assert.equal(res.status, 'error');
  assert.equal(res.error.code, 'HOOK_CRASH');
  assert.equal(res.error.message, 'Plugin hook threw unhandled exception');
});

test('resolveNativeSessionStatus: 新轮次顺利结束实现原生事件冲刷自然自愈', () => {
  const recoveringAgent = {
    id: 's-recover',
    status: 'idle',
    phase: { kind: 'idle', lastTurn: 2 },
    session: {
      events: [
        // 轮次 1: 崩溃
        {
          type: 'turn/end',
          data: {
            turn: 1,
            reason: { kind: 'error', error: { message: 'Initial crash', code: 'INIT_FAIL' } }
          }
        },
        // 轮次 2: 修复后正常跑通
        {
          type: 'turn/end',
          data: {
            turn: 2,
            reason: { kind: 'completed' }
          }
        }
      ]
    }
  };

  const res = resolveNativeSessionStatus(recoveringAgent);
  assert.equal(res.status, 'idle');
  assert.equal(res.error, null);
});

test('SessionDirectory.prototype.query: 准确识别 error 会话并在返回中暴露 error 详情与 errorCount', () => {
  const ws = 'c:/workspace/proj-status';
  const aHealthy = createMockAgent({ id: 's-healthy', status: 'idle', cwd: ws });
  const aRunning = createMockAgent({ id: 's-running', status: 'running', cwd: ws });
  const aCrashed = {
    id: 's-crashed',
    title: 'Crashed Agent',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      id: 's-crashed',
      title: 'Crashed Agent',
      header: { cwd: ws, origin: undefined },
      events: [
        {
          type: 'turn/end',
          data: {
            turn: 1,
            reason: { kind: 'error', error: { message: 'Context window overflow', code: 'CONTEXT_OVERFLOW' } }
          }
        }
      ]
    }
  };

  const ctx = createMockCordis([aHealthy, aRunning, aCrashed]);
  const dir = new SessionDirectory(ctx);
  const caller = createMockAgent({ id: 's-caller', cwd: ws });

  const queryRes = dir.query({}, { agent: caller });
  assert.equal(queryRes.success, true);
  assert.equal(queryRes.totalCount, 3);
  assert.equal(queryRes.activeCount, 1);
  assert.equal(queryRes.idleCount, 1);
  assert.equal(queryRes.errorCount, 1);

  const crashedSession = queryRes.sessions.find(s => s.sessionId === 's-crashed');
  assert.ok(crashedSession);
  assert.equal(crashedSession.status, 'error');
  assert.equal(crashedSession.error.code, 'CONTEXT_OVERFLOW');
  assert.equal(crashedSession.error.message, 'Context window overflow');
});

test('resolveNativeSessionStatus 逆境测试: 事件账本包含畸变、空项与非法对象时安全容错 (ADR-0031)', () => {
  // 1. session.events 包含 null、undefined、数字与非对象
  const corruptedAgent = {
    id: 's-corrupted',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      events: [
        null,
        undefined,
        12345,
        'random-string',
        {},
        { type: 'session/other' },
        null
      ]
    }
  };
  const res1 = resolveNativeSessionStatus(corruptedAgent);
  assert.equal(res1.status, 'idle');
  assert.equal(res1.error, null);

  // 2. agent 自身缺少 session 或缺少 events
  assert.deepEqual(resolveNativeSessionStatus({ id: 'empty-1' }), { status: 'idle', error: null });
  assert.deepEqual(resolveNativeSessionStatus(null), { status: 'idle', error: null });
  assert.deepEqual(resolveNativeSessionStatus(undefined), { status: 'idle', error: null });
});

test('resolveNativeSessionStatus 逆境测试: 异常结构残缺或非标准对象时的格式归一化 (ADR-0031)', () => {
  // 1. reason.error 为纯字符串
  const stringErrAgent = {
    id: 's-str-err',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      events: [
        {
          type: 'turn/end',
          data: {
            reason: { kind: 'error', error: 'Raw string fatal message' }
          }
        }
      ]
    }
  };
  const res1 = resolveNativeSessionStatus(stringErrAgent);
  assert.equal(res1.status, 'error');
  assert.equal(res1.error.message, 'Raw string fatal message');
  assert.equal(res1.error.code, 'TURN_ERROR');

  // 2. reason.error 为 null 或缺省
  const nullErrAgent = {
    id: 's-null-err',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      events: [
        {
          type: 'turn/end',
          data: {
            reason: { kind: 'error', error: null }
          }
        }
      ]
    }
  };
  const res2 = resolveNativeSessionStatus(nullErrAgent);
  assert.equal(res2.status, 'error');
  assert.ok(res2.error.message);
  assert.equal(res2.error.code, 'TURN_ERROR');
});

test('resolveNativeSessionStatus 边界测试: 用户主动取消 (reason.kind === "aborted") 判定为 idle 而非 error (ADR-0031)', () => {
  const abortedAgent = {
    id: 's-aborted',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      events: [
        {
          type: 'turn/end',
          data: {
            turn: 1,
            reason: {
              kind: 'aborted',
              reason: { kind: 'user', message: 'User stopped the run' }
            }
          }
        }
      ]
    }
  };

  const res = resolveNativeSessionStatus(abortedAgent);
  // 人类或系统取消属于正常中途终止，绝不能判定为崩溃误报
  assert.equal(res.status, 'idle');
  assert.equal(res.error, null);
});

test('resolveNativeSessionStatus 与 classifyError: 解析提示词模板装配错误', () => {
  // 1. classifyError 纯函数断言
  const assemblyErr = classifyError('prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")');
  assert.equal(assemblyErr.category, 'ASSEMBLY');
  assert.equal(assemblyErr.code, 'PROMPT_ASSEMBLY_ERROR');
  assert.ok(assemblyErr.message.includes('prompt variable "{{model}}"'));

  const dispatchErr = classifyError(new Error('Target Agent provides no native dispatch method (followup)'));
  assert.equal(dispatchErr.category, 'DISPATCH');
  assert.equal(dispatchErr.code, 'DISPATCH_ERROR');

  const timeoutErr = classifyError({ code: 'TIMEOUT', message: 'Handshake timed out' });
  assert.equal(timeoutErr.category, 'TIMEOUT');

  const runtimeErr = classifyError(new Error('Model execution stack overflow'));
  assert.equal(runtimeErr.category, 'RUNTIME');

  // 2. session.events 穿透捕获装配崩溃
  const agentWithAssemblyEvent = {
    id: 's-assembly-crashed',
    status: 'idle',
    phase: { kind: 'idle' },
    session: {
      events: [
        {
          type: 'turn/end',
          data: {
            turn: 1,
            reason: {
              kind: 'error',
              error: {
                message: 'prompt variable "{{model}}" has no value for this assembly (section "deployment:persona-prefix")',
                code: 'UNKNOWN'
              }
            }
          }
        }
      ]
    }
  };
  const resEvent = resolveNativeSessionStatus(agentWithAssemblyEvent);
  assert.equal(resEvent.status, 'error');
  assert.equal(resEvent.error.category, 'ASSEMBLY');
  assert.ok(resEvent.error.message.includes('prompt variable'));

  // 3. 宿主直接错误属性 directError 探测
  const agentWithDirectError = {
    id: 's-direct-err',
    status: 'idle',
    phase: { kind: 'idle' },
    lastError: { message: 'template compile error in deployment', code: 'ASSEMBLY_FAIL' }
  };
  const resDirect = resolveNativeSessionStatus(agentWithDirectError);
  assert.equal(resDirect.status, 'error');
  assert.equal(resDirect.error.category, 'ASSEMBLY');
  assert.equal(resDirect.error.code, 'ASSEMBLY_FAIL');
});
