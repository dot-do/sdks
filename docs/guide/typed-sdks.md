# Typed SDK Patterns Across Languages

This guide covers how Cap'n Web's type-safe RPC patterns translate across different programming languages, including the challenges and solutions for maintaining type safety with `RpcPromise<T>`.

## Overview

### Why Type Safety Matters for RPC

Remote Procedure Calls (RPC) operate across trust and execution boundaries. Type safety provides:

1. **Compile-time verification** - Catch type mismatches before deployment
2. **IDE support** - Autocomplete, refactoring, and inline documentation
3. **Documentation** - Types serve as executable specifications
4. **Refactoring safety** - Change APIs with confidence across client and server

Without types, RPC degrades to stringly-typed `call("method", args)` patterns that are error-prone and hard to maintain.

### The Challenge: Heterogeneous Type Systems

Cap'n Web's `RpcPromise<T>` presents unique challenges because it must:

1. **Act as a Promise** - Be awaitable to get type `T`
2. **Act as a Stub** - Allow property access (`.name`) that returns `RpcPromise<PropertyType>`
3. **Support pipelining** - Pass unawaited promises to other RPC calls
4. **Enable server-side mapping** - Transform arrays without client round-trips

This combination requires advanced type system features that vary dramatically across languages:

| Feature | TypeScript | Java | Go | Python |
|---------|------------|------|-----|--------|
| Generics | Yes | Yes (erased) | Yes | Yes (erased) |
| Reified generics | Yes | No | No | No |
| Type inference | Strong | Moderate | Limited | Runtime only |
| Async/await | Native | Via libraries | Goroutines | Native |

---

## Language Comparison Matrix

| Language | Generics | Type Erasure | Method Type Params | Codegen Required | Type Safety | Implementation |
|----------|----------|--------------|-------------------|------------------|-------------|----------------|
| **TypeScript** | Full | No | Yes | No | 100% | 100% |
| **C#** | Full | No (reified) | Yes | No | 98% | 95% |
| **Rust** | Full | No (monomorphization) | Yes | Minimal (proc macro) | 95% | 85% |
| **Kotlin** | Full | Yes (JVM) | Yes + reified inline | No | 95% | 50% |
| **Swift** | Full | No | Yes | No | 90% | 30% |
| **Java** | Limited | Yes | Yes | Recommended | 75% | 40% |
| **Go** | Limited (1.18+) | N/A | No | Required | 70% | 60% |
| **Python** | Runtime only | Yes | No | Recommended | 60% | 70% |

### Scoring Criteria

**Type Safety** - Potential compile-time guarantees when SDK is complete:
- **100%**: Full compile-time safety with no runtime workarounds
- **90-99%**: Minor ergonomic compromises (explicit type hints, occasional casts)
- **70-89%**: Requires helper patterns (TypeReference, explicit generics)
- **60-69%**: Runtime-only validation, IDE hints but no compile-time guarantees

**Implementation** - Current SDK feature completeness:
- **100%**: All features working (transport, pipelining, server-side map)
- **70-99%**: Core features working, some advanced features missing
- **40-69%**: Basic transport working, pipelining/map stubbed or local-only
- **10-39%**: Type design exists, transport not fully implemented

---

## RpcPromise<T> Equivalents

### TypeScript (Baseline)

TypeScript's structural typing and mapped types make `RpcPromise<T>` the most elegant:

```typescript
// Definition
type RpcPromise<T> = Promise<T> & RpcStub<T> & {
  map<U>(mapper: (value: RpcPromise<T extends (infer E)[] ? E : T>) => U):
    RpcPromise<T extends any[] ? U[] : U>
}

// Usage
const user: RpcPromise<User> = api.getUser(123)
const name: RpcPromise<string> = user.name  // Property access returns RpcPromise
const profile = await api.getProfile(user.id)  // Pipelining works naturally
```

**Key features:**
- Conditional types for `map()` array inference
- Intersection types for Promise + Stub behavior
- Full IDE autocomplete for all properties

---

### C# with Task<T> + LINQ

C# provides near-parity with TypeScript through reified generics and LINQ:

```csharp
// Definition
public class RpcPromise<T> : Task<T>, IRpcStub<T>
{
    public RpcPromise<TProperty> Field<TProperty>(Expression<Func<T, TProperty>> selector);
    public RpcPromise<TResult> Map<TResult>(Func<RpcPromise<T>, TResult> mapper);
}

// Usage - Basic typed call
RpcPromise<User> user = api.GetUserAsync(123);
string name = await user.Field(u => u.Name);

// Promise pipelining with expression trees
var profile = await api.GetProfileAsync(user.Field(u => u.Id));

// Server-side map with LINQ syntax
var names = await api.ListUsers()
    .Map(user => user.Field(u => u.Name));
```

