# rpc.do for Java

**The managed RPC layer that makes any `.do` service feel like local code.**

```java
try (var client = RpcClient.create("wss://mongo.do")) {
    // Call any method - no schema required
    var users = client.call("users.find", Map.of("active", true))
        .map(RpcResponse::getResult)
        .await();

    // Chained calls with map()
    var profile = client.call("users.findOne", Map.of("id", 123))
        .map(r -> (Map<?, ?>) r.getResult())
        .map(user -> user.get("profile"))
        .await();

    System.out.println(profile);
}
```

One import. One connection. Zero boilerplate. Designed for Java 21+ virtual threads.

---

## What is rpc.do?

`rpc.do` is the managed RPC layer for the `.do` ecosystem. It sits between raw [capnweb](../capnweb/README.md) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method dynamically** - `client.call("anything.you.want", params)` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Chain promises with `.map()`** - Transform results functionally
4. **Integrate with virtual threads** - Write blocking code that performs like async

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  rpc.do  | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Dynamic method calls
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- RpcPromise with map()
    +--- WebSocket + HTTP support
```

---

## rpc.do vs capnweb

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Dynamic string-based calls | Manual | Built-in |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| RpcPromise with `map()` | Separate | Integrated |
| Connection pooling | Manual | Built-in |
| Retry logic | Manual | Configurable |

**Use capnweb** when you want capability-based RPC with defined interfaces and full pipelining.

**Use rpc.do** when you want maximum flexibility calling `.do` services with minimal setup.

---

## Installation

### Maven

```xml
<dependency>
    <groupId>do.rpc</groupId>
    <artifactId>sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle (Kotlin DSL)

```kotlin
implementation("do.rpc:sdk:0.1.0")
```

### Gradle (Groovy DSL)

```groovy
implementation 'do.rpc:sdk:0.1.0'
```

**Requires Java 21 or later** for virtual thread support.

---

## Quick Start

### Basic Connection

```java
import com.dotdo.rpc.RpcClient;

public class QuickStart {
    public static void main(String[] args) {
        try (var client = RpcClient.create("https://api.example.do")) {
            // Make an RPC call
            var result = client.call("hello", Map.of("name", "World"))
                .await();

            System.out.println(result.getResult());  // "Hello, World!"
        }
    }
}
```

### With Configuration

```java
var config = RpcClient.builder()
    .auth("your-api-token")
    .connectTimeout(Duration.ofSeconds(10))
    .requestTimeout(Duration.ofSeconds(30))
    .maxRetries(3)
    .retryDelay(Duration.ofMillis(100))
    .build();

try (var client = config.create("https://api.example.do")) {
    var result = client.call("users.get", Map.of("id", "123")).await();
    System.out.println(result.getResult());
}
```

### RpcPromise Transformations

The real power of rpc.do comes from the `RpcPromise<T>` class with its functional transformation methods:

```java
// Without chaining (verbose)
var response = client.call("users.get", Map.of("id", "123")).await();
var user = (Map<?, ?>) response.getResult();
var name = user.get("name").toString();

// With map() chaining (elegant)
String name = client.call("users.get", Map.of("id", "123"))
    .map(RpcResponse::getResult)
    .map(result -> (Map<?, ?>) result)
    .map(user -> user.get("name"))
    .map(Object::toString)
    .await();
```

---

## Why Java 21?

Virtual threads changed everything. Blocking a virtual thread doesn't block a platform thread - it yields, letting thousands of concurrent operations share a handful of OS threads.

### Before Virtual Threads

```java
// Old way: CompletableFuture chains
client.callAsync("users.get", params)
    .thenApply(response -> processUser(response))
    .thenCompose(user -> client.callAsync("profiles.get", user.id()))
    .thenAccept(profile -> displayProfile(profile))
    .exceptionally(error -> {
        handleError(error);
        return null;
    });
```

### With Virtual Threads

```java
// New way: Sequential code that's actually efficient
try (var client = RpcClient.create("https://api.example.do")) {
    var response = client.call("users.get", params).await();
    var user = processUser(response);
    var profile = client.call("profiles.get", user.id()).await();
    displayProfile(profile);
}
```

The code looks blocking but thousands of virtual threads can run concurrently on a handful of platform threads.

---

## Core API

### RpcClient

The main entry point for making RPC calls.

```java
// Create with defaults
var client = RpcClient.create("https://api.example.do");

// Create with configuration
var client = RpcClient.create("https://api.example.do", config);

// Use the builder
var client = RpcClient.builder()
    .auth("token")
    .connectTimeout(Duration.ofSeconds(10))
    .create("https://api.example.do");
```

### Making Calls

```java
// With parameters
RpcPromise<RpcResponse> promise = client.call("method.name", params);

// Without parameters
RpcPromise<RpcResponse> promise = client.call("method.name");
```

### RpcResponse

```java
public record RpcResponse(
    Long id,
    Object result,
    Object error
) {
    // Get result or throw on error
    public Object getResult();

    // Check status
    public boolean isSuccess();
    public boolean isError();
}
```

---

## RpcPromise Deep Dive

`RpcPromise<T>` is the heart of rpc.do's functional API. It wraps `CompletableFuture` with a cleaner interface optimized for RPC operations.

### Creating Promises

Promises are typically created by `client.call()`, but you can also work with the underlying future:

```java
RpcPromise<RpcResponse> promise = client.call("users.list");

// Get the underlying future for interop
CompletableFuture<RpcResponse> future = promise.toFuture();
```

### Awaiting Results

```java
// Block indefinitely (virtual thread safe!)
RpcResponse result = promise.await();

// Block with timeout
RpcResponse result = promise.await(Duration.ofSeconds(5));
```

