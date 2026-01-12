# DotDo RPC Distribution Guide

This document covers package distribution across all supported languages and package managers.

## Domain Assets

| Domain | Purpose |
|--------|---------|
| `dot-do.com` | Primary domain for package namespaces |
| `platform.do` | Platform services |
| `do.org.ai` | AI-focused services |

## Package Manager Overview

### Registries WITH Namespaces/Organizations

These registries support scoped/namespaced packages, giving us guaranteed ownership of all packages under our namespace.

| Language | Registry | URL | Namespace Format | Our Namespace |
|----------|----------|-----|------------------|---------------|
| TypeScript/JS | npm | https://www.npmjs.com | `@org/package` | `@dot-do/*` |
| Deno | JSR | https://jsr.io | `@scope/package` | `@dot-do/*` |
| Java | Maven Central | https://central.sonatype.com | `groupId:artifactId` | `com.dot-do:*` |
| Kotlin | Maven Central | https://central.sonatype.com | `groupId:artifactId` | `com.dot-do:*` |
| Scala | Maven Central | https://central.sonatype.com | `org::package` | `com.dot-do::*` |
| C#/.NET | NuGet | https://www.nuget.org | `Org.Package` | `DotDo.*` |
| F# | NuGet | https://www.nuget.org | `Org.Package` | `DotDo.*` |
| Go | Go Modules | https://pkg.go.dev | `domain/path` | `go.dot-do.com/*` |
| PHP | Packagist | https://packagist.org | `vendor/package` | `dot-do/*` |
| Clojure | Clojars | https://clojars.org | `group/artifact` | `com.dot-do/*` |

### Registries WITHOUT Namespaces

These registries use flat naming. We need to register each package name individually.

| Language | Registry | URL | Convention | Our Prefix |
|----------|----------|-----|------------|------------|
| Python | PyPI | https://pypi.org | `prefix-package` | `dotdo-*` |
| Rust | crates.io | https://crates.io | `prefix-package` | `dotdo-*` |
| Ruby | RubyGems | https://rubygems.org | `prefix-package` | `dotdo-*` |
| Swift | Swift Package Index | https://swiftpackageindex.com | `PrefixPackage` | `DotDo*` |
| Dart | pub.dev | https://pub.dev | `prefix_package` | `dotdo_*` |
| Elixir | Hex | https://hex.pm | `:prefix_package` | `:dotdo_*` |
| Crystal | Shards | https://shardbox.org | `prefix-package` | `dotdo-*` |
| Nim | Nimble | https://nimble.directory | `prefixpackage` | `dotdo*` |

## Complete Package Names

### Layer 1: Protocol (`capnweb`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `@dot-do/capnweb` | `npm install @dot-do/capnweb` |
| Deno | `@dot-do/capnweb` | `deno add @dot-do/capnweb` |
| Python | `dotdo-capnweb` | `pip install dotdo-capnweb` |
| Rust | `dotdo-capnweb` | `cargo add dotdo-capnweb` |
| Go | `go.dot-do.com/capnweb` | `go get go.dot-do.com/capnweb` |
| Ruby | `dotdo-capnweb` | `gem install dotdo-capnweb` |
| Java | `com.dot-do:capnweb` | `implementation("com.dot-do:capnweb:0.1.0")` |
| Kotlin | `com.dot-do:capnweb` | `implementation("com.dot-do:capnweb:0.1.0")` |
| Scala | `com.dot-do::capnweb` | `"com.dot-do" %% "capnweb" % "0.1.0"` |
| C# | `DotDo.CapnWeb` | `dotnet add package DotDo.CapnWeb` |
| F# | `DotDo.CapnWeb` | `dotnet add package DotDo.CapnWeb` |
| PHP | `dot-do/capnweb` | `composer require dot-do/capnweb` |
| Swift | `DotDoCapnWeb` | `.package(url: "https://github.com/dot-do/capnweb-swift")` |
| Dart | `dotdo_capnweb` | `dart pub add dotdo_capnweb` |
| Elixir | `:dotdo_capnweb` | `{:dotdo_capnweb, "~> 0.1.0"}` |
| Clojure | `com.dot-do/capnweb` | `com.dot-do/capnweb {:mvn/version "0.1.0"}` |
| Crystal | `dotdo-capnweb` | `shards install dotdo-capnweb` |
| Nim | `dotdocapnweb` | `nimble install dotdocapnweb` |