**Unique advantages:**
- Expression trees capture property access for serialization
- LINQ integration for familiar syntax
- No runtime type erasure

**Minor workaround:**
- Must use `Field(u => u.Property)` instead of direct `.Property` access

---

### Kotlin with Reified + Coroutines

> **Implementation Status:** 50% - Types and coroutine integration are excellent. Transport layer throws `NotImplementedError`. Map operations fall back to local execution.

Kotlin's reified inline functions preserve type information at runtime:

```kotlin
// Definition
class RpcPromise<T> : Deferred<T> {
    inline fun <reified P> field(property: KProperty1<T, P>): RpcPromise<P>
    inline fun <reified R> map(noinline mapper: (RpcPromise<T>) -> R): RpcPromise<R>
}

// Usage - Basic typed call
val user: RpcPromise<User> = api.getUser(123)
val name: String = user.field(User::name).await()

// Promise pipelining
val profile = api.getProfile(user.field(User::id)).await()

// Server-side map with coroutines
val names = api.listUsers()
    .map { user -> user.field(User::name) }
    .await()

// Suspending interface support
interface MyApi : RpcTarget {
    suspend fun getUser(id: Int): User
    suspend fun getProfile(userId: Int): Profile
}
```

**Unique advantages:**
- `reified` preserves generic types through inline expansion
- Coroutines integrate naturally with async RPC
- Property references (`User::name`) are type-safe

**Minor workaround:**
- Inline functions cannot be virtual (interface methods use suspend instead)

---

### Swift with async/await + Actor

> **Implementation Status:** 30% - Type design is complete with `RpcRef<T>` and KeyPath support. WebSocket transport exists but pipelining is not wired. Map closure serialization to server is not implemented.

Swift uses reference types (`Ref<T>`) to model remote references:

```swift
// Definition
actor RpcPromise<T>: Sendable {
    func get() async throws -> T
    func field<P>(_ keyPath: KeyPath<T, P>) -> RpcPromise<P>
    func map<R>(_ transform: @escaping (RpcPromise<T>) -> R) -> RpcPromise<R>
}

// Type alias for ergonomics
typealias Ref<T> = RpcPromise<T>

// Usage - Basic typed call
let user: Ref<User> = api.getUser(123)
let name = try await user.field(\.name).get()

// Promise pipelining
let profile = try await api.getProfile(user.field(\.id))

// Server-side map
let names = try await api.listUsers()
    .map { user in user.field(\.name) }
    .get()

// SwiftUI integration with @MainActor
@MainActor
class ViewModel: ObservableObject {
    @Published var userName: String = ""

    func load() async {
        let user = api.getUser(123)
        userName = try await user.field(\.name).get()
    }
}
```

**Unique advantages:**
- KeyPath expressions (`\.name`) are fully type-safe
- Actor model prevents data races
- Sendable conformance for concurrent access

**Minor workaround:**
- Explicit `.get()` call required for final resolution

---

### Rust with Future + Traits

Rust uses traits and associated types for zero-cost abstraction:

```rust
// Definition
pub struct RpcPromise<T> {
    inner: Pin<Box<dyn Future<Output = Result<T, RpcError>> + Send>>,
}

impl<T: DeserializeOwned> RpcPromise<T> {
    pub fn field<F, P>(&self, f: F) -> RpcPromise<P>
    where
        F: Fn(&T) -> &P + Send + 'static,
        P: DeserializeOwned;

    pub fn map<F, R>(&self, f: F) -> RpcPromise<R>
    where
        F: Fn(RpcPromise<T>) -> R + Send + 'static,
        R: Serialize + DeserializeOwned;
}

// Usage - Basic typed call
let user: RpcPromise<User> = api.get_user(123);
let name: String = user.field(|u| &u.name).await?;

// Promise pipelining
let profile = api.get_profile(user.field(|u| &u.id)).await?;

// Server-side map
let names: Vec<String> = api.list_users()
    .map(|user| user.field(|u| &u.name))
    .await?;

// Proc macro for cleaner API definition
#[capnweb::api]
trait MyApi {
    async fn get_user(&self, id: i64) -> User;
    async fn get_profile(&self, user_id: i64) -> Profile;
}
```

**Unique advantages:**
- Zero-cost abstractions through monomorphization
- Ownership model prevents use-after-dispose
- Proc macros generate boilerplate

