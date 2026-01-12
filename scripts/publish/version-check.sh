#!/bin/bash
# version-check.sh - Check if a version is already published on various registries
#
# Usage: ./version-check.sh <registry> <package-name> <version>
# Returns: exit 0 if version exists (skip publish), exit 1 if not found (should publish)

set -euo pipefail

REGISTRY="${1:-}"
PACKAGE="${2:-}"
VERSION="${3:-}"

if [[ -z "$REGISTRY" || -z "$PACKAGE" || -z "$VERSION" ]]; then
  echo "Usage: $0 <registry> <package-name> <version>" >&2
  exit 2
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_npm() {
  local pkg="$1"
  local ver="$2"
  # npm view returns 0 if version exists, non-zero if not
  if npm view "${pkg}@${ver}" version &>/dev/null; then
    echo -e "${YELLOW}[npm]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[npm]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_pypi() {
  local pkg="$1"
  local ver="$2"
  # Check PyPI JSON API
  local url="https://pypi.org/pypi/${pkg}/${ver}/json"
  if curl -sf "$url" &>/dev/null; then
    echo -e "${YELLOW}[pypi]${NC} ${pkg}==${ver} already published"
    return 0
  else
    echo -e "${GREEN}[pypi]${NC} ${pkg}==${ver} not found - will publish"
    return 1
  fi
}

check_crates() {
  local pkg="$1"
  local ver="$2"
  # Check crates.io API
  local url="https://crates.io/api/v1/crates/${pkg}/${ver}"
  if curl -sf "$url" | grep -q '"version"' &>/dev/null; then
    echo -e "${YELLOW}[crates]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[crates]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_nuget() {
  local pkg="$1"
  local ver="$2"
  # Check NuGet API (lowercase package name)
  local pkg_lower=$(echo "$pkg" | tr '[:upper:]' '[:lower:]')
  local url="https://api.nuget.org/v3-flatcontainer/${pkg_lower}/${ver}/${pkg_lower}.nuspec"
  if curl -sf "$url" &>/dev/null; then
    echo -e "${YELLOW}[nuget]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[nuget]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_rubygems() {
  local pkg="$1"
  local ver="$2"
  # Check RubyGems API
  local url="https://rubygems.org/api/v1/versions/${pkg}.json"
  if curl -sf "$url" | grep -q "\"number\":\"${ver}\"" &>/dev/null; then
    echo -e "${YELLOW}[rubygems]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[rubygems]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_maven() {
  local pkg="$1"  # Format: groupId:artifactId
  local ver="$2"
  local group_path="${pkg%%:*}"
  local artifact="${pkg##*:}"
  group_path="${group_path//./\/}"
  # Check Maven Central
  local url="https://repo1.maven.org/maven2/${group_path}/${artifact}/${ver}/${artifact}-${ver}.pom"
  if curl -sf "$url" &>/dev/null; then
    echo -e "${YELLOW}[maven]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[maven]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_hex() {
  local pkg="$1"
  local ver="$2"
  # Check Hex.pm API
  local url="https://hex.pm/api/packages/${pkg}"
  if curl -sf "$url" | grep -q "\"version\":\"${ver}\"" &>/dev/null; then
    echo -e "${YELLOW}[hex]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[hex]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_pub() {
  local pkg="$1"
  local ver="$2"
  # Check pub.dev API
  local url="https://pub.dev/api/packages/${pkg}"
  if curl -sf "$url" | grep -q "\"version\":\"${ver}\"" &>/dev/null; then
    echo -e "${YELLOW}[pub]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[pub]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_packagist() {
  local pkg="$1"  # Format: vendor/package
  local ver="$2"
  # Check Packagist API
  local url="https://repo.packagist.org/p2/${pkg}.json"
  if curl -sf "$url" | grep -q "\"version\":\"${ver}\"" &>/dev/null; then
    echo -e "${YELLOW}[packagist]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[packagist]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_clojars() {
  local pkg="$1"  # Format: group/artifact or just artifact
  local ver="$2"
  local group="${pkg%%/*}"
  local artifact="${pkg##*/}"
  [[ "$group" == "$artifact" ]] && group="$artifact"
  # Check Clojars API
  local url="https://clojars.org/api/artifacts/${group}/${artifact}"
  if curl -sf "$url" | grep -q "\"version\":\"${ver}\"" &>/dev/null; then
    echo -e "${YELLOW}[clojars]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[clojars]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_deno() {
  local pkg="$1"
  local ver="$2"
  # Check deno.land/x - uses GitHub tags
  local url="https://deno.land/x/${pkg}@${ver}"
  if curl -sf "$url" &>/dev/null; then
    echo -e "${YELLOW}[deno]${NC} ${pkg}@${ver} already published"
    return 0
  else
    echo -e "${GREEN}[deno]${NC} ${pkg}@${ver} not found - will publish"
    return 1
  fi
}

check_go() {
  local pkg="$1"  # Full module path like github.com/dot-do/capnweb/go
  local ver="$2"  # Should be vX.Y.Z format
  # Check Go proxy
  local url="https://proxy.golang.org/${pkg}/@v/${ver}.info"
  if curl -sf "$url" &>/dev/null; then
    echo -e "${YELLOW}[go]${NC} ${pkg}@${ver} already indexed"
    return 0
  else
    echo -e "${GREEN}[go]${NC} ${pkg}@${ver} not indexed - will be available after git tag"
    return 1
  fi
}

# Dispatch based on registry
case "$REGISTRY" in
  npm)      check_npm "$PACKAGE" "$VERSION" ;;
  pypi)     check_pypi "$PACKAGE" "$VERSION" ;;
  crates)   check_crates "$PACKAGE" "$VERSION" ;;
  nuget)    check_nuget "$PACKAGE" "$VERSION" ;;
  rubygems) check_rubygems "$PACKAGE" "$VERSION" ;;
  maven)    check_maven "$PACKAGE" "$VERSION" ;;
  hex)      check_hex "$PACKAGE" "$VERSION" ;;
  pub)      check_pub "$PACKAGE" "$VERSION" ;;
  packagist) check_packagist "$PACKAGE" "$VERSION" ;;
  clojars)  check_clojars "$PACKAGE" "$VERSION" ;;
  deno)     check_deno "$PACKAGE" "$VERSION" ;;
  go)       check_go "$PACKAGE" "$VERSION" ;;
  *)
    echo "Unknown registry: $REGISTRY" >&2
    echo "Supported: npm, pypi, crates, nuget, rubygems, maven, hex, pub, packagist, clojars, deno, go" >&2
    exit 2
    ;;
esac
