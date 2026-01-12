# {{name}}.do Scala SDK

{{description}}

## Installation

Add to your `build.sbt`:

```scala
libraryDependencies += "do.{{name}}" %% "{{name}}-do" % "0.1.0"
```

## Usage

```scala
import do_.{{name}}.{{Name}}Client
import cats.effect.IO
import cats.effect.unsafe.implicits.global

val client = {{Name}}Client(apiKey = sys.env.get("DOTDO_KEY"))

// Connect and use the client
val result = for {
  rpc <- client.connect()
  // Use rpc client...
  _ <- client.disconnect()
} yield ()

result.unsafeRunSync()
```

## Configuration

```scala
import do_.{{name}}.{{{Name}}Client, {{Name}}ClientOptions}

// Using options case class
val options = {{Name}}ClientOptions(
  apiKey = Some("your-api-key"),
  baseUrl = "https://{{name}}.do"
)
val client = new {{Name}}Client(options)

// Using apply method
val client2 = {{Name}}Client(
  apiKey = Some("your-api-key"),
  baseUrl = "https://custom.{{name}}.do"
)
```

## Development

```bash
# Compile
sbt compile

# Run tests
sbt test

# Package
sbt package
```

## License

MIT
