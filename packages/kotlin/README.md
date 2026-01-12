# Cap'n Web for Kotlin

[![Maven Central](https://img.shields.io/maven-central/v/com.dotdo/capnweb.svg?label=Maven%20Central)](https://search.maven.org/artifact/com.dotdo/capnweb)
[![Kotlin](https://img.shields.io/badge/kotlin-1.9%2B-blue.svg)](https://kotlinlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Bidirectional capability-based RPC that feels like native Kotlin.**

```kotlin
val api = CapnWeb("wss://api.example.com")

// Pipelining: four calls, one round-trip
val authorName = api.todos["123"].author.profile.name.await()

// It just works.
```

Cap'n Web brings capability-based security and promise pipelining to Kotlin with an API designed around coroutines, DSL builders, and sealed classes. Write RPC code that looks like local method calls, and let the library optimize the network for you.

**Key differentiators:**
- **Promise Pipelining** - Chain calls that execute in a single round-trip
- **Capability Security** - Fine-grained access control through object references
- **Coroutine-Native** - Built on structured concurrency from the ground up
- **Kotlin DSL** - Type-safe builders for configuration and API definition
- **Multiplatform** - JVM, Android, JS, and Native from shared code

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Understanding Suspend vs Await](#understanding-suspend-vs-await)
- [Pipelining Deep Dive](#pipelining-deep-dive)
- [Connection Configuration](#connection-configuration)
- [Typed Interfaces](#typed-interfaces)
- [Error Handling](#error-handling)
- [Exposing Local Targets](#exposing-local-targets)
- [Streaming with Flow](#streaming-with-flow)
- [Android Integration](#android-integration)
- [Workflow Patterns](#workflow-patterns)
- [Framework Integration](#framework-integration)
- [Testing](#testing)
- [Security Considerations](#security-considerations)
- [Multiplatform Setup](#multiplatform-setup)
- [Protocol Reference](#protocol-reference)

---

## Installation

### Gradle (Kotlin DSL)

```kotlin
plugins {
    kotlin("jvm") version "1.9.20"
    kotlin("plugin.serialization") version "1.9.20"
    id("com.google.devtools.ksp") version "1.9.20-1.0.14" // Optional: typed stubs
}

dependencies {
    implementation("com.dotdo:capnweb:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")

    // Optional: KSP processor for @RpcInterface
    ksp("com.dotdo:capnweb-ksp:1.0.0")
}
```

### Android

```kotlin
plugins {
    id("com.android.application") // or library
    kotlin("android")
    kotlin("plugin.serialization") version "1.9.20"
    id("com.google.devtools.ksp") version "1.9.20-1.0.14"
}

dependencies {
    implementation("com.dotdo:capnweb-android:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")

    ksp("com.dotdo:capnweb-ksp:1.0.0")
}
```

### Maven

```xml
<dependencies>
    <dependency>
        <groupId>com.dotdo</groupId>
        <artifactId>capnweb</artifactId>
        <version>1.0.0</version>
    </dependency>
    <dependency>
        <groupId>org.jetbrains.kotlinx</groupId>
        <artifactId>kotlinx-serialization-json</artifactId>
        <version>1.6.0</version>
    </dependency>
    <dependency>
        <groupId>org.jetbrains.kotlinx</groupId>
        <artifactId>kotlinx-coroutines-core</artifactId>
        <version>1.7.3</version>
    </dependency>
</dependencies>
```

---

## Quick Start

```kotlin
import com.dotdo.capnweb.*
import kotlinx.serialization.Serializable

@Serializable
data class Todo(val id: String, val title: String, val completed: Boolean)

suspend fun main() {
    // Connect
    val api = CapnWeb("wss://api.example.com")

    // Make calls - suspend functions return values directly
    val todos: List<Todo> = api.todos.list()
    val todo: Todo = api.todos.get("123")

    // Pipeline through capabilities - use .await() for pipelined chains
    val authorName: String = api.todos["123"].author.profile.name.await()

    // Clean up
    api.close()
}
```

---

## Understanding Suspend vs Await

**This is the most important concept to understand.** Cap'n Web has two ways to execute RPC calls, and knowing when to use each is essential.

### Rule of Thumb

| Scenario | What to Use | Returns |
|----------|-------------|---------|
| Direct method call | `suspend fun` | `T` directly |
| Property access chain | `.await()` | `T` after awaiting |
| Need to pipeline | Chain + `.await()` | `T` after single round-trip |

### Direct Method Calls: Implicit Suspend

When you call a method directly on a stub, it's a **suspend function** that returns the value:

```kotlin
// These are suspend functions - they return T directly
val todos: List<Todo> = api.todos.list()           // Returns List<Todo>
val todo: Todo = api.todos.get("123")              // Returns Todo
val user: User = api.users.current()               // Returns User
```

The call executes immediately when the suspend function resumes. No `.await()` needed.

### Property Chains: Explicit Await

When you access properties or chain calls for pipelining, you get an `RpcPromise<T>`:

```kotlin
// Property access returns RpcPromise<T>
val todoPromise: RpcPromise<Todo> = api.todos["123"]
val authorPromise: RpcPromise<User> = todoPromise.author
val namePromise: RpcPromise<String> = authorPromise.profile.name

// Call .await() to execute the pipeline
val name: String = namePromise.await()
```

### Why Two Patterns?

**Pipelining** is the reason. When you chain property accesses:

```kotlin
// This builds a pipeline - nothing executes yet
val pipeline = api.todos["123"].author.profile.name

// NOW it executes - all four operations in ONE round-trip
val name = pipeline.await()
```

If method calls returned `RpcPromise`, you'd lose the clean syntax:

```kotlin
// Hypothetical (NOT how it works) - awkward!
val todos = api.todos.list().await()  // Every call needs .await()
```

Instead, direct calls are suspend functions for ergonomics, and pipelining uses explicit `.await()`:

```kotlin
// Actual API - clean!
val todos = api.todos.list()                        // Direct call
val name = api.todos["123"].author.name.await()     // Pipelined
```

### The Complete Mental Model

```kotlin
// 1. DIRECT CALL - suspend function, returns T
val todo = api.todos.get("123")  // Type: Todo

// 2. INDEXER - returns RpcPromise<T> for pipelining
val todoRef = api.todos["123"]   // Type: RpcPromise<Todo>

// 3. PROPERTY CHAIN - builds pipeline, returns RpcPromise<T>
val nameRef = api.todos["123"].author.name  // Type: RpcPromise<String>

// 4. AWAIT - executes pipeline, returns T
val name = nameRef.await()       // Type: String

// 5. COMBINING - direct call on pipelined result
val profile = api.todos["123"].author.await().getFullProfile()
//            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Pipeline returns User
//                                             ^^^^^^^^^^^^^^^^^ Direct call on User
```

### Common Patterns

```kotlin
// Pattern 1: Simple fetch
val user = api.users.get(id)  // No await needed

// Pattern 2: Pipeline for nested data
val email = api.users[id].profile.email.await()

// Pattern 3: Execute pipeline, then call method
val author = api.todos[id].author.await()
val posts = author.posts.list()  // Direct call on resolved author

// Pattern 4: Transform in pipeline
val upperName = api.users[id].name.then { it.uppercase() }.await()

// Pattern 5: Parallel independent calls
coroutineScope {
    val todosDeferred = async { api.todos.list() }
    val userDeferred = async { api.users.current() }

    val todos = todosDeferred.await()
    val user = userDeferred.await()
}
```

---

## Pipelining Deep Dive

Promise pipelining is Cap'n Web's killer feature. When you chain property accesses, the library batches them into a single network request.

### How It Works

```kotlin
// This looks like 4 separate operations...
val name = api
    .todos["123"]     // 1. Get todo by ID
    .author           // 2. Get the author
    .profile          // 3. Get their profile
    .name             // 4. Get the name
    .await()          // ...but it's ONE round-trip!
```

Each step returns an `RpcPromise<T>`. The promise doesn't execute until you call `.await()`, and when it does, the entire chain is sent as a single pipelined request.

### The Pipeline DSL

For multiple values from a pipeline:

```kotlin
data class TodoDetails(val author: User, val commentCount: Int)

val details = pipeline(api) {
    val todo = todos["123"]
    val author = todo.author.get()
    val count = todo.comments.count()

    TodoDetails(author, count)
}.await()
```

### Transformations with `.then`

```kotlin
val uppercaseName = api.todos["123"]
    .author
    .profile
    .name
    .then { it.uppercase() }
    .await()
```

### Parallel Execution

Independent calls run in parallel with standard coroutines:

```kotlin
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

## Connection Configuration

### Simple

```kotlin
val api = CapnWeb("wss://api.example.com")
```

### DSL Builder

```kotlin
val api = CapnWeb {
    url("wss://api.example.com")

    transport {
        type = Transport.WebSocket
        pingInterval = 30.seconds
    }

    auth {
        bearer(System.getenv("API_TOKEN"))
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

### With Structured Concurrency

```kotlin
CapnWeb("wss://api.example.com").use { api ->
    val todos = api.todos.list()
    // Session automatically closes when block completes
}
```

---

## Typed Interfaces

For IDE support and compile-time safety, define your API contract with interfaces.

### Defining Interfaces

```kotlin
@RpcInterface
interface TodoApi {
    val todos: TodoService
    val users: UserService
}

@RpcInterface
interface TodoService {
    // Suspend functions for direct calls
    suspend fun list(category: String? = null, limit: Int = 100): List<Todo>
    suspend fun get(id: String): Todo
    suspend fun create(title: String, category: String = "default"): Todo

    // Operator for pipelined access - returns RpcPromise
    operator fun get(id: String): SingleTodoService
}

@RpcInterface
interface SingleTodoService {
    // Nested capabilities for pipelining
    val author: UserService
    val comments: CommentService

    // Methods on the capability
    suspend fun get(): Todo
    suspend fun update(patch: TodoPatch): Todo
    suspend fun delete()
}

@RpcInterface
interface UserService {
    suspend fun get(): User
    suspend fun getProfile(): Profile

    // NOTE: Properties that need network calls must be suspend functions!
    // This WON'T work: val name: String  (properties can't be suspend)
    // Instead use: suspend fun getName(): String
    // Or for pipelining: val profile: ProfileService (returns capability)
}

@RpcInterface
interface ProfileService {
    val name: RpcPromise<String>      // For pipelining
    val email: RpcPromise<String>     // For pipelining
    suspend fun get(): Profile        // Direct fetch
}
```

**Important:** Interface properties that represent network values must either:
1. Return `RpcPromise<T>` for pipelining support
2. Be replaced with `suspend fun getX(): T` for direct calls
3. Return another `@RpcInterface` capability

Properties declared as `val name: String` won't work because properties cannot be suspend functions.

### Using Typed Stubs

```kotlin
val api: TodoApi = session.stub()

val todos = api.todos.list(category = "work")  // IDE knows the signature
val todo = api.todos.get("123")                // Returns Todo, not Any
val author = api.todos["123"].author           // Navigates to UserService
```

---

## Error Handling

### Sealed Error Hierarchy

Cap'n Web uses sealed classes for exhaustive error handling:

```kotlin
sealed class RpcError : Exception() {
    data class NotFound(val resource: String) : RpcError()
    data class ValidationFailed(val errors: Map<String, String>) : RpcError()
    data class PermissionDenied(val action: String, val reason: String) : RpcError()
    data class Unauthorized(val realm: String? = null) : RpcError()
    data class RemoteException(
        val type: String,
        override val message: String,
        val stack: String? = null
    ) : RpcError()
    data class NetworkError(override val cause: Throwable) : RpcError()
    data class Timeout(val operation: String, val duration: Duration) : RpcError()
    data object Disconnected : RpcError()
    data object SessionClosed : RpcError()
}
```

### Exhaustive Handling

The compiler ensures you handle every case:

```kotlin
try {
    val todo = api.todos.get(id)
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
                logger.warn("Validation error: $field - $msg")
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

### Result Type (Exception-Free)

For explicit error handling without exceptions:

```kotlin
val result: RpcResult<Todo> = api.todos.get(id).toResult()

when (result) {
    is RpcResult.Success -> println("Found: ${result.value.title}")
    is RpcResult.Failure -> println("Error: ${result.error}")
}

// Monadic operations
val title: String? = api.todos.get(id)
    .toResult()
    .map { it.title }
    .getOrNull()
```

---

## Exposing Local Targets

Cap'n Web is bidirectional. You can expose local objects that the remote side can call.

### Annotation-Based Targets

```kotlin
@RpcTarget
class LocalTodoService(private val db: Database) : TodoService {

    override suspend fun list(category: String?, limit: Int): List<Todo> {
        return db.todos
            .filter { category == null || it.category == category }
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
        // Returns a capability - becomes a stub on the remote side
        return LocalSingleTodoService(db, id)
    }
}

// Export to session
session.export("todos", LocalTodoService(db))
```

### Lambda Targets

```kotlin
// Single method
session.export("echo") { message: String ->
    message.reversed()
}

// Multiple methods
session.export("math") {
    method("add") { a: Int, b: Int -> a + b }
    method("multiply") { a: Int, b: Int -> a * b }
}
```

### Capability Return Values

When your target returns an object, it becomes a capability the remote side can call:

```kotlin
@RpcTarget
class LocalAuthService : AuthService {

    override suspend fun login(credentials: Credentials): AuthenticatedSession {
        val user = authenticate(credentials)

        // This object becomes a new capability on the remote side
        return LocalAuthenticatedSession(user)
    }
}

@RpcTarget
class LocalAuthenticatedSession(private val user: User) : AuthenticatedSession {

    override suspend fun currentUser(): User = user

    override val todos: TodoService
        get() = LocalTodoService(user.db)

    override suspend fun logout() {
        invalidateSession()
    }
}
```

---

## Streaming with Flow

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
    .launchIn(scope)
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

---

## Android Integration

### ViewModel Integration

Cap'n Web integrates seamlessly with Android ViewModels and structured concurrency:

```kotlin
class TodoViewModel(
    private val api: TodoApi,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    // UI State
    private val _uiState = MutableStateFlow<TodoUiState>(TodoUiState.Loading)
    val uiState: StateFlow<TodoUiState> = _uiState.asStateFlow()

    // Connection state exposed to UI
    val connectionState: StateFlow<ConnectionState> = api.connectionState
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ConnectionState.Connecting)

    init {
        loadTodos()
    }

    fun loadTodos() {
        viewModelScope.launch {
            _uiState.value = TodoUiState.Loading
            try {
                val todos = api.todos.list()
                _uiState.value = TodoUiState.Success(todos)
            } catch (e: RpcError) {
                _uiState.value = TodoUiState.Error(e.toUserMessage())
            }
        }
    }

    fun createTodo(title: String) {
        viewModelScope.launch {
            try {
                val newTodo = api.todos.create(title)
                // Optimistic update
                val current = (_uiState.value as? TodoUiState.Success)?.todos ?: emptyList()
                _uiState.value = TodoUiState.Success(current + newTodo)
            } catch (e: RpcError) {
                _uiState.value = TodoUiState.Error(e.toUserMessage())
            }
        }
    }

    fun completeTodo(id: String) {
        viewModelScope.launch {
            try {
                api.todos[id].complete()
                loadTodos() // Refresh
            } catch (e: RpcError.NotFound) {
                // Todo was already deleted
                loadTodos()
            }
        }
    }
}

sealed interface TodoUiState {
    data object Loading : TodoUiState
    data class Success(val todos: List<Todo>) : TodoUiState
    data class Error(val message: String) : TodoUiState
}

fun RpcError.toUserMessage(): String = when (this) {
    is RpcError.NetworkError -> "Network error. Check your connection."
    is RpcError.Timeout -> "Request timed out. Please try again."
    is RpcError.Unauthorized -> "Please log in again."
    is RpcError.Disconnected -> "Disconnected from server."
    else -> "An error occurred. Please try again."
}
```

### Jetpack Compose Integration

```kotlin
@Composable
fun TodoScreen(
    viewModel: TodoViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val connectionState by viewModel.connectionState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Todos") },
                actions = {
                    ConnectionIndicator(connectionState)
                }
            )
        }
    ) { padding ->
        when (val state = uiState) {
            is TodoUiState.Loading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            is TodoUiState.Success -> {
                TodoList(
                    todos = state.todos,
                    onComplete = viewModel::completeTodo,
                    modifier = Modifier.padding(padding)
                )
            }
            is TodoUiState.Error -> {
                ErrorScreen(
                    message = state.message,
                    onRetry = viewModel::loadTodos,
                    modifier = Modifier.padding(padding)
                )
            }
        }
    }
}

@Composable
fun ConnectionIndicator(state: ConnectionState) {
    val (icon, tint) = when (state) {
        is ConnectionState.Connected -> Icons.Default.Cloud to Color.Green
        is ConnectionState.Connecting,
        is ConnectionState.Reconnecting -> Icons.Default.CloudSync to Color.Yellow
        is ConnectionState.Disconnected,
        is ConnectionState.Failed -> Icons.Default.CloudOff to Color.Red
    }

    Icon(
        imageVector = icon,
        contentDescription = "Connection status",
        tint = tint
    )
}
```

### Dependency Injection with Hilt

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object CapnWebModule {

    @Provides
    @Singleton
    fun provideCapnWebSession(
        @ApplicationContext context: Context,
        authManager: AuthManager
    ): CapnWebSession {
        return CapnWeb {
            url(BuildConfig.API_URL)

            auth {
                bearer { authManager.getAccessToken() }
            }

            timeout {
                connect = 15.seconds
                call = 30.seconds
            }

            reconnect {
                enabled = true
                maxAttempts = 5
                backoff = exponential(base = 1.seconds, max = 30.seconds)
            }

            // Android-specific: respect network state
            networkObserver = AndroidNetworkObserver(context)
        }
    }

    @Provides
    @Singleton
    fun provideTodoApi(session: CapnWebSession): TodoApi {
        return session.stub()
    }
}
```

### Lifecycle-Aware Connection

```kotlin
@Composable
fun CapnWebLifecycleObserver(session: CapnWebSession) {
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> session.connect()
                Lifecycle.Event.ON_STOP -> session.disconnect()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }
}
```

### Real-Time Updates with Flow

```kotlin
@Composable
fun NotificationBadge(api: NotificationApi) {
    val notifications by api.notifications
        .subscribe()
        .collectAsStateWithLifecycle(initialValue = emptyList())

    if (notifications.isNotEmpty()) {
        Badge { Text("${notifications.size}") }
    }
}
```

---

## Workflow Patterns

For complex multi-step operations, Cap'n Web provides workflow patterns that handle failures gracefully.

### Saga Pattern

Sagas coordinate multiple operations with compensation on failure:

```kotlin
class OrderSaga(private val api: OrderApi) {

    suspend fun placeOrder(order: OrderRequest): OrderResult {
        return saga {
            // Step 1: Reserve inventory
            val reservation = step(
                action = { api.inventory.reserve(order.items) },
                compensate = { reservation -> api.inventory.release(reservation.id) }
            )

            // Step 2: Process payment
            val payment = step(
                action = { api.payments.charge(order.payment, reservation.total) },
                compensate = { payment -> api.payments.refund(payment.id) }
            )

            // Step 3: Create order
            val createdOrder = step(
                action = {
                    api.orders.create(
                        items = reservation.items,
                        paymentId = payment.id
                    )
                },
                compensate = { order -> api.orders.cancel(order.id) }
            )

            // Step 4: Send confirmation (no compensation needed)
            api.notifications.send(
                userId = order.userId,
                message = "Order ${createdOrder.id} confirmed!"
            )

            OrderResult.Success(createdOrder)
        }
    }
}

// Usage
val saga = OrderSaga(api)
when (val result = saga.placeOrder(orderRequest)) {
    is OrderResult.Success -> showConfirmation(result.order)
    is OrderResult.Failed -> showError(result.error, result.compensationResults)
}
```

### Workflow Builder

For sequential workflows with retry and checkpoint support:

```kotlin
val onboardingWorkflow = workflow("user-onboarding") {

    // Define workflow steps
    val user = step("create-user") {
        api.users.create(registration)
    }

    val profile = step("create-profile") {
        api.profiles.create(user.id, profileData)
    }

    step("send-welcome-email") {
        api.emails.sendWelcome(user.email)
    }.retryable(maxAttempts = 3, backoff = exponential(1.seconds))

    step("setup-defaults") {
        api.preferences.setDefaults(user.id)
    }.optional() // Won't fail the workflow

    // Return result
    OnboardingResult(user, profile)
}

// Execute with automatic checkpointing
val result = onboardingWorkflow.execute(scope)
```

### Transactional Batch

For atomic all-or-nothing operations:

```kotlin
val results = api.transactional {
    // All operations succeed or all are rolled back
    val todo1 = todos.create("Task 1")
    val todo2 = todos.create("Task 2")
    val todo3 = todos.create("Task 3")

    // Assign to project
    projects["p1"].addTodos(listOf(todo1.id, todo2.id, todo3.id))

    listOf(todo1, todo2, todo3)
}
```

### Retry Strategies

```kotlin
// Simple retry
val result = api.todos.get(id).retry(maxAttempts = 3)

// With backoff
val result = api.todos.get(id).retry {
    maxAttempts = 5
    backoff = exponential(base = 100.milliseconds, max = 5.seconds)
    retryOn { it is RpcError.NetworkError || it is RpcError.Timeout }
}

// Circuit breaker
val breaker = CircuitBreaker(
    failureThreshold = 5,
    resetTimeout = 30.seconds
)

val result = breaker.execute {
    api.externalService.call()
}
```

---

## Framework Integration

### Ktor Server

```kotlin
fun Application.configureCapnWeb() {
    install(WebSockets)

    routing {
        webSocket("/rpc") {
            val session = CapnWebServer(this) {
                serialization {
                    json = Json { ignoreUnknownKeys = true }
                }
            }

            // Export your API
            session.export("todos", TodoServiceImpl(database))
            session.export("users", UserServiceImpl(database))

            // Handle the session
            session.serve()
        }
    }
}
```

### Spring Boot

```kotlin
@Configuration
class CapnWebConfig {

    @Bean
    fun capnWebHandler(
        todoService: TodoService,
        userService: UserService
    ): WebSocketHandler {
        return CapnWebWebSocketHandler { session ->
            session.export("todos", todoService)
            session.export("users", userService)
        }
    }

    @Bean
    fun webSocketMapping(handler: CapnWebWebSocketHandler): HandlerMapping {
        return SimpleUrlHandlerMapping().apply {
            urlMap = mapOf("/rpc" to handler)
            order = 1
        }
    }
}
```

### Ktor Client

```kotlin
val client = HttpClient(CIO) {
    install(WebSockets)
}

val api = CapnWeb {
    transport {
        ktorClient = client
    }
    url("wss://api.example.com/rpc")
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

### Verifying Pipelining

```kotlin
@Test
fun `pipelines execute in single round-trip`() = runTest {
    var requestCount = 0

    val session = MockCapnWeb {
        interceptor { request ->
            requestCount++
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

### In-Memory Transport

```kotlin
@Test
fun `client and server communicate`() = runTest {
    val (clientTransport, serverTransport) = InMemoryTransport.pair()

    // Server side
    val server = CapnWeb { transport { custom = serverTransport } }
    server.export("todos", LocalTodoService(testDb))

    // Client side
    val client = CapnWeb { transport { custom = clientTransport } }

    val todos = client.todos.list()
    assertTrue(todos.isNotEmpty())
}
```

### ViewModel Testing

```kotlin
@Test
fun `loadTodos updates state correctly`() = runTest {
    val mockApi = MockCapnWeb {
        on("todos.list") {
            listOf(Todo(id = "1", title = "Test"))
        }
    }

    val viewModel = TodoViewModel(mockApi.stub(), SavedStateHandle())

    // Initial state is Loading, then becomes Success
    viewModel.uiState.test {
        assertEquals(TodoUiState.Loading, awaitItem())

        val success = awaitItem() as TodoUiState.Success
        assertEquals(1, success.todos.size)
        assertEquals("Test", success.todos[0].title)
    }
}
```

---

## Security Considerations

### Capability Security Model

Cap'n Web uses capability-based security. Access is granted by possession of object references, not by identity checks:

```kotlin
// The server grants access by returning capabilities
val session = api.auth.login(credentials)

// session is a capability - having it IS the permission
val myTodos = session.todos.list()  // Can only see own todos

// The server can revoke by invalidating the capability
session.logout()  // session capability is now invalid
```

### Authentication Patterns

```kotlin
val api = CapnWeb {
    url("wss://api.example.com")

    auth {
        // Bearer token (JWT)
        bearer { authManager.getAccessToken() }

        // Auto-refresh on 401
        onUnauthorized {
            val newToken = authManager.refresh()
            bearer(newToken)
            retry()
        }
    }
}
```

### Secure Token Storage (Android)

```kotlin
class SecureTokenStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var accessToken: String?
        get() = prefs.getString("access_token", null)
        set(value) = prefs.edit().putString("access_token", value).apply()
}
```

### TLS/Certificate Pinning

```kotlin
val api = CapnWeb {
    url("wss://api.example.com")

    transport {
        certificatePinner {
            // Pin your server's certificate
            add("api.example.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        }
    }
}
```

---

## Multiplatform Setup

Cap'n Web supports Kotlin Multiplatform (JVM, JS, Native).

```kotlin
// build.gradle.kts
kotlin {
    jvm()
    js(IR) { browser(); nodejs() }
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
                implementation("com.dotdo:capnweb-jvm:1.0.0") // OkHttp transport
            }
        }
        jsMain {
            dependencies {
                implementation("com.dotdo:capnweb-js:1.0.0") // Browser WebSocket
            }
        }
        iosMain {
            dependencies {
                implementation("com.dotdo:capnweb-native:1.0.0") // URLSession
            }
        }
        androidMain {
            dependencies {
                implementation("com.dotdo:capnweb-android:1.0.0") // OkHttp + lifecycle
            }
        }
    }
}
```

### Shared API Code

```kotlin
// commonMain
@RpcInterface
interface SharedApi {
    val todos: TodoService
    val users: UserService
}

expect fun createCapnWeb(url: String): CapnWebSession

// androidMain
actual fun createCapnWeb(url: String): CapnWebSession {
    return CapnWeb {
        url(url)
        transport { okHttp() }
    }
}

// iosMain
actual fun createCapnWeb(url: String): CapnWebSession {
    return CapnWeb {
        url(url)
        transport { urlSession() }
    }
}
```

---

## Protocol Reference

Cap'n Web uses a JSON-based protocol over WebSocket (or HTTP for batched calls). See [protocol.md](../../protocol.md) for the complete wire format specification.

Key concepts:
- **Push/Pull**: Client pushes expressions, pulls results
- **Imports/Exports**: Reference tables for stubs and promises
- **Expressions**: JSON-serializable operation trees that support pipelining
- **Bidirectional**: Either side can export capabilities

---

## Complete Example

```kotlin
import com.dotdo.capnweb.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.seconds

// Data models
@Serializable
data class Todo(
    val id: String,
    val title: String,
    val completed: Boolean = false,
    val authorId: String
)

@Serializable
data class User(val id: String, val name: String, val email: String)

@Serializable
data class Notification(val type: String, val message: String)

// Typed API
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
    val profile: ProfileService
}

@RpcInterface
interface ProfileService {
    val name: RpcPromise<String>
    suspend fun get(): Profile
}

@RpcInterface
interface NotificationService {
    fun subscribe(): Flow<Notification>
}

// Main application
suspend fun main() = coroutineScope {
    val session = CapnWeb {
        url("wss://api.example.com")
        auth { bearer(System.getenv("API_TOKEN")) }
        timeout { call = 30.seconds }
        reconnect { maxAttempts = 3 }
    }

    // Type annotation on the receiver, not inside use block
    val api: Api = session.stub()

    session.use {
        // Monitor connection
        launch {
            session.connectionState.collect { state ->
                println("Connection: $state")
            }
        }

        // Subscribe to notifications
        launch {
            api.notifications.subscribe()
                .catch { e -> println("Notification error: $e") }
                .collect { println("Notification: ${it.message}") }
        }

        // Direct call - suspend function returns value
        val todos = api.todos.list()
        println("Found ${todos.size} todos")

        // Pipelining - chain + await for single round-trip
        val authorName: String = api.todos["123"].author.profile.name.await()
        println("Author: $authorName")

        // Error handling
        try {
            api.todos["nonexistent"].get()
        } catch (e: RpcError) {
            when (e) {
                is RpcError.NotFound -> println("Todo not found")
                else -> throw e
            }
        }

        // Create and complete a todo
        val newTodo = api.todos.create("Learn Cap'n Web")
        println("Created: ${newTodo.title}")

        api.todos[newTodo.id].complete()
        println("Completed!")
    }
}
```

---

## Why Cap'n Web?

### vs REST

- **Pipelining**: Multiple operations in one round-trip
- **Capabilities**: Fine-grained access control by passing object references
- **Bidirectional**: Server can call client too
- **Streaming**: Native Flow support for real-time data

### vs GraphQL

- **No query language**: Just call methods
- **Capabilities**: Access control through object references, not field-level rules
- **Simpler caching**: Promise identity handles deduplication
- **Full bidirectional**: Not just subscriptions

### vs gRPC

- **Browser-native**: JSON over WebSocket, no special proxy needed
- **Dynamic**: No schema compilation required
- **Capability-based**: Object references replace service discovery

---

## License

MIT

---

*Cap'n Web for Kotlin: Write clean code. Get optimal performance.*
