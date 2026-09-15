/**
 * @module dsh-call-session/web-telemetry-route
 * 只读画板遥测宿主 Web 路由契约
 */

/** 宿主 Web 服务探针键序列 */
export declare const WEB_SERVER_KEYS: readonly ['webServer', 'httpServer'];

/** 规范化宿主路由路径 */
export declare const TELEMETRY_ROUTE_PATH: '/plugins/dsh-call-session/telemetry';

/** 认证围栏包装后的路由注册门面 */
export interface AuthenticatedWebRoutes {
  register(route: {
    kind: string;
    path: string;
    handler: (req: any, res: any) => Promise<void> | void;
  }): unknown;
}

/**
 * 为原生 Web 服务包裹 Connection 认证围栏。
 * 服务缺失返回 503，未授权返回 401，越权返回 403。
 */
export declare function authenticatedWebRoutes(
  server: any,
  connection: () => any
): AuthenticatedWebRoutes;

/**
 * 构造 GET-only 只读遥测处理器，非 GET 请求返回 405。
 */
export declare function createTelemetryHandler(
  ctx: any,
  deps?: { logger?: any }
): (req: any, res: any) => Promise<void>;

/**
 * 懒加载挂载遥测路由；无 Web 宿主时保持 tool-only 静默降级。
 */
export declare function installTelemetryWebSurface(
  ctx: any,
  deps?: { logger?: any }
): {
  tryRegister(): boolean;
  registered(): boolean;
};
