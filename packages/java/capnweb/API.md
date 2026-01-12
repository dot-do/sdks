# Cap'n Web Java API - Final Design

A capability-based RPC library that feels native to Java 21+.

---

## Design Principles

1. **Blocking-first, async when needed** - Virtual threads make blocking code efficient and readable
2. **Interfaces are contracts** - Define capabilities as plain interfaces, no annotations required
3. **Sealed types for safety** - Exhaustive error handling via pattern matching
4. **Pipelining is composition** - Chain capability calls with zero round-trip waste

---

## Quick Start

```java
try (var session = CapnWeb.connect("wss://api.example.com/rpc")) {
    var todos = session.stub(TodoService.class);

    Todo todo = todos.get("123");
    User author = todo.author().profile();

    System.out.println(author.name());
}
```

---

## Core API

### Session

```java
public sealed interface CapnWeb extends AutoCloseable {

    // Connect with sensible defaults
    static CapnWeb connect(String endpoint);
    static CapnWeb connect(Config config);

    // Acquire a capability stub
    <T> T stub(Class<T> capability);
    <T> T stub(Class<T> capability, String path);

    // Export local implementation as a capability
    <T> void export(String path, T implementation);

    // Pipeline builder for explicit batching
    Pipeline pipeline();

    // Async operations when you need them
    <T> Promise<T> async(Callable<T> operation);
}
```

### Configuration

```java
public record Config(
    URI endpoint,
    Transport transport,
    Duration timeout,
    Auth auth
) {
    public static Builder builder(String endpoint) { ... }

    public sealed interface Transport {
        record WebSocket(Duration pingInterval) implements Transport {}
        record Http(int maxBatchSize) implements Transport {}
    }

    public sealed interface Auth {
        record Bearer(String token) implements Auth {}
        record ApiKey(String key) implements Auth {}
        record None() implements Auth {}
    }
}
```

---

## Defining Capabilities

Capabilities are plain Java interfaces. No annotations. No base classes.

```java
public interface TodoService {
    List<Todo> list(String category);
    Todo get(String id);
    Todo create(String title);
    void delete(String id);

    // Nested capability - returns another stub
    CommentService comments(String todoId);
}

public interface CommentService {
    List<Comment> all();
    Comment add(String text);
}
```

### Data Types

Use records for all data transfer objects.

```java
public record Todo(
    String id,
    String title,
    boolean complete,
    Instant createdAt,
    UserRef author          // Capability reference
) {
    // Capability accessor - resolved lazily
    public UserService author() {
        return author.resolve();
    }
}

public record Comment(String id, String text, Instant at) {}
```

---

## Making Calls

### Blocking (Default)

Virtual threads make blocking efficient. Write natural, sequential code.

```java
var todos = session.stub(TodoService.class);

// Simple call
List<Todo> items = todos.list("work");

// Capability traversal
CommentService comments = todos.comments("123");
Comment comment = comments.add("Great work!");

// Parallel with virtual threads
List<Todo> enriched;
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    enriched = items.stream()
        .map(todo -> executor.submit(() -> enrich(todo)))
        .map(Future::join)
        .toList();
}
```

### Async (When Needed)

Use `Promise<T>` for explicit async composition.

```java
Promise<List<Todo>> promise = session.async(() -> todos.list("work"));

promise
    .map(items -> items.stream().filter(Todo::complete).toList())
    .then(this::display)
    .recover(RpcError.class, e -> List.of());
```

### Pipelining

Batch multiple calls into a single round-trip.

```java
// Fluent pipeline - all calls execute in one round-trip
String authorName = session.pipeline()
    .call(() -> todos.get("123"))
    .call(Todo::author)
    .call(UserService::name)
    .execute();

// Parallel pipeline
var result = session.pipeline()
    .fork(() -> todos.list("work"))
    .fork(() -> users.current())
    .fork(() -> stats.today())
    .join((items, user, stats) -> new Dashboard(items, user, stats));
```

---

## Error Handling

### Sealed Error Hierarchy

```java
public sealed interface RpcError {
    record NotFound(String resource, String id) implements RpcError {}
    record PermissionDenied(String action, String reason) implements RpcError {}
    record InvalidInput(String field, String message) implements RpcError {}
    record Unavailable(Duration retryAfter) implements RpcError {}
    record Internal(String message) implements RpcError {}
}
```

### Pattern Matching

```java
try {
    Todo todo = todos.get("missing");
} catch (RpcException e) {
    String message = switch (e.error()) {
        case NotFound(_, var id) -> "Todo " + id + " does not exist";
        case PermissionDenied(var action, _) -> "Cannot " + action;
        case Unavailable(var retry) -> "Retry in " + retry.toSeconds() + "s";
        case InvalidInput(var field, var msg) -> field + ": " + msg;
        case Internal(var msg) -> "Server error: " + msg;
    };
    log.warn(message);
}
```

### Result Type (Optional)

For functional error handling without exceptions.

