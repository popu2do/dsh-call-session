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
 * 动态注入看板基础视觉样式表，支持 HMR 幂等更新
 */
export declare function ensureStyles(): void;

/**
 * 客户端插件激活函数
 *
 * @param ctx 客户端 Cordis 上下文
 */
export declare function apply(ctx: Context): void;

/**
 * 看板视图组件属性定义
 */
export interface CanvasViewProps {
  sessionId?: string;
  crossWorkspace?: boolean;
  locale?: string;
  t?: (key: string, params?: Record<string, any>) => string;
  /** 获取看板数据快照函数 */
  fetchTelemetry?: (options?: { workspace?: string; crossWorkspace?: boolean; limit?: number }) => Promise<any>;
  [key: string]: any;
}

/**
 * 匹配会话 ID 与目标短码或前缀
 */
export declare function isMatchingSession(
  sid: string,
  targetId?: string,
  sessionShortId?: string
): boolean;

/**
 * 基于渲染像素宽度与英文单词边界感知进行文本截断
 */
export declare function truncateTextByWidth(
  text: string | null | undefined,
  maxWidth: number,
  charWidthAscii?: number,
  charWidthWide?: number
): string;

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
 * 计算两个拓扑节点之间的贝塞尔平滑曲线路径 (ADR-0019 通道分流走线，同列上下行双通道隔离)
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
  crossWorkspace?: boolean,
  calls?: any[]
): {
  workspaceBounds: Array<{ id: string; name: string; isCurrent: boolean; x: number; y: number; width: number; height: number }>;
  nodePositions: Record<string, { x: number; y: number; session: any }>;
  blackboardBound?: { x: number; y: number; width: number; height: number };
  postPositions?: Record<string, { x: number; y: number; width: number; height: number; post: any }>;
};

/**
 * 内容外接矩形：公共黑板、全部工作区分组列与会话节点的聚合包围盒
 */
export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 看板视口取景结果：缩放与画布表面的平移量
 */
