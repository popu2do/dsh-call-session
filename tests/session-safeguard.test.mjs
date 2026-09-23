import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionSafeguard,
  AdmissionLease,
  SAFEGUARD_CONSTANTS,
  PEER_SESSION_CONSTANTS,
  resetRateLimits,
  resetInFlightCreations
} from '../lib/session-safeguard.mjs';

test('SessionSafeguard - 常量导出与冻结保护', () => {
  assert.ok(SAFEGUARD_CONSTANTS, 'SAFEGUARD_CONSTANTS 应被导出');
  assert.ok(PEER_SESSION_CONSTANTS, 'PEER_SESSION_CONSTANTS 应被导出以保持向后兼容');

  assert.equal(SAFEGUARD_CONSTANTS.MAX_GENERATION, 2);
  assert.equal(SAFEGUARD_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS, 5);
  assert.equal(SAFEGUARD_CONSTANTS.MAX_CREATIONS_PER_MINUTE, 5);

  assert.equal(PEER_SESSION_CONSTANTS.MAX_GENERATION, 2);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_ACTIVE_PEER_SESSIONS, 5);
  assert.equal(PEER_SESSION_CONSTANTS.MAX_CREATIONS_PER_MINUTE, 5);

  assert.ok(Object.isFrozen(SAFEGUARD_CONSTANTS), 'SAFEGUARD_CONSTANTS 应当为只读冻结对象');
  assert.ok(Object.isFrozen(PEER_SESSION_CONSTANTS), 'PEER_SESSION_CONSTANTS 应当为只读冻结对象');

  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('[SYSTEM] Worker'));
  assert.ok(PEER_SESSION_CONSTANTS.PRIVILEGED_PREFIX_REGEX.test('captain: Leader'));
});

test('SessionSafeguard - 代际深度熔断机制 (MAX_GENERATION=2)', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  // callerGen = 0 -> targetGeneration = 1 (允许)
  const lease0 = safeguard.acquire({
    callerSessionId: 'caller-gen0',
    callerGeneration: 0,
    workspace: '/test/workspace',
    title: 'Gen1 Peer'
  });
  assert.ok(lease0 instanceof AdmissionLease);
  assert.equal(lease0.generation, 1);
  lease0.release();

  // callerGen = 1 -> targetGeneration = 2 (允许)
  const lease1 = safeguard.acquire({
    callerSessionId: 'caller-gen1',
    callerGeneration: 1,
    workspace: '/test/workspace',
    title: 'Gen2 Peer'
  });
  assert.ok(lease1 instanceof AdmissionLease);
  assert.equal(lease1.generation, 2);
  lease1.release();

  // callerGen = 2 -> 达到上限，拦截熔断
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: 'caller-gen2',
        callerGeneration: 2,
        workspace: '/test/workspace',
        title: 'Gen3 Peer Blocked'
      });
    },
    {
      message: /[GenerationLimitExceeded].*generation.*2.*limit 2/i
    }
  );

  // callerGen = 3 -> 超过上限，拦截熔断
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: 'caller-gen3',
        callerGeneration: 3,
        workspace: '/test/workspace',
        title: 'Gen4 Peer Blocked'
      });
    },
    {
      message: /[GenerationLimitExceeded].*limit 2/i
    }
  );

  // 验证 checkGeneration 独立校验方法
  assert.equal(safeguard.checkGeneration(0), 1);
  assert.equal(safeguard.checkGeneration(1), 2);
  assert.throws(() => safeguard.checkGeneration(2), /[GenerationLimitExceeded]/);
});

