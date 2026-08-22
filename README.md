# MonsterMQ Dashboard

The official web dashboard and desktop client for [MonsterMQ](https://github.com/vogler75/monster-mq).

Built with **Siemens iX** Web Components (`@siemens/ix`), **Vite**, and vanilla modern JavaScript (ES6+), with optional **Electron** desktop packaging for macOS and Windows.

---

## Features

- **Topic Browser & Real-Time Monitoring**: Interactive topic tree, live value updates, sparklines, and historical charts.
- **Device & Connector Management**: Manage bridges and connectors (OPC UA, PLC4X, Kafka, NATS, Redis, Telegram, WinCC OA/Unified, SparkplugB, Neo4j, JDBC & InfluxDB Loggers).
- **Flow Engine & Visual Workflows**: Automation workflows, script execution, and visual editor.
- **AI Agents & GenAI**: Configure and monitor AI agents, providers (Gemini, OpenAI, Anthropic, Ollama, DeepSeek), and MCP servers.
- **Multi-Broker Management**: Switch between local and remote brokers with built-in multi-broker proxy configuration.
- **Cross-Platform Desktop App**: Packaged with Electron for macOS (DMG) and Windows (NSIS installer).
- **Air-Gapped Ready**: All third-party libraries (Chart.js, ECharts, Marked, Siemens iX icons) are bundled locally — zero CDN dependencies.

---

## Quick Start

### Prerequisites

- **Node.js**: v18+ (v20+ recommended)
- **npm**: v9+

### Installation

```bash
npm install
```

### Development Server

```bash
# Start Vite dev server on http://localhost:5173
npm run dev

# Or using the run script (listens on all interfaces)
./run.sh

# Proxy GraphQL to a specific broker host:port
VITE_LOCAL_GRAPHQL_TARGET=http://localhost:4000 ./run.sh
```

---

## Build Commands

The unified `build.sh` (and `build.bat` on Windows) script supports building both the web dashboard and desktop applications.

### Web Dashboard Build

```bash
# Build web assets (default)
./build.sh
# Or explicitly:
./build.sh --web
# Or using npm:
npm run build
```
Outputs static web assets into `dist/`.

### Desktop Applications (Electron)

```bash
# Run Electron in development mode
npm run electron:dev

# Build all desktop packages (macOS DMG & Windows setup)
./build.sh --all

# Or build for specific platform:
./build.sh --mac       # macOS DMG
./build.sh --win       # Windows NSIS setup

# Clean build artifacts:
./build.sh --clean
```

On Windows:
```cmd
build.bat --all
build.bat --win
```

Desktop packages will be generated in `dist-desktop/`.

---

## Release & Publishing Workflow

### 1. Tag a New Release (`release.sh`)

Automatically bumps version in `version.txt` and `package.json`, generates release notes in `releases/vX.Y.Z.txt` from git commit logs, commits the bump, and creates a local git tag:

```bash
# Auto-increment patch version (e.g. 1.8.29 -> 1.8.30)
./release.sh

# Or set explicit version:
./release.sh 1.9.0
```

### 2. Build & Publish to GitHub (`publish.sh`)

Upload desktop applications (`.dmg` and `.exe`) to GitHub Releases:

```bash
# Build desktop packages and upload to GitHub Release
./publish.sh --build

# Or upload existing packages in dist-desktop/:
./publish.sh

# Upload specific platform only:
./publish.sh --mac
./publish.sh --win

# Push commits and tag to remote repository:
git push origin HEAD && git push origin --tags
```

---

## Project Structure

```
dashboard/
├── icons/                # Desktop app icon assets (.png, .icns, .ico)
├── electron/             # Electron main process and preload scripts
│   ├── main.cjs
│   └── preload.cjs
├── src/                  # Web application source files
│   ├── index.html        # Single-page application entry point
│   ├── assets/           # Design system CSS (components.css, monster-theme.css, ix-app.css)
│   ├── config/           # Default broker config templates and instance config
│   ├── css/              # Page-specific styling overlays
│   ├── includes/         # HTML partials (sidebar-template.html)
│   ├── js/               # Application logic, GraphQL client, UI helpers, page managers
│   └── pages/            # View templates loaded by the SPA router
├── package.json          # Dependencies & build scripts
├── vite.config.js        # Vite bundler configuration & multi-broker dev server
├── build.sh              # Unified build script (web & desktop)
├── build.bat             # Unified build script for Windows (web & desktop)
├── release.sh            # Version bump, release notes generation & git tagging
├── publish.sh            # Upload desktop apps to GitHub Releases
├── run.sh                # Local Vite dev server runner with proxy support
└── DESIGN.md             # Design system rules & UI guidelines
```

---

## Design System & Development Guidelines

See [DESIGN.md](DESIGN.md) for detailed guidelines on the Siemens iX design system, canonical page shapes (List and Detail), and styling rules.

Key rule: **Never redefine shared UI classes in page-level `<style>` blocks.** Use shared classes from `src/assets/components.css` and helper methods in `window.ui`.

---

## License

See [LICENSE](LICENSE) for license terms.
