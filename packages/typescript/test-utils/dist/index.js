// src/mock-rpc-transport.ts
var MockRpcTransport = class {
  _closed = false;
  _callLog = [];
  _handlers = /* @__PURE__ */ new Map();
  _mockResponses = /* @__PURE__ */ new Map();
  _options;
  constructor(options = {}) {
    this._options = {
      defaultDelay: options.defaultDelay ?? 0,
      enableCallLog: options.enableCallLog ?? true,
      handlers: options.handlers ?? {}
    };
    for (const [method, handler] of Object.entries(this._options.handlers)) {
      this._handlers.set(method, handler);
    }
    this._registerDefaultHandlers();
  }
  /**
   * Register default handlers for common methods
   */
  _registerDefaultHandlers() {
    this.on("connect", () => ({ ok: 1 }));
    this.on("ping", () => ({ ok: 1 }));
    this.on("close", () => ({ ok: 1 }));
  }
  /**
   * Get the call log
   */
  get callLog() {
    return this._callLog;
  }
  /**
   * Check if the transport is closed
   */
  get isClosed() {
    return this._closed;
  }
  /**
   * Clear the call log
   */
  clearCallLog() {
    this._callLog = [];
  }
  /**
   * Register a method handler
   */
  on(method, handler) {
    this._handlers.set(method, handler);
    return this;
  }
  /**
   * Remove a method handler
   */
  off(method) {
    this._handlers.delete(method);
    return this;
  }
  /**
   * Queue a mock response for a method
   * Responses are consumed in FIFO order
   */
  mockResponse(method, response) {
    const queue = this._mockResponses.get(method) ?? [];
    queue.push(response);
    this._mockResponses.set(method, queue);
    return this;
  }
  /**
   * Queue an error response for a method
   */
  mockError(method, error, delay) {
    return this.mockResponse(method, { error, delay });
  }
  /**
   * Make an RPC call
   */
  async call(method, ...args) {
    if (this._closed) {
      throw new Error("Transport is closed");
    }
    if (this._options.enableCallLog) {
      this._callLog.push({
        method,
        args,
        timestamp: Date.now()
      });
    }
    const responseQueue = this._mockResponses.get(method);
    if (responseQueue && responseQueue.length > 0) {
      const response = responseQueue.shift();
      if (response.delay) {
        await this._delay(response.delay);
      }
      if (response.error) {
        throw response.error;
      }
      return response.result;
    }
    const handler = this._handlers.get(method);
    if (handler) {
      if (this._options.defaultDelay > 0) {
        await this._delay(this._options.defaultDelay);
      }
      return handler(...args);
    }
    throw new Error(`Unknown method: ${method}`);
  }
  /**
   * Close the transport
   */
  async close() {
    this._closed = true;
  }
  /**
   * Reset the transport to initial state
   */
  reset() {
    this._closed = false;
    this._callLog = [];
    this._mockResponses.clear();
  }
  /**
   * Helper to create a delay
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  /**
   * Get calls for a specific method
   */
  getCallsForMethod(method) {
    return this._callLog.filter((entry) => entry.method === method);
  }
  /**
   * Check if a method was called
   */
  wasMethodCalled(method) {
    return this._callLog.some((entry) => entry.method === method);
  }
  /**
   * Get the last call for a method
   */
  getLastCall(method) {
    const calls = this.getCallsForMethod(method);
    return calls[calls.length - 1];
  }
};

