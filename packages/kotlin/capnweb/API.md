# Cap'n Web Kotlin Client Library - API Design

**Package:** `com.dotdo.capnweb`
**Version:** 1.0.0
**Kotlin:** 1.9+
**Status:** Final Design

---

## Design Principles

1. **Coroutines are first-class** - Every async operation is a `suspend` function
2. **Pipelining should feel invisible** - Chain calls naturally; the library optimizes
3. **DSL builders for configuration** - Type-safe, discoverable, Kotlin-native
4. **Type safety is opt-in** - Dynamic by default, typed interfaces when you want them
5. **Errors are sealed** - Exhaustive `when` expressions for robust error handling
6. **Zero-cost abstractions** - Inline functions and reified generics eliminate overhead

---

## Quick Start

```kotlin
import com.dotdo.capnweb.*
import kotlin.time.Duration.Companion.seconds

// Connect and use
val api = CapnWeb("wss://api.example.com")

val todos: List<Todo> = api.todos.list()
val authorName: String = api.todos["123"].author.profile.name.await()

api.close()
```

---

## Session Configuration

### Simple Connection

```kotlin
val api = CapnWeb("wss://api.example.com")
```

### DSL Builder

```kotlin
val session = CapnWeb {
    url("wss://api.example.com")

    transport {
        type = Transport.WebSocket
        pingInterval = 30.seconds
    }

    auth {
        bearer(System.getenv("API_KEY"))
    }

    timeout {
        connect = 10.seconds
        call = 30.seconds
    }

    reconnect {
        enabled = true
        maxAttempts = 5
        backoff = exponential(base = 1.seconds, max = 30.seconds)
    }

    serialization {
        json = Json { ignoreUnknownKeys = true }
    }
}
```

### Structured Concurrency

```kotlin
// Scoped session - auto-closes when block completes
CapnWeb("wss://api.example.com").use { api ->
    val todos = api.todos.list()
    processTodos(todos)
}

// Or with explicit lifecycle
val session = CapnWeb("wss://api.example.com")
try {
    // use session
} finally {
    session.close()
}
```

---

## Making RPC Calls

### Dynamic Stubs

```kotlin
val api = CapnWeb("wss://api.example.com")

// Property access navigates the capability tree
val todos = api.todos                    // RpcStub
val users = api.users                    // RpcStub

// Method calls are suspend functions
val allTodos: List<Todo> = api.todos.list()
val todo: Todo = api.todos.get("123")

// Named parameters work naturally
val filtered: List<Todo> = api.todos.list(
    category = "work",
    completed = false,
    limit = 10
)

// Indexer syntax for get-by-id patterns
val todo: Todo = api.todos["123"].get()
```

### Typed Interfaces (Optional)

Define interfaces for full IDE support:

```kotlin
@RpcInterface
interface TodoApi {
    val todos: TodoService
    val users: UserService
    val auth: AuthService
}

@RpcInterface
interface TodoService {
    suspend fun list(
        category: String? = null,
        completed: Boolean? = null,
        limit: Int = 100
    ): List<Todo>

    suspend fun get(id: String): Todo
    suspend fun create(title: String, category: String = "default"): Todo

    // Returns a nested capability
    operator fun get(id: String): SingleTodoService
}

@RpcInterface
interface SingleTodoService {
    val author: UserService
    val comments: CommentService

    suspend fun get(): Todo
    suspend fun update(patch: TodoPatch): Todo
    suspend fun delete()
}
```

Use typed stubs:

```kotlin
val api: TodoApi = session.stub()

// Full autocomplete and type checking
val todos = api.todos.list(category = "work")
val todo = api.todos.get("123")
val author = api.todos["123"].author
```

---

## Pipelining

The defining feature of Cap'n Web - chain calls across capabilities in a single round-trip.

### Natural Chaining

```kotlin
// This looks like 4 calls, but executes as 1 round-trip!
val authorName: String = api
    .todos["123"]    // Navigate to todo capability
    .author          // Pipeline: get author capability
    .profile         // Pipeline: get profile
    .name            // Pipeline: get name property
    .await()         // Execute the entire pipeline

// The library automatically batches these into one request
```

### How It Works

Each property access or method call on an `RpcStub` returns an `RpcPromise`:

```kotlin
val todoPromise: RpcPromise<Todo> = api.todos.get("123")
val authorPromise: RpcPromise<User> = todoPromise.author
val namePromise: RpcPromise<String> = authorPromise.profile.name

// Only when you call .await() does the request execute
val name: String = namePromise.await()
```

### Pipeline DSL

