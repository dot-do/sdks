// @dotdo/conformance-runner - Cross-language conformance test runner
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  ConformanceClient: () => ConformanceClient,
  filterByPattern: () => filterByPattern,
  filterBySuites: () => filterBySuites,
  formatJUnitReport: () => formatJUnitReport,
  formatJsonReport: () => formatJsonReport,
  formatTextReport: () => formatTextReport,
  getSpecsSummary: () => getSpecsSummary,
  loadTestSpec: () => loadTestSpec,
  loadTestSpecs: () => loadTestSpecs,
  runConformanceTests: () => runConformanceTests
});
module.exports = __toCommonJS(src_exports);

// src/loader.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var yaml = __toESM(require("js-yaml"), 1);
function loadTestSpecs(testPath) {
  const specs = [];
  if (!fs.existsSync(testPath)) {
    throw new Error(`Test path does not exist: ${testPath}`);
  }
  const stat = fs.statSync(testPath);
  if (stat.isFile()) {
    if (testPath.endsWith(".yaml") || testPath.endsWith(".yml")) {
      specs.push(loadTestSpec(testPath));
    } else {
      throw new Error(`Test file must be a YAML file: ${testPath}`);
    }
  } else if (stat.isDirectory()) {
    const files = fs.readdirSync(testPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
    for (const file of files) {
      const filePath = path.join(testPath, file);
      specs.push(loadTestSpec(filePath));
    }
  } else {
    throw new Error(`Invalid test path: ${testPath}`);
  }
  return specs;
}
function loadTestSpec(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const spec = yaml.load(content);
  validateTestSpec(spec, filePath);
  return spec;
}
function validateTestSpec(spec, filePath) {
  if (!spec.name) {
    throw new Error(`Test spec missing 'name' field in ${filePath}`);
  }
  if (!spec.tests || !Array.isArray(spec.tests)) {
    throw new Error(`Test spec missing 'tests' array in ${filePath}`);
  }
  for (const test of spec.tests) {
    if (!test.name) {
      throw new Error(`Test case missing 'name' field in ${filePath}`);
    }
    const hasAction = test.call || test.pipeline || test.sequence;
    if (!hasAction && !test.export) {
      throw new Error(
        `Test case '${test.name}' must have at least one of: call, pipeline, sequence, export in ${filePath}`
      );
    }
  }
}
function filterBySuites(specs, suiteNames) {
  if (!suiteNames.length) {
    return specs;
  }
  const lowerNames = suiteNames.map((n) => n.toLowerCase());
  return specs.filter(
    (spec) => lowerNames.some(
      (name) => spec.name.toLowerCase().includes(name) || spec.name.toLowerCase().replace(/\s+/g, "-").includes(name) || spec.name.toLowerCase().replace(/\s+/g, "_").includes(name)
    )
  );
}
function filterByPattern(specs, pattern) {
  const regex = new RegExp(pattern, "i");
  return specs.map((spec) => ({
    ...spec,
    tests: spec.tests.filter(
      (test) => regex.test(test.name) || test.description && regex.test(test.description)
    )
  })).filter((spec) => spec.tests.length > 0);
}
function getSpecsSummary(specs) {
  return {
    totalSuites: specs.length,
    totalTests: specs.reduce((sum, spec) => sum + spec.tests.length, 0),
    suites: specs.map((spec) => ({
      name: spec.name,
      testCount: spec.tests.length
    }))
  };
}

// src/client.ts
var import_ws = __toESM(require("ws"), 1);
var ConformanceClient = class {
  ws = null;
  requestId = 0;
  pendingRequests = /* @__PURE__ */ new Map();
  connected = false;
  capabilities = /* @__PURE__ */ new Map();
  roundTripCount = 0;
  /**
   * Connect to a WebSocket server
   */
  async connect(url, timeout = 1e4) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);
      try {
        this.ws = new import_ws.default(url);
        this.ws.on("open", () => {
          clearTimeout(timer);
          this.connected = true;
          resolve();
        });
        this.ws.on("message", (data) => {
          this.handleMessage(data.toString());
        });
        this.ws.on("error", (error) => {
          clearTimeout(timer);
          this.connected = false;
          reject(error);
        });
        this.ws.on("close", () => {
          this.connected = false;
          for (const [id, { reject: reject2 }] of this.pendingRequests) {
            reject2(new Error("Connection closed"));
            this.pendingRequests.delete(id);
          }
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
    this.capabilities.clear();
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
  /**
   * Get round trip count (for testing pipelining efficiency)
   */
  getRoundTripCount() {
    return this.roundTripCount;
  }
  /**
   * Reset round trip counter
   */
  resetRoundTrips() {
    this.roundTripCount = 0;
  }
  /**
   * Call a method on the root object
   */
  async call(method, ...args) {
    return this.sendRequest({ method, args });
  }
  /**
   * Call a method on a capability
   */
  async callOnCapability(capability, method, ...args) {
    const target = this.getCapabilityId(capability);
    return this.sendRequest({ method, target, args });
  }
  /**
   * Execute a pipeline of calls in a single round trip
   */
  async pipeline(steps) {
    const resolvedSteps = steps.map((step) => ({
      method: step.method,
      target: this.resolveTarget(step.target),
      args: this.resolveArgs(step.args || []),
      as: step.as
    }));
    const id = ++this.requestId;
    const request = { id, steps: resolvedSteps };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          const pipelineResp = response;
          if (pipelineResp.error) {
            const err = new Error(pipelineResp.error.message);
            err.name = pipelineResp.error.type;
            reject(err);
          } else if (pipelineResp.results) {
            const results = {};
            for (const [key, value] of Object.entries(pipelineResp.results)) {
              if (value.error) {
                results[key] = { error: value.error };
              } else {
                results[key] = this.processResult(value.result);
              }
            }
            resolve(results);
          } else {
            resolve({});
          }
        },
        reject
      });
      this.sendRaw(request);
    });
  }
  /**
   * Get self reference (capability ID 0)
   */
  getSelf() {
    return { __capabilityId: 0 };
  }
  /**
   * Check if a value is a capability reference
   */
  isCapabilityRef(value) {
    return typeof value === "object" && value !== null && "__capabilityId" in value && typeof value.__capabilityId === "number";
  }
  async sendRequest(request) {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected");
    }
    const id = ++this.requestId;
    const fullRequest = { id, ...request };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          const rpcResp = response;
          if (rpcResp.error) {
            const err = new Error(rpcResp.error.message);
            err.name = rpcResp.error.type;
            reject(err);
          } else {
            resolve(this.processResult(rpcResp.result));
          }
        },
        reject
      });
      this.sendRaw(fullRequest);
    });
  }
  sendRaw(data) {
    if (!this.ws || this.ws.readyState !== import_ws.default.OPEN) {
      throw new Error("WebSocket not open");
    }
    this.roundTripCount++;
    this.ws.send(JSON.stringify(data));
  }
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      if ("id" in message && this.pendingRequests.has(message.id)) {
        const { resolve } = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);
        resolve(message);
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  }
  processResult(result) {
    if (result === null || result === void 0) {
      return result;
    }
    if (typeof result === "object" && "$ref" in result) {
      const capId = result.$ref;
      const capRef = { __capabilityId: capId };
      this.capabilities.set(capId, capRef);
      return capRef;
    }
    if (Array.isArray(result)) {
      return result.map((item) => this.processResult(item));
    }
    if (typeof result === "object") {
      const processed = {};
      for (const [key, value] of Object.entries(result)) {
        processed[key] = this.processResult(value);
      }
      return processed;
    }
    return result;
  }
  getCapabilityId(capability) {
    if (this.isCapabilityRef(capability)) {
      return capability.__capabilityId;
    }
    throw new Error("Invalid capability reference");
  }
  resolveTarget(target) {
    if (target === void 0) {
      return void 0;
    }
    if (typeof target === "string" || typeof target === "number") {
      return target;
    }
    if (this.isCapabilityRef(target)) {
      return target.__capabilityId;
    }
    return void 0;
  }
  resolveArgs(args) {
    return args.map((arg) => {
      if (this.isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      if (Array.isArray(arg)) {
        return this.resolveArgs(arg);
      }
      if (typeof arg === "object" && arg !== null) {
        const resolved = {};
        for (const [key, value] of Object.entries(arg)) {
          resolved[key] = this.resolveArgs([value])[0];
        }
        return resolved;
      }
      return arg;
    });
  }
};

