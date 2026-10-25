"""make.py publish - upload the desktop apps to the GitHub release of the current version.

The GitHub "Release" workflow already builds and publishes all assets when a v* tag is
pushed; this command is for uploading locally built packages (e.g. a re-build), so it
uploads into the existing release with --clobber.
"""

import argparse
from pathlib import Path
from typing import List, Optional

from mmqlib import github, ui
from mmqlib.cli import Command
from mmqlib.git import Git, GitError
from mmqlib.version import Version, VersionError, read_version_file

from . import build as build_task

DESKTOP_DIR = build_task.DESKTOP_DIR


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="make.py publish",
        description="Upload the MonsterMQ Dashboard desktop apps to the GitHub release of the current version.")
    p.add_argument("-a", "--all", action="store_true", help="macOS DMG and Windows setup packages (default)")
    p.add_argument("-m", "--mac", action="store_true", help="macOS DMG packages only")
    p.add_argument("-w", "--win", action="store_true", help="Windows setup packages only")
    p.add_argument("-b", "--build", action="store_true", help="build the desktop apps first")
    p.add_argument("-y", "--yes", action="store_true", help="don't ask for confirmation")
    p.add_argument("-t", "--tag", help="upload to this release tag instead of v<version>")
    p.add_argument("-n", "--dry-run", action="store_true", help="run all checks and list the files, upload nothing")
    p.add_argument("--remote", default="origin", help="git remote holding the tag (default: origin)")
    return p


def _fail(message: str) -> int:
    ui.error(message)
    return 1


def collect(root: Path, mac: bool, win: bool) -> List[Path]:
    out = root / DESKTOP_DIR
    files = []
    if mac:
        files += sorted(out.glob("MonsterMQ-Dashboard*.dmg"))
    if win:
        files += sorted(out.glob("MonsterMQ-Dashboard*.exe"))
    seen, unique = set(), []
    for f in files:
        if f.is_file() and not f.name.endswith(".blockmap") and f.name not in seen:
            seen.add(f.name)
            unique.append(f)
    return unique


def publish(root: Path, argv: List[str]) -> Optional[int]:
    a = _parser().parse_args(argv)
    mac = a.mac or a.all or not (a.mac or a.win)
    win = a.win or a.all or not (a.mac or a.win)

    try:
        version = Version.parse(read_version_file(root / "version.txt"))
    except VersionError as e:
        return _fail(str(e))
    tag = a.tag or version.tag
    if version.is_prerelease and not a.tag:
        return _fail(f"current version {version} is a development version; GitHub releases are only "
                     "published for released versions. Run 'python make.py release' first.")
    ui.header(f"MonsterMQ Dashboard GitHub publisher ({tag})")

    # Every check runs before anything is built or uploaded.
    github.require_gh()
    git = Git(root)
    try:
        remote_tag = git.remote_tags(a.remote).get(tag)
    except GitError as e:
        return _fail(f"cannot read tags from {a.remote}: {e.stderr}")
    head = git.head()
    if remote_tag is None:
        return _fail(f"tag {tag} does not exist on {a.remote}. Create the release with "
                     "'python make.py release' (publish never creates or pushes tags).")
    if remote_tag.commit != head:
        msg = (f"tag {tag} on {a.remote} points at {remote_tag.commit[:7]}, but HEAD is {git.short()}: "
               "the packages would not match the release.")
        if not a.tag:
            return _fail(msg + " Check out the tag, or move it with 'python make.py retag'.")
        ui.warn(msg)
    if git.status_lines():
        ui.warn("working tree has uncommitted changes; the packages may not match the tagged commit")

    if a.build:
        ui.step("Building desktop packages before publishing...")
        build_task.build(root, web=True, mac=mac, win=win)

    files = collect(root, mac, win)
    if not files:
        return _fail(f"no desktop packages found in {DESKTOP_DIR}/. Build them first with "
                     "'python make.py build --desktop' (or publish --build).")

    ui.info(f"Desktop packages to upload to {tag}:")
    for f in files:
        ui.info(f"  - {f.relative_to(root).as_posix()} ({f.stat().st_size / 1_048_576:.1f} MB)")
    ui.info("")
    if a.dry_run:
        ui.info("Dry run: nothing was uploaded.")
        return 0
    ui.confirm(f"Upload these packages to GitHub release {tag}?", a.yes)

    if github.release_exists(tag, cwd=root):
        ui.step(f"Uploading to existing GitHub release {tag}...")
        github.upload(tag, files, cwd=root)
    else:
        ui.step(f"Creating GitHub release {tag}...")
        notes = root / "releases" / f"{tag}.txt"
        github.create(tag, files, f"MonsterMQ Dashboard {tag}",
                      notes_file=notes if notes.is_file() else None, cwd=root)
    ui.ok(f"Desktop apps published to GitHub release {tag}")
    return 0


def command(root: Path) -> Command:
    return Command("upload desktop apps to the GitHub release (--all, --mac, --win, --build, -y, --dry-run)",
                   lambda argv: publish(root, argv))
