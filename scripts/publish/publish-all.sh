#!/bin/bash
# publish-all.sh - Multi-platform package publishing with idempotent version checking
#
# Usage:
#   ./publish-all.sh <version>           # Publish to all registries
#   ./publish-all.sh <version> --dry-run # Check versions without publishing
#   ./publish-all.sh <version> --lang=ts,py,rust  # Only specific languages

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse arguments
VERSION=""
DRY_RUN=false
LANGUAGES=""
VERBOSE=false

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      ;;
    --verbose)
      VERBOSE=true
      ;;
    --lang=*)
      LANGUAGES="${arg#*=}"
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
    *)
      VERSION="$arg"
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version> [--dry-run] [--lang=ts,py,rust,...] [--verbose]"
  echo ""
  echo "Languages: ts, py, rust, go, ruby, java, kotlin, scala, swift, dart, elixir, clojure, crystal, nim, deno, php, csharp, fsharp"
  exit 1
fi

# Track results (compatible with bash 3.x)
RESULTS_FILE=$(mktemp)
trap "rm -f $RESULTS_FILE" EXIT
FAILED=0
SKIPPED=0
PUBLISHED=0

add_result() {
  echo "$1|$2" >> "$RESULTS_FILE"
}

log() {
  echo -e "${CYAN}[publish]${NC} $*"
}

log_success() {
  echo -e "${GREEN}[success]${NC} $*"
}

log_skip() {
  echo -e "${YELLOW}[skip]${NC} $*"
}

log_error() {
  echo -e "${RED}[error]${NC} $*"
}

