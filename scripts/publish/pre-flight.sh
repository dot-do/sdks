#!/bin/bash
# ============================================================================
# pre-flight.sh - Pre-publish verification checks
# ============================================================================
#
# This script performs comprehensive pre-flight checks before publishing:
#   1. Version consistency across all packages
#   2. Git tag verification
#   3. Uncommitted changes detection
#   4. Package name pattern validation
#
# Usage: ./scripts/publish/pre-flight.sh [version]
#
# Exit codes:
#   0 - All checks passed
#   1 - Version mismatch detected
#   2 - Git tag mismatch
#   3 - Uncommitted changes found
#   4 - Invalid package name pattern
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Color definitions for output
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ============================================================================
# Configuration
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGES_DIR="$ROOT_DIR/packages"

# Expected layers (core packages that every language should have)
CORE_LAYERS=("capnweb" "rpc" "dotdo" "oauth")

# Optional layers (only some languages have these)
OPTIONAL_LAYERS=("kafka" "mongo")

# All 18 languages
LANGUAGES=(
  "typescript"
  "python"
  "rust"
  "go"
  "dotnet"
  "fsharp"
  "ruby"
  "elixir"
  "dart"
  "java"
  "kotlin"
  "swift"
  "deno"
  "php"
  "clojure"
  "nim"
  "scala"
  "crystal"
)

# ============================================================================
# Helper functions
# ============================================================================

print_header() {
  echo ""
  echo -e "${BOLD}${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${BLUE}  $1${NC}"
  echo -e "${BOLD}${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
}

print_section() {
  echo ""
  echo -e "${CYAN}───────────────────────────────────────────────────────────────${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}───────────────────────────────────────────────────────────────${NC}"
}

print_success() {
  echo -e "${GREEN}  [PASS]${NC} $1"
}

print_error() {
  echo -e "${RED}  [FAIL]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}  [WARN]${NC} $1"
}

print_info() {
  echo -e "${DIM}  [INFO]${NC} $1"
}

print_check() {
  echo -e "${MAGENTA}  [CHECK]${NC} $1"
}

# ============================================================================
# Version extraction functions for each language/package type
# ============================================================================

# Extract version from package.json (TypeScript, Deno)
get_npm_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from pyproject.toml (Python)
get_python_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version\s*=' "$file" | head -1 | sed 's/version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from Cargo.toml (Rust)
get_rust_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version\s*=' "$file" | head -1 | sed 's/version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from .csproj (C#/.NET, F#)
get_dotnet_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -o '<Version>[^<]*</Version>' "$file" | head -1 | sed 's/<Version>\([^<]*\)<\/Version>/\1/'
  fi
}

# Extract version from .gemspec (Ruby)
get_ruby_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E "spec.version\s*=" "$file" | head -1 | sed "s/.*spec.version[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/"
  fi
}

# Extract version from mix.exs (Elixir)
get_elixir_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '@version\s+"' "$file" | head -1 | sed 's/.*@version[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from pubspec.yaml (Dart)
get_dart_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version:\s*' "$file" | head -1 | sed 's/version:[[:space:]]*\([^[:space:]]*\).*/\1/'
  fi
}

# Extract version from build.gradle.kts (Java, Kotlin)
get_gradle_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version\s*=' "$file" | head -1 | sed 's/version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from composer.json (PHP)
get_php_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from .nimble (Nim)
get_nim_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version\s*=' "$file" | head -1 | sed 's/version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from build.sbt (Scala)
get_scala_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E 'version\s*:=\s*"' "$file" | head -1 | sed 's/.*version[[:space:]]*:=[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# Extract version from shard.yml (Crystal)
get_crystal_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -E '^version:\s*' "$file" | head -1 | sed 's/version:[[:space:]]*\([^[:space:]]*\).*/\1/'
  fi
}

