"""
Tests for tests/p01-crdt/scenarios/ (reference, chaos, randomized).

Validates scenario generators and that adapters.myteam.Engine passes
each scenario through the harness.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
P01_DIR = TESTS_DIR / "p01-crdt"


def load_scenarios():
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    from scenarios import chaos, randomized, reference

    return reference, chaos, randomized


def load_harness_and_engine():
    if str(P01_DIR) not in sys.path:
        sys.path.insert(0, str(P01_DIR))
    import harness
    import adapters.myteam as myteam

    return harness, myteam


class TestReferenceScenario(unittest.TestCase):
    """scenarios/reference.py — Annex A canonical trace."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.reference, _, _ = load_scenarios()

    def test_schema_and_peers(self) -> None:
        self.assertEqual(len(self.reference.SCHEMA), 3)
        self.assertEqual(self.reference.PEERS, ["A", "B", "C"])

    def test_operations_trace(self) -> None:
        ops = self.reference.OPERATIONS
        self.assertEqual(len(ops), 9)
        stmts = [o for o in ops if isinstance(o, self.reference.Stmt)]
        syncs = [o for o in ops if isinstance(o, self.reference.Sync)]
        self.assertEqual(len(stmts), 7)
        self.assertEqual(len(syncs), 2)

    def test_final_sync_order(self) -> None:
        order = self.reference.FINAL_SYNC_ORDER
        self.assertEqual(len(order), 6)
        self.assertEqual(order.count(("A", "B")), 2)

    def test_stmt_and_sync_are_frozen(self) -> None:
        stmt = self.reference.Stmt("A", "SELECT 1", ())
        with self.assertRaises(Exception):
            stmt.peer = "B"  # type: ignore[misc]


class TestChaosScenario(unittest.TestCase):
    """scenarios/chaos.py — permuted sync orderings."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.reference, cls.chaos, _ = load_scenarios()

    def test_permute_is_deterministic(self) -> None:
        a = self.chaos.permute_sync_order(42)
        b = self.chaos.permute_sync_order(42)
        self.assertEqual(a, b)

    def test_permute_differs_by_seed(self) -> None:
        orders = [self.chaos.permute_sync_order(s) for s in (1, 2, 3, 5, 8)]
        self.assertGreater(len(set(tuple(o) for o in orders)), 1)

    def test_permute_appends_terminal_triple(self) -> None:
        order = self.chaos.permute_sync_order(99)
        self.assertEqual(order[-3:], [("A", "B"), ("B", "C"), ("A", "C")])

    def test_permute_length(self) -> None:
        order = self.chaos.permute_sync_order(1)
        expected_len = len(self.reference.FINAL_SYNC_ORDER) + 3
        self.assertEqual(len(order), expected_len)

    def test_permute_contains_all_base_pairs(self) -> None:
        order = self.chaos.permute_sync_order(7)
        head = order[: len(self.reference.FINAL_SYNC_ORDER)]
        for pair in self.reference.FINAL_SYNC_ORDER:
            self.assertIn(pair, head)


class TestRandomizedScenario(unittest.TestCase):
    """scenarios/randomized.py — property-based op generator."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.reference, _, cls.randomized = load_scenarios()

    def test_generate_is_deterministic(self) -> None:
        cfg = self.randomized.RandomizedConfig(seed=31415, n_peers=4, n_ops=40)
        a = self.randomized.generate(cfg)
        b = self.randomized.generate(cfg)
        self.assertEqual(a, b)

    def test_generate_structure(self) -> None:
        cfg = self.randomized.RandomizedConfig(seed=101, n_peers=4, n_ops=80)
        peers, ops, tail = self.randomized.generate(cfg)
        self.assertEqual(peers, ["P0", "P1", "P2", "P3"])
        self.assertEqual(len(ops), 80)
        pair_count = 4 * 3 // 2
        self.assertEqual(len(tail), 2 * pair_count)

    def test_generate_ops_are_stmt_or_sync(self) -> None:
        _, ops, _ = self.randomized.generate(
            self.randomized.RandomizedConfig(seed=202, n_ops=50)
        )
        for op in ops:
            self.assertTrue(
                isinstance(op, self.reference.Stmt) or isinstance(op, self.reference.Sync)
            )

    def test_generate_differs_by_seed(self) -> None:
        cfg_a = self.randomized.RandomizedConfig(seed=1, n_ops=30)
        cfg_b = self.randomized.RandomizedConfig(seed=2, n_ops=30)
        _, ops_a, _ = self.randomized.generate(cfg_a)
        _, ops_b, _ = self.randomized.generate(cfg_b)
        self.assertNotEqual(ops_a, ops_b)

    def test_sync_tail_is_full_mesh_twice(self) -> None:
        peers, _, tail = self.randomized.generate(
            self.randomized.RandomizedConfig(seed=0, n_peers=3, n_ops=10)
        )
        expected = [
            ("P0", "P1"), ("P0", "P2"), ("P1", "P2"),
            ("P0", "P1"), ("P0", "P2"), ("P1", "P2"),
        ]
        self.assertEqual(tail, expected)
        self.assertEqual(peers, ["P0", "P1", "P2"])


class TestScenariosWithEngine(unittest.TestCase):
    """myteam.Engine passes chaos + randomized via harness scenario runners."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.harness, cls.myteam = load_harness_and_engine()

    def _engine(self):
        return self.myteam.Engine(fk_policy="tombstone")

    def test_chaos_all_default_seeds_order_invariant(self) -> None:
        adapter = self._engine()
        try:
            reports = self.harness.run_chaos(adapter, seeds=[1, 2, 3, 5, 8])
        finally:
            adapter.close()

        self.assertEqual(len(reports), 5)
        for report in reports:
            with self.subTest(scenario=report.scenario):
                self.assertTrue(
                    all(a.passed for a in report.assertions),
                    f"{report.scenario}: {[a.name for a in report.assertions if not a.passed]}",
                )

    def test_randomized_default_seeds(self) -> None:
        adapter = self._engine()
        try:
            reports = self.harness.run_randomized(
                adapter,
                seeds=[101, 202, 303, 404],
                n_peers=4,
                n_ops=80,
            )
        finally:
            adapter.close()

        for report in reports:
            with self.subTest(scenario=report.scenario):
                self.assertTrue(all(a.passed for a in report.assertions))

    def test_randomized_stress_seeds(self) -> None:
        adapter = self._engine()
        try:
            reports = self.harness.run_randomized(
                adapter,
                seeds=[9999, 31415],
                n_peers=5,
                n_ops=150,
            )
        finally:
            adapter.close()

        for report in reports:
            with self.subTest(scenario=report.scenario):
                self.assertTrue(all(a.passed for a in report.assertions))

    def test_reference_via_scenario_constants(self) -> None:
        reference, _, _ = load_scenarios()
        adapter = self._engine()
        try:
            for p in reference.PEERS:
                adapter.open_peer(p)
                adapter.apply_schema(p, reference.SCHEMA)
            for op in reference.OPERATIONS:
                if isinstance(op, reference.Stmt):
                    adapter.execute(op.peer, op.sql, op.params)
                else:
                    adapter.sync(op.a, op.b)
            for a, b in reference.FINAL_SYNC_ORDER:
                adapter.sync(a, b)
            hashes = {p: adapter.snapshot_hash(p) for p in reference.PEERS}
        finally:
            adapter.close()

        self.assertEqual(len(set(hashes.values())), 1)


if __name__ == "__main__":
    unittest.main()
