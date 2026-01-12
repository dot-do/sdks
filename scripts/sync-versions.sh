#!/bin/bash
# sync-versions.sh - Sync version across all packages
#
# Usage:
#   ./scripts/sync-versions.sh          # Use version from root package.json
#   ./scripts/sync-versions.sh 0.5.0    # Set specific version
#
# This script uses language-native tooling for reliable cross-platform updates:
# - JSON: Node.js
# - TOML: Python with tomllib/tomli
# - YAML: Python with PyYAML
# - Other: Node.js or cross-platform sed wrapper

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'

VERSION="${1:-}"

# Get version from package.json if not specified
if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
fi

echo -e "${CYAN}Syncing version $VERSION to all packages...${NC}"

# Count updates
UPDATED=0
ERRORS=0

# Error reporting
report_error() {
  local file="$1"
  local msg="$2"
  echo -e "  ${RED}ERROR${NC}: $file - $msg" >&2
  ((ERRORS++)) || true
}

report_success() {
  local file="$1"
  echo -e "  ${GREEN}OK${NC} $file"
  ((UPDATED++)) || true
}

# Update JSON files using Node.js
# Works reliably on all platforms
update_json() {
  local file="$1"
  local version="$2"
  local indent="${3:-2}"  # Default to 2-space indent

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if node -e "
    const fs = require('fs');
    try {
      const content = fs.readFileSync('$file', 'utf8');
      const pkg = JSON.parse(content);
      pkg.version = '$version';
      fs.writeFileSync('$file', JSON.stringify(pkg, null, $indent) + '\n');
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  " 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update JSON"
  fi
}

# Update TOML files (pyproject.toml, Cargo.toml, .nimble) using Python
# Python's tomllib (3.11+) or tomli provides reliable TOML handling
update_toml() {
  local file="$1"
  local version="$2"
  local section="${3:-project}"  # Default to [project] section

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if python3 -c "
import sys

# Use tomllib (Python 3.11+) or fall back to tomli
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        print('Neither tomllib nor tomli available', file=sys.stderr)
        sys.exit(1)

# We need tomlkit or manual editing for writing (tomllib is read-only)
# Use simple line-based replacement which is safe for version fields
import re

file_path = '$file'
version = '$version'
section = '$section'

with open(file_path, 'r') as f:
    content = f.read()

# For [project] or [package] sections, version is indented or on its own line
# Handle both 'version = \"x.y.z\"' patterns
if section == 'project':
    # pyproject.toml: version under [project]
    pattern = r'(^\[project\].*?^)(version\s*=\s*)\"[^\"]*\"'
    replacement = r'\g<1>\g<2>\"' + version + '\"'
    new_content, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE | re.DOTALL)
    if count == 0:
        # Try simple line-based replacement
        new_content = re.sub(r'^version\s*=\s*\"[^\"]*\"', f'version = \"{version}\"', content, count=1, flags=re.MULTILINE)
elif section == 'package':
    # Cargo.toml: version under [package]
    pattern = r'(^\[package\].*?^)(version\s*=\s*)\"[^\"]*\"'
    replacement = r'\g<1>\g<2>\"' + version + '\"'
    new_content, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE | re.DOTALL)
    if count == 0:
        new_content = re.sub(r'^version\s*=\s*\"[^\"]*\"', f'version = \"{version}\"', content, count=1, flags=re.MULTILINE)
else:
    # Simple version field (nimble files)
    new_content = re.sub(r'^version\s*=\s*\"[^\"]*\"', f'version = \"{version}\"', content, count=1, flags=re.MULTILINE)

with open(file_path, 'w') as f:
    f.write(new_content)
" 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update TOML"
  fi
}

# Update YAML files (pubspec.yaml, shard.yml) using Python
update_yaml() {
  local file="$1"
  local version="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if python3 -c "
import sys
import re

file_path = '$file'
version = '$version'

with open(file_path, 'r') as f:
    content = f.read()

# Replace version: x.y.z at the start of a line (YAML top-level)
new_content = re.sub(r'^version:\s*[^\n]+', f'version: {version}', content, count=1, flags=re.MULTILINE)

with open(file_path, 'w') as f:
    f.write(new_content)
" 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update YAML"
  fi
}