For complex pipelines with multiple return values:

```kotlin
val (author, commentCount) = pipeline(api) {
    val todo = todos.get("123")
    val author = todo.author.profile
    val comments = todo.comments.count()

    author to comments
}.await()
```

### Parallel Execution

```kotlin
// Independent calls execute in parallel automatically
coroutineScope {
    val todosDeferred = async { api.todos.list() }
    val userDeferred = async { api.users.current() }

    val todos = todosDeferred.await()
    val user = userDeferred.await()
}

// Or use the parallel builder
val (todos, user) = parallel(
    { api.todos.list() },
    { api.users.current() }
)
```

---

## Error Handling

### Sealed Error Hierarchy

```kotlin
sealed class RpcError : Exception() {
    // Client errors (4xx equivalent)
    data class NotFound(
        val resource: String
    ) : RpcError()

    data class ValidationFailed(
        val errors: Map<String, String>
    ) : RpcError()

    data class PermissionDenied(
        val action: String,
        val reason: String
    ) : RpcError()

    data class Unauthorized(
        val realm: String? = null
    ) : RpcError()

    // Server errors (5xx equivalent)
    data class RemoteException(
        val type: String,
        override val message: String,
        val stack: String? = null
    ) : RpcError()

    // Transport errors
    data class NetworkError(
        override val cause: Throwable
    ) : RpcError()

    data class Timeout(
        val operation: String,
        val duration: Duration
    ) : RpcError()

    data object Disconnected : RpcError()

    data object SessionClosed : RpcError()
}
```

### Exhaustive Pattern Matching

```kotlin
try {
    val todo = api.todos.get(id)
    processTodo(todo)
} catch (e: RpcError) {
    when (e) {
        is RpcError.NotFound -> {
            logger.info("Todo $id not found")
            return null
        }
        is RpcError.PermissionDenied -> {
            logger.warn("Access denied: ${e.reason}")
            throw AccessDeniedException(e.reason)
        }
        is RpcError.ValidationFailed -> {
            e.errors.forEach { (field, msg) ->
                logger.warn("Validation: $field - $msg")
            }
            throw IllegalArgumentException("Invalid request")
        }
        is RpcError.NetworkError -> {
            logger.error("Network error", e.cause)
            scheduleRetry()
        }
        is RpcError.Timeout -> {
            logger.warn("Timeout after ${e.duration}")
            scheduleRetry()
        }
        is RpcError.Disconnected,
        is RpcError.SessionClosed -> {
            reconnect()
        }
        is RpcError.Unauthorized -> {
            refreshToken()
            retry()
        }
        is RpcError.RemoteException -> {
            logger.error("Remote error [${e.type}]: ${e.message}")
            throw e
        }
    }
}
```

### Result Type

For explicit error handling without exceptions:

```kotlin
val result: RpcResult<Todo> = api.todos.get(id).toResult()

when (result) {
    is RpcResult.Success -> {
        println("Found: ${result.value.title}")
    }
    is RpcResult.Failure -> {
        println("Error: ${result.error}")
    }
}

// Or with fold
val message = result.fold(
    onSuccess = { "Found: ${it.title}" },
    onFailure = { "Error: $it" }
)

// Monadic operations
val title: String? = api.todos.get(id)
    .toResult()
    .map { it.title }
    .getOrNull()
```

---

## Exposing Local Objects

Export local implementations as RPC targets.

### Annotation-Based Targets

```kotlin
@RpcTarget
class LocalTodoService(
    private val db: Database
) : TodoService {

    override suspend fun list(
        category: String?,
        completed: Boolean?,
        limit: Int
    ): List<Todo> {
        return db.todos
            .filter { category == null || it.category == category }
            .filter { completed == null || it.completed == completed }
            .take(limit)
    }

    override suspend fun get(id: String): Todo {
        return db.findTodo(id)
            ?: throw RpcError.NotFound("todos/$id")
    }

    override suspend fun create(title: String, category: String): Todo {
        val todo = Todo(
            id = UUID.randomUUID().toString(),
            title = title,
            category = category
        )
        db.insert(todo)
        return todo
    }

    override operator fun get(id: String): SingleTodoService {
        return LocalSingleTodoService(db, id)
    }
}

// Export to session
session.export("todos", LocalTodoService(db))
```

### Lambda Targets

For simple cases:

```kotlin
// Single method
session.export("echo") { message: String ->
    message.reversed()
}

// Multiple methods
session.export("math") {
    method("add") { a: Int, b: Int -> a + b }
    method("multiply") { a: Int, b: Int -> a * b }
    method("factorial") { n: Int -> (1..n).fold(1L) { acc, i -> acc * i } }
}
```

