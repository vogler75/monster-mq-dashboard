"""Tests for the dashboard make.py tasks (external commands mocked).

Run from the repo root:  python -m unittest discover -s scripts/tests -v
"""

import sys
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import unittest  # noqa: E402

from tasks import build, publish  # noqa: E402
from test_release import RepoTestCase, sh  # noqa: E402


class BuildTests(RepoTestCase):
    def setUp(self):
        super().setUp()
        self.calls = []
        patcher = mock.patch.object(build.proc, "run", side_effect=lambda cmd, **kw: self.calls.append(cmd) or 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def builder_flags(self):
        return next((c[2:] for c in self.calls if c[:2] == ["npx", "electron-builder"]), None)

    def test_web_only_skips_electron_builder(self):
        self.assertEqual(build.run_build(self.work, ["--web"]), 0)
        self.assertIn(["npm", "run", "build"], self.calls)
        self.assertIsNone(self.builder_flags())

    def test_win_builds_nsis_on_windows_and_zip_on_linux_without_wine(self):
        with mock.patch.object(build.sys, "platform", "win32"):
            build.run_build(self.work, ["--win"])
        self.assertNotIn("--config.win.target=zip", self.builder_flags())
        self.calls.clear()
        with mock.patch.object(build.sys, "platform", "linux"), \
                mock.patch.object(build.proc, "which", return_value=None):
            build.run_build(self.work, ["--win"])
        self.assertIn("--config.win.target=zip", self.builder_flags())

    def test_mac_skipped_off_macos(self):
        with mock.patch.object(build.sys, "platform", "win32"):
            build.run_build(self.work, ["--desktop"])
        flags = self.builder_flags()
        self.assertIn("--win", flags)
        self.assertNotIn("--mac", flags)

    def test_clean_alone_builds_nothing(self):
        (self.work / "dist").mkdir()
        self.assertEqual(build.run_build(self.work, ["--clean"]), 0)
        self.assertFalse((self.work / "dist").exists())
        self.assertEqual(self.calls, [])

    def test_package_json_synced_from_version_txt(self):
        (self.work / "package.json").write_text('{\n  "version": "0.0.1"\n}\n')
        build.run_build(self.work, ["--web"])
        self.assertIn('"version": "1.0.0-dev"', (self.work / "package.json").read_text())


class PublishTests(RepoTestCase):
    def setUp(self):
        super().setUp()
        self.patches = {name: mock.patch.object(publish.github, name) for name in
                        ("require_gh", "release_exists", "upload", "create")}
        self.gh = {name: p.start() for name, p in self.patches.items()}
        for p in self.patches.values():
            self.addCleanup(p.stop)
        self.gh["release_exists"].return_value = True

    def make_release(self, version="1.0.0"):
        self.commit_file(self.work, "version.txt", f"{version}\n", "release")
        sh(self.work, "tag", "-a", f"v{version}", "-m", "r")
        sh(self.work, "push", "-q", "origin", f"v{version}")

    def add_package(self, name):
        out = self.work / "dist-desktop"
        out.mkdir(exist_ok=True)
        (out / name).write_bytes(b"x")
        return out / name

    def test_refuses_dev_version(self):
        self.assertEqual(publish.publish(self.work, ["-y"]), 1)
        self.gh["upload"].assert_not_called()

    def test_refuses_tag_missing_on_origin(self):
        self.commit_file(self.work, "version.txt", "1.0.0\n", "release")
        self.assertEqual(publish.publish(self.work, ["-y"]), 1)
        self.gh["upload"].assert_not_called()

    def test_refuses_tag_not_at_head_and_never_moves_it(self):
        self.make_release()
        self.commit_file(self.work, "later.txt", "x", "later")
        before = sh(self.tmp, "ls-remote", "--tags", str(self.origin))
        self.assertEqual(publish.publish(self.work, ["-y"]), 1)
        self.assertEqual(sh(self.tmp, "ls-remote", "--tags", str(self.origin)), before)

    def test_refuses_without_packages(self):
        self.make_release()
        self.assertEqual(publish.publish(self.work, ["-y"]), 1)

    def test_uploads_to_existing_release(self):
        self.make_release()
        dmg = self.add_package("MonsterMQ-Dashboard-mac-arm64.dmg")
        exe = self.add_package("MonsterMQ-Dashboard-win-x64-setup.exe")
        self.add_package("MonsterMQ-Dashboard-win-x64-setup.exe.blockmap")
        self.assertEqual(publish.publish(self.work, ["-y"]), 0)
        tag, files = self.gh["upload"].call_args[0][:2]
        self.assertEqual(tag, "v1.0.0")
        self.assertEqual(sorted(f.name for f in files), sorted([dmg.name, exe.name]))

    def test_win_only_and_create_release(self):
        self.make_release()
        self.add_package("MonsterMQ-Dashboard-mac-arm64.dmg")
        self.add_package("MonsterMQ-Dashboard-win-x64-setup.exe")
        self.gh["release_exists"].return_value = False
        self.assertEqual(publish.publish(self.work, ["--win", "-y"]), 0)
        files = self.gh["create"].call_args[0][1]
        self.assertEqual([f.name for f in files], ["MonsterMQ-Dashboard-win-x64-setup.exe"])

    def test_dry_run_uploads_nothing(self):
        self.make_release()
        self.add_package("MonsterMQ-Dashboard-win-x64-setup.exe")
        self.assertEqual(publish.publish(self.work, ["--dry-run"]), 0)
        self.gh["upload"].assert_not_called()
        self.gh["create"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
