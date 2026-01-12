# Cap'n Web for Java

**Capability-based RPC designed for Java 21+ virtual threads.**

```java
try (var session = CapnWeb.connect("wss://api.example.com/rpc")) {
    var todos = session.stub(TodoService.class);

    Todo todo = todos.get("123");
    String authorName = todo.authorRef().resolve().getName();

    System.out.println("Created by: " + authorName);
}
```

Three RPC calls. Two round trips. Zero callbacks. Write blocking code that's actually efficient.

---

## Why Java 21?

Virtual threads changed everything. Blocking a virtual thread doesn't block a platform thread - it yields, letting thousands of concurrent operations share a handful of OS threads. This means:

- **Write sequential code** - no `CompletableFuture` chains, no callbacks
- **Get async performance** - virtual threads are cheap (millions per JVM)
- **Use try-with-resources** - natural resource cleanup
- **Pattern match on errors** - sealed types with exhaustive `switch`

Cap'n Web embraces this. The API is synchronous. The implementation is efficient.

---

## Installation

### Maven

```xml
<dependency>
    <groupId>do.capnweb</groupId>
    <artifactId>sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

### Gradle

```kotlin
// Kotlin DSL
implementation("do.capnweb:sdk:1.0.0")
```

```groovy
// Groovy DSL
implementation 'do.capnweb:sdk:1.0.0'
```

**Requires Java 21 or later.**

> **Note:** The package uses the reversed domain group ID `do.capnweb` following Maven conventions for the `.do` domain.

---

## Quick Start

### 1. Define Your Interface

No annotations. No base classes. Just a Java interface.

```java
public interface TodoService {
    List<Todo> list(String category);
    Todo get(String id);
    Todo create(String title, String category);
    void delete(String id);

    // Returns a nested capability
    CommentService comments(String todoId);
}

public interface CommentService {
    List<Comment> list();
    Comment add(String text);
    void delete(String commentId);
}
```

### 2. Define Your Data Types

Records are the natural choice for RPC data.

```java
public record Todo(
    String id,
    String title,
    String category,
    boolean complete,
    Instant createdAt,
    UserRef authorRef  // Capability reference - see "Capability References" section
) {}

public record Comment(
    String id,
    String text,
    Instant createdAt,
    UserRef authorRef
) {}

public record User(
    String id,
    String name,
    String email
) {}
```

### 3. Connect and Call

```java
var config = CapnWeb.builder("wss://api.example.com/rpc")
    .auth(Auth.bearer(System.getenv("API_TOKEN")))
    .timeout(Duration.ofSeconds(30))
    .build();

try (var session = CapnWeb.connect(config)) {
    var todos = session.stub(TodoService.class);

    // Create a todo
    Todo todo = todos.create("Write documentation", "work");

    // Navigate to nested capability
    CommentService comments = todos.comments(todo.id());
    comments.add("Don't forget the examples!");

    // List and filter
    List<Todo> workTodos = todos.list("work");
    workTodos.forEach(t -> System.out.println(t.title()));
}
```

---

## Virtual Threads in Action

With virtual threads, blocking code performs like async code. Each blocking call yields the virtual thread, not a platform thread.

```java
try (var session = CapnWeb.connect(endpoint)) {
    var todos = session.stub(TodoService.class);

    // This loop makes N+1 RPC calls
    // With virtual threads, this is efficient
    for (Todo todo : todos.list("work")) {
        UserService author = todo.authorRef().resolve();
        User profile = author.getProfile();
        System.out.printf("%s (by %s)%n", todo.title(), profile.name());
    }
}
```

No `CompletableFuture` chains. No callbacks. No `thenApply`. Just code.

### Parallel Operations

Use virtual thread executors for concurrent operations:

```java
List<Todo> items = todos.list("work");