log_section() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE} $*${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Check if language should be published
should_publish_lang() {
  local lang="$1"
  if [[ -z "$LANGUAGES" ]]; then
    return 0  # All languages
  fi
  [[ ",$LANGUAGES," == *",$lang,"* ]]
}

# Run version check
version_exists() {
  local registry="$1"
  local package="$2"
  local version="$3"
  "$SCRIPT_DIR/version-check.sh" "$registry" "$package" "$version"
}

# Execute or dry-run a command
run_cmd() {
  if $DRY_RUN; then
    echo -e "  ${YELLOW}[dry-run]${NC} $*"
    return 0
  else
    "$@"
  fi
}

# ═══════════════════════════════════════════════════════════════
# TypeScript / npm
# ═══════════════════════════════════════════════════════════════
publish_typescript() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local npm_name="$3"

  log "Publishing $npm_name to npm..."

  if version_exists npm "$npm_name" "$VERSION"; then
    add_result "npm:$npm_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in package.json
  run_cmd npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null || true

  # Build if needed
  if [[ -f "tsconfig.json" ]]; then
    run_cmd npm run build 2>/dev/null || true
  fi

  # Publish
  if run_cmd npm publish --access public; then
    add_result "npm:$npm_name" "published"
    ((PUBLISHED++)) || true
    log_success "$npm_name@$VERSION published to npm"
  else
    add_result "npm:$npm_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to publish $npm_name to npm"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Python / PyPI
# ═══════════════════════════════════════════════════════════════
publish_python() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local pypi_name="$3"

  log "Publishing $pypi_name to PyPI..."

  if version_exists pypi "$pypi_name" "$VERSION"; then
    add_result "pypi:$pypi_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in pyproject.toml
  if [[ -f "pyproject.toml" ]]; then
    run_cmd sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml 2>/dev/null || \
    run_cmd sed -i "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml
  fi

  # Clean and build
  run_cmd rm -rf dist/ build/ *.egg-info
  if run_cmd python -m build; then
    # Upload
    if run_cmd python -m twine upload dist/* --skip-existing; then
      add_result "pypi:$pypi_name" "published"
      ((PUBLISHED++)) || true
      log_success "$pypi_name==$VERSION published to PyPI"
    else
      add_result "pypi:$pypi_name" "failed"
      ((FAILED++)) || true
      log_error "Failed to upload $pypi_name to PyPI"
    fi
  else
    add_result "pypi:$pypi_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to build $pypi_name"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Rust / crates.io
# ═══════════════════════════════════════════════════════════════
publish_rust() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local crate_name="$3"

  log "Publishing $crate_name to crates.io..."

  if version_exists crates "$crate_name" "$VERSION"; then
    add_result "crates:$crate_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in Cargo.toml
  run_cmd sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" Cargo.toml 2>/dev/null || \
  run_cmd sed -i "s/^version = \".*\"/version = \"$VERSION\"/" Cargo.toml

  # Publish
  if run_cmd cargo publish --allow-dirty; then
    add_result "crates:$crate_name" "published"
    ((PUBLISHED++)) || true
    log_success "$crate_name@$VERSION published to crates.io"
  else
    add_result "crates:$crate_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to publish $crate_name to crates.io"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Go - Just needs git tag, auto-indexed
# ═══════════════════════════════════════════════════════════════
publish_go() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local module_path="$3"

  log "Preparing $module_path for Go proxy..."

  # Go modules are indexed from git tags automatically
  # We just need to ensure the tag exists
  log_success "$module_path will be indexed when v$VERSION tag is pushed"
  add_result "go:$module_path" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# Ruby / RubyGems
# ═══════════════════════════════════════════════════════════════
publish_ruby() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local gem_name="$3"

  log "Publishing $gem_name to RubyGems..."

  if version_exists rubygems "$gem_name" "$VERSION"; then
    add_result "rubygems:$gem_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Find and update version file
  local version_file=$(find lib -name "version.rb" 2>/dev/null | head -1)
  if [[ -n "$version_file" ]]; then
    run_cmd sed -i '' "s/VERSION = .*/VERSION = '$VERSION'/" "$version_file" 2>/dev/null || \
    run_cmd sed -i "s/VERSION = .*/VERSION = '$VERSION'/" "$version_file"
  fi

  # Update gemspec version
  local gemspec=$(ls *.gemspec 2>/dev/null | head -1)
  if [[ -n "$gemspec" ]]; then
    run_cmd sed -i '' "s/spec.version.*=.*/spec.version = '$VERSION'/" "$gemspec" 2>/dev/null || \
    run_cmd sed -i "s/spec.version.*=.*/spec.version = '$VERSION'/" "$gemspec"
  fi

  # Build and push
  if run_cmd gem build "$gemspec"; then
    local gem_file="${gem_name}-${VERSION}.gem"
    if run_cmd gem push "$gem_file"; then
      add_result "rubygems:$gem_name" "published"
      ((PUBLISHED++)) || true
      log_success "$gem_name@$VERSION published to RubyGems"
    else
      add_result "rubygems:$gem_name" "failed"
      ((FAILED++)) || true
      log_error "Failed to push $gem_name to RubyGems"
    fi
  else
    add_result "rubygems:$gem_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to build $gem_name"
  fi
}

# ═══════════════════════════════════════════════════════════════
# C# / NuGet
# ═══════════════════════════════════════════════════════════════
publish_csharp() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local nuget_name="$3"

  log "Publishing $nuget_name to NuGet..."

  if version_exists nuget "$nuget_name" "$VERSION"; then
    add_result "nuget:$nuget_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Build and pack
  if run_cmd dotnet pack -c Release /p:Version="$VERSION" -o ./nupkg; then
    # Push
    local nupkg_file="./nupkg/${nuget_name}.${VERSION}.nupkg"
    if run_cmd dotnet nuget push "$nupkg_file" --api-key "${NUGET_API_KEY:-}" --source https://api.nuget.org/v3/index.json --skip-duplicate; then
      add_result "nuget:$nuget_name" "published"
      ((PUBLISHED++)) || true
      log_success "$nuget_name@$VERSION published to NuGet"
    else
      add_result "nuget:$nuget_name" "failed"
      ((FAILED++)) || true
      log_error "Failed to push $nuget_name to NuGet"
    fi
  else
    add_result "nuget:$nuget_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to build $nuget_name"
  fi
}