### The map() Method

Transform results without blocking:

```java
// Single transformation
RpcPromise<Object> resultPromise = client.call("users.get", params)
    .map(RpcResponse::getResult);

// Chained transformations
String userName = client.call("users.get", params)
    .map(RpcResponse::getResult)
    .map(result -> (Map<?, ?>) result)
    .map(user -> user.get("name"))
    .map(Object::toString)
    .await();
```

Each `map()` creates a new promise - transformations compose without intermediate blocking.

### The flatMap() Method

Chain dependent RPC calls:

```java
String authorName = client.call("posts.get", Map.of("id", postId))
    .map(r -> (Map<?, ?>) r.getResult())
    .map(post -> post.get("authorId"))
    .flatMap(authorId -> client.call("users.get", Map.of("id", authorId)))
    .map(r -> (Map<?, ?>) r.getResult())
    .map(user -> user.get("name"))
    .map(Object::toString)
    .await();
```

### Error Recovery

```java
String result = client.call("risky.operation")
    .map(RpcResponse::getResult)
    .map(Object::toString)
    .recover(error -> "default value")
    .await();
```

### Side Effects

Execute actions without transforming:

```java
client.call("users.create", userData)
    .onSuccess(response -> logger.info("Created user: {}", response))
    .onError(error -> logger.error("Failed to create user", error))
    .await();
```

---

## Type-Safe Records Pattern

While rpc.do uses dynamic calls, you can achieve type safety by defining records and mapping results:

### Define Your Data Types

```java
public record User(
    String id,
    String name,
    String email,
    Instant createdAt
) {
    public static User fromMap(Map<?, ?> map) {
        return new User(
            (String) map.get("id"),
            (String) map.get("name"),
            (String) map.get("email"),
            Instant.parse((String) map.get("createdAt"))
        );
    }
}

public record Todo(
    String id,
    String title,
    boolean complete,
    String authorId
) {
    public static Todo fromMap(Map<?, ?> map) {
        return new Todo(
            (String) map.get("id"),
            (String) map.get("title"),
            (Boolean) map.get("complete"),
            (String) map.get("authorId")
        );
    }
}
```

### Type-Safe Service Layer

```java
public class TodoService {
    private final RpcClient client;

    public TodoService(RpcClient client) {
        this.client = client;
    }

    public Todo get(String id) {
        return client.call("todos.get", Map.of("id", id))
            .map(RpcResponse::getResult)
            .map(result -> (Map<?, ?>) result)
            .map(Todo::fromMap)
            .await();
    }

    public List<Todo> list(String category) {
        return client.call("todos.list", Map.of("category", category))
            .map(RpcResponse::getResult)
            .map(result -> (List<?>) result)
            .map(list -> list.stream()
                .map(item -> (Map<?, ?>) item)
                .map(Todo::fromMap)
                .toList())
            .await();
    }

    public Todo create(String title, String category) {
        return client.call("todos.create", Map.of(
                "title", title,
                "category", category
            ))
            .map(RpcResponse::getResult)
            .map(result -> (Map<?, ?>) result)
            .map(Todo::fromMap)
            .await();
    }

    public void delete(String id) {
        client.call("todos.delete", Map.of("id", id)).await();
    }
}
```

### Usage

```java
try (var client = RpcClient.create("https://todos.do")) {
    var todoService = new TodoService(client);

    // Type-safe operations
    Todo todo = todoService.create("Write documentation", "work");
    List<Todo> workTodos = todoService.list("work");

    workTodos.forEach(t ->
        System.out.printf("- [%s] %s%n", t.complete() ? "x" : " ", t.title())
    );
}
```

---

## WebSocket Support

For bidirectional communication and streaming, connect via WebSocket:

```java
try (var client = RpcClient.create("https://api.example.do")) {
    // Connect WebSocket for streaming
    client.connectWebSocket().join();

    // Now make calls over WebSocket
    var result = client.call("streaming.subscribe", Map.of("topic", "events"))
        .await();

    // WebSocket will receive server-initiated messages
}
```

### WebSocket vs HTTP

| Transport | Use Case |
|-----------|----------|
| HTTP | Simple request-response, stateless operations |
| WebSocket | Streaming, server push, long-running connections |

The client automatically uses the appropriate transport:

```java
// HTTP endpoints
var client = RpcClient.create("https://api.example.do");

// WebSocket endpoints (explicit)
client.connectWebSocket().join();
```

---

## Virtual Thread Concurrency

### Parallel Requests

Use virtual thread executors for concurrent operations:

```java
List<String> userIds = List.of("1", "2", "3", "4", "5");

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<User>> futures = userIds.stream()
        .map(id -> executor.submit(() ->
            client.call("users.get", Map.of("id", id))
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(User::fromMap)
                .await()
        ))
        .toList();

    // Collect results - blocks virtual threads, not platform threads
    List<User> users = futures.stream()
        .map(future -> {
            try {
                return future.get();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        })
        .toList();
}
```

### Structured Concurrency (Preview)

With Java 21's structured concurrency (preview feature):

```java
record Dashboard(List<Todo> todos, User currentUser, Stats stats) {}

Dashboard dashboard;
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var todosTask = scope.fork(() -> todoService.list("work"));
    var userTask = scope.fork(() -> userService.current());
    var statsTask = scope.fork(() -> analyticsService.today());

    scope.join().throwIfFailed();

    dashboard = new Dashboard(
        todosTask.get(),
        userTask.get(),
        statsTask.get()
    );
}
```

### CompletableFuture Interop

For existing async codebases:

```java
// Convert RpcPromise to CompletableFuture
CompletableFuture<User> userFuture = client.call("users.get", params)
    .map(RpcResponse::getResult)
    .map(result -> (Map<?, ?>) result)
    .map(User::fromMap)
    .toFuture();

// Use with CompletableFuture APIs
userFuture.thenAccept(user -> System.out.println("Got user: " + user.name()));

// Combine multiple futures
CompletableFuture.allOf(
    client.call("operation1").toFuture(),
    client.call("operation2").toFuture(),
    client.call("operation3").toFuture()
).join();
```

---

## Error Handling

### RpcException

All RPC errors are wrapped in `RpcException`:

```java
try {
    var result = client.call("users.get", Map.of("id", "missing")).await();
} catch (RpcClient.RpcException e) {
    System.err.println("RPC failed: " + e.getMessage());
}
```

### Pattern Matching on Errors

Define custom error types for domain-specific handling:

```java
public sealed interface DomainError {
    record NotFound(String resource, String id) implements DomainError {}
    record ValidationError(String field, String message) implements DomainError {}
    record PermissionDenied(String action) implements DomainError {}
    record RateLimited(Duration retryAfter) implements DomainError {}
    record ServerError(String message) implements DomainError {}
}

public class ErrorParser {
    public static DomainError parse(RpcClient.RpcException e) {
        String message = e.getMessage();

        if (message.contains("not found")) {
            return new DomainError.NotFound("resource", "id");
        } else if (message.contains("validation")) {
            return new DomainError.ValidationError("field", message);
        } else if (message.contains("permission") || message.contains("403")) {
            return new DomainError.PermissionDenied("action");
        } else if (message.contains("rate limit") || message.contains("429")) {
            return new DomainError.RateLimited(Duration.ofSeconds(60));
        } else {
            return new DomainError.ServerError(message);
        }
    }
}
```

### Exhaustive Pattern Matching

Java 21's pattern matching enables exhaustive error handling:

```java
try {
    var result = client.call("todos.get", Map.of("id", "123")).await();
} catch (RpcClient.RpcException e) {
    DomainError error = ErrorParser.parse(e);

    String message = switch (error) {
        case DomainError.NotFound(var resource, var id) ->
            String.format("%s '%s' does not exist", resource, id);

        case DomainError.ValidationError(var field, var msg) ->
            String.format("Invalid %s: %s", field, msg);

        case DomainError.PermissionDenied(var action) ->
            String.format("You don't have permission to %s", action);

        case DomainError.RateLimited(var retryAfter) ->
            String.format("Rate limited. Retry in %d seconds", retryAfter.toSeconds());

        case DomainError.ServerError(var msg) ->
            "Server error: " + msg;
    };

    logger.error(message);
}
```

### Recovery with RpcPromise

```java
User user = client.call("users.get", Map.of("id", userId))
    .map(RpcResponse::getResult)
    .map(result -> (Map<?, ?>) result)
    .map(User::fromMap)
    .recover(error -> {
        logger.warn("Failed to fetch user {}: {}", userId, error.getMessage());
        return User.anonymous();  // Return default
    })
    .await();
```

### Retry Logic

The client has built-in retry with exponential backoff:

```java
var config = RpcClient.builder()
    .maxRetries(3)
    .retryDelay(Duration.ofMillis(100))  // Base delay, doubles each retry
    .build();

// Will retry up to 3 times with delays: 100ms, 200ms, 400ms
var result = config.create("https://api.example.do")
    .call("flaky.operation")
    .await();
```

For custom retry logic:

```java
public class RetryHelper {
    public static <T> T withRetry(
        Supplier<T> operation,
        int maxAttempts,
        Duration baseDelay,
        Predicate<Exception> isRetryable
    ) {
        Exception lastError = null;

        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return operation.get();
            } catch (Exception e) {
                lastError = e;

                if (!isRetryable.test(e)) {
                    throw e instanceof RuntimeException re ? re : new RuntimeException(e);
                }

                if (attempt < maxAttempts - 1) {
                    long delayMs = baseDelay.toMillis() * (1L << attempt);
                    try {
                        Thread.sleep(delayMs);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new RuntimeException("Interrupted during retry", ie);
                    }
                }
            }
        }

        throw lastError instanceof RuntimeException re ? re : new RuntimeException(lastError);
    }

    public static boolean isTransient(Exception e) {
        String message = e.getMessage();
        return message != null && (
            message.contains("timeout") ||
            message.contains("connection") ||
            message.contains("503") ||
            message.contains("502") ||
            message.contains("504")
        );
    }
}

// Usage
User user = RetryHelper.withRetry(
    () -> client.call("users.get", Map.of("id", "123"))
        .map(RpcResponse::getResult)
        .map(result -> (Map<?, ?>) result)
        .map(User::fromMap)
        .await(),
    3,
    Duration.ofMillis(100),
    RetryHelper::isTransient
);
```

---

## Configuration Reference

### ConfigBuilder

```java
var config = RpcClient.builder()
    // Authentication token (sent as Bearer token)
    .auth("your-api-token")

    // Connection timeout for initial connection
    .connectTimeout(Duration.ofSeconds(10))

    // Request timeout for individual RPC calls
    .requestTimeout(Duration.ofSeconds(30))

    // Maximum retry attempts for transient failures
    .maxRetries(3)

    // Base delay between retries (doubles each attempt)
    .retryDelay(Duration.ofMillis(100))

    // Build the config or create a client directly
    .build();
    // OR
    .create("https://api.example.do");
```

### Config Record

```java
public record Config(
    Duration connectTimeout,
    Duration requestTimeout,
    String authToken,
    int maxRetries,
    Duration retryDelay
) {
    public static Config defaults() {
        return new Config(
            Duration.ofSeconds(10),
            Duration.ofSeconds(30),
            null,
            3,
            Duration.ofMillis(100)
        );
    }
}
```

