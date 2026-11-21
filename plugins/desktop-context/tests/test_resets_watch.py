import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIDECAR_DIR = ROOT / "sidecars" / "context"
PATCHER_FILE = ROOT / "scripts" / "context_bridge_patcher.js"
NODE_TEST_FILES = tuple(sorted((ROOT / "tests").glob("*.test.mjs")))


class ResetsWatchAndTopbarTest(unittest.TestCase):
    def test_node_syntax_checks(self):
        targets = [SIDECAR_DIR / n for n in ("config.mjs", "resets_watch.mjs", "inject-ring.mjs", "main.mjs")]
        if PATCHER_FILE.exists():
            targets.append(PATCHER_FILE)
        for target in targets:
            proc = subprocess.run(
                ["node", "--check", str(target)],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(
                proc.returncode,
                0,
                f"node --check failed for {target.name}:\n{proc.stderr or proc.stdout}",
            )

    def test_resets_watch_and_slim_topbar_suite(self):
        proc = subprocess.run(
            ["node", "--test", *[str(f) for f in NODE_TEST_FILES]],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            proc.returncode,
            0,
            f"node test suite failed:\n{proc.stdout}\n{proc.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
