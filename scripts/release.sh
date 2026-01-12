#!/bin/bash
# release.sh - Centralized release script for all packages
#
# Usage:
#   ./scripts/release.sh              # Release using version from package.json
#   ./scripts/release.sh 0.5.0        # Release specific version
#   ./scripts/release.sh --dry-run    # Dry run with package.json version
#   ./scripts/release.sh 0.5.0 --dry-run  # Dry run with specific version

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse arguments
VERSION=""
DRY_RUN=""
SKIP_SYNC=""
LANGUAGES=""

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN="--dry-run"
      ;;
    --skip-sync)
      SKIP_SYNC="true"
      ;;
    --lang=*)
      LANGUAGES="$arg"
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [version] [--dry-run] [--skip-sync] [--lang=ts,py,...]" >&2
      exit 1
      ;;
    *)
      VERSION="$arg"
      ;;
  esac
done

# Get version from package.json if not specified
if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE} DotDo SDKs Release v${VERSION}${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

if [[ -n "$DRY_RUN" ]]; then
  echo -e "${YELLOW}DRY RUN MODE${NC}"
  echo ""
fi

# Step 1: Sync versions across all packages
if [[ -z "$SKIP_SYNC" ]]; then
  echo -e "${CYAN}Step 1: Syncing version to all packages...${NC}"
  "$SCRIPT_DIR/sync-versions.sh" "$VERSION"
  echo ""
fi

# Step 2: Run publish script
echo -e "${CYAN}Step 2: Publishing to all registries...${NC}"
"$SCRIPT_DIR/publish/publish-all.sh" "$VERSION" $DRY_RUN $LANGUAGES

# Step 3: Create git tag (if not dry run)
if [[ -z "$DRY_RUN" ]]; then
  echo ""
  echo -e "${CYAN}Step 3: Creating git tag...${NC}"

  if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo -e "${YELLOW}Tag v$VERSION already exists${NC}"
  else
    git tag "v$VERSION"
    echo -e "${GREEN}Created tag v$VERSION${NC}"
  fi

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN} Release v${VERSION} complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "Next steps:"
  echo "  git push origin v$VERSION    # Push tag to trigger auto-sync registries"
  echo ""
fi
