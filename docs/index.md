---
layout: home

hero:
  name: DotDo SDKs
  text: Cap'n Web RPC for Every Language
  tagline: Type-safe, zero-schema RPC with Promise Pipelining across 17 languages
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/dot-do/sdks

features:
  - icon: ⚡
    title: Promise Pipelining
    details: Chain multiple RPC calls in a single network round trip. No need to wait for each response before making the next call.
  - icon: 🔒
    title: Object-Capability Security
    details: Pass functions and objects by reference over RPC. The recipient gets a stub that calls back to the original location.
  - icon: 🎯
    title: Zero-Schema Magic
    details: No code generation or schema files required. Just define TypeScript interfaces and start calling methods.
  - icon: 🌐
    title: Multi-Language Support
    details: Native implementations in TypeScript, Python, Go, Rust, Ruby, Java, Kotlin, Swift, C#, and more.
  - icon: 🔄
    title: Bidirectional RPC
    details: Server can call client, client can call server. Pass callbacks that execute remotely with full type safety.
  - icon: 🛡️
    title: Workers Compatible
    details: Seamlessly integrates with Cloudflare Workers built-in RPC. Pass stubs between systems automatically.
---

## Quick Example

::: code-group

```typescript [TypeScript]
import { newWebSocketRpcSession } from 'capnweb'

// Connect to the server
const api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Make RPC calls with full type safety
const user = await api.authenticate(token)
const profile = await api.getUserProfile(user.id)

console.log(`Hello, ${profile.name}!`)
```

```python [Python]
import asyncio
import capnweb

async def main():
    async with capnweb.connect('wss://api.example.com') as api:
        user = await api.authenticate(token)
        profile = await api.get_user_profile(user.id)
        print(f"Hello, {profile['name']}!")

asyncio.run(main())
```

```go [Go]
import "go.capnweb.do"

session, _ := capnweb.Dial(ctx, "wss://api.example.com")
defer session.Close()

user, _ := session.Authenticate(ctx, token)
profile, _ := session.GetUserProfile(ctx, user.ID)

fmt.Printf("Hello, %s!\n", profile.Name)
```

```rust [Rust]
use capnweb::prelude::*;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<Api>("wss://api.example.com").await?;

    let user = api.authenticate(token).await?;
    let profile = api.get_user_profile(user.id).await?;

    println!("Hello, {}!", profile.name);
    Ok(())
}
```

:::

## Promise Pipelining

Make multiple dependent calls in a single round trip:

```typescript
// Traditional approach: 2 round trips
const user = await api.authenticate(token)     // Round trip 1
const profile = await api.getUserProfile(user.id)  // Round trip 2

// With Promise Pipelining: 1 round trip
const userPromise = api.authenticate(token)    // Don't await yet
const profile = await api.getUserProfile(userPromise.id)  // Pipeline!
```

[Learn more about Promise Pipelining](/guide/promise-pipelining)

## Language Support

| Language | Status | Package |
|----------|--------|---------|
| TypeScript | Stable | `capnweb` / `@dotdo/capnweb` |
| Python | Beta | `capnweb` |
| Go | Beta | `go.capnweb.do` |
| Rust | Beta | `capnweb` |
| Ruby | Alpha | `capnweb` |
| Java | Alpha | `dev.capnweb:capnweb` |
| Kotlin | Alpha | `dev.capnweb:capnweb` |
| Swift | Alpha | `CapnWeb` |
| C#/.NET | Alpha | `CapnWeb` |
| Elixir | Alpha | `:capnweb` |

[View all languages](/installation/)