# ═══════════════════════════════════════════════════════════════
# F# / NuGet (same as C#)
# ═══════════════════════════════════════════════════════════════
publish_fsharp() {
  publish_csharp "$@"
}

# ═══════════════════════════════════════════════════════════════
# Java / Maven Central
# ═══════════════════════════════════════════════════════════════
publish_java() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local maven_coords="$3"  # groupId:artifactId

  log "Publishing $maven_coords to Maven Central..."

  if version_exists maven "$maven_coords" "$VERSION"; then
    add_result "maven:$maven_coords" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in gradle.properties
  if [[ -f "gradle.properties" ]]; then
    run_cmd sed -i '' "s/^version=.*/version=$VERSION/" gradle.properties 2>/dev/null || \
    run_cmd sed -i "s/^version=.*/version=$VERSION/" gradle.properties
  fi

  # Build and publish using Gradle
  if [[ -f "gradlew" ]]; then
    if run_cmd ./gradlew publish; then
      add_result "maven:$maven_coords" "published"
      ((PUBLISHED++)) || true
      log_success "$maven_coords@$VERSION published to Maven Central"
    else
      add_result "maven:$maven_coords" "failed"
      ((FAILED++)) || true
      log_error "Failed to publish $maven_coords to Maven Central"
    fi
  else
    log_error "No gradlew found for $maven_coords"
    add_result "maven:$maven_coords" "failed"
    ((FAILED++)) || true
  fi
}

# ═══════════════════════════════════════════════════════════════
# Kotlin / Maven Central (same as Java)
# ═══════════════════════════════════════════════════════════════
publish_kotlin() {
  publish_java "$@"
}

# ═══════════════════════════════════════════════════════════════
# Scala / Maven Central
# ═══════════════════════════════════════════════════════════════
publish_scala() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local maven_coords="$3"

  log "Publishing $maven_coords to Maven Central..."

  if version_exists maven "$maven_coords" "$VERSION"; then
    add_result "maven:$maven_coords" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in build.sbt
  run_cmd sed -i '' "s/version := \".*\"/version := \"$VERSION\"/" build.sbt 2>/dev/null || \
  run_cmd sed -i "s/version := \".*\"/version := \"$VERSION\"/" build.sbt

  # Publish using sbt
  if run_cmd sbt publish; then
    add_result "maven:$maven_coords" "published"
    ((PUBLISHED++)) || true
    log_success "$maven_coords@$VERSION published to Maven Central"
  else
    add_result "maven:$maven_coords" "failed"
    ((FAILED++)) || true
    log_error "Failed to publish $maven_coords to Maven Central"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Dart / pub.dev
# ═══════════════════════════════════════════════════════════════
publish_dart() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local pub_name="$3"

  log "Publishing $pub_name to pub.dev..."

  if version_exists pub "$pub_name" "$VERSION"; then
    add_result "pub:$pub_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in pubspec.yaml
  run_cmd sed -i '' "s/^version: .*/version: $VERSION/" pubspec.yaml 2>/dev/null || \
  run_cmd sed -i "s/^version: .*/version: $VERSION/" pubspec.yaml

  # Publish
  if run_cmd dart pub publish --force; then
    add_result "pub:$pub_name" "published"
    ((PUBLISHED++)) || true
    log_success "$pub_name@$VERSION published to pub.dev"
  else
    add_result "pub:$pub_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to publish $pub_name to pub.dev"
  fi
}

