#!/bin/bash
# Test script to validate no workspace: protocols exist in TypeScript package.json files
# RED: This script should FAIL if any workspace: protocols are found

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TS_PACKAGES_DIR="$ROOT_DIR/packages/typescript"

PACKAGES=("capnweb" "rpc" "dotdo" "oauth")
ERRORS=0

echo "Checking TypeScript packages for workspace: protocols..."
echo "========================================================"

for pkg in "${PACKAGES[@]}"; do
  PKG_JSON="$TS_PACKAGES_DIR/$pkg/package.json"

  if [ ! -f "$PKG_JSON" ]; then
    echo "WARNING: $PKG_JSON not found"
    continue
  fi

  # Check for workspace: in dependencies
  if grep -q '"workspace:' "$PKG_JSON"; then
    echo "FAIL: $pkg/package.json contains workspace: protocol"
    grep '"workspace:' "$PKG_JSON" | sed 's/^/  /'
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $pkg/package.json - no workspace: protocols found"
  fi
done

echo "========================================================"

if [ $ERRORS -gt 0 ]; then
  echo "ERROR: Found $ERRORS package(s) with workspace: protocols"
  echo ""
  echo "Before publishing, replace workspace:* with actual versions (e.g., ^0.1.0)"
  echo "For local development, workspace:* is fine."
  exit 1
else
  echo "SUCCESS: All packages are ready for publishing"
  exit 0
fi
