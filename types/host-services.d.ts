/**
 * Read a property that may live on a Cordis context proxy.
 */
export function readProperty(target: any, key: string): any;

/**
 * Read a host service without requiring an `inject` declaration.
 */
export function readHostService(ctx: any, name: string): any;
