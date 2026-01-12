/**
 * Proxy-based stub for zero-schema RPC access
 *
 * Enables natural method call syntax without predefined types:
 *   client.$.users.get({ id: 123 })
 */

import type { RpcClient, CapabilityRef } from './client.js';
import { RpcPromise } from './promise.js';

/**
 * Proxy for a remote capability
 */
export interface CapabilityProxy {
  [key: string]: CapabilityProxy | ((...args: unknown[]) => Promise<unknown>);
}

/**
 * Symbol for accessing the underlying capability ref
 */
export const CAPABILITY_REF = Symbol('capabilityRef');

/**
 * Symbol for accessing the client
 */
export const CLIENT_REF = Symbol('clientRef');

/**
 * Symbol for accessing the path
 */
export const PATH_REF = Symbol('pathRef');

/**
 * Create a proxy for RPC method access
 *
 * @param client - The RPC client
 * @param path - Current path of property accesses
 * @param capabilityId - Optional capability ID for capability proxies
 */
export function createProxy<T>(
  client: RpcClient<unknown>,
  path: string[] = [],
  capabilityId?: number
): T {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol): unknown {
      // Handle special symbols
      if (prop === CAPABILITY_REF) {
        return capabilityId !== undefined ? { __capabilityId: capabilityId } : undefined;
      }
      if (prop === CLIENT_REF) {
        return client;
      }
      if (prop === PATH_REF) {
        return path;
      }

      // Ignore symbols and internal properties
      if (typeof prop === 'symbol') {
        return undefined;
      }

      // Handle promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;  // Don't auto-thenable
      }

      // Build new path
      const newPath = [...path, prop];

      // Return a new proxy for chaining
      return createProxy(client, newPath, capabilityId);
    },

    apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
      if (path.length === 0) {
        throw new Error('Cannot call proxy root as a function');
      }

      const method = path[path.length - 1];

      // If we have a capability ID, call on that capability
      if (capabilityId !== undefined) {
        return client.callOnCapability(
          { __capabilityId: capabilityId },
          method,
          ...args
        ).then(result => {
          // If result is a capability, wrap it in a proxy
          if (result && typeof result === 'object' && '__capabilityId' in result) {
            return createCapabilityProxy(
              client,
              (result as CapabilityRef).__capabilityId
            );
          }
          return result;
        });
      }

      // Otherwise, call on root (capability 0)
      return client.call(method, ...args).then(result => {
        // If result is a capability, wrap it in a proxy
        if (result && typeof result === 'object' && '__capabilityId' in result) {
          return createCapabilityProxy(
            client,
            (result as CapabilityRef).__capabilityId
          );
        }
        return result;
      });
    },
  };

  // Create a function as the target so the proxy is callable
  const target = function () {} as unknown as T;
  return new Proxy(target as object, handler) as T;
}

/**
 * Create a proxy specifically for a capability
 */
export function createCapabilityProxy(
  client: RpcClient<unknown>,
  capabilityId: number
): CapabilityProxy & CapabilityRef {
  const proxy = createProxy<CapabilityProxy>(client, [], capabilityId);

  // Add __capabilityId for identification
  Object.defineProperty(proxy, '__capabilityId', {
    value: capabilityId,
    writable: false,
    enumerable: true,
  });

  return proxy as CapabilityProxy & CapabilityRef;
}

/**
 * Check if a value is a capability proxy
 */
export function isCapabilityProxy(value: unknown): value is CapabilityProxy {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<symbol, unknown>)[CAPABILITY_REF] === 'object'
  );
}

/**
 * Get the capability reference from a proxy
 */
export function getCapabilityRef(proxy: CapabilityProxy): CapabilityRef | undefined {
  return (proxy as Record<symbol, unknown>)[CAPABILITY_REF] as CapabilityRef | undefined;
}

/**
 * Get the client from a proxy
 */
export function getClient(proxy: CapabilityProxy): RpcClient<unknown> | undefined {
  return (proxy as Record<symbol, unknown>)[CLIENT_REF] as RpcClient<unknown> | undefined;
}

/**
 * Typed proxy creator for better IDE support
 */
export function typed<T>(): <U extends RpcClient<T>>(client: U) => U {
  return client => client;
}
