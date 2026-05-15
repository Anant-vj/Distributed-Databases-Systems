"""
Unit tests for tests/p01-crdt/assertions.py invariant checkers.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
P01_DIR = TESTS_DIR / "p01-crdt"


def load_assertions():
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    import assertions

    return assertions


class TestAssertionsUnit(unittest.TestCase):
    """Pure unit tests with synthetic state (no engine required)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.assertions = load_assertions()

    def test_assert_convergence_pass(self) -> None:
        result = self.assertions.assert_convergence({"A": "abc", "B": "abc", "C": "abc"})
        self.assertTrue(result.passed)
        self.assertEqual(result.name, "convergence")

    def test_assert_convergence_fail(self) -> None:
        result = self.assertions.assert_convergence({"A": "abc", "B": "def"})
        self.assertFalse(result.passed)

    def test_assert_uniqueness_email_pass(self) -> None:
        state = {
            "users": [
                {"id": "u1", "email": "a@x.com", "name": "A"},
                {"id": "u2", "email": "b@x.com", "name": "B"},
            ]
        }
        result = self.assertions.assert_uniqueness_email(state)
        self.assertTrue(result.passed)

    def test_assert_uniqueness_email_fail(self) -> None:
        state = {
            "users": [
                {"id": "u1", "email": "dup@x.com", "name": "A"},
                {"id": "u2", "email": "dup@x.com", "name": "B"},
            ]
        }
        result = self.assertions.assert_uniqueness_email(state)
        self.assertFalse(result.passed)
        self.assertIn("dup@x.com", result.detail)

    def test_assert_fk_tombstone_pass(self) -> None:
        state = {
            "users": [{"id": "u2", "email": "b@x.com", "name": "B"}],
            "orders": [{"id": "o1", "user_id": "u1", "status": "pending", "total_cents": 1200}],
        }
        result = self.assertions.assert_fk_documented(state, "tombstone")
        self.assertTrue(result.passed)
        self.assertEqual(result.name, "fk:tombstone")

    def test_assert_fk_tombstone_fail(self) -> None:
        state = {
            "users": [{"id": "u1", "email": "a@x.com", "name": "A"}],
            "orders": [{"id": "o1", "user_id": "u1", "status": "pending", "total_cents": 1200}],
        }
        result = self.assertions.assert_fk_documented(state, "tombstone")
        self.assertFalse(result.passed)

    def test_assert_fk_cascade_pass(self) -> None:
        state = {"users": [{"id": "u2", "email": "b@x.com", "name": "B"}], "orders": []}
        result = self.assertions.assert_fk_documented(state, "cascade")
        self.assertTrue(result.passed)

    def test_assert_fk_orphan_pass(self) -> None:
        state = {
            "users": [{"id": "u2", "email": "b@x.com", "name": "B"}],
            "orders": [{"id": "o1", "user_id": None, "status": "pending", "total_cents": 1200}],
        }
        result = self.assertions.assert_fk_documented(state, "orphan")
        self.assertTrue(result.passed)

    def test_assert_cell_level_merge_vacuous_when_u1_absent(self) -> None:
        state = {"users": [{"id": "u2", "email": "b@x.com", "name": "Bob"}]}
        result = self.assertions.assert_cell_level_merge(state)
        self.assertTrue(result.passed)

    def test_assert_cell_level_merge_both_columns(self) -> None:
        state = {
            "users": [{"id": "u1", "email": "alice@ex.org", "name": "Alice Cooper"}]
        }
        result = self.assertions.assert_cell_level_merge(state)
        self.assertTrue(result.passed)

    def test_assert_cell_level_merge_fail_partial(self) -> None:
        state = {"users": [{"id": "u1", "email": "old@x.com", "name": "Alice Cooper"}]}
        result = self.assertions.assert_cell_level_merge(state)
        self.assertFalse(result.passed)


class TestAssertionsWithEngine(unittest.TestCase):
    """assertions.py invariants against live engine state (reference scenario)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.assertions = load_assertions()
        if str(P01_DIR) not in sys.path:
            sys.path.insert(0, str(P01_DIR))
        import harness
        import adapters.myteam as myteam

        cls.harness = harness
        adapter = myteam.Engine(fk_policy="tombstone")
        try:
            cls.ref = harness.run_reference(adapter, stated_fk_policy="tombstone")
            cls.state = adapter.snapshot_state("A")
            cls.hashes = {p: adapter.snapshot_hash(p) for p in ("A", "B", "C")}
        finally:
            adapter.close()

    def test_reference_convergence(self) -> None:
        self.assertTrue(self.assertions.assert_convergence(self.hashes).passed)

    def test_reference_uniqueness_email(self) -> None:
        self.assertTrue(self.assertions.assert_uniqueness_email(self.state).passed)

    def test_reference_fk_tombstone(self) -> None:
        self.assertTrue(self.assertions.assert_fk_documented(self.state, "tombstone").passed)

    def test_reference_cell_level_merge(self) -> None:
        self.assertTrue(self.assertions.assert_cell_level_merge(self.state).passed)


if __name__ == "__main__":
    unittest.main()
