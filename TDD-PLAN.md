# Comprehensive TDD Plan for DotDo SDKs / Cap'n Web

Based on four parallel reviews (general code, architecture, TypeScript, product/vision), this document outlines a complete Red-Green-Refactor TDD plan for addressing all identified issues.

## Summary Metrics

| Category | Count |
|----------|-------|
| Source Lines | 5,721 |
| Test Files | 14 |
| TODO/FIXME/HACK | 31 |
| `any` Type Usages | 55 |
| Non-null Assertions | ~44 |

---

# PHASE 1: RED (Write Failing Tests)

> These tests specify behavior we want but don't yet have. Write them first; they should fail.

## R1: Timeout Enforcement Tests

**Problem**: `TimeoutError` class exists (`errors.ts:37`) but no actual timeout mechanism is implemented. Long-running requests can hang indefinitely.

**Tests to Write** (`__tests__/timeout.test.ts`):

```typescript
describe('Timeout Enforcement', () => {
  it('should throw TimeoutError when request exceeds configured timeout', async () => {
    // RED: This will fail - no timeout mechanism exists
    const session = new RpcSession(transport, main, { timeout: 100 });
    const stub = session.getRemoteMain();

    // Server never responds
    await expect(stub.neverReturns()).rejects.toThrow(TimeoutError);
  });

  it('should respect per-call timeout override', async () => {
    // RED: No per-call timeout API exists
    const stub = session.getRemoteMain();
    await expect(stub.slowMethod({ timeout: 50 })).rejects.toThrow(TimeoutError);
  });

  it('should cancel request on timeout', async () => {
    // RED: Timeout should trigger cleanup
    // Verify export table entry is cleaned up after timeout
  });

  it('should include elapsed time in TimeoutError', async () => {
    // RED: TimeoutError should have `elapsed` property
  });
});
```

**Files Affected**: `src/rpc.ts`, `src/errors.ts`
**Priority**: P1

---

## R2: Session Lifecycle Tests

**Problem**: No documented close/cleanup API. Session memory management unclear.

**Tests to Write** (`__tests__/session-lifecycle.test.ts`):

```typescript
describe('Session Lifecycle', () => {
  it('should have a close() method', () => {
    // RED: close() doesn't exist on RpcSession interface
    const session = new RpcSession(transport, main);
    expect(typeof session.close).toBe('function');
  });

  it('should resolve onClosed() when session ends', async () => {
    // RED: onClosed() doesn't exist
    const session = new RpcSession(transport, main);
    const closed = session.onClosed();
    session.close();
    await expect(closed).resolves.toBeUndefined();
  });

  it('should reject pending calls when session closes', async () => {
    // RED: Pending calls should fail gracefully
    const stub = session.getRemoteMain();
    const pending = stub.slowMethod();
    session.close();
    await expect(pending).rejects.toThrow(ConnectionError);
  });

  it('should clean up import/export tables on close', async () => {
    // RED: Memory should be reclaimed
    const before = session.getStats();
    // ... make many calls ...
    session.close();
    // Verify tables are emptied
  });

  it('should not accept new calls after close', async () => {
    session.close();
    await expect(stub.anyMethod()).rejects.toThrow('Session closed');
  });
});
```

**Files Affected**: `src/rpc.ts`, `src/index.ts`
**Priority**: P0

---

## R3: Browser Environment Tests

**Problem**: Existing tests fail in webkit/firefox. Need to identify root cause.

**Tests to Investigate** (`__tests__/websocket.test.ts`, `__tests__/batch.test.ts`):

```typescript
// These tests ALREADY EXIST but FAIL in browser environments:
// - "HTTP requests > can perform a batch HTTP request" → Load failed
// - "WebSockets > can open a WebSocket connection" → WebSocket connection failed

describe('Browser Compatibility', () => {
  it('should handle WebSocket close events in webkit', async () => {
    // Investigate: Does webkit fire different close codes?
  });

  it('should handle HTTP fetch in firefox', async () => {
    // Investigate: CORS preflight differences?
  });
});
```

**Files Affected**: `__tests__/websocket.test.ts`, `__tests__/batch.test.ts`, `vitest.config.ts`
**Priority**: P0

---

## R4: CORS Null Origin Tests

