# Cap'n Web Java Client Library - Syntax Exploration

This document explores divergent syntax approaches for the Java client library (`com.dotdo:capnweb`),
targeting Java 21+ with modern idioms. Cap'n Web is a bidirectional capability-based RPC protocol
over JSON supporting stubs, pipelining, targets, and multiple transports.

---

## Approach 1: Retrofit-Style Declarative Interfaces with Dynamic Proxy

Inspired by [Retrofit](https://square.github.io/retrofit/) and [Feign](https://github.com/OpenFeign/feign),
this approach uses annotated interfaces that are implemented at runtime via dynamic proxy.

### Philosophy
- **Declarative over imperative**: Define *what* you want, not *how* to call it
- **Interface-first**: Your RPC contract is a plain Java interface
- **Zero boilerplate**: Runtime generates the implementation

### Connection/Session Creation

```java
// Builder pattern with try-with-resources for lifecycle management
try (CapnWeb session = CapnWeb.builder()
        .endpoint("wss://api.example.com/rpc")
        .transport(Transport.WEBSOCKET)  // or HTTP_BATCH
        .authenticate(ApiKey.of(System.getenv("API_KEY")))
        .build()) {

    // Create stub from interface
    TodoService todos = session.create(TodoService.class);

    // Use it like a local object
    List<Todo> items = todos.list("work").join();
}
```

### Interface Definition

```java
@CapnWebService
public interface TodoService {

    // Simple async call - returns CompletableFuture by default
    CompletableFuture<List<Todo>> list(@Param("category") String category);

    // Blocking variant for virtual thread contexts
    @Blocking
    Todo getById(String id);

    // Fire-and-forget (no response expected)
    @OneWay
    void notifyUpdate(String id);

    // Nested capability - returns another stub
    CompletableFuture<CommentService> comments(String todoId);
}
```

### Making RPC Calls

```java
// Async with CompletableFuture
todos.list("work")
    .thenAccept(items -> items.forEach(System.out::println))
    .exceptionally(e -> { log.error("Failed", e); return null; });

// Blocking (safe with virtual threads)
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> {
        Todo todo = todos.getById("123");  // blocks virtual thread, not platform thread
        process(todo);
    });
}
```

### Pipelining Syntax

```java
// Method chaining via capability returns - no intermediate awaits!
// Each call returns a "promise stub" that can be called immediately
CompletableFuture<String> authorName = todos
    .getById("123")                              // -> Promise<Todo>
    .thenCapability(Todo::author)                // -> Promise<UserService> (pipelined!)
    .thenCall(user -> user.getName());           // -> Promise<String>

// Or with a fluent pipeline builder
String name = session.pipeline()
    .call(todos::getById, "123")
    .then(Todo::author)                          // Pipelined call
    .then(UserService::getName)
    .await();                                    // Single round-trip for all 3 calls!
```

### Error Handling

```java
// CompletableFuture-based (unchecked exceptions)
todos.getById("missing")
    .handle((todo, error) -> {
        if (error instanceof CapnWebException cwe) {
            return switch (cwe.code()) {
                case NOT_FOUND -> Todo.empty();
                case PERMISSION_DENIED -> throw new SecurityException(cwe);
                default -> throw cwe;
            };
        }
        return todo;
    });

// For blocking calls with virtual threads - checked exceptions
@Blocking
Todo getById(String id) throws NotFoundException, RpcException;
```

### Exposing Local Objects as Targets

```java
// Annotate implementation class
@CapnWebTarget
public class LocalTodoService implements TodoService {

    @Override
    public CompletableFuture<List<Todo>> list(String category) {
        return CompletableFuture.completedFuture(database.query(category));
    }

    // Context injection for bidirectional calls
    @Inject
    private CapnWebContext context;  // Access caller info, make callbacks
}

// Export to session
session.export("todos", new LocalTodoService());

// Or return as capability in RPC response
return session.wrap(new LocalTodoService(), TodoService.class);
```

### Pros
- Familiar to Android/Spring developers (Retrofit/Feign patterns)
- Clean separation between contract (interface) and transport
- IDE autocomplete works perfectly

### Cons
- Runtime proxy generation (no compile-time verification of annotations)
- Limited pipelining expressiveness compared to explicit futures

---

## Approach 2: CompletableFuture-First with Structured Concurrency

Inspired by [gRPC-Java's async patterns](https://grpc.io/docs/languages/java/basics/) and
[Java 21's Structured Concurrency](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html).

### Philosophy
- **Explicit async everywhere**: Every RPC returns `CompletableFuture`
- **Structured concurrency**: Use `StructuredTaskScope` for coordinated calls
- **Type-safe pipelining**: Builder pattern for call chains

### Connection/Session Creation

```java
// Immutable config record + try-with-resources
var config = new CapnWebConfig(
    URI.create("wss://api.example.com/rpc"),
    Transport.WEBSOCKET,
    Duration.ofSeconds(30)
);

try (var session = CapnWebSession.connect(config)) {
    var todos = session.stub(TodoService.class);
    // ...
}
```

### Stub Generation (Annotation Processor)

```java
// User writes interface
public interface TodoService extends CapnWebStub {
    Promise<List<Todo>> list(String category);
    Promise<Todo> getById(String id);
    Promise<UserService> getAuthor(String todoId);  // Returns capability
}

// Annotation processor generates implementation at compile time
@Generated("com.dotdo.capnweb.processor.StubGenerator")
final class TodoService$Stub implements TodoService {
    private final CapnWebSession session;
    private final CapabilityRef ref;

    @Override
    public Promise<List<Todo>> list(String category) {
        return session.call(ref, "list",
            Map.of("category", category),
            Types.listOf(Todo.class));
    }
    // ...
}
```

### Making RPC Calls

```java
// Async composition
session.stub(TodoService.class)
    .list("work")
    .thenApply(todos -> todos.stream()
        .filter(Todo::isUrgent)
        .toList())
    .thenAccept(this::displayUrgent);

// Structured concurrency for parallel calls
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var todosFuture = scope.fork(() -> todos.list("work").join());
    var userFuture = scope.fork(() -> users.current().join());

    scope.join().throwIfFailed();

    render(todosFuture.get(), userFuture.get());
}
```

### Pipelining Syntax

```java
// Custom Promise type that supports pipelining
public sealed interface Promise<T> permits PendingPromise, ResolvedPromise {

    // Standard future operations
    CompletableFuture<T> toFuture();
    T join();

    // Pipelining: call method on result WITHOUT waiting
    <R> Promise<R> pipeline(Function<T, Promise<R>> method);

    // Pipeline to capability and call method on it
    <S extends CapnWebStub, R> Promise<R> pipelineVia(
        Function<T, Promise<S>> capability,
        BiFunction<S, T, Promise<R>> method
    );
}

// Usage - all calls batched into single round-trip
Promise<String> authorName = todos
    .getById("123")
    .pipeline(todo -> todo.author())      // Pipelined! Not waiting for Todo
    .pipeline(author -> author.name());   // Also pipelined!

// Equivalent explicit version
Promise<String> authorName = Promise.pipeline(
    todos.getById("123"),
    Todo::author,
    UserService::name
);
```

### Error Handling with Sealed Types

```java
// Result type for explicit error handling
public sealed interface RpcResult<T> {
    record Success<T>(T value) implements RpcResult<T> {}
    record Failure<T>(RpcError error) implements RpcResult<T> {}
}

public sealed interface RpcError {
    record NotFound(String resource) implements RpcError {}
    record PermissionDenied(String reason) implements RpcError {}
    record NetworkError(IOException cause) implements RpcError {}
    record Unknown(int code, String message) implements RpcError {}
}

// Pattern matching on results
RpcResult<Todo> result = todos.getById("123").toResult().join();

String message = switch (result) {
    case Success(var todo) -> "Found: " + todo.title();
    case Failure(NotFound(var id)) -> "Todo " + id + " not found";
    case Failure(PermissionDenied(var r)) -> "Access denied: " + r;
    case Failure(var other) -> "Error: " + other;
};
```

### Exposing Local Objects as Targets

```java
// Record-based target definition
public record TodoTarget(Database db) implements TodoService {

    @Override
    public Promise<List<Todo>> list(String category) {
        return Promise.completed(db.queryTodos(category));
    }

    @Override
    public Promise<UserService> getAuthor(String todoId) {
        // Return a capability - the user becomes callable!
        User user = db.findAuthor(todoId);
        return Promise.completed(new UserTarget(user));
    }
}

// Register with session
session.export("todos", new TodoTarget(db));
```

### Pros
- Compile-time code generation catches errors early
- Sealed types + pattern matching = exhaustive error handling
- Structured concurrency prevents thread leaks

### Cons
- More complex build setup (annotation processor)
- Custom `Promise` type is less standard than `CompletableFuture`

---

## Approach 3: Virtual Thread Native with Blocking API

Inspired by [Java 21 Virtual Threads best practices](https://www.javacodegeeks.com/2025/11/jdk-httpclient-with-virtual-threads-and-webclient-the-future-of-asynchronous-http-in-java.html)
and classic RMI-style APIs. Embraces blocking I/O as the primary paradigm.

### Philosophy
- **Simple blocking code**: Virtual threads make blocking cheap
- **No callback hell**: Write sequential code that reads naturally
- **Scoped values for context**: Modern replacement for ThreadLocal

### Connection/Session Creation

```java
// ScopedValue for implicit session propagation
private static final ScopedValue<CapnWeb> SESSION = ScopedValue.newInstance();

// Entry point wraps everything in session scope
CapnWeb.run("wss://api.example.com/rpc", () -> {
    TodoService todos = CapnWeb.stub(TodoService.class);

    // All calls within this scope use the session
    List<Todo> items = todos.list("work");  // Blocking, but cheap!

    // Parallel operations with virtual threads
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<Future<Todo>> futures = items.stream()
            .map(t -> executor.submit(() -> todos.enrich(t)))
            .toList();

        List<Todo> enriched = futures.stream()
            .map(Future::join)
            .toList();
    }
});
```

### Interface Definition (No Annotations!)

```java
// Pure Java interface - no framework annotations
public interface TodoService {
    List<Todo> list(String category);
    Todo getById(String id) throws NotFoundException;
    void update(Todo todo);

    // Capabilities are just interface returns
    UserService getAuthor(String todoId);
    CommentService comments(String todoId);
}

// Records for data transfer
public record Todo(
    String id,
    String title,
    boolean urgent,
    Instant createdAt
) {}
```

### Making RPC Calls

```java
// Just call methods! Virtual threads handle the blocking
TodoService todos = CapnWeb.stub(TodoService.class);

Todo todo = todos.getById("123");           // Blocks (on virtual thread)
UserService author = todos.getAuthor("123"); // Returns capability
String name = author.getName();              // Blocks again

// Parallel with virtual thread executor
List<String> allNames = todos.list("work").stream()
    .parallel()  // Uses virtual threads automatically with proper config
    .map(t -> todos.getAuthor(t.id()).getName())
    .toList();
```

### Pipelining Syntax

```java
// Explicit batching for when you need pipelining
String authorName = CapnWeb.batch(batch -> {
    // These calls are queued, not executed
    var todoPromise = batch.queue(() -> todos.getById("123"));
    var authorPromise = batch.queue(() -> todoPromise.get().author());
    var namePromise = batch.queue(() -> authorPromise.get().getName());

    // Single round-trip executes all queued calls
    return namePromise;
});

// Or with fluent pipeline builder
String authorName = CapnWeb.pipeline()
    .start(() -> todos.getById("123"))
    .then(Todo::author)
    .then(UserService::getName)
    .execute();
```

### Error Handling (Checked Exceptions!)

```java
// Interface declares exceptions
public interface TodoService {
    Todo getById(String id) throws NotFoundException;
    void update(Todo todo) throws ValidationException, ConflictException;
}

// Caller must handle
try {
    Todo todo = todos.getById("missing");
} catch (NotFoundException e) {
    log.warn("Todo {} not found", e.resourceId());
    return Todo.empty();
}

// Or use utility method for unchecked conversion
Todo todo = CapnWeb.unchecked(() -> todos.getById("123"));
```

### Exposing Local Objects as Targets

```java
// Just implement the interface
public class LocalTodoService implements TodoService {
    private final Database db;

    @Override
    public List<Todo> list(String category) {
        return db.query("SELECT * FROM todos WHERE category = ?", category);
    }

    @Override
    public UserService getAuthor(String todoId) {
        // Return capabilities naturally
        User user = db.findAuthor(todoId);
        return new LocalUserService(user);
    }
}

// Export - framework introspects interface
CapnWeb.export("todos", new LocalTodoService());
```

### Pros
- Simplest mental model - just write blocking code
- No `CompletableFuture` chains or callbacks
- Checked exceptions force explicit error handling
- Works great with existing blocking libraries (JDBC, etc.)

### Cons
- Requires Java 21+ (virtual threads are required, not optional)
- Pipelining less natural (requires explicit batching)
- Less control over concurrency than explicit async

---

## Approach 4: Algebraic Effects with Sealed Capabilities

A more experimental approach inspired by [functional programming patterns](https://www.javacodegeeks.com/2024/11/javas-modern-toolbox-records-sealed-classes-and-pattern-matching.html)
and capability-security principles. Uses Java's sealed types extensively.

### Philosophy
- **Capabilities as first-class values**: Every remote object is a typed capability
- **Algebraic data types**: Use sealed hierarchies for RPC operations
- **Immutable by default**: All operations return new values

### Connection/Session Creation

```java
// Session is a capability provider
sealed interface CapnWebSession extends AutoCloseable {
    <T> Capability<T> acquire(Class<T> type);
    <T> Capability<T> acquire(Class<T> type, String path);

    // Bootstrap capability
    record Connected(/* ... */) implements CapnWebSession {}
    record Disconnected(Throwable cause) implements CapnWebSession {}
}

// Usage
CapnWebSession session = CapnWeb.connect(config);
if (session instanceof Connected c) {
    Capability<TodoService> todos = c.acquire(TodoService.class, "/todos");
    // Use capability...
}
```

### Capability Definition

```java
// Capability wraps a stub with explicit lifecycle
public sealed interface Capability<T> {

    // Active capability that can be invoked
    record Live<T>(T stub, CapabilityRef ref) implements Capability<T> {
        public <R> Effect<R> invoke(Function<T, R> method) {
            return new Effect.Pending<>(() -> method.apply(stub));
        }
    }

    // Revoked capability
    record Revoked<T>(Instant revokedAt, String reason) implements Capability<T> {}

    // Pending capability (from pipelining)
    record Promised<T>(Effect<Live<T>> resolution) implements Capability<T> {}
}

// Effect represents a pending operation
public sealed interface Effect<T> {
    record Pending<T>(Supplier<T> thunk) implements Effect<T> {}
    record Completed<T>(T value) implements Effect<T> {}
    record Failed<T>(RpcError error) implements Effect<T> {}

    // Monadic operations
    <R> Effect<R> map(Function<T, R> f);
    <R> Effect<R> flatMap(Function<T, Effect<R>> f);
    T unsafeRun();  // Execute and block
}
```

### Making RPC Calls

```java
// Capability-oriented invocation
Capability<TodoService> todoCap = session.acquire(TodoService.class);

Effect<List<Todo>> effect = switch (todoCap) {
    case Live(var todos, _) -> todos.invoke(t -> t.list("work"));
    case Revoked(_, var reason) -> Effect.failed(new RevokedError(reason));
    case Promised(var resolution) -> resolution.flatMap(live ->
        live.invoke(t -> t.list("work"))
    );
};

// Execute effect
List<Todo> items = effect.unsafeRun();
```

### Pipelining with Effect Composition

```java
// Effects compose naturally - pipelining is just flatMap!
Effect<String> authorName = session
    .acquire(TodoService.class)
    .invoke(todos -> todos.getById("123"))      // Effect<Todo>
    .flatMap(todo -> todo.author()              // Effect<Capability<UserService>>
        .flatMap(cap -> cap.invoke(u -> u.getName())));  // Effect<String>

// With helper methods
Effect<String> authorName = Effect.pipeline(
    session.acquire(TodoService.class),
    TodoService::getById, "123",
    Todo::author,
    UserService::getName
);

// Parallel effects with applicative style
Effect<Summary> summary = Effect.all(
    todoCap.invoke(t -> t.list("work")),
    userCap.invoke(u -> u.current()),
    statsCap.invoke(s -> s.today())
).map((todos, user, stats) -> new Summary(todos, user, stats));
```

### Error Handling (Pattern Matching on Effects)

```java
// Effects carry errors explicitly
Effect<Todo> todoEffect = todoCap.invoke(t -> t.getById("123"));

// Pattern match on result
String result = switch (todoEffect.run()) {
    case Completed(var todo) -> "Found: " + todo.title();
    case Failed(RpcError.NotFound(var id)) -> "Not found: " + id;
    case Failed(RpcError.PermissionDenied(var r)) -> "Denied: " + r;
    case Failed(var error) -> "Error: " + error;
    case Pending(_) -> throw new IllegalStateException("Unreachable after run()");
};

// Or use recovery combinators
Effect<Todo> recovered = todoEffect
    .recover(NotFound.class, _ -> Todo.empty())
    .recover(PermissionDenied.class, e -> {
        audit.log(e);
        throw new SecurityException(e);
    });
```

### Exposing Local Objects as Targets

```java
// Implement as a capability handler
public record LocalTodoCapability(Database db) implements CapabilityHandler<TodoService> {

    @Override
    public Effect<Object> handle(String method, Object[] args) {
        return switch (method) {
            case "list" -> Effect.completed(db.query((String) args[0]));
            case "getById" -> db.find((String) args[0])
                .map(Effect::completed)
                .orElse(Effect.failed(new NotFound(args[0])));
            default -> Effect.failed(new MethodNotFound(method));
        };
    }
}

// Or with type-safe wrapper
@CapabilityProvider
public class LocalTodoService implements TodoService {
    // Regular implementation, framework wraps in capability
}

// Export
session.export("todos", Capability.of(new LocalTodoService()));
```

### Pros
- Maximum type safety with sealed types
- Effects make side effects explicit
- Capability revocation is first-class
- Pattern matching ensures exhaustive handling

### Cons
- Steep learning curve for developers unfamiliar with functional patterns
- More verbose than simpler approaches
- Custom `Effect` type might not play well with reactive libraries

---

## Comparison Matrix

| Feature | Approach 1 (Retrofit-Style) | Approach 2 (CompletableFuture) | Approach 3 (Virtual Threads) | Approach 4 (Algebraic Effects) |
|---------|---------------------------|------------------------------|----------------------------|------------------------------|
| **Java Version** | 17+ | 21+ | 21+ (required) | 21+ |
| **Stub Generation** | Dynamic proxy (runtime) | Annotation processor | Dynamic proxy | Sealed interfaces |
| **Async Model** | CompletableFuture | Custom Promise | Blocking (virtual threads) | Effect monad |
| **Pipelining** | Method chaining | Promise.pipeline() | Explicit batching | flatMap composition |
| **Error Handling** | Unchecked + handle() | Sealed RpcResult | Checked exceptions | Pattern matching |
| **Learning Curve** | Low (Retrofit-familiar) | Medium | Low | High |
| **Type Safety** | Medium | High | Medium | Very High |
| **Framework Weight** | Light | Medium | Minimal | Medium |

---

## Recommendations

### For Maximum Adoption
**Approach 1 (Retrofit-Style)** - Familiar patterns, works with older Java versions,
minimal learning curve. This is what most Java developers expect.

### For Cutting-Edge Java
**Approach 3 (Virtual Threads)** - Simplest code, leverages Java 21's best feature,
blocking code that's actually efficient. Best DX for new projects.

### For Maximum Safety
**Approach 2 (CompletableFuture)** + **Approach 4's error handling** - Compile-time
generation with sealed types for errors. Best for large teams needing strong contracts.

### Hybrid Recommendation
Consider supporting multiple paradigms:

```java
// Same interface works with all invocation styles
interface TodoService {
    CompletableFuture<List<Todo>> listAsync(String category);  // Async
    List<Todo> list(String category);                           // Blocking (virtual thread)
}

// Developer chooses based on context
var todos = session.stub(TodoService.class);

// In async context
todos.listAsync("work").thenAccept(this::process);

// In virtual thread context
CapnWeb.runBlocking(() -> {
    List<Todo> items = todos.list("work");  // Same interface!
});
```

---

## Implementation Notes

### Transport Abstraction

All approaches should share a common transport layer:

```java
public sealed interface Transport {
    record WebSocket(URI endpoint, Duration pingInterval) implements Transport {}
    record HttpBatch(URI endpoint, int maxBatchSize) implements Transport {}
    record InProcess(CapnWebServer server) implements Transport {}  // For testing
}
```

### JSON Serialization

Use Jackson or Gson with explicit type adapters for capabilities:

```java
// Capability reference in JSON
{"$ref": "cap:abc123", "$interface": "com.example.TodoService"}

// Resolved by session during deserialization
@JsonDeserialize(using = CapabilityDeserializer.class)
public interface CapabilityRef {}
```

### Maven Coordinates

```xml
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Optional annotation processor for Approach 2 -->
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-processor</artifactId>
    <version>1.0.0</version>
    <scope>provided</scope>
</dependency>
```