---

## Advanced Patterns

### Service Factory

Create a centralized service factory:

```java
public class DoServices implements AutoCloseable {
    private final RpcClient client;
    private final Map<Class<?>, Object> services = new ConcurrentHashMap<>();

    public DoServices(String baseUrl, String apiToken) {
        this.client = RpcClient.builder()
            .auth(apiToken)
            .connectTimeout(Duration.ofSeconds(10))
            .requestTimeout(Duration.ofSeconds(30))
            .create(baseUrl);
    }

    @SuppressWarnings("unchecked")
    public <T> T service(Class<T> serviceClass, Function<RpcClient, T> factory) {
        return (T) services.computeIfAbsent(serviceClass, k -> factory.apply(client));
    }

    public TodoService todos() {
        return service(TodoService.class, TodoService::new);
    }

    public UserService users() {
        return service(UserService.class, UserService::new);
    }

    @Override
    public void close() {
        client.close();
    }
}

// Usage
try (var services = new DoServices("https://api.example.do", apiToken)) {
    Todo todo = services.todos().create("My task", "work");
    User author = services.users().get(todo.authorId());

    System.out.printf("Created '%s' by %s%n", todo.title(), author.name());
}
```

### Request Context

Attach context to requests:

```java
public class RequestContext {
    private static final ThreadLocal<Map<String, String>> CONTEXT = new ThreadLocal<>();

    public static void set(String key, String value) {
        if (CONTEXT.get() == null) {
            CONTEXT.set(new HashMap<>());
        }
        CONTEXT.get().put(key, value);
    }

    public static String get(String key) {
        Map<String, String> ctx = CONTEXT.get();
        return ctx != null ? ctx.get(key) : null;
    }

    public static void clear() {
        CONTEXT.remove();
    }

    public static Map<String, String> all() {
        return CONTEXT.get() != null ? Map.copyOf(CONTEXT.get()) : Map.of();
    }
}

public class ContextAwareService {
    private final RpcClient client;

    public ContextAwareService(RpcClient client) {
        this.client = client;
    }

    public <T> T call(String method, Object params, Function<Object, T> mapper) {
        // Add context to params
        Map<String, Object> enrichedParams = new HashMap<>();
        if (params instanceof Map<?, ?> map) {
            map.forEach((k, v) -> enrichedParams.put(k.toString(), v));
        }

        // Add request context
        enrichedParams.put("_context", RequestContext.all());

        return client.call(method, enrichedParams)
            .map(RpcResponse::getResult)
            .map(mapper)
            .await();
    }
}

// Usage
RequestContext.set("userId", "user_123");
RequestContext.set("requestId", UUID.randomUUID().toString());

try {
    var result = contextService.call("secure.operation", params, r -> r);
} finally {
    RequestContext.clear();
}
```

### Batch Operations

Execute multiple calls efficiently:

```java
public class BatchExecutor {
    private final RpcClient client;

    public BatchExecutor(RpcClient client) {
        this.client = client;
    }

    public record BatchCall(String method, Object params) {}
    public record BatchResult(Object result, Exception error) {}

    public List<BatchResult> execute(List<BatchCall> calls) {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<BatchResult>> futures = calls.stream()
                .map(call -> executor.submit(() -> {
                    try {
                        var result = client.call(call.method(), call.params())
                            .map(RpcResponse::getResult)
                            .await();
                        return new BatchResult(result, null);
                    } catch (Exception e) {
                        return new BatchResult(null, e);
                    }
                }))
                .toList();

            return futures.stream()
                .map(future -> {
                    try {
                        return future.get();
                    } catch (Exception e) {
                        return new BatchResult(null, e);
                    }
                })
                .toList();
        }
    }
}

// Usage
var batch = new BatchExecutor(client);

List<BatchExecutor.BatchResult> results = batch.execute(List.of(
    new BatchExecutor.BatchCall("users.get", Map.of("id", "1")),
    new BatchExecutor.BatchCall("users.get", Map.of("id", "2")),
    new BatchExecutor.BatchCall("users.get", Map.of("id", "3")),
    new BatchExecutor.BatchCall("todos.list", Map.of("category", "work"))
));

results.forEach(r -> {
    if (r.error() != null) {
        System.err.println("Error: " + r.error().getMessage());
    } else {
        System.out.println("Result: " + r.result());
    }
});
```

### Circuit Breaker

Protect against cascading failures:

```java
public class CircuitBreaker {
    private final int failureThreshold;
    private final Duration resetTimeout;
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private final AtomicReference<Instant> lastFailure = new AtomicReference<>();
    private volatile State state = State.CLOSED;

    public enum State { CLOSED, OPEN, HALF_OPEN }

    public CircuitBreaker(int failureThreshold, Duration resetTimeout) {
        this.failureThreshold = failureThreshold;
        this.resetTimeout = resetTimeout;
    }

    public <T> T execute(Supplier<T> operation) {
        if (state == State.OPEN) {
            Instant last = lastFailure.get();
            if (last != null && Duration.between(last, Instant.now()).compareTo(resetTimeout) > 0) {
                state = State.HALF_OPEN;
            } else {
                throw new CircuitBreakerOpenException("Circuit breaker is open");
            }
        }

        try {
            T result = operation.get();
            onSuccess();
            return result;
        } catch (Exception e) {
            onFailure();
            throw e;
        }
    }

    private void onSuccess() {
        failureCount.set(0);
        state = State.CLOSED;
    }

    private void onFailure() {
        int count = failureCount.incrementAndGet();
        lastFailure.set(Instant.now());
        if (count >= failureThreshold) {
            state = State.OPEN;
        }
    }

    public State getState() {
        return state;
    }

    public static class CircuitBreakerOpenException extends RuntimeException {
        public CircuitBreakerOpenException(String message) {
            super(message);
        }
    }
}

// Usage
var circuitBreaker = new CircuitBreaker(5, Duration.ofSeconds(30));

User user = circuitBreaker.execute(() ->
    client.call("users.get", Map.of("id", "123"))
        .map(RpcResponse::getResult)
        .map(result -> (Map<?, ?>) result)
        .map(User::fromMap)
        .await()
);
```

