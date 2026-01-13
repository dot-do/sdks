// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Polyfill Symbol.dispose for browsers that don't support it yet
if (!Symbol.dispose) {
  (Symbol as any).dispose = Symbol.for('dispose');
}
if (!Symbol.asyncDispose) {
  (Symbol as any).asyncDispose = Symbol.for('asyncDispose');
}

// Polyfill Promise.withResolvers() for old Safari versions (ugh), Hermes (React Native), and
// maybe others.
if (!Promise.withResolvers) {
  Promise.withResolvers = function<T>(): PromiseWithResolvers<T> {
    let resolve: (value: T | PromiseLike<T>) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

// Private symbol which may be used to unwrap the real stub through the Proxy.
export const RAW_STUB = Symbol("realStub");
