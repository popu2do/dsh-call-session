/**
 * Host service resolution across Cordis runtime generations.
 *
 * Reading an undeclared service property on a Cordis context proxy throws
 * (`cannot get property "<name>" without inject`) instead of yielding
 * undefined. Optional host services must therefore be probed through
 * `ctx.get(name, false)` or a guarded property read.
 */

/**
 * Read a property that may live on a Cordis context proxy.
 *
 * @param {any} target Object or context proxy
 * @param {string} key Property name
 * @returns {any} The value, or undefined when absent or rejected by the proxy
 */
export function readProperty(target, key) {
  if (!target || !key) return undefined;
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

/**
 * Call `ctx.get(name, false)` when the context exposes it.
 *
 * @param {any} scope Context or root context
 * @param {string} name Service name
 * @returns {any} The service, or undefined when unavailable
 */
function readNonStrict(scope, name) {
  const get = readProperty(scope, 'get');
  if (typeof get !== 'function') return undefined;
  try {
    return get.call(scope, name, false);
  } catch {
    return undefined;
  }
}

/**
 * Read a host service without requiring an `inject` declaration.
 *
 * The root context is probed first so a forked context still sees root
 * services. `ctx.get(name, false)` is the non-strict accessor: it returns an
 * inactive implementation instead of throwing on an undeclared service.
 *
 * @param {any} ctx Cordis context
 * @param {string} name Service name
 * @returns {any} The service, or undefined when the host does not provide it
 */
export function readHostService(ctx, name) {
  if (!ctx || !name) return undefined;
  const root = readProperty(ctx, 'root');
  return readNonStrict(root, name)
    || readNonStrict(ctx, name)
    || readProperty(root, name)
    || readProperty(ctx, name);
}
