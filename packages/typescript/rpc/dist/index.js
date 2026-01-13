export { CapabilityError, CapnwebError, ConnectionError, ErrorCode, ErrorCodeName, RpcError, SerializationError, TimeoutError, createError, isErrorCode, wrapError } from '@dotdo/capnweb';

// src/promise.ts
var RpcPromise = class _RpcPromise extends Promise {
  _client;
  _ops;
  _capabilityId;
  constructor(executor, client, ops = [], capabilityId) {
    super(executor);
    this._client = client;
    this._ops = ops;
    this._capabilityId = capabilityId;
  }
  /**
   * Get a property from the result
   */
  get(key) {
    const newOps = [...this._ops, { type: "get", property: String(key) }];
    return new _RpcPromise(
      (resolve, reject) => {
        this.then((value) => {
          if (value && typeof value === "object") {
            resolve(value[String(key)]);
          } else {
            reject(new Error(`Cannot get property ${String(key)} of ${typeof value}`));
          }
        }).catch(reject);
      },
      this._client,
      newOps,
      this._capabilityId
    );
  }
  /**
   * Call a method on the result
   */
  call(method, ...args) {
    const newOps = [...this._ops, { type: "call", method, args }];
    return new _RpcPromise(
      (resolve, reject) => {
        this.then(async (value) => {
          if (value && typeof value === "object" && "__capabilityId" in value) {
            const result = await this._client.callOnCapability(value, method, ...args);
            resolve(result);
          } else if (value && typeof value === "object") {
            const fn = value[method];
            if (typeof fn === "function") {
              resolve(fn.apply(value, args));
            } else {
              reject(new Error(`${method} is not a function`));
            }
          } else {
            reject(new Error(`Cannot call method on ${typeof value}`));
          }
        }).catch(reject);
      },
      this._client,
      newOps,
      this._capabilityId
    );
  }
  /**
   * Server-side map operation
   * Maps a function over an array on the server, avoiding N round trips
   */
  map(fn) {
    const fnStr = fn.toString();
    return new _RpcPromise(
      (resolve, reject) => {
        this.then(async (value) => {
          try {
            const result = await this._client.serverMap(value, fnStr, {});
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }).catch(reject);
      },
      this._client,
      this._ops,
      this._capabilityId
    );
  }
  /**
   * Get the pipeline operations
   */
  getPipelineOps() {
    return [...this._ops];
  }
  /**
   * Get the capability ID if this promise represents a capability
   */
  getCapabilityId() {
    return this._capabilityId;
  }
  /**
   * Create an RpcPromise from a regular promise
   */
  static from(promise, client, ops = [], capId) {
    return new _RpcPromise(
      (resolve, reject) => {
        promise.then(resolve).catch(reject);
      },
      client,
      ops,
      capId
    );
  }
};
var PipelineBuilder = class {
  _client;
  _steps = [];
  _lastAs;
  constructor(client) {
    this._client = client;
  }
  /**
   * Add a method call to the pipeline
   */
  call(method, ...args) {
    this._steps.push({ method, args });
    return this;
  }
  /**
   * Call a method on a previously named result
   */
  callOn(targetName, method, ...args) {
    this._steps.push({ target: targetName, method, args });
    return this;
  }
  /**
   * Name the result of the previous step
   */
  as(name) {
    if (this._steps.length > 0) {
      this._steps[this._steps.length - 1].as = name;
      this._lastAs = name;
    }
    return this;
  }
  /**
   * Execute the pipeline
   */
  async execute() {
    return this._client.executePipeline(this._steps);
  }
};

// src/proxy.ts
var CAPABILITY_REF = /* @__PURE__ */ Symbol("capabilityRef");
var CLIENT_REF = /* @__PURE__ */ Symbol("clientRef");
var PATH_REF = /* @__PURE__ */ Symbol("pathRef");
function createProxy(client, path = [], capabilityId) {
  const handler = {
    get(_target, prop) {
      if (prop === CAPABILITY_REF) {
        return capabilityId !== void 0 ? { __capabilityId: capabilityId } : void 0;
      }
      if (prop === CLIENT_REF) {
        return client;
      }
      if (prop === PATH_REF) {
        return path;
      }
      if (typeof prop === "symbol") {
        return void 0;
      }
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return void 0;
      }
      const newPath = [...path, prop];
      return createProxy(client, newPath, capabilityId);
    },
    apply(_target, _thisArg, args) {
      if (path.length === 0) {
        throw new Error("Cannot call proxy root as a function");
      }
      const method = path[path.length - 1];
      if (capabilityId !== void 0) {
        return client.callOnCapability(
          { __capabilityId: capabilityId },
          method,
          ...args
        ).then((result) => {
          if (result && typeof result === "object" && "__capabilityId" in result) {
            return createCapabilityProxy(
              client,
              result.__capabilityId
            );
          }
          return result;
        });
      }
      return client.call(method, ...args).then((result) => {
        if (result && typeof result === "object" && "__capabilityId" in result) {
          return createCapabilityProxy(
            client,
            result.__capabilityId
          );
        }
        return result;
      });
    }
  };
  const target = function() {
  };
  return new Proxy(target, handler);
}
function createCapabilityProxy(client, capabilityId) {
  const proxy = createProxy(client, [], capabilityId);
  Object.defineProperty(proxy, "__capabilityId", {
    value: capabilityId,
    writable: false,
    enumerable: true
  });
  return proxy;
}
function isCapabilityProxy(value) {
  return value !== null && typeof value === "object" && typeof value[CAPABILITY_REF] === "object";
}
function getCapabilityRef(proxy) {
  return proxy[CAPABILITY_REF];
}
function getClient(proxy) {
  return proxy[CLIENT_REF];
}
function typed() {
  return (client) => client;
}

