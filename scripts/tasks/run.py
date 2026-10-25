"""make.py run - start the Vite dev server."""

import argparse
from pathlib import Path
from typing import List, Optional

from mmqlib import proc, ui
from mmqlib.cli import Command

EPILOG = """\
Any other options are passed to Vite, e.g.:
  python make.py run --port 8080
  python make.py run --local
Proxy /graphql to a specific broker by setting VITE_LOCAL_GRAPHQL_TARGET=http://broker-host:4000
"""


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="make.py run", epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Start the Vite dev server, listening on all interfaces (http://<this-host>:5173).")
    p.add_argument("-b", "--build", action="store_true", help="build the dashboard before starting")
    p.add_argument("--local", action="store_true", help="listen on localhost only (Vite's default)")
    return p


def run(root: Path, argv: List[str]) -> Optional[int]:
    a, vite_args = _parser().parse_known_args(argv)
    if vite_args and vite_args[0] == "--":
        vite_args = vite_args[1:]

    if not (root / "node_modules").is_dir():
        ui.step("Installing dependencies...")
        proc.run(["npm", "install"], cwd=root)
    if a.build:
        ui.step("Building dashboard...")
        proc.run(["npm", "run", "build"], cwd=root)

    env = {}
    if not a.local:
        vite_args = ["--host", *vite_args]
        # Vite rejects requests whose Host header it doesn't recognise (DNS-rebinding protection),
        # which breaks access by hostname even with --host. vite.config.js reads VITE_EXPOSE to
        # relax that check while the dev server is deliberately exposed.
        env["VITE_EXPOSE"] = "1"

    # `npm run dev --host` would not work: npm consumes --host itself. Everything after `--`
    # is passed through to Vite.
    return proc.run(["npm", "run", "dev", "--", *vite_args], cwd=root, env=env, check=False)


def command(root: Path) -> Command:
    return Command("start the Vite dev server (-b to build first, --local, other args go to Vite)",
                   lambda argv: run(root, argv))
