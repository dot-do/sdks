// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook } from "./stub-hook.js";
import { RpcStub } from "./stub.js";
import { RAW_STUB } from "./utils.js";
import { registry } from "./registry.js";
import type { PropertyPath } from "./types.js";

export class RpcPromise extends RpcStub {
  // Design note: RpcPromise constructor only accepts StubHook, not raw values or native promises.
  // This is intentional because:
  // 1. RpcPromise represents a remote promise, not a local one - it needs an RPC hook
  // 2. Converting local values/promises happens at payload creation time via RpcPayload factories
  // 3. If you have a local promise, you should await it and pass the result to RpcStub instead
  // 4. This keeps the constructor simple and ensures RpcPromise always has proper RPC semantics
  // Applications should use RpcStub(value) for local values, not RpcPromise(value).
  constructor(hook: StubHook, pathIfPromise: PropertyPath) {
    super(hook, pathIfPromise);
  }

  then(onfulfilled?: ((value: unknown) => unknown) | undefined | null,
       onrejected?: ((reason: any) => unknown) | undefined | null)
       : Promise<unknown> {
    return pullPromise(this).then(...arguments);
  }

  catch(onrejected?: ((reason: any) => unknown) | undefined | null): Promise<unknown> {
    return pullPromise(this).catch(...arguments);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<unknown> {
    return pullPromise(this).finally(...arguments);
  }

  toString() {
    return "[object RpcPromise]";
  }
}

// Given a promise stub (still wrapped in a Proxy), pull the remote promise and deliver the
// payload. This is a helper used to implement the then/catch/finally methods of RpcPromise.
async function pullPromise(promise: RpcPromise): Promise<unknown> {
  let {hook, pathIfPromise} = promise[RAW_STUB];
  if (pathIfPromise!.length > 0) {
    // If this isn't the root promise, we have to clone it and pull the clone. This is a little
    // weird in terms of disposal: There's no way for the app to dispose/cancel the promise while
    // waiting because it never actually got a direct disposable reference. It has to dispose
    // the result.
    hook = hook.get(pathIfPromise!);
  }
  let payload = await hook.pull();
  return payload.deliverResolve();
}

// Register with the registry
// Type assertion needed because the registry uses interface types to avoid circular deps
registry.RpcPromise = RpcPromise as unknown as typeof registry.RpcPromise;
