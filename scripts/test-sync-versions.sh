#!/bin/bash
# test-sync-versions.sh - Tests for sync-versions.sh
#
# This test validates that version syncing works correctly for all file types.
# Run with: ./scripts/test-sync-versions.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Test directory - will be set in run_tests
TEST_DIR=""

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
test_pass() {
  echo -e "  ${GREEN}PASS${NC}: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

test_fail() {
  echo -e "  ${RED}FAIL${NC}: $1"
  echo -e "       Expected: $2"
  echo -e "       Got: $3"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

# Create test fixtures
setup_fixtures() {
  echo "Setting up test fixtures..."

  # Root package.json
  mkdir -p "$TEST_DIR"
  cat > "$TEST_DIR/package.json" << 'EOF'
{
  "name": "test-root",
  "version": "0.1.0",
  "description": "Test package"
}
EOF

  # TypeScript package.json
  mkdir -p "$TEST_DIR/packages/typescript/capnweb"
  cat > "$TEST_DIR/packages/typescript/capnweb/package.json" << 'EOF'
{
  "name": "@test/capnweb",
  "version": "0.1.0",
  "description": "Test TypeScript package"
}
EOF

  # Python pyproject.toml
  mkdir -p "$TEST_DIR/packages/python/capnweb"
  cat > "$TEST_DIR/packages/python/capnweb/pyproject.toml" << 'EOF'
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "capnweb-do"
version = "0.1.0"
description = "Test Python package"
EOF

  # Rust Cargo.toml
  mkdir -p "$TEST_DIR/packages/rust/capnweb"
  cat > "$TEST_DIR/packages/rust/capnweb/Cargo.toml" << 'EOF'
[package]
name = "capnweb-do"
version = "0.1.0"
edition = "2021"
description = "Test Rust package"

[dependencies]
serde = "1"
EOF

  # Dart pubspec.yaml
  mkdir -p "$TEST_DIR/packages/dart/capnweb"
  cat > "$TEST_DIR/packages/dart/capnweb/pubspec.yaml" << 'EOF'
name: capnweb_do
version: 0.1.0
description: Test Dart package

environment:
  sdk: ^3.0.0
EOF

  # Elixir mix.exs
  mkdir -p "$TEST_DIR/packages/elixir/capnweb"
  cat > "$TEST_DIR/packages/elixir/capnweb/mix.exs" << 'EOF'
defmodule Test.MixProject do
  use Mix.Project

  @version "0.1.0"

  def project do
    [
      app: :test,
      version: @version
    ]
  end
end
EOF

  # Crystal shard.yml
  mkdir -p "$TEST_DIR/packages/crystal/capnweb"
  cat > "$TEST_DIR/packages/crystal/capnweb/shard.yml" << 'EOF'
name: capnweb-do
version: 0.1.0
description: Test Crystal package

authors:
  - Test
EOF

  # Nim .nimble
  mkdir -p "$TEST_DIR/packages/nim/capnweb"
  cat > "$TEST_DIR/packages/nim/capnweb/capnwebdo.nimble" << 'EOF'
# Package

version       = "0.1.0"
author        = "Test"
description   = "Test Nim package"
license       = "MIT"
srcDir        = "src"
EOF

  # Scala build.sbt
  mkdir -p "$TEST_DIR/packages/scala/capnweb"
  cat > "$TEST_DIR/packages/scala/capnweb/build.sbt" << 'EOF'
ThisBuild / scalaVersion := "3.3.3"
ThisBuild / organization := "test"
ThisBuild / version := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "test"
  )
EOF

  # Ruby gemspec
  mkdir -p "$TEST_DIR/packages/ruby/capnweb"
  cat > "$TEST_DIR/packages/ruby/capnweb/capnweb.do.gemspec" << 'EOF'
# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = 'capnweb.do'
  spec.version = '0.1.0'
  spec.authors       = ['Test']
end
EOF

  # Deno deno.json
  mkdir -p "$TEST_DIR/packages/deno/capnweb"
  cat > "$TEST_DIR/packages/deno/capnweb/deno.json" << 'EOF'
{
  "name": "@test/capnweb",
  "version": "0.1.0",
  "exports": "./mod.ts"
}
EOF

  # PHP composer.json
  mkdir -p "$TEST_DIR/packages/php/capnweb"
  cat > "$TEST_DIR/packages/php/capnweb/composer.json" << 'EOF'
{
    "name": "test/capnweb",
    "description": "Test PHP package",
    "version": "0.1.0"
}
EOF

  # Java/Kotlin gradle.properties
  mkdir -p "$TEST_DIR/packages/java/capnweb"
  cat > "$TEST_DIR/packages/java/capnweb/gradle.properties" << 'EOF'
org.gradle.jvmargs=-Xmx2g
version=0.1.0
org.gradle.parallel=true
EOF

  echo "Fixtures created in $TEST_DIR"
}

# Test functions for each file type
test_json_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  local actual_version
  actual_version=$(node -p "require('$file').version" 2>/dev/null || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_toml_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Use Python to read TOML (works on both macOS and Linux)
  local actual_version
  actual_version=$(python3 -c "
import sys
try:
    import tomllib
except ImportError:
    import tomli as tomllib
with open('$file', 'rb') as f:
    data = tomllib.load(f)
# Handle both [project].version and [package].version
if 'project' in data and 'version' in data['project']:
    print(data['project']['version'])
elif 'package' in data and 'version' in data['package']:
    print(data['package']['version'])
else:
    print('ERROR')
" 2>/dev/null || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_yaml_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Use Python to read YAML
  local actual_version
  actual_version=$(python3 -c "
import yaml
with open('$file', 'r') as f:
    data = yaml.safe_load(f)
print(data.get('version', 'ERROR'))
" 2>/dev/null || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_elixir_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Extract @version from mix.exs using portable sed
  local actual_version
  actual_version=$(grep '@version' "$file" 2>/dev/null | sed 's/.*@version[[:space:]]*"//;s/".*//' || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_nimble_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Extract version from nimble file using portable sed
  local actual_version
  actual_version=$(grep '^version' "$file" 2>/dev/null | sed 's/version[[:space:]]*=[[:space:]]*"//;s/".*//' || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_sbt_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Extract version from build.sbt using portable sed
  local actual_version
  actual_version=$(grep 'version :=' "$file" 2>/dev/null | sed 's/.*version[[:space:]]*:=[[:space:]]*"//;s/".*//' || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_gemspec_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Extract spec.version from gemspec using portable sed
  local actual_version
  actual_version=$(grep 'spec.version' "$file" 2>/dev/null | sed "s/.*spec.version[[:space:]]*=[[:space:]]*'//;s/'.*//" || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

test_gradle_update() {
  local file="$1"
  local version="$2"
  local name="$3"

  if [[ ! -f "$file" ]]; then
    test_fail "$name file exists" "file exists" "file not found"
    return
  fi

  # Extract version from gradle.properties using portable grep/sed
  local actual_version
  actual_version=$(grep '^version=' "$file" 2>/dev/null | sed 's/version=//' || echo "ERROR")

  if [[ "$actual_version" == "$version" ]]; then
    test_pass "$name version is $version"
  else
    test_fail "$name version" "$version" "$actual_version"
  fi
}

run_tests() {
  local test_version="1.2.3"

  echo ""
  echo "=========================================="
  echo "Testing sync-versions.sh"
  echo "=========================================="
  echo ""

  # Create test directory
  TEST_DIR=$(mktemp -d)

  # Setup fixtures
  setup_fixtures

  # Create a modified sync-versions.sh that uses our test directory
  local test_script="$TEST_DIR/test-sync.sh"
  sed "s|ROOT_DIR=\"\$(cd \"\$SCRIPT_DIR/..\" && pwd)\"|ROOT_DIR=\"$TEST_DIR\"|" "$SCRIPT_DIR/sync-versions.sh" > "$test_script"
  chmod +x "$test_script"

  echo ""
  echo "Running sync-versions.sh with version $test_version..."
  echo ""

  # Run the sync script (capture output for debugging)
  # Note: The script will "succeed" even if some packages don't exist,
  # since it skips missing files
  local output
  output=$("$test_script" "$test_version" 2>&1) || true
  echo "$output" | grep -v "^$" | head -5

  echo ""
  echo "Validating updates..."
  echo ""

  # Test each file type
  echo "JSON files (package.json, deno.json, composer.json):"
  # Note: Root package.json is used as VERSION SOURCE, not updated by the script
  test_json_update "$TEST_DIR/packages/typescript/capnweb/package.json" "$test_version" "TypeScript package.json"
  test_json_update "$TEST_DIR/packages/deno/capnweb/deno.json" "$test_version" "Deno deno.json"
  test_json_update "$TEST_DIR/packages/php/capnweb/composer.json" "$test_version" "PHP composer.json"

  echo ""
  echo "TOML files (pyproject.toml, Cargo.toml):"
  test_toml_update "$TEST_DIR/packages/python/capnweb/pyproject.toml" "$test_version" "Python pyproject.toml"
  test_toml_update "$TEST_DIR/packages/rust/capnweb/Cargo.toml" "$test_version" "Rust Cargo.toml"

  echo ""
  echo "YAML files (pubspec.yaml, shard.yml):"
  test_yaml_update "$TEST_DIR/packages/dart/capnweb/pubspec.yaml" "$test_version" "Dart pubspec.yaml"
  test_yaml_update "$TEST_DIR/packages/crystal/capnweb/shard.yml" "$test_version" "Crystal shard.yml"

  echo ""
  echo "Other file formats:"
  test_elixir_update "$TEST_DIR/packages/elixir/capnweb/mix.exs" "$test_version" "Elixir mix.exs"
  test_nimble_update "$TEST_DIR/packages/nim/capnweb/capnwebdo.nimble" "$test_version" "Nim .nimble"
  test_sbt_update "$TEST_DIR/packages/scala/capnweb/build.sbt" "$test_version" "Scala build.sbt"
  test_gemspec_update "$TEST_DIR/packages/ruby/capnweb/capnweb.do.gemspec" "$test_version" "Ruby .gemspec"
  test_gradle_update "$TEST_DIR/packages/java/capnweb/gradle.properties" "$test_version" "Java gradle.properties"

  echo ""
  echo "=========================================="
  echo "Test Summary"
  echo "=========================================="
  echo ""
  echo "Tests run: $TESTS_RUN"
  echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
  echo ""

  # Cleanup
  rm -rf "$TEST_DIR"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "${RED}SOME TESTS FAILED${NC}"
    return 1
  else
    echo -e "${GREEN}ALL TESTS PASSED${NC}"
    return 0
  fi
}

# Run tests
run_tests
