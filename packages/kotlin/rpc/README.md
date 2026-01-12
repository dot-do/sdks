# rpc.do for Kotlin

[![Maven Central](https://img.shields.io/maven-central/v/do.rpc/sdk.svg?label=Maven%20Central)](https://search.maven.org/artifact/do.rpc/sdk)
[![Kotlin](https://img.shields.io/badge/kotlin-1.9%2B-blue.svg)](https://kotlinlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**High-level RPC client with managed proxies, automatic routing, and server-side operations for Kotlin.**

```kotlin
val client = RpcClient.connect("https://api.example.com")

// Server-side map eliminates N+1 round trips
val squares = client.invoke<List<Int>>("fibonacci", 10).map { n ->
    client.invoke<Int>("square", n)
}.await()

// Four operations, one round trip
```

rpc.do builds on top of [capnweb](../capnweb/README.md) to provide a higher-level abstraction with managed connections, automatic proxy generation, and server-side batch operations. Write expressive Kotlin code and let the SDK optimize network calls for you.

**What rpc.do adds over raw capnweb:**
- **Managed Proxy** - Connection pooling, automatic reconnection, and lifecycle management
- **Automatic Routing** - Route calls to the optimal endpoint based on method signatures
- **Server-Side Operations** - Execute `map`, `filter`, and `flatMap` on the server in a single round trip
- **Trailing Lambda Syntax** - Idiomatic Kotlin DSL for batch operations
- **Typed Method Builders** - Compile-time safety for RPC method definitions

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Promise Pipelining](#promise-pipelining)
- [Server-Side Operations](#server-side-operations)
- [Streaming with Flow](#streaming-with-flow)
- [Error Handling](#error-handling)
- [Configuration DSL](#configuration-dsl)
- [Typed Method Definitions](#typed-method-definitions)
- [Android Integration](#android-integration)
- [Testing](#testing)
- [Migration from capnweb](#migration-from-capnweb)
- [Complete Example](#complete-example)
- [API Reference](#api-reference)

---

## Installation

### Gradle (Kotlin DSL)

```kotlin
plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
}

repositories {
    mavenCentral()
}

dependencies {
    // rpc.do SDK
    implementation("do.rpc:sdk:0.1.0")

    // Required: Kotlin coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")

    // Required: JSON serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
}
```

### Gradle (Groovy)

```groovy
plugins {
    id 'org.jetbrains.kotlin.jvm' version '1.9.22'
    id 'org.jetbrains.kotlin.plugin.serialization' version '1.9.22'
}

repositories {
    mavenCentral()
}

dependencies {
    implementation 'do.rpc:sdk:0.1.0'
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0'
    implementation 'org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2'
}
```

### Maven

```xml
<dependencies>
    <dependency>
        <groupId>do.rpc</groupId>
        <artifactId>sdk</artifactId>
        <version>0.1.0</version>
    </dependency>
    <dependency>
        <groupId>org.jetbrains.kotlinx</groupId>
        <artifactId>kotlinx-coroutines-core</artifactId>
        <version>1.8.0</version>
    </dependency>
    <dependency>
        <groupId>org.jetbrains.kotlinx</groupId>
        <artifactId>kotlinx-serialization-json</artifactId>
        <version>1.6.2</version>
    </dependency>
</dependencies>
```

### Android

```kotlin
plugins {
    id("com.android.application") // or library
    kotlin("android")
    kotlin("plugin.serialization") version "1.9.22"
}

dependencies {
    implementation("do.rpc:sdk:0.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // Android lifecycle integration
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
}
```

---

## Quick Start

```kotlin
import com.dotdo.rpc.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable

@Serializable
data class User(val id: String, val name: String, val email: String)

@Serializable
data class Post(val id: String, val title: String, val authorId: String)

fun main() = runBlocking {
    // Connect with DSL configuration
    val client = RpcClient.connect("https://api.example.com") {
        timeout(30.seconds)
        retries(max = 3, delay = 1.seconds)
        auth("your-api-token")
    }

    // Make direct RPC calls (suspend functions)
    val users: List<User> = client.call("users.list")
    val user: User = client.call("users.get", "user-123")

    // Create data
    val newPost: Post = client.call("posts.create", mapOf(
        "title" to "Hello World",
        "content" to "My first post"
    ))

    println("Created post: ${newPost.title}")

    // Clean up
    client.close()
}
```

---

## Core Concepts

### RpcClient: The Managed Proxy

`RpcClient` is the central entry point. Unlike raw capnweb which requires manual session management, `RpcClient` handles:

- **Connection pooling** - Reuses connections efficiently
- **Automatic reconnection** - Recovers from network failures
- **Request queuing** - Buffers calls during reconnection
- **Timeout management** - Configurable per-call timeouts
- **Authentication** - Bearer token and custom header support

```kotlin
// Create a client with full configuration
val client = RpcClient.connect("https://api.example.com") {
    // Timeout for all calls
    timeout(30.seconds)

    // Retry configuration
    retries(max = 5, delay = 2.seconds)

    // Authentication
    auth("your-bearer-token")

    // Custom headers
    header("X-Client-Version", "1.0.0")
    header("X-Request-ID", UUID.randomUUID().toString())
}

// Check connection status
if (client.isConnected()) {
    val result: String = client.call("ping")
    println(result)
}

// Use with structured concurrency
client.use { api ->
    val users = api.call<List<User>>("users.list")
    // Client automatically closes when block completes
}
```

### Two Ways to Call: `call` vs `invoke`

rpc.do provides two patterns for making RPC calls:

| Method | Returns | Use When |
|--------|---------|----------|
| `call<T>(method, args)` | `T` directly | You need the result immediately |
| `invoke<T>(method, args)` | `RpcPromise<T>` | You want to pipeline or batch operations |

```kotlin
// call<T>: Suspend function, returns value directly
val user: User = client.call("users.get", userId)
val posts: List<Post> = client.call("posts.list", userId)

// invoke<T>: Returns promise for pipelining/batching
val userPromise: RpcPromise<User> = client.invoke("users.get", userId)
val postPromise: RpcPromise<List<Post>> = client.invoke("posts.list", userId)

// Execute promises explicitly
val user = userPromise.await()
val posts = postPromise.await()
```

### RpcPromise: The Pipelining Primitive

`RpcPromise<T>` represents a pending RPC result. It's the key to:

1. **Promise Pipelining** - Chain calls that execute in a single round trip
2. **Server-Side Batch Operations** - Map/filter/flatMap executed on the server
3. **Error Handling** - Convert to `Result<T>` for explicit handling

```kotlin
// Create a promise
val promise: RpcPromise<User> = client.invoke("users.get", userId)

// Navigate through nested properties (pipelining)
val emailPromise: RpcPromise<String> = promise["profile"]["email"]
val email: String = emailPromise.await()

// Chain calls
val postsPromise: RpcPromise<List<Post>> = promise.then("posts.list")
val posts: List<Post> = postsPromise.await()

// Convert to Result for explicit error handling
val result: Result<User> = promise.toResult()
when {
    result.isSuccess -> println("User: ${result.getOrNull()}")
    result.isFailure -> println("Error: ${result.exceptionOrNull()}")
}
```

---

## Promise Pipelining

Promise pipelining is the foundation of efficient RPC. When you chain property accesses or method calls on a promise, rpc.do batches them into a single network request.

### Property Access Pipelining

```kotlin
// Without pipelining: 4 round trips
val user = client.call<User>("users.get", userId)                    // Round trip 1
val profile = client.call<Profile>("profiles.get", user.profileId)   // Round trip 2
val settings = client.call<Settings>("settings.get", profile.settingsId) // Round trip 3
val theme = settings.theme                                            // Local

// With pipelining: 1 round trip
val theme: String = client.invoke<User>("users.get", userId)
    ["profile"]
    ["settings"]
    ["theme"]
    .await()
```

### Chained Method Calls

```kotlin
// Chain related operations
val postWithComments: PostWithComments = client.invoke<Post>("posts.get", postId)
    .then<PostWithComments>("enrichWithComments")
    .await()

// Multiple transformations
val summary: String = client.invoke<Document>("documents.get", docId)
    .then<String>("extractText")
    .then<String>("summarize", 100)  // Summarize in 100 words
    .await()
```

### How Pipelining Works

Under the hood, rpc.do sends a single JSON expression that describes the entire pipeline:

```json
{
  "pipeline": [
    {"call": "users.get", "args": ["user-123"]},
    {"get": "profile"},
    {"get": "settings"},
    {"get": "theme"}
  ]
}
```

The server executes all operations sequentially and returns only the final result, saving multiple network round trips.

---

## Server-Side Operations

**This is the killer feature.** rpc.do supports executing `map`, `filter`, and `flatMap` operations on the server, eliminating N+1 query problems entirely.

### The N+1 Problem

Traditional RPC has a fundamental issue:

```kotlin
// BAD: N+1 round trips
val users: List<User> = client.call("users.list")  // 1 round trip
val profiles = users.map { user ->
    client.call<Profile>("profiles.get", user.id)  // N round trips!
}
```

For 100 users, this makes 101 network calls.

### Server-Side Map: The Solution

```kotlin
// GOOD: Single round trip with server-side map
val profiles: List<Profile> = client.invoke<List<User>>("users.list").map { user ->
    client.invoke<Profile>("profiles.get", user.id)
}.await()
```

The `map` lambda is **serialized and sent to the server**, which executes it in a single batch operation. No matter how many users, it's always one round trip.

### Kotlin's Trailing Lambda Magic

rpc.do leverages Kotlin's trailing lambda syntax to make server-side operations feel natural:

```kotlin
// Generate Fibonacci numbers and square them
val fibSquares = client.invoke<List<Int>>("fibonacci", 10).map { n ->
    client.invoke<Int>("square", n)
}.await()

// Fetch all orders and get their shipping status
val statuses = client.invoke<List<Order>>("orders.pending").map { order ->
    client.invoke<ShippingStatus>("shipping.status", order.trackingId)
}.await()

// Get all users' recent activity
val activities = client.invoke<List<User>>("users.active").map { user ->
    client.invoke<List<Activity>>("activity.recent", user.id, limit = 5)
}.await()
```

### Server-Side Filter

Filter items without fetching everything to the client:

```kotlin
// Filter users with premium subscriptions (on server)
val premiumUsers = client.invoke<List<User>>("users.list").filter { user ->
    client.invoke<Boolean>("subscriptions.isPremium", user.id)
}.await()

// Find orders that need attention
val urgentOrders = client.invoke<List<Order>>("orders.all").filter { order ->
    client.invoke<Boolean>("orders.isUrgent", order.id)
}.await()
```

### Server-Side FlatMap

For operations that return lists:

```kotlin
// Get all comments from all posts
val allComments = client.invoke<List<Post>>("posts.recent", 10).flatMap { post ->
    client.invoke<List<Comment>>("posts.comments", post.id)
}.await()

// Gather all tags from user's bookmarks
val allTags = client.invoke<List<Bookmark>>("bookmarks.list").flatMap { bookmark ->
    client.invoke<List<String>>("bookmarks.tags", bookmark.id)
}.await()
```

### Chaining Server-Side Operations

Operations can be chained:

```kotlin
// Get active users, filter by premium, map to their profiles
val premiumProfiles = client.invoke<List<User>>("users.active")
    .filter { user ->
        client.invoke<Boolean>("subscriptions.isPremium", user.id)
    }
    .map { user ->
        client.invoke<Profile>("profiles.detailed", user.id)
    }
    .await()
```

### Real-World Example: E-Commerce Dashboard

```kotlin
@Serializable
data class DashboardData(
    val recentOrders: List<OrderWithCustomer>,
    val lowStockItems: List<ProductWithSupplier>,
    val pendingReviews: List<ReviewWithProduct>
)

suspend fun loadDashboard(): DashboardData {
    return coroutineScope {
        // All three run in parallel, each with server-side joins
        val ordersDeferred = async {
            client.invoke<List<Order>>("orders.recent", 10).map { order ->
                client.invoke<OrderWithCustomer>("orders.withCustomer", order.id)
            }.await()
        }

        val stockDeferred = async {
            client.invoke<List<Product>>("products.lowStock").map { product ->
                client.invoke<ProductWithSupplier>("products.withSupplier", product.id)
            }.await()
        }

        val reviewsDeferred = async {
            client.invoke<List<Review>>("reviews.pending").map { review ->
                client.invoke<ReviewWithProduct>("reviews.withProduct", review.id)
            }.await()
        }

        DashboardData(
            recentOrders = ordersDeferred.await(),
            lowStockItems = stockDeferred.await(),
            pendingReviews = reviewsDeferred.await()
        )
    }
}
```

---

## Streaming with Flow

rpc.do provides first-class support for Kotlin Flow for streaming RPC responses.

### Basic Streaming

```kotlin
// Subscribe to real-time updates
client.stream<Notification>("notifications.subscribe", userId)
    .onEach { notification ->
        showNotification(notification)
    }
    .catch { e ->
        logger.error("Stream error", e)
    }
    .launchIn(scope)
```

### Filtered Streams

```kotlin
// Stream only high-priority events
client.stream<Event>("events.subscribe")
    .filter { it.priority >= Priority.HIGH }
    .collect { event ->
        handleHighPriorityEvent(event)
    }
```

### Transforming Streams

```kotlin
// Transform stream data
val priceUpdates: Flow<PriceDisplay> = client
    .stream<PriceTick>("market.prices", "AAPL")
    .map { tick ->
        PriceDisplay(
            symbol = tick.symbol,
            price = formatCurrency(tick.price),
            change = calculateChange(tick)
        )
    }

priceUpdates.collect { display ->
    updateUI(display)
}
```

### Combining Streams

```kotlin
// Combine multiple streams
val combinedFeed = merge(
    client.stream<Message>("chat.messages", roomId),
    client.stream<Presence>("chat.presence", roomId)
)

combinedFeed.collect { event ->
    when (event) {
        is Message -> displayMessage(event)
        is Presence -> updateUserList(event)
    }
}
```

### Stream with Timeout and Retry

```kotlin
client.stream<HeartBeat>("system.heartbeat")
    .timeout(30.seconds)
    .retry(3) { cause ->
        cause is RpcException.Disconnected
    }
    .collect { heartbeat ->
        updateConnectionStatus(heartbeat.latency)
    }
```

### Backpressure Handling

```kotlin
// Buffer and sample high-frequency streams
client.stream<SensorData>("sensors.data", sensorId)
    .buffer(Channel.BUFFERED)
    .sample(100.milliseconds)  // Take one sample every 100ms
    .collect { data ->
        updateSensorDisplay(data)
    }
```

### StateFlow Integration

```kotlin
class DataRepository(private val client: RpcClient) {

    private val _notifications = MutableStateFlow<List<Notification>>(emptyList())
    val notifications: StateFlow<List<Notification>> = _notifications.asStateFlow()

    fun startListening(scope: CoroutineScope) {
        client.stream<Notification>("notifications.subscribe")
            .onEach { notification ->
                _notifications.update { current ->
                    (listOf(notification) + current).take(100)
                }
            }
            .launchIn(scope)
    }
}
```

---

## Error Handling

rpc.do uses a sealed class hierarchy for exhaustive error handling.

### Error Types

```kotlin
sealed class RpcException : Exception() {
    // Connection failed to establish
    data class ConnectionFailed(
        val url: String,
        override val cause: Throwable?
    ) : RpcException()

    // Method doesn't exist on server
    data class MethodNotFound(
        val method: String
    ) : RpcException()

    // Invalid arguments passed to method
    data class InvalidArguments(
        val method: String,
        val reason: String
    ) : RpcException()

    // Server returned an error
    data class ServerError(
        val code: Int,
        override val message: String
    ) : RpcException()

    // Call timed out
    data class Timeout(
        val method: String,
        val duration: Duration
    ) : RpcException()

    // Client disconnected
    data object Disconnected : RpcException()
}
```

### Exhaustive Handling

Kotlin's `when` ensures you handle all cases:

```kotlin
try {
    val user = client.call<User>("users.get", userId)
    displayUser(user)
} catch (e: RpcException) {
    when (e) {
        is RpcException.ConnectionFailed -> {
            showError("Cannot connect to server")
            scheduleReconnect()
        }
        is RpcException.MethodNotFound -> {
            showError("Feature not available")
            logError("Method ${e.method} not found")
        }
        is RpcException.InvalidArguments -> {
            showError("Invalid request: ${e.reason}")
        }
        is RpcException.ServerError -> {
            when (e.code) {
                404 -> showError("User not found")
                403 -> showError("Access denied")
                500 -> showError("Server error. Please try again.")
                else -> showError(e.message)
            }
        }
        is RpcException.Timeout -> {
            showError("Request timed out. Please try again.")
        }
        is RpcException.Disconnected -> {
            showError("Connection lost")
            attemptReconnect()
        }
    }
}
```

### Result-Based Handling

For functional error handling without exceptions:

```kotlin
// Convert promise to Result
val result: Result<User> = client.invoke<User>("users.get", userId).toResult()

// Pattern matching
val displayName = result.fold(
    onSuccess = { user -> user.displayName },
    onFailure = { error -> "Unknown User" }
)

// Chain operations
val email: String? = client.invoke<User>("users.get", userId)
    .toResult()
    .map { it.email }
    .getOrNull()

// Handle with default
val user = client.invoke<User>("users.get", userId)
    .toResult()
    .getOrElse { defaultUser }
```

### Retry Strategies

```kotlin
// Simple retry
suspend fun <T> retryCall(
    times: Int = 3,
    delay: Duration = 1.seconds,
    block: suspend () -> T
): T {
    var lastException: Exception? = null
    repeat(times) { attempt ->
        try {
            return block()
        } catch (e: RpcException) {
            lastException = e
            if (e is RpcException.ServerError && e.code in 400..499) {
                throw e  // Don't retry client errors
            }
            if (attempt < times - 1) {
                delay(delay * (attempt + 1))  // Exponential backoff
            }
        }
    }
    throw lastException!!
}

// Usage
val user = retryCall(times = 3) {
    client.call<User>("users.get", userId)
}
```

### Circuit Breaker Pattern

```kotlin
class CircuitBreaker(
    private val failureThreshold: Int = 5,
    private val resetTimeout: Duration = 30.seconds
) {
    private var failures = 0
    private var lastFailure: Instant? = null
    private var state: State = State.CLOSED

    enum class State { CLOSED, OPEN, HALF_OPEN }

    suspend fun <T> execute(block: suspend () -> T): T {
        when (state) {
            State.OPEN -> {
                if (lastFailure?.plus(resetTimeout)?.isBefore(Instant.now()) == true) {
                    state = State.HALF_OPEN
                } else {
                    throw RpcException.Disconnected
                }
            }
            else -> {}
        }

        return try {
            val result = block()
            onSuccess()
            result
        } catch (e: Exception) {
            onFailure()
            throw e
        }
    }

    private fun onSuccess() {
        failures = 0
        state = State.CLOSED
    }

    private fun onFailure() {
        failures++
        lastFailure = Instant.now()
        if (failures >= failureThreshold) {
            state = State.OPEN
        }
    }
}

// Usage
val breaker = CircuitBreaker(failureThreshold = 5)

val user = breaker.execute {
    client.call<User>("users.get", userId)
}
```

---

## Configuration DSL

rpc.do uses a Kotlin DSL for expressive configuration.

### Basic Configuration

```kotlin
val client = RpcClient.connect("https://api.example.com") {
    timeout(30.seconds)
    retries(max = 3, delay = 1.seconds)
    auth("your-bearer-token")
}
```

### Full Configuration Options

```kotlin
val client = RpcClient.connect("https://api.example.com") {
    // Request timeout
    timeout(30.seconds)

    // Retry configuration
    retries(max = 5, delay = 2.seconds)

    // Authentication
    auth("your-bearer-token")

    // Custom headers
    header("X-Client-Version", "1.0.0")
    header("X-Platform", "android")
    header("X-Device-ID", deviceId)
    header("Accept-Language", Locale.getDefault().language)
}
```

### Environment-Based Configuration

```kotlin
fun createClient(environment: Environment): RpcClient = runBlocking {
    RpcClient.connect(environment.apiUrl) {
        timeout(environment.timeout)
        retries(max = environment.maxRetries, delay = environment.retryDelay)

        when (environment) {
            Environment.Development -> {
                header("X-Debug", "true")
                // Longer timeouts for debugging
                timeout(60.seconds)
            }
            Environment.Staging -> {
                header("X-Environment", "staging")
            }
            Environment.Production -> {
                header("X-Environment", "production")
                // Stricter timeouts for production
                timeout(15.seconds)
            }
        }

        // Auth from environment
        auth(environment.apiToken)
    }
}
```

### Programmatic Configuration

```kotlin
val config = RpcConfig().apply {
    timeout = 30.seconds
    maxRetries = 3
    retryDelay = 1.seconds
    headers["Authorization"] = "Bearer $token"
    headers["X-Client"] = "kotlin-sdk"
}

// Access config properties
println("Timeout: ${config.timeout}")
println("Max retries: ${config.maxRetries}")
```

---

## Typed Method Definitions

For compile-time safety, define your RPC methods using the type-safe builder:

### Defining Methods

```kotlin
// Define typed methods
object UserMethods {
    val list = method<List<User>>("users.list")
    val get = method<User>("users.get")
    val create = method<User>("users.create")
    val update = method<User>("users.update")
    val delete = method<Unit>("users.delete")
}

object PostMethods {
    val list = method<List<Post>>("posts.list")
    val get = method<Post>("posts.get")
    val create = method<Post>("posts.create")
    val byAuthor = method<List<Post>>("posts.byAuthor")
}
```

### Using Typed Methods

```kotlin
// Type-safe calls
val users: List<User> = client.call(UserMethods.list)
val user: User = client.call(UserMethods.get, userId)
val newUser: User = client.call(UserMethods.create, userData)

// Type-safe promises
val userPromise: RpcPromise<User> = client.invoke(UserMethods.get, userId)
val postsPromise: RpcPromise<List<Post>> = client.invoke(PostMethods.byAuthor, userId)
```

### Grouping Methods

```kotlin
// Group related methods
object Api {
    object Users {
        val list = method<List<User>>("users.list")
        val get = method<User>("users.get")
        val create = method<User>("users.create")
        val update = method<User>("users.update")
        val delete = method<Unit>("users.delete")

        object Profile {
            val get = method<Profile>("users.profile.get")
            val update = method<Profile>("users.profile.update")
        }
    }

    object Posts {
        val list = method<List<Post>>("posts.list")
        val get = method<Post>("posts.get")
        val create = method<Post>("posts.create")

        object Comments {
            val list = method<List<Comment>>("posts.comments.list")
            val add = method<Comment>("posts.comments.add")
        }
    }

    object Notifications {
        val list = method<List<Notification>>("notifications.list")
        val markRead = method<Unit>("notifications.markRead")
        val subscribe = method<Flow<Notification>>("notifications.subscribe")
    }
}

// Usage
val user = client.call(Api.Users.get, userId)
val profile = client.call(Api.Users.Profile.get, userId)
val posts = client.call(Api.Posts.list)
val comments = client.call(Api.Posts.Comments.list, postId)
```

---

## Android Integration

rpc.do integrates seamlessly with Android architecture components.

### ViewModel Integration

```kotlin
class UserViewModel(
    private val client: RpcClient,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    // UI State
    sealed interface UiState {
        data object Loading : UiState
        data class Success(val user: User, val posts: List<Post>) : UiState
        data class Error(val message: String) : UiState
    }

    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    // User ID from navigation arguments
    private val userId: String = savedStateHandle["userId"] ?: ""

    init {
        loadUserData()
    }

    fun loadUserData() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading

            try {
                // Parallel loading with coroutines
                val userDeferred = async { client.call<User>("users.get", userId) }
                val postsDeferred = async { client.call<List<Post>>("posts.byAuthor", userId) }

                _uiState.value = UiState.Success(
                    user = userDeferred.await(),
                    posts = postsDeferred.await()
                )
            } catch (e: RpcException) {
                _uiState.value = UiState.Error(e.toUserMessage())
            }
        }
    }

    fun createPost(title: String, content: String) {
        viewModelScope.launch {
            try {
                val newPost = client.call<Post>("posts.create", mapOf(
                    "title" to title,
                    "content" to content,
                    "authorId" to userId
                ))

                // Optimistic update
                val current = _uiState.value
                if (current is UiState.Success) {
                    _uiState.value = current.copy(posts = current.posts + newPost)
                }
            } catch (e: RpcException) {
                // Show error snackbar via event
                _errorEvent.emit(e.toUserMessage())
            }
        }
    }

    private val _errorEvent = MutableSharedFlow<String>()
    val errorEvent: SharedFlow<String> = _errorEvent.asSharedFlow()
}

// Extension function for user-friendly error messages
fun RpcException.toUserMessage(): String = when (this) {
    is RpcException.ConnectionFailed -> "Unable to connect. Check your internet connection."
    is RpcException.Timeout -> "Request timed out. Please try again."
    is RpcException.ServerError -> when (code) {
        401 -> "Please log in again."
        403 -> "You don't have permission to do this."
        404 -> "Content not found."
        else -> "Something went wrong. Please try again."
    }
    is RpcException.Disconnected -> "Connection lost. Reconnecting..."
    else -> "An error occurred. Please try again."
}
```

### Jetpack Compose Integration

```kotlin
@Composable
fun UserScreen(
    viewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Error handling
    val context = LocalContext.current
    LaunchedEffect(Unit) {
        viewModel.errorEvent.collect { message ->
            Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Profile") },
                actions = {
                    IconButton(onClick = { viewModel.loadUserData() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { padding ->
        when (val state = uiState) {
            is UiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            is UiState.Success -> {
                UserContent(
                    user = state.user,
                    posts = state.posts,
                    modifier = Modifier.padding(padding)
                )
            }
            is UiState.Error -> {
                ErrorScreen(
                    message = state.message,
                    onRetry = { viewModel.loadUserData() },
                    modifier = Modifier.padding(padding)
                )
            }
        }
    }
}

@Composable
fun UserContent(
    user: User,
    posts: List<Post>,
    modifier: Modifier = Modifier
) {
    LazyColumn(modifier = modifier) {
        item {
            UserHeader(user)
        }

        item {
            Text(
                text = "Posts",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(16.dp)
            )
        }

        items(posts) { post ->
            PostCard(post)
        }
    }
}

@Composable
fun ErrorScreen(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Error,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(48.dp)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(24.dp))
        Button(onClick = onRetry) {
            Text("Try Again")
        }
    }
}
```

### Hilt Dependency Injection

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object RpcModule {

    @Provides
    @Singleton
    fun provideRpcClient(
        @ApplicationContext context: Context,
        authManager: AuthManager
    ): RpcClient = runBlocking {
        RpcClient.connect(BuildConfig.API_URL) {
            timeout(30.seconds)
            retries(max = 3, delay = 1.seconds)

            // Dynamic auth token
            header("Authorization", "Bearer ${authManager.getAccessToken()}")

            // Device info
            header("X-Device-ID", getDeviceId(context))
            header("X-App-Version", BuildConfig.VERSION_NAME)
            header("X-Platform", "android")
        }
    }

    private fun getDeviceId(context: Context): String {
        return Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        )
    }
}

// Inject in ViewModel
@HiltViewModel
class UserViewModel @Inject constructor(
    private val client: RpcClient,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    // ...
}
```

### Lifecycle-Aware Connection Management

```kotlin
@Composable
fun RpcConnectionManager(client: RpcClient) {
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    // Reconnect when app comes to foreground
                    if (!client.isConnected()) {
                        // Trigger reconnection
                    }
                }
                Lifecycle.Event.ON_STOP -> {
                    // Keep connection alive for quick resume
                }
                Lifecycle.Event.ON_DESTROY -> {
                    // Clean up
                }
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

### Real-Time Updates in Compose

```kotlin
@Composable
fun NotificationBadge(client: RpcClient) {
    var count by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        client.stream<Notification>("notifications.subscribe")
            .catch { /* Handle error */ }
            .collect {
                count++
            }
    }

    if (count > 0) {
        Badge { Text(count.toString()) }
    }
}

@Composable
fun LivePriceDisplay(client: RpcClient, symbol: String) {
    var price by remember { mutableStateOf<Price?>(null) }

    LaunchedEffect(symbol) {
        client.stream<Price>("market.prices", symbol)
            .sample(100.milliseconds)  // Throttle updates
            .collect { newPrice ->
                price = newPrice
            }
    }

    price?.let { p ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = p.symbol,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = formatCurrency(p.value),
                style = MaterialTheme.typography.bodyLarge,
                color = if (p.change >= 0) Color.Green else Color.Red
            )
        }
    }
}
```

### Offline Support Pattern

```kotlin
class OfflineFirstRepository(
    private val client: RpcClient,
    private val localDb: AppDatabase
) {
    // Get data with offline fallback
    suspend fun getUsers(): List<User> {
        return try {
            // Try remote first
            val users = client.call<List<User>>("users.list")
            // Cache locally
            localDb.userDao().insertAll(users)
            users
        } catch (e: RpcException) {
            when (e) {
                is RpcException.Disconnected,
                is RpcException.ConnectionFailed,
                is RpcException.Timeout -> {
                    // Fall back to local cache
                    localDb.userDao().getAll()
                }
                else -> throw e
            }
        }
    }

    // Queue operations for later sync
    suspend fun createUserOffline(userData: UserData) {
        // Save to pending operations
        localDb.pendingOpsDao().insert(
            PendingOperation(
                method = "users.create",
                args = Json.encodeToString(userData),
                createdAt = System.currentTimeMillis()
            )
        )
    }

    // Sync pending operations when online
    suspend fun syncPendingOperations() {
        if (!client.isConnected()) return

        val pending = localDb.pendingOpsDao().getAll()
        for (op in pending) {
            try {
                client.call<Any>(op.method, Json.decodeFromString(op.args))
                localDb.pendingOpsDao().delete(op)
            } catch (e: RpcException) {
                if (e is RpcException.ServerError && e.code in 400..499) {
                    // Client error, remove invalid operation
                    localDb.pendingOpsDao().delete(op)
                }
                // Network errors: keep for later retry
            }
        }
    }
}
```

---

## Testing

### Unit Testing with Mocks

```kotlin
class UserViewModelTest {

    @Test
    fun `loadUserData updates state to Success on success`() = runTest {
        // Create a mock client
        val mockClient = mockk<RpcClient> {
            coEvery {
                call<User>("users.get", "user-123")
            } returns User("user-123", "Alice", "alice@example.com")

            coEvery {
                call<List<Post>>("posts.byAuthor", "user-123")
            } returns listOf(
                Post("post-1", "Hello", "user-123"),
                Post("post-2", "World", "user-123")
            )
        }

        val viewModel = UserViewModel(mockClient, SavedStateHandle(mapOf("userId" to "user-123")))

        // Verify loading state
        assertEquals(UiState.Loading, viewModel.uiState.value)

        // Wait for coroutines
        advanceUntilIdle()

        // Verify success state
        val state = viewModel.uiState.value
        assertTrue(state is UiState.Success)
        assertEquals("Alice", (state as UiState.Success).user.name)
        assertEquals(2, state.posts.size)
    }

    @Test
    fun `loadUserData updates state to Error on failure`() = runTest {
        val mockClient = mockk<RpcClient> {
            coEvery {
                call<User>("users.get", any())
            } throws RpcException.ServerError(404, "User not found")
        }

        val viewModel = UserViewModel(mockClient, SavedStateHandle(mapOf("userId" to "invalid")))

        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state is UiState.Error)
        assertTrue((state as UiState.Error).message.contains("not found"))
    }
}
```

### Integration Testing

```kotlin
class RpcClientIntegrationTest {

    private lateinit var server: MockWebServer
    private lateinit var client: RpcClient

    @BeforeEach
    fun setup() {
        server = MockWebServer()
        server.start()

        runBlocking {
            client = RpcClient.connect(server.url("/rpc").toString()) {
                timeout(5.seconds)
            }
        }
    }

    @AfterEach
    fun teardown() {
        client.close()
        server.shutdown()
    }

    @Test
    fun `call returns parsed response`() = runTest {
        server.enqueue(MockResponse()
            .setBody("""{"id":"1","name":"Alice","email":"alice@example.com"}""")
            .setHeader("Content-Type", "application/json"))

        val user: User = client.call("users.get", "1")

        assertEquals("Alice", user.name)
        assertEquals("alice@example.com", user.email)
    }

    @Test
    fun `call throws on server error`() = runTest {
        server.enqueue(MockResponse()
            .setResponseCode(500)
            .setBody("""{"error":"Internal server error"}"""))

        assertThrows<RpcException.ServerError> {
            client.call<User>("users.get", "1")
        }
    }

    @Test
    fun `call retries on transient failure`() = runTest {
        // First two calls fail, third succeeds
        repeat(2) {
            server.enqueue(MockResponse().setResponseCode(503))
        }
        server.enqueue(MockResponse()
            .setBody("""{"id":"1","name":"Alice"}""")
            .setHeader("Content-Type", "application/json"))

        val user: User = client.call("users.get", "1")

        assertEquals("Alice", user.name)
        assertEquals(3, server.requestCount)
    }
}
```

### Testing Server-Side Operations

```kotlin
class ServerSideMapTest {

    @Test
    fun `map executes server-side batch operation`() = runTest {
        val mockClient = mockk<RpcClient> {
            // Expect a single batched call, not N individual calls
            coEvery {
                callInternal<List<Profile>>(
                    match { it.startsWith("remap") },
                    any()
                )
            } returns listOf(
                Profile("1", "Alice Profile"),
                Profile("2", "Bob Profile")
            )

            coEvery {
                invoke<List<User>>("users.list")
            } returns RpcPromise(this, "users.list", emptyList())
        }

        val profiles = mockClient.invoke<List<User>>("users.list").map { user ->
            mockClient.invoke<Profile>("profiles.get", user.id)
        }.await()

        assertEquals(2, profiles.size)

        // Verify only one call was made (batched)
        coVerify(exactly = 1) {
            mockClient.callInternal<List<Profile>>(any(), any())
        }
    }
}
```

### Testing Streams

```kotlin
class StreamingTest {

    @Test
    fun `stream emits values from server`() = runTest {
        val emissions = mutableListOf<Notification>()
        val mockClient = mockk<RpcClient> {
            every {
                stream<Notification>("notifications.subscribe", any())
            } returns flowOf(
                Notification("1", "Hello"),
                Notification("2", "World")
            )
        }

        mockClient.stream<Notification>("notifications.subscribe", "user-1")
            .toList(emissions)

        assertEquals(2, emissions.size)
        assertEquals("Hello", emissions[0].message)
        assertEquals("World", emissions[1].message)
    }

    @Test
    fun `stream handles errors gracefully`() = runTest {
        val mockClient = mockk<RpcClient> {
            every {
                stream<Notification>("notifications.subscribe", any())
            } returns flow {
                emit(Notification("1", "First"))
                throw RpcException.Disconnected
            }
        }

        val emissions = mutableListOf<Notification>()
        var caughtError: Throwable? = null

        mockClient.stream<Notification>("notifications.subscribe", "user-1")
            .catch { e -> caughtError = e }
            .toList(emissions)

        assertEquals(1, emissions.size)
        assertTrue(caughtError is RpcException.Disconnected)
    }
}
```

---

## Migration from capnweb

If you're migrating from raw capnweb to rpc.do, here's what changes:

### Connection Management

```kotlin
// Before (capnweb)
val session = CapnWeb("wss://api.example.com")
session.connectionState.collect { ... }
session.close()

// After (rpc.do)
val client = RpcClient.connect("https://api.example.com") {
    timeout(30.seconds)
    retries(max = 3)
}
client.isConnected()
client.close()
```

### Making Calls

```kotlin
// Before (capnweb)
val todos: List<Todo> = api.todos.list()  // Typed interface required
val name = api.todos["123"].author.profile.name.await()

// After (rpc.do)
val todos: List<Todo> = client.call("todos.list")  // Method name as string
val name = client.invoke<Todo>("todos.get", "123")["author"]["profile"]["name"].await()
```

### Server-Side Operations

```kotlin
// Before (capnweb) - Not natively supported, manual batching required

// After (rpc.do) - Native support
val profiles = client.invoke<List<User>>("users.list").map { user ->
    client.invoke<Profile>("profiles.get", user.id)
}.await()
```

### Error Handling

```kotlin
// Before (capnweb)
try {
    val todo = api.todos.get(id)
} catch (e: RpcError) {
    when (e) {
        is RpcError.NotFound -> ...
        is RpcError.PermissionDenied -> ...
    }
}

// After (rpc.do)
try {
    val todo = client.call<Todo>("todos.get", id)
} catch (e: RpcException) {
    when (e) {
        is RpcException.ServerError -> when (e.code) {
            404 -> ...
            403 -> ...
        }
        is RpcException.MethodNotFound -> ...
    }
}
```

### When to Use Each

| Use Case | Recommendation |
|----------|----------------|
| Full typed API with interfaces | capnweb |
| Dynamic method calls | rpc.do |
| Server-side batch operations | rpc.do |
| Maximum type safety | capnweb |
| Quick prototyping | rpc.do |
| Complex pipelining | capnweb |

---

## Complete Example

Here's a comprehensive example showing all features together.

```kotlin
import com.dotdo.rpc.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.seconds

// Data Models
@Serializable
data class User(val id: String, val name: String, val email: String)

@Serializable
data class Post(val id: String, val title: String, val authorId: String)

@Serializable
data class Comment(val id: String, val postId: String, val text: String)

@Serializable
data class Profile(val userId: String, val bio: String, val avatarUrl: String)

@Serializable
data class Notification(val id: String, val message: String, val read: Boolean)

// Typed Method Definitions
object Api {
    object Users {
        val list = method<List<User>>("users.list")
        val get = method<User>("users.get")
    }
    object Posts {
        val list = method<List<Post>>("posts.list")
        val get = method<Post>("posts.get")
        val byAuthor = method<List<Post>>("posts.byAuthor")
    }
    object Profiles {
        val get = method<Profile>("profiles.get")
    }
    object Comments {
        val byPost = method<List<Comment>>("comments.byPost")
    }
}

// Main Application
suspend fun main() = coroutineScope {
    // Create client with configuration
    val client = RpcClient.connect("https://api.example.com") {
        timeout(30.seconds)
        retries(max = 3, delay = 1.seconds)
        auth(System.getenv("API_TOKEN") ?: "demo-token")
        header("X-Client", "kotlin-example")
    }

    client.use {
        // 1. Simple calls
        println("=== Simple Calls ===")
        val users: List<User> = it.call(Api.Users.list)
        println("Found ${users.size} users")

        // 2. Pipelining
        println("\n=== Pipelining ===")
        val firstUserProfile = it.invoke<User>("users.get", users.first().id)
            ["profile"]
            .await()
        println("First user profile: $firstUserProfile")

        // 3. Server-side map
        println("\n=== Server-Side Map ===")
        val allProfiles = it.invoke<List<User>>("users.list").map { user ->
            it.invoke<Profile>("profiles.get", user.id)
        }.await()
        println("Fetched ${allProfiles.size} profiles in single round trip")

        // 4. Server-side filter
        println("\n=== Server-Side Filter ===")
        val activeUsers = it.invoke<List<User>>("users.list").filter { user ->
            it.invoke<Boolean>("users.isActive", user.id)
        }.await()
        println("Found ${activeUsers.size} active users")

        // 5. Server-side flatMap
        println("\n=== Server-Side FlatMap ===")
        val allComments = it.invoke<List<Post>>("posts.recent", 5).flatMap { post ->
            it.invoke<List<Comment>>("comments.byPost", post.id)
        }.await()
        println("Found ${allComments.size} comments across 5 posts")

        // 6. Chained operations
        println("\n=== Chained Operations ===")
        val enrichedPosts = it.invoke<List<User>>("users.active")
            .filter { user ->
                it.invoke<Boolean>("users.hasPosts", user.id)
            }
            .flatMap { user ->
                it.invoke<List<Post>>("posts.byAuthor", user.id)
            }
            .await()
        println("Found ${enrichedPosts.size} posts from active users")

        // 7. Parallel loading with coroutines
        println("\n=== Parallel Loading ===")
        val (usersResult, postsResult, profilesResult) = awaitAll(
            async { it.call<List<User>>("users.list") },
            async { it.call<List<Post>>("posts.recent", 10) },
            async {
                it.invoke<List<User>>("users.list").map { user ->
                    it.invoke<Profile>("profiles.get", user.id)
                }.await()
            }
        )
        println("Loaded ${usersResult.size} users, ${postsResult.size} posts, ${profilesResult.size} profiles")

        // 8. Error handling
        println("\n=== Error Handling ===")
        try {
            it.call<User>("users.get", "nonexistent-id")
        } catch (e: RpcException) {
            when (e) {
                is RpcException.ServerError -> println("Server error: ${e.code} - ${e.message}")
                is RpcException.MethodNotFound -> println("Method not found: ${e.method}")
                is RpcException.Timeout -> println("Request timed out")
                else -> println("RPC error: $e")
            }
        }

        // 9. Result-based error handling
        println("\n=== Result-Based Handling ===")
        val userResult = it.invoke<User>("users.get", "maybe-exists").toResult()
        val displayName = userResult.fold(
            onSuccess = { user -> user.name },
            onFailure = { "Unknown User" }
        )
        println("Display name: $displayName")

        // 10. Streaming (subscribe to notifications)
        println("\n=== Streaming ===")
        val notificationJob = launch {
            it.stream<Notification>("notifications.subscribe")
                .take(3)  // Just take first 3 for demo
                .collect { notification ->
                    println("Notification: ${notification.message}")
                }
        }

        // Wait briefly for notifications then cancel
        delay(5.seconds)
        notificationJob.cancelAndJoin()

        println("\n=== Complete ===")
    }
}

// Example output:
// === Simple Calls ===
// Found 42 users
//
// === Pipelining ===
// First user profile: Profile(userId=u1, bio=Hello!, avatarUrl=...)
//
// === Server-Side Map ===
// Fetched 42 profiles in single round trip
//
// === Server-Side Filter ===
// Found 28 active users
//
// === Server-Side FlatMap ===
// Found 156 comments across 5 posts
//
// === Chained Operations ===
// Found 87 posts from active users
//
// === Parallel Loading ===
// Loaded 42 users, 10 posts, 42 profiles
//
// === Error Handling ===
// Server error: 404 - User not found
//
// === Result-Based Handling ===
// Display name: Unknown User
//
// === Streaming ===
// Notification: New comment on your post
// Notification: Someone followed you
// Notification: Your post was liked
//
// === Complete ===
```

---

## API Reference

### RpcClient

| Method | Description |
|--------|-------------|
| `connect(url, configure)` | Create a new RPC client with DSL configuration |
| `call<T>(method, args)` | Make an RPC call and return the result directly |
| `invoke<T>(method, args)` | Create an RpcPromise for pipelining |
| `stream<T>(method, args)` | Create a Flow for streaming results |
| `isConnected()` | Check if the client is connected |
| `close()` | Close the client and release resources |

### RpcConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `timeout` | Duration | 30s | Request timeout |
| `maxRetries` | Int | 3 | Maximum retry attempts |
| `retryDelay` | Duration | 1s | Delay between retries |
| `headers` | Map | empty | Custom HTTP headers |

| Method | Description |
|--------|-------------|
| `timeout(duration)` | Set request timeout |
| `retries(max, delay)` | Configure retry behavior |
| `header(name, value)` | Add a custom header |
| `auth(token)` | Set Bearer authentication token |

### RpcPromise

| Method | Description |
|--------|-------------|
| `await()` | Execute the promise and return the result |
| `get(property)` | Navigate to a property (pipelining) |
| `then(method, args)` | Chain another RPC call |
| `toResult()` | Convert to Result for explicit error handling |

### Server-Side Operations

| Function | Description |
|----------|-------------|
| `RpcPromise<List<T>>.map(transform)` | Server-side map operation |
| `RpcPromise<List<T>>.filter(predicate)` | Server-side filter operation |
| `RpcPromise<List<T>>.flatMap(transform)` | Server-side flatMap operation |

### RpcException

| Type | Description |
|------|-------------|
| `ConnectionFailed` | Failed to establish connection |
| `MethodNotFound` | RPC method doesn't exist |
| `InvalidArguments` | Invalid arguments passed |
| `ServerError` | Server returned an error |
| `Timeout` | Request timed out |
| `Disconnected` | Client disconnected |

### Type-Safe Methods

| Function | Description |
|----------|-------------|
| `method<T>(name)` | Define a typed RPC method |
| `client.call(method, args)` | Call a typed method |
| `client.invoke(method, args)` | Invoke a typed method for pipelining |

---

## License

MIT

---

*rpc.do for Kotlin: Server-side operations, single round trips.*
