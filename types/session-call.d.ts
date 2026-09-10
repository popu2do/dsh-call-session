/**
 * @module dsh-call-session/session-call
 * 进程内会话单播通信契约与分发逻辑
 */

/** 单播呼叫意图类型：任务派发、任务汇报、状态同步通知 */
export type CallType = 'task_dispatch' | 'task_report' | 'notice';

/** 两态分发模式：运行态 steer 引导，空闲态 followup 唤醒 */
export type DeliveryMode = 'steer' | 'followup';

/** 会话规范化状态 */
export type SessionStatus = 'running' | 'idle';

/**
 * 呼叫意图类型映射语义常量
 */
export declare const CALL_TYPE_INTENTS: Readonly<{
  readonly task_dispatch: 'TASK_DISPATCH';
  readonly task_report: 'TASK_REPORT';
  readonly notice: 'NOTICE';
}>;

/**
 * session_call 工具调用入参
 */
export interface SessionCallArgs {
  /** 目标会话 Session ID，支持精确匹配或至少 8 位唯一前缀，不支持通配符 */
  target_session_id: string;
  /** 任务指令、汇报或通知内容，最大 4000 字符 */
  message: string;
  /** 呼叫意图分类：'task_dispatch' | 'task_report' | 'notice'，默认为 'task_dispatch' */
  call_type?: CallType;
  /** 引用的公共黑板条目 ID 列表 */
  context_post_ids?: string[];
}

/**
 * session_call 执行结果
 */
export interface SessionCallResult {
  /** 单播投递是否成功 */
  success: boolean;
  /** 实际命中的目标会话 Session ID */
  targetSessionId?: string;
  /** 目标会话人类可读标题 */
  targetTitle?: string;
  /** 目标会话执行状态：'running' | 'idle' */
  targetStatus?: SessionStatus;
  /** 本次采用的原生分发模式：'steer' | 'followup' */
  deliveryMode?: DeliveryMode;
  /** 呼叫意图类型 */
  callType?: CallType | string;
  /** 发起方会话 Session ID */
  callerSessionId?: string;
  /** 成功挂载关联的黑板条目 ID 列表 */
  contextPostIds?: string[];
  /** 执行结果描述 */
  message?: string;
  /** 失败原因描述 */
  error?: string;
}

/**
 * 进程内 UserMessage 语义载荷结构
 */
export interface NativeUserMessage {
  /** 消息唯一全局 UUID */
  id: string;
  /** 发信角色，必须为 'user' 以便 LLM 执行循环正常消费 */
  role: 'user';
  /** 结构化消息内容块 */
  content: Array<{
    type: 'text';
    text: string;
  }>;
  /** 语义源标识 */
  source: {
    kind: 'plugin';
    plugin: 'dsh-call-session';
    form: 'notice';
    summary: string;
  };
}

/**
 * 根据目标 Agent 运行状态分发消息
 * running 状态使用 steer，idle 状态使用 followup
 *
 * @param targetAgent 目标 Agent 运行时实例
 * @param userMessage 构造好的原生 DSH 消息载荷
 * @returns 实际触发的分发模式：'steer' | 'followup'
 * @throws 当目标 Agent 未提供有效的原生接收方法时抛出异常
 */
export declare function dispatchNativeMessage(
  targetAgent: any,
  userMessage: NativeUserMessage | any
): DeliveryMode;

/**
 * 执行 session_call 单播投递
 *
 * 校验规则与流程：
 * 1. 校验目标 Session ID，不支持通配符与自身调用，前缀至少 8 位且唯一
 * 2. 检索目标活跃会话
 * 3. 根据目标状态分发，running 使用 steer，idle 使用 followup
 *
 * @param ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param rawArgs session_call 入参
 * @param rawExec 工具执行上下文
 * @param rawOptions 扩展配置选项
 * @returns 单播调用结果 Promise
 */
export declare function executeSessionCall(
  ctxOrOptions: any,
  rawArgs?: SessionCallArgs,
  rawExec?: any,
  rawOptions?: any
): Promise<SessionCallResult>;