### Layer 2: RPC Client (`rpc`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `@dot-do/rpc` | `npm install @dot-do/rpc` |
| Deno | `@dot-do/rpc` | `deno add @dot-do/rpc` |
| Python | `dotdo-rpc` | `pip install dotdo-rpc` |
| Rust | `dotdo-rpc` | `cargo add dotdo-rpc` |
| Go | `go.dot-do.com/rpc` | `go get go.dot-do.com/rpc` |
| Ruby | `dotdo-rpc` | `gem install dotdo-rpc` |
| Java | `com.dot-do:rpc` | `implementation("com.dot-do:rpc:0.1.0")` |
| Kotlin | `com.dot-do:rpc` | `implementation("com.dot-do:rpc:0.1.0")` |
| Scala | `com.dot-do::rpc` | `"com.dot-do" %% "rpc" % "0.1.0"` |
| C# | `DotDo.Rpc` | `dotnet add package DotDo.Rpc` |
| F# | `DotDo.Rpc` | `dotnet add package DotDo.Rpc` |
| PHP | `dot-do/rpc` | `composer require dot-do/rpc` |
| Swift | `DotDoRpc` | `.package(url: "https://github.com/dot-do/rpc-swift")` |
| Dart | `dotdo_rpc` | `dart pub add dotdo_rpc` |
| Elixir | `:dotdo_rpc` | `{:dotdo_rpc, "~> 0.1.0"}` |
| Clojure | `com.dot-do/rpc` | `com.dot-do/rpc {:mvn/version "0.1.0"}` |
| Crystal | `dotdo-rpc` | `shards install dotdo-rpc` |
| Nim | `dotdorpc` | `nimble install dotdorpc` |

### Layer 3: Platform (`dotdo`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `dotdo` | `npm install dotdo` |
| Deno | `dotdo` | `deno add dotdo` |
| Python | `dotdo` | `pip install dotdo` |
| Rust | `dotdo` | `cargo add dotdo` |
| Go | `go.dot-do.com/dotdo` | `go get go.dot-do.com/dotdo` |
| Ruby | `dotdo` | `gem install dotdo` |
| Java | `com.dot-do:core` | `implementation("com.dot-do:core:0.1.0")` |
| Kotlin | `com.dot-do:core` | `implementation("com.dot-do:core:0.1.0")` |
| Scala | `com.dot-do::core` | `"com.dot-do" %% "core" % "0.1.0"` |
| C# | `DotDo` | `dotnet add package DotDo` |
| F# | `DotDo` | `dotnet add package DotDo` |
| PHP | `dot-do/dotdo` | `composer require dot-do/dotdo` |
| Swift | `DotDo` | `.package(url: "https://github.com/dot-do/dotdo-swift")` |
| Dart | `dotdo` | `dart pub add dotdo` |
| Elixir | `:dotdo` | `{:dotdo, "~> 0.1.0"}` |
| Clojure | `com.dot-do/core` | `com.dot-do/core {:mvn/version "0.1.0"}` |
| Crystal | `dotdo` | `shards install dotdo` |
| Nim | `dotdo` | `nimble install dotdo` |

## Future Domain Packages

These packages will live in separate repositories and provide API-compatible interfaces to popular services.

| Package | TypeScript | Python | Go | Java |
|---------|------------|--------|-----|------|
| MongoDB | `@dot-do/mongo` | `dotdo-mongo` | `go.dot-do.com/mongo` | `com.dot-do:mongo` |
| Kafka | `@dot-do/kafka` | `dotdo-kafka` | `go.dot-do.com/kafka` | `com.dot-do:kafka` |
| Redis | `@dot-do/redis` | `dotdo-redis` | `go.dot-do.com/redis` | `com.dot-do:redis` |
| Database | `@dot-do/db` | `dotdo-db` | `go.dot-do.com/db` | `com.dot-do:db` |
| Agents | `@dot-do/agents` | `dotdo-agents` | `go.dot-do.com/agents` | `com.dot-do:agents` |

## Registry Setup Requirements

### Domain-Based Registries

#### Go Modules (`go.dot-do.com`)

Set up vanity imports by serving a meta tag at `go.dot-do.com`:

