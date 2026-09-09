/**
 * Read-only canvas telemetry Web surface.
 *
 * Raw WebServer routes do not inherit the Connection authentication fence, so
 * every request passes through `connection.requestRejection` before any
 * workspace state is serialized. The route is GET-only by design: the canvas is
 * an observability mirror (ADR-0012 Invariant 1) and must never expose a write
 * or dispatch channel.
 */

import { getCanvasTelemetry } from './call-telemetry.mjs';

/** Service keys probed for the host Web server across DSH assemblies. */
export const WEB_SERVER_KEYS = Object.freeze(['webServer', 'httpServer']);

/** Canonical host route path, aligned with the DSH plugin route namespace. */
export const TELEMETRY_ROUTE_PATH = '/plugins/dsh-call-session/telemetry';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
});

function resolveWebServer(ctx) {
  if (typeof ctx?.get !== 'function') return undefined;
  for (const key of WEB_SERVER_KEYS) {
    const service = ctx.get(key);
    if (service && typeof service.register === 'function') return service;
  }
  return undefined;
}

/**
 * Wrap a raw WebServer so each handler runs behind the Connection fence.
 *
 * @param {any} server Raw host Web server exposing `register`
 * @param {() => any} connection Late-bound Connection service accessor
 * @returns {{ register: (route: any) => any }}
 */
export function authenticatedWebRoutes(server, connection) {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = typeof connection === 'function' ? connection() : undefined;
          const rejection = gate === undefined
            ? 503
            : (typeof gate.requestRejection === 'function' ? gate.requestRejection(req) : undefined);
          if (rejection !== undefined) {
            res.writeHead(rejection, JSON_HEADERS);
            res.end(JSON.stringify({
              error: rejection === 503
                ? 'authentication unavailable'
                : rejection === 401 ? 'unauthorized' : 'forbidden'
            }));
            return;
          }
          await route.handler(req, res);
        }
      });
    }
  };
}

/**
 * Build the GET-only telemetry handler.
 *
 * @param {any} ctx Cordis context used for the read-only snapshot
 * @param {{ logger?: any }} [deps]
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function createTelemetryHandler(ctx, deps = {}) {
  const logger = deps.logger;
  return async function handler(req, res) {
    if (req.method !== undefined && req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET', ...JSON_HEADERS });
      res.end(JSON.stringify({ error: 'method not allowed' }));
      return;
    }

    let params;
    try {
      params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    } catch {
      params = new URLSearchParams();
    }

    const limitRaw = Number.parseInt(params.get('limit') ?? '', 10);
    const options = {
      sessionId: params.get('sessionId') || undefined,
      crossWorkspace: params.get('crossWorkspace') === 'true',
      limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    };

    try {
      const snapshot = await getCanvasTelemetry(ctx, options);
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(snapshot));
    } catch (error) {
      logger?.warn?.(`[dsh-call-session] telemetry route failed: ${error?.message || error}`);
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'telemetry unavailable' }));
    }
  };
}

/**
 * Mount the telemetry route as soon as the host Web server is bound.
 *
 * A webless profile keeps the plugin tool-only: the probe returns false and
 * boot is never blocked. Registration rides `ctx.effect`, so unloading the
 * plugin removes the route.
 *
 * @param {any} ctx Cordis plugin context
 * @param {{ logger?: any }} [deps]
 * @returns {{ tryRegister: () => boolean, registered: () => boolean }}
 */
export function installTelemetryWebSurface(ctx, deps = {}) {
  const logger = deps.logger;
  let registered = false;

  const tryRegister = () => {
    if (registered) return true;
    const rawServer = resolveWebServer(ctx);
    if (rawServer === undefined) return false;

    const server = authenticatedWebRoutes(rawServer, () => (typeof ctx.get === 'function' ? ctx.get('connection') : undefined));
    registered = true;

    const mount = () => server.register({
      kind: 'exact',
      path: TELEMETRY_ROUTE_PATH,
      handler: createTelemetryHandler(ctx, { logger })
    });

    if (typeof ctx.effect === 'function') {
      ctx.effect(mount, 'dsh-call-session: telemetry route');
    } else {
      mount();
    }

    logger?.debug?.(`[dsh-call-session] Telemetry route mounted at ${TELEMETRY_ROUTE_PATH}.`);
    return true;
  };

  tryRegister();

  if (typeof ctx.on === 'function') {
    ctx.on('internal/service', (name) => {
      if (WEB_SERVER_KEYS.includes(name) || name === 'connection') tryRegister();
    });
  }

  return {
    tryRegister,
    registered: () => registered
  };
}
