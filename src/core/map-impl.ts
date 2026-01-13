// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { StubHook } from "./stub-hook.js";
import type { RpcPayload } from "./payload.js";
import type { PropertyPath } from "./types.js";
import type { RpcPromise } from "./promise.js";

function mapNotLoaded(): never {
  throw new Error("RPC map() implementation was not loaded.");
}

// map() is implemented in `map.ts`. We can't import it here because it would create an import
// cycle, so instead we define two hook functions that map.ts will overwrite when it is imported.
export type MapImpl = {
  // Applies a map function to an input value (usually an array).
  applyMap(input: unknown, parent: object | undefined, owner: RpcPayload | null,
           captures: StubHook[], instructions: unknown[])
          : StubHook;

  // Implements the .map() method of RpcStub.
  sendMap(hook: StubHook, path: PropertyPath, func: (value: RpcPromise) => unknown)
         : RpcPromise;
}

export let mapImpl: MapImpl = { applyMap: mapNotLoaded, sendMap: mapNotLoaded };