export interface ViewportFraming {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * 看板视口取景选项
 */
export interface ViewportFramingOptions {
  /** 'macro' 全局自适应取景；'locate' 夹紧定位当前会话 */
  mode?: 'macro' | 'locate';
  viewportWidth?: number;
  viewportHeight?: number;
  bounds?: CanvasBounds;
  anchor?: { x: number; y: number } | null;
  currentZoom?: number;
}

/**
 * 计算看板视口取景结果（宏观自适应居中 或 夹紧定位当前会话）
 */
export declare function computeViewportFraming(options: ViewportFramingOptions): ViewportFraming;

/**
 * 链路聚焦分析结果
 */
export interface LineageAnalysis {
  connectedSessionIds: Set<string>;
  connectedCallIds: Set<string>;
  connectedPostIds: Set<string>;
  connectedAuthorEdgeKeys: Set<string>;
  connectedContextEdgeKeys: Set<string>;
  activeId: string | null;
  activeKind: string | null;
}

/**
 * 依据当前高亮实体与拓扑关系计算 1-hop 关联子图（深层图遍历与链路聚焦分析）
 */
export declare function analyzeLineage(
  activeHighlight: { kind: string; id: string; entity?: any } | null,
  calls?: any[] | { calls?: any[]; posts?: any[] },
  posts?: any[]
): LineageAnalysis;

/** 会话节点卡片的半宽，内容外接矩形与节点渲染共用同一真源 */
export declare const SESSION_NODE_HALF_WIDTH: number;

/** 会话节点卡片的半高，内容外接矩形与节点渲染共用同一真源 */
export declare const SESSION_NODE_HALF_HEIGHT: number;

/** 会话节点卡片圆角半径 */
export declare const SESSION_NODE_CORNER_RADIUS: number;

/** 计算射线与椭圆外壳交点 */
export declare function getEllipseIntersection(
  cx: number, cy: number,
  tx: number, ty: number,
  a?: number, b?: number
): { x: number; y: number };

/** 计算射线与圆角矩形外壳交点 */
export declare function getRoundedRectIntersection(
  cx: number, cy: number,
  tx: number, ty: number,
  a?: number, b?: number, r?: number
): { x: number; y: number };

/**
 * 计算会话节点到黑板条目之间的布线端点与 Gutter 通道锚点
 */
export declare function computePostEdgeCoordinates(
  sourceNode: { x: number; y: number },
  targetPost: { x: number; y: number },
  edgeIndex?: number
): {
  startX: number;
  startY: number;
  gutterX: number;
  gutterY: number;
  targetX: number;
  targetY: number;
};

/**
 * 生成作者到黑板条目的双段复合贝塞尔走线路径 (ADR-0014, ADR-0019)
 */
export declare function calculateAuthorEdgePath(
  sourceNode: { x: number; y: number },
  targetPost: { x: number; y: number },
  edgeIndex?: number
): string;

/**
 * 生成调用关联到黑板条目的单段贝塞尔走线路径 (ADR-0014, ADR-0019)
 */
export declare function calculateContextEdgePath(
  sourceNode: { x: number; y: number },
  targetPost: { x: number; y: number },
  edgeIndex?: number
): string;

/** 看板走线与 Gutter 通道几何尺寸常量配置 */
export declare const GUTTER_CONFIG: {
  readonly NODE_RX: number;
  readonly NODE_RY: number;
  readonly NODE_RADIUS: number;
  readonly GUTTER_OFFSET: number;
  readonly MAX_INTRA_SPREAD: number;
  readonly CHANNEL_MIN_OFFSET: number;
  readonly CHANNEL_MAX_OFFSET: number;
  readonly CHANNEL_HOP_SPREAD: number;
  readonly CHANNEL_MAX_SPREAD: number;
  readonly CHANNEL_JITTER_STEP: number;
  readonly POST_OUTER_OFFSET: number;
  readonly SESSION_SLOT_HEIGHT: number;
  readonly POST_LEAD_Y: number;
  readonly POST_CEILING_Y: number;
  readonly CROSS_COLUMN_THRESHOLD: number;
  readonly TOP_CORRIDOR_Y: number;
  readonly TOP_CORRIDOR_ENTRY_Y: number;
  readonly TOP_CORRIDOR_ARC_Y: number;
};

/** 看板视口取景参数常量 */
export declare const VIEWPORT_FRAMING: {
  readonly PADDING: number;
  readonly TOP_MARGIN: number;
  readonly BOTTOM_MARGIN: number;
  readonly MACRO_MIN_ZOOM: number;
  readonly MACRO_MAX_ZOOM: number;
  readonly LOCATE_MIN_ZOOM: number;
  readonly LOCATE_MAX_ZOOM: number;
};

/** 空拓扑下的兜底外接矩形 */
export declare const CANVAS_FALLBACK_BOUNDS: CanvasBounds;

/**
 * 计算黑板条目卡片在主题与聚焦态下的色彩配色
 */
export declare function resolvePostColors(
  post: any,
  isPostActive: boolean,
  isDark: boolean
): {
  stroke: string;
  fill: string;
  status: string;
  text: string;
  badgeFill: string;
  badgeStroke: string;
  badgeText: string;
  ttl: string;
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
 * 看板主视图组件
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
  ensureStyles: typeof ensureStyles;
  CanvasView: typeof CanvasView;
  CanvasDrawer: typeof CanvasDrawer;
  isMatchingSession: typeof isMatchingSession;
  truncateTextByWidth: typeof truncateTextByWidth;
  calculateBezierPath: typeof calculateBezierPath;
  getCallEdgeDecay: typeof getCallEdgeDecay;
  computeLayout: typeof computeLayout;
  computeViewportFraming: typeof computeViewportFraming;
  analyzeLineage: typeof analyzeLineage;
  getEllipseIntersection: typeof getEllipseIntersection;
  getRoundedRectIntersection: typeof getRoundedRectIntersection;
  computePostEdgeCoordinates: typeof computePostEdgeCoordinates;
  calculateAuthorEdgePath: typeof calculateAuthorEdgePath;
  calculateContextEdgePath: typeof calculateContextEdgePath;
  GUTTER_CONFIG: typeof GUTTER_CONFIG;
  VIEWPORT_FRAMING: typeof VIEWPORT_FRAMING;
  CANVAS_FALLBACK_BOUNDS: typeof CANVAS_FALLBACK_BOUNDS;
  SESSION_NODE_HALF_WIDTH: typeof SESSION_NODE_HALF_WIDTH;
  SESSION_NODE_HALF_HEIGHT: typeof SESSION_NODE_HALF_HEIGHT;
  SESSION_NODE_CORNER_RADIUS: typeof SESSION_NODE_CORNER_RADIUS;
  resolvePostColors: typeof resolvePostColors;
  formatTTL: typeof formatTTL;
  formatTime: typeof formatTime;
};

export default _default;
