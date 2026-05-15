"""
Integration tests for P-01: exercises harness.py, run.py, and self_check.py.

Run via:
    python -m unittest discover -s tests -p 'test_*.py' -v
    python tests/run_all.py
"""
from __future__ import annotations

import importlib
import subprocess
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
P01_DIR = TESTS_DIR / "p01-crdt"


def load_p01_module(name: str):
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    return importlib.import_module(name)


class TestP01Harness(unittest.TestCase):
    """Direct harness API checks (reference + chaos + randomized)."""

    def _adapter(self):
        myteam = load_p01_module("adapters.myteam")
        return myteam.Engine(fk_policy="tombstone")

    def test_harness_all_axes_quick(self) -> None:
        harness = load_p01_module("harness")
        adapter = self._adapter()
        try:
            ref = harness.run_reference(adapter, stated_fk_policy="tombstone")
            chs = harness.run_chaos(adapter, seeds=[1, 2])
            rnd = harness.run_randomized(adapter, seeds=[101, 202], n_peers=4, n_ops=80)
            score = harness.compute_score(ref, chs, rnd)
        finally:
            adapter.close()

        for axis, passed in score["axes"].items():
            with self.subTest(axis=axis):
                self.assertTrue(passed, f"axis failed: {axis}")

        self.assertEqual(score["weighted_score"], 1.0)


class TestP01SelfCheck(unittest.TestCase):
    """CLI entry point self_check.py (participant self-check matrix)."""

    def _run_self_check(self, quick: bool) -> subprocess.CompletedProcess[str]:
        cmd = [
            sys.executable,
            "self_check.py",
            "--adapter",
            "adapters.myteam:Engine",
            "--fk-policy",
            "tombstone",
        ]
        if quick:
            cmd.append("--quick")
        return subprocess.run(cmd, cwd=P01_DIR, capture_output=True, text=True)

    def test_self_check_quick_exit_zero(self) -> None:
        result = self._run_self_check(quick=True)
        if result.returncode != 0:
            self.fail(
                f"self_check.py --quick failed (exit {result.returncode})\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        self.assertIn("WEIGHTED SCORE", result.stdout)
        self.assertIn("1.00", result.stdout)

    def test_self_check_full_exit_zero(self) -> None:
        result = self._run_self_check(quick=False)
        if result.returncode != 0:
            self.fail(
                f"self_check.py failed (exit {result.returncode})\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        self.assertIn("WEIGHTED SCORE", result.stdout)
        self.assertIn("1.00", result.stdout)


class TestP01RunPy(unittest.TestCase):
    """CLI entry point run.py with default benchmark parameters."""

    def test_run_py_default_exit_zero(self) -> None:
        report = P01_DIR / "report.json"
        result = subprocess.run(
            [
                sys.executable,
                "run.py",
                "--adapter",
                "adapters.myteam:Engine",
                "--fk-policy",
                "tombstone",
                "--out",
                str(report),
            ],
            cwd=P01_DIR,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            self.fail(
                f"run.py failed (exit {result.returncode})\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )

        import json

        payload = json.loads(report.read_text(encoding="utf-8"))
        self.assertTrue(all(payload["score"]["axes"].values()))
        self.assertEqual(payload["score"]["weighted_score"], 1.0)


if __name__ == "__main__":
    unittest.main()