test('SessionSafeguard - 运行态配额控制 (MAX_ACTIVE_PEER_SESSIONS=5)', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const workspaceA = '/test/workspace-a';
  const workspaceB = '/test/workspace-b';

  // 活跃会话数 = 4，尚未达到上限 5，准入成功
  const leaseA1 = safeguard.acquire({
    callerSessionId: 'caller-a',
    callerGeneration: 0,
    workspace: workspaceA,
    activeCount: 4,
    title: 'Session Under Limit'
  });
  assert.ok(leaseA1 instanceof AdmissionLease);
  leaseA1.release();

  // 活跃会话数 = 5，达到上限，拦截准入
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: 'caller-a',
        callerGeneration: 0,
        workspace: workspaceA,
        activeCount: 5,
        title: 'Session At Limit'
      });
    },
    {
      message: /[QuotaExceeded].*limit of 5/i
    }
  );

  // 工作区隔离性：workspaceA 满载不影响 workspaceB
  const leaseB = safeguard.acquire({
    callerSessionId: 'caller-b',
    callerGeneration: 0,
    workspace: workspaceB,
    activeCount: 2,
    title: 'Session In Workspace B'
  });
  assert.ok(leaseB instanceof AdmissionLease);
  leaseB.release();
});

test('SessionSafeguard - 滑动窗口限频 (5次/分钟)', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const callerId = 'rate-limited-caller';
  const baseTime = 1700000000000;
  const leases = [];

  // 同一发起方在 1 分钟内连续申请 5 次均应成功并提交（释放在途，保留限频计数）
  for (let i = 0; i < 5; i++) {
    const lease = safeguard.acquire({
      callerSessionId: callerId,
      callerGeneration: 0,
      workspace: `/test/workspace-${i}`,
      title: `Session Rate ${i}`,
      now: baseTime + i * 1000
    });
    lease.commit();
    leases.push(lease);
  }

  // 第 6 次在同一分钟窗口内请求，应被拦截
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: callerId,
        callerGeneration: 0,
        workspace: '/test/workspace',
        title: 'Session Rate 6 Blocked',
        now: baseTime + 10000
      });
    },
    {
      message: /\[RateLimitExceeded\].*rate exceeded.*5\/min/i
    }
  );

  // 模拟窗口滑动：时间推移超过 60 秒 (61000ms)，应当允许新的申请
  const slidLease = safeguard.acquire({
    callerSessionId: callerId,
    callerGeneration: 0,
    workspace: '/test/workspace',
    title: 'Session Rate Slid Success',
    now: baseTime + 61000
  });
  assert.ok(slidLease instanceof AdmissionLease);
  slidLease.release();

  // 其他调用方不受影响
  const otherLease = safeguard.acquire({
    callerSessionId: 'another-caller',
    callerGeneration: 0,
    workspace: '/test/workspace',
    title: 'Other Caller Session',
    now: baseTime + 10000
  });
  assert.ok(otherLease instanceof AdmissionLease);
  otherLease.release();

  leases.forEach(l => l.release());
});

