# DotDo RPC Distribution Guide

This document covers package distribution across all supported languages and package managers.

## Domain Assets

| Domain | Purpose |
|--------|---------|
| `platform.do` | Primary domain for domain-based package namespaces |
| `dot-do.com` | Corporate/marketing site |
| `do.org.ai` | AI-focused services |

## Package Manager Overview

### Registries WITH Domain-Based Namespaces

These registries use actual domain names for namespacing. We use `platform.do` → `do.platform`.

| Language | Registry | URL | Namespace Format | Our Namespace |
|----------|----------|-----|------------------|---------------|
| Go | Go Modules | https://pkg.go.dev | `domain/path` | `go.platform.do/*` |
| Java | Maven Central | https://central.sonatype.com | `groupId:artifactId` | `do.platform:*` |
| Kotlin | Maven Central | https://central.sonatype.com | `groupId:artifactId` | `do.platform:*` |
| Scala | Maven Central | https://central.sonatype.com | `org::package` | `do.platform::*` |
| Clojure | Clojars | https://clojars.org | `group/artifact` | `do.platform/*` |

### Registries WITH Name-Based Namespaces

These registries have scoped packages but the scope is just a registered name, not a domain.

| Language | Registry | URL | Namespace Format | Our Namespace |
|----------|----------|-----|------------------|---------------|
| TypeScript/JS | npm | https://www.npmjs.com | `@org/package` | `@dotdo/*` |
| Deno | JSR | https://jsr.io | `@scope/package` | `@dotdo/*` |
| C#/.NET | NuGet | https://www.nuget.org | `Org.Package` | `DotDo.*` |
| F# | NuGet | https://www.nuget.org | `Org.Package` | `DotDo.*` |
| PHP | Packagist | https://packagist.org | `vendor/package` | `dotdo/*` |

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
| TypeScript | `@dotdo/capnweb` | `npm install @dotdo/capnweb` |
| Deno | `@dotdo/capnweb` | `deno add @dotdo/capnweb` |
| Python | `dotdo-capnweb` | `pip install dotdo-capnweb` |
| Rust | `dotdo-capnweb` | `cargo add dotdo-capnweb` |
| Go | `go.platform.do/capnweb` | `go get go.platform.do/capnweb` |
| Ruby | `dotdo-capnweb` | `gem install dotdo-capnweb` |
| Java | `do.platform:capnweb` | `implementation("do.platform:capnweb:0.1.0")` |
| Kotlin | `do.platform:capnweb` | `implementation("do.platform:capnweb:0.1.0")` |
| Scala | `do.platform::capnweb` | `"do.platform" %% "capnweb" % "0.1.0"` |
| C# | `DotDo.CapnWeb` | `dotnet add package DotDo.CapnWeb` |
| F# | `DotDo.CapnWeb` | `dotnet add package DotDo.CapnWeb` |
| PHP | `dotdo/capnweb` | `composer require dotdo/capnweb` |
| Swift | `DotDoCapnWeb` | `.package(url: "https://github.com/dot-do/capnweb-swift")` |
| Dart | `dotdo_capnweb` | `dart pub add dotdo_capnweb` |
| Elixir | `:dotdo_capnweb` | `{:dotdo_capnweb, "~> 0.1.0"}` |
| Clojure | `do.platform/capnweb` | `do.platform/capnweb {:mvn/version "0.1.0"}` |
| Crystal | `dotdo-capnweb` | `shards install dotdo-capnweb` |
| Nim | `dotdocapnweb` | `nimble install dotdocapnweb` |

### Layer 2: RPC Client (`rpc`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `@dotdo/rpc` | `npm install @dotdo/rpc` |
| Deno | `@dotdo/rpc` | `deno add @dotdo/rpc` |
| Python | `dotdo-rpc` | `pip install dotdo-rpc` |
| Rust | `dotdo-rpc` | `cargo add dotdo-rpc` |
| Go | `go.platform.do/rpc` | `go get go.platform.do/rpc` |
| Ruby | `dotdo-rpc` | `gem install dotdo-rpc` |
| Java | `do.platform:rpc` | `implementation("do.platform:rpc:0.1.0")` |
| Kotlin | `do.platform:rpc` | `implementation("do.platform:rpc:0.1.0")` |
| Scala | `do.platform::rpc` | `"do.platform" %% "rpc" % "0.1.0"` |
| C# | `DotDo.Rpc` | `dotnet add package DotDo.Rpc` |
| F# | `DotDo.Rpc` | `dotnet add package DotDo.Rpc` |
| PHP | `dotdo/rpc` | `composer require dotdo/rpc` |
| Swift | `DotDoRpc` | `.package(url: "https://github.com/dot-do/rpc-swift")` |
| Dart | `dotdo_rpc` | `dart pub add dotdo_rpc` |
| Elixir | `:dotdo_rpc` | `{:dotdo_rpc, "~> 0.1.0"}` |
| Clojure | `do.platform/rpc` | `do.platform/rpc {:mvn/version "0.1.0"}` |
| Crystal | `dotdo-rpc` | `shards install dotdo-rpc` |
| Nim | `dotdorpc` | `nimble install dotdorpc` |

