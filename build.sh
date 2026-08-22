#!/bin/bash
set -euo pipefail

# Build script for MonsterMQ Dashboard (Web & Desktop)
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BUILD_WEB=false
BUILD_MAC=false
BUILD_WIN=false
BUILD_ALL=false
CLEAN=false
EXPLICIT_TARGET=false

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  --web, -b          Build web dashboard assets (dist/)"
  echo "  --desktop, -d      Build all desktop apps (macOS DMG & Windows NSIS)"
  echo "  --mac, -m          Build macOS desktop DMG app only"
  echo "  --win, -w          Build Windows desktop NSIS setup only"
  echo "  --all, -a          Build web bundle and all desktop packages"
  echo "  --clean, -c        Clean dist/ and dist-desktop/ directories"
  echo "  -h, --help         Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 --web           # Build web dashboard assets"
  echo "  $0 --all           # Build web assets and all desktop packages"
  echo "  $0 --mac           # Build macOS desktop application"
  echo "  $0 --win           # Build Windows desktop application"
  exit 0
}

if [ $# -eq 0 ]; then
  usage
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web|-b|web)
      BUILD_WEB=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --desktop|-d|desktop)
      BUILD_MAC=true
      BUILD_WIN=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --mac|-m|mac)
      BUILD_MAC=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --win|-w|win)
      BUILD_WIN=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --all|-a|all)
      BUILD_ALL=true
      BUILD_WEB=true
      BUILD_MAC=true
      BUILD_WIN=true
      EXPLICIT_TARGET=true
      shift
      ;;
    --clean|-c|clean)
      CLEAN=true
      shift
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

if [[ "$CLEAN" = true ]]; then
  echo -e "${YELLOW}Cleaning output directories...${NC}"
  rm -rf dist dist-desktop
  echo -e "${GREEN}✓ Clean complete${NC}"
fi

# If only clean was requested, exit
if [[ "$BUILD_WEB" = false && "$BUILD_MAC" = false && "$BUILD_WIN" = false ]]; then
  exit 0
fi

# Sync package.json version with version.txt if present
VERSION_FILE=""
if [[ -f "version.txt" ]]; then
  VERSION_FILE="version.txt"
elif [[ -f "../version.txt" ]]; then
  VERSION_FILE="../version.txt"
fi

if [[ -n "$VERSION_FILE" ]]; then
  RAW_VERSION=$(head -n 1 "$VERSION_FILE" | tr -d '\r' | tr -d '\n')
  VERSION=$(echo "$RAW_VERSION" | cut -d'+' -f1)
  if [[ -n "$VERSION" ]]; then
    echo -e "${GREEN}Syncing version: ${YELLOW}${VERSION}${NC}"
    npm version "$VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1 || true
  fi
fi

# Skip macOS desktop build if running on Linux
if [[ "$BUILD_MAC" = true && "$(uname -s)" != "Darwin" ]]; then
  echo -e "${YELLOW}Notice: Skipping macOS desktop build on Linux (macOS DMG packaging requires macOS).${NC}"
  BUILD_MAC=false
fi

echo -e "${GREEN}Installing npm dependencies...${NC}"
npm install

echo -e "${GREEN}Building web dashboard assets...${NC}"
npm run build

echo -e "${GREEN}✓ Web dashboard built in dist/${NC}"

# If any desktop platform is requested, package with electron-builder
if [[ "$BUILD_MAC" = true || "$BUILD_WIN" = true ]]; then
  echo -e "${GREEN}=== Packaging MonsterMQ Desktop App ===${NC}"

  # Prepare app icon if needed
  mkdir -p icons
  if [[ ! -f icons/icon.png ]]; then
    if [[ -f appicon.png ]]; then
      cp appicon.png icons/icon.png
    elif [[ -f appicon-option1.png ]]; then
      cp appicon-option1.png icons/icon.png
    fi
  fi

  BUILD_FLAGS="--x64 --arm64 --publish never"
  if [[ "$BUILD_MAC" = true ]]; then
    BUILD_FLAGS="$BUILD_FLAGS --mac"
  fi
  if [[ "$BUILD_WIN" = true ]]; then
    BUILD_FLAGS="$BUILD_FLAGS --win"
    if [[ "$(uname -s)" != "Darwin" ]] && ! command -v wine &> /dev/null; then
      echo -e "${YELLOW}Notice: wine not detected on Linux. Building Windows zip target.${NC}"
      BUILD_FLAGS="$BUILD_FLAGS --config.win.target=zip"
    fi
  fi

  npx electron-builder $BUILD_FLAGS

  # Post-processing artifact rename for consistency
  if [[ "$BUILD_MAC" = true ]]; then
    if [[ -f "dist-desktop/MonsterMQ-Dashboard-x64.dmg" ]]; then
      mv "dist-desktop/MonsterMQ-Dashboard-x64.dmg" "dist-desktop/MonsterMQ-Dashboard-mac-x64.dmg"
    fi
    if [[ -f "dist-desktop/MonsterMQ-Dashboard-arm64.dmg" ]]; then
      mv "dist-desktop/MonsterMQ-Dashboard-arm64.dmg" "dist-desktop/MonsterMQ-Dashboard-mac-arm64.dmg"
    fi
  fi

  if [[ "$BUILD_WIN" = true ]]; then
    if [[ -f "dist-desktop/MonsterMQ-Dashboard Setup.exe" ]]; then
      mv "dist-desktop/MonsterMQ-Dashboard Setup.exe" "dist-desktop/MonsterMQ-Dashboard-win-x64-setup.exe"
    fi
    if [[ -f "dist-desktop/MonsterMQ-Dashboard Setup arm64.exe" ]]; then
      mv "dist-desktop/MonsterMQ-Dashboard Setup arm64.exe" "dist-desktop/MonsterMQ-Dashboard-win-arm64-setup.exe"
    fi
  fi

  echo -e "${GREEN}✓ Desktop packages built in dist-desktop/${NC}"
fi

echo -e "${GREEN}=== Build Complete ===${NC}"