---

## Platform Integration

### Spring Boot

```java
@Configuration
public class RpcDoConfig {

    @Bean
    @ConfigurationProperties("rpc.do")
    public RpcDoProperties rpcDoProperties() {
        return new RpcDoProperties();
    }

    @Bean
    public RpcClient rpcClient(RpcDoProperties props) {
        return RpcClient.builder()
            .auth(props.getToken())
            .connectTimeout(props.getConnectTimeout())
            .requestTimeout(props.getRequestTimeout())
            .maxRetries(props.getMaxRetries())
            .create(props.getUrl());
    }

    @Bean
    public TodoService todoService(RpcClient rpcClient) {
        return new TodoService(rpcClient);
    }

    @PreDestroy
    public void cleanup(RpcClient client) {
        client.close();
    }
}

@ConfigurationProperties("rpc.do")
public class RpcDoProperties {
    private String url = "https://api.example.do";
    private String token;
    private Duration connectTimeout = Duration.ofSeconds(10);
    private Duration requestTimeout = Duration.ofSeconds(30);
    private int maxRetries = 3;

    // getters and setters
}
```

```yaml
# application.yml
rpc:
  do:
    url: https://api.example.do
    token: ${API_TOKEN}
    connect-timeout: 10s
    request-timeout: 30s
    max-retries: 3
```

```java
@RestController
@RequestMapping("/api/todos")
public class TodoController {
    private final TodoService todoService;

    public TodoController(TodoService todoService) {
        this.todoService = todoService;
    }

    @GetMapping
    public List<Todo> list(@RequestParam String category) {
        return todoService.list(category);
    }

    @PostMapping
    public Todo create(@RequestBody CreateTodoRequest request) {
        return todoService.create(request.title(), request.category());
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable String id) {
        todoService.delete(id);
    }
}
```

### Quarkus

```java
@ApplicationScoped
public class RpcDoProducer {

    @ConfigProperty(name = "rpc.do.url")
    String url;

    @ConfigProperty(name = "rpc.do.token")
    String token;

    @Produces
    @ApplicationScoped
    public RpcClient rpcClient() {
        return RpcClient.builder()
            .auth(token)
            .connectTimeout(Duration.ofSeconds(10))
            .requestTimeout(Duration.ofSeconds(30))
            .create(url);
    }

    @Produces
    @ApplicationScoped
    public TodoService todoService(RpcClient client) {
        return new TodoService(client);
    }
}

@Path("/api/todos")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TodoResource {

    @Inject
    TodoService todoService;

    @GET
    public List<Todo> list(@QueryParam("category") String category) {
        return todoService.list(category);
    }

    @POST
    public Todo create(CreateTodoRequest request) {
        return todoService.create(request.title(), request.category());
    }
}
```

### Micronaut

```java
@Factory
public class RpcDoFactory {

    @Singleton
    public RpcClient rpcClient(
        @Value("${rpc.do.url}") String url,
        @Value("${rpc.do.token}") String token
    ) {
        return RpcClient.builder()
            .auth(token)
            .connectTimeout(Duration.ofSeconds(10))
            .requestTimeout(Duration.ofSeconds(30))
            .create(url);
    }

    @Singleton
    public TodoService todoService(RpcClient client) {
        return new TodoService(client);
    }
}

@Controller("/api/todos")
public class TodoController {

    private final TodoService todoService;

    public TodoController(TodoService todoService) {
        this.todoService = todoService;
    }

    @Get
    public List<Todo> list(@QueryValue String category) {
        return todoService.list(category);
    }

    @Post
    public Todo create(@Body CreateTodoRequest request) {
        return todoService.create(request.title(), request.category());
    }
}
```

### Plain Java

```java
public class TodoApp {

    public static void main(String[] args) {
        String apiUrl = System.getenv("RPC_DO_URL");
        String apiToken = System.getenv("RPC_DO_TOKEN");

        if (apiUrl == null || apiToken == null) {
            System.err.println("Set RPC_DO_URL and RPC_DO_TOKEN environment variables");
            System.exit(1);
        }

        try (var client = RpcClient.builder()
                .auth(apiToken)
                .connectTimeout(Duration.ofSeconds(10))
                .requestTimeout(Duration.ofSeconds(30))
                .maxRetries(3)
                .create(apiUrl)) {

            var todoService = new TodoService(client);

            // Create a todo
            Todo todo = todoService.create("Learn rpc.do for Java", "learning");
            System.out.println("Created: " + todo);

            // List todos
            List<Todo> todos = todoService.list("learning");
            System.out.println("Todos:");
            todos.forEach(t ->
                System.out.printf("  - [%s] %s%n", t.complete() ? "x" : " ", t.title())
            );

            // Parallel operations with virtual threads
            List<String> categories = List.of("work", "personal", "learning");

            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Map<String, List<Todo>> byCategory = categories.stream()
                    .map(cat -> executor.submit(() ->
                        Map.entry(cat, todoService.list(cat))
                    ))
                    .map(future -> {
                        try {
                            return future.get();
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                    })
                    .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

                System.out.println("\nTodos by category:");
                byCategory.forEach((cat, list) ->
                    System.out.printf("  %s: %d items%n", cat, list.size())
                );
            }

        } catch (RpcClient.RpcException e) {
            System.err.println("RPC failed: " + e.getMessage());
            System.exit(1);
        }
    }
}
```