### Capability Return Values

When your target returns another object, it becomes a capability the client can call:

```kotlin
@RpcTarget
class LocalAuthService : AuthService {

    override suspend fun login(credentials: Credentials): AuthenticatedSession {
        val user = authenticate(credentials)

        // This object becomes a new capability on the client
        return LocalAuthenticatedSession(user)
    }
}

@RpcTarget
class LocalAuthenticatedSession(
    private val user: User
) : AuthenticatedSession {

    override suspend fun currentUser(): User = user

    override suspend fun logout() {
        invalidateSession()
    }
}
```

---

## Streaming with Flow

For subscriptions and bidirectional streaming.

### Server-Side Streaming

```kotlin
@RpcInterface
interface NotificationService {
    fun subscribe(filter: NotificationFilter? = null): Flow<Notification>
}

// Client usage
api.notifications
    .subscribe(filter = NotificationFilter(type = "mention"))
    .onEach { notification ->
        showToast(notification.message)
    }
    .catch { e ->
        logger.error("Stream error", e)
    }
    .launchIn(lifecycleScope)
```

### Bidirectional Streaming

```kotlin
@RpcInterface
interface ChatService {
    fun connect(messages: Flow<OutgoingMessage>): Flow<IncomingMessage>
}

// Client usage
val outgoing = MutableSharedFlow<OutgoingMessage>()

val incoming = api.chat.connect(outgoing)

// Send messages
launch {
    outgoing.emit(OutgoingMessage("Hello!"))
}

// Receive messages
incoming.collect { message ->
    displayMessage(message)
}
```

### Local Streaming Target

```kotlin
@RpcTarget
class LocalNotificationService {

    private val notifications = MutableSharedFlow<Notification>(
        replay = 0,
        extraBufferCapacity = 100
    )

    fun subscribe(filter: NotificationFilter?): Flow<Notification> {
        return notifications
            .filter { filter == null || it.type == filter.type }
            .asSharedFlow()
    }

    // Internal: emit notifications
    suspend fun emit(notification: Notification) {
        notifications.emit(notification)
    }
}
```

---

## Connection Lifecycle

### Connection State

```kotlin
session.connectionState.collect { state ->
    when (state) {
        is ConnectionState.Connecting -> {
            showLoadingIndicator()
        }
        is ConnectionState.Connected -> {
            hideLoadingIndicator()
            onConnected()
        }
        is ConnectionState.Reconnecting -> {
            showReconnectingBanner(attempt = state.attempt)
        }
        is ConnectionState.Disconnected -> {
            showDisconnectedError(reason = state.reason)
        }
        is ConnectionState.Failed -> {
            showFatalError(error = state.error)
        }
    }
}
```

### Manual Reconnection

```kotlin
// Reconnect after disconnect
session.reconnect()

// Reconnect with new auth
session.reconnect {
    auth {
        bearer(newToken)
    }
}
```

---

## Serialization

### Data Classes with kotlinx.serialization

```kotlin
@Serializable
data class Todo(
    val id: String,
    val title: String,
    val completed: Boolean = false,
    val category: String = "default",
    val createdAt: Instant,
    val dueDate: LocalDate? = null
)

@Serializable
data class TodoPatch(
    val title: String? = null,
    val completed: Boolean? = null,
    val category: String? = null,
    val dueDate: LocalDate? = null
)

@Serializable
data class NotificationFilter(
    val type: String? = null,
    val since: Instant? = null
)
```

### Custom Serializers

```kotlin
val session = CapnWeb {
    url("wss://api.example.com")

    serialization {
        json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            encodeDefaults = false

            serializersModule = SerializersModule {
                contextual(Instant::class, InstantSerializer)
                contextual(UUID::class, UUIDSerializer)
            }
        }
    }
}
```

---

## Testing

### Mock Sessions

```kotlin
@Test
fun `fetches todos correctly`() = runTest {
    val mockSession = MockCapnWeb {
        on("todos.list") {
            listOf(
                Todo(id = "1", title = "Test"),
                Todo(id = "2", title = "Test 2")
            )
        }

        on("todos.get") { args ->
            val id = args["id"] as String
            Todo(id = id, title = "Todo $id")
        }
    }

    val todos = mockSession.todos.list()
    assertEquals(2, todos.size)

    val todo = mockSession.todos.get("123")
    assertEquals("123", todo.id)
}
```

### In-Memory Transport

