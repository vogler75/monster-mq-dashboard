# AGENTS.md

This file provides guidance to AI coding assistants working with code in this repository.

## Project Overview

MonsterMQ Dashboard is the official web dashboard and Electron desktop client for MonsterMQ.
Built with Siemens iX web components, Vite, and vanilla JavaScript (ES6+).

## Build and Run Commands

```bash
# Install dependencies
npm install

# Dev server on http://localhost:5173
npm run dev

# Expose on all interfaces (or proxy to a specific broker host:port)
./run.sh
VITE_LOCAL_GRAPHQL_TARGET=http://localhost:4000 ./run.sh

# Production web build (outputs to dist/)
npm run build
# Or build script:
./build.sh
./build.sh --web

# Desktop app packaging (outputs to dist-desktop/)
./build.sh --all     # Web + all desktop packages
./build.sh --mac     # macOS DMG
./build.sh --win     # Windows NSIS setup
./build.sh --clean   # Clean output folders

# Release & version management
./release.sh         # Auto-increment patch version (e.g. 1.8.29 -> 1.8.30)
./release.sh 1.9.0   # Set explicit version and create tag

# Publish desktop apps to GitHub Releases
./publish.sh         # Upload desktop packages for current version
./publish.sh --build # Build and publish
```

## Architecture & Code Rules

Read `DESIGN.md` before making any dashboard edits.

### The One Cardinal Rule
**Pages MUST NOT redefine shared components in a local `<style>` block.**
The SPA router in `js/sidebar.js` loads page content and hoists styles into `<head>` after shared stylesheets. Local copies of `.data-table`, `.btn`, `.form-control`, `.card`, etc., will cause visual bugs across page transitions.

### Key Files & Ownership
- `src/assets/components.css`: The design system. Every recurring UI element (`.data-table`, `.metric-card`, `.section-card`, `.status-badge`, `.btn`, `.form-control`, `.loading-indicator`, `.error-message`).
- `src/assets/monster-theme.css`: Brand colors, CSS variables, scrollbars, auth indicator, login page.
- `src/assets/ix-app.css`: Layout overrides only (`ix-menu` height, viewport, `.main-content`).
- `src/js/ui.js`: Modals, confirmations, toasts, loading/error states (`window.ui`).
- `src/js/sidebar.js`: Navigation menu config and SPA router.
- `src/js/graphql-client.js`: GraphQL client (`window.graphqlClient`).
- `src/pages/`: Individual page views.
- `src/js/`: Page-specific manager classes.
- `electron/`: Desktop application entry (`main.cjs`, `preload.cjs`).

### Air-Gapped Bundling
Never load third-party libraries from CDNs. Third-party vendor bundles are registered in `vite.config.js` under `VENDOR_BUNDLES` and copied into `dist/js/vendor/` at build time.

## Git and Commit Guidelines

**CRITICAL: NEVER AUTO-COMMIT UNDER ANY CIRCUMSTANCES**
- Assistants must NEVER create git commits without explicit user authorization.
- Always present changes for review first and ask the user before committing.