**Minor workaround:**
- Closure syntax for field access (closure captures are explicit)

---

### Java with CompletableFuture + TypeReference

> **Implementation Status:** 40% - HTTP transport works for basic calls. Pipelining is stubbed with TODO comments. Server-side map is not implemented. JSON-RPC response parsing is incomplete.

Java requires extra patterns to work around type erasure:

```java
// Definition
public class RpcPromise<T> extends CompletableFuture<T> {
    public <P> RpcPromise<P> field(String fieldName, TypeReference<P> type);
    public <R> RpcPromise<R> map(Function<RpcPromise<T>, R> mapper, TypeReference<R> type);
}

// TypeReference captures generic type at construction site
public abstract class TypeReference<T> {
    protected TypeReference() {
        // Captures type from anonymous class
    }
}

// Usage - Basic typed call
RpcPromise<User> user = api.getUser(123);
String name = user.field("name", new TypeReference<String>(){}).get();

// Promise pipelining
Profile profile = api.getProfile(
    user.field("id", new TypeReference<Integer>(){})
).get();

// Server-side map with explicit type
List<String> names = api.listUsers()
    .map(user -> user.field("name", new TypeReference<String>(){}),
         new TypeReference<List<String>>(){})
    .get();

// Record-based DTOs (Java 17+)
record User(int id, String name, String email) {}
```

**Workarounds required:**
- TypeReference pattern for runtime type preservation
- String-based field names (type-unsafe)
- Anonymous class overhead

**Recommendation:** Use code generation for production:

```java
// Generated typed stub
public interface MyApiStub {
    RpcPromise<User> getUser(int id);
    RpcPromise<Profile> getProfile(RpcPromise<Integer> userId);
}
```

---

### Go with TypedPromise[T] + Channels

Go 1.18+ generics enable typed promises, but with limitations:

```go
// Definition
type TypedPromise[T any] struct {
    result chan T
    err    chan error
}

func (p *TypedPromise[T]) Await() (T, error)
func (p *TypedPromise[T]) Field(name string) *TypedPromise[any]

// Generic map requires explicit type parameter
func Map[T, R any](p *TypedPromise[[]T], fn func(*TypedPromise[T]) R) *TypedPromise[[]R]

// Usage - Basic typed call
user := api.GetUser[User](ctx, 123)
name, err := user.Await()

// Promise pipelining (field access loses type)
profile, err := api.GetProfile(ctx, user.Field("id")).Await()

// Server-side map
names, err := Map(api.ListUsers(ctx), func(user *TypedPromise[User]) string {
    return user.Field("name")
}).Await()
```

**Limitations:**
- No method type parameters (must use functions)
- Field access returns `any` (type erasure)
- Verbose generic syntax

**Recommendation:** Use code generation:

```go
// Generated from schema
type UserStub struct {
    ID    func() *TypedPromise[int]
    Name  func() *TypedPromise[string]
    Email func() *TypedPromise[string]
}

func (api *MyApi) GetUser(ctx context.Context, id int) *UserStub
```

---

### Python with Generic[T]

Python's typing module provides IDE hints but no runtime enforcement:

```python
# Definition
from typing import Generic, TypeVar, Callable

T = TypeVar('T')
R = TypeVar('R')

class RpcPromise(Generic[T]):
    async def __await__(self) -> T: ...
    def __getattr__(self, name: str) -> 'RpcPromise[Any]': ...
    def map(self, fn: Callable[['RpcPromise[T]'], R]) -> 'RpcPromise[R]': ...

# Usage - Basic typed call (IDE hints only)
user: RpcPromise[User] = api.get_user(123)
name: str = await user.name  # Type checker knows this is str

# Promise pipelining
profile = await api.get_profile(user.id)

# Server-side map
names: list[str] = await api.list_users().map(
    lambda user: user.name
)

# TypedDict for structured data
class User(TypedDict):
    id: int
    name: str
    email: str
```

**Limitations:**
- Types erased at runtime
- Dynamic attribute access defeats type checking
- No compile-time guarantees

**Recommendation:** Use runtime validation:

```python
from pydantic import BaseModel

class User(BaseModel):
    id: int
    name: str
    email: str

# Pydantic validates at runtime
user = await api.get_user(123)  # Returns validated User instance
```

---

## Code Examples by Language

### Basic Typed Call

```typescript
// TypeScript
const user: User = await api.getUser(123)
```

```csharp
// C#
User user = await api.GetUserAsync(123);
```

```kotlin
// Kotlin
val user: User = api.getUser(123).await()
```

```swift
// Swift
let user: User = try await api.getUser(123)
```