// src/mock-mongo-transport.ts
var MockMongoTransport = class extends MockRpcTransport {
  _data = /* @__PURE__ */ new Map();
  _nextId = 1;
  constructor() {
    super();
    this._registerMongoHandlers();
  }
  /**
   * Register MongoDB-specific method handlers
   */
  _registerMongoHandlers() {
    this.on("insertOne", (dbName, collName, doc) => {
      const collection = this._getOrCreateCollection(String(dbName), String(collName));
      const document = doc;
      const id = document._id ?? `id_${this._nextId++}`;
      collection.push({ ...document, _id: id });
      return { acknowledged: true, insertedId: id };
    });
    this.on("insertMany", (dbName, collName, docs) => {
      const collection = this._getOrCreateCollection(String(dbName), String(collName));
      const documents = docs;
      const insertedIds = {};
      documents.forEach((doc, i) => {
        const id = doc._id ?? `id_${this._nextId++}`;
        collection.push({ ...doc, _id: id });
        insertedIds[i] = String(id);
      });
      return { acknowledged: true, insertedCount: documents.length, insertedIds };
    });
    this.on("find", (dbName, collName, filter, options) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter ?? {};
      const opts = options ?? {};
      let results = collection.filter((doc) => this._matchesFilter(doc, filterDoc));
      if (opts.sort) {
        results = this._sortDocs(results, opts.sort);
      }
      if (opts.skip) {
        results = results.slice(opts.skip);
      }
      if (opts.limit !== void 0) {
        results = results.slice(0, opts.limit);
      }
      if (opts.projection) {
        results = results.map((doc) => this._applyProjection(doc, opts.projection));
      }
      return results;
    });
    this.on("updateOne", (dbName, collName, filter, update, options) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter;
      const updateDoc = update;
      const opts = options ?? {};
      const index = collection.findIndex((doc) => this._matchesFilter(doc, filterDoc));
      if (index === -1) {
        if (opts.upsert) {
          const id = `id_${this._nextId++}`;
          const newDoc = { _id: id, ...this._applyUpdate({}, updateDoc) };
          collection.push(newDoc);
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: id, upsertedCount: 1 };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }
      collection[index] = this._applyUpdate(collection[index], updateDoc);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    });
    this.on("updateMany", (dbName, collName, filter, update, options) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter;
      const updateDoc = update;
      const opts = options ?? {};
      let matchedCount = 0;
      let modifiedCount = 0;
      collection.forEach((doc, i) => {
        if (this._matchesFilter(doc, filterDoc)) {
          matchedCount++;
          const updated = this._applyUpdate(doc, updateDoc);
          if (JSON.stringify(updated) !== JSON.stringify(doc)) {
            collection[i] = updated;
            modifiedCount++;
          }
        }
      });
      if (matchedCount === 0 && opts.upsert) {
        const id = `id_${this._nextId++}`;
        const newDoc = { _id: id, ...this._applyUpdate({}, updateDoc) };
        collection.push(newDoc);
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: id, upsertedCount: 1 };
      }
      return { acknowledged: true, matchedCount, modifiedCount };
    });
    this.on("deleteOne", (dbName, collName, filter) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter;
      const index = collection.findIndex((doc) => this._matchesFilter(doc, filterDoc));
      if (index === -1) {
        return { acknowledged: true, deletedCount: 0 };
      }
      collection.splice(index, 1);
      return { acknowledged: true, deletedCount: 1 };
    });
    this.on("deleteMany", (dbName, collName, filter) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter;
      const toDelete = [];
      collection.forEach((doc, i) => {
        if (this._matchesFilter(doc, filterDoc)) {
          toDelete.push(i);
        }
      });
      for (let i = toDelete.length - 1; i >= 0; i--) {
        collection.splice(toDelete[i], 1);
      }
      return { acknowledged: true, deletedCount: toDelete.length };
    });
    this.on("countDocuments", (dbName, collName, filter, options) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter ?? {};
      const opts = options ?? {};
      let results = collection.filter((doc) => this._matchesFilter(doc, filterDoc));
      if (opts.skip) {
        results = results.slice(opts.skip);
      }
      if (opts.limit) {
        results = results.slice(0, opts.limit);
      }
      return results.length;
    });
    this.on("estimatedDocumentCount", (dbName, collName) => {
      const collection = this._getCollection(String(dbName), String(collName));
      return collection.length;
    });
    this.on("aggregate", (dbName, collName, pipeline) => {
      let results = [...this._getCollection(String(dbName), String(collName))];
      const stages = pipeline;
      for (const stage of stages) {
        if (stage.$match) {
          results = results.filter((doc) => this._matchesFilter(doc, stage.$match));
        } else if (stage.$limit) {
          results = results.slice(0, stage.$limit);
        } else if (stage.$skip) {
          results = results.slice(stage.$skip);
        } else if (stage.$sort) {
          results = this._sortDocs(results, stage.$sort);
        } else if (stage.$project) {
          results = results.map((doc) => this._applyProjection(doc, stage.$project));
        } else if (stage.$count) {
          results = [{ [stage.$count]: results.length }];
        } else if (stage.$group) {
          results = this._groupDocs(results, stage.$group);
        }
      }
      return results;
    });
    this.on("createCollection", (dbName, collName) => {
      this._getOrCreateCollection(String(dbName), String(collName));
      return { ok: 1 };
    });
    this.on("dropCollection", (dbName, collName) => {
      const db = this._data.get(String(dbName));
      if (db) {
        db.delete(String(collName));
      }
      return true;
    });
    this.on("dropDatabase", (dbName) => {
      this._data.delete(String(dbName));
      return true;
    });
    this.on("listCollections", (dbName) => {
      const db = this._data.get(String(dbName));
      if (!db) return [];
      return Array.from(db.keys()).map((name) => ({ name, type: "collection" }));
    });
    this.on("listDatabases", () => {
      const databases = Array.from(this._data.keys()).map((name) => ({
        name,
        sizeOnDisk: 0,
        empty: (this._data.get(name)?.size ?? 0) === 0
      }));
      return { databases, totalSize: 0 };
    });
    this.on("createIndex", () => "index_name");
    this.on("createIndexes", () => ["index_1", "index_2"]);
    this.on("dropIndex", () => void 0);
    this.on("dropIndexes", () => void 0);
    this.on("listIndexes", () => [{ v: 2, key: { _id: 1 }, name: "_id_" }]);
    this.on("serverStatus", () => ({ host: "localhost", version: "1.0.0", ok: 1 }));
    this.on("adminCommand", () => ({ ok: 1 }));
    this.on("runCommand", (_dbName, command) => {
      const cmd = command;
      if (cmd.dbStats) {
        return { db: _dbName, collections: 0, objects: 0, avgObjSize: 0, dataSize: 0, storageSize: 0, indexes: 0, indexSize: 0, ok: 1 };
      }
      return { ok: 1 };
    });
  }
  /**
   * Get all data (for debugging)
   */
  getData() {
    return this._data;
  }
  /**
   * Clear all data
   */
  clearData() {
    this._data.clear();
    this._nextId = 1;
  }
  /**
   * Seed data for testing
   */
  seedData(dbName, collName, documents) {
    const collection = this._getOrCreateCollection(dbName, collName);
    documents.forEach((doc) => {
      const id = doc._id ?? `id_${this._nextId++}`;
      collection.push({ ...doc, _id: id });
    });
  }
  // Private helper methods
  _getOrCreateDb(name) {
    let db = this._data.get(name);
    if (!db) {
      db = /* @__PURE__ */ new Map();
      this._data.set(name, db);
    }
    return db;
  }
  _getOrCreateCollection(dbName, collName) {
    const db = this._getOrCreateDb(dbName);
    let collection = db.get(collName);
    if (!collection) {
      collection = [];
      db.set(collName, collection);
    }
    return collection;
  }
  _getCollection(dbName, collName) {
    return this._getOrCreateCollection(dbName, collName);
  }
  _matchesFilter(doc, filter) {
    if (!filter || Object.keys(filter).length === 0) {
      return true;
    }
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$and") {
        if (!Array.isArray(value)) return false;
        if (!value.every((f) => this._matchesFilter(doc, f))) return false;
        continue;
      }
      if (key === "$or") {
        if (!Array.isArray(value)) return false;
        if (!value.some((f) => this._matchesFilter(doc, f))) return false;
        continue;
      }
      const docValue = this._getFieldValue(doc, key);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const operators = value;
        let allMatch = true;
        for (const [op, opValue] of Object.entries(operators)) {
          if (!op.startsWith("$")) {
            if (!this._compareValues(docValue, value)) {
              allMatch = false;
              break;
            }
            continue;
          }
          switch (op) {
            case "$eq":
              if (!this._compareValues(docValue, opValue)) allMatch = false;
              break;
            case "$ne":
              if (this._compareValues(docValue, opValue)) allMatch = false;
              break;
            case "$gt":
              if (docValue === void 0 || docValue === null || docValue <= opValue) allMatch = false;
              break;
            case "$gte":
              if (docValue === void 0 || docValue === null || docValue < opValue) allMatch = false;
              break;
            case "$lt":
              if (docValue === void 0 || docValue === null || docValue >= opValue) allMatch = false;
              break;
            case "$lte":
              if (docValue === void 0 || docValue === null || docValue > opValue) allMatch = false;
              break;
            case "$in":
              if (!Array.isArray(opValue) || !opValue.some((v) => this._compareValues(docValue, v))) allMatch = false;
              break;
            case "$nin":
              if (!Array.isArray(opValue) || opValue.some((v) => this._compareValues(docValue, v))) allMatch = false;
              break;
            case "$exists":
              if (opValue && docValue === void 0 || !opValue && docValue !== void 0) allMatch = false;
              break;
            case "$regex": {
              const pattern = typeof opValue === "string" ? opValue : String(opValue);
              const flags = operators.$options;
              const regex = new RegExp(pattern, flags);
              if (typeof docValue !== "string" || !regex.test(docValue)) allMatch = false;
              break;
            }
          }
          if (!allMatch) break;
        }
        if (!allMatch) return false;
      } else {
        if (!this._compareValues(docValue, value)) {
          return false;
        }
      }
    }
    return true;
  }
  _getFieldValue(doc, path) {
    const parts = path.split(".");
    let value = doc;
    for (const part of parts) {
      if (value === null || value === void 0) return void 0;
      if (typeof value !== "object") return void 0;
      value = value[part];
    }
    return value;
  }
  _setFieldValue(doc, path, value) {
    const parts = path.split(".");
    let current = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === void 0 || current[part] === null) {
        current[part] = {};
      }
      current = current[part];
    }
    current[parts[parts.length - 1]] = value;
  }
  _compareValues(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (a === void 0 || b === void 0) return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this._compareValues(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every((key) => this._compareValues(a[key], b[key]));
    }
    return false;
  }
  _sortDocs(docs, sort) {
    return [...docs].sort((a, b) => {
      for (const [key, direction] of Object.entries(sort)) {
        const aVal = this._getFieldValue(a, key);
        const bVal = this._getFieldValue(b, key);
        if (aVal === bVal) continue;
        if (aVal === void 0 || aVal === null) return direction;
        if (bVal === void 0 || bVal === null) return -direction;
        if (aVal < bVal) return -direction;
        if (aVal > bVal) return direction;
      }
      return 0;
    });
  }
  _applyProjection(doc, projection) {
    const hasInclusion = Object.values(projection).some((v) => v === 1);
    if (hasInclusion) {
      const result2 = projection._id !== 0 ? { _id: doc._id } : {};
      for (const [key, value] of Object.entries(projection)) {
        if (value === 1) {
          result2[key] = this._getFieldValue(doc, key);
        }
      }
      return result2;
    }
    const result = { ...doc };
    for (const [key, value] of Object.entries(projection)) {
      if (value === 0) {
        delete result[key];
      }
    }
    return result;
  }
  _applyUpdate(doc, update) {
    const result = { ...doc };
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        this._setFieldValue(result, key, value);
      }
    }
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        delete result[key];
      }
    }
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        const current = this._getFieldValue(result, key);
        this._setFieldValue(result, key, (typeof current === "number" ? current : 0) + value);
      }
    }
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        let current = this._getFieldValue(result, key);
        if (!Array.isArray(current)) {
          current = [];
          this._setFieldValue(result, key, current);
        }
        current.push(value);
      }
    }
    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet)) {
        let current = this._getFieldValue(result, key);
        if (!Array.isArray(current)) {
          current = [];
          this._setFieldValue(result, key, current);
        }
        const arr = current;
        if (!arr.some((v) => this._compareValues(v, value))) {
          arr.push(value);
        }
      }
    }
    if (update.$pull) {
      for (const [key, value] of Object.entries(update.$pull)) {
        const current = this._getFieldValue(result, key);
        if (Array.isArray(current)) {
          const filtered = current.filter((item) => !this._compareValues(item, value));
          this._setFieldValue(result, key, filtered);
        }
      }
    }
    return result;
  }
  _groupDocs(docs, groupSpec) {
    const groups = /* @__PURE__ */ new Map();
    for (const doc of docs) {
      const keyValue = groupSpec._id === null ? null : this._evaluateExpression(doc, groupSpec._id);
      const keyStr = JSON.stringify(keyValue);
      if (!groups.has(keyStr)) {
        groups.set(keyStr, { key: keyValue, docs: [] });
      }
      groups.get(keyStr).docs.push(doc);
    }
    const results = [];
    for (const [, { key, docs: groupDocs }] of groups) {
      const result = { _id: key };
      for (const [field, spec] of Object.entries(groupSpec)) {
        if (field === "_id") continue;
        if (typeof spec === "object" && spec !== null) {
          const accSpec = spec;
          if ("$sum" in accSpec) {
            if (accSpec.$sum === 1) {
              result[field] = groupDocs.length;
            } else {
              result[field] = groupDocs.reduce((sum, d) => sum + this._evaluateExpression(d, accSpec.$sum), 0);
            }
          } else if ("$avg" in accSpec) {
            const values = groupDocs.map((d) => this._evaluateExpression(d, accSpec.$avg));
            result[field] = values.reduce((a, b) => a + b, 0) / values.length;
          } else if ("$min" in accSpec) {
            result[field] = Math.min(...groupDocs.map((d) => this._evaluateExpression(d, accSpec.$min)));
          } else if ("$max" in accSpec) {
            result[field] = Math.max(...groupDocs.map((d) => this._evaluateExpression(d, accSpec.$max)));
          } else if ("$first" in accSpec) {
            result[field] = groupDocs.length > 0 ? this._evaluateExpression(groupDocs[0], accSpec.$first) : null;
          } else if ("$last" in accSpec) {
            result[field] = groupDocs.length > 0 ? this._evaluateExpression(groupDocs[groupDocs.length - 1], accSpec.$last) : null;
          }
        }
      }
      results.push(result);
    }
    return results;
  }
  _evaluateExpression(doc, expr) {
    if (expr === null) return null;
    if (typeof expr === "string") {
      if (expr.startsWith("$")) {
        return this._getFieldValue(doc, expr.substring(1));
      }
      return expr;
    }
    return expr;
  }
};