try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = items.stream()
        .map(todo -> executor.submit(() -> {
            UserService author = todo.authorRef().resolve();
            return author.getName();
        }))
        .toList();

    // Collect results - get() blocks the virtual thread, not a platform thread
    List<String> authorNames = futures.stream()
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
    var todosTask = scope.fork(() -> todos.list("work"));
    var userTask = scope.fork(() -> users.current());
    var statsTask = scope.fork(() -> analytics.today());

    scope.join().throwIfFailed();

    dashboard = new Dashboard(
        todosTask.get(),
        userTask.get(),
        statsTask.get()
    );
}
```

---

## Capability References

Cap'n Web distinguishes between **data** and **capabilities**:

- **Data** (`User`, `Todo`) - passive values, serialized over the wire
- **Capabilities** (`UserService`, `TodoService`) - active references to remote objects
- **Capability References** (`UserRef`, `TodoRef`) - serializable handles that resolve to capabilities

### The Pattern

```java
// UserRef is a capability reference - it's data that points to a capability
public record UserRef(String id) {
    // Resolves this reference to an actual capability
    public UserService resolve() {
        return CapnWeb.currentSession().stub(UserService.class, id);
    }
}

// UserService is a capability - it's a remote object you can call
public interface UserService {
    User getProfile();
    String getName();
    void updateEmail(String email);
}

// User is data - passive value returned from capabilities
public record User(String id, String name, String email) {}
```

### Why This Distinction?

1. **Serialization**: `UserRef` can be part of a record, serialized in JSON. `UserService` cannot.
2. **Lazy resolution**: References don't create stubs until needed.
3. **Cacheability**: Data can be cached; capabilities represent live connections.

### Usage Example

```java
public record Todo(
    String id,
    String title,
    boolean complete,
    UserRef authorRef  // Reference, not the capability itself
) {}

// Later, when you need to call the author:
Todo todo = todos.get("123");
UserService author = todo.authorRef().resolve();  // Now it's a capability
String name = author.getName();                   // RPC call
```

### Batch Resolution

Resolve multiple references efficiently:

```java
List<Todo> items = todos.list("work");

// Resolve all author references in parallel
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Map<String, User> authors = items.stream()
        .map(Todo::authorRef)
        .distinct()
        .map(ref -> executor.submit(() ->
            Map.entry(ref.id(), ref.resolve().getProfile())
        ))
        .map(future -> {
            try { return future.get(); }
            catch (Exception e) { throw new RuntimeException(e); }
        })
        .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

    // Now use the cached authors
    for (Todo todo : items) {
        User author = authors.get(todo.authorRef().id());
        System.out.printf("%s by %s%n", todo.title(), author.name());
    }
}
```

---

## Pipelining

Pipelining sends multiple calls in a single round trip. The server executes them without waiting for intermediate results.

### The Problem

Without pipelining, chained calls require multiple round trips:

```java
// Round trip 1: get the todo
Todo todo = todos.get("123");
// Round trip 2: resolve and get the author
UserService author = todo.authorRef().resolve();
// Round trip 3: get the name
String name = author.getName();
```

### The Solution

Use the pipeline builder to batch calls:

```java
String authorName = session.pipeline()
    .call(() -> todos.get("123"))
    .then(todo -> todo.authorRef().resolve())
    .then(UserService::getName)
    .execute();
```

All three calls execute in a single round trip. The server evaluates `todos.get("123")`, immediately uses the result to resolve the author, then calls `getName()`, returning only the final value.

### Parallel Pipelines

Fetch multiple independent values in one round trip:

```java
record Dashboard(List<Todo> todos, User currentUser, Stats stats) {}

Dashboard dashboard = session.pipeline()
    .fork(() -> todos.list("work"))
    .fork(() -> users.current())
    .fork(() -> analytics.today())
    .join(Dashboard::new);
```

### Mapping Over Results

Transform results server-side to reduce data transfer:

```java
List<String> titles = session.pipeline()
    .call(() -> todos.list("work"))
    .map(list -> list.stream()
        .filter(Todo::complete)
        .map(Todo::title)
        .toList())
    .execute();