```kotlin
@Test
fun `client and server communicate`() = runTest {
    val (clientTransport, serverTransport) = InMemoryTransport.pair()

    // Server side
    val server = CapnWeb {
        transport { custom = serverTransport }
    }
    server.export("todos", LocalTodoService(testDb))

    // Client side
    val client = CapnWeb {
        transport { custom = clientTransport }
    }

    val todos = client.todos.list()
    assertTrue(todos.isNotEmpty())
}
```

### Pipeline Verification

```kotlin
@Test
fun `pipelines execute in single round-trip`() = runTest {
    var requestCount = 0

    val session = MockCapnWeb {
        interceptor { request ->
            requestCount++
            // Continue with request
        }

        on("todos.get") { Todo(id = "1", title = "Test", authorId = "u1") }
        on("users.get") { User(id = "u1", name = "Alice") }
    }

    // This should be a single request despite 3 logical operations
    val authorName = session.todos["1"].author.name.await()

    assertEquals("Alice", authorName)
    assertEquals(1, requestCount) // Single round-trip!
}
```

---

## Gradle Setup

```kotlin
// build.gradle.kts
plugins {
    kotlin("jvm") version "1.9.20"
    kotlin("plugin.serialization") version "1.9.20"
    id("com.google.devtools.ksp") version "1.9.20-1.0.14"
}

dependencies {
    // Core library
    implementation("com.dotdo:capnweb:1.0.0")

    // KSP processor for @RpcInterface and @RpcTarget
    ksp("com.dotdo:capnweb-ksp:1.0.0")

    // Kotlinx serialization (required)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")

    // Coroutines (required)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // Testing
    testImplementation("com.dotdo:capnweb-test:1.0.0")
}
```

### Multiplatform Setup

```kotlin
// build.gradle.kts
plugins {
    kotlin("multiplatform") version "1.9.20"
    kotlin("plugin.serialization") version "1.9.20"
}

kotlin {
    jvm()
    js(IR) {
        browser()
        nodejs()
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain {
            dependencies {
                implementation("com.dotdo:capnweb-core:1.0.0")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
            }
        }
        jvmMain {
            dependencies {
                implementation("com.dotdo:capnweb-jvm:1.0.0")
            }
        }
        jsMain {
            dependencies {
                implementation("com.dotdo:capnweb-js:1.0.0")
            }
        }
        iosMain {
            dependencies {
                implementation("com.dotdo:capnweb-native:1.0.0")
            }
        }
    }
}
```

---

## Type Reference

### Core Types

```kotlin
// Session - entry point for all operations
interface RpcSession : Closeable {
    val connectionState: StateFlow<ConnectionState>

    suspend fun <T> stub(): T
    fun <T> export(name: String, target: T)
    suspend fun reconnect(configure: SessionConfig.() -> Unit = {})
}

// Stub - represents a remote capability
class RpcStub<T>(
    internal val session: RpcSession,
    internal val path: Path
) {
    operator fun get(name: String): RpcStub<Any?>
    operator fun get(index: Int): RpcStub<Any?>

    suspend inline fun <reified R> call(
        method: String,
        vararg args: Any?
    ): R
}

// Promise - deferred result supporting pipelining
class RpcPromise<T>(
    internal val session: RpcSession,
    internal val expression: Expression
) {
    suspend fun await(): T
    fun toResult(): RpcResult<T>

    // Pipelining operators
    operator fun <R> get(property: String): RpcPromise<R>
    fun <R> then(transform: (T) -> R): RpcPromise<R>
}

// Result - explicit success/failure
sealed class RpcResult<out T> {
    data class Success<T>(val value: T) : RpcResult<T>()
    data class Failure(val error: RpcError) : RpcResult<Nothing>()

    fun <R> map(transform: (T) -> R): RpcResult<R>
    fun <R> flatMap(transform: (T) -> RpcResult<R>): RpcResult<R>
    fun getOrNull(): T?
    fun getOrElse(default: () -> T): T
    fun getOrThrow(): T
    fun <R> fold(onSuccess: (T) -> R, onFailure: (RpcError) -> R): R
}
```

### Configuration Types

