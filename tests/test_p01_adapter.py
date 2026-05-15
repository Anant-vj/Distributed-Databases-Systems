"""
Tests for tests/p01-crdt/adapter.py interface and adapters.myteam.Engine compliance.
"""
from __future__ import annotations

import inspect
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
P01_DIR = TESTS_DIR / "p01-crdt"

SCHEMA = [
    """CREATE TABLE users (
         id    TEXT PRIMARY KEY,
         email TEXT NOT NULL UNIQUE,
         name  TEXT
       )""",
    """CREATE TABLE orders (
         id          TEXT PRIMARY KEY,
         user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         status      TEXT NOT NULL,
         total_cents INTEGER NOT NULL DEFAULT 0
       )""",
    "CREATE INDEX orders_by_user ON orders(user_id, status)",
]


def load_p01(name: str):
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    return __import__(name, fromlist=["*"])


class TestAdapterInterface(unittest.TestCase):
    """adapter.py ABC contract."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.adapter_module = load_p01("adapter")
        cls.myteam = load_p01("adapters.myteam")

    def test_engine_is_adapter_subclass(self) -> None:
        self.assertTrue(issubclass(self.myteam.Engine, self.adapter_module.Adapter))

    def test_engine_implements_all_abstract_methods(self) -> None:
        abstract = {
            name
            for name, member in inspect.getmembers(self.adapter_module.Adapter)
            if getattr(member, "__isabstractmethod__", False)
        }
        implemented = set(dir(self.myteam.Engine)) | set(
            name for name, _ in inspect.getmembers(self.myteam.Engine, predicate=inspect.isfunction)
        )
        missing = abstract - implemented
        self.assertEqual(missing, set(), f"missing Adapter methods: {missing}")

    def test_cannot_instantiate_abc_directly(self) -> None:
        with self.assertRaises(TypeError):
            self.adapter_module.Adapter()  # type: ignore[abstract]


class TestMyteamAdapterSmoke(unittest.TestCase):
    """End-to-end smoke test through the Adapter interface."""

    def setUp(self) -> None:
        myteam = load_p01("adapters.myteam")
        self.adapter = myteam.Engine(fk_policy="tombstone")

    def tearDown(self) -> None:
        self.adapter.close()

    def test_open_apply_execute_sync_snapshot_close(self) -> None:
        self.adapter.open_peer("A")
        self.adapter.open_peer("B")
        self.adapter.apply_schema("A", SCHEMA)
        self.adapter.apply_schema("B", SCHEMA)

        self.adapter.execute(
            "A",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u1", "ada@x.com", "Ada"),
        )
        self.adapter.execute(
            "B",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u2", "ben@x.com", "Ben"),
        )
        self.adapter.sync("A", "B")

        state_a = self.adapter.snapshot_state("A")
        state_b = self.adapter.snapshot_state("B")
        hash_a = self.adapter.snapshot_hash("A")
        hash_b = self.adapter.snapshot_hash("B")

        self.assertIsInstance(state_a, dict)
        self.assertIsInstance(state_b, dict)
        self.assertEqual(len(state_a["users"]), 2)
        self.assertEqual(hash_a, hash_b)
        self.assertEqual(len(hash_a), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in hash_a))

    def test_snapshot_state_ordered_by_primary_key(self) -> None:
        self.adapter.open_peer("P")
        self.adapter.apply_schema("P", SCHEMA)
        self.adapter.execute(
            "P",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u2", "b@x.com", "B"),
        )
        self.adapter.execute(
            "P",
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
            ("u1", "a@x.com", "A"),
        )
        users = self.adapter.snapshot_state("P")["users"]
        self.assertEqual([u["id"] for u in users], ["u1", "u2"])


class TestAdapterPassesAssertionsOnReference(unittest.TestCase):
    """Adapter-produced reference scenario state satisfies assertions.py."""

    def test_reference_state_invariants(self) -> None:
        assertions = load_p01("assertions")
        harness = load_p01("harness")
        myteam = load_p01("adapters.myteam")

        adapter = myteam.Engine(fk_policy="tombstone")
        try:
            harness.run_reference(adapter, stated_fk_policy="tombstone")
            state = adapter.snapshot_state("A")
            hashes = {p: adapter.snapshot_hash(p) for p in ("A", "B", "C")}
        finally:
            adapter.close()

        self.assertTrue(assertions.assert_convergence(hashes).passed)
        self.assertTrue(assertions.assert_uniqueness_email(state).passed)
        self.assertTrue(assertions.assert_fk_documented(state, "tombstone").passed)
        self.assertTrue(assertions.assert_cell_level_merge(state).passed)


if __name__ == "__main__":
    unittest.main()
