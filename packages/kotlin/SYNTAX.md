# Cap'n Web Kotlin Client Library - Syntax Exploration

This document explores divergent syntax approaches for the Kotlin client library (`com.dotdo:capnweb`),
targeting Kotlin 1.9+ with full coroutine support. Cap'n Web is a bidirectional capability-based RPC
protocol over JSON supporting stubs, pipelining, targets, and multiple transports.

---

## What Makes Kotlin Unique

Kotlin brings powerful features that can make Cap'n Web feel native:

- **Coroutines & suspend functions**: First-class async/await with structured concurrency
- **Extension functions**: Add methods to existing types without inheritance
- **DSL builders with receivers**: Create fluent, type-safe domain-specific languages
- **Sealed classes & when expressions**: Exhaustive pattern matching on error types
- **Null safety**: Distinguish nullable from non-null at the type level
- **Multiplatform (KMP)**: Single codebase for JVM, JS (browser/Node), and Native
- **Operator overloading**: Natural syntax for property access and invocation
- **Inline functions & reified generics**: Zero-cost abstractions with type preservation
- **Property delegation**: Lazy initialization, observable properties

The challenge: Balance Kotlin's expressiveness with Cap'n Web's dynamic nature where stubs
can represent any remote object.

---

## Approach 1: Coroutine-First with DSL Builders