```kotlin
class SessionConfig {
    fun url(url: String)
    fun transport(configure: TransportConfig.() -> Unit)
    fun auth(configure: AuthConfig.() -> Unit)
    fun timeout(configure: TimeoutConfig.() -> Unit)
    fun reconnect(configure: ReconnectConfig.() -> Unit)
    fun serialization(configure: SerializationConfig.() -> Unit)
}

class TransportConfig {
    var type: Transport = Transport.WebSocket
    var pingInterval: Duration = 30.seconds
    var custom: RpcTransport? = null
}

class AuthConfig {
    fun bearer(token: String)
    fun basic(username: String, password: String)
    fun custom(header: String, value: String)
}

class TimeoutConfig {
    var connect: Duration = 10.seconds
    var call: Duration = 30.seconds
    var idle: Duration = 5.minutes
}

class ReconnectConfig {
    var enabled: Boolean = true
    var maxAttempts: Int = 5
    var backoff: BackoffStrategy = exponential()
}

sealed class ConnectionState {
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Reconnecting(val attempt: Int) : ConnectionState()
    data class Disconnected(val reason: String) : ConnectionState()
    data class Failed(val error: RpcError) : ConnectionState()
}
```

---

## Complete Example

```kotlin
import com.dotdo.capnweb.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.seconds

// --- Data Models ---

@Serializable
data class Todo(
    val id: String,
    val title: String,
    val completed: Boolean = false,
    val authorId: String
)

@Serializable
data class User(
    val id: String,
    val name: String,
    val email: String
)

// --- Typed Interface (Optional) ---

@RpcInterface
interface Api {
    val todos: TodoService
    val users: UserService
    val notifications: NotificationService
}

@RpcInterface
interface TodoService {
    suspend fun list(): List<Todo>
    suspend fun create(title: String): Todo
    operator fun get(id: String): SingleTodo
}

@RpcInterface
interface SingleTodo {
    val author: UserService
    suspend fun get(): Todo
    suspend fun complete()
}

@RpcInterface
interface UserService {
    suspend fun get(): User
    val name: String
}

@RpcInterface
interface NotificationService {
    fun subscribe(): Flow<Notification>
}

@Serializable
data class Notification(
    val type: String,
    val message: String
)

// --- Main Application ---

suspend fun main() = coroutineScope {
    // Connect with configuration
    val session = CapnWeb {
        url("wss://api.example.com")

        auth {
            bearer(System.getenv("API_TOKEN"))
        }

        timeout {
            call = 30.seconds
        }

        reconnect {
            maxAttempts = 3
        }
    }

    session.use { api: Api ->
        // Monitor connection state
        launch {
            api.connectionState.collect { state ->
                println("Connection: $state")
            }
        }

        // Subscribe to notifications
        launch {
            api.notifications.subscribe()
                .catch { e -> println("Notification error: $e") }
                .collect { notification ->
                    println("Notification: ${notification.message}")
                }
        }

        // Fetch data with pipelining
        val todos = api.todos.list()
        println("Found ${todos.size} todos")

        // Single round-trip pipeline!
        val authorName: String = api.todos["123"]
            .author
            .name
            .await()
        println("Author: $authorName")

        // Error handling
        try {
            val todo = api.todos["nonexistent"].get()
        } catch (e: RpcError) {
            when (e) {
                is RpcError.NotFound -> println("Todo not found")
                else -> throw e
            }
        }

        // Create new todo
        val newTodo = api.todos.create("Learn Cap'n Web")
        println("Created: ${newTodo.title}")

        // Complete it
        api.todos[newTodo.id].complete()
        println("Completed!")
    }
}
```

---

## Design Rationale

### Why Suspend Functions Everywhere?

Kotlin coroutines are the idiomatic way to handle async operations. By making all RPC calls suspend functions:

- They integrate seamlessly with `async`/`await` patterns
- Structured concurrency prevents resource leaks
- Cancellation propagates automatically
- No callback hell or `CompletableFuture` boilerplate

### Why DSL Builders?

Kotlin's receiver lambdas enable type-safe builders that:

- Provide IDE autocomplete for configuration options
- Prevent invalid configurations at compile time
- Feel natural to Kotlin developers (Ktor, Gradle, kotlinx.html)
- Allow hierarchical configuration without verbose builder classes

### Why Natural Pipelining?

Cap'n Web's killer feature is pipelining. By making it invisible:

- Developers write code that looks like normal property access
- The library optimizes behind the scenes
- No need to think about network round-trips
- Performance improvements without code changes

### Why Sealed Errors?

Kotlin's `when` expressions with sealed classes:

- Force handling of all error cases (compiler-checked)
- Enable IDE quickfixes to add missing branches
- Provide type-safe access to error-specific data
- Make error handling explicit and documented

### Why Optional Type Safety?

Not every project needs codegen. By supporting both patterns:

- Quick prototyping with dynamic stubs
- Production safety with typed interfaces
- Gradual migration path as APIs stabilize
- Flexibility for different team preferences

---

*This API design combines the best of Kotlin's features to create a Cap'n Web client that feels native, is type-safe when you need it, and performant by default.*