---

## Testing

### In-Process Testing

Test your services without network:

```java
@Test
void testTodoService() {
    // Create a mock client (use your preferred mocking framework)
    var mockClient = mock(RpcClient.class);

    // Setup expectations
    when(mockClient.call(eq("todos.get"), any()))
        .thenReturn(new RpcPromise<>(CompletableFuture.completedFuture(
            new RpcResponse(1L, Map.of(
                "id", "123",
                "title", "Test Todo",
                "complete", false,
                "authorId", "user1"
            ), null)
        )));

    var todoService = new TodoService(mockClient);

    // Test
    Todo todo = todoService.get("123");

    assertThat(todo.id()).isEqualTo("123");
    assertThat(todo.title()).isEqualTo("Test Todo");
    assertThat(todo.complete()).isFalse();
}
```

### Integration Testing with WireMock

```java
@ExtendWith(WireMockExtension.class)
class TodoServiceIntegrationTest {

    @WireMockTest(httpPort = 8089)
    @Test
    void testListTodos(WireMockRuntimeInfo wmRuntimeInfo) {
        // Setup stub
        stubFor(post("/rpc")
            .withRequestBody(matchingJsonPath("$.method", equalTo("todos.list")))
            .willReturn(okJson("""
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": [
                        {"id": "1", "title": "Todo 1", "complete": false, "authorId": "u1"},
                        {"id": "2", "title": "Todo 2", "complete": true, "authorId": "u2"}
                    ]
                }
                """)));

        // Test
        try (var client = RpcClient.create("http://localhost:8089")) {
            var todoService = new TodoService(client);
            List<Todo> todos = todoService.list("work");

            assertThat(todos).hasSize(2);
            assertThat(todos.get(0).title()).isEqualTo("Todo 1");
            assertThat(todos.get(1).complete()).isTrue();
        }
    }
}
```

### Testing Error Handling

```java
@Test
void testErrorHandling() {
    var mockClient = mock(RpcClient.class);

    when(mockClient.call(eq("todos.get"), any()))
        .thenReturn(new RpcPromise<>(CompletableFuture.failedFuture(
            new RpcClient.RpcException("Todo not found")
        )));

    var todoService = new TodoService(mockClient);

    assertThatThrownBy(() -> todoService.get("missing"))
        .isInstanceOf(RpcClient.RpcException.class)
        .hasMessageContaining("not found");
}
```

### Testing Timeouts

```java
@Test
void testTimeout() {
    var slowClient = RpcClient.builder()
        .requestTimeout(Duration.ofMillis(100))
        .create("https://slow.example.do");

    // Assuming the server takes longer than 100ms
    assertThatThrownBy(() ->
        slowClient.call("slow.operation").await()
    ).isInstanceOf(RpcClient.RpcException.class)
     .hasMessageContaining("timed out");
}
```

---

## Security

### Token Management

```java
public class TokenManager {
    private final String clientId;
    private final String clientSecret;
    private final String tokenUrl;
    private final HttpClient httpClient;

    private volatile TokenInfo currentToken;
    private final Object lock = new Object();

    public TokenManager(String clientId, String clientSecret, String tokenUrl) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.tokenUrl = tokenUrl;
        this.httpClient = HttpClient.newHttpClient();
    }

    public String getToken() {
        TokenInfo token = currentToken;
        if (token != null && !token.isExpired()) {
            return token.accessToken;
        }

        synchronized (lock) {
            token = currentToken;
            if (token == null || token.isExpired()) {
                token = refreshToken();
                currentToken = token;
            }
        }
        return token.accessToken;
    }

    private TokenInfo refreshToken() {
        String body = "grant_type=client_credentials" +
            "&client_id=" + clientId +
            "&client_secret=" + clientSecret;

        var request = HttpRequest.newBuilder()
            .uri(URI.create(tokenUrl))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        try {
            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            // Parse response and extract token
            // ... JSON parsing ...
            return new TokenInfo(accessToken, Instant.now().plusSeconds(expiresIn - 60));
        } catch (Exception e) {
            throw new RuntimeException("Failed to refresh token", e);
        }
    }

    record TokenInfo(String accessToken, Instant expiresAt) {
        boolean isExpired() {
            return Instant.now().isAfter(expiresAt);
        }
    }
}

// Usage with rpc.do
var tokenManager = new TokenManager(clientId, clientSecret, tokenUrl);

// Create client factory that gets fresh tokens
Supplier<RpcClient> clientFactory = () -> RpcClient.builder()
    .auth(tokenManager.getToken())
    .create("https://api.example.do");
```

### TLS Configuration

```java
// For custom SSL contexts (e.g., self-signed certs in development)
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(null, trustManagers, new SecureRandom());

// Note: RpcClient uses Java's HttpClient which respects system properties:
// -Djavax.net.ssl.trustStore=/path/to/truststore
// -Djavax.net.ssl.trustStorePassword=password
```

### Secrets Management

```java
// Environment variables (12-factor app style)
String token = System.getenv("RPC_DO_TOKEN");

// AWS Secrets Manager
var secretsClient = SecretsManagerClient.create();
var secret = secretsClient.getSecretValue(GetSecretValueRequest.builder()
    .secretId("my-app/rpc-do")
    .build());
String token = parseToken(secret.secretString());

// HashiCorp Vault
var vaultClient = Vault.create();
var response = vaultClient.logical().read("secret/data/rpc-do");
String token = (String) response.getData().get("token");
```

