// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { RpcStub } from "./stub.js";
import type { RpcPromise } from "./promise.js";
import type { RpcTarget } from "./target.js";
import { registry } from "./registry.js";
import { WORKERS_MODULE_SYMBOL } from "../symbols.js";

// Import RpcTarget directly - it doesn't have circular dependencies
import { RpcTarget as RpcTargetClass } from "./target.js";

/**
 * Interface for the cloudflare:workers module.
 * This represents the shape of the Workers runtime module we interface with.
 * Using an interface instead of `any` provides better documentation and
 * allows TypeScript to catch structural issues.
 */
interface WorkersModule {
  RpcTarget: { new(): object };
  RpcStub: { prototype: object };
  RpcPromise: { prototype: object };
  RpcProperty: { prototype: object };
  ServiceStub: { new(): object };
}

// Type returned by typeForRpc to classify values for RPC serialization
export type TypeForRpc = "unsupported" | "primitive" | "object" | "function" | "array" | "date" |
    "bigint" | "bytes" | "stub" | "rpc-promise" | "rpc-target" | "rpc-thenable" | "error" |
    "undefined";

// Property path type used for RPC method/property access
export type PropertyPath = (string | number)[];

/**
 * Options that can be passed as the last argument to an RPC call.
 * If the last argument to a call is an object with a `timeout` property,
 * it is treated as call options and not passed to the remote method.
 */
export type RpcCallOptions = {
  /** Timeout in milliseconds for this specific call. 0 means no timeout. */
  timeout?: number;
};

// Type for located promises within a payload
export type LocatedPromise = {parent: object, property: string | number, promise: RpcPromise};

// Get the AsyncFunction constructor
const AsyncFunction = (async function () {}).constructor;

// Lazily imported workersModule - we need to defer the actual value check
// because this module is loaded before the workers module is injected
let _workersModule: WorkersModule | undefined = undefined;
let _workersModuleChecked = false;

function getWorkersModule(): WorkersModule | undefined {
  if (!_workersModuleChecked) {
    _workersModule = (globalThis as Record<symbol, WorkersModule | undefined>)[WORKERS_MODULE_SYMBOL];
    _workersModuleChecked = true;
  }
  return _workersModule;
}

/**
 * Determines the RPC type classification for a value.
 * This is used to decide how to serialize values for RPC.
 */
export function typeForRpc(value: unknown): TypeForRpc {
  // Get RpcStub and RpcPromise from registry - they register themselves on module load
  // These may be null if the registry hasn't been populated yet, which is fine because
  // values can't be RpcStub or RpcPromise if those classes don't exist yet
  const RpcStubClass = registry.RpcStub;
  const RpcPromiseClass = registry.RpcPromise;
  const workersModule = getWorkersModule();

  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return "primitive";

    case "undefined":
      return "undefined";

    case "object":
    case "function":
      // Test by prototype, below.
      break;

    case "bigint":
      return "bigint";

    default:
      return "unsupported";
  }

  // Ugh JavaScript, why is `typeof null` equal to "object" but null isn't otherwise anything like
  // an object?
  if (value === null) {
    return "primitive";
  }

  // Aside from RpcTarget, we generally don't support serializing *subclasses* of serializable
  // types, so we switch on the exact prototype rather than use `instanceof` here.
  let prototype = Object.getPrototypeOf(value);
  switch (prototype) {
    case Object.prototype:
      return "object";

    case Function.prototype:
    case AsyncFunction.prototype:
      return "function";

    case Array.prototype:
      return "array";

    case Date.prototype:
      return "date";

    case Uint8Array.prototype:
      return "bytes";

    // Note: Other structured clone types (ArrayBuffer, typed arrays, Map, Set, RegExp, etc.)
    // are not currently supported. They would need explicit handling in both serialization
    // and deserialization paths. For now, they fall through to "unsupported".

    case RpcStubClass?.prototype:
      return "stub";

    case RpcPromiseClass?.prototype:
      return "rpc-promise";

    // Note: Native Promise<T> and thenables are not directly supported. Use RpcPromise for
    // promises that need to be sent over RPC. Native promises would need special handling
    // to await and serialize their values or to export as capabilities.

    default:
      if (workersModule) {
        // Note: We need to match RpcPromise and RpcProperty from cloudflare:workers, but they
        // currently aren't exported. When they become available, add them to the switch above.
        if (prototype == workersModule.RpcStub.prototype ||
            value instanceof workersModule.ServiceStub) {
          return "rpc-target";
        } else if (prototype == workersModule.RpcPromise.prototype ||
                   prototype == workersModule.RpcProperty.prototype) {
          // Like rpc-target, but should be wrapped in RpcPromise, so that it can be pull()ed,
          // which will await the thenable.
          return "rpc-thenable";
        }
      }

      if (value instanceof RpcTargetClass) {
        return "rpc-target";
      }

      if (value instanceof Error) {
        return "error";
      }

      return "unsupported";
  }
}

/**
 * Check if a value looks like RpcCallOptions (has timeout property and nothing else meaningful).
 */
export function isRpcCallOptions(value: unknown): value is RpcCallOptions {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  // Must have a 'timeout' property that is a number
  if (typeof obj.timeout !== 'number') return false;
  // Should only have 'timeout' property (no other significant properties)
  const keys = Object.keys(obj);
  return keys.length === 1 && keys[0] === 'timeout';
}
