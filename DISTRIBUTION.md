# DotDo RPC Distribution Guide

This document covers package distribution across all supported languages and package managers.

## Domain Assets

We own hundreds of `.do` domains. Each domain maps directly to a package:

| Domain | Purpose | Package Pattern |
|--------|---------|-----------------|
| `platform.do` | Core platform | `platform.do` / `platform-do` |
| `rpc.do` | RPC client | `rpc.do` / `rpc-do` |
| `sdk.do` | SDK utilities | `sdk.do` / `sdk-do` |
| `mongo.do` | MongoDB client | `mongo.do` / `mongo-do` |
| `database.do` | Database ops | `database.do` / `database-do` |
| `agents.do` | AI agents | `agents.do` / `agents-do` |
| `functions.do` | Serverless | `functions.do` / `functions-do` |
| `workflows.do` | Workflows | `workflows.do` / `workflows-do` |

## Package Naming Strategy

### Registries That Allow Dots (Use `{name}.do`)

| Registry | Example Package | Install Command |
|----------|-----------------|-----------------|
| **npm** | `rpc.do` | `npm install rpc.do` |
| **RubyGems** | `rpc.do` | `gem install rpc.do` |
| **NuGet** | `Rpc.Do` | `dotnet add package Rpc.Do` |
| **Packagist** | `rpc.do/sdk` | `composer require rpc.do/sdk` |

### Registries That Don't Allow Dots (Use `{name}-do` or `{name}_do`)

| Registry | Example Package | Install Command |
|----------|-----------------|-----------------|
| **PyPI** | `rpc-do` | `pip install rpc-do` |
| **crates.io** | `rpc-do` | `cargo add rpc-do` |
| **pub.dev** | `rpc_do` | `dart pub add rpc_do` |
| **Hex** | `rpc_do` | `mix deps.get` with `{:rpc_do, "~> 0.1"}` |
| **Shards** | `rpc-do` | `shards install rpc-do` |
| **Nimble** | `rpcdo` | `nimble install rpcdo` |

### Domain-Based Registries (Use actual domain)

| Registry | Pattern | Example |
|----------|---------|---------|
| **Go Modules** | `go.{name}.do/*` | `go get go.rpc.do/sdk` |
| **Maven Central** | `do.{name}:*` | `do.rpc:sdk` |
| **Clojars** | `do.{name}/*` | `do.rpc/sdk` |

## Complete Package Matrix

### Core RPC Package (`rpc.do`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `rpc.do` | `npm install rpc.do` |
| Deno | `@dotdo/rpc` | `deno add @dotdo/rpc` |
| Python | `rpc-do` | `pip install rpc-do` |
| Rust | `rpc-do` | `cargo add rpc-do` |
| Go | `go.rpc.do` | `go get go.rpc.do` |
| Ruby | `rpc.do` | `gem install rpc.do` |
| Java | `do.rpc:sdk` | `implementation("do.rpc:sdk:0.1.0")` |
| Kotlin | `do.rpc:sdk` | `implementation("do.rpc:sdk:0.1.0")` |
| Scala | `do.rpc::sdk` | `"do.rpc" %% "sdk" % "0.1.0"` |
| C# | `Rpc.Do` | `dotnet add package Rpc.Do` |
| F# | `Rpc.Do` | `dotnet add package Rpc.Do` |
| PHP | `rpc.do/sdk` | `composer require rpc.do/sdk` |
| Swift | `RpcDo` | `.package(url: "https://github.com/dot-do/rpc")` |
| Dart | `rpc_do` | `dart pub add rpc_do` |
| Elixir | `:rpc_do` | `{:rpc_do, "~> 0.1.0"}` |
| Clojure | `do.rpc/sdk` | `do.rpc/sdk {:mvn/version "0.1.0"}` |
| Crystal | `rpc-do` | `shards install rpc-do` |
| Nim | `rpcdo` | `nimble install rpcdo` |

### MongoDB Client (`mongo.do`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `mongo.do` | `npm install mongo.do` |
| Python | `mongo-do` | `pip install mongo-do` |
| Rust | `mongo-do` | `cargo add mongo-do` |
| Go | `go.mongo.do` | `go get go.mongo.do` |
| Ruby | `mongo.do` | `gem install mongo.do` |
| Java | `do.mongo:sdk` | `implementation("do.mongo:sdk:0.1.0")` |
| C# | `Mongo.Do` | `dotnet add package Mongo.Do` |

### Database Client (`database.do`)

| Language | Package Name | Install Command |
|----------|--------------|-----------------|
| TypeScript | `database.do` | `npm install database.do` |
| Python | `database-do` | `pip install database-do` |
| Go | `go.database.do` | `go get go.database.do` |
| Java | `do.database:sdk` | `implementation("do.database:sdk:0.1.0")` |

## Repository Structure

Each `.do` domain gets its own repository, all scaffolded from the template in `dot-do/sdks`:

```
github.com/dot-do/
├── sdks/                   # THIS REPO - template + core RPC + multi-language SDKs
│   ├── template/           # Scaffold for new .do repos
│   │   ├── packages/       # All 17 language stubs
│   │   ├── scripts/        # Build, test, publish scripts
│   │   ├── .github/        # CI/CD workflows
│   │   └── test/           # Conformance test specs
│   ├── packages/           # rpc.do packages
│   │   ├── typescript/     # rpc.do (npm)
│   │   ├── python/         # rpc-do (PyPI)
│   │   └── ...
│   └── cli/                # `npx dotdo init mongo`
│
├── mongo/                  # mongo.do - scaffolded from template
│   ├── packages/
│   │   ├── typescript/     # mongo.do (npm)
│   │   ├── python/         # mongo-do (PyPI)
│   │   └── ...
│   └── test/
│
├── database/               # database.do
├── agents/                 # agents.do
├── functions/              # functions.do
└── workflows/              # workflows.do
```

## Registry Setup Requirements

### Domain-Based Registries

#### Go Modules (`go.{name}.do`)

Each domain needs vanity import setup. Example Cloudflare Worker for `go.rpc.do`:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pkg = url.pathname.split('/')[1] || '';
    const repo = pkg || 'rpc';

    return new Response(`<!DOCTYPE html>
<html>
<head>
<meta name="go-import" content="go.rpc.do${pkg ? '/' + pkg : ''} git https://github.com/dot-do/rpc">
<meta http-equiv="refresh" content="0; url=https://pkg.go.dev/go.rpc.do${pkg ? '/' + pkg : ''}">
</head>
</html>`, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
```

#### Maven Central (`do.{name}`)

For each domain, prove ownership and claim namespace:
1. Add TXT record: `TXT _sonatype OSSRH-XXXXXX` to `rpc.do`
2. Claim `do.rpc` group ID at https://central.sonatype.com

### Name-Based Registries

#### npm (`{name}.do`)

```bash
# Package names with dots are allowed
npm init --scope=@dotdo  # For scoped packages
npm publish              # For rpc.do, mongo.do, etc.
```

#### PyPI (`{name}-do`)

```bash
pip install build twine
python -m build
twine upload dist/*
```

## CI/CD Publishing

Each repo uses the same GitHub Actions workflow:

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
      - run: |
          cd packages/typescript
          npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-pypi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
      - run: |
          cd packages/python
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
      - run: |
          cd packages/rust
          cargo publish
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
      - run: |
          cd packages/java
          ./gradlew publish
        env:
          MAVEN_USERNAME: ${{ secrets.MAVEN_USERNAME }}
          MAVEN_PASSWORD: ${{ secrets.MAVEN_PASSWORD }}
          GPG_SIGNING_KEY: ${{ secrets.GPG_SIGNING_KEY }}

  publish-nuget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
      - run: |
          cd packages/dotnet
          dotnet pack -c Release
          dotnet nuget push **/*.nupkg --api-key ${{ secrets.NUGET_KEY }} --source https://api.nuget.org/v3/index.json

  publish-rubygems:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ruby/setup-ruby@v1
      - run: |
          cd packages/ruby
          gem build *.gemspec
          gem push *.gem
        env:
          GEM_HOST_API_KEY: ${{ secrets.RUBYGEMS_KEY }}

  publish-hex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: erlef/setup-beam@v1
        with:
          elixir-version: '1.15'
          otp-version: '26'
      - run: |
          cd packages/elixir
          mix hex.publish --yes
        env:
          HEX_API_KEY: ${{ secrets.HEX_KEY }}

  publish-pub:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dart-lang/setup-dart@v1
      - run: |
          cd packages/dart
          dart pub publish --force
```

## Quick Reference

### Package Naming by Registry Type

| Type | Registries | Pattern | Example |
|------|------------|---------|---------|
| **Dots allowed** | npm, RubyGems, NuGet, Packagist | `{name}.do` | `rpc.do` |
| **Hyphens only** | PyPI, crates.io, Shards | `{name}-do` | `rpc-do` |
| **Underscores** | pub.dev, Hex | `{name}_do` | `rpc_do` |
| **No separator** | Nimble | `{name}do` | `rpcdo` |
| **Domain-based** | Go, Maven, Clojars | `go.{name}.do`, `do.{name}:*` | `go.rpc.do` |

### Domain → Package Mapping

```
{name}.do domain
    ├── npm:        {name}.do
    ├── PyPI:       {name}-do
    ├── crates.io:  {name}-do
    ├── RubyGems:   {name}.do
    ├── NuGet:      {Name}.Do
    ├── Maven:      do.{name}:sdk
    ├── Go:         go.{name}.do
    ├── pub.dev:    {name}_do
    ├── Hex:        {name}_do
    └── Packagist:  {name}.do/sdk
```