# Extract version from deno.json (Deno)
get_deno_version() {
  local file="$1"
  if [[ -f "$file" ]]; then
    grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$file" | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

# ============================================================================
# Get version for a specific package
# ============================================================================
get_package_version() {
  local lang="$1"
  local layer="$2"
  local pkg_dir="$PACKAGES_DIR/$lang/$layer"
  local version=""

  if [[ ! -d "$pkg_dir" ]]; then
    echo ""
    return
  fi

  case "$lang" in
    typescript)
      version=$(get_npm_version "$pkg_dir/package.json")
      ;;
    python)
      version=$(get_python_version "$pkg_dir/pyproject.toml")
      ;;
    rust)
      version=$(get_rust_version "$pkg_dir/Cargo.toml")
      ;;
    go)
      # Go uses git tags for versioning, check go.mod module path for tag
      # For now, we'll skip version check for Go as it uses git tags
      version="go-module"
      ;;
    dotnet)
      local csproj=$(find "$pkg_dir" -maxdepth 1 -name "*.csproj" 2>/dev/null | head -1)
      if [[ -n "$csproj" ]]; then
        version=$(get_dotnet_version "$csproj")
      fi
      ;;
    fsharp)
      local fsproj=$(find "$pkg_dir" -maxdepth 1 -name "*.fsproj" 2>/dev/null | head -1)
      if [[ -n "$fsproj" ]]; then
        version=$(get_dotnet_version "$fsproj")
      fi
      ;;
    ruby)
      local gemspec=$(find "$pkg_dir" -maxdepth 1 -name "*.gemspec" 2>/dev/null | head -1)
      if [[ -n "$gemspec" ]]; then
        version=$(get_ruby_version "$gemspec")
      fi
      ;;
    elixir)
      version=$(get_elixir_version "$pkg_dir/mix.exs")
      ;;
    dart)
      version=$(get_dart_version "$pkg_dir/pubspec.yaml")
      ;;
    java|kotlin)
      version=$(get_gradle_version "$pkg_dir/build.gradle.kts")
      ;;
    swift)
      # Swift Package Manager doesn't have explicit versions in Package.swift
      # Uses git tags instead
      version="spm-tags"
      ;;
    deno)
      version=$(get_deno_version "$pkg_dir/deno.json")
      ;;
    php)
      version=$(get_php_version "$pkg_dir/composer.json")
      ;;
    clojure)
      # Clojure deps.edn doesn't typically include version
      # Uses git tags and tools.build
      version="clj-tools"
      ;;
    nim)
      local nimble=$(find "$pkg_dir" -maxdepth 1 -name "*.nimble" 2>/dev/null | head -1)
      if [[ -n "$nimble" ]]; then
        version=$(get_nim_version "$nimble")
      fi
      ;;
    scala)
      version=$(get_scala_version "$pkg_dir/build.sbt")
      ;;
    crystal)
      version=$(get_crystal_version "$pkg_dir/shard.yml")
      ;;
    *)
      version=""
      ;;
  esac

  echo "$version"
}

