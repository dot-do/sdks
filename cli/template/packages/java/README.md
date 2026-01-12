# do.{{name}}:sdk

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

### Maven

```xml
<dependency>
    <groupId>do.{{name}}</groupId>
    <artifactId>sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Usage

```java
import do_.{{name}}.{{Name}}Client;

public class Example {
    public static void main(String[] args) throws Exception {
        try (var client = new {{Name}}Client(System.getenv("DOTDO_KEY"))) {
            var rpc = client.connect();
            // Use the RPC client...
        }
    }
}
```

## API Reference

### `{{Name}}Client`

The main client class for interacting with the {{name}}.do service.

#### Constructors

- `{{Name}}Client(String apiKey)` - Create a new client with an API key
- `{{Name}}Client(String apiKey, String baseUrl)` - Create a new client with a custom base URL

#### Methods

- `connect()` - Connect to the service and return an RPC client
- `close()` - Close the connection to the service

## Running Tests

```bash
./gradlew test
```

## Building

```bash
./gradlew build
```

## Publishing

```bash
./gradlew publish
```

## License

MIT