```rust
// Rust
let user: User = api.get_user(123).await?;
```

```java
// Java
User user = api.getUser(123).get();
```

```go
// Go
user, err := api.GetUser[User](ctx, 123).Await()
```

```python
# Python
user: User = await api.get_user(123)
```

---

### Promise Pipelining

```typescript
// TypeScript - implicit pipelining
const user = api.getUser(123)
const profile = await api.getProfile(user.id)  // Single round trip
```

```csharp
// C# - expression-based pipelining
var user = api.GetUserAsync(123);
var profile = await api.GetProfileAsync(user.Field(u => u.Id));
```

```kotlin
// Kotlin - property reference pipelining
val user = api.getUser(123)
val profile = api.getProfile(user.field(User::id)).await()
```

```swift
// Swift - KeyPath pipelining
let user = api.getUser(123)
let profile = try await api.getProfile(user.field(\.id))
```

```rust
// Rust - closure pipelining
let user = api.get_user(123);
let profile = api.get_profile(user.field(|u| &u.id)).await?;
```

```java
// Java - TypeReference pipelining
var user = api.getUser(123);
var profile = api.getProfile(user.field("id", new TypeReference<Integer>(){})).get();
```

```go
// Go - field name pipelining
user := api.GetUser(ctx, 123)
profile, _ := api.GetProfile(ctx, user.Field("id")).Await()
```

```python
# Python - dynamic pipelining
user = api.get_user(123)
profile = await api.get_profile(user.id)
```

---

### Server-Side map()

```typescript
// TypeScript
const names = await api.listUsers().map(user => user.name)
```

```csharp
// C#
var names = await api.ListUsers().Map(user => user.Field(u => u.Name));
```

```kotlin
// Kotlin
val names = api.listUsers().map { user -> user.field(User::name) }.await()
```

```swift
// Swift
let names = try await api.listUsers().map { user in user.field(\.name) }.get()
```

```rust
// Rust
let names: Vec<String> = api.list_users()
    .map(|user| user.field(|u| &u.name))
    .await?;
```

```java
// Java
List<String> names = api.listUsers()
    .map(user -> user.field("name", new TypeReference<String>(){}),
         new TypeReference<List<String>>(){})
    .get();
```

```go
// Go
names, _ := Map(api.ListUsers(ctx), func(user *TypedPromise[User]) string {
    return user.Field("name")
}).Await()
```

```python
# Python
names = await api.list_users().map(lambda user: user.name)
```

---

### Error Handling

```typescript
// TypeScript
try {
    await api.riskyOperation()
} catch (e) {
    if (e instanceof RpcError) {
        console.error(`RPC failed: ${e.message}`)
    }
}
```

```csharp
// C#
try {
    await api.RiskyOperationAsync();
} catch (RpcException ex) {
    Console.WriteLine($"RPC failed: {ex.Message}");
}
```

```kotlin
// Kotlin
try {
    api.riskyOperation().await()
} catch (e: RpcException) {
    println("RPC failed: ${e.message}")
}
```

```swift
// Swift
do {
    try await api.riskyOperation()
} catch let error as RpcError {
    print("RPC failed: \(error.message)")
}
```

```rust
// Rust
match api.risky_operation().await {
    Ok(result) => println!("Success: {}", result),
    Err(RpcError { message, .. }) => eprintln!("RPC failed: {}", message),
}
```

```java
// Java
try {
    api.riskyOperation().get();
} catch (ExecutionException e) {
    if (e.getCause() instanceof RpcException rpc) {
        System.err.println("RPC failed: " + rpc.getMessage());
    }
}
```

```go
// Go
result, err := api.RiskyOperation(ctx).Await()
if err != nil {
    var rpcErr *RpcError
    if errors.As(err, &rpcErr) {
        fmt.Printf("RPC failed: %s\n", rpcErr.Message)
    }
}
```

```python
# Python
try:
    await api.risky_operation()
except RpcError as e:
    print(f"RPC failed: {e.message}")
```

---

## Tier Classification

### Tier 1: Production Ready

Languages with complete SDK implementation and near-parity type safety.

| Language | Type Safety | Implementation | Status |
|----------|-------------|----------------|--------|
| **TypeScript** | 100% | 100% | Full pipelining, server-side map, all transports |
| **C#** | 98% | 95% | Reified generics, expression trees, minor gaps in streaming |

**Recommendation:** These SDKs can be used in production with full Cap'n Web features.

---

### Tier 2: Usable with Limitations

Languages with working transport but incomplete advanced features.

