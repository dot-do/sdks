# Installation

DotDo SDKs are available for multiple programming languages. Choose your language below to get started.

## Language Support Matrix

| Language | Package | Status | Installation |
|----------|---------|--------|--------------|
| TypeScript/JavaScript | `capnweb` | Stable | [Guide](/installation/typescript) |
| Python | `capnweb` | Beta | [Guide](/installation/python) |
| Go | `go.capnweb.do` | Beta | [Guide](/installation/go) |
| Rust | `capnweb` | Beta | [Guide](/installation/rust) |
| Ruby | `capnweb` | Alpha | [Guide](/installation/ruby) |
| Java | `dev.capnweb:capnweb` | Alpha | [Guide](/installation/java-kotlin) |
| Kotlin | `dev.capnweb:capnweb` | Alpha | [Guide](/installation/java-kotlin) |
| Swift | `CapnWeb` | Alpha | [Guide](/installation/swift) |
| C#/.NET | `CapnWeb` | Alpha | [Guide](/installation/dotnet) |
| F# | `CapnWeb` | Alpha | [Guide](/installation/dotnet) |
| Elixir | `:capnweb` | Alpha | [Guide](/installation/elixir) |
| Scala | `dev.capnweb::capnweb` | Alpha | [Guide](/installation/other) |
| PHP | `capnweb/capnweb` | Planned | [Guide](/installation/other) |
| Dart | `capnweb` | Planned | [Guide](/installation/other) |
| Clojure | `dev.capnweb/capnweb` | Planned | [Guide](/installation/other) |

## Status Legend

- **Stable**: Production-ready with full feature support
- **Beta**: Core features working, edge cases may be incomplete
- **Alpha**: Scaffolded, expect significant changes
- **Planned**: Structure exists, implementation pending

## Version Compatibility

All packages are versioned together at **0.1.0**. This unified versioning ensures compatibility across all language implementations when used together.

## Quick Install

::: code-group

```bash [TypeScript/JavaScript]
npm install capnweb
```

```bash [Python]
pip install capnweb
```

```bash [Go]
go get go.capnweb.do
```

```bash [Rust]
cargo add capnweb
```

```bash [Ruby]
gem install capnweb
```

```xml [Java (Maven)]
<dependency>
    <groupId>dev.capnweb</groupId>
    <artifactId>capnweb</artifactId>
    <version>0.1.0</version>
</dependency>
```

```kotlin [Kotlin (Gradle)]
implementation("dev.capnweb:capnweb:0.1.0")
```

```bash [.NET]
dotnet add package CapnWeb
```

```swift [Swift (SPM)]
.package(url: "https://github.com/dot-do/capnweb-swift", from: "0.1.0")
```

```elixir [Elixir]
{:capnweb, "~> 0.1"}
```

:::

## Package Layers

Each language provides multiple package layers:

| Layer | Purpose | Example (TypeScript) |
|-------|---------|---------------------|
| **capnweb** | Low-level protocol | `capnweb` |
| **rpc** | Magic proxy with pipelining | `rpc.do` |
| **platform** | Managed connections | `dotdo` |
| **domain** | API-specific wrappers | `mongo.do` |

For most use cases, start with the `capnweb` package. Use higher-level packages when you need managed features like automatic retries and connection pooling.

## Requirements

### TypeScript/JavaScript
- Node.js 18+ or compatible runtime
- ES2022+ for `using` declarations (or transpiler)

### Python
- Python 3.10+
- `asyncio` support

### Go
- Go 1.21+

### Rust
- Rust 1.70+
- Tokio runtime

### Other Languages
See individual installation guides for requirements.