// src/runner.ts
async function runConformanceTests(specs, options) {
  const startTime = Date.now();
  const suites = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  for (const spec of specs) {
    const suiteResult = await runSuite(spec, options);
    suites.push(suiteResult);
    totalPassed += suiteResult.passed;
    totalFailed += suiteResult.failed;
    totalSkipped += suiteResult.skipped;
    if (options.bail && suiteResult.failed > 0) {
      break;
    }
  }
  return {
    suites,
    totalPassed,
    totalFailed,
    totalSkipped,
    totalDuration: Date.now() - startTime,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    serverUrl: options.serverUrl
  };
}
async function runSuite(spec, options) {
  const startTime = Date.now();
  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const test of spec.tests) {
    const result = await runTest(spec.name, test, options);
    results.push(result);
    switch (result.status) {
      case "passed":
        passed++;
        break;
      case "failed":
        failed++;
        break;
      case "skipped":
        skipped++;
        break;
    }
    if (options.bail && result.status === "failed") {
      for (const remaining of spec.tests.slice(spec.tests.indexOf(test) + 1)) {
        results.push({
          name: remaining.name,
          suite: spec.name,
          status: "skipped",
          duration: 0,
          skipReason: "Skipped due to bail on failure"
        });
        skipped++;
      }
      break;
    }
  }
  return {
    name: spec.name,
    tests: results,
    passed,
    failed,
    skipped,
    duration: Date.now() - startTime
  };
}
async function runTest(suiteName, test, options) {
  const startTime = Date.now();
  const client = new ConformanceClient();
  const context = /* @__PURE__ */ new Map();
  try {
    await client.connect(options.serverUrl, options.timeout);
    await executeTest(client, test, context);
    client.disconnect();
    return {
      name: test.name,
      suite: suiteName,
      status: "passed",
      duration: Date.now() - startTime
    };
  } catch (error) {
    client.disconnect();
    const err = error;
    return {
      name: test.name,
      suite: suiteName,
      status: "failed",
      duration: Date.now() - startTime,
      error: err.message,
      stackTrace: err.stack
    };
  }
}
async function executeTest(client, test, context) {
  client.resetRoundTrips();
  if (test.setup) {
    await executeSetup(client, test.setup, context);
    client.resetRoundTrips();
  }
  if (test.export) {
  }
  if (test.pipeline) {
    await executePipeline(client, test, context);
    return;
  }
  if (test.sequence) {
    await executeSequence(client, test.sequence, context);
    return;
  }
  if (test.map && test.call) {
    throw new Error("Map tests require server-side map support (not yet implemented in runner)");
  }
  if (test.call) {
    await executeSimpleCall(client, test, context);
  }
}
async function executeSetup(client, setup, context) {
  for (const step of setup) {
    if (step.pipeline) {
      const pipelineSteps = step.pipeline.map((ps) => ({
        method: ps.call,
        args: resolveArgs(ps.args || [], context, client),
        as: ps.as
      }));
      const results = await client.pipeline(pipelineSteps);
      if (step.as) {
        const lastStep = step.pipeline[step.pipeline.length - 1];
        const key = lastStep.as || "__last";
        context.set(step.as, results[key]);
      }
    } else {
      const result = await executeCall(client, step.call, step.args || [], context);
      if (step.as) {
        context.set(step.as, result);
      }
    }
  }
}
async function executePipeline(client, test, context) {
  const pipeline = test.pipeline;
  const stepNames = new Set(pipeline.filter((s) => s.as).map((s) => s.as));
  const steps = pipeline.map((step) => {
    const parts = step.call.split(".");
    if (parts.length === 1) {
      return {
        method: step.call,
        args: resolvePipelineArgs(step.args || [], context, stepNames, client),
        as: step.as
      };
    } else {
      const [targetName, ...methodParts] = parts;
      return {
        method: methodParts.join("."),
        target: targetName,
        args: resolvePipelineArgs(step.args || [], context, stepNames, client),
        as: step.as
      };
    }
  });
  const results = await client.pipeline(steps);
  if (test.expect_error) {
    const lastKey = pipeline[pipeline.length - 1].as || "__last";
    const lastResult = results[lastKey];
    if (lastResult?.error) {
      if (test.expect_error.type && lastResult.error.type !== test.expect_error.type) {
        throw new Error(
          `Expected error type '${test.expect_error.type}' but got '${lastResult.error.type}'`
        );
      }
      if (test.expect_error.message_contains && !lastResult.error.message.includes(test.expect_error.message_contains)) {
        throw new Error(
          `Expected error message to contain '${test.expect_error.message_contains}' but got '${lastResult.error.message}'`
        );
      }
      return;
    } else {
      throw new Error("Expected pipeline to fail with error");
    }
  }
  if (test.expect !== void 0) {
    if (typeof test.expect === "object" && !Array.isArray(test.expect) && test.expect !== null) {
      for (const [key, expectedValue] of Object.entries(test.expect)) {
        const actualResult = results[key];
        if (actualResult?.error) {
          throw new Error(`Step '${key}' failed with error`);
        }
        assertDeepEqual(actualResult, expectedValue, `Step '${key}'`);
      }
    } else {
      const lastStep = pipeline[pipeline.length - 1];
      const lastKey = lastStep.as || "__last";
      const lastResult = results[lastKey];
      assertDeepEqual(lastResult, test.expect, "Pipeline result");
    }
  }
  if (test.max_round_trips !== void 0) {
    const roundTrips = client.getRoundTripCount();
    if (roundTrips > test.max_round_trips) {
      throw new Error(
        `Expected at most ${test.max_round_trips} round trips but used ${roundTrips}`
      );
    }
  }
}
async function executeSequence(client, sequence, context) {
  for (const step of sequence) {
    const result = await executeCall(client, step.call, step.args || [], context);
    if (step.expect !== void 0) {
      assertDeepEqual(result, step.expect, `Sequence step '${step.call}'`);
    }
  }
}
async function executeSimpleCall(client, test, context) {
  const resolvedArgs = resolveArgs(test.args || [], context, client);
  if (test.expect_error) {
    const hasValueOption = test.expect_error.any_of?.some(
      (opt) => typeof opt === "object" && opt !== null && "value" in opt
    );
    if (hasValueOption) {
      try {
        const result = await executeCall(client, test.call, resolvedArgs, context);
        const valueOptions = test.expect_error.any_of?.filter(
          (opt) => typeof opt === "object" && opt !== null && "value" in opt
        );
        const matchesValue = valueOptions?.some((opt) => {
          if (opt.value === null && (result === null || Number.isNaN(result))) {
            return true;
          }
          return deepEqual(opt.value, result);
        });
        if (!matchesValue) {
          throw new Error(`Result did not match any expected value`);
        }
      } catch (error) {
        const err = error;
        if (test.expect_error.type && err.name !== test.expect_error.type) {
          throw new Error(
            `Expected error type '${test.expect_error.type}' but got '${err.name}'`
          );
        }
        if (test.expect_error.message_contains && !err.message.includes(test.expect_error.message_contains)) {
          throw new Error(
            `Expected error message to contain '${test.expect_error.message_contains}' but got '${err.message}'`
          );
        }
      }
    } else {
      let errorThrown = false;
      let caughtError;
      try {
        await executeCall(client, test.call, resolvedArgs, context);
      } catch (error) {
        errorThrown = true;
        caughtError = error;
      }
      if (!errorThrown) {
        throw new Error("Expected call to throw an error");
      }
      if (test.expect_error.type && caughtError.name !== test.expect_error.type) {
        throw new Error(
          `Expected error type '${test.expect_error.type}' but got '${caughtError.name}'`
        );
      }
      if (test.expect_error.message_contains && !caughtError.message.includes(test.expect_error.message_contains)) {
        throw new Error(
          `Expected error message to contain '${test.expect_error.message_contains}' but got '${caughtError.message}'`
        );
      }
    }
  } else {
    const result = await executeCall(client, test.call, resolvedArgs, context);
    if (test.expect !== void 0) {
      assertDeepEqual(result, test.expect, "Call result");
    }
    if (test.expect_type === "capability") {
      if (!client.isCapabilityRef(result)) {
        throw new Error("Expected result to be a capability reference");
      }
    }
    if (test.expect_type === "array_of_capabilities") {
      if (!Array.isArray(result)) {
        throw new Error("Expected result to be an array");
      }
      for (const item of result) {
        if (!client.isCapabilityRef(item)) {
          throw new Error("Expected all array items to be capability references");
        }
      }
    }
    if (test.expect_length !== void 0) {
      if (!Array.isArray(result)) {
        throw new Error("Expected result to be an array for length check");
      }
      if (result.length !== test.expect_length) {
        throw new Error(`Expected array length ${test.expect_length} but got ${result.length}`);
      }
    }
    context.set("result", result);
    if (test.verify) {
      for (const verify of test.verify) {
        const verifyResult = await executeCall(client, verify.call, [], context);
        assertDeepEqual(verifyResult, verify.expect, `Verify step '${verify.call}'`);
      }
    }
  }
}
async function executeCall(client, call, args, context) {
  const resolvedArgs = resolveArgs(args, context, client);
  if (call.startsWith("$")) {
    const parts2 = call.substring(1).split(".");
    const targetName = parts2[0];
    const method = parts2.slice(1).join(".");
    const target = context.get(targetName);
    if (!target) {
      throw new Error(`Unknown context variable: ${targetName}`);
    }
    return client.callOnCapability(target, method, ...resolvedArgs);
  }
  const parts = call.split(".");
  if (parts.length > 1) {
    const targetName = parts[0];
    const method = parts.slice(1).join(".");
    const target = context.get(targetName);
    if (target) {
      return client.callOnCapability(target, method, ...resolvedArgs);
    }
  }
  return client.call(call, ...resolvedArgs);
}
function resolveArgs(args, context, client) {
  return args.map((arg) => {
    if (typeof arg === "string" && arg.startsWith("$")) {
      const name = arg.substring(1);
      if (name === "self") {
        return client.getSelf();
      }
      const value = context.get(name);
      if (value !== void 0) {
        return value;
      }
    }
    return arg;
  });
}
function resolvePipelineArgs(args, context, stepNames, client) {
  return args.map((arg) => {
    if (typeof arg === "string" && arg.startsWith("$")) {
      const name = arg.substring(1);
      if (name === "self") {
        return { $ref: 0 };
      }
      if (stepNames.has(name)) {
        return { $step: name };
      }
      const value = context.get(name);
      if (value && client.isCapabilityRef(value)) {
        return { $ref: value.__capabilityId };
      }
      return value;
    }
    return arg;
  });
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => deepEqual(a[key], b[key])
    );
  }
  return false;
}
function assertDeepEqual(actual, expected, context) {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${context}: Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    );
  }
}