# ============================================================================
# Check 1: Version consistency across all packages
# ============================================================================
check_version_consistency() {
  local expected_version="$1"
  local errors=0
  local checked=0
  local skipped=0
  local mismatches=()

  print_section "Checking version consistency (expected: $expected_version)"

  for lang in "${LANGUAGES[@]}"; do
    echo -e "\n  ${BOLD}$lang${NC}:"

    for layer in "${CORE_LAYERS[@]}" "${OPTIONAL_LAYERS[@]}"; do
      local pkg_dir="$PACKAGES_DIR/$lang/$layer"

      # Skip if package directory doesn't exist
      if [[ ! -d "$pkg_dir" ]]; then
        continue
      fi

      # Skip special directories
      if [[ "$layer" == ".build" ]] || [[ "$layer" == "__tests__" ]]; then
        continue
      fi

      local version=$(get_package_version "$lang" "$layer")

      if [[ -z "$version" ]]; then
        print_warning "$layer: No version found"
        ((skipped++))
      elif [[ "$version" == "go-module" ]] || [[ "$version" == "spm-tags" ]] || [[ "$version" == "clj-tools" ]]; then
        print_info "$layer: Uses git tags for versioning"
        ((skipped++))
      elif [[ "$version" == "$expected_version" ]]; then
        print_success "$layer: $version"
        ((checked++))
      else
        print_error "$layer: $version (expected $expected_version)"
        mismatches+=("$lang/$layer: $version")
        ((errors++))
      fi
    done
  done

  echo ""
  echo -e "${BOLD}Summary:${NC}"
  echo -e "  Checked:   $checked packages"
  echo -e "  Skipped:   $skipped packages (use git tags)"
  echo -e "  Errors:    $errors packages"

  if [[ ${#mismatches[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}${BOLD}Version mismatches found:${NC}"
    for mismatch in "${mismatches[@]}"; do
      echo -e "  ${RED}- $mismatch${NC}"
    done
    return 1
  fi

  return 0
}

# ============================================================================
# Check 2: Git tag matches version
# ============================================================================
check_git_tag() {
  local expected_version="$1"
  local tag="v$expected_version"

  print_section "Checking git tag"

  cd "$ROOT_DIR"

  # Check if we're on a tag
  local current_tag=$(git describe --tags --exact-match 2>/dev/null || echo "")

  if [[ -n "$current_tag" ]]; then
    if [[ "$current_tag" == "$tag" ]]; then
      print_success "Current commit is tagged: $current_tag"
      return 0
    else
      print_error "Current tag ($current_tag) doesn't match expected ($tag)"
      return 1
    fi
  fi

  # Check if the tag exists
  if git rev-parse "$tag" >/dev/null 2>&1; then
    print_warning "Tag $tag exists but HEAD is not at this tag"
    local tag_commit=$(git rev-parse "$tag")
    local head_commit=$(git rev-parse HEAD)
    print_info "Tag points to: ${tag_commit:0:8}"
    print_info "HEAD is at:    ${head_commit:0:8}"
    return 1
  else
    print_warning "Tag $tag does not exist yet"
    print_info "Create it with: git tag -a $tag -m 'Release $expected_version'"
    return 0  # Not a failure, just informational
  fi
}

# ============================================================================
# Check 3: No uncommitted changes
# ============================================================================
check_uncommitted_changes() {
  print_section "Checking for uncommitted changes"

  cd "$ROOT_DIR"

  # Check for staged changes
  if ! git diff --cached --quiet; then
    print_error "Staged changes found"
    git diff --cached --name-only | while read -r file; do
      print_info "  staged: $file"
    done
    return 1
  fi

  # Check for unstaged changes
  if ! git diff --quiet; then
    print_error "Unstaged changes found"
    git diff --name-only | while read -r file; do
      print_info "  modified: $file"
    done
    return 1
  fi

  # Check for untracked files in packages directory
  local untracked=$(git ls-files --others --exclude-standard "$PACKAGES_DIR" | grep -v node_modules | grep -v __pycache__ | grep -v ".build" | head -20)
  if [[ -n "$untracked" ]]; then
    print_warning "Untracked files found in packages/"
    echo "$untracked" | while read -r file; do
      print_info "  untracked: $file"
    done
    # Not a failure, just informational
  fi

  print_success "Working directory is clean"
  return 0
}

# ============================================================================
# Check 4: Package name patterns
# ============================================================================
check_package_names() {
  print_section "Checking package name patterns"

  local errors=0

  # TypeScript packages should be @dotdo/* or *.do
  echo -e "\n  ${BOLD}TypeScript (npm):${NC}"
  for layer in "${CORE_LAYERS[@]}"; do
    local pkg_file="$PACKAGES_DIR/typescript/$layer/package.json"
    if [[ -f "$pkg_file" ]]; then
      local name=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$pkg_file" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
      if [[ "$name" =~ ^@dotdo/ ]] || [[ "$name" =~ \.do$ ]] || [[ "$name" == "dotdo" ]]; then
        print_success "$layer: $name"
      else
        print_error "$layer: $name (expected @dotdo/* or *.do pattern)"
        ((errors++))
      fi
    fi
  done

  # Python packages should be *-do or dotdo
  echo -e "\n  ${BOLD}Python (PyPI):${NC}"
  for layer in "${CORE_LAYERS[@]}"; do
    local pkg_file="$PACKAGES_DIR/python/$layer/pyproject.toml"
    if [[ -f "$pkg_file" ]]; then
      local name=$(grep -E '^name\s*=' "$pkg_file" | head -1 | sed 's/name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
      if [[ "$name" =~ -do$ ]] || [[ "$name" == "dotdo" ]]; then
        print_success "$layer: $name"
      else
        print_error "$layer: $name (expected *-do pattern)"
        ((errors++))
      fi
    fi
  done

  # Rust packages should be *-do or dotdo
  echo -e "\n  ${BOLD}Rust (crates.io):${NC}"
  for layer in "${CORE_LAYERS[@]}"; do
    local pkg_file="$PACKAGES_DIR/rust/$layer/Cargo.toml"
    if [[ -f "$pkg_file" ]]; then
      local name=$(grep -E '^name\s*=' "$pkg_file" | head -1 | sed 's/name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')
      if [[ "$name" =~ -do$ ]] || [[ "$name" == "dotdo" ]]; then
        print_success "$layer: $name"
      else
        print_error "$layer: $name (expected *-do pattern)"
        ((errors++))
      fi
    fi
  done

  echo ""
  if [[ $errors -gt 0 ]]; then
    print_error "Found $errors package naming issues"
    return 1
  fi

  print_success "All checked package names follow expected patterns"
  return 0
}

# ============================================================================
# Main
# ============================================================================
main() {
  local exit_code=0

  # Get expected version from root package.json or argument
  local expected_version="${1:-}"

  if [[ -z "$expected_version" ]]; then
    expected_version=$(get_npm_version "$ROOT_DIR/package.json")
  fi

  # Remove 'v' prefix if present
  expected_version="${expected_version#v}"

  if [[ -z "$expected_version" ]]; then
    echo -e "${RED}Error: Could not determine version${NC}"
    echo "Usage: $0 [version]"
    exit 1
  fi

  print_header "DotDo SDK Pre-Flight Checks"
  echo -e "  ${BOLD}Expected Version:${NC} $expected_version"
  echo -e "  ${BOLD}Root Directory:${NC}   $ROOT_DIR"
  echo -e "  ${BOLD}Date:${NC}             $(date '+%Y-%m-%d %H:%M:%S')"

  # Run all checks
  if ! check_version_consistency "$expected_version"; then
    exit_code=1
  fi

  if ! check_git_tag "$expected_version"; then
    exit_code=2
  fi

  if ! check_uncommitted_changes; then
    exit_code=3
  fi

  if ! check_package_names; then
    exit_code=4
  fi

  # Final summary
  print_header "Pre-Flight Check Results"

  if [[ $exit_code -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}  All pre-flight checks passed!${NC}"
    echo ""
    echo -e "  Ready to publish version ${BOLD}$expected_version${NC}"
  else
    echo -e "${RED}${BOLD}  Pre-flight checks failed!${NC}"
    echo ""
    echo -e "  Please fix the issues above before publishing."
    echo ""
    echo -e "  ${DIM}Exit code: $exit_code${NC}"
    case $exit_code in
      1) echo -e "  ${DIM}Reason: Version mismatch${NC}" ;;
      2) echo -e "  ${DIM}Reason: Git tag issue${NC}" ;;
      3) echo -e "  ${DIM}Reason: Uncommitted changes${NC}" ;;
      4) echo -e "  ${DIM}Reason: Package naming issue${NC}" ;;
    esac
  fi

  echo ""
  return $exit_code
}

# Run main with all arguments
main "$@"