test('SessionSafeguard - 在途并发防超发与在途标题冲突拦截', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const workspace = '/test/workspace-inflight';

  // 场景 1: 在途并发配额防超发
  // 当前已运行 4 个会话，配额上限 5
  // 并发请求 1 获取租约成功，进入在途（in-flight = 1，有效活跃数 = 4 + 1 = 5）
  const lease1 = safeguard.acquire({
    callerSessionId: 'caller-1',
    callerGeneration: 0,
    workspace,
    activeCount: 4,
    title: 'In Flight Task 1'
  });
  assert.ok(lease1 instanceof AdmissionLease);
  assert.equal(safeguard.getInFlightCount(workspace), 1);

  // 并发请求 2 在同一工作区尝试准入，因有效活跃数达到 5，应被拒绝防超发
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: 'caller-2',
        callerGeneration: 0,
        workspace,
        activeCount: 4,
        title: 'In Flight Task 2'
      });
    },
    {
      message: /[QuotaExceeded]/i
    }
  );

  // 请求 1 失败并释放租约，在途计数归零
  lease1.release();
  assert.equal(safeguard.getInFlightCount(workspace), 0);

  // 释放后，并发请求 2 再次尝试准入能够成功
  const lease2 = safeguard.acquire({
    callerSessionId: 'caller-2',
    callerGeneration: 0,
    workspace,
    activeCount: 4,
    title: 'In Flight Task 2'
  });
  assert.ok(lease2 instanceof AdmissionLease);
  lease2.release();

  // 场景 2: 在途标题冲突拦截
  const leaseTitle1 = safeguard.acquire({
    callerSessionId: 'caller-title',
    callerGeneration: 0,
    workspace,
    activeCount: 0,
    title: 'Unique Worker Title'
  });
  assert.ok(leaseTitle1 instanceof AdmissionLease);

  // 相同标题（甚至大小写不同）并发请求应当被拦截
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId: 'caller-other',
        callerGeneration: 0,
        workspace,
        activeCount: 0,
        title: 'unique worker title'
      });
    },
    {
      message: /[DuplicateTitle].*conflicts with an active session/i
    }
  );

  // 不同工作区不受标题冲突影响
  const leaseOtherWs = safeguard.acquire({
    callerSessionId: 'caller-other',
    callerGeneration: 0,
    workspace: '/test/workspace-other',
    activeCount: 0,
    title: 'Unique Worker Title'
  });
  assert.ok(leaseOtherWs instanceof AdmissionLease);
  leaseOtherWs.release();

  // 请求 1 释放后，该标题恢复可用
  leaseTitle1.release();
  const leaseTitleRetry = safeguard.acquire({
    callerSessionId: 'caller-other',
    callerGeneration: 0,
    workspace,
    activeCount: 0,
    title: 'Unique Worker Title'
  });
  assert.ok(leaseTitleRetry instanceof AdmissionLease);
  leaseTitleRetry.release();
});

test('SessionSafeguard - AdmissionLease commit 与 release 回滚生命周期', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const workspace = '/test/workspace-lease';
  const callerSessionId = 'lease-caller';
  const now = 1700000000000;

  // 1. 获取租约检查状态
  const lease = safeguard.acquire({
    callerSessionId,
    callerGeneration: 0,
    workspace,
    activeCount: 1,
    title: 'Lease Life Cycle Session',
    now
  });
  assert.equal(lease.status, 'acquired');
  assert.equal(lease.workspace, workspace);
  assert.equal(lease.title, 'Lease Life Cycle Session');
  assert.equal(lease.callerSessionId, callerSessionId);
  assert.equal(lease.generation, 1);
  assert.equal(safeguard.getInFlightCount(workspace), 1);

  // 2. commit 测试：会话创建成功后提交
  lease.commit();
  assert.equal(lease.status, 'committed');
  assert.equal(safeguard.getInFlightCount(workspace), 0, 'commit 后在途计数应释放');

  // commit 幂等性
  lease.commit();
  assert.equal(lease.status, 'committed');

  // 3. release 回滚测试：
  // 构造已用满 5 次配额的场景
  safeguard.reset();
  const acquiredLeases = [];
  for (let i = 0; i < 5; i++) {
    acquiredLeases.push(
      safeguard.acquire({
        callerSessionId,
        callerGeneration: 0,
        workspace,
        activeCount: 0,
        title: `Lease Rollback Test ${i}`,
        now: now + i * 10
      })
    );
  }

  // 此时第 6 次必然被限频
  assert.throws(
    () => {
      safeguard.acquire({
        callerSessionId,
        callerGeneration: 0,
        workspace,
        activeCount: 0,
        title: 'Overflow Attempt',
        now: now + 100
      });
    },
    /[RateLimitExceeded]/
  );

  // 释放其中一个在途租约（模拟创建失败异常回滚）
  const lastLease = acquiredLeases.pop();
  assert.equal(lastLease.status, 'acquired');
  lastLease.release();
  assert.equal(lastLease.status, 'released');

  // 回滚后，该调用方的频次配额被退还，新的申请应能成功
  const recoveredLease = safeguard.acquire({
    callerSessionId,
    callerGeneration: 0,
    workspace,
    activeCount: 0,
    title: 'Recovered After Rollback',
    now: now + 100
  });
  assert.ok(recoveredLease instanceof AdmissionLease);
  recoveredLease.release();

  // release 幂等性：重复调用 release 不应重复退还配额或抛异常
  lastLease.release();
  lastLease.release();
  assert.equal(lastLease.status, 'released');

  // 清理其余租约
  acquiredLeases.forEach(l => l.release());
});

