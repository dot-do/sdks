# dotdo CLI

CLI tool for scaffolding new .do domain repos from the template.

## Installation

```bash
npm install -g dotdo
```

Or use directly with npx:

```bash
npx dotdo init mongo
```

## Usage

### Initialize a new .do repo

```bash
# Create a new mongo.do repo
dotdo init mongo

# Create in a custom directory
dotdo init kafka --dir ./my-kafka-project

# Create and set up GitHub repo
dotdo init redis --github

# Create private GitHub repo in custom org
dotdo init queue --github --org mycompany --private

# With custom description
dotdo init mongo --description "MongoDB-compatible database SDK"
```

### Commands

| Command | Description |
|---------|-------------|
| `dotdo init <name>` | Scaffold a new .do domain repo |
| `dotdo list` | Show all supported SDK languages |
| `dotdo help` | Show help message |
| `dotdo version` | Show version |

### Options for `init`

| Option | Description |
|--------|-------------|
| `--dir <path>` | Target directory (default: `./<name>.do`) |
| `--description <text>` | Project description |
| `--github` | Create a GitHub repository using gh CLI |
| `--org <name>` | GitHub organization (default: `dot-do`) |
| `--private` | Make the GitHub repo private |

## Template Placeholders

The template uses placeholders that get replaced with your project name:

| Placeholder | Example (for `mongo`) |
|-------------|----------------------|
| `{{name}}` | `mongo` |
| `{{Name}}` | `Mongo` |
| `{{NAME}}` | `MONGO` |
| `{{name-do}}` | `mongo-do` |
| `{{name_do}}` | `mongo_do` |
| `{{name.do}}` | `mongo.do` |
| `{{description}}` | Project description |

## Supported Languages

The template generates SDKs for 17 programming languages:

| Language | Package Manager | Directory |
|----------|-----------------|-----------|
| TypeScript | npm | `packages/typescript` |
| Python | PyPI | `packages/python` |
| Go | Go modules | `packages/go` |
| Rust | Cargo | `packages/rust` |
| Java | Maven/Gradle | `packages/java` |
| Kotlin | Gradle | `packages/kotlin` |
| Ruby | RubyGems | `packages/ruby` |
| PHP | Composer | `packages/php` |
| C# (.NET) | NuGet | `packages/dotnet` |
| F# | NuGet | `packages/fsharp` |
| Swift | SwiftPM | `packages/swift` |
| Dart | pub.dev | `packages/dart` |
| Scala | sbt | `packages/scala` |
| Elixir | Hex | `packages/elixir` |
| Clojure | Clojars | `packages/clojure` |
| Crystal | Shards | `packages/crystal` |
| Nim | Nimble | `packages/nim` |

## Template Structure

The generated repo includes:

```
<name>.do/
  package.json           # Monorepo root
  README.md
  .gitignore
  packages/
    typescript/          # TypeScript SDK
      package.json
      src/index.ts
      tests/client.test.ts
    python/              # Python SDK
      pyproject.toml
      src/<name>_do/
      tests/
    go/                  # Go SDK
      go.mod
      client.go
      client_test.go
    rust/                # Rust SDK
      Cargo.toml
      src/lib.rs
      tests/
    java/                # Java SDK
      build.gradle.kts
      src/main/java/
    kotlin/              # Kotlin SDK
      build.gradle.kts
      src/main/kotlin/
    ... and 11 more languages
```

## Development

```bash
# Install dependencies
cd cli
npm install

# Build
npm run build

# Run locally
node dist/index.js init test

# Development mode
npm run dev
```

## Publishing

```bash
npm run build
npm publish
```

## License

MIT