```java
Result<Todo> result = Result.of(() -> todos.get("123"));

Todo todo = result
    .recover(NotFound.class, _ -> Todo.empty())
    .orElseThrow();

// Or pattern match
return switch (result) {
    case Result.Ok(var todo) -> render(todo);
    case Result.Err(var error) -> renderError(error);
};
```

---

## Exposing Local Capabilities

Implement the interface. Export it. Done.

```java
public class LocalTodoService implements TodoService {
    private final Database db;

    public LocalTodoService(Database db) {
        this.db = db;
    }

    @Override
    public List<Todo> list(String category) {
        return db.query("SELECT * FROM todos WHERE category = ?", category);
    }

    @Override
    public Todo get(String id) {
        return db.find(id).orElseThrow(() ->
            RpcException.notFound("todo", id));
    }

    @Override
    public CommentService comments(String todoId) {
        // Return nested capability
        return new LocalCommentService(db, todoId);
    }
}

// Export
session.export("todos", new LocalTodoService(db));
```

### Bidirectional Calls

Access the calling session to make callbacks.

```java
public class NotifyingTodoService implements TodoService {

    @Override
    public Todo create(String title) {
        Todo todo = db.insert(title);

        // Callback to client
        var client = CapnWeb.caller().stub(ClientNotifications.class);
        client.onTodoCreated(todo);

        return todo;
    }
}
```

---

## Type Signatures

### Core Interfaces

```java
public sealed interface CapnWeb extends AutoCloseable {
    static CapnWeb connect(String endpoint);
    static CapnWeb connect(Config config);

    <T> T stub(Class<T> capability);
    <T> T stub(Class<T> capability, String path);
    <T> void export(String path, T implementation);

    Pipeline pipeline();
    <T> Promise<T> async(Callable<T> operation);

    static Context caller();  // Access caller context in implementations
}

public sealed interface Promise<T> {
    T join();
    T join(Duration timeout);

    <R> Promise<R> map(Function<T, R> fn);
    <R> Promise<R> flatMap(Function<T, Promise<R>> fn);
    Promise<T> then(Consumer<T> action);
    Promise<T> recover(Class<? extends RpcError> type, Function<RpcError, T> handler);

    CompletableFuture<T> toFuture();
}

public sealed interface Pipeline {
    <T> Pipeline.Stage<T> call(Callable<T> operation);
    <A, B> Pipeline.Fork2<A, B> fork(Callable<A> a, Callable<B> b);
    <A, B, C> Pipeline.Fork3<A, B, C> fork(Callable<A> a, Callable<B> b, Callable<C> c);

    sealed interface Stage<T> {
        <R> Stage<R> call(Function<T, R> next);
        T execute();
    }
}

public sealed interface Result<T> {
    record Ok<T>(T value) implements Result<T> {}
    record Err<T>(RpcError error) implements Result<T> {}

    static <T> Result<T> of(Callable<T> operation);

    <R> Result<R> map(Function<T, R> fn);
    T orElse(T defaultValue);
    T orElseThrow();
    Result<T> recover(Class<? extends RpcError> type, Function<RpcError, T> handler);
}
```

### Capability Reference

```java
public sealed interface CapRef<T> {
    T resolve();
    String id();
    Class<T> type();

    record Live<T>(String id, Class<T> type, CapnWeb session) implements CapRef<T> {
        public T resolve() { return session.stub(type, id); }
    }

    record Revoked<T>(String id, Class<T> type, Instant at) implements CapRef<T> {
        public T resolve() { throw new RpcException(new RpcError.PermissionDenied(...)); }
    }
}
```

---

## Why This Design

### Virtual Thread Native

Java 21's virtual threads eliminate the async/await complexity. Blocking code is efficient again.

```java
// This is perfectly efficient with virtual threads
List<Todo> todos = service.list("work");
for (Todo todo : todos) {
    Comment comment = service.comments(todo.id()).latest();
    process(todo, comment);
}
```

### No Magic Annotations

Interfaces are pure contracts. No `@RpcMethod`, no `@Param("name")`. The method signature is the API.

```java
// Just a Java interface
interface UserService {
    User get(String id);
    User update(String id, UserPatch patch);
}
```

### Sealed Types Enable Pattern Matching

Exhaustive error handling catches bugs at compile time.

```java
// Compiler ensures all cases are handled
return switch (result) {
    case Ok(var user) -> renderUser(user);
    case Err(NotFound e) -> render404(e);
    case Err(PermissionDenied e) -> render403(e);
    case Err(var e) -> render500(e);
};
```

### Pipelining Without Complexity

The `Pipeline` builder makes batching explicit without polluting the interface design.

```java
// Three calls, one round-trip
var dashboard = session.pipeline()
    .fork(() -> todos.list("work"))
    .fork(() -> users.current())
    .fork(() -> stats.today())
    .join(Dashboard::new);
```

---

## Maven

```xml
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb</artifactId>
    <version>1.0.0</version>
</dependency>
```

Requires Java 21+.