```html
<!-- https://go.dot-do.com/capnweb?go-get=1 -->
<meta name="go-import" content="go.dot-do.com/capnweb git https://github.com/dot-do/rpc">
```

Options:
1. **Static hosting**: Serve HTML files with meta tags
2. **Redirect service**: Use a Go vanity URL service
3. **GitHub Pages**: Host at `dot-do.github.io` with custom domain

#### Maven Central (`com.dot-do`)

To publish to Maven Central with `com.dot-do` group ID:

1. **Prove domain ownership**: Add TXT record to `dot-do.com`
2. **Create Sonatype account**: https://central.sonatype.com
3. **Request namespace**: Claim `com.dot-do` group ID
4. **Sign packages**: Set up GPG signing

Alternative: Use `io.github.dot-do` (no domain proof needed)

### Name-Based Registries

#### npm (`@dot-do`)

```bash
# Create organization (requires npm account)
npm org create dot-do

# Publish scoped package
npm publish --access public
```

#### PyPI (`dotdo-*`)

```bash
# Register account at pypi.org
# Claim package names by publishing

pip install build twine
python -m build
twine upload dist/*
```

**Reserved names to claim early:**
- `dotdo`
- `dotdo-capnweb`
- `dotdo-rpc`
- `dotdo-db`
- `dotdo-mongo`
- `dotdo-kafka`
- `dotdo-redis`
- `dotdo-agents`

#### crates.io (`dotdo-*`)

```bash
# Login with GitHub
cargo login

# Publish
cargo publish
```

**Reserved names to claim early:** Same as PyPI

#### RubyGems (`dotdo-*`)

```bash
gem push dotdo-capnweb-0.1.0.gem
```

#### NuGet (`DotDo.*`)

```bash
# Create account at nuget.org
# Reserve prefix "DotDo." in account settings

dotnet nuget push DotDo.CapnWeb.0.1.0.nupkg --api-key YOUR_KEY --source https://api.nuget.org/v3/index.json
```

#### Packagist (`dot-do/*`)

1. Create account at https://packagist.org
2. Submit GitHub repository URL
3. Packagist auto-detects `composer.json`

#### Hex (`:dotdo_*`)

```bash
mix hex.publish
```

#### pub.dev (`dotdo_*`)

```bash
dart pub publish
```

## GitHub Repository Structure

```
github.com/dot-do/
├── rpc/                    # This repo - core RPC packages (all 17 languages)
│   ├── packages/
│   │   ├── typescript/
│   │   │   ├── capnweb/    # @dot-do/capnweb
│   │   │   ├── rpc/        # @dot-do/rpc
│   │   │   └── dotdo/      # dotdo
│   │   ├── python/
│   │   └── ...
│   └── ...
│
├── mongo/                  # MongoDB-compatible client
│   ├── packages/
│   │   ├── typescript/     # @dot-do/mongo
│   │   ├── python/         # dotdo-mongo
│   │   └── ...
│   └── ...
│
├── kafka/                  # Kafka-compatible client
├── redis/                  # Redis-compatible client
├── db/                     # Database operations
└── agents/                 # AI agent orchestration
```

## CI/CD Publishing

### GitHub Actions Workflow

```yaml
name: Publish Packages

on:
  release:
    types: [published]

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-pypi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: |
          pip install build twine
          python -m build
          twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}

  publish-crates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo publish
        env:
          CARGO_REGISTRY_TOKEN: ${{ secrets.CRATES_TOKEN }}

  # ... additional jobs for each registry
```

## Package Name Reservation Checklist

Priority order for claiming package names:

### Immediate (Before Public Announcement)

- [ ] npm: `@dot-do` organization + `dotdo` package
- [ ] PyPI: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] crates.io: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] NuGet: Reserve `DotDo.` prefix
- [ ] Maven Central: Claim `com.dot-do` namespace

### Before First Release

- [ ] RubyGems: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] Packagist: `dot-do/*`
- [ ] pub.dev: `dotdo`, `dotdo_capnweb`, `dotdo_rpc`
- [ ] Hex: `dotdo`, `dotdo_capnweb`, `dotdo_rpc`
- [ ] Clojars: `com.dot-do/*`
- [ ] JSR: `@dot-do/*`

### Domain Setup

- [ ] `go.dot-do.com` - Go vanity imports
- [ ] `docs.dot-do.com` - Documentation
- [ ] `status.dot-do.com` - Status page