Inspired by [Ktor Client](https://ktor.io/docs/client.html) and
[kotlinx.html](https://github.com/Kotlin/kotlinx.html). Uses suspend functions throughout
with DSL builders for configuration and pipelining.

### Philosophy
- **Suspend everywhere**: All RPC operations are suspend functions
- **DSL for configuration**: Type-safe builders with receiver lambdas
- **Operator overloading**: Natural property and method access on stubs
- **Structured concurrency**: Leverage `coroutineScope` and supervisors

### Connection/Session Creation

```kotlin
import com.dotdo.capnweb.*

// DSL-style session configuration
val session = CapnWeb {
    url("wss://api.example.com/rpc")
    transport(Transport.WebSocket)

    authentication {
        apiKey(System.getenv("API_KEY"))
    }

    timeout(30.seconds)

    reconnect {
        maxAttempts = 5
        backoff = ExponentialBackoff(initial = 1.seconds)
    }
}

// Use with structured concurrency
session.use { api ->
    val users = api.users.list().await()
    users.forEach { println(it.name) }
}

// Or simpler one-liner
val api = CapnWeb.connect("wss://api.example.com")
```

### Interface Definition (Optional for Type Safety)

```kotlin
// Define your API as an interface for IDE support
@RpcInterface
interface TodoApi {
    val todos: TodoService
    val users: UserService
}

@RpcInterface
interface TodoService {
    suspend fun list(category: String? = null): List<Todo>
    suspend fun get(id: String): Todo
    suspend fun create(title: String, category: String = "default"): Todo

    // Nested capability
    fun comments(todoId: String): CommentService
}

// Or use fully dynamic stubs (no interface needed)
val todos = api["todos"]  // Dynamic property access
val todo = todos.call("get", "123").await<Todo>()
```

### Making RPC Calls

```kotlin
// With typed interface
val api: RpcStub<TodoApi> = session.stub()
val todos: List<Todo> = api.todos.list()  // Suspend call, returns directly
val todo: Todo = api.todos.get("123")

// With dynamic stubs
val api = session.stub()
val todos: List<Todo> = api.todos.list().await()
val todo: Todo = api.todos["123"].await()

// Parallel calls with structured concurrency
coroutineScope {
    val todosDeferred = async { api.todos.list() }
    val usersDeferred = async { api.users.current() }

    val (todos, user) = todosDeferred.await() to usersDeferred.await()
}
```

### Pipelining Syntax

```kotlin
// The key innovation: pipelining looks like normal chaining!
// RpcPromise<T> has extension functions for each T's methods

// Method 1: Implicit pipelining with property/method chaining
val authorName: String = api.todos.get("123")  // RpcPromise<Todo>
    .author                                     // RpcPromise<User> (pipelined!)
    .profile                                    // RpcPromise<Profile>
    .name                                       // RpcPromise<String>
    .await()                                    // Single round-trip for all 4 calls!

// Method 2: DSL builder for complex pipelines
val result = pipeline(api) {
    val todo = todos.get("123")         // Captured as pipeline step
    val author = todo.author            // Pipelined
    val comments = todos.comments(todo.id)

    // Return multiple values
    PipelineResult(author.name, comments.count())
}.await()

// Method 3: The `then` operator for explicit chaining
val authorName = api.todos.get("123")
    .then { it.author }
    .then { it.profile.name }
    .await()
```

### Error Handling

```kotlin
// Sealed class hierarchy for exhaustive when expressions
sealed class RpcError : Exception() {
    data class NotFound(val resource: String) : RpcError()
    data class PermissionDenied(val reason: String) : RpcError()
    data class ValidationError(val field: String, val message: String) : RpcError()
    data class NetworkError(override val cause: Throwable) : RpcError()
    data class Timeout(val duration: Duration) : RpcError()
    data class RemoteException(val type: String, val message: String, val stack: String?) : RpcError()
}

// Exhaustive pattern matching
suspend fun safeFetch(api: RpcStub<TodoApi>, id: String): Todo? {
    return try {
        api.todos.get(id)
    } catch (e: RpcError) {
        when (e) {
            is RpcError.NotFound -> {
                logger.info("Todo $id not found")
                null
            }
            is RpcError.PermissionDenied -> {
                logger.warn("Access denied: ${e.reason}")
                throw SecurityException(e.reason)
            }
            is RpcError.NetworkError -> {
                logger.error("Network error", e.cause)
                throw e  // Rethrow network errors
            }
            // Compiler ensures all cases are handled
            else -> throw e
        }
    }
}

// Result-based alternative (no exceptions)
val result: RpcResult<Todo> = api.todos.get("123").toResult()

when (result) {
    is RpcResult.Success -> println("Found: ${result.value.title}")
    is RpcResult.Failure -> println("Error: ${result.error}")
}
```

### Exposing Local Objects as RPC Targets

```kotlin
// Annotation-based targets
@RpcTarget
class LocalTodoService(private val db: Database) : TodoService {

    override suspend fun list(category: String?): List<Todo> {
        return db.query("SELECT * FROM todos WHERE category = ?", category)
    }

    override suspend fun get(id: String): Todo {
        return db.findById(id) ?: throw RpcError.NotFound(id)
    }

    override suspend fun create(title: String, category: String): Todo {
        val todo = Todo(UUID.randomUUID().toString(), title, category)
        db.insert(todo)
        return todo
    }

    override fun comments(todoId: String): CommentService {
        // Return a capability - becomes a stub on the remote side
        return LocalCommentService(db, todoId)
    }
}

// Export to session
session.export("todos", LocalTodoService(db))

// Or inline lambda targets for simple cases
session.export("echo") { message: String -> message }

session.export("calculator") {
    method("add") { a: Int, b: Int -> a + b }
    method("multiply") { a: Int, b: Int -> a * b }
}
```

### Pros
- Suspend functions integrate perfectly with Kotlin coroutines
- DSL builders feel very Kotlin-native
- Operator overloading enables natural syntax
- Structured concurrency prevents resource leaks

### Cons
- Heavy use of DSLs may have learning curve
- Dynamic stubs sacrifice some type safety
- Extension functions on `RpcPromise<T>` require code generation

---

## Approach 2: Flow-Based Reactive Streams

Inspired by [kotlinx.coroutines Flow](https://kotlinlang.org/docs/flow.html) and
reactive programming patterns. Treats RPC results as cold flows.

### Philosophy
- **Everything is a Flow**: RPC calls return `Flow<T>` for uniform handling
- **Backpressure built-in**: Flow's suspension handles slow consumers
- **Composable operators**: map, filter, flatMap work on RPC results
- **Cold by default**: Calls aren't made until collected

### Connection/Session Creation

```kotlin
import com.dotdo.capnweb.*
import kotlinx.coroutines.flow.*

// Session is a Flow factory
val session = CapnWebSession.connect("wss://api.example.com")

// Session lifecycle as a Flow
session.connectionState.collect { state ->
    when (state) {
        is ConnectionState.Connected -> println("Connected!")
        is ConnectionState.Disconnected -> println("Disconnected: ${state.reason}")
        is ConnectionState.Reconnecting -> println("Reconnecting...")
    }
}
```

### Making RPC Calls

```kotlin
// Single-value calls return Flow<T>
val todoFlow: Flow<Todo> = api.todos.get("123")

// Collect to execute and get result
val todo = todoFlow.single()

// Or use first() for nullable results
val maybeTodo = api.todos.find("123").firstOrNull()

// List results are also flows (streaming-ready)
api.todos.list()
    .filter { it.isUrgent }
    .map { it.title }
    .collect { println("Urgent: $it") }
```

### Pipelining with Flow Operators

```kotlin
// Pipelining is just flatMap!
val authorName: String = api.todos.get("123")       // Flow<Todo>
    .flatMapConcat { todo ->
        todo.author                                   // Flow<User>
    }
    .flatMapConcat { user ->
        user.profile.name                             // Flow<String>
    }
    .single()

// Custom operator for cleaner syntax
val authorName = api.todos.get("123")
    .pipeline { it.author }
    .pipeline { it.profile.name }
    .single()

// Parallel pipelines with combine
val (profile, friends) = combine(
    api.auth.login(token).pipeline { it.profile },
    api.auth.login(token).pipeline { it.friends }
) { p, f -> p to f }.single()
```

### Streaming and Subscriptions

```kotlin
// Server-side streaming as Flow
val notifications: Flow<Notification> = api.notifications.subscribe()

notifications
    .onEach { showToast(it.message) }
    .catch { e -> logger.error("Stream error", e) }
    .launchIn(lifecycleScope)

// Bidirectional streaming
val chat: Flow<Message> = api.chat.connect(
    outgoing = messageFlow  // Flow<String> of messages to send
)

chat.collect { message ->
    displayMessage(message)
}
```

### Error Handling

```kotlin
// Flow operators for error handling
val result = api.todos.get("123")
    .catch { e ->
        when (e) {
            is RpcError.NotFound -> emit(Todo.empty())
            else -> throw e
        }
    }
    .retry(3) { e -> e is RpcError.NetworkError }
    .single()

// Or map to Result
val resultFlow: Flow<Result<Todo>> = api.todos.get("123")
    .map { Result.success(it) }
    .catch { emit(Result.failure(it)) }
```

### Exposing Local Objects as RPC Targets

```kotlin
// Flow-based targets for streaming
@RpcTarget
class NotificationService {

    private val _notifications = MutableSharedFlow<Notification>()

    // Exposed as streaming endpoint
    fun subscribe(): Flow<Notification> = _notifications.asSharedFlow()

    // Internal: emit notifications
    suspend fun emit(notification: Notification) {
        _notifications.emit(notification)
    }
}

// Callback targets receive Flow parameters
@RpcTarget
class ChatService {
    suspend fun connect(incoming: Flow<String>): Flow<Message> {
        return incoming
            .map { parseMessage(it) }
            .onEach { saveToDb(it) }
            .map { formatForClient(it) }
    }
}
```

### Pros
- Native integration with kotlinx.coroutines Flow
- Excellent for streaming/real-time use cases
- Backpressure handling built-in
- Composable with standard Flow operators

### Cons
- Verbose for simple request-response calls
- Flow's cold nature may be confusing
- Pipelining less intuitive than method chaining
- `.single()` everywhere adds noise

---

## Approach 3: Extension Functions on Sealed Stubs

Inspired by [Arrow-kt](https://arrow-kt.io/) and functional Kotlin patterns.
Uses sealed class hierarchies with extension functions for type-safe stubs.

### Philosophy
- **Sealed hierarchy for stubs**: Each API level is a sealed class
- **Extension functions**: Add capabilities without modifying sealed classes
- **Inline + reified**: Zero-cost type-safe deserialization
- **Either/Result**: Functional error handling

### Connection/Session Creation

```kotlin
import com.dotdo.capnweb.*
import arrow.core.Either

// Type-safe connection returning a typed root
suspend inline fun <reified T : RpcRoot> CapnWeb.connect(url: String): T {
    val session = Session.connect(url)
    return session.root()
}

// Usage
val api: MyApi = CapnWeb.connect("wss://api.example.com")

// Or with explicit type parameter
val api = CapnWeb.connect<MyApi>("wss://api.example.com")
```

### Sealed Class API Definition

```kotlin
// Define your API as a sealed hierarchy
@RpcRoot
sealed interface MyApi : RpcStub {

    val todos: TodoStub
    val users: UserStub

    suspend fun authenticate(token: String): AuthenticatedApi
}

sealed interface TodoStub : RpcStub {
    suspend fun list(category: String? = null): List<Todo>
    suspend fun get(id: String): Todo
    suspend fun create(title: String): Todo

    // Navigation to nested stubs
    operator fun get(id: String): SingleTodoStub
}

sealed interface SingleTodoStub : RpcStub {
    val author: UserStub
    val comments: CommentsStub

    suspend fun update(changes: TodoPatch): Todo
    suspend fun delete()
}

// Compiler generates stub implementations via KSP
// Each sealed interface gets a generated Impl class
```

### Making RPC Calls

```kotlin
// Fully typed with IDE support
val api: MyApi = session.root()

val todos: List<Todo> = api.todos.list()
val todo: Todo = api.todos.get("123")

// Navigation via operators
val author: User = api.todos["123"].author.get()

// Suspend call with default parameters
val filteredTodos = api.todos.list(category = "work")
```

### Pipelining with Continuation Passing

```kotlin
// Extension function for pipelining
inline fun <T, R> RpcPromise<T>.pipe(
    crossinline block: T.() -> RpcPromise<R>
): RpcPromise<R> = PipelinedPromise(this, block)

// Usage - each .pipe() adds to the pipeline
val authorName: String = api.todos.get("123")
    .pipe { author }             // Through Todo to User
    .pipe { profile }            // Through User to Profile
    .pipe { name }               // Through Profile to String
    .await()                     // Single round trip!

// Alternatively, use a context receiver (Kotlin 1.9+)
context(PipelineContext)
suspend fun getAuthorName(api: MyApi, todoId: String): String {
    val todo = api.todos.get(todoId)    // Captured
    val author = todo.author            // Pipelined
    val name = author.profile.name      // Pipelined
    return name.await()                 // Executes pipeline
}

// Execute within pipeline context
val name = pipeline { getAuthorName(api, "123") }
```

### Error Handling with Either

```kotlin
import arrow.core.*

// Methods can return Either for explicit error handling
suspend fun TodoStub.getOrNone(id: String): Option<Todo> =
    Either.catch { get(id) }.getOrNone()

suspend fun TodoStub.getSafe(id: String): Either<RpcError, Todo> =
    Either.catch { get(id) }.mapLeft { it as RpcError }

// Pattern matching with when
val result = api.todos.getSafe("123")

result.fold(
    ifLeft = { error ->
        when (error) {
            is RpcError.NotFound -> "Not found"
            is RpcError.PermissionDenied -> "Access denied: ${error.reason}"
            else -> "Unknown error"
        }
    },
    ifRight = { todo ->
        "Found: ${todo.title}"
    }
)

// Monad comprehension with arrow
val userProfile = either {
    val todo = api.todos.getSafe("123").bind()
    val author = todo.author.getSafe().bind()
    author.profile.bind()
}
```

### Exposing Local Objects as RPC Targets

```kotlin
// Implement sealed interfaces
class LocalTodoStub(
    private val session: Session,
    private val db: Database
) : TodoStub {

    override suspend fun list(category: String?): List<Todo> =
        db.todos.filter { category == null || it.category == category }

    override suspend fun get(id: String): Todo =
        db.todos.find { it.id == id }
            ?: throw RpcError.NotFound("todo/$id")

    override suspend fun create(title: String): Todo {
        val todo = Todo(id = UUID.randomUUID().toString(), title = title)
        db.todos.add(todo)
        return todo
    }

    override operator fun get(id: String): SingleTodoStub =
        LocalSingleTodoStub(session, db, id)
}

// Export at session level
session.export(LocalTodoStub(session, db))
```

### Pros
- Maximum type safety with sealed classes
- IDE support is excellent (autocomplete, refactoring)
- Arrow-kt integration for functional patterns
- Extension functions add capabilities cleanly

### Cons
- Requires code generation (KSP) for stub implementations
- Sealed classes are verbose to define
- Less flexible for truly dynamic APIs
- Arrow-kt dependency may not suit all projects

---

## Approach 4: Multiplatform-First with expect/actual

Designed from the ground up for Kotlin Multiplatform (KMP). Uses expect/actual
declarations for platform-specific transports while sharing the API surface.

### Philosophy
- **Share everything possible**: Business logic, API definitions, serialization
- **Platform-optimal transports**: OkHttp on JVM, fetch on JS, URLSession on iOS
- **Kotlin/Native friendly**: No reflection, minimal allocations
- **expect/actual for platform bits**: Clean separation

### Connection/Session Creation

```kotlin
// Common code (shared)
expect class PlatformSession {
    suspend fun connect(url: String): RpcSession
}

// Usage in common
val session = PlatformSession().connect("wss://api.example.com")

// JVM implementation
actual class PlatformSession {
    actual suspend fun connect(url: String): RpcSession {
        val client = OkHttpClient.Builder()
            .pingInterval(30.seconds.toJavaDuration())
            .build()
        return JvmWebSocketSession(client, url)
    }
}

// JS implementation
actual class PlatformSession {
    actual suspend fun connect(url: String): RpcSession {
        return JsWebSocketSession(WebSocket(url))
    }
}

// Native (iOS) implementation
actual class PlatformSession {
    actual suspend fun connect(url: String): RpcSession {
        val task = URLSession.shared.webSocketTaskWithURL(NSURL(string = url)!!)
        return NativeWebSocketSession(task)
    }
}
```

### Multiplatform Stub Definition

```kotlin
// Shared API definition using @Serializable for data classes
@Serializable
data class Todo(
    val id: String,
    val title: String,
    val completed: Boolean = false,
    val category: String = "default"
)

// Interface-free dynamic stubs (reflection-free)
class RpcStub(
    private val session: RpcSession,
    private val path: List<String> = emptyList()
) {
    // Property access creates child stubs
    operator fun get(name: String): RpcStub =
        RpcStub(session, path + name)

    // Method invocation
    suspend inline fun <reified T> call(
        method: String,
        vararg args: Any?
    ): T = session.invoke(path, method, args.toList())

    // Await a promise stub
    suspend inline fun <reified T> await(): T =
        session.resolve(path)
}

// Type-safe wrappers via extension functions
val RpcStub.todos: RpcStub get() = this["todos"]

suspend fun RpcStub.getTodo(id: String): Todo =
    todos.call("get", id)

suspend fun RpcStub.listTodos(): List<Todo> =
    todos.call("list")
```

### Making RPC Calls

```kotlin
// Works the same on all platforms!
suspend fun fetchTodos(): List<Todo> {
    val session = PlatformSession().connect("wss://api.example.com")

    // Dynamic access
    val todos: List<Todo> = session.stub.todos.call("list")

    // Or with extension functions
    val todos2 = session.stub.listTodos()

    return todos
}

// Platform-specific UI integration
// Android
@Composable
fun TodoList() {
    val todos by produceState(emptyList<Todo>()) {
        value = fetchTodos()
    }
    LazyColumn {
        items(todos) { TodoRow(it) }
    }
}

// iOS (via Kotlin/Native)
class TodoViewModel : ObservableObject {
    @Published var todos: [Todo] = []

    func load() {
        Task { @MainActor in
            todos = try await fetchTodos()
        }
    }
}
```

### Pipelining (Platform-Agnostic)

```kotlin
// Pipeline builder in common code
class Pipeline(private val session: RpcSession) {
    private val steps = mutableListOf<PipelineStep>()

    fun get(path: String): Pipeline {
        steps.add(PipelineStep.Get(path))
        return this
    }

    fun call(method: String, vararg args: Any?): Pipeline {
        steps.add(PipelineStep.Call(method, args.toList()))
        return this
    }

    suspend inline fun <reified T> execute(): T =
        session.executePipeline(steps)
}

// Extension for building pipelines
fun RpcStub.pipeline(): Pipeline = Pipeline(session)

// Usage
val authorName: String = session.stub
    .pipeline()
    .get("todos")
    .call("get", "123")
    .get("author")
    .get("profile")
    .get("name")
    .execute()
```

### Error Handling

```kotlin
// Common error types
sealed class RpcError : Exception() {
    data class NotFound(val resource: String) : RpcError()
    data class PermissionDenied(val reason: String) : RpcError()
    data class NetworkError(val platformError: Any) : RpcError()
    data object Timeout : RpcError()
}

// Platform-specific error mapping
expect fun Throwable.toRpcError(): RpcError

// JVM
actual fun Throwable.toRpcError(): RpcError = when (this) {
    is java.net.SocketTimeoutException -> RpcError.Timeout
    is java.io.IOException -> RpcError.NetworkError(this)
    else -> RpcError.NetworkError(this)
}

// JS
actual fun Throwable.toRpcError(): RpcError = when {
    message?.contains("timeout") == true -> RpcError.Timeout
    else -> RpcError.NetworkError(this)
}

// Usage (common code)
suspend fun safeFetch(id: String): Result<Todo> = runCatching {
    session.stub.getTodo(id)
}.recoverCatching { e ->
    throw e.toRpcError()
}
```

### Exposing Local Objects as RPC Targets

```kotlin
// Common interface for targets
interface RpcTarget {
    suspend fun invoke(method: String, args: List<Any?>): Any?
}

// Reflection-free implementation using a dispatch map
class LocalTodoService(private val db: Database) : RpcTarget {

    private val methods = mapOf<String, suspend (List<Any?>) -> Any?>(
        "list" to { args -> list(args.getOrNull(0) as? String) },
        "get" to { args -> get(args[0] as String) },
        "create" to { args -> create(args[0] as String) },
    )

    override suspend fun invoke(method: String, args: List<Any?>): Any? =
        methods[method]?.invoke(args)
            ?: throw RpcError.NotFound("method/$method")

    private suspend fun list(category: String?): List<Todo> = db.query(category)
    private suspend fun get(id: String): Todo = db.findById(id)!!
    private suspend fun create(title: String): Todo = db.insert(Todo(title = title))
}

// Or with code generation (KSP) for less boilerplate
@RpcTarget
class LocalTodoService(private val db: Database) {
    @RpcMethod
    suspend fun list(category: String? = null): List<Todo> = db.query(category)

    @RpcMethod
    suspend fun get(id: String): Todo = db.findById(id)!!
}
```

### Pros
- True multiplatform support (JVM, JS, Native)
- No reflection needed (works on iOS)
- Optimal transport per platform
- Shared business logic

### Cons
- More boilerplate for platform-specific code
- Dynamic stubs are less type-safe
- KSP doesn't work on all platforms equally
- Testing across platforms is complex

---

## Comparison Matrix

| Feature | Approach 1 (DSL) | Approach 2 (Flow) | Approach 3 (Sealed) | Approach 4 (KMP) |
|---------|------------------|-------------------|---------------------|------------------|
| **Type Safety** | Medium (optional interfaces) | Medium | High (sealed classes) | Low-Medium |
| **Pipelining** | Natural chaining | Flow operators | Extension functions | Builder pattern |
| **IDE Support** | Good | Excellent | Excellent | Limited |
| **Learning Curve** | Medium | Medium | High | Low |
| **Multiplatform** | JVM focus | JVM focus | JVM focus | Native KMP |
| **Streaming** | Manual | Native Flow | Manual | Manual |
| **Error Handling** | Sealed exceptions | Flow catch | Either/Arrow | Result + sealed |
| **Code Generation** | Optional | None | Required (KSP) | Optional |
| **Framework Weight** | Medium | Medium | Heavy (Arrow) | Light |

---

## Recommendations

### For Android/JVM Applications
**Approach 1 (DSL-First)** - Kotlin developers expect coroutines and DSL builders.
The syntax feels native and integrates well with Android's lifecycle.

### For Reactive/Streaming Use Cases
**Approach 2 (Flow-Based)** - When your app heavily uses Flow already, or you need
streaming/subscription support, this approach is most natural.

### For Large Codebases with Strict Contracts
**Approach 3 (Sealed Classes)** - Maximum type safety with exhaustive error handling.
Best when you have well-defined API contracts and want compiler enforcement.

### For Multiplatform Projects
**Approach 4 (KMP-First)** - If you're targeting iOS, web, and Android from one
codebase, start here. Sacrifice some type safety for portability.

---

## Hybrid Recommendation

The ideal `com.dotdo:capnweb` library would combine elements:

```kotlin
import com.dotdo.capnweb.*

// 1. DSL-style configuration (Approach 1)
val session = CapnWeb {
    url("wss://api.example.com")
    timeout(30.seconds)
}

// 2. Optional typed interfaces (Approach 1 + 3)
@RpcInterface
interface TodoApi {
    suspend fun list(): List<Todo>
    suspend fun get(id: String): Todo
    fun byId(id: String): SingleTodoApi  // Returns capability
}

@RpcInterface
interface SingleTodoApi {
    val author: UserApi
    suspend fun update(changes: TodoPatch): Todo
}

// 3. Pipelining that feels natural (Approach 1)
val authorName: String = session.stub<TodoApi>()
    .byId("123")        // Returns RpcPromise<SingleTodoApi>
    .author             // Pipelines to RpcPromise<UserApi>
    .name               // Pipelines to RpcPromise<String>
    .await()            // Single round trip!

// 4. Flow integration for streaming (Approach 2)
val notifications: Flow<Notification> = session.stub<NotificationApi>()
    .subscribe()
    .asFlow()

// 5. Sealed errors with exhaustive handling (Approach 3)
when (val result = session.stub<TodoApi>().get("123").toResult()) {
    is RpcResult.Success -> println(result.value.title)
    is RpcResult.Failure -> when (result.error) {
        is RpcError.NotFound -> println("Not found")
        is RpcError.NetworkError -> retry()
        // Compiler ensures all cases handled
    }
}

// 6. Local targets with annotation processing
@RpcTarget
class LocalTodoService : TodoApi {
    override suspend fun list(): List<Todo> = db.allTodos()
    override suspend fun get(id: String): Todo = db.findTodo(id)
    override fun byId(id: String): SingleTodoApi = LocalSingleTodoApi(id)
}

session.export(LocalTodoService())
```

---

## Implementation Notes

### Maven Coordinates

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.dotdo:capnweb:1.0.0")

    // Optional: KSP processor for typed stubs
    ksp("com.dotdo:capnweb-ksp:1.0.0")

    // Optional: Arrow integration
    implementation("com.dotdo:capnweb-arrow:1.0.0")

    // Optional: Flow extensions
    implementation("com.dotdo:capnweb-flow:1.0.0")
}

// For multiplatform
kotlin {
    sourceSets {
        commonMain {
            dependencies {
                implementation("com.dotdo:capnweb-core:1.0.0")
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
    }
}
```

### Key Types

```kotlin
// Core types
interface RpcSession : Closeable {
    suspend fun <T> stub(): RpcStub<T>
    suspend fun <T : RpcTarget> export(target: T)
    val connectionState: StateFlow<ConnectionState>
}

class RpcStub<T>(
    internal val session: RpcSession,
    internal val path: PropertyPath
) {
    suspend inline fun <reified R> call(method: String, vararg args: Any?): R
    operator fun get(property: String): RpcStub<Any?>
}

class RpcPromise<T>(
    internal val session: RpcSession,
    internal val expression: Expression
) {
    suspend fun await(): T
    fun <R> then(transform: (T) -> RpcPromise<R>): RpcPromise<R>
}

// Error types
sealed class RpcError : Exception() {
    data class NotFound(val resource: String) : RpcError()
    data class PermissionDenied(val reason: String) : RpcError()
    data class ValidationError(val details: Map<String, String>) : RpcError()
    data class RemoteException(
        val errorType: String,
        override val message: String,
        val remoteStack: String?
    ) : RpcError()
    data class NetworkError(override val cause: Throwable) : RpcError()
    data object Timeout : RpcError()
    data object Disconnected : RpcError()
}

// Result wrapper
sealed class RpcResult<out T> {
    data class Success<T>(val value: T) : RpcResult<T>()
    data class Failure(val error: RpcError) : RpcResult<Nothing>()
}
```

### Transport Abstraction

```kotlin
// Transport interface for custom implementations
interface RpcTransport {
    suspend fun send(message: RpcMessage)
    fun receive(): Flow<RpcMessage>
    suspend fun close()

    val isConnected: StateFlow<Boolean>
}

// Built-in transports
class WebSocketTransport(url: String, config: WebSocketConfig = WebSocketConfig()) : RpcTransport
class HttpBatchTransport(url: String, config: HttpConfig = HttpConfig()) : RpcTransport

// For testing
class InMemoryTransport : RpcTransport
```

### JSON Serialization

```kotlin
// Uses kotlinx.serialization for cross-platform JSON
@Serializable
sealed class Expression {
    @Serializable
    @SerialName("import")
    data class Import(
        val importId: Int,
        val propertyPath: List<String>? = null,
        val callArguments: List<JsonElement>? = null
    ) : Expression()

    @Serializable
    @SerialName("export")
    data class Export(val exportId: Int) : Expression()

    @Serializable
    @SerialName("pipeline")
    data class Pipeline(
        val importId: Int,
        val propertyPath: List<String>,
        val callArguments: List<JsonElement>? = null
    ) : Expression()

    // ... other expression types
}
```

---

## Open Questions

1. **Operator overloading limits**: Kotlin doesn't allow `operator fun invoke()` to be
   suspend. Should we use `call()` instead, or find a workaround?

2. **KSP vs KCP**: Should code generation use KSP (simpler) or Kotlin Compiler Plugin
   (more powerful)? KSP doesn't support all platforms equally.

3. **Flow integration depth**: Should RPC stubs implement `Flow<T>` directly, or just
   provide conversion functions?

4. **Context receivers**: Kotlin 1.9's context receivers could simplify pipelining.
   Should we require 1.9+?

5. **JS target**: Browser WebSocket vs Node.js WebSocket have different APIs.
   How to abstract cleanly?

---

## Next Steps

1. Implement core types (RpcSession, RpcStub, RpcPromise) in common code
2. Build WebSocket transport for JVM first
3. Add KSP processor for @RpcInterface and @RpcTarget
4. Port transport to JS (browser) and Native (iOS)
5. Write comprehensive test suite with mock server
6. Publish to Maven Central as `com.dotdo:capnweb`
