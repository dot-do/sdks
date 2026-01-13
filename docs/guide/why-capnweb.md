# Why Cap'n Web?

Cap'n Web is a modern RPC protocol designed specifically for the web. Here's why you might choose it over other options.

## Comparison with Other Protocols

### vs. REST

| Feature | REST | Cap'n Web |
|---------|------|-----------|
| Type Safety | Manual schemas (OpenAPI) | Native TypeScript types |
| Batching | Multiple requests | Single request with pipelining |
| Bidirectional | Requires WebSocket workarounds | Native support |
| Object References | Not supported | First-class feature |

### vs. GraphQL

| Feature | GraphQL | Cap'n Web |
|---------|---------|-----------|
| Schema | Required SDL files | Optional TypeScript interfaces |
| Learning Curve | New query language | Just call methods |
| Subscriptions | Additional setup | Built into WebSocket mode |
| Over/Under-fetching | Solved | Solved differently (pipelining) |

### vs. gRPC

| Feature | gRPC | Cap'n Web |
|---------|------|-----------|
| Protocol | Protocol Buffers (binary) | JSON (human-readable) |
| Code Generation | Required | Not required |
| Browser Support | Requires grpc-web proxy | Native |
| Streaming | Complex setup | Simple callbacks |

## Key Advantages

### 1. Zero Schema, Full Type Safety

No `.proto` files, no GraphQL SDL, no code generation:

```typescript
// Just define your interface
interface MyApi {
  getUser(id: number): User
  updateUser(id: number, data: Partial<User>): User
}

// Use it directly with full type checking
const api = newWebSocketRpcSession<MyApi>('wss://api.example.com')
const user = await api.getUser(123)  // TypeScript knows this returns User
```

### 2. Promise Pipelining

Make multiple dependent calls in a single network round trip:

```typescript
// Without pipelining: 3 round trips
const session = await api.login(credentials)      // RT 1
const user = await session.getUser()              // RT 2
const profile = await api.getProfile(user.id)     // RT 3

// With pipelining: 1 round trip
const session = api.login(credentials)            // No await
const user = session.getUser()                    // Pipelined
const profile = await api.getProfile(user.id)     // All sent at once!
```

### 3. Object-Capability Security

Pass objects by reference with fine-grained access control:

```typescript
class RestrictedApi extends RpcTarget {
  // Only methods are accessible, not properties
  private secretKey = 'hidden'

  getData(): string {
    return 'public data'
  }

  #privateMethod() {
    // # prefix makes this truly private, not callable via RPC
  }
}
```

### 4. Bidirectional Communication

Server can call client methods just like client calls server:

```typescript
// Client provides a callback
class ClientCallback extends RpcTarget {
  onNotification(message: string) {
    console.log('Server says:', message)
  }
}

// Server can invoke it
const callback = new ClientCallback()
await api.subscribe(callback)  // Server now has a reference to call back
```

### 5. Native Cloudflare Workers Integration

Seamlessly works with Workers RPC:

```typescript
// Pass Cap'n Web stubs over Workers RPC
export class MyDurableObject extends DurableObject {
  async handleClient(capnwebStub: RpcStub<ClientApi>) {
    // Works automatically!
    await capnwebStub.notify('Hello from DO!')
  }
}
```

## When to Use Cap'n Web

**Choose Cap'n Web when you need:**

- Type-safe RPC without code generation
- Multiple dependent API calls (promise pipelining)
- Bidirectional communication
- Object references over RPC
- Cloudflare Workers integration

**Consider alternatives when:**

- You need binary efficiency (use gRPC/Cap'n Proto)
- You're building a public API with many consumers (REST is more discoverable)
- You need fine-grained field selection (GraphQL excels here)
- You're in a non-JavaScript ecosystem without Cap'n Web support

## Performance Characteristics

- **Payload Size**: JSON is larger than binary formats, but compresses well
- **Latency**: Promise pipelining dramatically reduces round trips
- **Throughput**: Batching improves efficiency for multiple calls
- **Memory**: Small footprint (~10KB minified+gzipped)

## Real-World Usage

Cap'n Web powers:

- Cloudflare Workers RPC (the built-in version)
- DotDo platform services
- Multi-region distributed applications

The protocol has been battle-tested in production at scale.
