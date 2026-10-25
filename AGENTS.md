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

# One cross-platform entry point (Windows: py make.py ...); see: python make.py help
# Expose on all interfaces (or proxy to a specific broker host:port)
python make.py run
VITE_LOCAL_GRAPHQL_TARGET=http://localhost:4000 python make.py run

# Production web build (outputs to dist/)
npm run build
# Or:
python make.py build --web

# Desktop app packaging (outputs to dist-desktop/)
python make.py build --all     # Web + all desktop packages
python make.py build --mac     # macOS DMG (on macOS)
python make.py build --win     # Windows NSIS setup
python make.py build --clean   # Clean output folders

# Release & version management (checks first, one atomic push, rolls back on failure)
python make.py release         # Finalize X.Y.Z-dev -> X.Y.Z (or bump patch), tag and push
python make.py release 1.9.0   # Explicit version
python make.py dev             # Advance to the next -dev version
python make.py status          # Show version/tag consistency; 'repair' fixes it

# Publish desktop apps to GitHub Releases (tag must be on origin at HEAD)
python make.py publish         # Upload desktop packages for current version
python make.py publish --build # Build and publish
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