| Language | Type Safety | Implementation | Missing Features |
|----------|-------------|----------------|------------------|
| **Rust** | 95% | 85% | Some proc macro edge cases, WebSocket reconnection |
| **Python** | 60% | 70% | Runtime-only types, but transport and map work |
| **Go** | 70% | 60% | No method type params; requires codegen for typed stubs |

**Recommendation:** Usable for most use cases. Check specific feature support before relying on advanced capabilities.

---

### Tier 3: Development in Progress

Languages with good type design but incomplete implementation.

| Language | Type Safety | Implementation | Current State |
|----------|-------------|----------------|---------------|
| **Kotlin** | 95% | 50% | Excellent types with reified inline functions. Transport throws `NotImplementedError`. Map operations fall back to local execution (N+1 round trips). |
| **Java** | 75% | 40% | HTTP transport works. Pipelining is stubbed (`// TODO`). No server-side map. WebSocket basic only. |
| **Swift** | 90% | 30% | Type design complete with `RpcRef<T>` and KeyPath support. WebSocket transport exists but pipelining not wired. Map closure serialization not implemented. |

**What's Missing:**

**Kotlin:**
- `callInternal()` - throws `NotImplementedError`
- `executeMap()` - falls back to local iteration
- WebSocket/HTTP transport not connected

**Java:**
- Pipelining (line 419: `// TODO: Implement actual pipelining`)
- Server-side map (not present)
- Complex type serialization
- JSON-RPC response parsing incomplete

**Swift:**
- Map closure serialization to server
- Pipelining over WebSocket (types exist, not wired)
- `RpcRef` expression evaluation

**Recommendation:** These SDKs are suitable for:
- Evaluating API design patterns
- Contributing to implementation
- Type-checking against schemas (Kotlin/Swift)

Not recommended for production use until implementation reaches 70%+.

---

## Recommendations for SDK Consumers

### For Production Use

1. **TypeScript, C#** - Full feature support, use directly
2. **Rust** - Most features working, check specific needs
3. **Python, Go** - Use generated typed stubs from API schema

### For Maximum Type Safety (When Implementation Complete)

1. **TypeScript, C#, Kotlin, Swift, Rust** - Use directly with full IDE support
2. **Java, Go** - Use generated typed stubs from API schema
3. **Python** - Combine type hints with Pydantic runtime validation

> **Note:** Kotlin and Swift have excellent type designs but incomplete implementations. The patterns shown in their sections represent the *target* API, not current functionality.

### For Rapid Prototyping

All languages support dynamic/untyped usage:

```typescript
// Works in all languages (conceptually)
const result = await session.call("methodName", arg1, arg2)
```

Upgrade to typed stubs when API stabilizes.

### For Mixed Codebases

If your server is TypeScript and clients are multi-language:

1. Define API as TypeScript interfaces
2. Export JSON Schema from TypeScript types
3. Generate typed stubs for each client language
4. Share schema in version control

### Schema-First Development

For large teams or public APIs:

```yaml
# api.capnweb.yaml
types:
  User:
    id: int
    name: string
    email: string

methods:
  getUser:
    params:
      id: int
    returns: User
```

Generate:
- TypeScript types and runtime validation
- C# interfaces and DTOs
- Kotlin data classes and suspend functions
- Swift protocols and Codable structs
- Rust traits and structs
- Java interfaces and records
- Go interfaces and structs
- Python TypedDicts and Pydantic models

---

## Summary

Cap'n Web's `RpcPromise<T>` pattern translates well across modern languages, with varying degrees of type safety and implementation completeness:

**Production Ready:**
- **TypeScript**: Reference implementation with 100% type safety and features
- **C#**: Near-parity with reified generics and expression trees

**Usable with Limitations:**
- **Rust**: Strong types, most features working
- **Python/Go**: Working transport, code generation recommended

**In Development:**
- **Kotlin**: Excellent type design (95%), transport not yet implemented (50%)
- **Java**: Basic HTTP works, pipelining/map stubbed (40%)
- **Swift**: Beautiful type design (90%), implementation incomplete (30%)

The key insight is that **promise pipelining and server-side mapping are type-system problems**, not just runtime problems. Languages with richer type systems naturally express these patterns better, while others benefit from code generation to bridge the gap.

**Choosing an SDK:**
- For production: TypeScript, C#, or Rust
- For prototyping: Any Tier 1 or Tier 2 SDK
- For contributing: Kotlin, Java, and Swift have the most implementation work remaining

The Tier 3 SDKs have excellent type designs that demonstrate what's *possible* in each language. Contributions to complete their implementations are welcome.