---

## Monitoring and Observability

### Metrics

```java
public class MetricsCollector {
    private final MeterRegistry registry;

    public MetricsCollector(MeterRegistry registry) {
        this.registry = registry;
    }

    public <T> T timed(String method, Supplier<T> operation) {
        var timer = Timer.builder("rpc.do.call")
            .tag("method", method)
            .register(registry);

        return timer.record(operation);
    }

    public void recordError(String method, Exception e) {
        Counter.builder("rpc.do.errors")
            .tag("method", method)
            .tag("error_type", e.getClass().getSimpleName())
            .register(registry)
            .increment();
    }
}

// Usage
public class InstrumentedTodoService extends TodoService {
    private final MetricsCollector metrics;

    public InstrumentedTodoService(RpcClient client, MetricsCollector metrics) {
        super(client);
        this.metrics = metrics;
    }

    @Override
    public Todo get(String id) {
        try {
            return metrics.timed("todos.get", () -> super.get(id));
        } catch (Exception e) {
            metrics.recordError("todos.get", e);
            throw e;
        }
    }
}
```

### Logging

```java
public class LoggingInterceptor {
    private static final Logger log = LoggerFactory.getLogger(LoggingInterceptor.class);

    public <T> T logged(String method, Object params, Supplier<T> operation) {
        String requestId = UUID.randomUUID().toString().substring(0, 8);

        log.info("[{}] Calling {} with params: {}", requestId, method, params);
        long start = System.currentTimeMillis();

        try {
            T result = operation.get();
            long duration = System.currentTimeMillis() - start;
            log.info("[{}] {} completed in {}ms", requestId, method, duration);
            return result;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - start;
            log.error("[{}] {} failed after {}ms: {}", requestId, method, duration, e.getMessage());
            throw e;
        }
    }
}
```

### Distributed Tracing

```java
// With OpenTelemetry
public class TracedTodoService extends TodoService {
    private final Tracer tracer;

    public TracedTodoService(RpcClient client, Tracer tracer) {
        super(client);
        this.tracer = tracer;
    }

    @Override
    public Todo get(String id) {
        Span span = tracer.spanBuilder("rpc.do/todos.get")
            .setSpanKind(SpanKind.CLIENT)
            .setAttribute("rpc.method", "todos.get")
            .setAttribute("todo.id", id)
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            Todo todo = super.get(id);
            span.setStatus(StatusCode.OK);
            return todo;
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, e.getMessage());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```java
package com.example.rpcdodemo;