// src/client.ts
function isCapabilityRef(value) {
  return value !== null && typeof value === "object" && "__capabilityId" in value && typeof value.__capabilityId === "number";
}
var RpcClient = class {
  _nextRequestId = 1;
  _server = null;
  _ws = null;
  _url = null;
  _pending = /* @__PURE__ */ new Map();
  _capabilities = /* @__PURE__ */ new Map();
  _exportedCallbacks = /* @__PURE__ */ new Map();
  _proxy;
  constructor(serverOrUrl, _options) {
    if (typeof serverOrUrl === "string") {
      this._url = serverOrUrl;
    } else {
      this._server = serverOrUrl;
    }
    this._proxy = createProxy(this, []);
  }
  /**
   * Proxy for direct method access
   * Usage: client.$.methodName(args)
   */
  get $() {
    return this._proxy;
  }
  /**
   * Get self reference (capability ID 0)
   */
  getSelf() {
    return { __capabilityId: 0 };
  }
  /**
   * Export a callback function for server to call
   */
  exportCallback(name, fn) {
    this._exportedCallbacks.set(name, fn);
  }
  /**
   * Get an exported callback
   */
  getExportedCallback(name) {
    return this._exportedCallbacks.get(name);
  }
  /**
   * Make an RPC call
   */
  async call(method, ...args) {
    const request = {
      id: this._nextRequestId++,
      method,
      target: 0,
      // Root capability
      args: this.serializeArgs(args)
    };
    return this.sendRequest(request);
  }
  /**
   * Call a method on a capability
   */
  async callOnCapability(capability, method, ...args) {
    let targetId;
    if (isCapabilityRef(capability)) {
      targetId = capability.__capabilityId;
    } else if (typeof capability === "object" && capability !== null && "$ref" in capability) {
      targetId = capability.$ref;
    } else {
      throw new Error("Invalid capability reference");
    }
    const request = {
      id: this._nextRequestId++,
      method,
      target: targetId,
      args: this.serializeArgs(args)
    };
    return this.sendRequest(request);
  }
  /**
   * Start building a pipeline
   */
  pipeline() {
    return new PipelineBuilder(this);
  }
  /**
   * Execute a pipeline using the server's native pipeline support
   */
  async executePipeline(steps) {
    if (!this._server) {
      throw new Error("Pipeline execution not yet supported over WebSocket");
    }
    const pipelineSteps = steps.map((step) => {
      let method = step.method;
      let target;
      if (step.target) {
        target = step.target;
      }
      const resolvedArgs = step.args.map((arg) => {
        if (typeof arg === "string" && arg.startsWith("$")) {
          const name = arg.substring(1);
          if (name === "self") {
            return { $ref: 0 };
          }
          return { $step: name };
        }
        if (isCapabilityRef(arg)) {
          return { $ref: arg.__capabilityId };
        }
        return arg;
      });
      return {
        method,
        target,
        args: resolvedArgs,
        as: step.as
      };
    });
    const request = {
      id: this._nextRequestId++,
      steps: pipelineSteps
    };
    const responses = this._server.processPipeline(request);
    const results = {};
    let lastResult;
    for (const step of steps) {
      if (step.as && responses[step.as]) {
        const response = responses[step.as];
        if (response.error) {
          throw new Error(response.error.message);
        }
        results[step.as] = response.result;
        lastResult = response.result;
      }
    }
    return { ...results, __last: lastResult };
  }
  /**
   * Server-side map operation - executes in a single round trip
   */
  async serverMap(value, expression, captures) {
    if (!this._server) {
      throw new Error("Server map not yet supported over WebSocket");
    }
    if (value === null || value === void 0) {
      return null;
    }
    let targetCapId;
    if (isCapabilityRef(value)) {
      targetCapId = value.__capabilityId;
    } else {
      targetCapId = this._server.registerCapability(value);
    }
    const captureIds = {};
    for (const [name, cap] of Object.entries(captures)) {
      if (isCapabilityRef(cap)) {
        captureIds[name] = cap.__capabilityId;
      } else if (cap && typeof cap === "object" && "$ref" in cap) {
        captureIds[name] = cap.$ref;
      } else {
        captureIds[name] = this._server.registerCapability(cap);
      }
    }
    const response = this._server.processMapRequest({
      id: this._nextRequestId++,
      target: targetCapId,
      expression,
      captures: captureIds
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }
  /**
   * Execute a method call and map operation in a single round trip
   */
  async callAndMap(method, args, mapExpression, captures) {
    if (!this._server) {
      throw new Error("callAndMap not yet supported over WebSocket");
    }
    const captureIds = {};
    for (const [name, cap] of Object.entries(captures)) {
      if (isCapabilityRef(cap)) {
        captureIds[name] = cap.__capabilityId;
      } else if (cap && typeof cap === "object" && "$ref" in cap) {
        captureIds[name] = cap.$ref;
      } else {
        captureIds[name] = this._server.registerCapability(cap);
      }
    }
    const request = {
      id: this._nextRequestId++,
      method,
      target: 0,
      args: this.serializeArgs(args)
    };
    const result = await this._server.processCallAndMap(request, mapExpression, captureIds);
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.result;
  }
  /**
   * Close the connection
   */
  async close() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._server = null;
    this._pending.clear();
    this._capabilities.clear();
  }
  /**
   * Send a request and wait for response
   */
  async sendRequest(request) {
    if (this._server) {
      const responses = this._server.processBatch([request]);
      const response = responses[0];
      if (response.error) {
        const error = new Error(response.error.message);
        error.name = response.error.type;
        throw error;
      }
      if (response.capabilityId !== void 0) {
        return { __capabilityId: response.capabilityId };
      }
      return response.result;
    }
    if (this._ws) {
      return new Promise((resolve, reject) => {
        this._pending.set(request.id, { resolve, reject });
        this._ws.send(JSON.stringify(request));
      });
    }
    throw new Error("Not connected");
  }
  /**
   * Handle incoming WebSocket message
   */
  handleMessage(data) {
    const response = JSON.parse(data);
    const pending = this._pending.get(response.id);
    if (pending) {
      this._pending.delete(response.id);
      if (response.error) {
        const error = new Error(response.error.message);
        error.name = response.error.type;
        pending.reject(error);
      } else {
        let result = response.result;
        if (response.capabilityId !== void 0) {
          result = { __capabilityId: response.capabilityId };
        }
        pending.resolve(result);
      }
    }
  }
  /**
   * Serialize arguments, converting capability refs
   */
  serializeArgs(args) {
    return args.map((arg) => {
      if (isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      if (arg && typeof arg === "object" && "$ref" in arg) {
        return arg;
      }
      return arg;
    });
  }
  /**
   * Resolve step arguments, converting named refs to capability IDs
   */
  resolveStepArgs(args, tempCaps) {
    return args.map((arg) => {
      if (typeof arg === "string" && arg.startsWith("$")) {
        const name = arg.substring(1);
        if (name === "self") {
          return { $ref: 0 };
        }
        const capId = tempCaps.get(name);
        if (capId !== void 0) {
          return { $ref: capId };
        }
      }
      if (isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      return arg;
    });
  }
};
function createRpcPromise(client, method, args) {
  return RpcPromise.from(
    client.call(method, ...args),
    client
  );
}

// src/map.ts
var RpcRecorder = class {
  _recording = false;
  _calls = [];
  _startTime = 0;
  /**
   * Start recording
   */
  start() {
    this._recording = true;
    this._calls = [];
    this._startTime = Date.now();
  }
  /**
   * Stop recording and return the recording
   */
  stop() {
    this._recording = false;
    return {
      id: crypto.randomUUID(),
      startTime: this._startTime,
      endTime: Date.now(),
      calls: Object.freeze([...this._calls])
    };
  }
  /**
   * Check if currently recording
   */
  get isRecording() {
    return this._recording;
  }
  /**
   * Record a call
   */
  recordCall(call) {
    if (this._recording) {
      this._calls.push({
        ...call,
        timestamp: Date.now()
      });
    }
  }
};
var RpcReplayer = class {
  _recording;
  _index = 0;
  constructor(recording) {
    this._recording = recording;
  }
  /**
   * Get the next recorded call result
   */
  next() {
    if (this._index < this._recording.calls.length) {
      return this._recording.calls[this._index++];
    }
    return void 0;
  }
  /**
   * Reset to the beginning
   */
  reset() {
    this._index = 0;
  }
  /**
   * Check if there are more calls
   */
  hasMore() {
    return this._index < this._recording.calls.length;
  }
};
async function serverMap(client, array, fn, options) {
  const resolvedArray = await array;
  if (resolvedArray === null || resolvedArray === void 0) {
    return [];
  }
  if (resolvedArray.length === 0) {
    return [];
  }
  const fnStr = fn.toString();
  const result = await client.serverMap(resolvedArray, fnStr, {});
  if (options?.transform && Array.isArray(result)) {
    return result.map((item, index) => options.transform(item, index));
  }
  return result;
}
function createServerMap(client, capabilityId) {
  return {
    async map(fn) {
      const fnStr = fn.toString();
      const result = await client.serverMap(
        { __capabilityId: capabilityId },
        fnStr,
        {}
      );
      return result;
    }
  };
}
function serializeFunction(fn) {
  const fnStr = fn.toString();
  const captures = [];
  const captureRegex = /\$(\w+)/g;
  let match;
  while ((match = captureRegex.exec(fnStr)) !== null) {
    if (!captures.includes(match[1])) {
      captures.push(match[1]);
    }
  }
  return {
    expression: fnStr,
    captures
  };
}
function deserializeFunction(spec) {
  const args = Object.keys(spec.captures);
  const body = `return (${spec.expression})(item)`;
  return new Function(...args, "item", body);
}
function connect(serverOrUrl, options) {
  return new RpcClient(serverOrUrl, options);
}

export { CAPABILITY_REF, CLIENT_REF, PATH_REF, PipelineBuilder, RpcClient, RpcPromise, RpcRecorder, RpcReplayer, connect, createCapabilityProxy, createProxy, createRpcPromise, createServerMap, deserializeFunction, getCapabilityRef, getClient, isCapabilityProxy, isCapabilityRef, serializeFunction, serverMap, typed };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map