# Update Elixir mix.exs files
# Pattern: @version "x.y.z"
update_mix() {
  local file="$1"
  local version="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if node -e "
    const fs = require('fs');
    try {
      let content = fs.readFileSync('$file', 'utf8');
      content = content.replace(/@version\\s+\"[^\"]*\"/, '@version \"$version\"');
      fs.writeFileSync('$file', content);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  " 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update Elixir mix.exs"
  fi
}

# Update Scala build.sbt files
# Pattern: version := "x.y.z" or ThisBuild / version := "x.y.z"
update_sbt() {
  local file="$1"
  local version="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if node -e "
    const fs = require('fs');
    try {
      let content = fs.readFileSync('$file', 'utf8');
      content = content.replace(/version\\s*:=\\s*\"[^\"]*\"/, 'version := \"$version\"');
      fs.writeFileSync('$file', content);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  " 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update Scala build.sbt"
  fi
}

# Update Ruby gemspec files
# Pattern: spec.version = 'x.y.z'
update_gemspec() {
  local file="$1"
  local version="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if node -e "
    const fs = require('fs');
    try {
      let content = fs.readFileSync('$file', 'utf8');
      content = content.replace(/spec\\.version\\s*=\\s*['\"][^'\"]*['\"]/, \"spec.version = '$version'\");
      fs.writeFileSync('$file', content);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  " 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update Ruby gemspec"
  fi
}

# Update Gradle properties files
# Pattern: version=x.y.z
update_gradle() {
  local dir="$1"
  local version="$2"
  local file="$dir/gradle.properties"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if node -e "
    const fs = require('fs');
    try {
      let content = fs.readFileSync('$file', 'utf8');
      // Check if version property exists
      if (/^version=/m.test(content)) {
        content = content.replace(/^version=.*/m, 'version=$version');
      } else {
        // Add version property
        content = 'version=$version\n' + content;
      }
      fs.writeFileSync('$file', content);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  " 2>&1; then
    report_success "$file"
  else
    report_error "$file" "Failed to update Gradle properties"
  fi
}

# ===== Main update logic =====

echo ""
echo "TypeScript:"
for pkg in capnweb rpc dotdo oauth; do
  update_json "$ROOT_DIR/packages/typescript/$pkg/package.json" "$VERSION"
done

echo ""
echo "Python:"
for pkg in capnweb rpc dotdo oauth; do
  update_toml "$ROOT_DIR/packages/python/$pkg/pyproject.toml" "$VERSION" "project"
done

echo ""
echo "Rust:"
for pkg in capnweb rpc dotdo oauth; do
  update_toml "$ROOT_DIR/packages/rust/$pkg/Cargo.toml" "$VERSION" "package"
done

echo ""
echo "Go:"
echo "  (Go uses git tags, no version file to update)"

echo ""
echo "Ruby:"
for pkg in capnweb rpc dotdo oauth; do
  gemspec=$(ls "$ROOT_DIR/packages/ruby/$pkg/"*.gemspec 2>/dev/null | head -1 || true)
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
  update_yaml "$ROOT_DIR/packages/dart/$pkg/pubspec.yaml" "$VERSION"
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
  update_yaml "$ROOT_DIR/packages/crystal/$pkg/shard.yml" "$VERSION"
done

echo ""
echo "Nim:"
for pkg in capnweb rpc dotdo oauth; do
  nimble=$(ls "$ROOT_DIR/packages/nim/$pkg/"*.nimble 2>/dev/null | head -1 || true)
  [[ -n "$nimble" ]] && update_toml "$nimble" "$VERSION" "simple"
done

echo ""
echo "Deno:"
for pkg in capnweb rpc dotdo oauth; do
  update_json "$ROOT_DIR/packages/deno/$pkg/deno.json" "$VERSION"
done

echo ""
echo "PHP:"
for pkg in capnweb rpc dotdo oauth; do
  update_json "$ROOT_DIR/packages/php/$pkg/composer.json" "$VERSION" "4"
done

echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo -e "${RED}Updated $UPDATED package files with $ERRORS errors${NC}"
  exit 1
else
  echo -e "${GREEN}Updated $UPDATED package files to v$VERSION${NC}"
fi
