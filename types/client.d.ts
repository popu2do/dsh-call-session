/**
 * @module dsh-call-session/client
 * Web 客户端插件入口与「看板」Tab 挂载声明
 */

import type { Context } from '@deepseek-ai/cordis';

/** 客户端插件唯一识别名 */
export declare const name = 'dsh-call-session/client';

/** 客户端声明式依赖注入服务清单 */
export declare const inject: readonly ['slots', 'locale'];

/** 看板本地化命名空间 */
export declare const NS = 'dsh-canvas';

/** 简体中文词条 */
export declare const zh: Record<string, string>;

/** 英文词条 */
export declare const en: Record<string, string>;

/**
 * 客户端插件激活函数
 *
 * @param ctx 客户端 Cordis 上下文
 */
export declare function apply(ctx: Context): void;

/**
 * 画板视图组件属性定义
 */
export interface CanvasViewProps {
  sessionId?: string;
  t?: (key: string, params?: Record<string, any>) => string;
  fetchTelemetry?: (options?: { workspace?: string; crossWorkspace?: boolean; limit?: number }) => Promise<any>;
  [key: string]: any;
}

/**
 * 实体详情只读抽屉组件属性定义
 */
export interface CanvasDrawerProps {
  entity: any;
  onClose: () => void;
  t: (key: string, params?: Record<string, any>) => string;
  copiedKey?: string | null;
  setCopiedKey?: (key: string | null) => void;
}

/**
 * 连线三态衰减参数
 */
export interface CallEdgeDecayResult {
  opacity: number;
  strokeWidth: number;
  isFlowing: boolean;
  className: string;
}

/**
 * 计算两个拓扑节点之间的贝塞尔平滑曲线路径
 */
export declare function calculateBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  index?: number,
  total?: number
): string;

/**
 * 计算连线三态时间衰减属性
 */
export declare function getCallEdgeDecay(call: any, now: number): CallEdgeDecayResult;

/**
 * 计算多工作区与会话节点物理布局
 */
export declare function computeLayout(
  workspaces: any[],
  sessions: any[],
  posts: any[],
  currentWorkspace: string,
  crossWorkspace: boolean
): {
  workspaceBounds: Array<{ id: string; name: string; isCurrent: boolean; x: number; y: number; width: number; height: number }>;
  nodePositions: Record<string, { x: number; y: number; session: any }>;
};

/**
 * 格式化 TTL 毫秒为紧凑字符串
 */
export declare function formatTTL(ttlMs?: number): string;

/**
 * 格式化时间戳为 HH:mm:ss 字符串
 */
export declare function formatTime(timestamp?: number): string;

/**
 * 画板主视图组件
 */
export declare function CanvasView(props: CanvasViewProps): any;

/**
 * 实体详情只读抽屉组件
 */
export declare function CanvasDrawer(props: CanvasDrawerProps): any;

declare const _default: {
  name: typeof name;
  inject: typeof inject;
  apply: typeof apply;
  NS: typeof NS;
  zh: typeof zh;
  en: typeof en;
  CanvasView: typeof CanvasView;
  CanvasDrawer: typeof CanvasDrawer;
  calculateBezierPath: typeof calculateBezierPath;
  getCallEdgeDecay: typeof getCallEdgeDecay;
  computeLayout: typeof computeLayout;
  formatTTL: typeof formatTTL;
  formatTime: typeof formatTime;
};

export default _default;