```

---

## Error Handling

### Sealed Error Types

Errors are modeled as a sealed hierarchy, enabling exhaustive pattern matching with Java 21's switch expressions.

```java
public sealed interface RpcError {
    record NotFound(String resource, String id) implements RpcError {}
    record PermissionDenied(String action, String reason) implements RpcError {}
    record InvalidInput(String field, String message) implements RpcError {}
    record Unavailable(Duration retryAfter) implements RpcError {}
    record RateLimited(int limit, Duration resetAfter) implements RpcError {}
    record Internal(String message) implements RpcError {}
}
```

### Pattern Matching

Handle errors exhaustively with switch expressions:

```java
try {
    Todo todo = todos.get("missing-id");
} catch (RpcException e) {
    String message = switch (e.error()) {
        case RpcError.NotFound(var resource, var id) ->
            String.format("%s '%s' does not exist", resource, id);

        case RpcError.PermissionDenied(var action, var reason) ->
            String.format("Cannot %s: %s", action, reason);

        case RpcError.InvalidInput(var field, var msg) ->
            String.format("Invalid %s: %s", field, msg);

        case RpcError.Unavailable(var retry) ->
            String.format("Service unavailable. Retry in %d seconds", retry.toSeconds());

        case RpcError.RateLimited(var limit, var reset) ->
            String.format("Rate limited (%d/min). Resets in %d seconds", limit, reset.toSeconds());

        case RpcError.Internal(var msg) ->
            "Server error: " + msg;
    };
    logger.error(message);
}
```

### Result Type

For functional error handling without exceptions:

```java
Result<Todo> result = Result.catching(() -> todos.get("123"));

// Pattern match
String output = switch (result) {
    case Result.Ok(var todo) -> "Found: " + todo.title();
    case Result.Err(var error) -> "Error: " + error;
};

// Or use functional methods
Todo todo = result
    .recover(RpcError.NotFound.class, err -> Todo.empty())
    .orElseThrow();

// Map and flatMap
String title = Result.catching(() -> todos.get("123"))
    .map(Todo::title)
    .orElse("Unknown");
```

---

## Workflows and Tasks

Cap'n Web excels at orchestrating multi-step workflows - the "do" in do.md.

### Simple Workflow

```java
public interface WorkflowService {
    Workflow create(String name);
    Workflow get(String id);
    List<Workflow> listActive();
}

public interface Workflow {
    String id();
    WorkflowStatus status();

    // Steps are capabilities - each one can be independently invoked
    TaskService tasks();

    void start();
    void pause();
    void resume();
    void cancel();
}

public interface TaskService {
    Task create(String name, Map<String, Object> input);
    Task get(String taskId);
    List<Task> list();
    List<Task> pending();
}

public record Task(
    String id,
    String name,
    TaskStatus status,
    Map<String, Object> input,
    Map<String, Object> output,
    Instant createdAt,
    Instant completedAt
) {}

public enum TaskStatus { PENDING, RUNNING, COMPLETED, FAILED, CANCELLED }
public enum WorkflowStatus { CREATED, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED }
```

### Executing a Workflow

```java
try (var session = CapnWeb.connect(config)) {
    var workflows = session.stub(WorkflowService.class);

    // Create a workflow
    Workflow orderProcess = workflows.create("process-order");
    TaskService tasks = orderProcess.tasks();

    // Add tasks
    Task validateOrder = tasks.create("validate", Map.of("orderId", orderId));
    Task chargePayment = tasks.create("charge", Map.of("orderId", orderId));
    Task shipOrder = tasks.create("ship", Map.of("orderId", orderId));

    // Start the workflow
    orderProcess.start();

    // Monitor progress
    while (orderProcess.status() == WorkflowStatus.RUNNING) {
        List<Task> pending = tasks.pending();
        System.out.printf("Pending: %d tasks%n", pending.size());
        Thread.sleep(1000);
    }

    System.out.println("Workflow completed: " + orderProcess.status());
}
```

### Saga Pattern

For distributed transactions with compensating actions:

```java
public interface SagaService {
    Saga create(String name);
}

public interface Saga {
    String id();

    // Add a step with its compensating action
    SagaStep addStep(String name, Runnable action, Runnable compensation);

    // Execute all steps, rolling back on failure
    SagaResult execute();
}

public sealed interface SagaResult {
    record Success(List<String> completedSteps) implements SagaResult {}
    record RolledBack(String failedStep, Exception cause, List<String> compensatedSteps)
        implements SagaResult {}
}
```

```java
Saga orderSaga = sagas.create("create-order");

orderSaga.addStep(
    "reserve-inventory",
    () -> inventory.reserve(items),
    () -> inventory.release(items)
);

orderSaga.addStep(
    "charge-payment",
    () -> payments.charge(customerId, amount),
    () -> payments.refund(customerId, amount)
);

