# Java & Kotlin Installation

The Java/Kotlin SDK provides type-safe access to Cap'n Web RPC on the JVM.

## Installation

### Maven

```xml
<dependency>
    <groupId>dev.capnweb</groupId>
    <artifactId>capnweb</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle (Groovy)

```groovy
implementation 'dev.capnweb:capnweb:0.1.0'
```

### Gradle (Kotlin DSL)

```kotlin
implementation("dev.capnweb:capnweb:0.1.0")
```

## Requirements

- Java 17 or later
- Kotlin 1.9+ (for Kotlin usage)

## Java Usage

### Basic Client

```java
import dev.capnweb.CapnWeb;
import dev.capnweb.RpcSession;

public class Example {
    public static void main(String[] args) {
        try (var session = CapnWeb.connect("wss://api.example.com")) {
            // Make RPC calls
            String greeting = session.call("greet", String.class, "World");
            System.out.println(greeting);  // "Hello, World!"
        }
    }
}
```

### Typed Stubs

```java
import dev.capnweb.CapnWeb;
import dev.capnweb.RpcTarget;

// Define your API interface
interface MyApi extends RpcTarget {
    String greet(String name);
    User getUser(int id);
}

record User(int id, String name, String email) {}

public class Example {
    public static void main(String[] args) {
        try (var session = CapnWeb.connect("wss://api.example.com")) {
            MyApi api = session.stub(MyApi.class);

            String greeting = api.greet("World");
            System.out.println(greeting);

            User user = api.getUser(123);
            System.out.println("User: " + user.name());
        }
    }
}
```

### Promise Pipelining

```java
import dev.capnweb.*;

public class Example {
    public static void main(String[] args) {
        try (var session = CapnWeb.connect("wss://api.example.com")) {
            // Start call without waiting
            var userPromise = session.callAsync("getUser", 123);

            // Pipeline another call
            var profile = session.call("getProfile", Profile.class,
                userPromise.field("id"));

            System.out.println("Profile: " + profile.name());
        }
    }
}
```

### Server Implementation

```java
import dev.capnweb.*;

class MyApiImpl extends RpcTarget implements MyApi {
    @Override
    public String greet(String name) {
        return "Hello, " + name + "!";
    }

    @Override
    public User getUser(int id) {
        return new User(id, "Alice", "alice@example.com");
    }
}

public class Server {
    public static void main(String[] args) {
        var server = new HttpServer(8080);
        server.addWebSocketHandler("/api", ws -> {
            CapnWeb.serve(ws, new MyApiImpl());
        });
        server.start();
    }
}
```

## Kotlin Usage

### Basic Client

```kotlin
import dev.capnweb.CapnWeb

fun main() {
    CapnWeb.connect("wss://api.example.com").use { session ->
        // Make RPC calls
        val greeting = session.call<String>("greet", "World")
        println(greeting)  // "Hello, World!"
    }
}
```

### Typed Stubs with Coroutines

```kotlin
import dev.capnweb.*
import kotlinx.coroutines.runBlocking

interface MyApi : RpcTarget {
    suspend fun greet(name: String): String
    suspend fun getUser(id: Int): User
}

data class User(val id: Int, val name: String, val email: String)

fun main() = runBlocking {
    CapnWeb.connect("wss://api.example.com").use { session ->
        val api = session.stub<MyApi>()

        val greeting = api.greet("World")
        println(greeting)

        val user = api.getUser(123)
        println("User: ${user.name}")
    }
}
```

### Promise Pipelining

```kotlin
import dev.capnweb.*
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    CapnWeb.connect("wss://api.example.com").use { session ->
        // Pipeline calls
        val user = session.callAsync("getUser", 123)
        val profile = session.call<Profile>("getProfile", user.field("id"))

        println("Profile: ${profile.name}")
    }
}
```

### Server Implementation

```kotlin
import dev.capnweb.*

class MyApiImpl : RpcTarget(), MyApi {
    override suspend fun greet(name: String): String {
        return "Hello, $name!"
    }

    override suspend fun getUser(id: Int): User {
        return User(id, "Alice", "alice@example.com")
    }
}

fun main() {
    val server = HttpServer(8080)
    server.addWebSocketHandler("/api") { ws ->
        CapnWeb.serve(ws, MyApiImpl())
    }
    server.start()
}
```

## Error Handling

### Java

```java
try (var session = CapnWeb.connect("wss://api.example.com")) {
    try {
        var result = session.call("riskyOperation", String.class);
    } catch (RpcException e) {
        System.err.println("RPC failed: " + e.getMessage());
    } catch (ConnectionException e) {
        System.err.println("Connection lost: " + e.getMessage());
    }
}
```

### Kotlin

```kotlin
CapnWeb.connect("wss://api.example.com").use { session ->
    try {
        val result = session.call<String>("riskyOperation")
    } catch (e: RpcException) {
        println("RPC failed: ${e.message}")
    } catch (e: ConnectionException) {
        println("Connection lost: ${e.message}")
    }
}
```

## Configuration Options

### Java

```java
var session = CapnWeb.builder("wss://api.example.com")
    .timeout(Duration.ofSeconds(30))
    .header("Authorization", "Bearer " + token)
    .reconnect(true)
    .build();
```

### Kotlin

```kotlin
val session = CapnWeb.connect("wss://api.example.com") {
    timeout = 30.seconds
    header("Authorization", "Bearer $token")
    reconnect = true
}
```

## HTTP Batch Mode

### Java

```java
try (var batch = CapnWeb.httpBatch("https://api.example.com")) {
    var greeting1 = batch.callAsync("greet", "Alice");
    var greeting2 = batch.callAsync("greet", "Bob");

    batch.execute();

    System.out.println(greeting1.get());
    System.out.println(greeting2.get());
}
```

### Kotlin

```kotlin
CapnWeb.httpBatch("https://api.example.com").use { batch ->
    val greeting1 = batch.callAsync("greet", "Alice")
    val greeting2 = batch.callAsync("greet", "Bob")

    batch.execute()

    println(greeting1.await())
    println(greeting2.await())
}
```

## Spring Integration

```java
@Configuration
public class CapnWebConfig {
    @Bean
    public RpcSession rpcSession() {
        return CapnWeb.connect(
            "wss://api.example.com",
            Duration.ofSeconds(30)
        );
    }
}

@Service
public class ApiService {
    private final RpcSession session;

    public ApiService(RpcSession session) {
        this.session = session;
    }

    public String greet(String name) {
        return session.call("greet", String.class, name);
    }
}
```

## Troubleshooting

### Resource Leaks

Always use try-with-resources:

```java
// WRONG - resource leak
var session = CapnWeb.connect("wss://...");
session.call("method", String.class);
// Session never closed!

// CORRECT - with try-with-resources
try (var session = CapnWeb.connect("wss://...")) {
    session.call("method", String.class);
}
```

### Type Errors

Ensure you pass the correct type parameter:

```java
// WRONG - missing type
var result = session.call("getUser", 123);

// CORRECT - with type
User result = session.call("getUser", User.class, 123);
```

### Kotlin Coroutines

Use `runBlocking` for main functions or call from suspend functions:

```kotlin
// WRONG - can't call suspend from non-suspend
fun main() {
    val api = session.stub<MyApi>()
    api.greet("World")  // Error!
}

// CORRECT - with runBlocking
fun main() = runBlocking {
    val api = session.stub<MyApi>()
    api.greet("World")
}
```
