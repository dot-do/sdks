# do.{{name}}:sdk (Kotlin)

{{description}}

## Installation

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("do.{{name}}:sdk:0.1.0")
}
```

### Gradle (Groovy)

```groovy
dependencies {
    implementation 'do.{{name}}:sdk:0.1.0'
}
```

## Usage

```kotlin
import do_.{{name}}.{{Name}}Client

suspend fun main() {
    val client = {{Name}}Client(System.getenv("DOTDO_KEY"))
    val rpc = client.connect()

    // Use the RPC client...

    client.close()
}
```

### With Coroutines

```kotlin
import do_.{{name}}.{{Name}}Client
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    {{Name}}Client(System.getenv("DOTDO_KEY")).use { client ->
        val rpc = client.connect()
        // Use the RPC client...
    }
}
```

## API Reference

### `{{Name}}Client`

The main client class for interacting with the {{name}}.do service.

#### Constructor Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | `String?` | `null` | API key for authentication |
| `baseUrl` | `String` | `https://{{name}}.do` | Base URL for the service |

#### Methods

- `suspend fun connect(): RpcClient` - Connect to the service and return an RPC client
- `suspend fun disconnect()` - Disconnect from the service
- `fun close()` - Close the connection (AutoCloseable)

## Running Tests

```bash
./gradlew test
```

## Building

```bash
./gradlew build
```

## License

MIT