import com.dotdo.rpc.RpcClient;
import com.dotdo.rpc.RpcClient.RpcException;
import com.dotdo.rpc.RpcClient.RpcPromise;
import com.dotdo.rpc.RpcClient.RpcResponse;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class CompleteTodoApp {

    // ---- Data Types ----

    public record User(String id, String name, String email, Instant createdAt) {
        public static User fromMap(Map<?, ?> map) {
            return new User(
                (String) map.get("id"),
                (String) map.get("name"),
                (String) map.get("email"),
                Instant.parse((String) map.get("createdAt"))
            );
        }
    }

    public record Todo(String id, String title, boolean complete, String authorId) {
        public static Todo fromMap(Map<?, ?> map) {
            return new Todo(
                (String) map.get("id"),
                (String) map.get("title"),
                (Boolean) map.get("complete"),
                (String) map.get("authorId")
            );
        }
    }

    // ---- Service Layer ----

    public static class TodoService {
        private final RpcClient client;

        public TodoService(RpcClient client) {
            this.client = client;
        }

        public Todo get(String id) {
            return client.call("todos.get", Map.of("id", id))
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(Todo::fromMap)
                .await();
        }

        public List<Todo> list(String category) {
            return client.call("todos.list", Map.of("category", category))
                .map(RpcResponse::getResult)
                .map(result -> (List<?>) result)
                .map(list -> list.stream()
                    .map(item -> (Map<?, ?>) item)
                    .map(Todo::fromMap)
                    .toList())
                .await();
        }

        public Todo create(String title, String category) {
            return client.call("todos.create", Map.of(
                    "title", title,
                    "category", category
                ))
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(Todo::fromMap)
                .await();
        }

        public void delete(String id) {
            client.call("todos.delete", Map.of("id", id)).await();
        }
    }

    public static class UserService {
        private final RpcClient client;

        public UserService(RpcClient client) {
            this.client = client;
        }

        public User get(String id) {
            return client.call("users.get", Map.of("id", id))
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(User::fromMap)
                .await();
        }

        public User current() {
            return client.call("users.me")
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(User::fromMap)
                .await();
        }
    }

    // ---- Main Application ----

    public static void main(String[] args) {
        String apiUrl = System.getenv().getOrDefault("RPC_DO_URL", "https://todos.do");
        String apiToken = System.getenv("RPC_DO_TOKEN");

        if (apiToken == null) {
            System.err.println("Set RPC_DO_TOKEN environment variable");
            System.exit(1);
        }

        System.out.println("=== rpc.do Complete Java Example ===\n");

        try (var client = RpcClient.builder()
                .auth(apiToken)
                .connectTimeout(Duration.ofSeconds(10))
                .requestTimeout(Duration.ofSeconds(30))
                .maxRetries(3)
                .retryDelay(Duration.ofMillis(100))
                .create(apiUrl)) {

            var todoService = new TodoService(client);
            var userService = new UserService(client);

            // 1. Get current user
            System.out.println("1. Fetching current user...");
            User currentUser = userService.current();
            System.out.printf("   Welcome, %s!%n%n", currentUser.name());

            // 2. Create a todo
            System.out.println("2. Creating a todo...");
            Todo newTodo = todoService.create("Learn rpc.do for Java", "learning");
            System.out.printf("   Created: %s (id: %s)%n%n", newTodo.title(), newTodo.id());

            // 3. List todos with map() chaining
            System.out.println("3. Listing todos...");
            List<Todo> todos = todoService.list("learning");
            System.out.printf("   Found %d todos:%n", todos.size());
            todos.forEach(t ->
                System.out.printf("   - [%s] %s%n", t.complete() ? "x" : " ", t.title())
            );
            System.out.println();

            // 4. Parallel operations with virtual threads
            System.out.println("4. Parallel category fetch with virtual threads...");
            List<String> categories = List.of("work", "personal", "learning");

            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                List<Future<Map.Entry<String, List<Todo>>>> futures = categories.stream()
                    .map(cat -> executor.submit(() ->
                        Map.entry(cat, todoService.list(cat))
                    ))
                    .toList();

                System.out.println("   Results:");
                for (var future : futures) {
                    var entry = future.get();
                    System.out.printf("   - %s: %d items%n", entry.getKey(), entry.getValue().size());
                }
            }
            System.out.println();

            // 5. Chained calls with flatMap
            System.out.println("5. Chained calls (get todo, then author)...");
            if (!todos.isEmpty()) {
                Todo firstTodo = todos.get(0);
                User author = userService.get(firstTodo.authorId());
                System.out.printf("   '%s' was created by %s%n%n", firstTodo.title(), author.name());
            }

            // 6. Error handling
            System.out.println("6. Error handling example...");
            try {
                todoService.get("non-existent-id");
            } catch (RpcException e) {
                System.out.printf("   Expected error caught: %s%n%n", e.getMessage());
            }

            // 7. Recovery with fallback
            System.out.println("7. Recovery example...");
            Todo todoOrDefault = client.call("todos.get", Map.of("id", "maybe-missing"))
                .map(RpcResponse::getResult)
                .map(result -> (Map<?, ?>) result)
                .map(Todo::fromMap)
                .recover(error -> new Todo("default", "Default Todo", false, currentUser.id()))
                .await();
            System.out.printf("   Got: %s%n%n", todoOrDefault.title());

            // 8. Cleanup
            System.out.println("8. Cleanup...");
            todoService.delete(newTodo.id());
            System.out.printf("   Deleted todo %s%n%n", newTodo.id());

            System.out.println("=== Done! ===");

        } catch (RpcException e) {
            System.err.println("RPC error: " + e.getMessage());
            System.exit(1);
        } catch (Exception e) {
            System.err.println("Unexpected error: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }
}
```

---

## API Reference

### RpcClient

```java
public final class RpcClient implements AutoCloseable {
    // Factory methods
    public static RpcClient create(String baseUrl);
    public static RpcClient create(String baseUrl, Config config);
    public static ConfigBuilder builder();

    // RPC operations
    public RpcPromise<RpcResponse> call(String method, Object params);
    public RpcPromise<RpcResponse> call(String method);

    // WebSocket support
    public CompletableFuture<Void> connectWebSocket();

    // Lifecycle
    public void close();
}
```

### RpcPromise

```java
public static final class RpcPromise<T> {
    // Blocking operations
    public T await();
    public T await(Duration timeout);

    // Transformations
    public <U> RpcPromise<U> map(Function<T, U> mapper);
    public <U> RpcPromise<U> flatMap(Function<T, RpcPromise<U>> mapper);

    // Error handling
    public RpcPromise<T> recover(Function<Throwable, T> handler);

    // Side effects
    public RpcPromise<T> onSuccess(Consumer<T> action);
    public RpcPromise<T> onError(Consumer<Throwable> action);

    // Interop
    public CompletableFuture<T> toFuture();
}
```

### RpcResponse

```java
public record RpcResponse(Long id, Object result, Object error) {
    public Object getResult();  // Throws on error
    public boolean isSuccess();
    public boolean isError();
}
```

### ConfigBuilder

```java
public static final class ConfigBuilder {
    public ConfigBuilder connectTimeout(Duration timeout);
    public ConfigBuilder requestTimeout(Duration timeout);
    public ConfigBuilder auth(String token);
    public ConfigBuilder maxRetries(int retries);
    public ConfigBuilder retryDelay(Duration delay);
    public Config build();
    public RpcClient create(String baseUrl);
}
```

### RpcException

```java
public static class RpcException extends RuntimeException {
    public RpcException(String message);
    public RpcException(String message, Throwable cause);
}
```

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Virtual thread first** | Blocking API that's efficient with virtual threads |
| **Functional transformations** | `map()`, `flatMap()`, `recover()` on RpcPromise |
| **Records for data** | Immutable data types with pattern matching |
| **Try-with-resources** | AutoCloseable for clean resource management |
| **No magic** | Explicit calls, no proxies or reflection |
| **Familiar patterns** | Standard Java idioms, works with existing code |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](../capnweb/README.md) | The underlying capability-based RPC protocol |
| [dotdo](../dotdo/README.md) | Full DotDo platform SDK with auth and pooling |

### Other Language SDKs

| Language | Package | Install |
|----------|---------|---------|
| TypeScript | `rpc.do` | `npm install rpc.do` |
| Python | `rpc-do` | `pip install rpc-do` |
| Rust | `rpc-do` | `cargo add rpc-do` |
| Go | `go.rpc.do` | `go get go.rpc.do` |
| Kotlin | `do.rpc:sdk` | `implementation("do.rpc:sdk:0.1.0")` |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