orderSaga.addStep(
    "create-shipment",
    () -> shipping.createLabel(orderId),
    () -> shipping.cancelLabel(orderId)
);

SagaResult result = orderSaga.execute();

switch (result) {
    case SagaResult.Success(var steps) ->
        logger.info("Order created successfully. Steps: {}", steps);

    case SagaResult.RolledBack(var failed, var cause, var compensated) ->
        logger.error("Order failed at '{}', rolled back: {}", failed, compensated, cause);
}
```

---

## Streaming and Events

### Server-Sent Events

```java
public interface EventService {
    // Returns a stream of events
    Stream<Event> subscribe(String topic);

    // Returns a stream that can be cancelled
    Subscription<Event> subscribeWithControl(String topic);
}

public record Event(
    String id,
    String type,
    Instant timestamp,
    Map<String, Object> data
) {}

public interface Subscription<T> extends AutoCloseable {
    Stream<T> events();
    void pause();
    void resume();
    void close();
}
```

### Consuming Events

```java
try (var session = CapnWeb.connect(config)) {
    var events = session.stub(EventService.class);

    // Subscribe and process events
    events.subscribe("orders")
        .forEach(event -> {
            switch (event.type()) {
                case "order.created" -> handleNewOrder(event);
                case "order.shipped" -> handleShipment(event);
                case "order.delivered" -> handleDelivery(event);
                default -> logger.debug("Unknown event: {}", event.type());
            }
        });
}
```

### With Cancellation Control

```java
try (var subscription = events.subscribeWithControl("orders")) {
    var executor = Executors.newVirtualThreadPerTaskExecutor();

    // Process events in background
    executor.submit(() -> {
        subscription.events().forEach(this::processEvent);
    });

    // Later, pause processing
    subscription.pause();

    // Resume when ready
    subscription.resume();

    // Or cancel entirely (also happens automatically on close)
}
```

### Bidirectional Streaming

```java
public interface ChatService {
    // Send messages, receive messages
    ChatSession join(String roomId);
}

public interface ChatSession extends AutoCloseable {
    void send(ChatMessage message);
    Stream<ChatMessage> messages();
    List<User> participants();
    void leave();
}
```

```java
try (ChatSession chat = chatService.join("general")) {
    // Spawn a virtual thread to receive messages
    Thread.startVirtualThread(() -> {
        chat.messages().forEach(msg ->
            System.out.printf("[%s] %s%n", msg.author(), msg.text())
        );
    });

    // Send messages from main thread
    try (var scanner = new Scanner(System.in)) {
        while (scanner.hasNextLine()) {
            String line = scanner.nextLine();
            chat.send(new ChatMessage(currentUser, line, Instant.now()));
        }
    }
}
```

---

## Exposing Local Capabilities

Implement your interface. Export it. Done.

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
        return db.find(Todo.class, id)
            .orElseThrow(() -> RpcException.notFound("todo", id));
    }

    @Override
    public Todo create(String title, String category) {
        var todo = new Todo(
            UUID.randomUUID().toString(),
            title,
            category,
            false,
            Instant.now(),
            new UserRef(currentUserId())
        );
        db.insert(todo);
        return todo;
    }

    @Override
    public void delete(String id) {
        if (!db.delete(Todo.class, id)) {
            throw RpcException.notFound("todo", id);
        }
    }

    @Override
    public CommentService comments(String todoId) {
        // Return a nested capability
        return new LocalCommentService(db, todoId);
    }
}
```

### Export to Session

```java
try (var session = CapnWeb.connect(config)) {
    // Export your implementation
    session.export("todos", new LocalTodoService(db));

    // Session stays open to handle incoming calls
    session.awaitTermination();
}
```

### Bidirectional Calls

Access the calling session to make callbacks:

```java
public class NotifyingTodoService implements TodoService {
    private final Database db;

    @Override
    public Todo create(String title, String category) {
        Todo todo = db.insert(/* ... */);

        // Callback to the client
        var client = CapnWeb.currentSession().stub(ClientNotifications.class);
        client.onTodoCreated(todo);

        return todo;
    }
}
```

---

## Dynamic Targets

For advanced use cases, implement `RpcTarget` directly:

