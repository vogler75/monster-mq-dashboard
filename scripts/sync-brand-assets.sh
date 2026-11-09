#!/usr/bin/env bash
# Copy the NexusMQ brand assets from a monster-mq-homepage checkout into
# src/brands/nexusmq/. The homepage repo is the source of truth for the logos.
#
#   scripts/sync-brand-assets.sh [path-to-monster-mq-homepage]
#
# Default path: ../homepage (next to this repo).
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$here/../homepage}"
dest="$here/src/brands/nexusmq"

if [ ! -f "$src/logo-nexus.svg" ]; then
    echo "error: $src does not look like a monster-mq-homepage checkout (logo-nexus.svg missing)" >&2
    echo "clone it with: git clone git@github.com:vogler75/monster-mq-homepage.git $src" >&2
    exit 1
fi

mkdir -p "$dest"
copy() { cp "$src/$1" "$dest/$2"; echo "  $1 -> src/brands/nexusmq/$2"; }
copy logo-nexus.svg             logo.svg
copy logo-nexus.png             logo.png
copy logo-nexus-small.png       logo-small.png
copy favicon-nexus.ico          favicon.ico
copy favicon-nexus-16x16.png    favicon-16x16.png
copy favicon-nexus-32x32.png    favicon-32x32.png
copy apple-touch-icon-nexus.png apple-touch-icon.png