**Problem**: Null origin requests (sandboxed iframes, file://) may bypass CORS entirely.

**Tests to Write** (`__tests__/cors.test.ts`):

```typescript
describe('CORS Null Origin Handling', () => {
  it('should handle null Origin header explicitly', () => {
    // RED: Current code doesn't handle null origin
    const request = new Request('https://api.example.com', {
      headers: { 'Origin': '' }  // or missing entirely
    });
    const headers = setCorsHeaders(request, { allowedOrigins: ['https://trusted.com'] });
    // Should NOT set Access-Control-Allow-Origin
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('should block null origin when wildcard is used with credentials', () => {
    // Security: Null origin + credentials = danger
    const request = new Request('https://api.example.com');
    const headers = setCorsHeaders(request, {
      allowedOrigins: '*',
      allowCredentials: true
    });
    // Should error or not allow
  });
});
```

**Files Affected**: `src/index.ts:226-251`
**Priority**: P1

---

## R5: Backpressure Tests

**Problem**: All transports have unbounded queues. Fast sender can overwhelm receiver.

**Tests to Write** (`__tests__/backpressure.test.ts`):

```typescript
describe('Backpressure Handling', () => {
  it('should respect maxQueueSize option', async () => {
    // RED: No queue limit exists
    const session = new RpcSession(transport, main, { maxQueueSize: 10 });

    // Queue 20 messages rapidly
    const promises = Array(20).fill(0).map(() => stub.echo('x'));

    // Some should be rejected or blocked
    const results = await Promise.allSettled(promises);
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
  });

  it('should apply backpressure when queue is full', async () => {
    // RED: send() should signal backpressure
    const transport = new BufferedTransport({ maxBuffer: 5 });
    // Verify send() returns false or throws when buffer full
  });

  it('should resume when queue drains', async () => {
    // RED: Backpressure should release when space available
  });
});
```

**Files Affected**: `src/websocket.ts`, `src/batch.ts`, `src/messageport.ts`, `src/rpc.ts`
**Priority**: P2

---

## R6: Message Validation Tests

**Problem**: Malformed messages cause cryptic errors. No schema validation.

**Tests to Write** (`__tests__/message-validation.test.ts`):

```typescript
describe('Message Validation', () => {
  it('should reject non-array messages with clear error', async () => {
    // RED: Currently causes cryptic error
    transport.injectMessage('{"not": "an array"}');
    await expect(receiveNext()).rejects.toThrow(SerializationError);
    await expect(receiveNext()).rejects.toThrow(/expected array/i);
  });

  it('should reject messages with unknown type', async () => {
    // RED: Unknown message types not handled
    transport.injectMessage('["unknown_type", 123]');
    await expect(receiveNext()).rejects.toThrow(/unknown message type/i);
  });

  it('should reject messages with wrong arity', async () => {
    // RED: ["resolve"] with no args should error clearly
    transport.injectMessage('["resolve"]');
    await expect(receiveNext()).rejects.toThrow(/missing/i);
  });

  it('should limit message size', async () => {
    // RED: No size limit exists
    const hugeMessage = 'x'.repeat(10_000_000);
    transport.injectMessage(hugeMessage);
    await expect(receiveNext()).rejects.toThrow(/message too large/i);
  });

  it('should limit recursion depth', async () => {
    // RED: Deep nesting could cause stack overflow
    const deeplyNested = JSON.stringify(createDeepObject(1000));
    transport.injectMessage(deeplyNested);
    await expect(receiveNext()).rejects.toThrow(/too deeply nested/i);
  });
});
```

**Files Affected**: `src/rpc.ts:1202-1277`, `src/serialize.ts`
**Priority**: P1

---

## R7: Memory Leak Tests

**Problem**: Import/export tables grow indefinitely in long-lived sessions.

**Tests to Write** (`__tests__/memory.test.ts`):

```typescript
describe('Memory Management', () => {
  it('should not leak imports after resolution', async () => {
    // RED: Import table may not clean up properly
    const session = new RpcSession(transport, main);
    const before = session.getStats().imports;

    // Make 1000 calls, all resolve
    for (let i = 0; i < 1000; i++) {
      await stub.echo(i);
    }

    const after = session.getStats().imports;
    expect(after).toBeLessThan(before + 10); // Should be ~same
  });

  it('should handle circular capability references', async () => {
    // RED: Circular refs may prevent GC
    const a = new RpcTarget();
    const b = new RpcTarget();
    a.other = b;
    b.other = a;

    await stub.passTarget(a);
    await stub.passTarget(b);

    // Drop local refs
    a.other = undefined;
    b.other = undefined;

    // Verify export table cleans up
  });

  it('should support explicit capability disposal', async () => {
    // RED: No way to explicitly release capability
    const cap = await stub.getCapability();
    cap[Symbol.dispose]();  // or cap.release()

    // Verify no longer usable
    await expect(cap.method()).rejects.toThrow(/disposed/i);
  });
});
```

**Files Affected**: `src/rpc.ts:615-634`, `src/core.ts`
**Priority**: P1

---

## R8: Silent Error Reporting Tests

**Problem**: Errors swallowed in catch blocks without notification.

**Tests to Write** (`__tests__/error-reporting.test.ts`):

```typescript
describe('Silent Error Reporting', () => {
  it('should call onInternalError for serialization failures', async () => {
    // RED: Errors in serialization may be silently swallowed
    const onInternalError = vi.fn();
    const session = new RpcSession(transport, main, { onInternalError });

    // Trigger a serialization error
    await stub.passUnserializable(Symbol('cant serialize'));

    expect(onInternalError).toHaveBeenCalled();
    expect(onInternalError.mock.calls[0][0]).toBeInstanceOf(SerializationError);
  });

  it('should call onInternalError for transport failures', async () => {
    const onInternalError = vi.fn();
    transport.failNextSend(new Error('network down'));

    await stub.anyMethod();

    expect(onInternalError).toHaveBeenCalled();
  });

  it('should log to console when no onInternalError provided', async () => {
    // RED: Currently silent
    const consoleSpy = vi.spyOn(console, 'error');

    // Trigger internal error without callback
    transport.failNextSend(new Error('oops'));
    await stub.anyMethod();

    expect(consoleSpy).toHaveBeenCalled();
  });
});
```

**Files Affected**: `src/rpc.ts:911-920`, `src/rpc.ts:1095-1126`
**Priority**: P0 (Critical)

---

## R9: Concurrent Operation Tests

**Problem**: Race conditions in rapid connect/disconnect, concurrent abort+send.

**Tests to Write** (`__tests__/concurrency.test.ts`):

```typescript
describe('Concurrent Operations', () => {
  it('should handle rapid connect/disconnect cycles', async () => {
    // RED: May leave orphaned state
    for (let i = 0; i < 100; i++) {
      const session = new RpcSession(transport, main);
      const stub = session.getRemoteMain();
      stub.method(); // Don't await
      session.close();
    }
    // Should not leak, crash, or leave hanging promises
  });

  it('should handle concurrent abort and send', async () => {
    // RED: Race between abort() and send()
    const session = new RpcSession(transport, main);
    const stub = session.getRemoteMain();

    // Start many calls
    const calls = Array(10).fill(0).map(() => stub.method());

    // Abort mid-flight
    session.abort(new Error('test abort'));

    // All should reject cleanly
    for (const call of calls) {
      await expect(call).rejects.toThrow();
    }
  });

  it('should handle concurrent dispose on same capability', async () => {
    const cap = await stub.getCapability();

    // Dispose twice concurrently
    await Promise.all([
      cap[Symbol.dispose](),
      cap[Symbol.dispose]()
    ]);
    // Should not throw or double-release
  });
});
```

**Files Affected**: `src/rpc.ts`
**Priority**: P1

---

# PHASE 2: GREEN (Make Tests Pass)

> Minimal implementations to make RED tests pass. Focus on correctness, not elegance.

## G1: Implement Timeout Mechanism

**Implementation** in `src/rpc.ts`:

```typescript
// Add to RpcSessionOptions
timeout?: number;  // Default timeout in ms

// In sendCall():
private sendCall(...): RpcImportHook {
  const imp = new ImportTableEntry(...);

  if (this.options.timeout) {
    imp.startTimeout(this.options.timeout, () => {
      imp.reject(new TimeoutError(`Request timed out after ${this.options.timeout}ms`));
      this.releaseImport(imp.id);
    });
  }

  return imp;
}

// In ImportTableEntry:
private timeoutId?: ReturnType<typeof setTimeout>;

startTimeout(ms: number, onTimeout: () => void) {
  this.timeoutId = setTimeout(onTimeout, ms);
}

clearTimeout() {
  if (this.timeoutId) {
    clearTimeout(this.timeoutId);
    this.timeoutId = undefined;
  }
}

resolve(value: unknown) {
  this.clearTimeout();
  // ... existing logic
}
```

**Dependencies**: None
**Estimated Complexity**: Medium

---

## G2: Implement Session Lifecycle

**Implementation** in `src/rpc.ts`:

```typescript
class RpcSessionImpl {
  private closed = false;
  private closedResolver?: PromiseWithResolvers<Error | undefined>;

  close(): void {
    if (this.closed) return;
    this.closed = true;

    // Reject all pending imports
    for (const imp of this.imports) {
      if (imp && !imp.resolved) {
        imp.reject(new ConnectionError('Session closed'));
      }
    }

    // Clear tables
    this.imports = [];
    this.exports = [];
    this.reverseExports.clear();

    // Notify transport
    this.transport.abort?.(new Error('Session closed'));

    // Resolve onClosed
    this.closedResolver?.resolve(undefined);
  }

  onClosed(): Promise<Error | undefined> {
    if (!this.closedResolver) {
      this.closedResolver = Promise.withResolvers();
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return this.closedResolver.promise;
  }
}
```

**Dependencies**: None
**Estimated Complexity**: Medium

---

## G3: Fix Browser Tests

**Investigation Steps**:
1. Run tests locally in each browser
2. Check if test server is accessible from browser context
3. Verify WebSocket URL is correct (ws:// vs wss://)
4. Check CORS headers for test server
5. Verify Playwright browser context has network access

**Likely Fixes**:
```typescript
// vitest.config.ts - Add test server host binding
globalSetup: ['__tests__/test-server.ts'],
setupFiles: ['__tests__/browser-setup.ts'],

// Browser-specific transport options may be needed
```

**Dependencies**: R3 investigation
**Estimated Complexity**: Unknown (needs investigation)

---

## G4: Fix CORS Null Origin Handling

**Implementation** in `src/index.ts`:

```typescript
export function setCorsHeaders(
  request: Request,
  options: WorkersRpcResponseOptions
): Headers {
  const headers = new Headers();
  const requestOrigin = request.headers.get("Origin");

  // Explicitly handle null/missing origin
  if (requestOrigin === null || requestOrigin === '') {
    // No origin = same-origin request or null origin
    // Do NOT set CORS headers for null origins with credentials
    if (options.allowCredentials) {
      // Security: Don't reflect null origin with credentials
      return headers;
    }
    // For non-credential requests, we can allow if wildcard
    if (options.allowedOrigins === '*') {
      // Document: This allows null origin requests
      headers.set('Access-Control-Allow-Origin', 'null');
    }
    return headers;
  }

  // ... existing logic for non-null origins
}
```

**Dependencies**: None
**Estimated Complexity**: Low

---

## G5: Implement Backpressure

**Implementation** in `src/rpc.ts` and transports:

```typescript
// Add to RpcSessionOptions
maxPendingCalls?: number;  // Default: unlimited

// In RpcSessionImpl
private pendingCallCount = 0;

sendCall(...): RpcImportHook {
  if (this.options.maxPendingCalls &&
      this.pendingCallCount >= this.options.maxPendingCalls) {
    throw new RpcError('Too many pending calls');
  }

  this.pendingCallCount++;
  const imp = new ImportTableEntry(...);
  imp.onComplete = () => this.pendingCallCount--;

  return imp;
}
```

**Dependencies**: None
**Estimated Complexity**: Medium

---

## G6: Add Message Validation

**Implementation** in `src/rpc.ts`:

```typescript
private validateMessage(msg: unknown): asserts msg is RpcMessage {
  if (!Array.isArray(msg)) {
    throw new SerializationError('Message must be an array');
  }

  const type = msg[0];
  const validTypes = ['push', 'pull', 'resolve', 'reject', 'release',
                      'pipeline', 'hello', 'hello-ack', 'hello-reject'];

  if (!validTypes.includes(type)) {
    throw new SerializationError(`Unknown message type: ${type}`);
  }

  // Type-specific validation
  switch (type) {
    case 'resolve':
    case 'reject':
      if (msg.length < 3) {
        throw new SerializationError(`${type} requires at least 3 elements`);
      }
      if (typeof msg[1] !== 'number') {
        throw new SerializationError(`${type}[1] must be a number (import ID)`);
      }
      break;
    // ... other cases
  }
}
```

**Dependencies**: None
**Estimated Complexity**: Medium

---

## G7: Fix Memory Management

**Implementation**:

```typescript
// Add getStats() with more detail
getStats(): RpcStats {
  return {
    imports: this.imports.filter(Boolean).length,
    exports: this.exports.filter(Boolean).length,
    pendingCalls: this.pendingCallCount,
    peakImports: this.peakImports,
    peakExports: this.peakExports,
  };
}

// Add drain() that waits for cleanup
async drain(): Promise<void> {
  // Wait for all pending calls to complete
  while (this.pendingCallCount > 0) {
    await new Promise(r => setTimeout(r, 10));
  }

  // Compact sparse arrays
  this.imports = this.imports.filter(Boolean);
  this.exports = this.exports.filter(Boolean);
}
```

**Dependencies**: G2 (lifecycle)
**Estimated Complexity**: Medium

---

## G8: Fix Silent Error Handling

**Implementation** in `src/rpc.ts`:

```typescript
private reportInternalError(error: unknown, context: string): void {
  if (this.options.onInternalError) {
    try {
      this.options.onInternalError(error, context);
    } catch (callbackError) {
      console.error('[RPC] onInternalError callback threw:', callbackError);
    }
  } else {
    // Default: log to console
    console.error(`[RPC Internal Error] ${context}:`, error);
  }
}

// Replace all silent catch blocks:
// BEFORE:
.catch(err => {});

// AFTER:
.catch(err => this.reportInternalError(err, 'serialization'));
```

**Dependencies**: None
**Estimated Complexity**: Low

---

## G9: Fix Concurrent Operations

**Implementation**:

```typescript
// Add state guards
private sendCall(...): RpcImportHook {
  if (this.closed) {
    throw new ConnectionError('Session is closed');
  }
  if (this.abortReason) {
    throw new ConnectionError('Session was aborted');
  }
  // ... existing logic
}

// Make dispose idempotent
class ImportTableEntry {
  private disposed = false;

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // ... cleanup
  }
}
```

**Dependencies**: G2 (lifecycle)
**Estimated Complexity**: Low

---

# PHASE 3: REFACTOR (Improve While Green)

> These improvements don't change behavior. All tests should remain passing.

## RF1: Type Safety - Replace `any` with Proper Types

### RF1.1: RPC Message Discriminated Union

**Location**: `src/rpc.ts`

```typescript
// BEFORE: Messages are untyped arrays
private send(msg: any): void { ... }

// AFTER: Proper discriminated union
type RpcMessage =
  | ['push', Expression]
  | ['pull', ImportId]
  | ['resolve', ImportId, Expression]
  | ['reject', ImportId, Expression]
  | ['release', ExportId]
  | ['pipeline', ImportId, PropertyPath, ...unknown[]]
  | ['hello', HandshakePayload]
  | ['hello-ack', HandshakePayload]
  | ['hello-reject', string];

private send(msg: RpcMessage): void { ... }
```

**Impact**: 10+ locations in `rpc.ts`

### RF1.2: Constructor Type Fixes

**Location**: `src/index.ts:79-175`

```typescript
// BEFORE:
export const RpcStub: {
  new <T extends RpcCompatible<T>>(value: T): RpcStub<T>;
} = <any>RpcStubImpl;

// AFTER: Use proper type relationship
export const RpcStub = RpcStubImpl as {
  new <T extends RpcCompatible<T>>(value: T): RpcStub<T>;
};

// Or better, use a type-safe factory pattern
```

**Impact**: 6 locations in `index.ts`

### RF1.3: Error Type Improvements

**Location**: `src/rpc.ts:618`, `src/rpc.ts:634`

```typescript
// BEFORE:
private abortReason?: any;
onBrokenCallbacks: ((error: any) => void)[] = [];

// AFTER:
private abortReason?: Error;
onBrokenCallbacks: ((error: Error) => void)[] = [];
```

**Total `any` Removals Target**: 40 of 55 occurrences

---

## RF2: Split core.ts (1,719 lines)

**Current Structure**:
- Lines 1-150: Type utilities (`typeForRpc`, `copyForRpc`)
- Lines 151-450: StubHook system
- Lines 451-750: RpcStub implementation
- Lines 751-1050: RpcPromise implementation
- Lines 1051-1350: RpcTarget implementation
- Lines 1351-1719: Miscellaneous utilities

**Proposed Split**:

```
src/core/
├── index.ts          (re-exports)
├── types.ts          (type utilities, typeForRpc, copyForRpc)
├── stub-hook.ts      (StubHook, PayloadStubHook, EmbargoedStubHook)
├── stub.ts           (RpcStubImpl, Proxy handler)
├── promise.ts        (RpcPromiseImpl)
├── target.ts         (RpcTarget, RpcTargetImpl)
└── utils.ts          (shared utilities)
```

**Refactoring Steps**:
1. Create directory structure
2. Extract types first (least dependencies)
3. Extract target (standalone)
4. Extract stub-hook (used by stub/promise)
5. Extract stub and promise
6. Update imports
7. Verify all tests pass

---

## RF3: Extract Common Transport Patterns

**Current Duplication**:
- `#receiveQueue`, `#receiveResolver`, `#error` in 3 transports
- Queue management logic repeated
- Error handling patterns identical

**Proposed Base Class**:

```typescript
// src/transports/base.ts
export abstract class BaseTransport implements RpcTransport {
  protected receiveQueue: string[] = [];
  protected receiveResolver?: (msg: string) => void;
  protected receiveRejecter?: (err: any) => void;
  protected error?: Error;

  abstract doSend(message: string): Promise<void>;

  async send(message: string): Promise<void> {
    if (this.error) throw this.error;
    return this.doSend(message);
  }

  async receive(): Promise<string> {
    if (this.error) throw this.error;

    if (this.receiveQueue.length > 0) {
      return this.receiveQueue.shift()!;
    }

    return new Promise((resolve, reject) => {
      this.receiveResolver = resolve;
      this.receiveRejecter = reject;
    });
  }

  protected enqueue(message: string): void {
    if (this.receiveResolver) {
      this.receiveResolver(message);
      this.receiveResolver = undefined;
      this.receiveRejecter = undefined;
    } else {
      this.receiveQueue.push(message);
    }
  }

  protected setError(error: Error): void {
    this.error = error;
    this.receiveRejecter?.(error);
  }
}
```

---

## RF4: Consolidate Handshake Logic

**Current Duplication**: `handleHello` (lines 709-752) and `handleHelloAck` (lines 758-792) share:
- Version negotiation logic
- Callback invocation
- Handshake resolver handling

**Proposed Extraction**:

```typescript
private completeHandshake(negotiatedVersion: string, fromHello: boolean): void {
  this.negotiatedVersion = negotiatedVersion;
  this.handshakeComplete = true;

  const isLatest = negotiatedVersion === PROTOCOL_VERSION;
  this.options.onVersionNegotiated?.(negotiatedVersion, isLatest);

  if (!isLatest) {
    this.options.onVersionWarning?.(
      `Negotiated version ${formatVersion(negotiatedVersion)} is not latest`
    );
  }

  this.handshakeResolver?.resolve();
  this.handshakeResolver = undefined;
}
```

---

## RF5: Standardize Private Member Naming

**Current Mix**:
- Hash prefix: `#webSocket`, `#batchToSend` (modern)
- No prefix: `private exports`, `private imports` (classic)
- Underscore: `_activePull` (legacy)

**Target**: Consistent use of hash prefix for true privacy

```typescript
// All private members use # prefix
class RpcSessionImpl {
  #exports: Array<ExportTableEntry> = [];
  #imports: Array<ImportTableEntry> = [];
  #abortReason?: Error;
  // ...
}
```

---

## RF6: Resolve TODOs

**31 Outstanding TODOs by Category**:

| Category | Count | Action |
|----------|-------|--------|
| `TODO(someday)` | 6 | Move to GitHub issues |
| `TODO: Clean this up` | 2 | Create refactor issues |
| `HACK:` | 4 | Replace with proper solution |
| `TODO: Shouldn't happen` | 1 | Add proper error handling |
| Design questions | 8 | Document decisions |
| Performance hints | 3 | Add to backlog |
| Type improvements | 7 | Part of RF1 |

**Process**:
1. Create GitHub/beads issues for each TODO
2. Replace inline TODO with issue reference
3. Address or close each issue

---

## RF7: Add Architectural Documentation

**Documents to Create/Update**:

### ARCHITECTURE.md Additions:
- Embargo protocol explanation with sequence diagram
- E-order (event order) guarantees
- Import/export table lifecycle
- Message flow diagrams

### INTERNALS.md (new):
- Core algorithms (reference counting, sparse arrays)
- Promise pipelining flow
- Capability passing lifecycle
- Transport abstraction requirements

### SECURITY.md Updates:
- CORS decision tree
- Capability security model
- Rate limiting recommendations

---

# Dependency Graph

```
PHASE 1 (RED)           PHASE 2 (GREEN)         PHASE 3 (REFACTOR)
─────────────          ──────────────          ─────────────────
R1: Timeout       ───► G1: Timeout impl   ───► RF1: Type safety
R2: Lifecycle     ───► G2: Lifecycle impl ───► RF2: Split core.ts
R3: Browser       ───► G3: Browser fixes  ───► RF3: Extract transports
R4: CORS          ───► G4: CORS fixes     ───► RF4: Consolidate handshake
R5: Backpressure  ───► G5: Backpressure   ───► RF5: Private naming
R6: Validation    ───► G6: Validation     ───► RF6: Resolve TODOs
R7: Memory        ───► G7: Memory mgmt    ───► RF7: Documentation
R8: Error report  ───► G8: Error handling │
R9: Concurrency   ───► G9: Concurrency    │
                                          │
                       G2 ◄─── depends on ─┤
                       G7 ◄─── depends on ─┤
                       G9 ◄─── depends on ─┘
```

---

# Priority Matrix

| Issue | Priority | Phase | Dependencies | Estimated Effort |
|-------|----------|-------|--------------|------------------|
| R8/G8: Silent errors | P0 | RED→GREEN | None | Small |
| R2/G2: Session lifecycle | P0 | RED→GREEN | None | Medium |
| R3/G3: Browser tests | P0 | RED→GREEN | Investigation | Unknown |
| R1/G1: Timeout | P1 | RED→GREEN | None | Medium |
| R4/G4: CORS null origin | P1 | RED→GREEN | None | Small |
| R6/G6: Message validation | P1 | RED→GREEN | None | Medium |
| R7/G7: Memory management | P1 | RED→GREEN | G2 | Medium |
| R9/G9: Concurrency | P1 | RED→GREEN | G2 | Small |
| R5/G5: Backpressure | P2 | RED→GREEN | None | Medium |
| RF1: Type safety | P1 | REFACTOR | All GREEN | Large |
| RF2: Split core.ts | P2 | REFACTOR | All GREEN | Large |
| RF3: Extract transports | P2 | REFACTOR | All GREEN | Medium |
| RF4: Consolidate handshake | P3 | REFACTOR | All GREEN | Small |
| RF5: Private naming | P3 | REFACTOR | RF2 | Small |
| RF6: Resolve TODOs | P2 | REFACTOR | All GREEN | Medium |
| RF7: Documentation | P2 | REFACTOR | All GREEN | Medium |

---

# Execution Order

## Wave 1: Critical Fixes (P0)
1. R8 → G8: Silent error handling
2. R2 → G2: Session lifecycle
3. R3 → G3: Browser test investigation/fixes

## Wave 2: Safety Net (P1)
4. R1 → G1: Timeout enforcement
5. R4 → G4: CORS null origin
6. R6 → G6: Message validation
7. R7 → G7: Memory management
8. R9 → G9: Concurrency fixes

## Wave 3: Robustness (P2)
9. R5 → G5: Backpressure

## Wave 4: Code Quality (Refactor)
10. RF1: Type safety overhaul
11. RF6: TODO resolution
12. RF2: Split core.ts
13. RF3: Extract transport patterns
14. RF7: Documentation

## Wave 5: Polish (P3)
15. RF4: Consolidate handshake
16. RF5: Standardize naming