# ═══════════════════════════════════════════════════════════════
# Elixir / Hex.pm
# ═══════════════════════════════════════════════════════════════
publish_elixir() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local hex_name="$3"

  log "Publishing $hex_name to Hex.pm..."

  if version_exists hex "$hex_name" "$VERSION"; then
    add_result "hex:$hex_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Update version in mix.exs
  run_cmd sed -i '' "s/@version \".*\"/@version \"$VERSION\"/" mix.exs 2>/dev/null || \
  run_cmd sed -i "s/@version \".*\"/@version \"$VERSION\"/" mix.exs

  # Publish
  if run_cmd mix hex.publish --yes; then
    add_result "hex:$hex_name" "published"
    ((PUBLISHED++)) || true
    log_success "$hex_name@$VERSION published to Hex.pm"
  else
    add_result "hex:$hex_name" "failed"
    ((FAILED++)) || true
    log_error "Failed to publish $hex_name to Hex.pm"
  fi
}

# ═══════════════════════════════════════════════════════════════
# PHP / Packagist (auto-sync from GitHub)
# ═══════════════════════════════════════════════════════════════
publish_php() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local packagist_name="$3"

  log "Preparing $packagist_name for Packagist..."

  # Packagist auto-syncs from GitHub, just need git tag
  cd "$pkg_dir"

  # Update version in composer.json
  run_cmd sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" composer.json 2>/dev/null || \
  run_cmd sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" composer.json

  log_success "$packagist_name will sync from GitHub when v$VERSION tag is pushed"
  add_result "packagist:$packagist_name" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# Clojure / Clojars
# ═══════════════════════════════════════════════════════════════
publish_clojure() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local clojars_name="$3"

  log "Publishing $clojars_name to Clojars..."

  if version_exists clojars "$clojars_name" "$VERSION"; then
    add_result "clojars:$clojars_name" "skipped"
    ((SKIPPED++)) || true
    return 0
  fi

  cd "$pkg_dir"

  # Clojure uses deps.edn - we need to use tools.build or similar
  # For now, update version in deps.edn alias
  log_error "Clojure publishing requires manual setup with tools.build"
  add_result "clojars:$clojars_name" "manual"
}

# ═══════════════════════════════════════════════════════════════
# Crystal / shards (GitHub only)
# ═══════════════════════════════════════════════════════════════
publish_crystal() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local shard_name="$3"

  log "Preparing $shard_name for Crystal shards..."

  cd "$pkg_dir"

  # Update version in shard.yml
  run_cmd sed -i '' "s/^version: .*/version: $VERSION/" shard.yml 2>/dev/null || \
  run_cmd sed -i "s/^version: .*/version: $VERSION/" shard.yml

  log_success "$shard_name available via GitHub releases when v$VERSION tag is pushed"
  add_result "shards:$shard_name" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# Nim / Nimble (GitHub only)
# ═══════════════════════════════════════════════════════════════
publish_nim() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local nimble_name="$3"

  log "Preparing $nimble_name for Nimble..."

  cd "$pkg_dir"

  # Update version in .nimble file
  local nimble_file=$(ls *.nimble 2>/dev/null | head -1)
  if [[ -n "$nimble_file" ]]; then
    run_cmd sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$nimble_file" 2>/dev/null || \
    run_cmd sed -i "s/^version = \".*\"/version = \"$VERSION\"/" "$nimble_file"
  fi

  log_success "$nimble_name available via GitHub when v$VERSION tag is pushed"
  add_result "nimble:$nimble_name" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# Deno / deno.land/x (GitHub webhook)
# ═══════════════════════════════════════════════════════════════
publish_deno() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local deno_name="$3"

  log "Preparing $deno_name for deno.land/x..."

  cd "$pkg_dir"

  # Update version in deno.json
  run_cmd sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" deno.json 2>/dev/null || \
  run_cmd sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" deno.json

  log_success "$deno_name will sync from GitHub when v$VERSION tag is pushed"
  add_result "deno:$deno_name" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# Swift - SPM (GitHub only), CocoaPods needs trunk
