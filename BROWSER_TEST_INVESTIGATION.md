# Browser Test Failures Investigation

**Issue**: dot-do-capnweb-z3u
**Date**: 2026-01-12
**Investigator**: Claude Code

## Summary

Browser tests in WebKit and Firefox fail with:
- "HTTP requests > can perform a batch HTTP request" -> "Load failed" / "NetworkError"
- "WebSockets > can open a WebSocket connection" -> "WebSocket connection failed"

The tests **pass in Chromium** but **fail in Firefox and WebKit**.

## Root Cause

The root cause is **IPv6 address binding** in the test server.

### Technical Details

When the test server starts in `__tests__/test-server.ts`, it binds to an ephemeral port:

```typescript
httpServer.listen(0);
let addr = httpServer.address() as AddressInfo;
project.provide("testServerHost", url.format({hostname: addr.address, port: addr.port}));
```

On macOS (and likely other systems), `server.listen(0)` binds to the IPv6 any-address `::`. The `url.format()` function correctly formats this as `[::]:PORT`, but this address causes issues:

1. **IPv6 `::` (any address)** binds to all interfaces but browsers have stricter handling
2. When tests try to connect to `http://[::]:PORT` or `ws://[::]:PORT`:
   - **Chromium**: Successfully connects (more permissive with IPv6)
   - **Firefox**: Fails with "NetworkError when attempting to fetch resource"
   - **WebKit**: Fails with "Load failed"

### Why Chromium Works

Chromium has more permissive handling of IPv6 localhost connections. It can resolve `[::]` to a local connection successfully.

### Why Firefox and WebKit Fail

Firefox and WebKit have stricter security policies for:
1. IPv6 literal addresses in URLs
2. Cross-origin requests to IPv6 addresses
3. Mixed localhost handling with IPv6

Both browsers treat `[::]` differently from `localhost` or `127.0.0.1` when running in the Playwright test environment.

## Evidence

Running the tests locally confirmed:
- Chromium: All 67 tests pass
- Firefox: 65 pass, 2 fail (HTTP batch and WebSocket)
- WebKit: 65 pass, 2 fail (HTTP batch and WebSocket)

Server address inspection shows:
```javascript
const server = http.createServer();
server.listen(0);
console.log(server.address());
// Output: { address: '::', family: 'IPv6', port: 60227 }
// Formatted: [::]:60227
```

## Solution

**Option 1: Bind explicitly to 127.0.0.1 (Recommended)**

Modify `__tests__/test-server.ts` to bind explicitly to IPv4 localhost:

```typescript
// Change from:
httpServer.listen(0);

// To:
httpServer.listen(0, '127.0.0.1');
```

And adjust the host formatting:

```typescript
// Change from:
project.provide("testServerHost", url.format({hostname: addr.address, port: addr.port}));

// To:
project.provide("testServerHost", `127.0.0.1:${addr.port}`);
// Or use 'localhost' for even better compatibility:
project.provide("testServerHost", `localhost:${addr.port}`);
```

**Option 2: Use localhost hostname**

If IPv4/IPv6 flexibility is needed:

```typescript
httpServer.listen(0, 'localhost');
// Then provide:
project.provide("testServerHost", `localhost:${addr.port}`);
```

## Files Affected

1. **`__tests__/test-server.ts`** (lines 54-61):
   - Change `httpServer.listen(0)` to `httpServer.listen(0, '127.0.0.1')`
   - Update the host formatting in `project.provide()`

## Additional Notes

### CORS is Not the Issue

The test server correctly sets CORS headers:
```typescript
headers: { "Access-Control-Allow-Origin": "*" }
```

This is sufficient for cross-origin requests. The failure happens before CORS processing - the browser cannot even establish the network connection.

### Browser-Specific Transport Behaviors

1. **WebSocket connections**: Both Firefox and WebKit immediately trigger the `error` event when connecting to `ws://[::]:PORT`. The error handler in `src/websocket.ts:82-84` catches this and throws "WebSocket connection failed."

2. **HTTP fetch requests**: The `fetch()` call in `src/batch.ts:73-76` fails immediately with browser-specific network errors.

3. **MessageChannel/MessagePort**: These tests pass because they don't use network transport at all - they communicate through the browser's internal messaging system.

## Testing the Fix

After applying the fix, run:
```bash
pnpm test --project=browsers-without-using
```

All 67 tests should pass across all three browser engines.

## Fix Applied

The fix has been applied to `__tests__/test-server.ts`. The test server now:
1. Binds explicitly to `127.0.0.1` instead of defaulting to `::`
2. Uses a Promise to wait for the listen callback before accessing the address
3. Formats the address as `127.0.0.1:PORT` instead of using `url.format()`

### Verified Results

After the fix:
- Chromium: 67 tests pass
- Firefox: 67 tests pass
- WebKit: 67 tests pass
- Node.js: 67 tests pass (index.test.ts)

Total: 201 browser tests pass (67 x 3 engines)