```java
public class DynamicService implements RpcTarget {

    @Override
    public Object invoke(String method, Object[] args) {
        return switch (method) {
            case "echo" -> args[0];
            case "add" -> ((Number) args[0]).intValue() + ((Number) args[1]).intValue();
            case "now" -> Instant.now();
            default -> throw RpcException.methodNotFound(method);
        };
    }

    @Override
    public RpcTarget getCapability(String name) {
        return switch (name) {
            case "utils" -> new UtilsService();
            case "admin" -> new AdminService();
            default -> throw RpcException.capabilityNotFound(name);
        };
    }
}
```

---

## Configuration

### Builder Pattern

```java
var config = CapnWeb.builder("wss://api.example.com/rpc")
    .transport(Transport.webSocket()
        .pingInterval(Duration.ofSeconds(30))
        .reconnect(true)
        .maxReconnectAttempts(5)
        .reconnectBackoff(Duration.ofSeconds(1), Duration.ofSeconds(30)))
    .auth(Auth.bearer(token))
    .timeout(Duration.ofSeconds(60))
    .serializer(Serializer.jackson(objectMapper))
    .virtualThreads(true)  // Default on Java 21+
    .build();
```

### Transport Options

```java
// WebSocket (default, bidirectional)
Transport.webSocket()
    .pingInterval(Duration.ofSeconds(30))
    .compression(true)

// HTTP Batch (stateless, request-response)
Transport.http()
    .maxBatchSize(100)
    .compression(true)
```

### Authentication

```java
// Bearer token
Auth.bearer("your-token")

// API key
Auth.apiKey("your-api-key")

// Custom header
Auth.header("X-Custom-Auth", "value")

// Refreshable token
Auth.bearer(() -> tokenService.getCurrentToken())

// No authentication
Auth.none()
```

---

## Testing

### In-Process Transport

Test without network overhead:

```java
@Test
void testTodoService() {
    var server = new LocalTodoService(testDb);

    try (var session = CapnWeb.inProcess(server)) {
        var todos = session.stub(TodoService.class);

        Todo created = todos.create("Test", "test");
        assertNotNull(created.id());

        Todo fetched = todos.get(created.id());
        assertEquals("Test", fetched.title());
    }
}
```

### Mock Stubs

```java
@Test
void testWithMock() {
    TodoService mockTodos = mock(TodoService.class);
    when(mockTodos.get("123")).thenReturn(
        new Todo("123", "Test", "work", false, Instant.now(), new UserRef("u1"))
    );

    var myService = new MyService(mockTodos);
    myService.doSomething();

    verify(mockTodos).get("123");
}
```

### Testing Workflows

```java
@Test
void testWorkflowExecution() {
    var server = new LocalWorkflowService(testDb);

    try (var session = CapnWeb.inProcess(server)) {
        var workflows = session.stub(WorkflowService.class);

        Workflow workflow = workflows.create("test-workflow");
        TaskService tasks = workflow.tasks();

        tasks.create("step1", Map.of("input", "value"));
        tasks.create("step2", Map.of());

        workflow.start();

        // Wait for completion
        await().atMost(Duration.ofSeconds(5))
            .until(() -> workflow.status() == WorkflowStatus.COMPLETED);

        List<Task> completed = tasks.list().stream()
            .filter(t -> t.status() == TaskStatus.COMPLETED)
            .toList();

        assertEquals(2, completed.size());
    }
}
```

---

## Platform Integration

### Spring Boot

```java
@Configuration
public class CapnWebConfig {

    @Bean
    public CapnWebSession capnWebSession(
            @Value("${capnweb.url}") String url,
            @Value("${capnweb.token}") String token) {

        return CapnWeb.builder(url)
            .auth(Auth.bearer(token))
            .build()
            .connect();
    }

    @Bean
    public TodoService todoService(CapnWebSession session) {
        return session.stub(TodoService.class);
    }
}

@Service
public class TodoApplicationService {
    private final TodoService todos;

    public TodoApplicationService(TodoService todos) {
        this.todos = todos;
    }

    public List<Todo> getWorkTodos() {
        return todos.list("work");
    }
}
```

### Quarkus

