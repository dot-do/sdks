#!/bin/bash
# sync-versions.sh - Sync version across all packages
#
# Usage:
#   ./scripts/sync-versions.sh          # Use version from root package.json
#   ./scripts/sync-versions.sh 0.5.0    # Set specific version

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

VERSION="${1:-}"

# Get version from package.json if not specified
if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
fi

echo -e "${CYAN}Syncing version $VERSION to all packages...${NC}"

# Count updates
UPDATED=0

# Update root package.json
update_json() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    # Use node for reliable JSON editing
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$file', 'utf8'));
      pkg.version = '$version';
      fs.writeFileSync('$file', JSON.stringify(pkg, null, 2) + '\n');
    " 2>/dev/null && echo -e "  ${GREEN}✓${NC} $file" && ((UPDATED++)) || true
  fi
}

# Update pyproject.toml
update_pyproject() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/^version = \".*\"/version = \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/^version = \".*\"/version = \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update Cargo.toml
update_cargo() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/^version = \".*\"/version = \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/^version = \".*\"/version = \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update pubspec.yaml (Dart)
update_pubspec() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/^version: .*/version: $version/" "$file" 2>/dev/null || \
    sed -i "s/^version: .*/version: $version/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update mix.exs (Elixir)
update_mix() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/@version \".*\"/@version \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/@version \".*\"/@version \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update shard.yml (Crystal)
update_shard() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/^version: .*/version: $version/" "$file" 2>/dev/null || \
    sed -i "s/^version: .*/version: $version/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update .nimble (Nim)
update_nimble() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/^version = \".*\"/version = \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/^version = \".*\"/version = \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update build.gradle.kts or gradle.properties
update_gradle() {
  local dir="$1"
  local version="$2"
  if [[ -f "$dir/gradle.properties" ]]; then
    sed -i '' "s/^version=.*/version=$version/" "$dir/gradle.properties" 2>/dev/null || \
    sed -i "s/^version=.*/version=$version/" "$dir/gradle.properties"
    echo -e "  ${GREEN}✓${NC} $dir/gradle.properties"
    ((UPDATED++)) || true
  fi
}

# Update build.sbt (Scala)
update_sbt() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/version := \".*\"/version := \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/version := \".*\"/version := \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update gemspec (Ruby)
update_gemspec() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/spec.version.*=.*/spec.version = '$version'/" "$file" 2>/dev/null || \
    sed -i "s/spec.version.*=.*/spec.version = '$version'/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update deno.json
update_deno() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    sed -i '' "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file" 2>/dev/null || \
    sed -i "s/\"version\": \".*\"/\"version\": \"$version\"/" "$file"
    echo -e "  ${GREEN}✓${NC} $file"
    ((UPDATED++)) || true
  fi
}

# Update composer.json (PHP)
update_composer() {
  local file="$1"
  local version="$2"
  if [[ -f "$file" ]]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$file', 'utf8'));
      pkg.version = '$version';
      fs.writeFileSync('$file', JSON.stringify(pkg, null, 4) + '\n');
    " 2>/dev/null && echo -e "  ${GREEN}✓${NC} $file" && ((UPDATED++)) || true
  fi
}

echo ""
echo "TypeScript:"
for pkg in capnweb rpc dotdo oauth; do
  update_json "$ROOT_DIR/packages/typescript/$pkg/package.json" "$VERSION"
done

echo ""
echo "Python:"
for pkg in capnweb rpc dotdo oauth; do
  update_pyproject "$ROOT_DIR/packages/python/$pkg/pyproject.toml" "$VERSION"
done

echo ""
echo "Rust:"
for pkg in capnweb rpc dotdo oauth; do
  update_cargo "$ROOT_DIR/packages/rust/$pkg/Cargo.toml" "$VERSION"
done

echo ""
echo "Go:"
echo "  (Go uses git tags, no version file to update)"

echo ""
echo "Ruby:"
for pkg in capnweb rpc dotdo oauth; do
  gemspec=$(ls "$ROOT_DIR/packages/ruby/$pkg/"*.gemspec 2>/dev/null | head -1)
  [[ -n "$gemspec" ]] && update_gemspec "$gemspec" "$VERSION"
done

echo ""
echo "Java/Kotlin:"
for lang in java kotlin; do
  for pkg in capnweb rpc dotdo oauth; do
    update_gradle "$ROOT_DIR/packages/$lang/$pkg" "$VERSION"
  done
done

echo ""
echo "Scala:"
for pkg in capnweb rpc dotdo oauth; do
  update_sbt "$ROOT_DIR/packages/scala/$pkg/build.sbt" "$VERSION"
done

echo ""
echo "Swift:"
echo "  (Swift uses git tags, no version file to update)"

echo ""
echo "Dart:"
for pkg in capnweb rpc dotdo oauth; do
  update_pubspec "$ROOT_DIR/packages/dart/$pkg/pubspec.yaml" "$VERSION"
done

echo ""
echo "C#/F#:"
echo "  (Version set at build time via /p:Version)"

echo ""
echo "Elixir:"
for pkg in capnweb rpc dotdo oauth; do
  update_mix "$ROOT_DIR/packages/elixir/$pkg/mix.exs" "$VERSION"
done

echo ""
echo "Crystal:"
for pkg in capnweb rpc dotdo oauth; do
  update_shard "$ROOT_DIR/packages/crystal/$pkg/shard.yml" "$VERSION"
done

echo ""
echo "Nim:"
for pkg in capnweb rpc dotdo oauth; do
  nimble=$(ls "$ROOT_DIR/packages/nim/$pkg/"*.nimble 2>/dev/null | head -1)
  [[ -n "$nimble" ]] && update_nimble "$nimble" "$VERSION"
done

echo ""
echo "Deno:"
for pkg in capnweb rpc dotdo oauth; do
  update_deno "$ROOT_DIR/packages/deno/$pkg/deno.json" "$VERSION"
done

echo ""
echo "PHP:"
for pkg in capnweb rpc dotdo oauth; do
  update_composer "$ROOT_DIR/packages/php/$pkg/composer.json" "$VERSION"
done

echo ""
echo -e "${GREEN}Updated $UPDATED package files to v$VERSION${NC}"