# ═══════════════════════════════════════════════════════════════
publish_swift() {
  local pkg_name="$1"
  local pkg_dir="$2"
  local swift_name="$3"

  log "Preparing $swift_name for Swift Package Manager..."

  # SPM uses git tags, no publishing needed
  log_success "$swift_name available via SPM when v$VERSION tag is pushed"
  add_result "spm:$swift_name" "tag-required"
}

# ═══════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════

log_section "Publishing v$VERSION to all registries"

if $DRY_RUN; then
  echo -e "${YELLOW}DRY RUN MODE - No actual publishing will occur${NC}"
fi

# TypeScript packages (dotdo published from dot-do/dotdo repo)
if should_publish_lang "ts"; then
  log_section "TypeScript / npm"
  publish_typescript "capnweb" "$ROOT_DIR/packages/typescript/capnweb" "capnweb"
  publish_typescript "rpc" "$ROOT_DIR/packages/typescript/rpc" "rpc.do"
  publish_typescript "oauth" "$ROOT_DIR/packages/typescript/oauth" "oauth.do"
fi

# Python packages
if should_publish_lang "py"; then
  log_section "Python / PyPI"
  publish_python "capnweb" "$ROOT_DIR/packages/python/capnweb" "capnweb"
  publish_python "rpc" "$ROOT_DIR/packages/python/rpc" "rpc-do"
  publish_python "dotdo" "$ROOT_DIR/packages/python/dotdo" "dotdo"
  publish_python "oauth" "$ROOT_DIR/packages/python/oauth" "oauth-do"
fi

# Rust packages
if should_publish_lang "rust"; then
  log_section "Rust / crates.io"
  publish_rust "capnweb" "$ROOT_DIR/packages/rust/capnweb" "capnweb"
  publish_rust "rpc" "$ROOT_DIR/packages/rust/rpc" "rpc-do"
  publish_rust "dotdo" "$ROOT_DIR/packages/rust/dotdo" "dotdo"
  publish_rust "oauth" "$ROOT_DIR/packages/rust/oauth" "oauth-do"
fi

# Go packages
if should_publish_lang "go"; then
  log_section "Go / pkg.go.dev"
  publish_go "capnweb" "$ROOT_DIR/packages/go/capnweb" "go.capnweb.do"
  publish_go "rpc" "$ROOT_DIR/packages/go/rpc" "go.rpc.do"
  publish_go "dotdo" "$ROOT_DIR/packages/go/dotdo" "go.dotdo.dev"
  publish_go "oauth" "$ROOT_DIR/packages/go/oauth" "go.oauth.do"
fi

# Ruby packages
if should_publish_lang "ruby"; then
  log_section "Ruby / RubyGems"
  publish_ruby "capnweb" "$ROOT_DIR/packages/ruby/capnweb" "capnweb"
  publish_ruby "rpc" "$ROOT_DIR/packages/ruby/rpc" "rpc-do"
  publish_ruby "dotdo" "$ROOT_DIR/packages/ruby/dotdo" "dotdo"
  publish_ruby "oauth" "$ROOT_DIR/packages/ruby/oauth" "oauth-do"
fi

# C# packages
if should_publish_lang "csharp"; then
  log_section "C# / NuGet"
  publish_csharp "capnweb" "$ROOT_DIR/packages/dotnet/capnweb" "CapnWeb"
  publish_csharp "rpc" "$ROOT_DIR/packages/dotnet/rpc" "RpcDo"
  publish_csharp "dotdo" "$ROOT_DIR/packages/dotnet/dotdo" "DotDo"
  publish_csharp "oauth" "$ROOT_DIR/packages/dotnet/oauth" "OAuthDo"
fi

# F# packages
if should_publish_lang "fsharp"; then
  log_section "F# / NuGet"
  publish_fsharp "capnweb" "$ROOT_DIR/packages/fsharp/capnweb" "CapnWeb.FSharp"
  publish_fsharp "rpc" "$ROOT_DIR/packages/fsharp/rpc" "RpcDo.FSharp"
  publish_fsharp "dotdo" "$ROOT_DIR/packages/fsharp/dotdo" "DotDo.FSharp"
  publish_fsharp "oauth" "$ROOT_DIR/packages/fsharp/oauth" "OAuthDo.FSharp"