// src/reporters/text.ts
var import_picocolors = __toESM(require("picocolors"), 1);
function formatTextReport(result, verbose) {
  const lines = [];
  lines.push("");
  lines.push(import_picocolors.default.bold("DotDo Conformance Test Results"));
  lines.push(import_picocolors.default.dim(`Server: ${result.serverUrl}`));
  lines.push(import_picocolors.default.dim(`Timestamp: ${result.timestamp}`));
  lines.push("");
  for (const suite of result.suites) {
    lines.push(...formatSuite(suite, verbose));
  }
  lines.push("");
  lines.push(import_picocolors.default.bold("Summary"));
  lines.push(import_picocolors.default.dim("\u2500".repeat(50)));
  const totalTests = result.totalPassed + result.totalFailed + result.totalSkipped;
  if (result.totalPassed > 0) {
    lines.push(import_picocolors.default.green(`  ${result.totalPassed} passed`));
  }
  if (result.totalFailed > 0) {
    lines.push(import_picocolors.default.red(`  ${result.totalFailed} failed`));
  }
  if (result.totalSkipped > 0) {
    lines.push(import_picocolors.default.yellow(`  ${result.totalSkipped} skipped`));
  }
  lines.push(import_picocolors.default.dim(`  ${totalTests} total`));
  lines.push(import_picocolors.default.dim(`  ${formatDuration(result.totalDuration)}`));
  lines.push("");
  if (result.totalFailed === 0) {
    lines.push(import_picocolors.default.green(import_picocolors.default.bold("All tests passed!")));
  } else {
    lines.push(import_picocolors.default.red(import_picocolors.default.bold(`${result.totalFailed} test(s) failed`)));
  }
  lines.push("");
  return lines.join("\n");
}
function formatSuite(suite, verbose) {
  const lines = [];
  const statusIcon = suite.failed > 0 ? import_picocolors.default.red("x") : import_picocolors.default.green("\u2713");
  lines.push(`${statusIcon} ${import_picocolors.default.bold(suite.name)} ${import_picocolors.default.dim(`(${formatDuration(suite.duration)})`)}`);
  for (const test of suite.tests) {
    lines.push(formatTest(test, verbose));
  }
  if (suite.tests.length > 1) {
    const parts = [];
    if (suite.passed > 0) parts.push(import_picocolors.default.green(`${suite.passed} passed`));
    if (suite.failed > 0) parts.push(import_picocolors.default.red(`${suite.failed} failed`));
    if (suite.skipped > 0) parts.push(import_picocolors.default.yellow(`${suite.skipped} skipped`));
    lines.push(import_picocolors.default.dim(`  ${parts.join(", ")}`));
  }
  lines.push("");
  return lines;
}
function formatTest(test, verbose) {
  const parts = [];
  switch (test.status) {
    case "passed":
      parts.push(import_picocolors.default.green("    \u2713"));
      break;
    case "failed":
      parts.push(import_picocolors.default.red("    x"));
      break;
    case "skipped":
      parts.push(import_picocolors.default.yellow("    -"));
      break;
  }
  parts.push(test.name);
  parts.push(import_picocolors.default.dim(`(${formatDuration(test.duration)})`));
  let line = parts.join(" ");
  if (test.status === "failed" && test.error) {
    line += "\n" + import_picocolors.default.red(`      Error: ${test.error}`);
    if (verbose && test.stackTrace) {
      const stackLines = test.stackTrace.split("\n").slice(0, 5);
      line += "\n" + import_picocolors.default.dim(stackLines.map((l) => `      ${l}`).join("\n"));
    }
  }
  if (test.status === "skipped" && test.skipReason) {
    line += import_picocolors.default.dim(` - ${test.skipReason}`);
  }
  return line;
}
function formatDuration(ms) {
  if (ms < 1e3) {
    return `${ms}ms`;
  }
  if (ms < 6e4) {
    return `${(ms / 1e3).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 6e4);
  const seconds = (ms % 6e4 / 1e3).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

// src/reporters/json.ts
function formatJsonReport(result) {
  return JSON.stringify(result, null, 2);
}

// src/reporters/junit.ts
function formatJUnitReport(result) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  const totalTests = result.totalPassed + result.totalFailed + result.totalSkipped;
  const totalTime = result.totalDuration / 1e3;
  lines.push(
    `<testsuites name="DotDo Conformance Tests" tests="${totalTests}" failures="${result.totalFailed}" errors="0" skipped="${result.totalSkipped}" time="${totalTime.toFixed(3)}" timestamp="${result.timestamp}">`
  );
  for (const suite of result.suites) {
    lines.push(...formatSuite2(suite));
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}
function formatSuite2(suite) {
  const lines = [];
  const totalTests = suite.passed + suite.failed + suite.skipped;
  const time = suite.duration / 1e3;
  const suiteName = escapeXml(suite.name);
  lines.push(
    `  <testsuite name="${suiteName}" tests="${totalTests}" failures="${suite.failed}" errors="0" skipped="${suite.skipped}" time="${time.toFixed(3)}">`
  );
  for (const test of suite.tests) {
    lines.push(...formatTestCase(test, suite.name));
  }
  lines.push("  </testsuite>");
  return lines;
}
function formatTestCase(test, suiteName) {
  const lines = [];
  const time = test.duration / 1e3;
  const testName = escapeXml(test.name);
  const className = escapeXml(suiteName.replace(/\s+/g, "."));
  lines.push(
    `    <testcase name="${testName}" classname="${className}" time="${time.toFixed(3)}">`
  );
  if (test.status === "failed") {
    const errorMessage = escapeXml(test.error || "Test failed");
    const errorType = "AssertionError";
    lines.push(`      <failure message="${errorMessage}" type="${errorType}">`);
    if (test.stackTrace) {
      lines.push(escapeXml(test.stackTrace));
    }
    lines.push("      </failure>");
  } else if (test.status === "skipped") {
    const skipMessage = test.skipReason ? escapeXml(test.skipReason) : "";
    lines.push(`      <skipped message="${skipMessage}"/>`);
  }
  lines.push("    </testcase>");
  return lines;
}
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConformanceClient,
  filterByPattern,
  filterBySuites,
  formatJUnitReport,
  formatJsonReport,
  formatTextReport,
  getSpecsSummary,
  loadTestSpec,
  loadTestSpecs,
  runConformanceTests
});
//# sourceMappingURL=index.cjs.map