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

# Or listen on all interfaces
python make.py run

# Proxy GraphQL to a specific broker host:port
VITE_LOCAL_GRAPHQL_TARGET=http://localhost:4000 python make.py run
```

---

## Build Commands

`make.py` is the single build, release and publish tool. It needs only Python 3.9+ and runs the same on Windows, macOS and Linux (on Windows use `py make.py ...`). `python make.py help` lists all commands, `python make.py <command> --help` their options.

### Web Dashboard Build

```bash
python make.py build --web
# Or using npm:
npm run build
```
Outputs static web assets into `dist/`.

### Desktop Applications (Electron)

```bash
# Run Electron in development mode
npm run electron:dev

# Build all desktop packages (macOS DMG & Windows setup)
python make.py build --all

# Or build for specific platform:
python make.py build --mac       # macOS DMG (only on macOS)
python make.py build --win       # Windows NSIS setup (zip on Linux without wine)

# Clean build artifacts:
python make.py build --clean
```

Desktop packages will be generated in `dist-desktop/`.

### macOS Desktop App Installation (Gatekeeper)

When downloading pre-built macOS `.dmg` installers from GitHub Releases, macOS Gatekeeper tags the download with a quarantine attribute (`com.apple.quarantine`) because the binary is ad-hoc signed without a paid Apple Developer notarization certificate.

When opening for the first time, macOS may show:
> *"Apple could not verify “MonsterMQ-Dashboard.app” is free of malware that may harm your Mac or compromise your privacy."*

#### How to Open:

- **Option 1 (System Settings)**:
  1. Open **System Settings** &rarr; **Privacy & Security**.
  2. Scroll down to the **Security** section.
  3. Look for *“MonsterMQ-Dashboard.app” was blocked from use...* and click **Open Anyway**.

- **Option 2 (Terminal)**:
  After copying `MonsterMQ-Dashboard.app` to your `/Applications` folder, run:
  ```bash
  xattr -cr /Applications/MonsterMQ-Dashboard.app
  ```
  *(This removes the quarantine flag and allows the app to launch directly).*

---

## Release & Publishing Workflow

### 1. Tag a New Release (`make.py release`)

Checks that the working tree is clean and in sync with `origin`, then sets the version in `version.txt`, `package.json` and `package-lock.json`, writes release notes to `releases/vX.Y.Z.txt`, commits, creates the annotated tag `vX.Y.Z` and pushes branch and tag in one atomic push. If anything fails, the local changes are rolled back.

```bash
# Finalize the dev version (1.8.36-dev -> 1.8.36) or bump the patch version
python make.py release

# Or set explicit version:
python make.py release 1.9.0

# Afterwards, advance to the next development version:
python make.py dev

# Check / fix version and tag consistency:
python make.py status
python make.py repair
```

Pushing the tag starts the GitHub **Release** workflow, which builds the web zip, macOS DMG and Windows setup and publishes the GitHub release.

### 2. Publish Locally Built Packages (`make.py publish`)

Upload desktop applications (`.dmg` and `.exe`) to the GitHub release. The release tag must already exist on `origin` and point at the current commit; publish never creates or moves tags.

```bash
# Build desktop packages and upload to GitHub Release
python make.py publish --build

# Or upload existing packages in dist-desktop/:
python make.py publish

# Upload specific platform only, or check without uploading:
python make.py publish --mac
python make.py publish --win
python make.py publish --dry-run
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
├── make.py               # Build, run, release & publish tool (python make.py help)
├── scripts/              # make.py implementation (mmqlib/, tasks/, tests/) & JS check scripts
└── DESIGN.md             # Design system rules & UI guidelines
```

---

## Design System & Development Guidelines

See [DESIGN.md](DESIGN.md) for detailed guidelines on the Siemens iX design system, canonical page shapes (List and Detail), and styling rules.

Key rule: **Never redefine shared UI classes in page-level `<style>` blocks.** Use shared classes from `src/assets/components.css` and helper methods in `window.ui`.

---

## License

See [LICENSE](LICENSE) for license terms.