// src/mock-rpc-client.ts
function createMockRpcClient(options = {}) {
  const handlers = /* @__PURE__ */ new Map();
  const callLog = [];
  const enableCallLog = options.enableCallLog ?? true;
  if (options.handlers) {
    for (const [method, handler] of Object.entries(options.handlers)) {
      handlers.set(method, handler);
    }
  }
  const $proxy = new Proxy({}, {
    get: (_target, method) => {
      return async (...args) => {
        if (enableCallLog) {
          callLog.push({
            method,
            args,
            timestamp: Date.now()
          });
        }
        const handler = handlers.get(method);
        if (handler) {
          return handler(...args);
        }
        return options.defaultResponse ?? {};
      };
    }
  });
  return {
    $: $proxy,
    close: async () => {
    },
    callLog,
    clearCallLog: () => {
      callLog.length = 0;
    },
    on: (method, handler) => {
      handlers.set(method, handler);
    }
  };
}
function createMockRpcClientFactory(options = {}) {
  const clients = /* @__PURE__ */ new Map();
  const factory = Object.assign(
    (url) => {
      const client = createMockRpcClient(options);
      clients.set(url, client);
      return client;
    },
    {
      clients,
      getClient: (url) => clients.get(url)
    }
  );
  return factory;
}

export { MockMongoTransport, MockRpcTransport, createMockRpcClient, createMockRpcClientFactory };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map