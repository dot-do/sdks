// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { RpcTargetBranded, __RPC_TARGET_BRAND } from "../types.js";
import { WORKERS_MODULE_SYMBOL } from "../symbols.js";

let workersModule: any = (globalThis as any)[WORKERS_MODULE_SYMBOL];

export interface RpcTarget {
  [__RPC_TARGET_BRAND]: never;
}

export let RpcTarget = workersModule ? workersModule.RpcTarget : class {};

/**
 * Dispose an RpcTarget by calling its Symbol.dispose method if present.
 */
export function disposeRpcTarget(target: RpcTarget | Function) {
  if (Symbol.dispose in target) {
    try {
      ((<Disposable><any>target)[Symbol.dispose])();
    } catch (err) {
      // We don't actually want to throw from dispose() as this will create trouble for
      // the RPC state machine. Instead, treat the application's error as an unhandled
      // rejection.
      Promise.reject(err);
    }
  }
}