fi

# Java packages
if should_publish_lang "java"; then
  log_section "Java / Maven Central"
  publish_java "capnweb" "$ROOT_DIR/packages/java/capnweb" "do.capnweb:capnweb"
  publish_java "rpc" "$ROOT_DIR/packages/java/rpc" "do.rpc:rpc"
  publish_java "dotdo" "$ROOT_DIR/packages/java/dotdo" "dev.dotdo:dotdo"
  publish_java "oauth" "$ROOT_DIR/packages/java/oauth" "do.oauth:oauth"
fi

# Kotlin packages
if should_publish_lang "kotlin"; then
  log_section "Kotlin / Maven Central"
  publish_kotlin "capnweb" "$ROOT_DIR/packages/kotlin/capnweb" "do.capnweb:capnweb"
  publish_kotlin "rpc" "$ROOT_DIR/packages/kotlin/rpc" "do.rpc:rpc"
  publish_kotlin "dotdo" "$ROOT_DIR/packages/kotlin/dotdo" "dev.dotdo:dotdo"
  publish_kotlin "oauth" "$ROOT_DIR/packages/kotlin/oauth" "do.oauth:oauth"
fi

# Scala packages
if should_publish_lang "scala"; then
  log_section "Scala / Maven Central"
  publish_scala "capnweb" "$ROOT_DIR/packages/scala/capnweb" "do.capnweb:capnweb"
  publish_scala "rpc" "$ROOT_DIR/packages/scala/rpc" "do.rpc:rpc"
  publish_scala "dotdo" "$ROOT_DIR/packages/scala/dotdo" "dev.dotdo:dotdo"
  publish_scala "oauth" "$ROOT_DIR/packages/scala/oauth" "do.oauth:oauth"
fi

# Swift packages
if should_publish_lang "swift"; then
  log_section "Swift / SPM"
  publish_swift "capnweb" "$ROOT_DIR/packages/swift/capnweb" "capnweb"
  publish_swift "rpc" "$ROOT_DIR/packages/swift/rpc" "rpc-do"
  publish_swift "dotdo" "$ROOT_DIR/packages/swift/dotdo" "dotdo"
  publish_swift "oauth" "$ROOT_DIR/packages/swift/oauth" "oauth-do"
fi

# Dart packages
if should_publish_lang "dart"; then
  log_section "Dart / pub.dev"
  publish_dart "capnweb" "$ROOT_DIR/packages/dart/capnweb" "capnweb"
  publish_dart "rpc" "$ROOT_DIR/packages/dart/rpc" "rpc_do"
  publish_dart "dotdo" "$ROOT_DIR/packages/dart/dotdo" "dotdo"
  publish_dart "oauth" "$ROOT_DIR/packages/dart/oauth" "oauth_do"
fi

# Elixir packages
if should_publish_lang "elixir"; then
  log_section "Elixir / Hex.pm"
  publish_elixir "capnweb" "$ROOT_DIR/packages/elixir/capnweb" "capnweb"
  publish_elixir "rpc" "$ROOT_DIR/packages/elixir/rpc" "rpc_do"
  publish_elixir "dotdo" "$ROOT_DIR/packages/elixir/dotdo" "dotdo"
  publish_elixir "oauth" "$ROOT_DIR/packages/elixir/oauth" "oauth_do"
fi

# Clojure packages
if should_publish_lang "clojure"; then
  log_section "Clojure / Clojars"
  publish_clojure "capnweb" "$ROOT_DIR/packages/clojure/capnweb" "do.capnweb/capnweb"
  publish_clojure "rpc" "$ROOT_DIR/packages/clojure/rpc" "do.rpc/rpc"
  publish_clojure "dotdo" "$ROOT_DIR/packages/clojure/dotdo" "dev.dotdo/dotdo"
  publish_clojure "oauth" "$ROOT_DIR/packages/clojure/oauth" "do.oauth/oauth"
