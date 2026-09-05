#!/bin/bash
set -euo pipefail

# publish.sh - Upload MonsterMQ Dashboard desktop apps to GitHub Releases
#
# Usage:
#   ./publish.sh              # Publish desktop apps for current version to GitHub Release
#   ./publish.sh --all        # Publish all desktop packages (macOS + Windows)
#   ./publish.sh --mac        # Publish macOS DMG packages only
#   ./publish.sh --win        # Publish Windows setup packages only
#   ./publish.sh -b, --build  # Build desktop packages before publishing
#   ./publish.sh -y, --yes    # Auto-confirm without prompt
#   ./publish.sh -h, --help   # Show help message

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Resolve version
if [ -f "version.txt" ]; then
  RAW_VERSION=$(head -n 1 version.txt | tr -d '\r' | tr -d '\n')
  VERSION=$(echo "$RAW_VERSION" | cut -d'+' -f1)
elif [ -f "package.json" ]; then
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
else
  VERSION=""
fi

if [ -z "$VERSION" ]; then
  echo -e "${RED}Error: Could not determine version from version.txt or package.json${NC}"
  exit 1
fi

TAG="v${VERSION}"

PUBLISH_MAC=false
PUBLISH_WIN=false
BUILD_BEFORE_PUBLISH=false
AUTO_CONFIRM=false
EXPLICIT_TARGET=false

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Uploads MonsterMQ Dashboard desktop apps to GitHub Releases for tag ${TAG}."
  echo ""
  echo "Options:"
  echo "  --all, -a          Publish all desktop packages (macOS DMG & Windows setup)"
  echo "  --mac, -m          Publish macOS DMG packages only"
  echo "  --win, -w          Publish Windows setup packages only"
  echo "  --build, -b        Build desktop apps first (via ./build.sh) before uploading"
  echo "  -y, --yes          Auto-confirm prompt (non-interactive)"
  echo "  -t, --tag <tag>    Override release tag (default: ${TAG})"
  echo "  -h, --help         Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                 # Upload available desktop packages for ${TAG}"
  echo "  $0 --build         # Build desktop packages and upload to GitHub"
  echo "  $0 --mac -y        # Upload macOS DMG only without confirmation prompt"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all|-a|all)
      PUBLISH_MAC=true
      PUBLISH_WIN=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --mac|-m|mac)
      PUBLISH_MAC=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --win|-w|win)
      PUBLISH_WIN=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --build|-b)
      BUILD_BEFORE_PUBLISH=true
      shift
      ;;
    -y|--yes)
      AUTO_CONFIRM=true
      shift
      ;;
    -t|--tag)
      if [ -n "${2:-}" ]; then
        TAG="$2"
        shift 2
      else
        echo -e "${RED}Error: --tag requires a value${NC}"
        exit 1
      fi
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      usage
      ;;
  esac
done

# If no target specified, publish all available desktop apps
if [ "$EXPLICIT_TARGET" = false ]; then
  PUBLISH_MAC=true
  PUBLISH_WIN=true
fi

echo -e "${GREEN}=== MonsterMQ Dashboard GitHub Publisher (${TAG}) ===${NC}"

# Check GitHub CLI
if ! command -v gh &> /dev/null; then
  echo -e "${RED}Error: GitHub CLI ('gh') is not installed.${NC}"
  echo "Install via: brew install gh (macOS) or visit https://cli.github.com"
  exit 1
fi

if ! gh auth status &> /dev/null; then
  echo -e "${RED}Error: GitHub CLI is not authenticated.${NC}"
  echo "Run: gh auth login"
  exit 1
fi

# Build if requested
if [ "$BUILD_BEFORE_PUBLISH" = true ]; then
  echo -e "${YELLOW}Building desktop packages before publishing...${NC}"
  if [ "$PUBLISH_MAC" = true ] && [ "$PUBLISH_WIN" = true ]; then
    ./build.sh --desktop
  elif [ "$PUBLISH_MAC" = true ]; then
    ./build.sh --mac
  elif [ "$PUBLISH_WIN" = true ]; then
    ./build.sh --win
  fi
fi

# Collect desktop files
RELEASE_FILES=()
shopt -s nullglob

if [ "$PUBLISH_MAC" = true ]; then
  for f in dist-desktop/MonsterMQ-Dashboard*.dmg; do
    if [[ "$f" != *.blockmap ]]; then
      RELEASE_FILES+=("$f")
    fi
  done
fi

if [ "$PUBLISH_WIN" = true ]; then
  for f in dist-desktop/MonsterMQ-Dashboard*-setup.exe dist-desktop/MonsterMQ-Dashboard*.exe; do
    if [[ "$f" != *.blockmap ]]; then
      RELEASE_FILES+=("$f")
    fi
  done
fi

shopt -u nullglob

# If no files found, fail with error
if [ ${#RELEASE_FILES[@]} -eq 0 ]; then
  echo -e "${RED}Error: No desktop artifacts found in dist-desktop/.${NC}"
  echo -e "${YELLOW}Please build desktop apps first with: ./build.sh --desktop (or ./build.sh --all)${NC}"
  exit 1
fi

# Deduplicate
UNIQUE_FILES=()
SEEN_FILES=" "
for file in "${RELEASE_FILES[@]}"; do
  BASE="$(basename "$file")"
  case "$SEEN_FILES" in
    *" $BASE "*)
      ;;
    *)
      SEEN_FILES="${SEEN_FILES}${BASE} "
      UNIQUE_FILES+=("$file")
      ;;
  esac
done

if [ ${#UNIQUE_FILES[@]} -eq 0 ]; then
  echo -e "${RED}Error: No release artifacts found to upload in dist-desktop/.${NC}"
  exit 1
fi

echo -e "${GREEN}Desktop artifacts to upload for ${YELLOW}${TAG}${GREEN}:${NC}"
for file in "${UNIQUE_FILES[@]}"; do
  SIZE=$(du -h "$file" | cut -f1)
  echo -e "  • ${BLUE}${file}${NC} (${SIZE})"
done
echo ""

# Confirm before upload
if [ "$AUTO_CONFIRM" = false ]; then
  read -p "Upload these artifacts to GitHub release ${TAG}? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Publish cancelled by user.${NC}"
    exit 0
  fi
fi

# Check / push git tag
if git rev-parse "$TAG" >/dev/null 2>&1; then
  if ! git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
    echo -e "${YELLOW}Tag ${TAG} exists locally but not on remote. Pushing tag...${NC}"
    git push origin "$TAG" || {
      echo -e "${YELLOW}Warning: Could not push tag to origin (may need permissions). Continuing...${NC}"
    }
  fi
fi

# Upload or create release
if gh release view "$TAG" &> /dev/null; then
  echo -e "${YELLOW}Uploading artifacts to existing GitHub release ${TAG}...${NC}"
  gh release upload "$TAG" "${UNIQUE_FILES[@]}" --clobber
else
  echo -e "${YELLOW}Creating new GitHub release ${TAG}...${NC}"
  RELEASE_NOTES="releases/${TAG}.txt"
  if [ -f "$RELEASE_NOTES" ]; then
    gh release create "$TAG" "${UNIQUE_FILES[@]}" --title "MonsterMQ Dashboard ${TAG}" --notes-file "$RELEASE_NOTES"
  else
    gh release create "$TAG" "${UNIQUE_FILES[@]}" --title "MonsterMQ Dashboard ${TAG}" --generate-notes
  fi
fi

echo -e "${GREEN}✓ Desktop apps published successfully to GitHub release ${TAG}!${NC}"
