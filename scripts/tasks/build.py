"""make.py build - web bundle (dist/) and Electron desktop packages (dist-desktop/)."""

import argparse
import shutil
import sys
from pathlib import Path
from typing import List, Optional, Set

from mmqlib import fs, proc, ui
from mmqlib.cli import Command
from mmqlib.version import Version, read_version_file, update_npm_version

DESKTOP_DIR = "dist-desktop"

# Names produced by older electron-builder configs -> the names publish expects.
# The current package.json artifactName settings already produce the new names.
_RENAMES = {
    "mac": {
        "MonsterMQ-Dashboard-x64.dmg": "MonsterMQ-Dashboard-mac-x64.dmg",
        "MonsterMQ-Dashboard-arm64.dmg": "MonsterMQ-Dashboard-mac-arm64.dmg",
    },
    "win": {
        "MonsterMQ-Dashboard Setup.exe": "MonsterMQ-Dashboard-win-x64-setup.exe",
        "MonsterMQ-Dashboard Setup arm64.exe": "MonsterMQ-Dashboard-win-arm64-setup.exe",
    },
}


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="make.py build",
        description="Build the web dashboard (dist/) and/or the Electron desktop apps (dist-desktop/).")
    p.add_argument("-b", "--web", action="store_true", help="web dashboard assets (dist/)")
    p.add_argument("-d", "--desktop", action="store_true", help="all desktop apps (macOS DMG & Windows NSIS)")
    p.add_argument("-m", "--mac", action="store_true", help="macOS desktop DMG only (needs macOS)")
    p.add_argument("-w", "--win", action="store_true", help="Windows desktop NSIS setup only")
    p.add_argument("-a", "--all", action="store_true", help="web bundle and all desktop packages")
    p.add_argument("-c", "--clean", action="store_true", help="clean dist/ and dist-desktop/ (alone: clean only)")
    return p


def sync_npm_version(root: Path) -> None:
    """Keep package.json / package-lock.json at the version in version.txt (no node needed)."""
    path = root / "version.txt"
    if not path.is_file():
        return
    version = Version.parse(read_version_file(path))
    changed = update_npm_version(root, version)
    if changed:
        ui.warn(f"{', '.join(p.name for p in changed)} set to {version} (was out of sync with version.txt)")
    else:
        ui.info(f"Version {version}")


def _prepare_icon(root: Path) -> None:
    icon = root / "icons" / "icon.png"
    if icon.exists():
        return
    for candidate in ("appicon.png", "appicon-option1.png"):
        src = root / candidate
        if src.exists():
            icon.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, icon)
            return


def build(root: Path, web: bool, mac: bool, win: bool) -> int:
    """Build the selected targets. The web bundle is always built (desktop apps package it)."""
    if mac and sys.platform != "darwin":
        ui.warn("Skipping the macOS desktop build: DMG packaging requires macOS.")
        mac = False

    ui.header("Building MonsterMQ Dashboard")
    sync_npm_version(root)

    ui.step("Installing npm dependencies...")
    proc.run(["npm", "install"], cwd=root)
    ui.step("Building web dashboard assets...")
    proc.run(["npm", "run", "build"], cwd=root)
    ui.ok("Web dashboard built in dist/")

    if mac or win:
        ui.header("Packaging MonsterMQ Desktop App")
        _prepare_icon(root)
        flags: List[str] = ["--x64", "--arm64", "--publish", "never"]
        if mac:
            flags.append("--mac")
        if win:
            flags.append("--win")
            # NSIS needs Windows (or wine); elsewhere fall back to a zip of the Windows app.
            if sys.platform.startswith("linux") and not proc.which("wine"):
                ui.warn("wine not found: building the Windows zip target instead of the NSIS setup.")
                flags.append("--config.win.target=zip")
        proc.run(["npx", "electron-builder", *flags], cwd=root)

        out = root / DESKTOP_DIR
        for target, renames in _RENAMES.items():
            if (target == "mac" and mac) or (target == "win" and win):
                for old, new in renames.items():
                    if (out / old).exists():
                        (out / old).replace(out / new)
        ui.ok(f"Desktop packages built in {DESKTOP_DIR}/")

    ui.ok("Build complete")
    return 0


def run_build(root: Path, argv: List[str]) -> Optional[int]:
    parser = _parser()
    if not argv:
        parser.print_help()
        return 0
    a = parser.parse_args(argv)
    web = a.web or a.all
    mac = a.mac or a.desktop or a.all
    win = a.win or a.desktop or a.all

    if a.clean:
        ui.step("Cleaning output directories...")
        for name in ("dist", DESKTOP_DIR):
            fs.rmtree(root / name)
        ui.ok("Clean complete")
    if not (web or mac or win):
        return 0
    return build(root, web, mac, win)


def command(root: Path) -> Command:
    return Command("build the web bundle and/or desktop apps (--web, --desktop, --mac, --win, --all, --clean)",
                   lambda argv: run_build(root, argv))