### Layer 3: Platform (`dotdo`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `dotdo` | `npm install dotdo` |
| Deno | `dotdo` | `deno add dotdo` |
| Python | `dotdo` | `pip install dotdo` |
| Rust | `dotdo` | `cargo add dotdo` |
| Go | `go.platform.do/dotdo` | `go get go.platform.do/dotdo` |
| Ruby | `dotdo` | `gem install dotdo` |
| Java | `do.platform:core` | `implementation("do.platform:core:0.1.0")` |
| Kotlin | `do.platform:core` | `implementation("do.platform:core:0.1.0")` |
| Scala | `do.platform::core` | `"do.platform" %% "core" % "0.1.0"` |
| C# | `DotDo` | `dotnet add package DotDo` |
| F# | `DotDo` | `dotnet add package DotDo` |
| PHP | `dotdo/dotdo` | `composer require dotdo/dotdo` |
| Swift | `DotDo` | `.package(url: "https://github.com/dot-do/dotdo-swift")` |
| Dart | `dotdo` | `dart pub add dotdo` |
| Elixir | `:dotdo` | `{:dotdo, "~> 0.1.0"}` |
| Clojure | `do.platform/core` | `do.platform/core {:mvn/version "0.1.0"}` |
| Crystal | `dotdo` | `shards install dotdo` |
| Nim | `dotdo` | `nimble install dotdo` |

## Future Domain Packages

These packages will live in separate repositories and provide API-compatible interfaces to popular services.

| Package | TypeScript | Python | Go | Java |
|---------|------------|--------|-----|------|
| MongoDB | `@dotdo/mongo` | `dotdo-mongo` | `go.platform.do/mongo` | `do.platform:mongo` |
| Kafka | `@dotdo/kafka` | `dotdo-kafka` | `go.platform.do/kafka` | `do.platform:kafka` |
| Redis | `@dotdo/redis` | `dotdo-redis` | `go.platform.do/redis` | `do.platform:redis` |
| Database | `@dotdo/db` | `dotdo-db` | `go.platform.do/db` | `do.platform:db` |
| Agents | `@dotdo/agents` | `dotdo-agents` | `go.platform.do/agents` | `do.platform:agents` |

## Registry Setup Requirements

### Domain-Based Registries

#### Go Modules (`go.platform.do`)

Set up vanity imports by serving a meta tag at `go.platform.do`:

```html
<!-- https://go.platform.do/capnweb?go-get=1 -->
<meta name="go-import" content="go.platform.do/capnweb git https://github.com/dot-do/rpc">
```

Options:
1. **Static hosting**: Serve HTML files with meta tags
2. **Cloudflare Workers**: Simple worker to serve meta tags
3. **GitHub Pages**: Host at `dot-do.github.io` with custom domain

Example Cloudflare Worker:
```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pkg = url.pathname.split('/')[1] || 'rpc';

    return new Response(`<!DOCTYPE html>
<html>
<head>
<meta name="go-import" content="go.platform.do/${pkg} git https://github.com/dot-do/${pkg}">
<meta http-equiv="refresh" content="0; url=https://pkg.go.dev/go.platform.do/${pkg}">
</head>
</html>`, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
```

#### Maven Central (`do.platform`)

To publish to Maven Central with `do.platform` group ID:

1. **Prove domain ownership**: Add TXT record to `platform.do`
   ```
   TXT  _sonatype  OSSRH-XXXXXX
   ```
2. **Create Sonatype account**: https://central.sonatype.com
3. **Request namespace**: Claim `do.platform` group ID
4. **Sign packages**: Set up GPG signing

#### Clojars (`do.platform`)

Clojars doesn't require domain verification. Just use the group ID:
```clojure
;; deps.edn
{:deps {do.platform/rpc {:mvn/version "0.1.0"}}}
```

### Name-Based Registries

#### npm (`@dotdo`)

```bash
# Create organization (requires npm account)
npm org create dotdo

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

#### Packagist (`dotdo/*`)

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
│   │   │   ├── capnweb/    # @dotdo/capnweb
│   │   │   ├── rpc/        # @dotdo/rpc
│   │   │   └── dotdo/      # dotdo
│   │   ├── python/
│   │   └── ...
│   └── ...
│
├── mongo/                  # MongoDB-compatible client
│   ├── packages/
│   │   ├── typescript/     # @dotdo/mongo
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

  publish-maven:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
      - run: ./gradlew publish
        env:
          MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
          MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
          GPG_SIGNING_KEY: ${{ secrets.GPG_SIGNING_KEY }}
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}

  # ... additional jobs for each registry
```

## Package Name Reservation Checklist

Priority order for claiming package names:

### Immediate (Before Public Announcement)

- [ ] npm: `@dotdo` organization + `dotdo` package
- [ ] PyPI: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] crates.io: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] NuGet: Reserve `DotDo.` prefix
- [ ] Maven Central: Claim `do.platform` namespace (prove `platform.do` ownership)

### Before First Release

- [ ] RubyGems: `dotdo`, `dotdo-capnweb`, `dotdo-rpc`
- [ ] Packagist: `dotdo/*`
- [ ] pub.dev: `dotdo`, `dotdo_capnweb`, `dotdo_rpc`
- [ ] Hex: `dotdo`, `dotdo_capnweb`, `dotdo_rpc`
- [ ] Clojars: `do.platform/*`
- [ ] JSR: `@dotdo/*`

### Domain Setup

- [ ] `go.platform.do` - Go vanity imports (Cloudflare Worker or static)
- [ ] `platform.do` TXT record - Maven Central verification
- [ ] `docs.platform.do` - Documentation
- [ ] `status.platform.do` - Status page

## Quick Reference: Namespace Types

| Type | Registries | Our Pattern |
|------|------------|-------------|
| **Domain-based** | Go, Maven, Clojars | `do.platform:*` / `go.platform.do/*` |
| **Name-scoped** | npm, JSR, NuGet, Packagist | `@dotdo/*` / `DotDo.*` / `dotdo/*` |
| **Flat naming** | PyPI, crates.io, RubyGems, pub.dev, Hex, Shards, Nimble | `dotdo-*` / `dotdo_*` |
