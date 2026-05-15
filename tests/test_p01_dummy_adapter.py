"""
Tests for tests/p01-crdt/adapters/dummy.py (reference SQLite LWW adapter).

The dummy adapter intentionally fails some invariants — it validates that the
harness and assertions can detect weak engines. These tests ensure dummy.py
is present, implements Adapter, runs end-to-end, and fails as designed.
"""
from __future__ import annotations

import inspect
import subprocess
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
P01_DIR = TESTS_DIR / "p01-crdt"


def load_p01(name: str):
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    return __import__(name, fromlist=["*"])


class TestDummyAdapterInterface(unittest.TestCase):
    """dummy.py implements the Adapter ABC from adapter.py."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.adapter_module = load_p01("adapter")
        cls.dummy = load_p01("adapters.dummy")

    def test_dummy_is_adapter_subclass(self) -> None:
        self.assertTrue(issubclass(self.dummy.DummyAdapter, self.adapter_module.Adapter))

    def test_dummy_implements_abstract_methods(self) -> None:
        abstract = {
            name
            for name, member in inspect.getmembers(self.adapter_module.Adapter)
            if getattr(member, "__isabstractmethod__", False)
        }
        implemented = set(dir(self.dummy.DummyAdapter))
        self.assertTrue(abstract.issubset(implemented))


class TestDummyAdapterSmoke(unittest.TestCase):
    """DummyAdapter runs the full Adapter lifecycle without errors."""

    def setUp(self) -> None:
        dummy = load_p01("adapters.dummy")
        self.adapter = dummy.DummyAdapter()

    def tearDown(self) -> None:
        self.adapter.close()

    def test_sqlite_per_peer_lifecycle(self) -> None:
        schema = [
            "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
        ]
        self.adapter.open_peer("X")
        self.adapter.apply_schema("X", schema)
        self.adapter.execute(
            "X",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u1", "a@x.com", "A"),
        )
        state = self.adapter.snapshot_state("X")
        digest = self.adapter.snapshot_hash("X")

        self.assertEqual(len(state["users"]), 1)
        self.assertEqual(state["users"][0]["id"], "u1")
        self.assertEqual(len(digest), 64)

    def test_naive_sync_is_last_writer_wins(self) -> None:
        schema = [
            "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT)",
        ]
        self.adapter.open_peer("A")
        self.adapter.open_peer("B")
        self.adapter.apply_schema("A", schema)
        self.adapter.apply_schema("B", schema)
        self.adapter.execute(
            "A",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u1", "a@x.com", "Alice"),
        )
        self.adapter.execute(
            "B",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u1", "b@x.com", "Bob"),
        )
        self.adapter.sync("A", "B")

        row = self.adapter.snapshot_state("B")["users"][0]
        self.assertEqual(row["email"], "b@x.com")


class TestDummyAdapterHarness(unittest.TestCase):
    """Harness + assertions exercise dummy; tombstone FK must fail (by design)."""

    def test_reference_fails_fk_under_tombstone_policy(self) -> None:
        harness = load_p01("harness")
        assertions = load_p01("assertions")
        dummy = load_p01("adapters.dummy")

        adapter = dummy.DummyAdapter()
        try:
            report = harness.run_reference(adapter, stated_fk_policy="tombstone")
            state = adapter.snapshot_state("A")
        finally:
            adapter.close()

        fk = assertions.assert_fk_documented(state, "tombstone")
        self.assertFalse(fk.passed, "dummy must not satisfy tombstone FK (o1 cascaded by SQLite)")
        self.assertFalse(
            all(a.passed for a in report.assertions),
            "reference scenario must not pass every assertion with dummy + tombstone",
        )

    def test_harness_runs_without_crash(self) -> None:
        harness = load_p01("harness")
        dummy = load_p01("adapters.dummy")

        adapter = dummy.DummyAdapter()
        try:
            ref = harness.run_reference(adapter, stated_fk_policy="cascade")
            chs = harness.run_chaos(adapter, seeds=[1])
            rnd = harness.run_randomized(adapter, seeds=[101], n_peers=4, n_ops=20)
            score = harness.compute_score(ref, chs, rnd)
        finally:
            adapter.close()

        self.assertIsInstance(score["weighted_score"], float)
        self.assertGreaterEqual(score["weighted_score"], 0.0)
        self.assertLessEqual(score["weighted_score"], 1.0)

    def test_tombstone_score_below_perfect(self) -> None:
        harness = load_p01("harness")
        dummy = load_p01("adapters.dummy")

        adapter = dummy.DummyAdapter()
        try:
            ref = harness.run_reference(adapter, stated_fk_policy="tombstone")
            score = harness.compute_score(ref, [], None)
        finally:
            adapter.close()

        self.assertLess(score["weighted_score"], 1.0)
        self.assertFalse(score["axes"]["fk"])


class TestDummyAdapterCli(unittest.TestCase):
    """Official harness CLIs accept adapters.dummy:DummyAdapter."""

    def test_self_check_quick_runs(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "self_check.py",
                "--adapter",
                "adapters.dummy:DummyAdapter",
                "--fk-policy",
                "cascade",
                "--quick",
            ],
            cwd=P01_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("WEIGHTED SCORE", result.stdout)

    def test_self_check_tombstone_exits_nonzero(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "self_check.py",
                "--adapter",
                "adapters.dummy:DummyAdapter",
                "--fk-policy",
                "tombstone",
                "--quick",
            ],
            cwd=P01_DIR,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1, "dummy + tombstone should fail self-check")
        self.assertIn("FAIL", result.stdout)


class TestMyteamBeatsDummy(unittest.TestCase):
    """Submission engine must outperform the reference dummy on tombstone FK."""

    def test_myteam_scores_higher_than_dummy_on_reference(self) -> None:
        harness = load_p01("harness")
        dummy_mod = load_p01("adapters.dummy")
        myteam_mod = load_p01("adapters.myteam")

        dummy = dummy_mod.DummyAdapter()
        try:
            d_ref = harness.run_reference(dummy, stated_fk_policy="tombstone")
            d_score = harness.compute_score(d_ref, [], None)
        finally:
            dummy.close()

        engine = myteam_mod.Engine(fk_policy="tombstone")
        try:
            m_ref = harness.run_reference(engine, stated_fk_policy="tombstone")
            m_score = harness.compute_score(m_ref, [], None)
        finally:
            engine.close()

        self.assertFalse(d_score["axes"]["fk"])
        self.assertTrue(m_score["axes"]["fk"])
        self.assertTrue(all(m_score["axes"].values()), "myteam must pass all reference assertions")
        self.assertLess(d_score["weighted_score"], m_score["weighted_score"])


if __name__ == "__main__":
    unittest.main()