```java
@ApplicationScoped
public class CapnWebProducer {

    @ConfigProperty(name = "capnweb.url")
    String url;

    @ConfigProperty(name = "capnweb.token")
    String token;

    @Produces
    @ApplicationScoped
    public CapnWebSession session() {
        return CapnWeb.builder(url)
            .auth(Auth.bearer(token))
            .build()
            .connect();
    }

    @Produces
    @ApplicationScoped
    public TodoService todoService(CapnWebSession session) {
        return session.stub(TodoService.class);
    }
}
```

### Plain Java

```java
public class TodoApp {

    public static void main(String[] args) {
        var config = CapnWeb.builder("wss://api.example.com/rpc")
            .auth(Auth.bearer(System.getenv("API_TOKEN")))
            .build();

        try (var session = CapnWeb.connect(config)) {
            var todos = session.stub(TodoService.class);

            // Create
            Todo todo = todos.create("Learn Cap'n Web", "learning");
            System.out.println("Created: " + todo.id());

            // Pipelined fetch of author name
            String authorName = session.pipeline()
                .call(() -> todos.get(todo.id()))
                .then(t -> t.authorRef().resolve())
                .then(UserService::getName)
                .execute();
            System.out.println("Author: " + authorName);

            // Add comments through nested capability
            CommentService comments = todos.comments(todo.id());
            comments.add("This library is elegant!");
            comments.add("Virtual threads are amazing.");

            // List all with parallel author lookup
            List<Todo> allTodos = todos.list("learning");

            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                List<Future<String>> futures = allTodos.stream()
                    .map(t -> executor.submit(() -> {
                        UserService author = t.authorRef().resolve();
                        return String.format("- %s (by %s)", t.title(), author.getName());
                    }))
                    .toList();

                for (var future : futures) {
                    System.out.println(future.get());
                }
            }

        } catch (RpcException e) {
            switch (e.error()) {
                case RpcError.Unavailable(var retry) -> {
                    System.err.println("Service down. Retry in " + retry);
                    System.exit(1);
                }
                default -> {
                    System.err.println("RPC failed: " + e.getMessage());
                    System.exit(1);
                }
            }
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            System.exit(1);
        }
    }
}
```

---

## Security Considerations

### Capability-Based Security

Cap'n Web uses capability-based security. Access is granted by possessing a capability reference, not by identity checks:

```java
// The server grants access by returning capabilities
public interface AuthService {
    // Returns capabilities the user is allowed to use
    AuthenticatedSession login(String username, String password);
}

public interface AuthenticatedSession {
    User currentUser();

    // Only authenticated users get this capability
    TodoService todos();

    // Admins get additional capabilities
    Optional<AdminService> admin();
}
```

### Principle of Least Authority

Only expose the capabilities needed:

```java
// Instead of exposing everything:
// session.export("api", new FullApiService());  // Too broad

// Export specific capabilities:
session.export("todos", new ReadOnlyTodoService(db));
session.export("profile", new UserProfileService(db, userId));
```

### Token Refresh

```java
var config = CapnWeb.builder(url)
    .auth(Auth.bearer(() -> {
        // Called on each request - return fresh token
        if (tokenExpiresSoon()) {
            refreshToken();
        }
        return currentToken;
    }))
    .build();
```

### TLS/SSL

Always use `wss://` for production:

```java
var config = CapnWeb.builder("wss://api.example.com/rpc")
    .transport(Transport.webSocket()
        .tlsConfig(TlsConfig.builder()
            .trustStore(trustStorePath)
            .keyStore(keyStorePath, keyStorePassword)
            .build()))
    .build();
```

---

## Why This Design

| Decision | Rationale |
|----------|-----------|
| Blocking API | Virtual threads make blocking efficient; simpler code |
| Records for data | Immutable, pattern-matchable, natural for RPC values |
| Sealed error types | Exhaustive pattern matching catches unhandled cases |
| Capability references | Separate serializable handles from live stubs |
| Interface-based stubs | No annotations needed; standard Java patterns |
| try-with-resources | Natural cleanup; no forgotten sessions |
| Pipeline builder | Explicit batching when automatic isn't enough |

---

## API Reference

See [API.md](./API.md) for complete type signatures.

See [SYNTAX.md](./SYNTAX.md) for design exploration and alternatives.

---

## License

MIT
