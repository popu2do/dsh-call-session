/**
 * @module dsh-call-session/session-call
 * DSH 进程内严格 1:1 单播通信契约与两态自适应分发管道
 */

/** 单播呼叫意图类型：任务派发、任务汇报、状态同步通知 */
export type CallType = 'task_dispatch' | 'task_report' | 'notice';

/** 原生两态分发模式：运行态注入 steer（即刻引导），空闲态注入 followup（唤醒下轮） */
export type DeliveryMode = 'steer' | 'followup';

/** 会话状态规范化两态 */
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
  /** 目标会话 Session ID（支持精确匹配或 >=8 位唯一前缀，严禁 *、all 等广播通配符） */
  target_session_id: string;
  /** 纯净任务指令、汇报或交接内容（严禁假冒人类或拼装假信封，最大 4000 字符） */
  message: string;
  /** 呼叫意图分类：'task_dispatch' | 'task_report' | 'notice'，默认为 'task_dispatch' */
  call_type?: CallType;
  /** 可选引用的公共黑板条目 ID 列表（引用传递而非大文本冗余内联） */
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
  /** 用户友好的成功反馈文本 */
  message?: string;
  /** 失败原因描述（仅在失败时提供） */
  error?: string;
}

/**
 * 原生进程内 UserMessage 语义载荷结构（完全符合 DSH 宿主内部协议）
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
  /** 语义源标识（由宿主与前端原生解析） */
  source: {
    kind: 'plugin';
    plugin: 'dsh-call-session';
    form: 'notice';
    summary: string;
  };
}

/**
 * 根据目标 Agent 实时运行状态选择最优原生投递信道
 * 处于 running 时优先 steer，处于 idle 时使用 followup
 *
 * @param targetAgent 目标 Agent 运行时实例
 * @param userMessage 构造好的原生 DSH 消息载荷
 * @returns 实际触发的分发模式：'steer' | 'followup'
 * @throws 当目标 Agent 未暴露有效的原生投递方法时抛出异常
 */
export declare function dispatchNativeMessage(
  targetAgent: any,
  userMessage: NativeUserMessage | any
): DeliveryMode;

/**
 * 执行 session_call 安全防护流水线与 1:1 单播投递
 *
 * 包含四重安全防线：
 * 1. 广播与通配符拦截 (*, all, broadcast)
 * 2. 自身自呼叫死循环拦截
 * 3. 前缀解析与歧义熔断（>=8位，多重匹配立刻拒绝）
 * 4. 两态自适应投递（running -> steer, idle -> followup）
 *
 * @param ctxOrOptions Cordis 根上下文或包裹参数对象
 * @param rawArgs session_call 入参
 * @param rawExec 工具执行上下文（包含调用方 agent 实例）
 * @param rawOptions 扩展配置选项
 * @returns 单播调用结果 Promise
 */
export declare function executeSessionCall(
  ctxOrOptions: any,
  rawArgs?: SessionCallArgs,
  rawExec?: any,
  rawOptions?: any
): Promise<SessionCallResult>;