test('SessionSafeguard - reset 方法与兼容函数', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const workspace = '/test/workspace-reset';
  const caller = 'caller-reset';

  // 产生在途和限频数据
  safeguard.acquire({
    callerSessionId: caller,
    callerGeneration: 0,
    workspace,
    activeCount: 0,
    title: 'To Be Reset'
  });

  assert.equal(safeguard.getInFlightCount(workspace), 1);

  // 执行 reset
  safeguard.reset();
  assert.equal(safeguard.getInFlightCount(workspace), 0);

  // 验证模块导出的兼容 reset 函数
  resetRateLimits();
  resetInFlightCreations();
});

test('SessionSafeguard - 自定义选项实例化支持', () => {
  const customSafeguard = new SessionSafeguard({
    maxGeneration: 3,
    maxActivePeerSessions: 10,
    maxCreationsPerMinute: 2
  });
  customSafeguard.reset();

  // 验证自定义代际 2 可以继续创建（因上限为 3）
  const lease = customSafeguard.acquire({
    callerSessionId: 'custom-caller',
    callerGeneration: 2,
    workspace: '/custom/workspace',
    activeCount: 8,
    title: 'Custom Limits Session'
  });
  assert.equal(lease.generation, 3);
  lease.release();

  // 验证自定义代际 3 达到熔断
  assert.throws(
    () => {
      customSafeguard.acquire({
        callerSessionId: 'custom-caller',
        callerGeneration: 3,
        workspace: '/custom/workspace',
        activeCount: 8,
        title: 'Custom Limits Exceeded'
      });
    },
    /[GenerationLimitExceeded]/
  );
});
test('SessionSafeguard - 高阶 admit 接口集成解析与准入校验', () => {
  const safeguard = new SessionSafeguard();
  safeguard.reset();

  const mockCallerAgent = {
    id: 'session-caller-mock',
    cwd: '/mock/workspace/alpha',
    session: {
      id: 'session-caller-mock',
      cwd: '/mock/workspace/alpha',
      metadata: { generation: 1 }
    }
  };

  const mockAgentsService = {
    list: () => [
      {
        id: 'session-active-1',
        status: 'running',
        session: { cwd: '/mock/workspace/alpha', title: 'Existing Task A' }
      },
      {
        id: 'session-archived-1',
        status: 'running',
        session: { cwd: '/mock/workspace/alpha', title: 'Archived Task' }
      }
    ]
  };

  const archivedIds = new Set(['session-archived-1']);

  // 通过 admit 调用
  const lease = safeguard.admit({
    callerAgent: mockCallerAgent,
    callerWorkspace: '/mock/workspace/alpha',
    targetTitle: 'New Incoming Peer',
    agentsService: mockAgentsService,
    archivedIds
  });

  assert.ok(lease instanceof AdmissionLease);
  assert.equal(lease.callerSessionId, 'session-caller-mock');
  assert.equal(lease.generation, 2);
  assert.equal(lease.title, 'New Incoming Peer');
  assert.equal(lease.status, 'acquired');

  // 验证与已存在的活跃标题冲突
  assert.throws(
    () => {
      safeguard.admit({
        callerAgent: mockCallerAgent,
        callerWorkspace: '/mock/workspace/alpha',
        targetTitle: 'existing task a',
        agentsService: mockAgentsService,
        archivedIds
      });
    },
    /[DuplicateTitle]/
  );

  lease.release();
});