fi

# Crystal packages
if should_publish_lang "crystal"; then
  log_section "Crystal / shards"
  publish_crystal "capnweb" "$ROOT_DIR/packages/crystal/capnweb" "capnweb"
  publish_crystal "rpc" "$ROOT_DIR/packages/crystal/rpc" "rpc-do"
  publish_crystal "dotdo" "$ROOT_DIR/packages/crystal/dotdo" "dotdo"
  publish_crystal "oauth" "$ROOT_DIR/packages/crystal/oauth" "oauth-do"
fi

# Nim packages
if should_publish_lang "nim"; then
  log_section "Nim / Nimble"
  publish_nim "capnweb" "$ROOT_DIR/packages/nim/capnweb" "capnweb"
  publish_nim "rpc" "$ROOT_DIR/packages/nim/rpc" "rpc_do"
  publish_nim "dotdo" "$ROOT_DIR/packages/nim/dotdo" "dotdo"
  publish_nim "oauth" "$ROOT_DIR/packages/nim/oauth" "oauth_do"
fi

# Deno packages
if should_publish_lang "deno"; then
  log_section "Deno / deno.land/x"
  publish_deno "capnweb" "$ROOT_DIR/packages/deno/capnweb" "capnweb_do"
  publish_deno "rpc" "$ROOT_DIR/packages/deno/rpc" "rpc_do"
  publish_deno "dotdo" "$ROOT_DIR/packages/deno/dotdo" "dotdo"
  publish_deno "oauth" "$ROOT_DIR/packages/deno/oauth" "oauth_do"
fi

# PHP packages
if should_publish_lang "php"; then
  log_section "PHP / Packagist"
  publish_php "capnweb" "$ROOT_DIR/packages/php/capnweb" "dotdo/capnweb"
  publish_php "rpc" "$ROOT_DIR/packages/php/rpc" "dotdo/rpc"
  publish_php "dotdo" "$ROOT_DIR/packages/php/dotdo" "dotdo/dotdo"
  publish_php "oauth" "$ROOT_DIR/packages/php/oauth" "dotdo/oauth"
fi

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════

log_section "PUBLISHING SUMMARY"

echo ""
echo "Results:"
if [[ -f "$RESULTS_FILE" ]] && [[ -s "$RESULTS_FILE" ]]; then
  while IFS='|' read -r key status; do
    case "$status" in
      published)    echo -e "  ${GREEN}✓${NC} $key - published" ;;
      skipped)      echo -e "  ${YELLOW}○${NC} $key - already exists" ;;
      failed)       echo -e "  ${RED}✗${NC} $key - failed" ;;
      tag-required) echo -e "  ${BLUE}⊙${NC} $key - needs git tag" ;;
      manual)       echo -e "  ${CYAN}?${NC} $key - manual setup needed" ;;
    esac
  done < "$RESULTS_FILE"
fi

echo ""
echo -e "Published: ${GREEN}$PUBLISHED${NC}"
echo -e "Skipped:   ${YELLOW}$SKIPPED${NC}"
echo -e "Failed:    ${RED}$FAILED${NC}"

# Remind about git tag if needed
tag_required=$(grep -c "tag-required" "$RESULTS_FILE" 2>/dev/null | tr -d '[:space:]' || echo "0")
tag_required=${tag_required:-0}
if [[ "$tag_required" -gt 0 ]]; then
  echo ""
  echo -e "${BLUE}Note:${NC} $tag_required packages need git tag v$VERSION to be pushed:"
  echo "  git tag v$VERSION"
  echo "  git push origin v$VERSION"
fi

# Exit with error if any failed
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
