#!/usr/bin/env python3
"""MonsterMQ Dashboard build, release and publish tool - run 'python make.py help'."""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the tree; a release needs a clean working tree
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))

from mmqlib.cli import run_cli  # noqa: E402
from mmqlib.release import ReleaseConfig, release_commands  # noqa: E402
from tasks import build, publish, run  # noqa: E402

RELEASE = ReleaseConfig(
    name="MonsterMQ Dashboard",
    npm=True,  # package.json / package-lock.json follow version.txt, also for dev versions
    next_steps=[
        "Pushing the tag started the GitHub 'Release' workflow (web zip, macOS DMG, Windows setup)",
        "Local packages   : python make.py build --all, then python make.py publish",
        "Next dev version : python make.py dev",
    ],
)

COMMANDS = {
    "build": build.command(ROOT),
    "run": run.command(ROOT),
    "publish": publish.command(ROOT),
    **release_commands(RELEASE, ROOT),
}

if __name__ == "__main__":
    sys.exit(run_cli("make.py", "MonsterMQ Dashboard", COMMANDS))
