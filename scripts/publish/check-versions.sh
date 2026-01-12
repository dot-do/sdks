#!/bin/bash
# check-versions.sh - Check which packages need to be published
#
# Usage: ./check-versions.sh <version>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION="${1:-0.1.0}"

echo "Checking published versions for v$VERSION..."
echo ""

# npm packages
echo "=== npm ==="
"$SCRIPT_DIR/version-check.sh" npm "@dotdo/capnweb" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" npm "rpc.do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" npm "dotdo" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" npm "oauth.do" "$VERSION" || true

echo ""
echo "=== PyPI ==="
"$SCRIPT_DIR/version-check.sh" pypi "capnweb-do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" pypi "rpc-do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" pypi "dotdo" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" pypi "oauth-do" "$VERSION" || true

echo ""
echo "=== crates.io ==="
"$SCRIPT_DIR/version-check.sh" crates "capnweb-do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" crates "rpc-do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" crates "dotdo" "$VERSION" || true

echo ""
echo "=== NuGet ==="
"$SCRIPT_DIR/version-check.sh" nuget "DotDo.CapnWeb" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" nuget "DotDo.Rpc" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" nuget "DotDo" "$VERSION" || true

echo ""
echo "=== RubyGems ==="
"$SCRIPT_DIR/version-check.sh" rubygems "capnweb.do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" rubygems "rpc.do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" rubygems "platform.do" "$VERSION" || true

echo ""
echo "=== Hex.pm ==="
"$SCRIPT_DIR/version-check.sh" hex "capnweb_do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" hex "rpc_do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" hex "dotdo" "$VERSION" || true

echo ""
echo "=== pub.dev ==="
"$SCRIPT_DIR/version-check.sh" pub "capnweb_do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" pub "rpc_do" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" pub "dotdo" "$VERSION" || true

echo ""
echo "=== Maven Central ==="
"$SCRIPT_DIR/version-check.sh" maven "do.capnweb:capnweb" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" maven "do.rpc:rpc" "$VERSION" || true
"$SCRIPT_DIR/version-check.sh" maven "dev.dotdo:dotdo" "$VERSION" || true

echo ""
echo "Done checking versions."
